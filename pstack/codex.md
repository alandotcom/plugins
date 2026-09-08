# pstack in Codex

Apply this guide to every pstack skill, playbook, and delegated task in Codex.
Use its translations in place of shared instructions that name Cursor features. Follow
the session's system, developer, and user instructions for permissions, model
selection, delegation, and external actions.

## Skills and tools

Resolve pstack skills from this file's sibling `skills/` directory. Read a
routed skill's `SKILL.md` directly, including user-invoked skills. Resolve each
skill's relative references from that skill's directory. Use absolute paths in
child tasks so the installed cache works from any project.

Use the tools exposed in the current session:

| Shared instruction | Codex behavior |
| --- | --- |
| `Task` or a named subagent | Use `spawn_agent` when available. Select a registered role that fits the task; otherwise use the default role with an explicit task. |
| `run_in_background: true` | Spawn independent children before collecting their results. Use the session's completion notifications or wait tool. |
| `AskQuestion` | Use an available question tool in its supported mode, or ask one concise question in prose. |
| Todo operations | Use the session's plan tool when available; otherwise keep a short task checklist. |
| Cursor model slugs | Inherit the host model by default. Apply overrides only when supported and authorized by the session. |
| `readonly` | Require findings only and prohibit edits in the child task; use a read-only role or sandbox when available. A prompt alone is not a permission boundary. |

Use only parameters accepted by the active tool. Codex does not obtain custom
agent types from this plugin's `agents/*.md` files. For an implementation task
requiring `poteto-agent`, pass the absolute paths to `agents/poteto-agent.md`,
`skills/poteto-mode/SKILL.md`, and this guide, and require the child to read them.
For Comment Sicko, pass `agents/comment-sicko.md` and this guide. Apply the
profile's body as task instructions; retain the selected host role and permissions.
Pass this guide and the relevant skill path to other pstack delegates as well.

Respect the session's concurrency limit. Run larger panels in batches. Report
whether a panel used one model or several; multiple children using the same
model do not establish model diversity. Keep independent writers in separate
worktrees or disjoint files, and collect results before making dependent decisions.

If delegation is unavailable, continue locally where independence is optional.
For a required independent review or candidate comparison, report the missing
capability and leave that step incomplete. A failed dispatch does not authorize
launching another agent runtime through the shell.

## Setup and mode

For `setup-pstack`, report the available delegation and question tools, the
active model if exposed, and any capability limits. Then stop the setup workflow.
Model selection belongs to Codex's model picker and registered agent settings.
The Cursor setup steps and `~/.cursor/rules/pstack-models.mdc` apply only to Cursor.
Do not create or change that file from Codex.

`poteto-mode` stays active through conversation instructions until the user opts
out. Codex does not implement Cursor's `mode`, `reminder`, or `/loop` metadata,
and this plugin adds no persistent mode state or scheduled execution. Reinvoke
the skill in a new thread when needed.

## Host-specific services

Use a recall tool exposed by the session before searching transcripts. Cursor's
transcript paths, cloud workers, `cloud_base_branch`, and `cursor://` links apply
only to Cursor. If a task requires unavailable history or cloud execution,
report the limitation and request the specific missing context when necessary.

Resolve external skills such as `deslop`, `control-ui`, and `control-cli` from
the active skill catalog. For Cursor's `create-skill`, use an available skill
authoring skill. If a dependency is missing, use an available equivalent only
when it satisfies the step, and state the substitution. Never claim that a
missing verification or review ran. Optional MCP services require their own
installation and authentication; this plugin does not configure them.
