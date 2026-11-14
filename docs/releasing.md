# Releasing

Installs follow a pinned ref in `.claude-plugin/marketplace.json`, not the
default branch. Merging to `main` changes nothing for users. A release is the
point where the pin moves to a new tag.

Tags are `vX.Y.Z`, plain semver with no suffix. A tag never moves and is never
deleted once pushed: installs follow tags, so a moved tag silently changes
what every install runs. If a tagged release is wrong, fix it in a new
version.

## Before tagging

Run these on the commit you are about to tag. All must pass.

```
npm test
npm run check
claude plugin validate --strict .
claude plugin eval . --ablation none --no-publish
```

The validator may still warn about the missing icon and privacy policy URL.
Those wait for the directory submission. Anything else is a failure.

## First release on the Route Optimization service: v0.2.0

`main` already carries `0.2.0` in both `plugin.json` files. The marketplace pin
and `metadata.version` stay on `0.1.3-dev` until step 7. Do the steps in this
order. Steps 1 to 5 are the release gate: the pin must not move until the
public sign-in client exists and an installed build has signed in and solved
against prod in both hosts.

1. **Confirm the public sign-in client exists** on the service, built to
   [sign-in-client.md](sign-in-client.md), and get its client id from the
   service owner.
2. **Add the client id.** In `.mcp.json`, set
   `mcpServers.route-optimization.oauth.clientId` to the client id. It is
   public. Never add a client secret.
3. **Confirm covered accounts.** Ask the service owner which Claude and
   OpenAI accounts or plans are covered clients under the service's pilot
   rules, and record them in the v0.2.0 changelog entry. Record plan or
   account types, never customer names or account ids. Pilot tenants may be
   used only from those accounts.
4. **Run the whole flow from an installed build, in Claude Code and in
   Codex.** Push the release branch. Copy `.claude-plugin/marketplace.json` to
   `<dir>/.claude-plugin/marketplace.json` in a scratch directory, with `name` changed to
   `lastmile-release-test` and the entry's `source.ref` set to the release
   branch. Add it with `claude plugin marketplace add <dir>` and
   `codex plugin marketplace add <dir>`, then install `lastmile@lastmile-release-test`
   in each host. Sign in and run setup, onboard, a rule with approval, solve,
   explain and deliver. Use a non-pilot test tenant loaded with synthetic
   data only. Remove the scratch marketplace afterwards.
5. **Check the no-access path.** Sign in with an account that has no tenant.
   In each host, check that what the host shows for the refused connection
   leads `lm-doctor` to the invite-only explanation and the request-access
   path, not a bare 401 or 403.
6. **Date the changelog entry, merge, and tag.** Change
   `## v0.2.0 (unreleased)` to `## v0.2.0 (YYYY-MM-DD)`, merge to `main`, and
   tag the merge commit `v0.2.0`.
7. **Push the tag, then move the pin.** Push `v0.2.0` first. Then, in one
   change to `.claude-plugin/marketplace.json`, set the `lastmile` entry's
   `source.ref` to `v0.2.0`, set `metadata.version` to `0.2.0`, and replace
   the entry's `displayName` and `description` with the text that describes
   the Route Optimization plugin. Before install, both hosts show only these
   entry fields, so they must match the new release.
8. **Update the README's release-status line** to say installs get `v0.2.0`.
   It can ride in the same change as step 7.

Users then update by hand, as the README describes, because automatic
updates are off by default for third-party marketplaces.

## Later releases

Follow the same order, starting from a version bump:

1. Set the new version in `.claude-plugin/plugin.json` and
   `.codex-plugin/plugin.json`, and add a `## vX.Y.Z (unreleased)` changelog
   entry.
2. If the Claude or OpenAI accounts in use have changed, confirm coverage
   with the service owner again (step 3 above).
3. Run the checks in "Before tagging", then do steps 6 to 8 with the new
   version.

Never move the pin to a tag that has not been pushed.
