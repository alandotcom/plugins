# Thermos host dispatch

Read only the section for the active host. Review scope, rubrics, and synthesis
remain in the shared skills and agent instructions.

## OpenCode

Read [the OpenCode guide](opencode/host.md). The plugin includes that guide and
absolute rubric paths in its registered skills and agent prompts.

## Cursor

Use `Task` with each registered reviewer name as `subagent_type` and
`run_in_background: true`. Launch both reviews together and collect both results
before synthesis.

## Claude Code

Use `Agent` with the plugin-qualified names
`thermos:thermo-nuclear-review-subagent` and
`thermos:thermo-nuclear-code-quality-review-subagent` as `subagent_type`. When the
agents are installed as standalone files instead, use their registered names.
Launch both
reviews together and collect both results before synthesis. Reviewer models come
from the host's agent configuration.

## Codex

Read [the Codex guide](codex.md) for native child dispatch and rubric paths.

## Pi

Pi requires a delegation extension. Inspect the active tool's schema and registered
agent names before dispatch. With TintinWeb's `Agent` tool, launch both registered
reviewers in parallel background calls and collect their completion results. With
the `subagent` tool, use its parallel `tasks` form and `agentScope: user` when those
fields are exposed. Follow the session's delegation policy if it requires a
different registered role, and supply that child the shared agent instructions
and absolute rubric path.

The Pi-specific files in `pi/agents/` select reviewer models. Their model and
thinking settings configure Pi only.
