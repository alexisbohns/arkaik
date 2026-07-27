---
title: "Hosted Projects & the Agent Plane"
navTitle: "Hosted Projects"
order: 7
---

# Hosted Projects & the Agent Plane

> A how-to, not a spec. Normative detail lives in
> [services.md](spec/services.md), [mcp.md](spec/mcp.md), and
> [bundle-format.md](spec/bundle-format.md) § References.

A **hosted project** lives in your arkaik account rather than in one browser. It
is the same graph, the same format, and the same tools — but the app and a
coding agent in any repository can both read and write it, and pull requests can
move its acceptances as work ships.

Local-first projects are unchanged. Nothing here is required to use arkaik.

## The two links (read this first)

The word "link" means two different things, and you generally want both. They
are independent — either works without the other.

| | Where | What it connects |
|---|---|---|
| **`arkaik link`** | your terminal, in a code repo | that **repo → a hosted project**, so an agent working there can read and edit the map |
| **Repos** button | the app, on a hosted project card | a **repo → this project's acceptances**, so pull requests there can move statuses |

The first is the agent plane. The second is the PR automation. Set up whichever
you need.

## 1. Create a token

`/settings/tokens` → **Create token**. It is shown **once**; it is stored hashed
and cannot be recovered.

```bash
export ARKAIK_TOKEN=ark_...
```

Scopes default to `graph:read` + `graph:write`. Token management itself is
session-only, so a leaked token can never mint another or widen its own scopes.

## 2. Get a hosted project

On `/projects`, either create a project while signed in, or take a browser-held
one and click **Move to account**.

Moving is a **copy**: the local original stays where it is and the hosted copy
gets a new server-owned id (`prj_…`). Nothing is lost if you change your mind.

Hosted projects carry an **In your account** badge.

## 3. Point an agent at it

In the repository where you write code:

```bash
npx arkaik link --list                 # projects this token can reach
npx arkaik link --project prj_xxxxx    # writes docs/arkaik/arkaik.json
```

`docs/arkaik/arkaik.json` holds the project id and origin. It is **safe to
commit**; the token is only ever read from `$ARKAIK_TOKEN`, because a credential
in a repo file is a credential in a git history.

Then point any MCP host at the server:

```bash
npx -y arkaik-mcp        # picks up the link file automatically
```

The tool catalog is **identical** to repo-bundle mode — `list_nodes`,
`get_node`, `create_node` and the rest behave the same whether the graph is a
file or an account. Resolution order, if you need to override: `--bundle` always
wins; otherwise `--project` → `$ARKAIK_PROJECT` → the link file.

> A linked repo with no token **exits non-zero** rather than quietly serving a
> stale local bundle — a silent fallback is the failure an agent cannot notice.

This is the whole agent setup. The rest of this page is the PR automation, which
is optional.

## 4. Set up the GitHub App (once per deployment)

Only needed for PR-driven status changes, and only once for your whole account.

1. **New GitHub App**
   - **Webhook URL**: `https://<your-origin>/api/github/webhook`
   - **Secret**: generate one (`openssl rand -hex 32`) — required
   - **Repository permissions → Pull requests: Read-only**
   - **Subscribe to events → Pull request**
   - Leave Callback URL, Setup URL, and device flow blank; they are unused.
   - You do **not** need a private key: the webhook reads the delivery payload
     and never calls the GitHub API back.
2. Set `GITHUB_WEBHOOK_SECRET` to the same value in your host's environment, and
   **redeploy** — most platforms do not apply env changes to a running
   deployment.
3. **Install** the App on the repositories you care about.

### Checking it works

An unsigned request to the endpoint is a precise diagnostic:

```bash
curl -i -X POST https://<your-origin>/api/github/webhook \
  -H 'content-type: application/json' -d '{}'
```

| Response | Meaning |
|---|---|
| `503 webhook_not_configured` | the secret is not set (or you have not redeployed) |
| `401 invalid_signature` | **correct** — the secret is live and unsigned requests are refused |

Then in the App's **Advanced → Recent Deliveries**, redeliver the `ping`. A
**202** proves the signature *matched*, not merely that the endpoint is
reachable — GitHub signs pings too.

Verification refuses everything when no secret is configured, rather than
degrading to accepting unauthenticated writes.

## 5. Link repositories to the project

On the hosted project's card → **Repos** → enter `owner/name` and choose the
platform that repository builds for → **Link**.

The platform is the point: a PR merged in an iOS repository marks **only iOS**
shipped, with no per-PR annotation and no way to forget. The remaining platforms
then surface as a genuine parity gap on `/acceptances`, rather than false
parity. Choose **All platforms** for a repository that serves every platform —
its PRs then move the acceptance's base status.

See [Monorepos](#monorepos) below if one repository builds several platforms.

## 6. Opt the project in

Promotion is **opt-in**, per project. Without it, a PR's status is mirrored onto
the acceptance's ref but no status moves — that is the format's default
([bundle-format.md](spec/bundle-format.md) § References), and it is deliberate:
automatic promotion should be a recorded decision, not an implicit behaviour of
the tooling.

There is no UI for this yet. Open the project → **Journey** map → **Raw**, and
add `ref_policy` to the project's metadata:

```json
"project": {
  "id": "…",
  "title": "…",
  "metadata": { "ref_policy": true }
}
```

`true` selects the defaults:

| PR state | Acceptance status |
|---|---|
| opened / reopened | `development` |
| merged | `live` |
| closed without merging | *unchanged* |

To choose your own mapping, give an object instead. `null` means "recognised,
moves nothing":

```json
"ref_policy": { "github-pr": { "open": "development", "merged": "releasing", "closed": null } }
```

## 7. Ship something

Open a pull request in a linked repository whose **title or body mentions an
acceptance id**, for example:

```
Implements AC-guest-checkout
```

- on open → that acceptance moves to `development`
- on merge → `live`, on the platform that repository builds for

An agent can also attach the ref explicitly with `update_node` rather than
relying on a mention.

Guards that keep this honest:

- **archived** acceptances are never resurrected by a stale PR;
- an acceptance already at the target status is skipped, so re-runs and
  redeliveries are no-ops;
- a ref naming a platform the acceptance does not list is reported, not written;
- every promotion lands as a normal `node.status_changed` journal event with
  `github-app` as the actor — the history says what acted.

If nothing happens, **Advanced → Recent Deliveries** shows the response body,
which names what was applied or why it was skipped.

## Monorepos

A single repository that builds several platforms — `apps/ios`, `apps/webapp`,
`apps/android` under one repo — is **not yet fully handled**.

A repository can currently hold **one** link per project, so it declares one
platform. For a monorepo that leaves two imperfect choices:

- **Link with "All platforms"** — every merged PR moves the acceptance's *base*
  status. Statuses move, but per-platform parity is not tracked.
- **Link with one platform** — every PR claims that platform, including PRs that
  touched a different app. Wrong, and quietly so.

Until this is addressed, "All platforms" is the honest option for a monorepo:
it under-claims rather than mis-claims.

Two designs would fix it, neither built yet:

1. **Path-scoped links** — link the same repository several times with a path
   prefix (`apps/ios` → iOS, `apps/webapp` → Web), matching the PR's changed
   files. Needs an authenticated call to the pull-request files API, so the App
   would need a private key.
2. **Platform in the mention** — write `AC-guest-checkout@ios` in the PR. Needs
   nothing beyond the delivery payload, and is explicit about what shipped.

## Self-hosting (Inkognito)

A deployment that cannot install the arkaik GitHub App gets the same behaviour
from the CLI:

```bash
arkaik sync --promote
```

It mirrors ref status from the GitHub API using a local token, then applies the
same `computeRefPromotions` the hosted App uses — one implementation, so the two
paths cannot disagree about what a merged PR means. Run it in CI on
`pull_request` and on pushes to your default branch.

## Known gaps

- **`ref_policy` has no UI** — step 6 requires the raw bundle editor.
- **Monorepos** — see above.
- **The refs editor is read-only** — a human links a PR by mentioning the
  acceptance id; attaching a ref by hand in the app is not possible yet.
- **Hosted projects are online-only** — local-first projects still work offline;
  hosted ones do not. Export is always available.
- **`propose_idea` / `file_request` do not work against hosted projects** — the
  hosted write path has no journal-only operation yet. They are refused with an
  explicit message rather than silently dropped.
