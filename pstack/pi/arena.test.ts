import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { registerArenaTool } from "./arena/index.ts";

interface RegisteredTool {
	name: string;
	description: string;
	executionMode?: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: ((result: any) => void) | undefined,
		ctx: any,
	) => Promise<any>;
}

async function createHarness() {
	const root = await mkdtemp(join(tmpdir(), "pstack-arena-test-"));
	const sourceProject = join(root, "source");
	await mkdir(sourceProject);
	const fakeCli = join(root, "fake-pi.mjs");
	await writeFile(
		fakeCli,
		`import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const promptPaths = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--append-system-prompt") promptPaths.push(args[index + 1]);
}
const prompts = await Promise.all(promptPaths.map((path) => readFile(path, "utf8")));
const invocation = { args, promptPaths, prompts, pid: process.pid };
if (prompts.at(-1)?.includes("HANG")) {
  const inherited = prompts.at(-1)?.includes("HANG_INHERITED");
  const ignoresTermination = prompts.at(-1)?.includes("HANG_IGNORE_STDIO");
  const needsReady = inherited || ignoresTermination;
  const readyPath = join(process.cwd(), "grandchild-ready");
  const grandchildCode = inherited || ignoresTermination
    ? "import { writeFile } from 'node:fs/promises'; process.on('SIGTERM', () => {}); await writeFile(process.argv[1], 'ready'); setInterval(() => {}, 1000)"
    : "setInterval(() => {}, 1000)";
  const grandchild = spawn(
    process.execPath,
    ["--input-type=module", "-e", grandchildCode, readyPath],
    { stdio: inherited ? ["ignore", "inherit", "inherit"] : "ignore" },
  );
  if (needsReady) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await readFile(readyPath, "utf8");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }
  invocation.grandchildPid = grandchild.pid;
  await writeFile(join(process.cwd(), "invocation.json"), JSON.stringify(invocation));
  if (prompts.at(-1)?.includes("EXIT_BEFORE_ABORT")) process.exit(0);
  setInterval(() => {}, 1000);
} else {
  await writeFile(join(process.cwd(), "invocation.json"), JSON.stringify(invocation));
  await writeFile(join(process.cwd(), "candidate.md"), "candidate artifact\\n");
  const response = prompts.at(-1)?.includes("LARGE") ? "x".repeat(60 * 1024) : "Independent final response";
  console.log(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: response }],
      stopReason: "stop",
    },
  }));
  if (prompts.at(-1)?.includes("FAIL")) {
    process.stderr.write("fixture failure\\n");
    process.exitCode = 7;
  }
}
`,
		"utf8",
	);

	const tools = new Map<string, RegisteredTool>();
	const pi = {
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
	};
	registerArenaTool(pi as any, { cliPath: fakeCli, tempRoot: root, killGraceMs: 50 });

	const knownModels = new Map([
		["test/current", { provider: "test", id: "current" }],
		["other/judge", { provider: "other", id: "judge" }],
	]);
	const context = {
		cwd: sourceProject,
		model: knownModels.get("test/current"),
		modelRegistry: {
			find(provider: string, id: string) {
				return knownModels.get(`${provider}/${id}`);
			},
			getAvailable() {
				return [...knownModels.values()];
			},
			async getApiKeyAndHeaders(model: { provider: string; id: string }) {
				return knownModels.has(`${model.provider}/${model.id}`)
					? { ok: true, apiKey: "test-secret" }
					: { ok: false, error: "missing auth" };
			},
		},
	};

	return {
		root,
		sourceProject,
		context,
		tool: tools.get("pstack_arena_run")!,
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

async function waitForFile(path: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			await access(path);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	throw new Error(`Timed out waiting for ${path}`);
}

async function waitForProcessExit(pid: number): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
			throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Process ${pid} remained alive after cancellation.`);
}

test("registers one bounded Arena child tool and keeps repeated runner attempts isolated", async (t) => {
	const harness = await createHarness();
	t.after(harness.cleanup);

	assert.equal(harness.tool.name, "pstack_arena_run");
	assert.equal(harness.tool.executionMode, "parallel");
	assert.match(harness.tool.description, /one fresh Pi child/i);
	assert.match(harness.tool.description, /does not create git worktrees/i);
	assert.match(harness.tool.description, /not a sandbox/i);

	const first = await harness.tool.execute("one", { role: "runner", task: "make the artifact" }, undefined, undefined, harness.context);
	const second = await harness.tool.execute("two", { role: "runner", task: "make the artifact" }, undefined, undefined, harness.context);

	assert.equal(first.details.status, "completed");
	assert.equal(first.details.finalResponse, "Independent final response");
	assert.equal(first.details.exitCode, 0);
	assert.notEqual(first.details.outputDirectory, second.details.outputDirectory);
	assert.equal(await readFile(join(first.details.outputDirectory, "candidate.md"), "utf8"), "candidate artifact\n");
	assert.ok(first.details.artifactPaths.includes("candidate.md"));

	const invocation = JSON.parse(await readFile(join(first.details.outputDirectory, "invocation.json"), "utf8"));
	assert.deepEqual(invocation.args.slice(0, 4), ["--mode", "json", "--print", "--no-session"]);
	assert.ok(invocation.args.includes("test/current"));
	assert.ok(invocation.args.includes("read,bash,edit,write,grep,find,ls"));
	assert.ok(invocation.args.includes("--offline"));
	assert.ok(invocation.args.includes("--no-extensions"));
	assert.ok(invocation.args.includes("--no-context-files"));
	assert.ok(!invocation.args.includes("--api-key"));
	assert.match(invocation.prompts[0], /# Arena runner/);
	assert.match(invocation.prompts[1], new RegExp(harness.sourceProject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(invocation.prompts[1], /artifact-only mode/i);
	await access(invocation.promptPaths[0]);
	await assert.rejects(access(invocation.promptPaths[1]), { code: "ENOENT" });
});

test("judge receives completed candidate directories and has no mutation or shell tools", async (t) => {
	const harness = await createHarness();
	t.after(harness.cleanup);
	const candidateOne = join(harness.root, "candidate-one");
	const candidateTwo = join(harness.root, "candidate-two");
	await mkdir(candidateOne);
	await mkdir(candidateTwo);
	await writeFile(join(candidateOne, "answer.md"), "one");
	await writeFile(join(candidateTwo, "answer.md"), "two");

	const result = await harness.tool.execute(
		"judge",
		{
			role: "judge",
			task: "Score correctness and maintainability from 1-5.",
			model: { provider: "other", id: "judge" },
			candidatePaths: [candidateOne, candidateTwo],
		},
		undefined,
		undefined,
		harness.context,
	);

	assert.equal(result.details.model, "other/judge");
	assert.deepEqual(result.details.candidatePaths, [await realpath(candidateOne), await realpath(candidateTwo)]);
	const invocation = JSON.parse(await readFile(join(result.details.outputDirectory, "invocation.json"), "utf8"));
	assert.ok(invocation.args.includes("read,grep,find,ls"));
	assert.ok(!invocation.args.some((arg: string) => arg.includes("bash") || arg.includes("edit") || arg.includes("write")));
	assert.match(invocation.prompts[0], /# Arena judge/);
	assert.match(invocation.prompts[1], /Score correctness and maintainability/);
	assert.match(invocation.prompts[1], /candidate-one/);
});

test("truncates model-visible output and retains the full final response", async (t) => {
	const harness = await createHarness();
	t.after(harness.cleanup);

	const result = await harness.tool.execute(
		"large",
		{ role: "runner", task: "LARGE response" },
		undefined,
		undefined,
		harness.context,
	);

	assert.equal(result.details.status, "completed");
	assert.equal(result.details.truncated.finalResponse, true);
	assert.ok(Buffer.byteLength(result.details.finalResponse, "utf8") <= 50 * 1024);
	assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= 50 * 1024);
	assert.equal((await readFile(result.details.finalResponsePath, "utf8")).length, 60 * 1024);
	assert.match(result.content[0].text, /Final response truncated/);
});

test("returns child failure diagnostics without discarding produced artifacts", async (t) => {
	const harness = await createHarness();
	t.after(harness.cleanup);

	const result = await harness.tool.execute(
		"failure",
		{ role: "runner", task: "FAIL after producing an artifact" },
		undefined,
		undefined,
		harness.context,
	);

	assert.equal(result.details.status, "failed");
	assert.equal(result.details.exitCode, 7);
	assert.equal(result.details.stderr, "fixture failure\n");
	assert.equal(result.details.finalResponse, "Independent final response");
	assert.ok(result.details.artifactPaths.includes("candidate.md"));
});

test("rejects unresolved models, unavailable auth, and invalid judge paths before spawning", async (t) => {
	const harness = await createHarness();
	t.after(harness.cleanup);

	await assert.rejects(
		harness.tool.execute(
			"bad-model",
			{ role: "runner", task: "x", model: { provider: "cursor", id: "claude-fable-5-1-thinking-max" } },
			undefined,
			undefined,
			harness.context,
		),
		/available Pi model/i,
	);
	const originalAuth = harness.context.modelRegistry.getApiKeyAndHeaders;
	harness.context.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false, error: "expired credential" });
	await assert.rejects(
		harness.tool.execute(
			"bad-auth",
			{ role: "runner", task: "x", model: { provider: "other", id: "judge" } },
			undefined,
			undefined,
			harness.context,
		),
		/authentication is unavailable.*expired credential/i,
	);
	harness.context.modelRegistry.getApiKeyAndHeaders = originalAuth;
	await assert.rejects(
		harness.tool.execute(
			"bad-path",
			{ role: "judge", task: "x", candidatePaths: [join(harness.root, "missing")] },
			undefined,
			undefined,
			harness.context,
		),
		/Candidate directory/i,
	);
});

test("cancellation terminates the child process group, retains output, and removes prompts", { timeout: 5_000 }, async (t) => {
	if (process.platform === "win32") {
		t.skip("POSIX process-group assertion");
		return;
	}
	const harness = await createHarness();
	t.after(harness.cleanup);
	const controller = new AbortController();
	let outputDirectory: string | undefined;
	const run = harness.tool.execute(
		"cancel",
		{ role: "runner", task: "HANG until cancelled" },
		controller.signal,
		(update) => {
			outputDirectory = update.details?.outputDirectory;
		},
		harness.context,
	);

	for (let attempt = 0; attempt < 100 && !outputDirectory; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.ok(outputDirectory);
	const invocationPath = join(outputDirectory, "invocation.json");
	await waitForFile(invocationPath);
	const invocation = JSON.parse(await readFile(invocationPath, "utf8"));
	t.after(() => {
		for (const pid of [invocation.pid, invocation.grandchildPid]) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// The cancellation path already reaped the process.
			}
		}
	});
	controller.abort();
	const result = await run;

	assert.equal(result.details.status, "cancelled");
	assert.equal(result.details.cancelled, true);
	assert.equal(result.details.outputDirectory, outputDirectory);
	await access(invocation.promptPaths[0]);
	await assert.rejects(access(invocation.promptPaths[1]), { code: "ENOENT" });
	await waitForProcessExit(invocation.grandchildPid);
});

test("escalates SIGKILL to descendants after the leader exits on SIGTERM", { timeout: 5_000 }, async (t) => {
	if (process.platform === "win32") {
		t.skip("POSIX process-group assertion");
		return;
	}
	const harness = await createHarness();
	t.after(harness.cleanup);
	const controller = new AbortController();
	let outputDirectory: string | undefined;
	const run = harness.tool.execute(
		"cancel-inherited",
		{ role: "runner", task: "HANG_INHERITED until cancelled" },
		controller.signal,
		(update) => {
			outputDirectory = update.details?.outputDirectory;
		},
		harness.context,
	);

	for (let attempt = 0; attempt < 100 && !outputDirectory; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.ok(outputDirectory);
	const invocationPath = join(outputDirectory, "invocation.json");
	await waitForFile(invocationPath);
	const invocation = JSON.parse(await readFile(invocationPath, "utf8"));
	const killFixture = () => {
		for (const pid of [invocation.pid, invocation.grandchildPid]) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// The process may already have exited.
			}
		}
	};
	t.after(killFixture);
	controller.abort();

	const outcome = await Promise.race([
		run.then((result) => ({ kind: "result" as const, result })),
		new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 1_000)),
	]);
	if (outcome.kind === "timeout") {
		killFixture();
		await run;
		assert.fail("Arena cancellation did not close after killing the descendant process group");
	}

	assert.equal(outcome.result.details.status, "cancelled");
	await waitForProcessExit(invocation.grandchildPid);
});

test("keeps escalation armed after the leader closes with ignored descendant stdio", { timeout: 5_000 }, async (t) => {
	if (process.platform === "win32") {
		t.skip("POSIX process-group assertion");
		return;
	}
	const harness = await createHarness();
	t.after(harness.cleanup);
	const controller = new AbortController();
	let outputDirectory: string | undefined;
	const run = harness.tool.execute(
		"cancel-ignore-stdio",
		{ role: "runner", task: "HANG_IGNORE_STDIO until cancelled" },
		controller.signal,
		(update) => {
			outputDirectory = update.details?.outputDirectory;
		},
		harness.context,
	);

	for (let attempt = 0; attempt < 100 && !outputDirectory; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.ok(outputDirectory);
	const invocationPath = join(outputDirectory, "invocation.json");
	await waitForFile(invocationPath);
	const invocation = JSON.parse(await readFile(invocationPath, "utf8"));
	t.after(() => {
		for (const pid of [invocation.pid, invocation.grandchildPid]) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// The process may already have exited.
			}
		}
	});
	controller.abort();

	const result = await run;
	assert.equal(result.details.status, "cancelled");
	await waitForProcessExit(invocation.grandchildPid);
});

test("a parent exiting naturally after cancellation leaves no Arena descendants", { timeout: 5_000 }, async (t) => {
	if (process.platform === "win32") {
		t.skip("POSIX process-group assertion");
		return;
	}
	const harness = await createHarness();
	const recordPath = join(harness.root, "subprocess-invocation.json");
	t.after(async () => {
		try {
			const invocation = JSON.parse(await readFile(recordPath, "utf8"));
			for (const pid of [invocation.pid, invocation.grandchildPid]) {
				try { process.kill(pid, "SIGKILL"); } catch {}
			}
		} catch {} finally {
			await harness.cleanup();
		}
	});
	const script = `
import { readFile, writeFile } from 'node:fs/promises';
import { registerArenaTool } from ${JSON.stringify(new URL("./arena/index.ts", import.meta.url).href)};
const root = ${JSON.stringify(harness.root)};
let tool;
registerArenaTool({ registerTool(value) { tool = value; } }, {
  cliPath: root + '/fake-pi.mjs', tempRoot: root, killGraceMs: 200,
});
const model = { provider: 'test', id: 'current' };
const context = {
  cwd: ${JSON.stringify(harness.sourceProject)}, model,
  modelRegistry: {
    find() { return model; }, getAvailable() { return [model]; },
    async getApiKeyAndHeaders() { return { ok: true, apiKey: 'test-secret' }; },
  },
};
const controller = new AbortController();
let directory;
const run = tool.execute('natural-exit', { role: 'runner', task: 'HANG_IGNORE_STDIO' },
  controller.signal, result => { directory = result.details?.outputDirectory; }, context);
let invocation;
while (!invocation) {
  try { invocation = JSON.parse(await readFile(directory + '/invocation.json', 'utf8')); }
  catch { await new Promise(resolve => setTimeout(resolve, 10)); }
}
await writeFile(${JSON.stringify(recordPath)}, JSON.stringify(invocation));
controller.abort();
await run;
`;
	await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { timeout: 3_000 });
	const invocation = JSON.parse(await readFile(recordPath, "utf8"));
	await waitForProcessExit(invocation.grandchildPid);
});

test("escalates when cancellation follows a leader exit with inherited pipes", { timeout: 5_000 }, async (t) => {
	if (process.platform === "win32") {
		t.skip("POSIX process-group assertion");
		return;
	}
	const harness = await createHarness();
	t.after(harness.cleanup);
	const controller = new AbortController();
	let outputDirectory: string | undefined;
	const run = harness.tool.execute(
		"cancel-after-exit",
		{ role: "runner", task: "HANG_INHERITED EXIT_BEFORE_ABORT" },
		controller.signal,
		(update) => {
			outputDirectory = update.details?.outputDirectory;
		},
		harness.context,
	);

	for (let attempt = 0; attempt < 100 && !outputDirectory; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.ok(outputDirectory);
	const invocationPath = join(outputDirectory, "invocation.json");
	await waitForFile(invocationPath);
	const invocation = JSON.parse(await readFile(invocationPath, "utf8"));
	t.after(() => {
		for (const pid of [invocation.pid, invocation.grandchildPid]) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// The process may already have exited.
			}
		}
	});
	await new Promise((resolve) => setTimeout(resolve, 100));
	controller.abort();

	const outcome = await Promise.race([
		run.then((result) => ({ kind: "result" as const, result })),
		new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 1_000)),
	]);
	if (outcome.kind === "timeout") {
		for (const pid of [invocation.pid, invocation.grandchildPid]) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// The process may already have exited.
			}
		}
		await run;
		assert.fail("Arena cancellation did not close after the leader exited");
	}

	assert.equal(outcome.result.details.status, "cancelled");
	await waitForProcessExit(invocation.grandchildPid);
});
