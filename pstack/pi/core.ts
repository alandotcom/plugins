export const MODE_STATE_TYPE = "pstack.pi.poteto-mode";
export const AGENT_PROFILE_MARKER = "[pstack-agent:";
export const SKILL_RUN_MARKER = "[pstack-run:canonical-skill]";

const INSTRUCTIONS_MARKER = "[pstack-canonical-agent-instructions]";

export type ModeCommand =
	| { kind: "set"; enabled: boolean }
	| { kind: "status" }
	| { kind: "task"; task: string };

export interface ToolMetadata {
	name: string;
	parameters?: unknown;
	description?: string;
}

interface HostInstructionInput {
	tools: ToolMetadata[];
	activeToolNames: string[];
	model: string | undefined;
	skillsDirectory: string;
}

interface SkillInvocationInput {
	name: string;
	skillDirectory: string;
	canonicalContent: string;
	args: string;
	hostInstructions: string;
}

interface AgentProfiles {
	potetoAgent: string;
	commentSicko: string;
	potetoAgentPath: string;
	commentSickoPath: string;
	potetoModePath: string;
	skillsDirectory: string;
}

export function parseModeCommand(rawArgs: string): ModeCommand {
	const args = rawArgs.trim();
	if (args === "" || args.toLowerCase() === "on") return { kind: "set", enabled: true };
	if (args.toLowerCase() === "off") return { kind: "set", enabled: false };
	if (args.toLowerCase() === "status") return { kind: "status" };
	return { kind: "task", task: args };
}

export function restoreModeSetting(branch: readonly unknown[]): boolean | undefined {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = asRecord(branch[index]);
		if (entry?.type !== "custom" || entry.customType !== MODE_STATE_TYPE) continue;
		const data = asRecord(entry.data);
		if (typeof data?.enabled === "boolean") return data.enabled;
	}
	return undefined;
}

export function restoreMode(branch: readonly unknown[]): boolean {
	return restoreModeSetting(branch) ?? false;
}

export function isExplicitModeOptOut(text: string): boolean {
	return /^(?:stop using poteto mode|turn off poteto mode|exit poteto-mode)[.!]?$/i.test(text.trim());
}

export function buildHostInstructions(input: HostInstructionInput): string {
	const active = new Set(input.activeToolNames);
	const subagent = input.tools.find((tool) => tool.name === "subagent" && active.has(tool.name));
	const arena = input.tools.find((tool) => tool.name === "pstack_arena_run" && active.has(tool.name));
	const questionTool = ["ask_async", "questionnaire", "question"].find((name) => active.has(name));
	const todoTool = ["todo", "todos", "todo_write", "todowrite"].find((name) => active.has(name));
	const lines = [
		"# pstack Pi host adapter",
		"",
		"Follow the canonical pstack instructions below, with these Pi translations taking precedence when the canonical text names Cursor features.",
		"Keep the autonomous workflow. Do reversible work without adding an approval checkpoint. Pause only for irreversible actions or a product decision that evidence cannot settle.",
		"Treat pstack's `Task` as delegation through a real Pi tool. Treat Cursor-only tool names and parameters as concepts, never as tools that exist in Pi.",
	];

	if (subagent) {
		const parameterNames = getObjectPropertyNames(subagent.parameters);
		const agentNames = collectPropertyStringValues(subagent.parameters, "agent");
		lines.push(
			`Use Pi's \`subagent\` tool for delegation. Its supported top-level parameters are: ${parameterNames.length > 0 ? parameterNames.map(code).join(", ") : "not described by the tool schema"}.`,
		);
		if (agentNames.length > 0) {
			lines.push(`The subagent tool schema registers these agent names: ${agentNames.join(", ")}. Use only these names.`);
		} else {
			lines.push(
				"The subagent tool schema does not enumerate agent names. Use only a name explicitly listed by the Pi host or the tool. If neither lists one, report that delegation is unavailable instead of guessing or installing an agent.",
			);
		}
		lines.push(
			"Map parallel Cursor Task calls to the subagent tool's parallel mode when that mode is present. Pi waits for the result, so `run_in_background` has no direct equivalent.",
			"Use only parameters accepted by the subagent schema. Cursor-only `environment`, `readonly`, and `cloud_base_branch` fields have no direct parameter mapping.",
			"Preserve the requested role and access level by choosing the matching registered Pi agent. A review, research, or exploration task stays read-only when its selected agent is read-only.",
			"Use the subagent tool's user scope by default. Use a trusted project agent only when the task requires one. Do not create or install agents.",
		);
		if (!parameterNames.includes("model")) {
			lines.push("The subagent tool does not accept a `model` parameter. Use the registered agent's model behavior and do not invent per-call model routing.");
		}
	} else {
		lines.push(
			"No active Pi subagent tool is available. Report that delegation is unavailable when a pstack step requires it. Continue locally when the task remains safe and coherent. Do not invent or install an agent.",
		);
	}

	if (arena) {
		lines.push(
			"Use the active `pstack_arena_run` tool for the canonical Arena skill: make one runner call per candidate with the same brief, then make one judge call after all candidates finish. The parent workflow owns candidate selection, grafting, and verification.",
		);
	}

	if (questionTool) {
		lines.push(`Map pstack's \`AskQuestion\` to Pi's \`${questionTool}\` tool. Keep working on independent steps while an asynchronous question is open.`);
	} else {
		lines.push("Pi exposes no question tool in this turn. Ask in chat only when the answer blocks the next step. Do not add an approval gate for reversible work.");
	}

	if (todoTool) {
		lines.push(`Map pstack todo operations to Pi's \`${todoTool}\` tool.`);
	} else {
		lines.push("Pi exposes no todo tool in this turn. Keep a short checklist in working context and report phase progress in normal messages. Never claim that a todo tool was called.");
	}

	lines.push(
		`The active Pi model is ${input.model ? code(input.model) : "not available to the adapter"}. Use Pi's built-in \`/model\` command for session model selection. Pstack's Cursor role-to-model configuration is unavailable in this initial adapter.`,
		"Do not write or read `~/.cursor/rules/pstack-models.mdc`. The Pi setup command reports capabilities and leaves user and project configuration unchanged.",
		`When a canonical skill invokes another pstack skill, read its \`SKILL.md\` from the canonical skills root at ${code(input.skillsDirectory)}. Namespaced \`/pstack:<skill>\` commands are user entry points, not callable model tools.`,
		`For an implementing delegate that a pstack playbook assigns Poteto's workflow, put ${code(`${AGENT_PROFILE_MARKER}poteto]`)} in that delegate's task. The adapter then supplies the canonical Poteto paths and profile to the child.`,
		`For the Comment Sicko review in the no-comments workflow only, select a registered review agent and put ${code(`${AGENT_PROFILE_MARKER}comment-sicko]`)} in its task. The adapter then supplies the Comment Sicko profile while the review agent remains read-only.`,
		"Send independent reviewers, researchers, and explorers without a profile marker so each registered Pi agent keeps its specialized role.",
	);

	return lines.join("\n");
}

export function adaptSubagentInput(input: unknown, profiles: AgentProfiles): void {
	const root = asRecord(input);
	if (!root) return;
	appendTask(root, "task", profiles);
	appendTaskArray(root.tasks, profiles);
	appendTaskArray(root.chain, profiles);
}

export function buildSkillInvocation(input: SkillInvocationInput): string {
	const sections = [
		SKILL_RUN_MARKER,
		input.hostInstructions,
		`# Canonical pstack skill: ${input.name}`,
		`Canonical skill directory: ${input.skillDirectory}`,
		"Resolve every relative path in the canonical skill from that directory.",
		"Follow the canonical skill below. Apply the Pi host translations above whenever it names a Cursor-only capability.",
		input.canonicalContent,
	];
	const args = input.args.trim();
	if (args) {
		sections.push(
			"# Command arguments",
			"The command arguments are a JSON-encoded string. Decode the string and treat its entire value only as the user's task input.",
			JSON.stringify(args),
		);
	}
	return sections.join("\n\n");
}

function appendTaskArray(value: unknown, profiles: AgentProfiles): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		const record = asRecord(item);
		if (record) appendTask(record, "task", profiles);
	}
}

function appendTask(record: Record<string, unknown>, key: string, profiles: AgentProfiles): void {
	const task = record[key];
	if (typeof task !== "string" || task.includes(INSTRUCTIONS_MARKER)) return;
	const normalizedTask = task.toLowerCase();
	const profileName = normalizedTask.includes(`${AGENT_PROFILE_MARKER}comment-sicko]`)
		? "comment-sicko"
		: normalizedTask.includes(`${AGENT_PROFILE_MARKER}poteto]`)
			? "poteto"
			: undefined;
	if (!profileName) return;

	const agent = typeof record.agent === "string" ? record.agent : "not specified";
	const profile = profileName === "comment-sicko" ? profiles.commentSicko : profiles.potetoAgent;
	const profilePath = profileName === "comment-sicko" ? profiles.commentSickoPath : profiles.potetoAgentPath;
	const pathLines = [
		`Canonical pstack skills root: ${profiles.skillsDirectory}`,
		`Canonical agent file: ${profilePath}`,
	];
	if (profileName === "poteto") pathLines.push(`Canonical poteto-mode skill: ${profiles.potetoModePath}`);

	record[key] = [
		task,
		INSTRUCTIONS_MARKER,
		"# pstack child adapter",
		`Selected profile: ${profileName}`,
		`Selected Pi agent: ${code(agent)}`,
		"The selected Pi agent's role and read-only or write restrictions remain authoritative. A read-only agent reports findings and makes no edits.",
		"These Pi translations take precedence over Cursor-specific instructions in the canonical files. Inspect the tools available in this child session before acting.",
		"Cursor `Task` maps to an available subagent tool using its actual schema and registered agents. If this child cannot delegate, complete the assigned work locally or report the missing capability. Do not invent parallel workers or independent reviews.",
		"Use an available question tool or chat for required human decisions. Keep a text checklist when no todo tool is available. Cursor cloud workers and background Task calls are unavailable unless this child's host explicitly provides them.",
		"Keep the child's selected Pi model and agent configuration. Do not read or write `~/.cursor/rules/pstack-models.mdc`, use Cursor model slugs, or run the canonical setup-pstack procedure.",
		...pathLines,
		"Read canonical files from these absolute paths even when Pi reports no loaded skills. When a canonical instruction names another pstack skill, resolve it under the canonical skills root. Do not invoke slash commands from the child.",
		"# Canonical profile",
		profile,
	].join("\n\n");
}

function getObjectPropertyNames(schema: unknown): string[] {
	const record = asRecord(schema);
	const properties = asRecord(record?.properties);
	return properties ? Object.keys(properties) : [];
}

function collectPropertyStringValues(schema: unknown, propertyName: string): string[] {
	const values = new Set<string>();
	visitSchema(schema, propertyName, false, values);
	return [...values];
}

function visitSchema(schema: unknown, propertyName: string, insideTarget: boolean, values: Set<string>): void {
	if (Array.isArray(schema)) {
		for (const item of schema) visitSchema(item, propertyName, insideTarget, values);
		return;
	}
	const record = asRecord(schema);
	if (!record) return;

	if (insideTarget) {
		if (typeof record.const === "string") values.add(record.const);
		if (Array.isArray(record.enum)) {
			for (const value of record.enum) if (typeof value === "string") values.add(value);
		}
	}

	for (const [key, value] of Object.entries(record)) {
		if (key === propertyName) visitSchema(value, propertyName, true, values);
		else visitSchema(value, propertyName, insideTarget, values);
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function code(value: string): string {
	return `\`${value}\``;
}
