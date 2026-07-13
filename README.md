<!-- GENERATED FILE — do not edit. Source of truth: web-apps/tools/lastmile-plugin (TEI-39). Release: v0.1.2. -->

# LastMile Plugin

Dispatch optimization for AI agents: run "an /lm-optimization for last
friday for bobtail austin fuel" — or the same optimization from your own
spreadsheet — through confirm-before-run to a live route map (Claude) or
narrated progress (Codex).

> **Access is invite-only.** The plugin installs freely, but the LastMile
> backend only serves provisioned accounts. To request access, contact
> your TEI/LastMile administrator with your sign-in email and company
> name. `/lm-doctor` tells you exactly where you stand.

## Install

**Claude Code / Claude apps**

```
/plugin marketplace add homecareintel/lastmile-plugin
/plugin install lastmile
```

**Codex**

```
codex plugin marketplace add homecareintel/lastmile-plugin
codex plugin add lastmile@lastmile-plugin
```

Then run `/lm-setup` — it configures the endpoint, walks you through the
OAuth sign-in for both bundled servers, and proves the whole chain by
running a tiny bundled demo optimization to a live result.

## Skills

| Skill | What it does |
|---|---|
| `/lm-optimization` | The hero flow: natural-language request → candidates → confirm → live solve → route summary |
| `/lm-data` | Bring data from any source (sheet, CSV, Google Doc, paste) into a runnable scenario; fix data gaps |
| `/lm-geocode` | Batch-resolve missing delivery coordinates with quality gating |
| `/lm-setup` | Activation ritual + re-runnable health check |
| `/lm-doctor` | Connection/auth diagnostics keyed on structured error codes |

## Servers

The plugin bundles two OAuth-protected MCP servers (`https://mcp.lastmile-tei.com`):
`lastmile-dispatch` (optimization) and `lastmile-data-catalog` (the
narrow write path for geocode fixes). Sign-in is one interactive OAuth
grant per server (`/mcp` on Claude, `codex mcp login` on Codex).

## Install only from tagged releases

This repo is a generated build artifact, published append-only with
protected tags. Install from a tagged release (v0.1.2 is current); never
from a branch ref. Hand edits here are overwritten by the next release —
the source of truth lives in the LastMile monorepo.
