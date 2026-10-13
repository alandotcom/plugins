# Plugins

This standalone repository maintains two packages:

- [Thermos](thermos/README.md): parallel correctness/security and maintainability
  reviews for OpenCode, Cursor, Claude Code, Codex, and Pi.
- [pstack](pstack/README.md): shared engineering workflow skills for OpenCode,
  Cursor, and Codex.

Both originated in [Cursor's plugins repository](https://github.com/cursor/plugins).
This repository preserves their attribution and MIT licenses and does not track
Cursor upstream.

## OpenCode

Install both workflows from GitHub:

```bash
opencode plugin add github:alandotcom/plugins
```

The root package loads the `alandotcom.plugins` bundle. It registers Thermos's
reviewers and pstack's skills, `poteto-agent`, and Comment Sicko. Run
`/thermos <review scope>` or `/poteto-mode <task>`.

For local development, add the bundle directory to the existing `plugins` array
in `opencode.json`:

```json
{
  "plugins": ["/absolute/path/to/plugins/opencode"]
}
```

Use either the bundle or standalone adapters. Loading both repeats registrations.
To install pstack independently, see [pstack installation](pstack/README.md#opencode).
The local `thermos/opencode` adapter remains available for Thermos-only use.

If the GitHub source is already installed, update that configured source:

```bash
opencode plugin update github:alandotcom/plugins
```

Pass the HTTPS URL instead if that is the source stored in your configuration.
Remove an earlier local Thermos entry when switching to the bundle. The root
plugin ID changes from `thermos` to `alandotcom.plugins`; update any ID-based
disable rules. Thermos skill IDs and agent model settings remain unchanged.

## Pi

Thermos uses separate skill and agent links; see [Thermos for Pi](thermos/README.md#pi).
This repository does not provide a pstack Pi adapter. Pi's active pstack adaptation
is maintained separately in `pi-config`.
Installing this repository does not modify Pi or OpenCode settings.

## Claude Code and Codex

The Claude Code marketplace contains Thermos. The Codex marketplace contains
Thermos and pstack. Each plugin can be installed independently.

```bash
claude plugin marketplace add alandotcom/plugins
claude plugin install thermos@plugins
```

```bash
codex plugin marketplace add .
codex plugin add thermos@plugins
codex plugin add pstack@plugins
```

Start a new host session after installation. See each plugin's host guide for
delegation and model configuration.

## Development

Use Node.js 24 or later:

```bash
npm ci --ignore-scripts
npm test
node scripts/validate-plugins.mjs
python3 scripts/check-codex-plugins.py
```

The OpenCode tests check bundle loading, V2 registration, command delivery,
model validation, and reviewer permissions.
The Codex check requires an installed Codex CLI and checks
both this checkout and a relocated copy without model calls.

After configuring OpenCode to load this checkout, verify the live registration:

```bash
node scripts/check-opencode-plugin.mjs
```

The check activates every packaged skill in a separate temporary session and
removes each session afterward. It makes no model calls. Pass a location directory
as the first argument and `thermos` or `pstack` as the second argument to check
a standalone adapter.
