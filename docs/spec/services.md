---
title: "Spec: Services (Publik & Synk)"
navTitle: "Services"
order: 4
icon: server
---

# Services — Publik & Synk

> Status: **Implemented (M4)** — the free surface is live: `app/api/publik` + `app/api/synk` route handlers, `lib/services/`, Auth.js at `auth.ts`, migrations under `db/migrations/`, and the client sync engine in `lib/sync/`. Basik/Klub monetization (M5) remains unbuilt and is gated behind the Core Product phases (vision.md § Roadmap). This document remains the normative contract.
> The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119.

## Scope

M4 delivers the **free service surface** on arkaik-hosted infrastructure:

| In scope (M4) | Out of scope (M5+) |
|---|---|
| **Publik** — anonymous snapshot sharing with owner-key deletion | Payments, pricing page, Basik/Klub gating (Stripe) |
| **Synk** — accounts + one-way interval JSON backups with 7-day retention | Real-time sync, multi-device merge (Basik/Klub) |
| Tier *enforcement points*, config-driven, defaulting to Synk limits | Server-side ref integrations (Klub differentiator) |
| Inkognito redefined as full-stack self-hosting (see below) | Hosted asset buckets / `pack` upload path |

Three hard boundaries, inherited from [vision.md](../vision.md) and [journal.md](journal.md), that no M4 implementation may cross:

1. **The browser is the source of truth for every tier.** The server stores backups and shares; it is never the system of record. No server-side mutation of bundles beyond validated storage.
2. **No re-projection.** The server never derives a snapshot from a journal or vice versa. It stores what the client sent, verbatim (minus the Publik journal strip below).
3. **No event-sourcing promises.** M4 sync is whole-bundle backup. The journal rides inside the bundle as opaque history; journal-based merge is a Basik/Klub design problem for M5+.

> ### Boundary 1 no longer holds for hosted projects — decision record
>
> **Hosted projects (`graph_projects`, migration 008) deliberately cross boundary 1.**
> For a project in an account, the server *is* the system of record, and it *does*
> mutate bundles: `applyMutation` applies ops under a row lock, and the GitHub App
> promotes acceptance statuses from pull-request events with no browser involved.
>
> This is recorded rather than quietly edited because boundary 1 is load-bearing
> everywhere else, and it still holds everywhere else. Synk and Publik are
> unchanged: they remain backup and share, storing what the client sent. Boundaries
> 2 and 3 are untouched even for hosted projects — the server derives *events from
> the diff it just applied*, which is emission, not re-projection, and there is
> still no merge.
>
> **Why the boundary was worth crossing.** The browser cannot be the system of
> record for a graph that a coding agent in any repository, and a webhook GitHub
> calls, both write to. Keeping it there would have required two-way sync, conflict
> resolution and merge — the M5+ problem boundary 3 defers — to deliver a feature
> whose whole point is that there is one copy.
>
> **What still holds, and is what "validated storage" was protecting.** Every
> server mutation passes the same `validateBundle` the CLI and MCP use, in the same
> transaction, and is refused whole on any error. Every change lands as an ordinary
> journal event with a real actor (`github-app` for the App), so the history says
> what acted. The format stays portable and export is always available: a hosted
> project can be exported and re-imported as a local one at any time.
>
> **The cost, stated plainly:** hosted projects do not work offline. Local-first
> projects still do, and remain the default.
>
> See [hosted-projects.md](../hosted-projects.md) for the how-to and
> [bundle-format.md](bundle-format.md) § References for the promotion rules.

## Backend — Decision Record

**Chosen: Vercel-native.** Next.js route handlers under `app/api/` for compute, **Postgres (Neon via Vercel)** for all storage. No Supabase.

- One store: snapshots are ≤ 5 MB JSON (the app's own import cap), which fits `jsonb` rows comfortably — no blob store needed in M4. Assets travel inside the bundle as data URIs (the only form the app produces today, capped at 2 MB each); a hosted bucket becomes relevant only with M5 asset uploads.
- Auth is **Auth.js (NextAuth v5)** with the Postgres adapter — see Synk below.
- Consequence, recorded honestly: the original "Inkognito = BYO Supabase provider" framing is superseded, because there is no Supabase implementation to point a sovereign user at. Inkognito is redefined below.
- Everything under `app/api/`, `db/`, and `lib/services/` is **AGPL-3.0** (services side of the license split, [toolchain.md](toolchain.md) § Licensing).

**Environment variables** (all server-only, none `NEXT_PUBLIC_`): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`. The app MUST boot and serve every existing local-first surface when they are unset — services degrade to absent, never break the client-only app.

**Migrations**: plain SQL files in `db/migrations/NNN_name.sql`, applied by a small idempotent runner (`npm run db:migrate`) that records applied migrations in a `_migrations` table. Committed, ordered, append-only — the same files are the self-hosting setup scripts (Inkognito).

## Publik

Anonymous, account-less snapshot sharing. Framing: GitHub Gist for product graphs.

### Protocol

| Endpoint | Auth | Behavior |
|---|---|---|
| `POST /api/publik` | None (rate-limited) | Body: a `ProjectBundle` JSON. Server validates, strips, stores. Returns `201 { id, url, owner_key }` |
| `GET /api/publik/{id}` | None | Returns the stored bundle JSON (`content-type: application/json`) |
| `DELETE /api/publik/{id}` | `Authorization: Bearer <owner_key>` | Deletes iff `sha256(owner_key)` matches. `204` / `403` |
| `POST /api/publik/{id}/report` | None (rate-limited) | Increments `report_count`; over threshold flags for review. `202` |

Server-side rules on `POST`:

- **Validate with `@arkaik/schema`**: `parseBundle` + `validateBundle`. Errors → `422` with the structured findings; warnings pass. The server accepts conformance Levels 0–2, like every consumer.
- **Journal stripped by default, enforced server-side.** The privacy default of [journal.md](journal.md) ("Publik publishes without the journal") MUST NOT depend on client behavior alone: the server removes `journal[]` unless the request explicitly opts in with `?include_journal=true`. History leaking through a forgotten CLI flag is not an acceptable failure mode.
- **Size cap 5 MB** (mirrors the app's import cap) → `413`.
- **`id`**: server-generated, URL-safe, ≥ 10 chars of ≥ 64-bit randomness (unguessable, non-sequential). **`owner_key`**: UUID v4, returned exactly once; the server stores only its SHA-256 hash. Lost key = no deletion path in M4 (account-link recovery is an open question, tracked in vision.md).
- **Rate limiting**: per-IP creation throttle (order of 10/hour) enforced in Postgres — no extra infra dependency. `429` with `retry-after`.

### Storage

```sql
publik_snapshots (
  id             text primary key,
  owner_key_hash text not null,
  bundle         jsonb not null,          -- verbatim post-strip, schema-validated
  schema_version int  not null,
  title          text not null,           -- denormalized from project.title for listings/preview
  size_bytes     int  not null,
  report_count   int  not null default 0,
  created_at     timestamptz not null default now()
)
```

Snapshots are **immutable** — there is no update endpoint; re-publishing creates a new `id`. Retention: no guarantee (per the published disclaimer); M4 keeps snapshots indefinitely but the schema and disclaimer reserve the right to expire.

### Surfaces

- **`/p/{id}` page** (dynamic route, hosted app only): server-fetches the snapshot and renders a *preview* — title, description, node/edge counts, format-level badge, created date — plus an **Import into arkaik** button and the no-retention disclaimer. The import button fetches the JSON client-side and funnels it through the existing `importProject` path (`lib/utils/export.ts`), which already handles validation, timestamp repair, and ID-collision rewriting. **Not in M4**: rendering the full read-only graph server-side — that requires the provider-injection seam (see `docs/rfcs/arkaik-dev.md` blocker #2) and is an enhancement, not a launch requirement. "Anyone with the URL can import and edit a copy locally" is the promise; the preview page fulfills it.
- **In-app Publish action** (project list / project shell): confirmation dialog (what will be public, journal excluded, no retention guarantee) → on success shows the URL and the owner key **once**, with copy buttons and a "save this key" warning.
- **CLI `arkaik push`** (the Phase-4 command reserved in [toolchain.md](toolchain.md)): `arkaik push [path]` = validate → pack `--no-journal` → `POST /api/publik` → print URL + owner key. `arkaik push --delete <id> --key <owner_key>` = `DELETE`. `--include-journal` forwards the explicit opt-in. No update verb — immutability above.

### Moderation

Minimal but real: the `report` endpoint + `report_count` threshold flag, an admin deletion path (direct SQL or a maintenance script — no admin UI in M4), and a published contact route for takedowns in the site footer/docs. This resolves the vision's "Publik moderation" open question at the *process* level; tooling can grow later.

## Synk

Accounts plus one-way interval backups of local projects. The tier's own definition (vision.md § Infrastructure): **"Backup service only"** — deliberately not a database-of-record.

### Auth

**Auth.js (NextAuth v5)**, Postgres adapter, **GitHub OAuth** as the launch provider (the audience is developers; email magic-links need an email vendor and can follow). Sessions: Auth.js defaults (JWT). The adapter owns `users` / `accounts` / `sessions` tables; arkaik adds:

```sql
alter table users add column tier text not null default 'synk';
```

### Backup protocol

| Endpoint | Auth | Behavior |
|---|---|---|
| `PUT /api/synk/projects/{projectId}` | Session | Body: full bundle (journal embedded). Validates, enforces limits, stores a backup version. `201`, or `200 { deduped: true }` |
| `GET /api/synk/projects` | Session | Lists the caller's backed-up projects (latest backup metadata each) |
| `GET /api/synk/projects/{projectId}/backups` | Session | Lists retained backup versions (id, created_at, size, content hash) |
| `GET /api/synk/backups/{backupId}` | Session | Returns the bundle JSON for restore |
| `DELETE /api/synk/projects/{projectId}` | Session | Removes the project and all its backups from the server |

Rules:

- **Authorization is by ownership**: every row carries `user_id`; every query filters on the session's user. (App-layer authorization replaces the RLS concept from the superseded Supabase framing — same guarantee, enforced in one place.)
- **Content-hash dedupe**: the client serializes with `serializeBundle()` (canonical form — deterministic bytes) and sends `sha256` alongside; if it equals the latest stored hash, the server records nothing. Canonical serialization is what makes "did anything change?" a byte comparison.
- **Journal included.** Backups are the user's private data; unlike Publik there is no strip. A restored backup round-trips history intact.
- **Retention**: backups older than 7 days are pruned **on write** (no cron dependency), except the newest backup per project, which is never pruned regardless of age.
- **Limits** (see Tier Enforcement): Synk = 1 project, ~250 entities (nodes + edges). Violations → `403` with a structured `{ limit, actual, tier }` body the client can render.

### Client sync engine

- **Provider-injection seam** (prerequisite): introduce `getProvider()` and a mutation-notification channel on the provider (a lightweight `subscribe(cb)` that fires after each successful mutation transaction). This is the same seam `docs/rfcs/arkaik-dev.md` calls for — built once, serving both.
- **`SyncManager`** (`lib/sync/`): on mutation notification, debounce **~60 s** (the "interval backup (~1 min)" promise), then `exportProject` → canonical serialize → hash → `PUT`. Also: a manual "Back up now" action, and visible per-project status (backed up · pending · error · limit-exceeded).
- **One-way, up.** Restore is an explicit user action (pick a version → import as local project, existing collision handling applies). The engine MUST NOT write server state into the local store unprompted.
- **Lokal → Synk conversion** (the vision's "primary conversion funnel"): after first sign-in, existing local projects are offered for backup with one click each — the data never moves, it *gains* a backup. No migration of storage, no account-gating of local features.

## Hosted Graph Projects

The Klub tier's database-of-record for a project's graph — where Synk stores *backups* of a local project, this holds the authoritative snapshot and journal, and agents write to it over HTTP (`db/migrations/008_graph_projects.sql`; `lib/services/graph/store.ts` is the only module that touches those tables).

### Machine auth

One seam answers "who is calling?" for every route: `getCaller()` in `lib/services/auth.ts`.

- **Two kinds of caller.** An interactively signed-in human (Auth.js session) or a machine holding a bearer token (`Authorization: Bearer …`, minted in project settings and stored hashed in `api_tokens`).
- **Scopes.** `graph:read` and `graph:write`. A token carries the scopes it was minted with; a session caller carries all of them — scopes exist to limit machines, not people. A caller without the scope gets `403 { error: "insufficient_scope", required }`.
- **Owner scoping, not user scoping.** Every statement filters on the caller's owner ids (`lib/services/owners.ts`), so shared ownership works and a project belonging to another owner is `404`, never `403` — the API cannot be used to probe for project ids.

### Write path

| Endpoint | Scope | Behavior |
|---|---|---|
| `POST /api/graph/projects/{id}/mutations` | `graph:write` | **The** graph write path: a batch of typed ops applied atomically, journalled, version bumped |
| `PUT /api/graph/projects/{id}/bundle` | `graph:write` | Wholesale restore — snapshot and journal replaced together |
| `PATCH /api/graph/projects/{id}` | `graph:write` | Project-level fields only (title, description, version, metadata) — deliberately cannot touch nodes or edges |
| `DELETE /api/graph/projects/{id}` | `graph:write` | Archive (`archived_at`); leaves the listing, stays readable |
| `POST /api/graph/projects/{id}/quality/events` | `graph:write` | Journal-only quality decisions — no snapshot change, no version bump |

Rules:

- **`If-Match` is strong, and it is the snapshot `version`** (a bigint, returned as a string in the project GET's JSON body). A stale version writes nothing: `409` on `…/mutations`, `412` on `PUT …/bundle` (a known, deliberate inconsistency, documented at the mutations route). `PUT …/bundle` *requires* the header — `428` when it is absent.
- **A weak validator in `If-Match` is refused, never applied.** `PUT …/bundle` answers `400 if_match_unsupported` (`classifyIfMatch` in `lib/services/graph/restore.ts` treats `W/…`, `*` and comma lists as unsupported shapes); on `…/mutations` a `W/"…"` cannot equal a decimal version and lands as a `409`. This is what makes the weak read validators below safe to hand out.
- **The version bumps on every snapshot write and never on a journal-only append.** An appended `deliverable.shipped` or quality decision grows the journal while the snapshot — and the version every writer is racing on — stands still.

### Read contract

| Endpoint | Body | Read validator |
|---|---|---|
| `GET /api/graph/projects/{id}` | The bundle with quality decisions folded in, plus `version` | `W/"<version>.<quality decision count>"` |
| `GET /api/graph/projects/{id}/nodes` | `{ nodes }` | `W/"<version>"` |
| `GET /api/graph/projects/{id}/edges` | `{ edges }` | `W/"<version>"` |
| `GET /api/graph/projects/{id}/journal` | `{ journal }`, server order | `W/"<version>.<event count>"` |
| `GET /api/graph/projects/{id}/export` | `{ bundle }` with the journal embedded | `W/"<version>.<event count>"` |

- **Every read answers with `ETag`, `Cache-Control: private, no-cache` and `Vary: Authorization`** — on the `200` and on the `304` alike. `private` because every body is owner-scoped, `no-cache` because a client must revalidate rather than reuse blind, `Vary` because a bearer token selects the owner.
- **`If-None-Match` earns a bodiless `304`.** The comparison is weak (RFC 9110 § 8.8.3.2): a case-insensitive `W/` on either side is ignored, `*` matches any representation that exists, and a comma list matches on any member. A matching conditional read costs the auth queries plus one validator statement — no snapshot is loaded, nothing but headers is written.
- **The validators are weak on purpose.** Marking them weak is what makes a client that echoes a read ETag into `If-Match` fail loudly (see the Write path) instead of silently writing against a version it never read.
- **Each route validates on exactly what its body depends on.** `/nodes` and `/edges` move only when the snapshot does. `/journal` and `/export` move on every appended event. The bundle GET counts *quality decisions only*, because those are the only events it folds — a merged PR's `deliverable.shipped` must not turn the next map revalidation into a multi-megabyte `200`.
- **Counts, not `max(seq)`.** Journal appends are not transactional, so two concurrent appends can commit out of `seq` order and a max taken between them would never learn about the earlier row. A count moves on every commit whatever the order, and the only deleter (a bundle restore) always bumps the version. It also keeps the platform-wide `bigserial` out of a tenant-visible header.
- **An archived project still reads.** Only the writes refuse it. A conditional read answers `304`/`200` for exactly the projects an unconditional read answers `200` for — otherwise an archived project would start `404`ing the moment a client revalidated.
- **`?types=` projects the journal read.** `GET …/journal?types=a,b` — repeatable and comma-separated (`?types=a&types=b` is the same request), tokens trimmed, empties dropped, deduped and sorted into a canonical list. No projection, an empty one, or an unknown type are all valid: the first two mean the whole journal, the third answers an empty list with `200`, so a client reading a forward-compatible event type never breaks against an older server. More than **32 distinct types** is `400 { error: "invalid_types" }` — fail closed, because a silently truncated list would answer with a subset the caller cannot detect. The projection belongs to `/journal` alone: `/nodes`, `/edges` and `/export` ignore the parameter entirely, since `/export` builds an interchange bundle and a bundle missing most of its history would restore as data loss.
- **A projection carries the whole journal's validator.** One aggregate per project rather than one per projection: an append of a type a projection does not carry still invalidates it. A superfluous `200` is cheap; a missed one would leave a page rendering history that no longer exists.
- **A `304` is never an existence oracle.** The validator statement is owner-scoped exactly like the body load, so another owner gets `404` whatever it sends, `*` included.

## Pollen Feed

`GET /api/graph/projects/{projectId}/pollen?after=<id>&limit=<n>` — the
project's journal projected to pollen envelopes (the Ariko federation
contract; the normative document lives in the ariko repo as `docs/POLLEN.md`,
its reference validator vendored at `lib/pollen/contract.ts` with the
conformance fixtures at `tests/fixtures/pollen/`).

- **Opt-in**: served only when `project.metadata.pollen.plant` is set
  (project settings → Federation); otherwise the same `not_found` a missing
  project produces, so the feed cannot be used to probe for ids either.
- **Auth**: `graph:read`, owner-scoped — identical to `…/journal`.
- **Order & cursor**: journal server order. `after` is the last pollen id the
  consumer processed; an unknown `after` answers **410 Gone** (drop the
  cursor, rebuild from the start). `limit` defaults to 100, capped at 200.
  An empty array means caught up.
- **Mapping (v1)**: `deliverable.shipped` → `shipped` (re-appends emit a
  `corrects` ref to the first occurrence's envelope), `release.tagged` →
  `release.tagged`, `decision.status_changed` into `approved` → `decided`.
  Everything else is not exported. An event the contract cannot express is
  skipped and logged, never a 500.
- **Rebuilds**: a bundle restore replaces the journal wholesale; surviving
  event ids keep their envelope ids (ULIDs are preserved), vanished cursors
  get the 410. This is the contract's coordinated-rewrite case.

The webhook's Lab-Note half feeds this: a merged PR of a linked repository
whose body carries a `## Lab Note` section lands one `deliverable.shipped`
event (full note under `lab_note`, actor `github-app`) per linked project,
idempotent by content — see [journal.md](journal.md) § Event Vocabulary and
`lib/services/github/lab-note.ts`.

## Tier Enforcement Points

M4 builds the sockets Basik/Klub will plug into, and nothing else:

```ts
// lib/services/limits.ts — server-side source of truth
export const TIER_LIMITS = {
  synk:  { projects: 1,        entities: 250,      retention_days: 7  },
  basik: { projects: 3,        entities: 1000,     retention_days: 30 },
  klub:  { projects: Infinity, entities: Infinity, retention_days: Infinity },
} as const;
```

Enforcement lives in exactly two places: the `PUT` backup handler (projects + entities) and the prune step (retention). `users.tier` selects the row; M4 has no path that sets it to anything but `synk`. M5's billing work flips a column — it does not touch enforcement.

## Inkognito — Redefinition

The original framing ("local-first backed by the user's own Supabase project") assumed a hosted Supabase implementation to mirror. With the Vercel-native decision there is none, and maintaining a second, Supabase-specific backend solely for the sovereign path would fork every services feature forever.

**Redefinition: Inkognito is full-stack self-hosting.** The app and services are AGPL — the sovereign path is to deploy them:

- Deploy the repo (Vercel, or any Node host) + any Postgres (Neon, RDS, **or Supabase's Postgres** — the SQL is plain Postgres, so a Supabase project still works as the database).
- `db/migrations/*.sql` are the release-aligned setup/migration scripts the vision promised, keyed to releases; `schema_version` handles bundle-format migrations independently.
- Sovereignty comes from owning the deployment, not from a bespoke provider: same code, same features (minus arkaik-operated AI), zero arkaik infra involvement.

This supersedes issues #49 (SupabaseProvider) as originally framed. What remains true from that framing: the `DataProvider` seam stays backend-agnostic, and nothing in M4 precludes a future third-party provider implementation if demand exists.

## Security & Privacy

- Owner keys and session secrets are never logged; owner keys stored only as SHA-256 hashes.
- All SQL through parameterized queries; all inbound bundles through `@arkaik/schema` validation before touching storage.
- Publik strips journals server-side by default (above) — private history requires explicit opt-in to leak.
- Account deletion removes the user row and cascades to all backups (`on delete cascade`).
- The client never receives another user's rows: every Synk query is user-scoped; Publik reads are by unguessable id only (no listing endpoint).

## CI Additions

The workflow gains a services job: Postgres service container, `npm run db:migrate` against it (migration integrity check), and API integration tests (route handlers invoked against the migrated schema — Publik create/fetch/delete/strip, Synk auth-required/limits/dedupe/retention). The existing generated-artifact drift gate is unaffected; there are no generated SQL artifacts in M4.

## Open Questions

- [ ] Publik owner-key recovery: account-link fallback once Synk accounts exist (a signed-in publisher could bind snapshots to their account)?
- [ ] Publik abuse posture beyond rate limiting: do we need proof-of-work or captcha if scripted publishing appears?
- [ ] Synk backup encryption at rest beyond Postgres defaults — is client-side encryption worth the key-management UX cost for a backup tier?
- [ ] `arkaik push --to synk` (CLI backups into an account) needs a device-token auth flow — M5 with Basik/Klub, or earlier?
