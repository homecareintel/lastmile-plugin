# Public sign-in client

This is the handoff spec for the Route Optimization service owner. The
`lastmile` plugin signs in through a public app client in the service's
Cognito user pool. That client does not exist yet, and the plugin cannot be
released until it does (see [releasing.md](releasing.md)).

The plugin's hosts, Claude Code and Codex, read a client id from the plugin's
`.mcp.json`. With a client id set, they skip client registration, which the
pool does not offer, and run the authorization code flow with PKCE (S256)
against the pool. Neither host can hold a client secret for a public plugin,
so the client must not have one.

## What the plugin sends

| | Value |
|---|---|
| MCP server URL | `https://mcp.routing.thinkwork.ai/mcp` |
| Issuer | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_KFJ5ZuKG6` |
| Managed login domain | `routeopt-prod.auth.us-east-1.amazoncognito.com` |
| Flow | Authorization code with PKCE S256, no client secret |
| Scopes requested | `openid https://mcp.routing.thinkwork.ai/mcp/tools` |
| `resource` parameter | `https://mcp.routing.thinkwork.ai/mcp` |
| Local callback port | `31873` |

## Client settings

**No client secret.** Create the client without a secret. The client id is
public: it is committed to this repo's `.mcp.json` under
`mcpServers.route-optimization.oauth.clientId` and anyone can read it.

**OAuth flow.** Authorization code only. No implicit grant, no client
credentials. Identity provider: the Cognito user pool.

**Callback URLs.** Allow exactly these three loopback URLs:

| URL | Used by |
|---|---|
| `http://localhost:31873/callback` | Claude Code |
| `http://127.0.0.1:31873/callback` | Claude Code (a form some builds sent) |
| `http://127.0.0.1:31873/callback/-VA_LsgYyrUX` | Codex |

Codex derives the path suffix `-VA_LsgYyrUX` from the exact MCP server URL
string. If the server URL changes in any way, the Codex callback URL changes
too, and this list must be updated with it. Confirm the console or Terraform
accepts the two `http://127.0.0.1` URLs; if Cognito refuses them, tell the
plugin maintainer before anything else, because Codex sign-in depends on one.

**Allowed scopes.** Only `openid` (plus `email` if wanted) and
`https://mcp.routing.thinkwork.ai/mcp/tools`. Never
`aws.cognito.signin.user.admin`, and never the approval scope. The admin
scope would let a signed-in operator call Cognito's user APIs directly with
their own token and change their own attributes, including their tenant.

**Resource binding.** The hosts send `resource=https://mcp.routing.thinkwork.ai/mcp`
on the authorization and token requests. The service recently renamed its
MCP resource server to that URL so that Cognito accepts the custom scope for
that resource and puts the URL in the token audience. The new client must
request its custom scope from that resource server. Do not reintroduce a
scope on a resource server with a different identifier.

**Read attributes.** Include `email`, `email_verified` and the tenant
attribute, so the issued tokens and the service see them as the existing
sign-in clients do.

**Write attributes.** List them explicitly, and leave out `custom:tenant`.
Use the smallest set the pool needs, such as `email` alone. When a client
lists no write attributes, Cognito lets it write every writable attribute,
so an empty list is as unsafe as including the tenant attribute.

Either gap, the admin scope or a writable tenant attribute, would let an
operator move their own account into another tenant.

**Managed login branding.** The pool uses Cognito's newer managed login
pages, which need a branding style assigned to each app client. Create a
managed login branding resource for the new client (it can reuse the
existing connector client's style); without one, the sign-in page does not
render for it.

**Token lifetimes and revocation.** Match the service's existing connector
client: token revocation on, user-existence errors suppressed.

## Handing back

Send the plugin maintainer the client id. Nothing else is needed, and no
secret exists to send. The maintainer adds the id to `.mcp.json` as the
first step of the release.

## What a signed-in user without access sees

Access stays invite-only. A user who signs in but has no tenant gets HTTP
403 on every request, including the MCP handshake. The plugin's `lm-doctor`
skill turns that into a plain explanation and tells the user to ask the
ThinkWork Route Optimization team that operates their customer's pilot. No
change to the service is needed for that.
