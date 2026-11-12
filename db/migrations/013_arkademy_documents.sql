-- 013_arkademy_documents.sql
--
-- The Arkademy library: one JSON document, versioned
-- (docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md § "The table",
-- docs/spec/services.md § Arkademy). The owner uploads it with
-- `npm run arkademy -- publish`; the app reads the newest row through
-- lib/services/arkademy.ts and serves it at GET /api/arkademy.
--
-- APPEND-ONLY. The current document is the row with the highest `version`.
-- A publish and a rollback both insert a row; nothing updates or deletes one,
-- so every earlier version stays available to roll back to. The primary key
-- is the only index `order by version desc limit 1` needs.
--
-- `sha256` hashes the canonical JSON text the script uploaded (the validated
-- document re-serialised in the schema's key order), not the jsonb column,
-- which does not keep key order. Equal hashes mean an unchanged document.
--
-- IDEMPOTENT like its siblings: safe to re-run by hand outside the runner.
create table if not exists arkademy_documents (
  version        int         primary key check (version > 0),
  format_version int         not null,
  document       jsonb       not null,
  sha256         text        not null,
  size_bytes     int         not null,
  note           text,
  restored_from  int         references arkademy_documents (version),
  uploaded_at    timestamptz not null default now()
);
