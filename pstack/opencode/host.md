# pstack in OpenCode

Apply this guide to every pstack skill, playbook, and delegated task in OpenCode.
It supplies the OpenCode behavior for shared instructions that name Cursor or
Codex features. Session instructions govern permissions, delegation, model
selection, and external actions.

## Skills and tools

Use `PSTACK_ROOT` from the installed-package section to locate shared resources.
Resolve skills as `PSTACK_ROOT/skills/<name>/SKILL.md`, and resolve relative
references from the skill's own directory. Packaged skill IDs are `pstack:<name>`.
Use that ID when loading a skill through OpenCode. If it is absent from a
restricted catalog, read the absolute file instead and apply this guide.

Inspect the tools exposed in the active session before dispatch:

| Shared instruction | OpenCode behavior |
| --- | --- |
| `Task` | Use the native `subagent` tool with its supported parameters. |
| `poteto-agent` | Select the registered `poteto-agent` for implementation and helper tasks. Supply `POTETO_MODE_PATH` and `HOST_GUIDE_PATH`, and require both reads before work. |
| `generalPurpose` | Select an available native general or review agent and include this guide in its task. |
| `comment-sicko` | Select the registered `comment-sicko`, provide the scoped files or diff, and request findings only. Its runtime guard allows only local reads, searches, skill loading, web reads, and directory approval checks. |
| `run_in_background: true` | Use `background: true` when supported. Collect completion results before dependent decisions. |
| `AskQuestion` | Use the native question tool. |
| Todo operations | Use an available plan tool, or keep a concise conversation checklist. |
| `readonly` | Use a permission-restricted review agent. A findings-only prompt does not enforce permissions or remove MCP tools. |

When a registered agent is absent from the tool's allowed list, select an
available agent with equivalent permissions and provide the absolute shared
agent file and this guide. Report the substitution. A required independent
review remains incomplete if no suitable native agent is available. A failed
dispatch does not authorize starting another agent runtime through the shell.

Respect the session's concurrency limit. Use separate worktrees or disjoint
files for independent writers. The parent owns the playbook and integration;
delegates receive bounded tasks. Apply the guide to routed skills and to files
read directly, including `poteto-mode` inside child tasks.

For Comment Sicko's `/how` or `/why` investigations, apply their evidence criteria
through permitted source reads and searches. The parent supplies Git history,
runtime results, and read-only MCP evidence when those sources are needed.
Comment Sicko does not delegate or run shell commands. Mark any claim lacking
the required evidence unresolved and request the missing evidence in the report;
do not infer a deletion from an investigation that could not run.

The reviewer permission guard runs after configured rules. It denies shell,
edits, delegation, Code Mode, MCP tools, and other non-read-only actions even
when a broader configuration allows them. Existing read denials and approval
requirements remain in force. Other agents retain their configured permissions.

## Models and setup

The installed-package section includes the validated `options.models` mapping
from the configured plugin entry. Its role labels match the shared
`setup-pstack` skill. Each value is a provider-qualified model ID, optionally
with `#variant`, or a list for a panel. `auto` and `inherit-parent` retain the
native agent or parent model. An absent role inherits OpenCode's agent settings;
Cursor's default model slugs and reasoning-suffix substitutions do not apply.

For a configured role, pass its explicit model only when the native delegation
tool supports model selection and the session authorizes the override. Preserve
panel entry counts, including inheritance entries. Report actual model diversity.
If the tool cannot select a configured model, report the limitation before
proceeding. Required multi-model comparisons need distinct available models.

For `setup-pstack`, use this procedure instead of the shared Cursor steps:

1. Inspect the active model-discovery tool or OpenCode's model API. Enumerate
   exact available provider-qualified IDs and their supported variants.
2. Read the existing plugin entry and its `options.models` mapping in the
   applicable OpenCode JSON or JSONC configuration. Preserve other settings.
3. Ask which roles and panels to configure. Offer verified IDs and the
   inheritance aliases. Offer supported reasoning variants directly.
4. Show the proposed role mapping and obtain confirmation before saving it.
5. Update only `options.models` on the existing bundle or standalone pstack
   entry. Convert a string entry to `{ "package": <existing source>, "options":
   { "models": <confirmed mapping> } }` when needed. Preserve other options.
6. Check the live plugin status after configuration reload. Report any invalid
   model or loading failure. Confirm the saved choices by reading the file.

Use the shared skill's role labels and panel list lengths. Model selection does
not require creating or changing `~/.cursor/rules/pstack-models.mdc`. Installing
this plugin does not change the user's model choices or global permissions.

## Mode and host services

Invoke `/poteto-mode` in the primary conversation. It remains a conversation
instruction until the user opts out; reinvoke it in a fresh session. OpenCode
does not implement Cursor's `mode`, `reminder`, `icon`, `color`, or `paths`
skill metadata, and this plugin adds no persistent mode hook or `/loop` scheduler.

Use a native recall tool before searching transcript files. Cursor transcript
paths, cloud workers, `cloud_base_branch`, and `cursor://` links apply only to
Cursor. Report missing history or cloud capabilities when a task needs them.

Resolve external skills such as `deslop`, `control-ui`, `control-cli`, and skill
authoring from the active catalog. Use an equivalent only when it satisfies the
step, and name the substitution. Missing verification or independent review
remains incomplete. MCP services require their own installation and sign-in;
the plugin does not configure them. Reviewers use only read-only external
operations permitted by the session.
