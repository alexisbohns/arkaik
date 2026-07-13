-- 005_synk_tables.sql
--
-- Synk: authenticated, one-way interval backups of local projects
-- (docs/spec/services.md § Synk → Backup protocol, § Tier Enforcement Points,
-- § Security & Privacy). Plain Postgres SQL: like the earlier migrations this
-- file doubles as an Inkognito self-hosting setup script, so it must run
-- unmodified against any Postgres (Neon, RDS, Supabase's Postgres, or a local
-- instance).
--
-- Every statement uses IF NOT EXISTS so the file is safe to re-run by hand,
-- independent of the `npm run db:migrate` bookkeeping (the CI services job runs
-- the runner twice as an idempotency gate).
--
-- Ownership model (§ Synk → "Authorization is by ownership"): every row carries
-- `user_id`; every query in lib/services/synk.ts filters on the session's user.
-- App-layer authorization replaces the RLS concept from the superseded Supabase
-- framing — same guarantee, enforced in one place. `user_id` foreign-keys the
-- Auth.js `users` table (003_auth_tables.sql), whose ids are SERIAL/INTEGER, so
-- the columns are `integer`. Account deletion cascades to all Synk rows
-- (§ Security & Privacy → "Account deletion … cascades to all backups").

-- One row per backed-up project, scoped to its owner. `id` is the client's own
-- project id (from the bundle / URL path); it is NOT globally unique because two
-- users can independently back up projects that share an id (e.g. the same seed
-- project), so the primary key is the composite (user_id, id).
create table if not exists synk_projects (
  id         text        not null,
  user_id    integer     not null references users(id) on delete cascade,
  title      text        not null,   -- denormalized from project.title for listings
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- One row per retained backup version. `bundle` holds the verbatim,
-- schema-validated ProjectBundle JSON WITH its journal embedded — unlike Publik
-- there is no strip; a backup is the user's private data and must round-trip
-- history intact (§ Synk → "Journal included"). `sha256` is the server-computed
-- hash of the canonical serialization (serializeBundle) — the truth used for
-- content-hash dedupe; the client's `x-bundle-sha256` header is only a
-- skip-early advisory. `entity_count` = nodes.length + edges.length, stored so
-- listings need not re-parse the bundle.
create table if not exists synk_backups (
  id           text        primary key,
  project_id   text        not null,
  user_id      integer     not null references users(id) on delete cascade,
  bundle       jsonb       not null,
  sha256       text        not null,
  size_bytes   int         not null,
  entity_count int         not null,
  created_at   timestamptz not null default now(),
  -- Deleting a project (DELETE /api/synk/projects/{id}) removes all its backups.
  foreign key (user_id, project_id)
    references synk_projects (user_id, id) on delete cascade
);

-- Retention pruning, dedupe (latest hash), and per-project backup listings all
-- read backups for one (user_id, project_id) newest-first; this index serves
-- every one of them.
create index if not exists synk_backups_project_created_idx
  on synk_backups (user_id, project_id, created_at desc);
