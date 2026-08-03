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
| **Repos** button | the app, on a hosted project card | a **repo — or one folder of it — → this project's acceptances**, so pull requests there can move statuses |

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
2. Set `GITHUB_WEBHOOK_SECRET` to the same value in your host's environment, and
   **redeploy** — most platforms do not apply env changes to a running
   deployment.
3. **Install** the App on the repositories you care about.

### A private key, only if you use path-scoped links

Everything above resolves from the delivery payload, so a deployment whose
repository links each cover a whole repository never calls the GitHub API back
and needs no key. **Path-scoped links do**: deciding whether a pull request
belongs to `apps/ios` or `apps/webapp` means reading which files it changed, and
that list is not in the payload. See [Monorepos](#monorepos).

If you want them: **Generate a private key** in the App's settings, then set
both `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` (the `.pem` contents,
verbatim, `-----BEGIN` and `-----END` lines included) and redeploy.

- **It has to be that key, and it has to be RSA.** A GitHub App JWT is RS256, so
  an Ed25519 or EC key — what a TLS or SSH key pasted into the wrong secret
  looks like — cannot sign one. Both parse as valid PEM files, so arkaik checks
  the key *type* and reports it by name before signing anything, rather than
  crashing mid-delivery on one and sending a signature GitHub answers `401` to
  on the other.

- **No permission change and no reinstall.** The pull-request files endpoint,
  `GET /repos/{owner}/{repo}/pulls/{number}/files`, is a sub-resource of a pull
  request and needs **Pull requests: Read** — the permission step 1 already
  asks for. arkaik reads only each entry's `filename` and `previous_filename`,
  never a blob, so no Contents permission is involved. It does not take that on
  trust either: the token exchange asks for `pull_requests: read` explicitly and
  checks the response granted it, so a misconfigured App is reported by name.
- **The App has to be installed**, not merely configured as a repository
  webhook — the changed-files call is authenticated as the *installation*, whose
  id arrives in the delivery. A plain repository webhook carries none, and the
  delivery says so instead of guessing a platform.
- If your host can only store single-line secrets, literal `\n` escapes in the
  key are accepted and converted. A base64-encoded copy of the whole file is
  **not**, and is refused with a message saying so rather than a crypto stack
  trace.
- Missing key, missing App id, or no installation id are all **deterministic**:
  the delivery reports the exact variable to set and moves nothing. No retry can
  set an environment variable, so it is not retried. A GitHub 5xx, a rate limit
  or a network failure is the opposite — the delivery fails with a 500 so
  GitHub's redelivery can redo it, and no partial write is left behind, because
  the file list is read before anything is written.

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

On the hosted project's card → **Repos** → enter `owner/name`, leave the path
box empty, and choose the platform that repository builds for → **Link**.

The path box is for monorepos, and only for them: a link is identified by
**(repository, path)**, so one repository can be linked several times — `apps/ios`
as iOS, `apps/webapp` as Web. An empty path is the whole repository, which is
what every link made before this existed already means. See
[Monorepos](#monorepos).

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
nobody — but that delivery promotes nothing from it. See the refusal note in
[step 7](#7-ship-something) for what "that delivery" does and does not cover.)
It does **not** fall back to an
unscoped ref: an unscoped ref moves the base status, and would mark that
acceptance shipped on *web*, which is the opposite of what linking the repo to
iOS asked for. A missing claim is recoverable; a wrong one looks like success.

> **"All platforms" is a claim, not a shrug.** The base status is what every
> platform without its own entry falls back to, so moving it says *every one of
> those shipped* — and when nothing is pinned, that is all of them and
> `/acceptances` shows no parity gap. If a repo does not really
> ship all platforms together, link each app's folder to its own platform — see
> [Monorepos](#monorepos).

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
- on merge → `live`, on the platform that repository builds for — or, in a
  [monorepo](#monorepos), the platform of the folder the PR touched

### Naming the platform in the mention

Add `@web`, `@ios` or `@android` to say what shipped, regardless of what the
repository link declares or which folder the PR touched:

```
Implements AC-guest-checkout@ios
```

- **an explicit `@platform` always wins.** The whole precedence, once: the
  `@platform` in the mention, then the [path-scoped link](#monorepos) the pull
  request's changed files landed in, then the repository's own link. A bare
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
  one it is worse, not better: `{web: "live"}` with a base of `backlog` is a
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
  - a **path-scoped link** is a standing request to scope every pull request, so
    when that request cannot be answered — the pull request touched none of the
    linked paths and no whole-repository link exists, or the changed files could
    not be read at all — nothing is attached and nothing is promoted. The
    `warnings` line quotes *every* configured prefix, so a typo'd `apps/i0s` is
    visible in the one place you can see it;
  - a refusal covers **promotion**, not just attachment. If the acceptance
    already carries a ref for that pull request, the ref keeps being mirrored —
    a body edit must not freeze it at a stale status — but *that delivery*
    promotes nothing from it, on the first delivery or on any redelivery. It is
    scoped to the delivery, not a quarantine: the ref stays attached and stays
    promotable, so `arkaik sync --promote` — which computes promotions over the
    whole bundle, with no notion of a delivery — can still move a status from
    it. If you do not want that, remove the ref;
- an unknown `@platform` suffix is reported, never treated as a bare mention —
  and if the same PR *also* mentions that acceptance bare (`AC-x` in the title,
  `AC-x@ios-tablet` in the body), the bare mention is **not** used as the typo's
  fallback either. The refusal belongs to the **acceptance id**, not to what
  else the PR happens to say about it: a PR whose only reference is
  `AC-x@ios-tablet` refuses in exactly the same way, rather than falling through
  to the repository link and promoting whatever it declares. Nothing is
  attached, nothing moves, and any ref the PR already left on that acceptance
  is not promoted from on that delivery. Fix the suffix and edit the PR: an edit
  re-delivers;
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
`apps/android` under one repo — is linked **once per app**, with the folder that
app lives in:

| Repository | Path | Platform |
|---|---|---|
| `acme/pbbls` | `apps/ios` | iOS |
| `acme/pbbls` | `apps/webapp` | Web |
| `acme/pbbls` | `apps/android` | Android |

Then a PR that mentions an acceptance and touches `apps/ios/…` marks **iOS**
shipped, with no suffix to write and nothing to remember. A PR touching both
`apps/ios` and `apps/webapp` marks both.

**And it follows the PR as it changes.** The folders a pull request touches are
edited while it is open, so what the paths decided last time is not evidence
this time. If a PR that touched both apps drops its webapp commits before
merging, the web ref arkaik attached earlier is **frozen**: nothing about the
pull request justifies it any more, so the delivery stops refreshing it and
promotes nothing from it. It is **not deleted** — the acceptance still shows a
ref recording that this PR once touched web, at the status it was last honestly
mirrored to. It simply stops moving. The delivery response says which scope
froze and why.

**The exact rule, because the edges matter.** For an acceptance the pull request
*currently* names, a ref is mirrored and promoted from while **any** live source
still names its platform: an `@platform` in the PR's current title or body, the
path-scoped links its current changed files land in, or — only when *no*
path-scoped link matched — the repository link. (Once a path-scoped link has
matched, the whole-repository link is not consulted: it is the fallback for
"anything I did not scope", and these files *were* scoped.) A platform no live
source names freezes. Four consequences worth knowing:

- **freezing is not deletion, and it is not a quarantine.** A frozen ref stops
  being carried forward — most importantly, it is never upgraded to `merged` —
  so it cannot become a standing `live` promotion that `arkaik sync --promote`
  fires later. But if an *earlier*, truthful delivery had already mirrored it to
  a promotable state, it stays promotable out of band: freezing stops a ref
  moving, it does not undo a state already written. If you do not want that,
  remove the ref;
- **a `@platform` you edited out of the body is withdrawn.** arkaik does not
  record which source attached a ref, so a `web` ref you asked for by hand is
  indistinguishable from one inferred from a file list — and once the body stops
  saying `@web` and nothing else covers web, it freezes like any other. Editing
  the PR is how you withdraw a scope as well as how you add one; writing `@web`
  back starts it moving again on the next delivery;
- **nothing is ever frozen on a partial file list** (see the truncation and
  time-budget notes below). A list arkaik could not finish reading can show a
  platform is *there* and can never show it is *gone*, so such a delivery
  mirrors and promotes exactly as it would have before path-scoped links
  existed. Incomplete evidence never narrows anything;
- **an acceptance the PR stopped naming altogether is left alone.** Its refs
  keep being mirrored and keep promoting; a body edit must not undo a promotion
  that already landed.

This needs the App's private key ([step 4](#a-private-key-only-if-you-use-path-scoped-links));
whole-repository links do not, and are unaffected by it being absent.

**How a path is matched:**

- **paths are repository-root-relative**, as GitHub writes them. `/apps/ios/`,
  `./apps/ios` and `apps//ios` are all normalised to `apps/ios` when saved, so
  one folder is one link and not three; a `..` segment is refused outright;
- **whole folders only.** `apps/ios` matches `apps/ios/main.swift` and the file
  `apps/ios` itself, and never `apps/ios-legacy/main.swift` or `apps/ios2/x.ts`;
- **case-sensitively**, because git paths are (repository *names* are not, and
  are lowercased for you) — `Apps/iOS` is a different path from `apps/ios`, and
  a link written the wrong way round matches nothing at all;
- **every changed file counts**, including deleted ones and both halves of a
  rename: moving a file *out of* `apps/ios` is a change to `apps/ios`;
- **the most specific link wins per file.** With both `apps` → Web and
  `apps/ios` → iOS, a file under `apps/ios` is iOS only. Adding a more specific
  link can therefore only ever narrow a claim, which is what refining a
  configuration should do;
- a path-scoped link set to **All platforms** matches without naming a platform
  — how you say "changes under `packages/shared` ship everywhere" — so
  precedence falls through to the whole-repository link behind it, or to an
  unscoped ref if there is none. Re-read the box in [step 5](#5-link-repositories-to-the-project)
  before choosing it. If the *only* links a PR's files landed in are ones like
  this **and** the file list was partial, the delivery refuses instead of
  falling through: a page arkaik never read could well land in a link that does
  name a platform, and answering that with an unscoped ref is the largest claim
  in the system made from a blind spot;

**What happens when the paths do not decide** — [precedence](#naming-the-platform-in-the-mention)
is mention, then path, then link:

- **a `@platform` in the PR still wins**, and is now an override rather than the
  main event: `AC-guest-checkout@web` scopes to web whatever folder was touched;
- **anything outside every path** falls back to a link for the same repository
  with an *empty* path, if you made one. That link is your stated answer to
  "everything I did not scope is this" — a root-level release PR, say;
- **with no such fallback link, nothing moves**, and the delivery response says
  which paths are configured and that none of them matched. It does not borrow
  a platform from anywhere: an unscoped ref would move the base status and mark
  every platform shipped, which is the largest claim in the system offered in
  answer to "I do not know";
- **the same applies when the changed files cannot be read** — no private key,
  no App installation, a revoked installation. That is reported with the exact
  variable or setting to fix, and no retry happens, because none would help.
  Transient failures (a GitHub 5xx, a rate limit, a dropped connection) are
  retried by GitHub instead, and nothing is written until the file list is in
  hand;
- **a PR that changes more files than GitHub will list** (its cap is 3000) is
  matched against the partial list. A platform found that way is real — a
  missing file can only remove a match, never invent one — so the delivery
  proceeds and warns. If *nothing* matched in a partial list, that is not
  evidence of anything and the delivery refuses instead; and nothing is frozen
  from a partial list either. The same "partial list" treatment applies if
  reading the pages takes too long, or if GitHub returns an entry arkaik cannot
  read. The delivery response names **which** of the three happened, rather than
  blaming the file cap for all of them;
- **the time budget bounds the file-list read, and only that.** Resolving the
  changed files — the token exchange and every page — has one 9-second budget,
  and a page is started only if a full request timeout still fits inside it, so
  that part cannot overrun a 10-second serverless limit. The database writes
  that follow are *not* inside it, so the function as a whole still can run
  long; what the budget buys is that a slow GitHub is not the thing that does
  it. Nothing is written before the file list is in hand, so a kill during the
  read leaves no partial state;
- **a stored path arkaik cannot read** — a `..` segment, which the link form
  refuses but a restored or hand-edited row can still carry — refuses the whole
  repository's links for that project and quotes the offending value. It is
  *not* read as an empty path: an empty path means the whole repository, which
  would turn the one row nobody can interpret into the broadest claim in the
  configuration.

**Nothing is fetched unless it is needed.** No path-scoped link on the
repository means no API call at all — that is every deployment that existed
before this feature. Even with them, a PR that mentions no acceptance costs
nothing: the vast majority of pull requests in a monorepo never touch this code
path.

A PR whose mentions all carry an explicit `@platform` *does* cost one call, even
though the suffix alone decides the scope. The paths are one of the sources that
keep an existing ref moving, and a delivery that read nothing cannot tell a
withdrawn scope from an unread one — so it would freeze nothing and leave a
stale ref being refreshed to `merged` and promoted. One request per mentioning
delivery is the price of that; it is bounded, and its failure is reported rather
than retried.

The plain-`@platform` arrangement still works and is still supported — link the
monorepo with an empty path and "All platforms", and suffix every PR — but the
suffix is then load-bearing, and forgetting it makes the largest claim the
automation can make rather than the smallest. Path-scoped links exist so that
nobody has to be that careful.

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
Repository links play no part either, path-scoped or not — they are how the
*webhook* decides which project and platform a delivery is about, and `sync`
scopes each promotion by the `platform` already on the ref. Attach the ref once
(by hand, or with `update_node` from an agent) and `sync` keeps it mirrored from
then on.

## Known gaps

- **`ref_policy` has no UI** — step 6 requires the raw bundle editor.
- **The refs editor is read-only** — a human links a PR by mentioning the
  acceptance id; attaching a ref by hand in the app is not possible yet.
- **Hosted projects are online-only** — local-first projects still work offline;
  hosted ones do not. Export is always available.
- **`propose_idea` / `file_request` do not work against hosted projects** — the
  hosted write path has no journal-only operation yet. They are refused with an
  explicit message rather than silently dropped.
- **A refusal, a partial file list, and a freeze scope the *delivery* — not the
  ref.** A ref a webhook declined to promote from is still attached, and if an
  earlier delivery had already mirrored it to a promotable state it is still
  promotable, so `arkaik sync --promote` can move a status from it later.
  Freezing prevents that state ever being *reached* by a later delivery; it
  cannot unwrite one. Refs carry no record of the delivery that attached them,
  so there is nothing for `sync` to filter on; closing this properly means
  either recording that on the ref (a bundle-format change) or removing the ref,
  and removing is what freezing deliberately replaced — it would need a claim
  that a platform is *absent*, which a partial file list can never support.
