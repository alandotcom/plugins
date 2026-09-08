# pstack for Pi

This directory contains the initial Pi adapter for pstack. The adapter reads the existing files in `pstack/skills` and `pstack/agents`. Those files remain the authoritative source.

## Start Pi with the adapter

From the repository root, run:

```bash
pi -e ./pstack/pi/index.ts
```

This command loads the adapter for the current Pi process without registering an installation. The root `package.json` also declares this adapter as the package's only Pi extension. Pi does not load the OpenCode entry point.

## Use Poteto mode

Use these commands:

```text
/poteto-mode on
/poteto-mode off
/poteto-mode status
/poteto-mode <task>
```

`/poteto-mode <task>` waits for the current agent run to settle, enables the mode, and submits the task. Mode-changing commands also wait before changing branch state. The mode state is stored as a custom entry on the current Pi session branch. `/poteto-mode status` only reports state and does not interrupt or reset an active run.

Pi restores the state when you resume a session or switch sessions. Pi also restores the state when you move to another point with `/tree`. A branch before the enable entry stays off.

You can also disable an active mode by sending one of these complete, case-insensitive messages:

```text
stop using poteto mode
turn off poteto mode
exit poteto-mode
```

A final period or exclamation mark is allowed. This matching is intentionally narrow. The adapter does not treat quoted phrases, longer requests, or text such as `explain how to turn off poteto mode` as a mode change. The disabled state persists on the current branch. On later turns, the adapter instructs the model to disregard earlier Poteto-mode instructions.

On each active turn, the adapter adds the canonical `poteto-mode` instructions to the Pi system prompt. It also adds Pi-specific translations for Cursor concepts.

## Run a pstack skill

The adapter registers each canonical skill under a pstack namespace. For example:

```text
/pstack:architect design the cache boundary
/pstack:tdd fix the parser regression
/pstack:no-comments review this diff
```

The namespaced commands prevent collisions with Pi skills that use names such as `tdd` or `recall`. Each command reads the canonical `SKILL.md` when you invoke it. Relative references continue to resolve from the canonical skill directory.

The adapter also provides `/pstack:poteto-mode` and `/pstack:setup-pstack` aliases.

## Set up pstack in Pi

Run either command:

```text
/setup-pstack
/pstack:setup-pstack
```

The command reports the current Pi model and whether the `subagent` tool is active. It does not write user or project configuration. It never reads or writes `~/.cursor/rules/pstack-models.mdc`.

Use Pi's built-in `/model` command to select the model for the current session.

## Capability translations

The adapter applies these translations while Poteto mode is active and inside namespaced skill prompts:

- Cursor `Task` calls use Pi's existing `subagent` tool when the tool is active.
- Parallel Task calls use the tool's parallel mode when that mode exists.
- `AskQuestion` uses an active Pi question tool, such as `ask_async`, when one exists.
- Todo operations use an active Pi todo tool when one exists. Otherwise, the agent keeps a text checklist.
- Cursor model slugs do not become Pi model names. Pi keeps its selected model and registered agent behavior.
- The canonical Arena skill can use the `pstack_arena_run` tool for one isolated runner or judge child at a time. Runner artifacts stay in a retained temporary directory, and the parent remains responsible for selection, grafting, and verification.

The adapter changes a child task only when the parent adds an explicit profile marker:

- `[pstack-agent:poteto]` selects the Poteto profile for an implementing delegate.
- `[pstack-agent:comment-sicko]` selects Comment Sicko for the comment review in the `no-comments` workflow.

Normal reviewers, researchers, and explorers keep their registered Pi roles without an injected Poteto profile. The adapter keeps the selected agent, leaves its tool permissions unchanged, and instructs the child to respect that agent's role. Each opted-in child receives absolute paths to the canonical pstack files plus instructions to translate Cursor concepts using only the tools available in that child session. This works when the child has an empty Pi skill registry but can read the package files.

The adapter uses only agent names exposed by Pi's host instructions or the active tool. If Pi does not expose a real agent name, the agent reports that delegation is unavailable. A direct namespaced command such as `/pstack:tdd` loads that skill only. It does not enable Poteto mode.

## Current limits

This initial adapter has these limits:

- It does not register pstack agents with Pi.
- It does not replace Pi's `subagent` tool for ordinary pstack delegation.
- It does not install or configure the Pi `subagent` tool.
- It does not support pstack role-to-model configuration.
- It does not emulate Cursor cloud workers, background Task calls, or `cloud_base_branch`.
- It does not add a new approval step. Existing Pi tool and project trust controls still apply.
- Namespaced skill commands are user commands. A running agent reads routed pstack skills from `pstack/skills` instead of invoking slash commands.

Pi's `subagent` tool runs in a separate process and returns its result to the parent. If the tool is absent, pstack continues locally when the work remains coherent and reports the missing delegation capability.

## Development checks

Use Node.js 24 or later. From the repository root, install the local development dependencies:

```bash
npm ci --ignore-scripts
```

This command provides TypeScript, Node types, and Pi API types for development. It does not register the plugin with either host.
The editor uses `pstack/pi/tsconfig.json` to check the adapter against Pi's API types.

Run both checks:

```bash
npm run typecheck:pi
npm run test:pi
```

The tests use Node's built-in runner. They do not call a model or change global host configuration.
An integration test starts Pi with temporary configuration and loads the repository through its root manifest.
It checks command registration, mode controls, session reset, and isolation from the OpenCode entry point.
The other tests cover busy-session sequencing, branch state, conversational opt-out, skill prompts, and child profiles for single, parallel, and chained delegation.

The adapter still needs testing with live model workflows before full pstack compatibility can be claimed.
