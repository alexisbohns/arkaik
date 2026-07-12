---
title: "Spec: Services (Publik & Synk)"
navTitle: "Services"
order: 4
---

# Services — Publik & Synk

> Status: **Draft specification** — describes the M4 target. Nothing in this document is implemented yet; there is no server surface in the codebase today (no `app/api/`, no database, no auth).
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
