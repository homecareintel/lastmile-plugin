---
name: lm-optimization
description: Run a LastMile dispatch optimization from a natural-language request ("last friday for bobtail austin fuel") or from external data (spreadsheet, CSV, Google Doc). Resolves candidates, confirms the data with the user, starts the solve, and follows live progress to a final route summary.
argument-hint: "[date] [unit/department/service area] — or point at a sheet/doc"
---

<!-- GENERATED FILE — do not edit. Source of truth: web-apps/tools/lastmile-plugin (TEI-39). Release: v0.1.3-dev. -->


# /lm-optimization — run a dispatch optimization

You orchestrate the `lastmile-dispatch` MCP server. Follow this workflow
discipline exactly; discover everything else live.

## Step 0 — discover the tools (always first)

Call `dispatch_schema` before anything else. It returns the current tool
reference and the error-envelope contract. Tool names, inputs, and output
shapes in that primer are authoritative — never rely on remembered
signatures; the server deploys independently of this skill.

## Rules that apply to every step

- **Compact calls.** Invoke tools through human-auditable forms — dates,
  filter names, `scenario_id`, batched address lists. Never inline raw id
  arrays into a tool call when a compact form exists (`dispatch_date` +
  filters resolves the same candidates server-side).
- **Confirm before run.** Starting a solve always requires the user's
  explicit confirmation of the reviewed data. No exceptions — a dry-run
  answer is never a mandate to start.
- **Route on error codes, never message prose.** Readiness summaries carry
  `validation_gap_codes`; tool errors and 401 bodies carry `code`. If you
  see a code this skill doesn't name: show the human-readable message,
  offer a manual fix via /lm-data, and do not loop (the server may be
  newer than this skill).
- **Concurrency.** If this session already started or knows about an
  in-progress run, warn the user and name both runs before starting
  another; keep narrating the run you started.

## Step 1 — resolve the data source

- Request names a date/unit/department/service area → LastMile source:
  call `dispatch_list_optimization_options` to resolve names to ids, then
  `dispatch_list_optimization_candidates` with `dispatch_date` + filters.
- User supplied or referenced external data (sheet, CSV, Google Doc,
  pasted table) → hand off to the /lm-data workflow (parse → validate-only
  preview → load), then continue here with its `scenario_id`.
- Genuinely ambiguous → ask: "Where should the data come from — LastMile,
  or a spreadsheet/document?"

## Step 2 — dry-run preview (no confirmation needed)

Read-only calls (`dispatch_list_optimization_candidates`, validate-only
loads) may run speculatively to answer "what would optimizing X include":
report order/shift/terminal counts, the schedule date, and any gaps.

## Step 3 — remediate gaps

When `ready` is false, group `validation_gap_codes`:

| code | terminal? | remediation |
|---|---|---|
| `missing_delivery_coordinates` | no | /lm-geocode workflow (batch, then write back or patch the scenario) |
| `missing_pickup_terminal` | no | /lm-data — fix the order's pickup terminal |
| `no_order_items` | no | /lm-data — fix the order's items |
| `no_orders_selected`, `no_resources_selected`, `no_terminals` | yes | a fact about the selection — tell the user; no data fix applies |
| anything else | — | unknown-code fallback: show the message, offer a manual /lm-data fix, don't loop |

Loop fix → re-validate until `ready: true`, only terminal codes remain, or
the user stops.

## Step 4 — confirm

Present the reviewed data (counts, date, preview rows if shown) and ask
for explicit confirmation to start. Only after a clear yes: call
`dispatch_start_optimization` — with `dispatch_date` + filters for
LastMile sources, or `scenario_id` for loaded scenarios (scenario runs are
scratch and stay out of operator run history; say so).

## Step 5 (Codex) — live progress via text

No widget renders in this host. Poll `dispatch_get_live_solution` with
`optimization_id` and `last_seq`, targeting one poll every 15–30 seconds,
and narrate each change: "3 routes, 42 stops, cost 47,344 — updated just
now". Budget at most 10 polls; if the run is still going, stop with:
"Still running — ask me to check again, or run
`dispatch_get_optimization <id>` later." Never poll faster than the
target; each call is a tool invocation. On completion, print the route
summary table (route → stops → volume → cost) and the unassigned list.

## Step 6 — wrap up

Report the final summary and the `optimization_id`. If anything failed
with a structured code, hand the code to the /lm-doctor workflow instead
of retrying blindly.
