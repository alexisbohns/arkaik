-- 004_users_tier.sql
--
-- arkaik's one addition to the Auth.js adapter schema (docs/spec/services.md
-- § Synk → Auth, § Tier Enforcement Points): the tier column that selects a row
-- in lib/services/limits.ts's TIER_LIMITS table.
--
-- M4 has no path that sets this to anything but the default 'synk'. M5's billing
-- work flips the column; it does not touch enforcement. Plain Postgres, and
-- idempotent (`add column if not exists`) so the file is safe to re-run by hand.

alter table users add column if not exists tier text not null default 'synk';
