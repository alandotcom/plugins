# Plugins

This standalone repository maintains two packages:

- [Thermos](thermos/README.md): parallel correctness/security and maintainability
  reviews for OpenCode, Cursor, Claude Code, Codex, and Pi.
- [pstack for Pi](pstack/pi/README.md): the retained Pi adapter and its workflow
  skills. OpenCode support for pstack is not included.

Both originated in [Cursor's plugins repository](https://github.com/cursor/plugins).
This repository preserves their attribution and MIT licenses and does not track
Cursor upstream.

## OpenCode

Add this checkout to the existing `plugins` array in `opencode.json`:

```json
{
  "plugins": ["/absolute/path/to/plugins/thermos/opencode"]
}
```

The published GitHub source is `github:alandotcom/plugins`. The root package loads
Thermos only in OpenCode. Run `/thermos <review scope>`. See
[Thermos installation](thermos/README.md#opencode).

## Pi

The root package registers `pstack/pi/index.ts` as its only Pi extension. To try
that adapter without installing the package:

```bash
pi -e ./pstack/pi/index.ts
```

Thermos uses separate skill and agent links; see [Thermos for Pi](thermos/README.md#pi).
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
npm run typecheck:pi
node scripts/validate-plugins.mjs
python3 scripts/check-codex-plugins.py
```

The OpenCode tests check V2 registration and host instructions. The Pi tests check
the retained adapter. The Codex check requires an installed Codex CLI and checks
both this checkout and a relocated copy without model calls.

After configuring OpenCode to load this checkout, verify the live registration:

```bash
node scripts/check-opencode-plugin.mjs
```

The check activates all three packaged skills in a temporary session and removes
that session afterward. It makes no model calls.
