# Thermos in Codex

Use this guide in place of the workflow's Cursor, Claude Code, opencode, and Pi
dispatch instructions when running in Codex.

The plugin installs three skills. Codex does not register the Markdown files in
`agents/` as custom agent types. Use the session's native delegation tools and
registered roles; inherit their model settings.

For the combined `thermos` workflow, start two independent review children with
`spawn_agent` when available. Use an appropriate registered review role or the
default role with a read-only task. Assign one child the correctness and security
rubric and the other the code-quality rubric. Both children report findings;
neither edits source files or posts comments.

Resolve the following paths from this file's directory before dispatch:

| Pass | Agent instructions | Rubric |
| --- | --- | --- |
| Correctness and security | `agents/thermo-nuclear-review-subagent.md` | `skills/thermo-nuclear-review/SKILL.md` |
| Code quality | `agents/thermo-nuclear-code-quality-review-subagent.md` | `skills/thermo-nuclear-code-quality-review/SKILL.md` |

Give each child the absolute agent-instruction path, this guide's path, the
matching absolute `RUBRIC_PATH`, the repository path, and the scoped diff context.
Require the child to read the agent instruction body and rubric from disk. The
agent file's model and host-specific frontmatter do not configure Codex.
Use the session's completion notifications or wait tool to collect both results,
then synthesize the findings. Respect concurrency limits and keep the parent
available while children work.

The single review skills can run directly in the current agent. When delegation
is unavailable, offer a direct review and explain that it lacks two independent
reviewers. A failed dispatch does not authorize switching to shell-launched
agent runtimes. Follow the session's permissions and authorization requirements
for edits and external actions.
