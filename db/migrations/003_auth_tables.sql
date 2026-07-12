-- 003_auth_tables.sql
--
-- Auth.js (NextAuth v5) Postgres adapter schema (docs/spec/services.md § Synk →
-- Auth). These are the four tables @auth/pg-adapter reads and writes, transcribed
-- by hand from the adapter's documented schema (https://authjs.dev/reference/
-- adapter/pg) so the migration doubles as an Inkognito self-hosting setup script:
-- plain Postgres that runs unmodified against Neon, RDS, Supabase's Postgres, or a
-- local instance — no ORM, no framework.
--
-- The adapter issues queries with case-sensitive, camelCase identifiers
-- ("userId", "emailVerified", "providerAccountId", "sessionToken"); those columns
-- MUST stay quoted here so their case survives. SQL keywords are lowercased to
-- match 001_publik_snapshots.sql.
--
-- Session strategy is JWT (see auth.ts), so `sessions` is not read on the request
-- path; the adapter still owns it (and may persist rows for DB-backed flows), so
-- it is created for schema completeness and forward compatibility.
--
-- Every statement uses IF NOT EXISTS so the file is safe to re-run by hand,
-- independent of the `npm run db:migrate` bookkeeping.

-- Verification tokens (email magic-links). Deferred as a launch provider, but the
-- adapter contract includes it; created now so the schema is complete.
create table if not exists verification_token (
  identifier text        not null,
  expires    timestamptz not null,
  token      text        not null,
  primary key (identifier, token)
);

-- Linked OAuth accounts (GitHub at launch). One row per provider identity linked
-- to a user; token columns hold the provider's OAuth response.
create table if not exists accounts (
  id                  serial,
  "userId"            integer      not null,
  type                varchar(255) not null,
  provider            varchar(255) not null,
  "providerAccountId" varchar(255) not null,
  refresh_token       text,
  access_token        text,
  expires_at          bigint,
  id_token            text,
  scope               text,
  session_state       text,
  token_type          text,
  primary key (id)
);

-- Database sessions. Unused under the JWT session strategy but part of the
-- adapter's owned surface (see header).
create table if not exists sessions (
  id             serial,
  "userId"       integer      not null,
  expires        timestamptz  not null,
  "sessionToken" varchar(255) not null,
  primary key (id)
);

-- Users. arkaik adds `tier` in the next migration (004_users_tier.sql); the base
-- columns below are exactly what the adapter expects.
create table if not exists users (
  id              serial,
  name            varchar(255),
  email           varchar(255),
  "emailVerified" timestamptz,
  image           text,
  primary key (id)
);
