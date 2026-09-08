import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerArenaTool } from "./arena/index.ts";
import {
	MODE_STATE_TYPE,
	SKILL_RUN_MARKER,
	adaptSubagentInput,
	buildHostInstructions,
	buildSkillInvocation,
	isExplicitModeOptOut,
	parseModeCommand,
	restoreModeSetting,
	type ToolMetadata,
} from "./core.ts";

const piDirectory = dirname(fileURLToPath(import.meta.url));
const pstackDirectory = dirname(piDirectory);
const skillsDirectory = join(pstackDirectory, "skills");
const potetoModePath = join(skillsDirectory, "poteto-mode", "SKILL.md");
const potetoAgentPath = join(pstackDirectory, "agents", "poteto-agent.md");
const commentSickoPath = join(pstackDirectory, "agents", "comment-sicko.md");
const potetoMode = readFileSync(potetoModePath, "utf8");
const potetoAgent = readFileSync(potetoAgentPath, "utf8");
const commentSicko = readFileSync(commentSickoPath, "utf8");

export default function pstackPi(pi: ExtensionAPI): void {
	registerArenaTool(pi);

	let modeEnabled = false;
	let modeExplicitlyDisabled = false;
	let currentRunUsesPstack = false;

	const getHostInstructions = (ctx: ExtensionContext): string =>
		buildHostInstructions({
			tools: pi.getAllTools() as ToolMetadata[],
			activeToolNames: pi.getActiveTools(),
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			skillsDirectory,
		});

	const updateStatus = (ctx: ExtensionContext): void => {
		ctx.ui.setStatus("pstack-poteto-mode", modeEnabled ? "poteto-mode: on" : undefined);
	};

	const setMode = (enabled: boolean, ctx: ExtensionContext): void => {
		modeEnabled = enabled;
		modeExplicitlyDisabled = !enabled;
		pi.appendEntry(MODE_STATE_TYPE, { enabled });
		updateStatus(ctx);
	};

	const handleMode = async (rawArgs: string, ctx: ExtensionCommandContext): Promise<void> => {
		const command = parseModeCommand(rawArgs);
		if (command.kind === "status") {
			ctx.ui.notify(`poteto-mode is ${modeEnabled ? "on" : "off"}.`, "info");
			return;
		}
		await ctx.waitForIdle();
		if (command.kind === "set") {
			setMode(command.enabled, ctx);
			ctx.ui.notify(`poteto-mode ${command.enabled ? "enabled" : "disabled"}.`, "info");
			return;
		}
		setMode(true, ctx);
		pi.sendUserMessage(command.task);
	};

	pi.registerCommand("poteto-mode", {
		description: "Enable, disable, inspect, or run a task with pstack's Poteto mode",
		handler: handleMode,
	});
	pi.registerCommand("pstack:poteto-mode", {
		description: "Namespaced alias for /poteto-mode",
		handler: handleMode,
	});

	const handleSetup = async (_args: string, ctx: ExtensionContext): Promise<void> => {
		const subagentAvailable = pi.getActiveTools().includes("subagent");
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
		ctx.ui.notify(
			[
				"pstack Pi adapter is ready.",
				`Current model: ${model}. Change it with /model.`,
				`Delegation: ${subagentAvailable ? "Pi subagent tool available" : "unavailable in this session"}.`,
				"Per-role model configuration is not supported by this initial adapter.",
				"No user or project configuration was changed.",
			].join("\n"),
			"info",
		);
	};

	pi.registerCommand("setup-pstack", {
		description: "Show safe Pi-specific pstack setup and capability status",
		handler: handleSetup,
	});
	pi.registerCommand("pstack:setup-pstack", {
		description: "Namespaced alias for Pi-specific pstack setup",
		handler: handleSetup,
	});

	for (const skillName of discoverCanonicalSkillNames()) {
		if (skillName === "poteto-mode" || skillName === "setup-pstack") continue;
		pi.registerCommand(`pstack:${skillName}`, {
			description: `Run the canonical pstack ${skillName} skill through the Pi adapter`,
			handler: async (args, ctx) => {
				await ctx.waitForIdle();
				const skillDirectory = join(skillsDirectory, skillName);
				const canonicalContent = readFileSync(join(skillDirectory, "SKILL.md"), "utf8");
				pi.sendUserMessage(
					buildSkillInvocation({
						name: skillName,
						skillDirectory,
						canonicalContent,
						args,
						hostInstructions: getHostInstructions(ctx),
					}),
				);
			},
		});
	}

	const restoreSelectedBranch = (ctx: ExtensionContext): void => {
		const restoredMode = restoreModeSetting(ctx.sessionManager.getBranch());
		modeEnabled = restoredMode ?? false;
		modeExplicitlyDisabled = restoredMode === false;
		currentRunUsesPstack = false;
		updateStatus(ctx);
	};

	pi.on("session_start", async (_event, ctx) => restoreSelectedBranch(ctx));
	pi.on("session_tree", async (_event, ctx) => restoreSelectedBranch(ctx));

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || !isExplicitModeOptOut(event.text)) return;
		setMode(false, ctx);
		currentRunUsesPstack = false;
		ctx.ui.notify("poteto-mode disabled.", "info");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		currentRunUsesPstack = modeEnabled || event.prompt.includes(SKILL_RUN_MARKER);
		if (modeEnabled) {
			return {
				systemPrompt: [
					event.systemPrompt,
					getHostInstructions(ctx),
					"# Canonical poteto-mode skill",
					`Canonical skill directory: ${dirname(potetoModePath)}`,
					"Resolve every relative path in the canonical skill from that directory.",
					potetoMode,
				].join("\n\n"),
			};
		}
		if (modeExplicitlyDisabled) {
			return {
				systemPrompt: [
					event.systemPrompt,
					"# pstack mode state",
					"Poteto mode is disabled. Earlier Poteto-mode instructions in conversation history are inactive. Follow the current user request and any explicitly invoked canonical skill without applying Poteto mode.",
				].join("\n\n"),
			};
		}
	});

	pi.on("tool_call", async (event) => {
		if (!currentRunUsesPstack || event.toolName !== "subagent") return;
		adaptSubagentInput(event.input, {
			potetoAgent,
			commentSicko,
			potetoAgentPath,
			commentSickoPath,
			potetoModePath,
			skillsDirectory,
		});
	});

	pi.on("agent_settled", async () => {
		currentRunUsesPstack = false;
	});
}

function discoverCanonicalSkillNames(): string[] {
	return readdirSync(skillsDirectory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.filter((entry) => {
			try {
				readFileSync(join(skillsDirectory, entry.name, "SKILL.md"), "utf8");
				return true;
			} catch {
				return false;
			}
		})
		.map((entry) => entry.name)
		.sort();
}
