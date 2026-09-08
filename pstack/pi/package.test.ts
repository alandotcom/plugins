import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type RpcMessage = {
	type: string;
	id?: string;
	success?: boolean;
	error?: string;
	method?: string;
	message?: string;
	data?: Record<string, unknown>;
};

const repository = fileURLToPath(new URL("../../", import.meta.url));
const piCli = fileURLToPath(new URL("./bundle/cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));

test("root package loads only pstack into Pi and keeps mode commands local", { timeout: 20_000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "pstack-pi-package-"));
	const child = spawn(process.execPath, [
		piCli, "--mode", "rpc", "--offline", "--no-session", "--no-approve",
		"--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
		"-e", repository,
	], {
		cwd: directory,
		env: { ...process.env, HOME: directory, PI_CODING_AGENT_DIR: join(directory, "agent") },
		stdio: ["pipe", "pipe", "pipe"],
	});
	const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
	t.after(async () => {
		child.kill();
		await closed;
		await rm(directory, { recursive: true, force: true });
	});

	const messages: RpcMessage[] = [];
	const pending = new Map<string, { resolve: (message: RpcMessage) => void; reject: (error: Error) => void }>();
	let buffer = "";
	let stderr = "";
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
	child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
		buffer += chunk;
		let newline: number;
		while ((newline = buffer.indexOf("\n")) !== -1) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (!line) continue;
			let message: RpcMessage;
			try {
				message = JSON.parse(line) as RpcMessage;
			} catch {
				for (const request of pending.values()) request.reject(new Error(`Invalid RPC output: ${line}`));
				return;
			}
			messages.push(message);
			if (message.type === "response" && message.id) pending.get(message.id)?.resolve(message);
		}
	});
	child.on("error", (error) => {
		for (const request of pending.values()) request.reject(error);
	});
	child.on("exit", (code, signal) => {
		for (const request of pending.values()) request.reject(new Error(`Pi exited (${code ?? signal}): ${stderr}`));
	});

	let sequence = 0;
	async function request(type: string, payload: Record<string, unknown> = {}): Promise<RpcMessage> {
		const id = String(++sequence);
		let timer: NodeJS.Timeout;
		try {
			const response = await new Promise<RpcMessage>((resolve, reject) => {
				pending.set(id, { resolve, reject });
				timer = setTimeout(() => reject(new Error(`RPC ${type} timed out: ${stderr}`)), 8_000);
				child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`);
			});
			assert.equal(response.success, true, response.error);
			return response;
		} finally {
			clearTimeout(timer!);
			pending.delete(id);
		}
	}

	const response = await request("get_commands");
	const commands = (response.data?.commands as Array<{
		name: string;
		source: string;
		sourceInfo: { source: string };
	}>).filter(({ sourceInfo }) => sourceInfo.source !== "inline");
	assert.ok(commands.some(({ name }) => name === "poteto-mode"));
	assert.ok(commands.some(({ name }) => name === "pstack:architect"));
	assert.ok(commands.some(({ name }) => name === "setup-pstack"));
	assert.deepEqual(commands.filter(({ name, source }) => source !== "extension" ||
		!(name.startsWith("pstack:") || name === "poteto-mode" || name === "setup-pstack")), []);

	await request("prompt", { message: "/poteto-mode on" });
	await request("prompt", { message: "/poteto-mode status" });
	assert.ok(messages.some(({ method, message }) => method === "notify" && message === "poteto-mode is on."));
	const enabled = await request("get_entries");
	assert.ok((enabled.data?.entries as Array<{ customType?: string; data?: { enabled?: boolean } }>)
		.some((entry) => entry.customType === "pstack.pi.poteto-mode" && entry.data?.enabled === true));

	await request("prompt", { message: "/poteto-mode off" });
	await request("prompt", { message: "/setup-pstack" });
	assert.ok(messages.some(({ method, message }) => method === "notify" && message?.includes("No user or project configuration was changed.")));
	await request("new_session");
	await request("prompt", { message: "/poteto-mode status" });
	assert.ok(messages.some(({ method, message }) => method === "notify" && message === "poteto-mode is off."));
	assert.ok(!messages.some(({ type }) => type === "agent_start" || type === "extension_error"));
	assert.equal(stderr, "");

	const manifest = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
	assert.equal(manifest.main, "./thermos/opencode/index.js");
	await assert.rejects(readFile(join(directory, ".cursor/rules/pstack-models.mdc")), { code: "ENOENT" });
});
