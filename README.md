# Cursor plugins

> Fork note: this fork adds host support to selected plugins from
> [cursor/plugins](https://github.com/cursor/plugins).
> The root `package.json` supports both Pi and OpenCode, with separate entry points.
> Pi loads [pstack's Pi adapter](pstack/pi/README.md).
> OpenCode loads [Thermos](thermos/README.md#installation).
> Thermos also supports Claude Code through the root marketplace and its plugin manifest.
> Codex can install Thermos and pstack through `.agents/plugins/marketplace.json`.
> Installing the repository does not load every plugin.
> The repository runs no installation scripts to configure hosts.

## Codex

Use a Codex CLI with `plugin marketplace` and `plugin add` commands. From this
checkout's root:

```bash
codex plugin marketplace add .
codex plugin add thermos@alandotcom-plugins
codex plugin add pstack@alandotcom-plugins
```

Install either plugin independently by running only its `plugin add` command.
Start a new thread after installation, then select `thermos` or `poteto-mode`
from the skill picker (`thermos:thermos` and `pstack:poteto-mode`). The plugin
READMEs describe
[Thermos](thermos/README.md#codex) and [pstack](pstack/README.md#codex) behavior.
The plugins share their canonical skills with the other hosts and include Codex
instructions for tool selection and delegation. They do not install MCP servers
or register Markdown agent files as Codex agent types.

After these changes are published, a remote installation can register the repository
with `codex plugin marketplace add alandotcom/plugins` instead of the local path.
While developing locally, update the version in the plugin's
`.codex-plugin/plugin.json`, rerun its `codex plugin add` command, and start a new
thread to load the refreshed files.

Check both packages with the local Codex loader:

```bash
python3 scripts/check-codex-plugins.py
```

The check loads every skill from the checkout and a relocated copy. It makes no
model calls and does not change plugin installation settings. The shared skills
retain Cursor and Claude frontmatter such as `disable-model-invocation`.
The generic skill and public-ingestion validators reject those fields; the local
Codex loader accepts them. This repository targets local and Git marketplace
installation, not public-directory submission.

Packaging follows the [official Codex plugin format](https://developers.openai.com/plugins/build/plugins).

## Pi development

To load pstack for one Pi session without installing the package, run:

```bash
pi -e ./pstack/pi/index.ts
```

For development, use Node.js 24 or later and install the local dependencies:

```bash
npm ci --ignore-scripts
```

This does not register the plugin with Pi or OpenCode.
Run the compiler check and adapter tests:

```bash
npm run typecheck:pi
npm run test:pi
```

Pi's resource list includes only the pstack extension.
The extension exposes pstack skills through `/pstack:<skill>` commands to avoid skill-name collisions.
The shared skill and agent files remain in `pstack/skills` and `pstack/agents`.
OpenCode support for pstack is not included yet.
See [pstack for Pi](pstack/pi/README.md) for commands and capability limits.

Official Cursor plugins for popular developer tools, frameworks, and SaaS products. Each plugin is a standalone directory at the repository root with its own `.cursor-plugin/plugin.json` manifest.

## Plugins

| `name` | Plugin | Author | Category | `description` (from marketplace) |
|:-------|:-------|:-------|:---------|:-------------------------------------|
| `teaching` | [Teaching](teaching/) | Cursor | Utilities | Skill mapping, practice plans, and learning retrospectives. |
| `continual-learning` | [Continual Learning](continual-learning/) | Eric Zakariasson | Developer Tools | Incremental transcript-driven memory updates for AGENTS.md using high-signal bullet points only. |
| `cursor-team-kit` | [Cursor Team Kit](cursor-team-kit/) | Eric Zakariasson | Developer Tools | Internal team workflows for CI, code review, shipping, local automation, and verification. |
| `thermos` | [Thermos](thermos/) | Cursor | Developer Tools | Thermo-nuclear branch review: deep security/correctness audits, harsh code-quality rubrics, parallel subagents, thermos orchestration, and optional merge-ready PR flows. |
| `create-plugin` | [Create Plugin](create-plugin/) | Cursor | Developer Tools | Scaffold and validate new agent plugins. |
| `ralph-loop` | [Ralph Loop](ralph-loop/) | Cursor | Developer Tools | Iterative self-referential AI loops using the Ralph Wiggum technique. |
| `agent-compatibility` | [Agent Compatibility](agent-compatibility/) | Cursor | Developer Tools | CLI-backed repo compatibility scans plus agents that audit startup, validation, and docs against reality. |
| `cli-for-agent` | [CLI for Agents](cli-for-agent/) | Eric Zakariasson | Developer Tools | Patterns for designing CLIs that coding agents can run reliably: flags, help with examples, pipelines, errors, idempotency, dry-run. |
| `pr-review-canvas` | [PR Review Canvas](pr-review-canvas/) | Cursor | Developer Tools | Render PR diffs as review canvases grouped by importance. |
| `docs-canvas` | [Docs Canvas](docs-canvas/) | Cursor | Developer Tools | Render documentation as a navigable canvas. |
| `cursor-sdk` | [Cursor SDK](cursor-sdk/) | Cursor | Developer Tools | Build apps, scripts, and automations with the TypeScript SDK. |
| `orchestrate` | [Orchestrate](orchestrate/) | Cursor | Developer Tools | Fan large tasks out across parallel cloud agents with planners, workers, verifiers, and structured handoffs. |
| `pstack` | [pstack](pstack/) | Lauren Tan | Developer Tools | if you want to go fast, go deep first. pstack helps you write less, but higher quality code. rigorous agent workflows you can parallelize with confidence. |
| `advisor` | [Advisor](advisor/) | Cursor | Developer Tools | Consult a stronger model before major decisions, when stuck, and before declaring done. |
| `grok-voice` | [Grok Voice](grok-voice/) | Eric Zakariasson | Developer Tools | Add Grok voice to an app: realtime speech-to-speech, speech-to-text dictation, text-to-speech read-aloud, and a log-driven fix loop for voice sessions. |
| `gmail` | [Gmail](third_party/gmail/) | Cursor | Productivity | Search, read, draft, and manage email. |
| `google-drive` | [Google Drive](third_party/google-drive/) | Cursor | Productivity | Search, read, create, and share files. |
| `google-calendar` | [Google Calendar](third_party/google-calendar/) | Cursor | Productivity | Search events and schedule meetings. |
| `gong` | [Gong](third_party/gong/) | Cursor | Integrations | Pull account summaries, deal insights, and call briefs. |
| `salesforce` | [Salesforce](third_party/salesforce/) | Cursor | Integrations | Query, create, and update records in your org. |
| `playwright` | [Playwright](third_party/playwright/) | Cursor | Integrations | Navigate, click, screenshot, and test in a real browser. |
| `github` | [GitHub](third_party/github/) | Cursor | Integrations | Manage repos, issues, pull requests, and Actions. |
| `ashby` | [Ashby](third_party/ashby/) | Cursor | Integrations | Search candidates, prep interviews, and manage pipeline tasks. |
| `hubspot` | [HubSpot](third_party/hubspot/) | Cursor | Integrations | Search and update contacts, companies, deals, and tickets. |
| `intercom` | [Intercom](third_party/intercom/) | Cursor | Integrations | Search conversations, contacts, and Help Center articles. |
| `zoom` | [Zoom](third_party/zoom/) | Cursor | Integrations | Search meetings, pull transcripts, and work with Zoom Docs. |
| `x` | [X](third_party/x/) | Cursor | Integrations | Search posts, read timelines, pull trends, and manage bookmarks. |
| `clay` | [Clay](third_party/clay/) | Cursor | Integrations | Enrich people and companies, run AI research agents. |
| `circleback` | [Circleback](third_party/circleback/) | Cursor | Integrations | Search meetings, transcripts, action items, and emails. |
| `docusign` | [Docusign](third_party/docusign/) | Cursor | Integrations | Manage envelopes, templates, workflows, and agreements. |
| `navan` | [Navan](third_party/navan/) | Cursor | Integrations | Query expenses, travel bookings, policies, and cards. |
| `profound` | [Profound](third_party/profound/) | Cursor | Integrations | Track AI visibility, sentiment, and citations. |
| `juicebox` | [Juicebox](third_party/juicebox/) | Cursor | Integrations | Query recruiting analytics, shortlists, and sourcing agents. |
| `outreach` | [Outreach](third_party/outreach/) | Cursor | Integrations | Search sequences, prospects, and Kaia meetings. |
| `amplemarket` | [Amplemarket](third_party/amplemarket/) | Cursor | Integrations | Search people and companies, enrich leads, run sequences. |
| `klaviyo` | [Klaviyo](third_party/klaviyo/) | Cursor | Integrations | Manage profiles, segments, campaigns, and flows. |
| `customer-io` | [Customer.io](third_party/customer-io/) | Cursor | Integrations | Build campaigns, manage segments, and query people. |
| `mailerlite` | [MailerLite](third_party/mailerlite/) | Cursor | Integrations | Manage subscribers, groups, campaigns, and automations. |
| `brevo` | [Brevo](third_party/brevo/) | Cursor | Integrations | Manage contacts, email and SMS campaigns, and CRM deals. |
| `typeform` | [Typeform](third_party/typeform/) | Cursor | Integrations | Build forms, analyze responses, and manage contacts. |
| `jotform` | [Jotform](third_party/jotform/) | Cursor | Integrations | Create and edit forms, then read submissions. |
| `semrush` | [Semrush](third_party/semrush/) | Cursor | Integrations | Research keywords, backlinks, traffic, and competitors. |
| `ahrefs` | [Ahrefs](third_party/ahrefs/) | Cursor | Integrations | Research keywords, backlinks, rankings, and site health. |
| `godaddy` | [GoDaddy](third_party/godaddy/) | Cursor | Integrations | Brainstorm domain names and check availability. |
| `upwork` | [Upwork](third_party/upwork/) | Cursor | Integrations | Search talent, post jobs, and manage contracts. |
| `workable` | [Workable](third_party/workable/) | Cursor | Integrations | Search candidates, move pipelines, and manage HR records. |
| `brex` | [Brex](third_party/brex/) | Cursor | Integrations | Query expenses, receipts, bills, cards, and travel. |
| `mercury` | [Mercury](third_party/mercury/) | Cursor | Integrations | Read balances, transactions, statements, and cards. |
| `todoist` | [Todoist](third_party/todoist/) | Cursor | Integrations | Create, find, and complete tasks and projects. |
| `calendly` | [Calendly](third_party/calendly/) | Cursor | Integrations | Check availability and book, cancel, or reschedule. |
| `smartsheet` | [Smartsheet](third_party/smartsheet/) | Cursor | Integrations | Query and update sheets, rows, and workspaces. |
| `wrike` | [Wrike](third_party/wrike/) | Cursor | Integrations | Search projects, create tasks, and post comments. |
| `coda` | [Coda](third_party/coda/) | Cursor | Integrations | Search docs, read pages, and update tables. |
| `guru` | [Guru](third_party/guru/) | Cursor | Integrations | Search company knowledge and draft verified answers. |
| `fireflies` | [Fireflies](third_party/fireflies/) | Cursor | Integrations | Search meeting transcripts, summaries, and action items. |
| `otter` | [Otter.ai](third_party/otter/) | Cursor | Integrations | Search meeting history and pull full transcripts. |
| `fathom` | [Fathom](third_party/fathom/) | Cursor | Integrations | Search meetings and pull transcripts and summaries. |
| `craft` | [Craft](third_party/craft/) | Cursor | Integrations | Search, create, and update documents and daily notes. |
| `mem` | [Mem](third_party/mem/) | Cursor | Integrations | Capture, search, and organize notes and collections. |
| `readwise` | [Readwise](third_party/readwise/) | Cursor | Integrations | Search highlights and Reader documents, save articles. |
| `similarweb` | [Similarweb](third_party/similarweb/) | Cursor | Integrations | Analyze website traffic, audiences, and competitors. |
| `xero` | [Xero](third_party/xero/) | Cursor | Integrations | Read and write invoices, contacts, reports, and payroll. |
| `x-ads` | [X Ads](third_party/x-ads/) | Cursor | Integrations | Manage ad campaigns, create ads, track conversions, and pull performance stats. |
Author values match each plugin’s `plugin.json` `author.name` (Cursor lists `plugins@cursor.com` in the manifest).

## Repository structure

This is a multi-plugin marketplace repository. The root `.cursor-plugin/marketplace.json` lists all plugins, and each plugin has its own manifest:

```
plugins/
├── .cursor-plugin/
│   └── marketplace.json       # Marketplace manifest (lists all plugins)
├── plugin-name/
│   ├── .cursor-plugin/
│   │   └── plugin.json        # Per-plugin manifest
│   ├── skills/                # Agent skills (SKILL.md with frontmatter)
│   ├── rules/                 # Cursor rules (.mdc files)
│   ├── mcp.json               # MCP server definitions
│   ├── README.md
│   ├── CHANGELOG.md
│   └── LICENSE
└── ...
```

## License

MIT
