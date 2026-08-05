-- 008_graph_projects.sql
--
-- Hosted product graphs: a project of record the app AND an agent both read and
-- write (docs/spec/services.md § Hosted Graph Projects).
--
-- WHY NOT SYNK. Synk is a backup service and its schema says so: the primary key
-- is (user_id, client_chosen_id), backups are an immutable chain pruned after 7
-- days, and the tier cap is one project. Extending it into a mutable store would
-- fight every one of those decisions. Synk and Publik are untouched by this
-- migration and keep serving local-first projects; this is a separate store
-- beside them, and the two never share a row.
--
-- SNAPSHOT + EVENT LOG, not normalized rows. The graph lives as one `jsonb`
-- snapshot so `validateBundle`'s whole-graph rules — dangling edges, playlist
-- coherence, flow cycles — keep working against exactly the shape they were
-- written for, and so a format change never needs a Postgres migration. Every
-- mutation also appends to `graph_events`, which is the audit trail and the
-- substrate any future merge story would be built on.
--
-- The journal lives in its OWN table rather than inside the snapshot, mirroring
-- the IndexedDB split in lib/data/db.ts: appends must not rewrite the graph.
--
-- Every statement uses IF NOT EXISTS so the file is safe to re-run by hand,
-- independent of the `npm run db:migrate` bookkeeping. Plain Postgres: this file
-- doubles as an Inkognito self-hosting setup script.

-- One row per hosted project. `id` is server-owned and opaque (`prj_…`), unlike
-- Synk's client-chosen id — two owners can hold projects whose *bundle* ids
-- collide (both imported the same seed) without colliding here.
create table if not exists graph_projects (
  id             text        not null,
  owner_id       text        not null references owners(id) on delete cascade,
  -- The bundle's own project.id, kept for export fidelity and for `arkaik link`
  -- to recognise a repo's working copy. Deliberately NOT unique.
  bundle_id      text        not null,
  title          text        not null,
  -- The snapshot: project + nodes + edges, WITHOUT the journal (that is
  -- graph_events). Verbatim, schema-validated on every write.
  snapshot       jsonb       not null,
  schema_version int         not null default 2,
  entity_count   int         not null default 0,
  -- Bumped on every accepted mutation. Clients send it back as an ETag/If-Match
  -- to detect "someone else changed this while I was reading".
  version        bigint      not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,
  primary key (id)
);

-- Listing a caller's projects, and the owner-scoping filter every query applies.
create index if not exists graph_projects_owner_idx on graph_projects (owner_id);

-- The append-only journal — append-only for every write path except one:
-- `replaceProjectBundle` (lib/services/graph/store.ts, the PUT .../bundle
-- restore verb) deletes and replaces a project's entire event log wholesale,
-- because mined history has no other landing path onto a hosted project.
-- `id` is the event's own ULID — the id the bundle carries when exported —
-- so it is unique per project but NOT globally: two owners importing the
-- same bundle (the shipped `seed/pebbles.json` carries a journal) legitimately
-- hold events with identical ids. The primary key is therefore composite. A
-- global `primary key (id)` would make the second import collide and
-- silently drop its entire history.
create table if not exists graph_events (
  id         text        not null,
  project_id text        not null references graph_projects(id) on delete cascade,
  -- Server-assigned ordering. ULIDs sort lexicographically by creation time, but
  -- two writers can mint events in the same millisecond; seq is the tiebreak and
  -- the only ordering reads rely on.
  seq        bigserial   not null,
  event      jsonb       not null,
  actor      text        not null,
  created_at timestamptz not null default now(),
  primary key (project_id, id)
);

-- Every read of a project's journal is "this project, in order".
create index if not exists graph_events_project_seq_idx on graph_events (project_id, seq);
