---
name: lm-setup
description: Activate the LastMile plugin end-to-end — configure the server endpoint (stage), complete OAuth sign-in for both bundled servers, verify identity and tenancy, then prove the whole chain by running the bundled demo scenario to a live result. Re-runnable: on a healthy install it reports status instead of re-onboarding.
argument-hint: "[stage: production|staging|develop, default production]"
---

<!-- GENERATED FILE — do not edit. Source of truth: web-apps/tools/lastmile-plugin (TEI-39). Release: v0.1.0. -->


# /lm-setup — activation and health check

The POS test transaction: when this completes, auth, tenancy, the solver,
and the result surface are all proven. Re-run it any time — on a healthy
install it reports the current configuration and stops.

## Step 1 — endpoint

The plugin ships pointing at production
(`https://mcp.lastmile-tei.com/{dispatch,data-catalog}`). If the user
names a stage, rewrite BOTH server URLs in this host's MCP config:

- `staging` → `https://mcp-staging.lastmile-tei.com/...`
- `develop` → `https://mcp-dev.lastmile-tei.com/...`
- a custom URL → show the user the exact host and get explicit
  confirmation before proceeding (OAuth tokens will be sent there).

Update the server entries via `codex mcp add --transport http <name>
<url>` (or edit `config.toml`'s `[mcp_servers]` blocks).

## Step 2 — sign in

Each bundled server is its own OAuth resource, so expect one interactive
login per server (the second is usually fast-pathed by the existing
session):

Tell the user to run `codex mcp login lastmile-dispatch` and
`codex mcp login lastmile-data-catalog`.

## Step 3 — verify identity and tenancy

Call `dispatch_schema` (proves dispatch auth), then a cheap data-catalog
read (proves the second grant). A 401 at this point → hand the body's
`{code, stage}` to the /lm-doctor table; `company_id_missing` means the
account isn't provisioned — access is invite-only; show the request-access
path from the README.

## Step 4 — test transaction (the seed run)

1. Load the bundled seed: `dispatch_load_scenario` with the entities from
   `seeds/demo-fuel-run.json` and
   `idempotency_name: "seed:demo-fuel-run"` — repeat activations reuse or
   refresh one row, never accumulate.
2. Confirm with the user, then `dispatch_start_optimization` with the
   returned `scenario_id` and a low solver budget (`max_run_time_ms` ≈
   30000) — this is a real solve on the real solver; the seed is tiny to
   keep it cheap.
3. Follow progress per the /lm-optimization host tier (widget or text
   polling). **Bounded wait: 3–5 minutes.** If the run is still RUNNING
   after that, stop and report: "The backend solver did not respond —
   this is NOT a setup problem; your install is healthy through auth and
   data. Contact TEI." (No error code will arrive — the timeout IS the
   signal.)
4. On completion: "You're live" + the route summary.

## Step 5 — tool allowlist (recommended)

So progress polling and the narrow write path don't prompt on every call,
suggest allowlisting exactly: `dispatch_get_live_solution`,
`dispatch_get_optimization` (read-only status), and — only if the user
wants geocode write-back — data-catalog `ship_tos_update` (this one is
better left prompting). Never suggest blanket-allowlisting the
data-catalog server; it exposes 40 tools including deletes.

## Re-run behavior

If the endpoint is configured, both servers authenticate, and the seed
scenario row exists, report all of that and stop — don't re-run the solve
unless the user asks for a fresh test transaction.
