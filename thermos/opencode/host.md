# Thermos in OpenCode

Use OpenCode's native `subagent` tool to dispatch reviewers. Inspect the tool's
available agent list and input schema. Use the registered
`thermo-nuclear-review-subagent` and
`thermo-nuclear-code-quality-review-subagent` agents when available. If the tool
exposes a restricted list, select an available read-only review role and supply
the matching shared agent-instruction path and `RUBRIC_PATH` in its prompt.

Launch both reviews with `background: true` when that field is available, then
collect both completion results before synthesis. Follow the session's concurrency
limits. Reviewer models come from OpenCode's agent configuration; inherit that
selection unless the user explicitly requests another model.

The parent gathers the scoped diff, changed-file paths, repository conventions,
and review intent. Give each reviewer identical scope and the matching absolute
rubric path. Each reviewer reads the rubric and any surrounding source needed to
verify findings, leaves the checkout unchanged, and reports findings with file
and line references. Read, search, and shell commands use the active OpenCode
tools. No external agent process is needed.

If no native delegation tool is available, report the missing capability. A direct
review is an alternative only when authorized; it does not establish two
independent review passes.
