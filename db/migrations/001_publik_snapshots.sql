-- 001_publik_snapshots.sql
--
-- First arkaik services migration (docs/spec/services.md § Backend — Decision
-- Record, § Publik → Storage). Plain Postgres SQL: this file doubles as an
-- Inkognito self-hosting setup script, so it must run unmodified against any
-- Postgres (Neon, RDS, Supabase's Postgres, or a local instance).
--
-- Every statement uses IF NOT EXISTS so the file is safe to re-run by hand,
-- independent of the `npm run db:migrate` bookkeeping.

-- Migration bookkeeping. The runner (db/migrate.mjs) also ensures this table
-- exists before it can query applied state; defining it here as well keeps the
-- SQL self-contained for self-hosters who apply the files directly.
create table if not exists _migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
);

-- Publik: anonymous snapshot sharing. Snapshots are immutable — there is no
-- update path; re-publishing creates a new id. `bundle` holds the verbatim,
-- post-journal-strip, schema-validated ProjectBundle JSON (≤ 5 MB).
create table if not exists publik_snapshots (
  id             text primary key,
  owner_key_hash text        not null,
  bundle         jsonb       not null,
  schema_version int         not null,
  title          text        not null,
  size_bytes     int         not null,
  report_count   int         not null default 0,
  created_at     timestamptz not null default now()
);
