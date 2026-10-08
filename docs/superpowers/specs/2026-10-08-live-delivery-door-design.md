# A door to `live`: the `release:append` scope and the delivery lifecycle's last hop

**Issue:** #424 · **Date:** 2026-10-08 · **Status:** approved

## Problem

`ref_policy` can carry an acceptance to `releasing` on a merge. Nothing can carry
it to `live`, because nothing in arkaik knows a deployment happened.
`release.tagged` is a marker only — `computeChangelog` slices history around it,
and no code path promotes a status from it. The last hop of the lifecycle is the
one hop a human makes by hand, on every acceptance, on every platform.

```
idea → backlog → development → releasing → live
                 └── PR open ──┴─ merged ─┘        ← ref_policy does this
                                          └── ??? ─┘
```

A merge is not a release. Web goes live when the production deploy succeeds;
iOS and Android go live when a store **accepts** a submitted version, which can
be days later and is not an event any repository emits.

The signals all live in CI, and CI is where a broad credential must not go.
`alexisbohns/pbbls` — the project that surfaced this — is a public repository.
`graph:write` in its Actions secrets is the ability to rewrite the whole product
graph. `quality:append` (#406) is the credential class that belongs there: one
route, one kind of write, nothing worth stealing beyond an observation you would
have written anyway. The delivery lifecycle needs its sibling.

Two things compound the gap:

- **The default policy over-claims.** `ref_policy: true` maps merged → `live`.
  That is exactly the claim a merge cannot make, and it is what every opted-in
  project says today.
- **`live` is re-earned, not kept.** `computeRefPromotions` writes whatever the
  mapping says regardless of the current status (only `archived` is refused).
  Once `live` is reachable, a follow-up PR touching a live acceptance pulls that
  platform back to `development`, which shows a false parity gap on every
  bugfix. The issue flagged this as a decision to settle, not a discovery to
  make.

## Settled decisions

1. **Live is kept.** `live` becomes terminal for ref promotions, the way
   `archived` already is. A later PR naming a live acceptance attaches its ref
   and mirrors its external status, but moves nothing on a platform that reads
   `live`; the skip is reported with a new reason, `live`. Users still have the
   feature, so the Journey map and the parity report stay truthful. Only a human
   edit moves a status off `live`. Rejected: re-earning `live` (false parity
   gaps on every follow-up PR), and a per-project knob (a decision nobody wants
   to make per project).

2. **The default policy stops claiming `live` on merge.** `DEFAULT_REF_POLICY`
   maps merged → `releasing` for `github-pr` and `gitlab-mr`. A project that
   wants merge-means-live writes it explicitly:
   `{ "github-pr": { "open": "development", "merged": "live", "closed": null } }`.
   Projects opted in with `true` see merged acceptances land on `releasing` from
   their next delivery; nothing already written is rewritten.

3. **A third scope and a dedicated route**, not a narrowed `mutations` route
   (two postures in one route, and a 403 that has to explain which caller it is
   talking to) and not a GitHub App `deployment_status` listener (web-only, and
   resolving a deploy sha to acceptances is its own piece — a follow-up once the
   door exists). iOS decides the shape: store approval is asynchronous and no
   repository event marks it, so the route accepts a late, out-of-band claim.

4. **Platform is required.** An unscoped `live` would move the base status,
   which marks every platform without an entry of its own as delivered — the
   strongest claim in the system, and the last one a CI job should make by
   omission. The route never touches `node.status`.

5. **Already live is a no-op, not a refusal.** A re-run deploy job must get a
   200. The entry is reported under `skipped` with `already_live`.

6. **The write is an ordinary mutation.** It goes through `applyMutation` —
   row lock, validators, entity limits, version bump — and lands as an ordinary
   `node.status_changed` carrying `platform`, so every projection that reads
   status today reads this one with no new code. What is new is a `detail` on
   that event (the evidence) and an actor CI can be told apart by.

## Design

### Scope

`release:append` joins `TOKEN_SCOPES` in `lib/services/tokens.ts`. Never a
default. `components/settings/TokenManager.tsx` gets one more checkbox:
*Mark acceptances live* — "nothing else: no reads, no other writes". The scope
is accepted on exactly one route; every graph read and every other write 403s
with the scope it would have needed, as `quality:append` does today.

### Route: `POST /api/graph/projects/{id}/live`

**Auth.** `graph:write` or `release:append`. A caller holding neither gets
`403 { error: "insufficient_scope", required: "graph:write" }` — the broad
scope named for the broad ask, same as the quality route.

**Body.** Strict; 400 on anything else.

```json
{
  "entries": [
    { "node_id": "AC-guest-checkout", "platform": "ios", "detail": "App Store 2.4.1 (build 318)" }
  ]
}
```

- `entries`: non-empty array, at most 50 (matching the quality route's cap).
- `node_id`: non-empty string.
- `platform`: required; one of the app's platforms (`lib/config/platforms.ts`,
  the same list the webhook validates mentions against).
- `detail`: optional; non-empty string when present, at most 2000 characters.
  Free-form by convention: the deployment URL, the store build number — the one
  thing the writer always knows and pays nothing to say.

The shared `MAX_BUNDLE_BYTES` cap applies, checked on the raw text before
`JSON.parse`, as on every other write route.

**Pure core: `lib/services/graph/live.ts`.** DB-free, no `server-only`, the
quality-events seam: the route reads the project and supplies the nodes.

- `parseLiveEntries(body: unknown): LiveEntry[] | { error: string }` — shape.
- `planLive(nodes: readonly Node[], entries: readonly LiveEntry[]): LivePlan` —
  the decision. Per-entry refusals, all-or-nothing:

  | reason | when |
  |---|---|
  | `unknown_node` | no node with that id |
  | `not_acceptance` | the node is any other species — this route moves acceptances and nothing else |
  | `archived` | the node's base status is `archived`, or the platform's own entry is — a deploy must not resurrect a deliberate end state, on the whole acceptance or on one platform |
  | `platform_not_applicable` | `node.platforms` does not list the platform; reported, never guessed (the webhook's posture) |

  Not a refusal: `already_live` — `resolvePlatformStatus(node, platform)` is
  already `live`. Reported under `skipped`, the entry writes nothing.

  Everything else folds into **one `update_node` op per node**, patching
  `metadata.platformStatuses[platform] = "live"` and nothing else. Two entries
  for the same node fold into one patch, each step reading the node as the
  previous one left it, exactly as the webhook folds promotions — `applyOps`
  replaces `metadata` wholesale, so two ops built from the same pre-write node
  would erase each other. A duplicate (`node_id`, `platform`) pair within one
  batch is a 400.

  The plan carries `applied: [{ node_id, platform, from, to: "live" }]` for the
  response, with `from` the resolved platform status before the write.

**The write.** `applyMutation` gains one optional input, `annotations`:
`{ node_id, platform, detail }[]`. After `applyOps` and before
`toJournalEvents`, the store stamps `detail` onto each derived
`node.status_changed` whose `node_id` and `platform` match. A `detail` with no
matching event is dropped silently — it can only happen if the plan and the
diff disagree, and the plan is computed from the same nodes. No other route
passes annotations; the generic mutations route is unchanged.

**Actor.** A token caller writes as `arkaik-ci`; a session caller as
`arkaik-app`. The route is the deployment door; an agent that wants to mark an
acceptance live by hand already has `update_node` and writes as
`arkaik-agent` through it.

**Response.**

```json
{
  "version": "42",
  "applied": [{ "node_id": "AC-guest-checkout", "platform": "ios", "from": "releasing", "to": "live" }],
  "skipped": [{ "index": 1, "node_id": "AC-search", "platform": "web", "reason": "already_live" }],
  "events": [ /* the node.status_changed events written, detail included */ ]
}
```

Refusals: `422 { error: "refused", refusals: [{ index, node_id, platform, reason }] }`.
Store failures map as on the mutations route (`not_found` → 404, `limit` → 403,
`validation` → 422, `mutation` → 422).

### The `detail` on `node.status_changed`

`NodeStatusChangedEventSchema` already accepts unknown keys; `detail` becomes an
explicit optional string so the contract is written down.
`docs/spec/journal.md` records it beside the trip's `detail` convention, and
names `arkaik-ci` among the actors. `lib/prompts/generated/schema.ts` is
regenerated. `components/journal/describe-event.ts` shows the detail text
under a status change when present, so the deploy URL or build number is
visible where the status change is; the CLI's `render-event.ts` appends it
to the same line.

### Live is kept: the guard in `computeRefPromotions`

In `packages/schema/src/promote.ts`, beside the `archived` guard: when
`currentStatus(node, ref.platform)` is `live` and the mapped target is not,
push `{ reason: "live" }` to `skipped` and continue. The check is on the status
the ref *targets* — the platform entry for a scoped ref, the base for an
unscoped one. A base move on a node whose platform entry says `live` leaves that
entry alone; that is the overlay's existing semantics, now stated in the test.
The guard lives in the schema package, so `arkaik sync --promote` and the
GitHub App get it together; the webhook's warning filter keeps reporting only
`platform-not-applicable`, since a `live` skip is a deliberate policy outcome
like `archived`.

### Default policy

`DEFAULT_REF_POLICY` maps merged → `releasing`. Updated wherever the default is
stated: `promote.ts`'s header, `docs/hosted-projects.md`'s table and step 7,
`docs/spec/bundle-format.md`'s promotion-policy row, and the promote tests.

### Docs

- `docs/hosted-projects.md`: a sibling of "A token for CI: `quality:append`" —
  *A token for deployments: `release:append`* — with the curl call and one
  recipe per platform: a step after the production web deploy; a step at the end
  of the Android release workflow once the track is promoted; a scheduled job
  that polls App Store Connect and posts when `appStoreState` reads
  `READY_FOR_SALE`. Each recipe is a sketch of where the call goes, not a
  finished workflow.
- `docs/spec/services.md`: the route row, the scope list, the 403 wording.
- `docs/spec/journal.md`: `detail` on `node.status_changed`; `arkaik-ci`.

### Tests

- `tests/schema/promote.test.js`: a live platform entry is not demoted by a
  reopened PR (skip reason `live`); a live base is not demoted by an unscoped
  ref; a base move leaves a live platform entry alone; the default now says
  `releasing`; `releasing` → `live` under an explicit mapping still promotes.
- `tests/services/live.test.js` + `tests/services/load-live.js`: the DB-free
  core — every parse error, every refusal reason, `already_live` as a skip,
  folding of two platforms into one op, the duplicate-pair 400.
- `tests/services/graph-api.test.js`: 403 with neither scope; a
  `release:append`-only token succeeds, and the same token 403s on a graph
  read and on the mutations route; the event carries `platform`, `detail` and
  actor `arkaik-ci`; a re-run returns `already_live` and bumps nothing.
- `tests/services/token-auth.test.js`: `release:append` is a recognised scope
  and not a default.

### Out of scope, named

- Wiring the pbbls workflows. Follows in that repo once the door exists.
- A GitHub App listener for `deployment_status` that resolves a deploy sha to
  merged refs. Additive, web-only, its own piece.
- Rolling the base status up to `live` when every platform entry is live. The
  overlay already resolves every platform correctly; the base stays what the
  last unscoped move made it, as it does for ref promotions today.
- A CLI or MCP verb for marking live. CI calls the route with curl.

## Stack

Two parts, each a PR with its own Lab Note (both change what a user sees):

1. **`live-1-schema`** — the live guard and its skip reason, the default
   policy change, `detail` on `NodeStatusChangedEventSchema`, the journal spec
   and bundle-format rows, regenerated artifacts, promote tests.
2. **`live-2-door`** — the scope, the pure core and its tests, the store
   annotation, the route and its tests, the token checkbox, the journal row
   detail, hosted-projects and services docs.
