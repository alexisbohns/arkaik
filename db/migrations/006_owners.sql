-- 006_owners.sql
--
-- Owner indirection: the tenancy seam every hosted resource hangs off
-- (docs/spec/services.md § Hosted Graph Projects → Tenancy).
--
-- WHY AN INDIRECTION RATHER THAN user_id: hosted projects, API tokens, and repo
-- links all need an owner. Pointing them straight at `users(id)` would work
-- today and would have to be re-keyed on every one of those tables the moment a
-- second person shares a project. An `owners` row costs one join now and turns
-- "add teams" into new rows instead of a foreign-key migration across the whole
-- schema. Today every owner is `kind = 'personal'` with exactly one member, and
-- no UI exposes anything else — the shape is forward-compatible, not early.
--
-- Personal owner ids are DERIVED from the user id (`own-u<id>`) rather than
-- random. That makes the backfill below, and the lazy creation path in
-- lib/services/owners.ts, agree on the same id without coordinating — either can
-- run first, neither can produce a duplicate.
--
-- Every statement uses IF NOT EXISTS / ON CONFLICT so the file is safe to re-run
-- by hand, independent of the `npm run db:migrate` bookkeeping (the CI services
-- job runs the runner twice as an idempotency gate). Plain Postgres: this file
-- doubles as an Inkognito self-hosting setup script.

-- An owning entity. `personal` owners are created automatically, one per user;
-- `org` is reserved for the team work that is deliberately not built yet.
create table if not exists owners (
  id         text        not null,
  kind       text        not null default 'personal',
  name       text        not null,
  created_at timestamptz not null default now(),
  primary key (id),
  constraint owners_kind_check check (kind in ('personal', 'org'))
);

-- Membership. The role column is stored and read, but with one member per
-- personal owner there is nothing yet that can hold a role other than 'owner'.
create table if not exists owner_members (
  owner_id   text        not null references owners(id) on delete cascade,
  user_id    integer     not null references users(id) on delete cascade,
  role       text        not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id),
  constraint owner_members_role_check check (role in ('owner', 'editor', 'viewer'))
);

-- getCaller() resolves a user's owners on every authenticated request; this is
-- the index that lookup rides.
create index if not exists owner_members_user_idx on owner_members (user_id);

-- Backfill one personal owner per existing user. Guarded on "has no membership
-- yet" rather than "has no owner row", so a user who was already added to some
-- owner is left alone.
insert into owners (id, kind, name)
select 'own-u' || u.id, 'personal', coalesce(nullif(u.name, ''), nullif(u.email, ''), 'Personal')
  from users u
 where not exists (select 1 from owner_members m where m.user_id = u.id)
on conflict (id) do nothing;

insert into owner_members (owner_id, user_id, role)
select 'own-u' || u.id, u.id, 'owner'
  from users u
 where not exists (select 1 from owner_members m where m.user_id = u.id)
on conflict (owner_id, user_id) do nothing;
