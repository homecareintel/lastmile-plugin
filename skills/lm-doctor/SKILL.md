---
name: lm-doctor
description: Diagnose LastMile plugin connection and auth failures. Walks the unauthenticated discovery chain, matches the structured failure code (including wrong-stage tokens), and prints the plain-language fix — including the request-access path for un-provisioned accounts.
argument-hint: "[the error you hit, or nothing to run a full check]"
---

<!-- GENERATED FILE — do not edit. Source of truth: web-apps/tools/lastmile-plugin (TEI-39). Release: v0.1.2. -->


# /lm-doctor — connection diagnostics

Run this on any auth or connection failure, or on demand. Route on the
structured `code` in error bodies — never on message wording.

## Step 1 — the unauthenticated chain (no sign-in needed)

These work without auth and isolate where the connection breaks:

1. `initialize` / `tools/list` on the dispatch server — if these fail,
   the endpoint URL is wrong or unreachable (check the configured stage
   URL before anything else).
2. GET `/.well-known/oauth-protected-resource/dispatch` on the same host —
   if missing, the server isn't a registered OAuth resource (server-side
   problem; report to TEI).

## Step 2 — match the failure code

401 bodies are `{error, code, stage}`. The `stage` echo is load-bearing:
compare it with the stage the user *thinks* they're on.

| code | meaning | fix |
|---|---|---|
| `missing_authorization` / `authentication_required` | no token sent | complete the host's MCP sign-in (see /lm-setup step 2) |
| `invalid_token` | token expired, malformed, or from another issuer | re-run the sign-in to mint a fresh token |
| `user_validation_failed` | the token's user can't be resolved | if the body's `stage` differs from the intended stage, the token was minted for a different stage — re-login after fixing the endpoint; otherwise the WorkOS↔Clerk link is broken (contact TEI) |
| `user_not_found` | signed-in identity has no LastMile user | access is invite-only — use the request-access path below |
| `company_id_missing` | account exists but isn't provisioned to a company | invite-only: an admin must set your company on the account — request-access path below |
| `invalid_credentials` / `invalid_authorization_format` | malformed auth header | usually a host/config bug; capture and report |
| unknown code | server newer than this skill | show the message verbatim; don't guess |

**Mid-session 401 after things were working:** treat as "re-login
needed" (the token expired), never as "not provisioned". Ask the user to
re-run the host sign-in and retry the last action.

## Step 3 — structured tool errors

`{error, code, ...details}` in tool results: `scenario_too_large` →
/lm-data's size cap section; `geocode_batch_too_large` → split the batch;
`invalid_idempotency_name` → seed names need the `seed:` prefix. Unknown
code → show the message, offer a manual path, don't loop.

## Request-access path

Data access is invite-only. To request access: contact your TEI/LastMile
administrator with your sign-in email and company name — they provision
the account (an admin sets the company on your identity). The README of
the plugin repo carries the current contact.
