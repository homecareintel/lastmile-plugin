# LastMile Route Optimization

The `lastmile` plugin lets an agent in Claude Code or Codex run the ThinkWork
Route Optimization service for you. It imports and maps a customer's data,
asks about the rules people forget to mention, and sends each rule change to an
operator for approval. Then it solves, explains why each job landed where it
did, and delivers the routes only after you confirm.

The plugin connects to one MCP server, `route-optimization`, at
`https://mcp.routing.thinkwork.ai/mcp`.

**Release status:** installs get `v0.1.3-dev`, the earlier LastMile build,
until `v0.2.0` ships. `v0.1.3-dev` connects to different servers and has
different skills. This README describes `v0.2.0`. See [CHANGELOG.md](CHANGELOG.md).

## Access is invite-only

Anyone can install the plugin, but the service only answers accounts that
have been given an agent user and a tenant. Without one, sign-in may succeed
and every request is still refused. To request access, ask the ThinkWork Route
Optimization team that operates your customer's pilot. There is no sign-up
page. `lm-doctor` tells you where you stand.

## Install

**Claude Code**

```
/plugin install lastmile --marketplace homecareintel/lastmile-plugin
```

From a terminal, the same install is
`claude plugin install lastmile --marketplace homecareintel/lastmile-plugin`.

**Codex**

```
codex plugin marketplace add homecareintel/lastmile-plugin
codex plugin add lastmile@lastmile-plugin
```

## Sign in

Sign-in opens your browser at the service's sign-in page and returns to a
local callback on port 31873. Keep that port free while you sign in.

- **Claude Code:** run `/mcp`, select `route-optimization`, and authenticate.
- **Codex:** run `codex mcp login route-optimization`.

Then run `lm-setup` to prove the connection.

## Skills

| Skill | Claude Code | Codex | What it does |
|---|---|---|---|
| `lm-setup` | `/lastmile:lm-setup` | `$lastmile:lm-setup` | Proves the connection with read-only calls and reports the tenant and profile it reached. |
| `lm-doctor` | `/lastmile:lm-doctor` | `$lastmile:lm-doctor` | Diagnoses sign-in and access failures and says what to do next. |
| `lm-onboard` | `/lastmile:lm-onboard` | `$lastmile:lm-onboard` | Imports and maps a customer's data, runs the checklist interview, and proposes a business profile. |
| `lm-rule` | `/lastmile:lm-rule` | `$lastmile:lm-rule` | Turns a stated rule into a proposed profile change and hands you the approval link. |
| `lm-optimization` | `/lastmile:lm-optimization` | `$lastmile:lm-optimization` | Compiles and solves, follows the run, and delivers only on your explicit confirmation. |
| `lm-explain` | `/lastmile:lm-explain` | `$lastmile:lm-explain` | Answers why and why-not questions from the solver's output. |

## Update

Installs follow a pinned release, and automatic updates are off by default
for third-party marketplaces, so update by hand when a release ships.

**Claude Code**

```
claude plugin marketplace update lastmile-plugin
claude plugin update lastmile@lastmile-plugin
```

Restart Claude Code to load the new version.

**Codex**

```
codex plugin marketplace upgrade lastmile-plugin
codex plugin add lastmile@lastmile-plugin
```

Start a new Codex session to load the new version.

## Data

The skills talk only to the bundled `route-optimization` server and fetch
nothing else. Your agent host still sends the conversation, including any
customer data you show it, to its model provider. Use pilot tenants only from
the Claude and OpenAI accounts that the ThinkWork Route Optimization team has
confirmed as covered for that pilot. Each release records which accounts
those are.

## Maintainers

This repo is the plugin's source; edit it directly. Releases follow
[docs/releasing.md](docs/releasing.md). The public sign-in client the plugin
needs is specified in [docs/sign-in-client.md](docs/sign-in-client.md).
