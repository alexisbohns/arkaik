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
parity. Choose **All platforms** for a repository that genuinely serves every
platform at once: its PRs then move the acceptance's *base* status, which marks
**every platform that has no per-platform status of its own** as shipped —
unless a PR names a platform itself (see [step 7](#7-ship-something)). A
platform already pinned in `platformStatuses` keeps what it was pinned to; the
base status is only ever the fallback, which is exactly why moving it reaches so
far.

If a PR in that iOS repository mentions an acceptance that does **not** list iOS
— a web-only acceptance, say — the delivery **attaches no ref and promotes
nothing**, and says so in its `warnings`. (If that acceptance already carries a
ref for the pull request, the ref keeps being mirrored — a stale status helps
nobody — but nothing is promoted from it.) It does not fall back to an unscoped
ref moves the base status and would mark that acceptance shipped on *web*, which
is the opposite of what linking the repo to iOS asked for. A missing claim is
recoverable; a wrong one looks like success.

> **"All platforms" is a claim, not a shrug.** The base status is what every
> platform without its own entry falls back to, so moving it says *every one of
> those shipped* — and when nothing is pinned, that is all of them and
> `/acceptances` shows no parity gap. If a repo does not really
> ship all platforms together, either link it to one platform or write
> `@platform` in every PR — see [Monorepos](#monorepos).

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

### Naming the platform in the mention

Add `@web`, `@ios` or `@android` to say what shipped, regardless of what the
repository link declares:

```
Implements AC-guest-checkout@ios
```

- **an explicit `@platform` always wins over the repository's link** — a bare
  mention in an iOS-linked repo still means iOS, but `@web` there means web;
- **one PR can name several** — `AC-guest-checkout@ios and AC-guest-checkout@android`
  marks both platforms shipped and leaves the third as a genuine parity gap;
- writing both `AC-guest-checkout` and `AC-guest-checkout@ios` in one PR means
  **iOS only** — the explicit scope absorbs the bare mention rather than also
  moving the base status;
- **an unknown platform is reported, not guessed** — `AC-guest-checkout@windows`
  moves nothing at all and says so in the delivery response, because asking for
  a platform and quietly getting the repo default is worse than doing nothing.
  The suffix has to match a platform name **exactly**: `@android-tv`,
  `@android_tv`, `@ios.tv`, `@ios/ipad` and `@ios2` are all reported as written,
  never read as `android` or `ios`. Ordinary prose around the mention is fine —
  `AC-x@ios.`, `(AC-x@ios)` and `` `AC-x@ios` `` all mean iOS;
- **`\@` works too** — writing `AC-guest-checkout\@ios` to stop GitHub rendering
  `@ios` as a user mention still scopes to iOS, rather than silently becoming an
  unscoped mention;
- **naming no platform is the biggest claim, not the smallest** — an unscoped
  mention moves the acceptance's *base* status, which every platform without its
  own entry falls back to. On a three-platform acceptance with nothing pinned
  that marks all three delivered and leaves no parity gap. On a *partly* shipped
  one it is worse, not better: `{web: "live"}` with a base of `prioritized` is a
  real parity gap, and moving the base to `live` makes iOS and Android inherit
  it, so the gap **disappears**. Either way the delivery response names the
  platforms it is about to mark, one line per acceptance.

An agent can also attach the ref explicitly with `update_node` rather than
relying on a mention.

Guards that keep this honest:

- **archived** acceptances are never resurrected by a stale PR;
- an acceptance already at the target status is skipped, so re-runs and
  redeliveries are no-ops;
- **a platform that was asked for and cannot be honoured is refused, never
  downgraded** — this is the rule the other platform guards are instances of.
  An unscoped ref moves the *base* status, which marks every platform without a
  per-platform status of its own shipped, so falling back to one whenever a
  scope cannot be resolved would make the largest possible claim at the moment
  arkaik is least sure. It does not:
  - a `@platform` you asked for **explicitly** stays on the ref, and the
    promotion is reported and refused, rather than moving the base status;
  - a **repository link** naming a platform the acceptance does not list
    attaches no ref at all and promotes nothing, and the `warnings` line names
    both the link's platform and the acceptance's actual ones;
  - a refusal covers **promotion**, not just attachment. If the acceptance
    already carries a ref for that pull request, the ref keeps being mirrored —
    a body edit must not freeze it at a stale status — but no status is promoted
    from it, on the first delivery or on any redelivery;
- an unknown `@platform` suffix is reported, never treated as a bare mention —
  and if the same PR *also* mentions that acceptance bare (`AC-x` in the title,
  `AC-x@ios-tablet` in the body), the bare mention is **not** used as the typo's
  fallback either. Nothing is attached and nothing moves. Fix the suffix and
  edit the PR: an edit re-delivers;
- every promotion lands as a normal `node.status_changed` journal event with
  `github-app` as the actor — the history says what acted.

If nothing happens, **Advanced → Recent Deliveries** shows the response body,
which names what was applied, why it was skipped, and any `warnings` — that is
where an unknown platform suffix is quoted back to you, where an unscoped
promotion tells you which platforms it is about to mark shipped, and where a
refused scope names what it refused and why.

A refusal plans no **promotion** for that acceptance, and attaches no new ref.
It is not always zero ops: if the acceptance already carries a ref for that pull
request, the mirror refresh is still planned, so `applied` can be non-zero for a
delivery that moved no status at all. When the refused acceptance is the only
thing the pull request named and it carried no ref yet, the outcome reads

```json
{ "applied": 0, "skipped": "an acceptance was named, but no platform scope could be honoured", "warnings": ["…"] }
```

When the **same** pull request also moved another acceptance, `applied` is
non-zero and there is no `skipped` at all — the refusal then shows up **only**
in `warnings`, beside a delivery that otherwise looks like a plain success. So
`warnings` is the field to read, not `skipped`: a non-empty `warnings` means
something was not honoured whatever `applied` says.

The first thing to check there is the repository link itself: a delivery whose
repository no project has linked answers

```json
{ "status": "ok", "outcomes": [], "skipped": "no project has linked acme/webapp" }
```

which is almost always a typo in **Repos**, or a link that was never made.

## Monorepos

A single repository that builds several platforms — `apps/ios`, `apps/webapp`,
`apps/android` under one repo — is **half handled**.

A repository can hold **one** link per project, so it declares one platform.
The way to work with that today:

**Link the monorepo with "All platforms", and scope every PR with `@platform`.**

```
Implements AC-guest-checkout@ios
```

The link then contributes no platform of its own, and every PR says what it
actually shipped. That is honest per PR rather than honest on average, and it
costs one suffix.

> **The suffix is required, not optional.** A PR that forgets it moves the
> acceptance's *base* status, and the base status is the fallback for every
> platform that has no entry of its own — so one unscoped merge in a monorepo
> marks the acceptance **delivered on web, iOS and Android at once** (on every
> one of them that has no entry of its own, which for a fresh acceptance is all
> of them), and `/acceptances` reports no parity gap. If some of them *were*
> pinned, the merge instead erases the parity gap those pins were recording.
> It does not under-claim; it is the
> largest claim the automation can make. The delivery response carries a
> `warnings` line naming exactly which platforms an unscoped promotion just
> marked shipped — read it in **Recent Deliveries** if a merge looks too good.

If forgetting the suffix is likely, link the repo to the **one** platform whose
PRs dominate instead: a wrong single-platform claim is still wrong, but it is
one platform wrong rather than all of them, and the others stay visible as a
parity gap. Acceptances that do not list that platform are then left alone
entirely — the delivery reports the mismatch instead of falling back to an
unscoped ref — so the blast radius of the wrong link is smaller again.

The remaining gap is **inferring** the platform instead of writing it:

- **Path-scoped links** — link the same repository several times with a path
  prefix (`apps/ios` → iOS, `apps/webapp` → Web) and match the PR's changed
  files, so nobody has to remember the suffix. **Not built**: it needs an
  authenticated call to the pull-request files API, so the App would need a
  private key.

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

What it does **not** do is read PR text: `sync` refreshes refs that already
exist, so neither a bare mention nor an `@platform` suffix attaches anything.
Attach the ref once (by hand, or with `update_node` from an agent) and `sync`
keeps it mirrored from then on.

## Known gaps

- **`ref_policy` has no UI** — step 6 requires the raw bundle editor.
- **Monorepos infer nothing** — `@platform` in the mention works; path-scoped
  links, which would deduce the platform from the PR's changed files, do not
  exist. See [Monorepos](#monorepos).
- **The refs editor is read-only** — a human links a PR by mentioning the
  acceptance id; attaching a ref by hand in the app is not possible yet.
- **Hosted projects are online-only** — local-first projects still work offline;
  hosted ones do not. Export is always available.
- **`propose_idea` / `file_request` do not work against hosted projects** — the
  hosted write path has no journal-only operation yet. They are refused with an
  explicit message rather than silently dropped.
