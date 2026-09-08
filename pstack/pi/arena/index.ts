import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	getPackageDir,
	truncateHead,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const MAX_CONCURRENT_CHILDREN = 4;
const MAX_CANDIDATES = 8;
const MAX_TASK_BYTES = 100 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const MAX_EVENT_LINE_BYTES = 4 * 1024 * 1024;
const MAX_RUN_MS = 30 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const RUNNER_TOOLS = "read,bash,edit,write,grep,find,ls";
const JUDGE_TOOLS = "read,grep,find,ls";

const arenaDirectory = dirname(fileURLToPath(import.meta.url));
const runnerProfilePath = join(arenaDirectory, "runner.md");
const judgeProfilePath = join(arenaDirectory, "judge.md");

// Pi accepts TypeBox's JSON-schema shape. Keeping this schema literal avoids a
// second runtime dependency for the package that owns this extension.
const ArenaParams = {
	type: "object",
	properties: {
		role: {
			type: "string",
			enum: ["runner", "judge"],
			description: "Run one independent candidate or judge completed candidate directories.",
		},
		task: {
			type: "string",
			minLength: 1,
			maxLength: MAX_TASK_BYTES,
			description: "The complete candidate brief, or the judging brief including the concrete rubric.",
		},
		model: {
			type: "object",
			properties: {
				provider: { type: "string", minLength: 1, description: "Exact provider from Pi's model registry." },
				id: { type: "string", minLength: 1, description: "Exact model id from Pi's model registry." },
			},
			required: ["provider", "id"],
			additionalProperties: false,
		},
		candidatePaths: {
			type: "array",
			items: { type: "string", minLength: 1 },
			minItems: 1,
			maxItems: MAX_CANDIDATES,
			description: "Completed candidate directories. Required only for the judge role.",
		},
	},
	required: ["role", "task"],
	additionalProperties: false,
} as any;

type ArenaRole = "runner" | "judge";

interface ArenaInput {
	role: ArenaRole;
	task: string;
	model?: { provider: string; id: string };
	candidatePaths?: string[];
}

interface ArenaToolOptions {
	/** Test seam for a Pi-compatible CLI script. Production uses the installed Pi CLI. */
	cliPath?: string;
	/** Test seam for temporary directories. */
	tempRoot?: string;
	/** Test seam for process termination timing. */
	killGraceMs?: number;
}

interface ArenaDetails {
	role: ArenaRole;
	status: "running" | "completed" | "failed" | "cancelled";
	outputDirectory: string | null;
	sourceProject: string;
	candidatePaths: string[];
	model: string;
	finalResponse: string;
	finalResponsePath?: string;
	artifactPaths: string[];
	exitCode: number | null;
	exitSignal: NodeJS.Signals | null;
	cancelled: boolean;
	timedOut: boolean;
	stopReason?: string;
	errorMessage?: string;
	stderr: string;
	stderrPath?: string;
	truncated: {
		finalResponse: boolean;
		stderr: boolean;
	};
}

interface ChildOutcome {
	exitCode: number | null;
	exitSignal: NodeJS.Signals | null;
	cancelled: boolean;
	timedOut: boolean;
	finalResponse: string;
	stopReason?: string;
	errorMessage?: string;
	stderr: string;
	parseErrors: number;
	spawnError?: string;
}

interface CliInvocation {
	command: string;
	args: string[];
}

class ChildGate {
	private active = 0;
	private readonly waiters: Array<{
		resolve: (release: () => void) => void;
		reject: (error: Error) => void;
		signal?: AbortSignal;
		onAbort?: () => void;
	}> = [];

	private readonly limit: number;

	constructor(limit: number) {
		this.limit = limit;
	}

	acquire(signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) return Promise.reject(new Error("Arena run cancelled before it started."));
		if (this.active < this.limit) {
			this.active += 1;
			return Promise.resolve(this.releaseFunction());
		}

		return new Promise((resolveWaiter, reject) => {
			const waiter: (typeof this.waiters)[number] = { resolve: resolveWaiter, reject, signal };
			if (signal) {
				waiter.onAbort = () => {
					const index = this.waiters.indexOf(waiter);
					if (index !== -1) this.waiters.splice(index, 1);
					reject(new Error("Arena run cancelled while waiting for a worker slot."));
				};
				signal.addEventListener("abort", waiter.onAbort, { once: true });
			}
			this.waiters.push(waiter);
		});
	}

	private releaseFunction(): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			while (this.waiters.length > 0) {
				const waiter = this.waiters.shift()!;
				if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
				if (waiter.signal?.aborted) continue;
				waiter.resolve(this.releaseFunction());
				return;
			}
			this.active -= 1;
		};
	}
}

/** Register pstack's dedicated one-child Arena worker tool. */
export function registerArenaTool(pi: ExtensionAPI, options: ArenaToolOptions = {}): void {
	const gate = new ChildGate(MAX_CONCURRENT_CHILDREN);

	pi.registerTool<any, ArenaDetails>({
		name: "pstack_arena_run",
		label: "Pstack Arena Worker",
		description: [
			"Launch exactly one fresh Pi child as an Arena runner or independent judge.",
			"Call once per competing attempt; identical briefs are intentional and runner output directories are always unique.",
			"Runner mode is artifact-only: it writes candidate files and rationale under a retained temporary directory and receives the source project as an absolute read-only reference.",
			"This initial tool does not create git worktrees, integrate candidates, commit, install, push, or merge.",
			"Judge mode accepts 1-8 completed candidate directories and exposes only read, grep, find, and ls to the child.",
			"Omit model to use the current session model, or provide an exact provider/id pair from Pi's available model registry; Cursor model slugs are not accepted.",
			`Child output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; the full final response is retained in the output directory when possible.`,
			`At most ${MAX_CONCURRENT_CHILDREN} children run concurrently and each run is capped at 30 minutes.`,
			"The runner's shell policy is instruction-based and is not a sandbox.",
		].join(" "),
		promptSnippet: "Run one isolated pstack Arena candidate or judge pass",
		promptGuidelines: [
			"Use pstack_arena_run once per Arena candidate, then call it once as judge only after candidate directories are complete.",
			"Give competing pstack_arena_run runner calls the same complete brief; the parent workflow owns fanout, comparison, grafting, synthesis, and verification.",
		],
		parameters: ArenaParams,
		executionMode: "parallel",

		async execute(_toolCallId, rawParams, signal, onUpdate, ctx) {
			const params = rawParams as unknown as ArenaInput;
			validateTask(params.task);
			const sourceProject = resolve(ctx.cwd);
			const candidatePaths = await validateCandidatePaths(params.role, params.candidatePaths, sourceProject);
			const model = await resolveModel(ctx, params.model);
			const modelName = `${model.provider}/${model.id}`;

			let release: (() => void) | undefined;
			try {
				release = await gate.acquire(signal);
			} catch (error) {
				return cancelledBeforeStart(params.role, sourceProject, candidatePaths, modelName, error);
			}

			let promptDirectory: string | undefined;
			let outputDirectory: string | undefined;
			try {
				outputDirectory = await makeTempDirectory(options.tempRoot, `pstack-arena-${params.role}-`);
				promptDirectory = await makeTempDirectory(options.tempRoot, "pstack-arena-prompt-");
				const scopePath = join(promptDirectory, "scope.md");
				await writeFile(
					scopePath,
					buildScopePrompt(params.role, params.task, sourceProject, outputDirectory, candidatePaths),
					{ encoding: "utf8", mode: 0o600 },
				);

				const runningDetails = emptyDetails(params.role, sourceProject, candidatePaths, modelName, outputDirectory);
				onUpdate?.({
					content: [{ type: "text", text: `${params.role} child running in ${outputDirectory}` }],
					details: runningDetails,
				});

				const cliArgs = buildCliArgs(params.role, modelName, scopePath);
				const outcome = await runChild(
					resolveCliInvocation(cliArgs, options.cliPath),
					outputDirectory,
					signal,
					options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
				);
				const result = await buildResult(params.role, sourceProject, candidatePaths, modelName, outputDirectory, outcome);
				onUpdate?.(result);
				return result;
			} finally {
				if (promptDirectory) await rm(promptDirectory, { recursive: true, force: true });
				release();
			}
		},
	});
}

function validateTask(task: string): void {
	if (!task.trim()) throw new Error("Arena task must not be empty.");
	if (Buffer.byteLength(task, "utf8") > MAX_TASK_BYTES) {
		throw new Error(`Arena task exceeds the ${formatSize(MAX_TASK_BYTES)} limit.`);
	}
}

async function validateCandidatePaths(
	role: ArenaRole,
	paths: string[] | undefined,
	sourceProject: string,
): Promise<string[]> {
	if (role === "runner") {
		if (paths && paths.length > 0) throw new Error("candidatePaths is valid only for the judge role.");
		return [];
	}
	if (!paths || paths.length === 0) throw new Error("Judge role requires at least one completed candidate directory.");
	if (paths.length > MAX_CANDIDATES) throw new Error(`Judge role accepts at most ${MAX_CANDIDATES} candidate directories.`);

	const validated: string[] = [];
	for (const candidatePath of paths) {
		const absolute = resolve(sourceProject, candidatePath);
		let canonical: string;
		try {
			canonical = await realpath(absolute);
			if (!(await stat(canonical)).isDirectory()) throw new Error("not a directory");
			await access(canonical, fsConstants.R_OK);
		} catch {
			throw new Error(`Candidate directory is missing, unreadable, or not a directory: ${absolute}`);
		}
		validated.push(canonical);
	}
	return validated;
}

async function resolveModel(
	ctx: ExtensionContext,
	requested: { provider: string; id: string } | undefined,
): Promise<{ provider: string; id: string }> {
	const model = requested ? ctx.modelRegistry.find(requested.provider, requested.id) : ctx.model;
	const label = requested ? `${requested.provider}/${requested.id}` : "the current session model";
	if (!model) throw new Error(`Arena could not resolve ${label} as an available Pi model.`);

	const available = ctx.modelRegistry
		.getAvailable()
		.some((candidate) => candidate.provider === model.provider && candidate.id === model.id);
	if (!available) throw new Error(`Arena model ${model.provider}/${model.id} is not available with configured authentication.`);

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(`Arena model ${model.provider}/${model.id} authentication is unavailable: ${auth.error}`);
	}
	return model;
}

function buildScopePrompt(
	role: ArenaRole,
	task: string,
	sourceProject: string,
	outputDirectory: string,
	candidatePaths: string[],
): string {
	const sections = [
		"# Arena invocation scope",
		`Role: ${role}`,
		`Source project (absolute reference): ${JSON.stringify(sourceProject)}`,
		`Run output directory: ${JSON.stringify(outputDirectory)}`,
	];
	if (role === "runner") {
		sections.push(
			"Execution mode: artifact-only mode. Work in the run output directory. Use the source project only as a reference.",
		);
	} else {
		sections.push(
			"Completed candidate directories (JSON-encoded paths):",
			...candidatePaths.map((path, index) => `${index + 1}. ${JSON.stringify(path)}`),
		);
	}
	sections.push(
		"# Task brief",
		"The JSON string below is the complete task brief. Decode it and follow it within the canonical role constraints.",
		JSON.stringify(task),
	);
	return sections.join("\n\n");
}

function buildCliArgs(role: ArenaRole, model: string, scopePath: string): string[] {
	return [
		"--mode",
		"json",
		"--print",
		"--no-session",
		"--offline",
		"--no-approve",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--model",
		model,
		"--tools",
		role === "runner" ? RUNNER_TOOLS : JUDGE_TOOLS,
		"--append-system-prompt",
		role === "runner" ? runnerProfilePath : judgeProfilePath,
		"--append-system-prompt",
		scopePath,
		role === "runner"
			? "Produce the assigned Arena candidate artifacts and rationale now."
			: "Independently judge every supplied completed candidate against the task rubric now.",
	];
}

function resolveCliInvocation(args: string[], cliPath?: string): CliInvocation {
	if (cliPath) return { command: process.execPath, args: [cliPath, ...args] };
	const executable = process.execPath;
	const executableName = executable.split(/[\\/]/).at(-1)?.toLowerCase();
	if (executableName && !/^(node|bun)(\.exe)?$/.test(executableName)) {
		return { command: executable, args };
	}
	return { command: executable, args: [join(getPackageDir(), "dist", "bundle", "cli.js"), ...args] };
}

async function makeTempDirectory(root: string | undefined, prefix: string): Promise<string> {
	const parent = root ? resolve(root) : tmpdir();
	await mkdir(parent, { recursive: true });
	return mkdtemp(join(parent, prefix));
}

function runChild(
	invocation: CliInvocation,
	cwd: string,
	signal: AbortSignal | undefined,
	killGraceMs: number,
): Promise<ChildOutcome> {
	return new Promise((resolveOutcome) => {
		let finalResponse = "";
		let stopReason: string | undefined;
		let errorMessage: string | undefined;
		let stderr = "";
		let stdoutBuffer = "";
		let parseErrors = 0;
		let cancelled = false;
		let timedOut = false;
		let spawnError: string | undefined;
		let termination: Promise<void> | undefined;

		const child = spawn(invocation.command, invocation.args, {
			cwd,
			detached: process.platform !== "win32",
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const terminate = () => {
			termination ??= new Promise<void>((resolveTermination) => {
				terminateProcessGroup(child, "SIGTERM");
				setTimeout(() => {
					terminateProcessGroup(child, "SIGKILL");
					resolveTermination();
				}, killGraceMs);
			});
		};
		const onAbort = () => {
			cancelled = true;
			terminate();
		};
		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });

		const timeout = setTimeout(() => {
			timedOut = true;
			terminate();
		}, MAX_RUN_MS);
		timeout.unref();

		const processLine = (line: string) => {
			if (!line.trim()) return;
			if (Buffer.byteLength(line, "utf8") > MAX_EVENT_LINE_BYTES) {
				parseErrors += 1;
				return;
			}
			let event: unknown;
			try {
				event = JSON.parse(line);
			} catch {
				parseErrors += 1;
				return;
			}
			const record = asRecord(event);
			const message = asRecord(record?.message);
			if (record?.type !== "message_end" || message?.role !== "assistant") return;
			const text = extractText(message.content);
			if (text) finalResponse = text;
			if (typeof message.stopReason === "string") stopReason = message.stopReason;
			if (typeof message.errorMessage === "string") errorMessage = message.errorMessage;
		};

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdoutBuffer += chunk;
			if (Buffer.byteLength(stdoutBuffer, "utf8") > MAX_EVENT_LINE_BYTES) {
				stdoutBuffer = "";
				parseErrors += 1;
				return;
			}
			let newline: number;
			while ((newline = stdoutBuffer.indexOf("\n")) !== -1) {
				const line = stdoutBuffer.slice(0, newline);
				stdoutBuffer = stdoutBuffer.slice(newline + 1);
				processLine(line);
			}
		});
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr = appendBounded(stderr, chunk, MAX_STDERR_BYTES);
		});
		child.once("error", (error) => {
			spawnError = error.message;
		});
		child.once("close", async (code, exitSignal) => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
			// A closed leader does not prove its descendants have stopped.
			await termination;
			if (stdoutBuffer.trim()) processLine(stdoutBuffer);
			resolveOutcome({
				exitCode: code,
				exitSignal,
				cancelled,
				timedOut,
				finalResponse,
				stopReason,
				errorMessage,
				stderr,
				parseErrors,
				spawnError,
			});
		});
	});
}

function terminateProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
	if (process.platform === "win32" && child.pid) {
		try {
			const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
				stdio: "ignore",
				windowsHide: true,
			});
			killer.unref();
			return;
		} catch {
			// Fall back to the direct child when taskkill is unavailable.
		}
	}
	if (process.platform !== "win32" && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// Fall back to the direct child if process-group signaling is unavailable.
		}
	}
	try {
		child.kill(signal);
	} catch {
		// The child may have exited between the state check and signal delivery.
	}
}

async function buildResult(
	role: ArenaRole,
	sourceProject: string,
	candidatePaths: string[],
	model: string,
	outputDirectory: string,
	outcome: ChildOutcome,
) {
	const fullResponsePath = outcome.finalResponse
		? await writeHostArtifact(outputDirectory, "_arena-final-response.md", outcome.finalResponse)
		: undefined;
	const stderrPath = outcome.stderr
		? await writeHostArtifact(outputDirectory, "_arena-stderr.log", outcome.stderr)
		: undefined;
	const responseTruncation = truncateHead(outcome.finalResponse, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	const stderrTruncation = truncateHead(outcome.stderr, {
		maxLines: 200,
		maxBytes: 16 * 1024,
	});
	const failed =
		outcome.exitCode !== 0 ||
		Boolean(outcome.exitSignal) ||
		outcome.stopReason === "error" ||
		outcome.stopReason === "aborted" ||
		Boolean(outcome.spawnError) ||
		outcome.timedOut ||
		!outcome.finalResponse;
	const status: ArenaDetails["status"] = outcome.cancelled ? "cancelled" : failed ? "failed" : "completed";
	const errorParts = [outcome.spawnError, outcome.errorMessage];
	if (outcome.timedOut) errorParts.push(`Arena child exceeded the ${MAX_RUN_MS / 60_000}-minute limit.`);
	if (outcome.parseErrors > 0) errorParts.push(`${outcome.parseErrors} oversized or invalid JSON event line(s) ignored.`);
	if (!outcome.finalResponse) errorParts.push("Child produced no final assistant response.");
	const errorMessage = errorParts.filter(Boolean).join(" ") || undefined;
	const details: ArenaDetails = {
		role,
		status,
		outputDirectory,
		sourceProject,
		candidatePaths,
		model,
		finalResponse: responseTruncation.content,
		finalResponsePath: fullResponsePath,
		artifactPaths: await listArtifacts(outputDirectory),
		exitCode: outcome.exitCode,
		exitSignal: outcome.exitSignal,
		cancelled: outcome.cancelled,
		timedOut: outcome.timedOut,
		stopReason: outcome.stopReason,
		errorMessage,
		stderr: stderrTruncation.content,
		stderrPath,
		truncated: {
			finalResponse: responseTruncation.truncated,
			stderr: stderrTruncation.truncated,
		},
	};

	const summary = [
		`Arena ${role} ${status}.`,
		`Output directory: ${outputDirectory}`,
		`Model: ${model}`,
		`Exit: ${outcome.exitCode ?? "none"}${outcome.exitSignal ? ` (${outcome.exitSignal})` : ""}`,
	];
	if (errorMessage) summary.push(`Diagnostic: ${errorMessage}`);
	if (stderrTruncation.content) summary.push(`Stderr:\n${stderrTruncation.content}`);
	if (responseTruncation.truncated && fullResponsePath) {
		summary.push(`Final response truncated; full response: ${fullResponsePath}`);
	}
	if (responseTruncation.content) summary.push(`Final response:\n${responseTruncation.content}`);
	const visible = truncateHead(summary.join("\n\n"), {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	return { content: [{ type: "text" as const, text: visible.content }], details };
}

async function writeHostArtifact(directory: string, name: string, content: string): Promise<string | undefined> {
	const path = join(directory, name);
	try {
		await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
		return path;
	} catch {
		return undefined;
	}
}

async function listArtifacts(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1))
		.sort()
		.slice(0, 200);
}

function emptyDetails(
	role: ArenaRole,
	sourceProject: string,
	candidatePaths: string[],
	model: string,
	outputDirectory: string | null,
): ArenaDetails {
	return {
		role,
		status: "running",
		outputDirectory,
		sourceProject,
		candidatePaths,
		model,
		finalResponse: "",
		artifactPaths: [],
		exitCode: null,
		exitSignal: null,
		cancelled: false,
		timedOut: false,
		stderr: "",
		truncated: { finalResponse: false, stderr: false },
	};
}

function cancelledBeforeStart(
	role: ArenaRole,
	sourceProject: string,
	candidatePaths: string[],
	model: string,
	error: unknown,
) {
	const message = error instanceof Error ? error.message : "Arena run cancelled before it started.";
	const details = emptyDetails(role, sourceProject, candidatePaths, model, null);
	details.status = "cancelled";
	details.cancelled = true;
	details.errorMessage = message;
	return { content: [{ type: "text" as const, text: message }], details };
}

function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => asRecord(part))
		.filter((part): part is Record<string, unknown> => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n");
}

function appendBounded(current: string, addition: string, maxBytes: number): string {
	const combined = current + addition;
	if (Buffer.byteLength(combined, "utf8") <= maxBytes) return combined;
	let tail = combined.slice(-maxBytes);
	while (Buffer.byteLength(tail, "utf8") > maxBytes) tail = tail.slice(1);
	return tail;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}
