---
name: thermos
description: "Run both thermo-nuclear review subagents in parallel, then synthesize their findings. Use for thermos, double thermo review, or a combined bug/security and code-quality branch audit."
disable-model-invocation: true
---

When running in Codex, first read [the Codex host guide](../../codex.md).

For other hosts, read the matching section of [the host guide](../../hosts.md) before dispatch.


# Thermos

Run the two thermo review passes as parallel subagents, then synthesize their results.

## Workflow

1. Work out the review scope from the user's request, the PR, the current branch, or the changed
   files.
2. Gather the diff and the file contents each reviewer needs to judge the change without guessing.
   Default base is `main`, so `git diff main...HEAD` plus the full contents of every changed file.
3. Resolve the rubric paths before launching the reviewers. Derive each absolute path from the
   loaded `thermos/SKILL.md` directory: its sibling skill directories are
   `thermo-nuclear-review/` and `thermo-nuclear-code-quality-review/`. Expand `~` and resolve the
   path to an absolute path before including the matching `SKILL.md` path in each subagent task as
   `RUBRIC_PATH`.
4. Launch both subagents in the same message, so they run at the same time:
   - `thermo-nuclear-review-subagent` for bugs, breaking changes, security, devex regressions and
     feature-flag leaks.
   - `thermo-nuclear-code-quality-review-subagent` for maintainability, structure, file-size growth,
     spaghetti, abstractions and codebase health.

   Use the active host's registered delegation tool and completion mechanism. The host guide
   supplies dispatch details. If delegation is unavailable, report that limitation rather than
   claiming two independent reviews.
5. Give both subagents the same scoped context, and ask each for prioritized findings with file
   references and evidence.
6. When both finish, synthesize. Findings come first, deduplicated across the two reviewers. Weight
   a finding both reviewers raised more heavily, settle disagreements with your own judgment, and
   keep the summary short.

When the user can already see each subagent's own summary, do not repeat it. Give the unified
verdict, the highest-signal findings, and anything still uncertain.
