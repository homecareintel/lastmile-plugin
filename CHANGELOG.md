# Changelog

What changed between releases, newest first. Installs follow release tags,
so each entry here matches a tag. Entries before v0.2.0 come from the
plugin's earlier home, where this repo was a generated build.

## v0.2.0 (unreleased)

**Breaking for existing installs.** The plugin moves to a different service.
After updating, sign in again; access needs an agent user and tenant on the
Route Optimization service, and LastMile server access does not carry over.

- One bundled MCP server, `route-optimization` at
  `https://mcp.routing.thinkwork.ai/mcp`, replaces the `lastmile-dispatch`
  and `lastmile-data-catalog` servers. Sign-in uses the service's public
  sign-in client (no client secret) with a fixed local callback port, 31873.
- Six skills that follow the service's onboard, approve, solve, explain and
  deliver flow. New: `lm-onboard`, `lm-rule`, `lm-explain`. Rewritten:
  `lm-setup`, `lm-doctor`, `lm-optimization`.
- Removed: `lm-data`, `lm-geocode`, the demo seed and the data contract. The
  service now describes its own rules and settings.
- One host-neutral skills tree: Claude Code and Codex load the same six
  skills, and each skill gives both hosts' steps where they differ.
- The source is written by hand in this repo. No generator writes or
  overwrites it.
- Installs follow a pinned release ref in the marketplace, so merging to
  `main` no longer changes what users get.

## v0.1.3

- Seed scenario carries VRP-required fields (time windows, shift times,
  start/end locations) so the activation solve produces real routes.

## v0.1.2 and earlier

- Initial public tree: five skills (`lm-setup`, `lm-optimization`,
  `lm-data`, `lm-geocode`, `lm-doctor`), bundled dispatch + data-catalog
  MCP servers, demo seed, tag-pinned append-only publishing.
