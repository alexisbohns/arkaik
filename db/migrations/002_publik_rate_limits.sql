-- 002_publik_rate_limits.sql
--
-- Per-IP rate limiting for the Publik endpoints (docs/spec/services.md § Publik
-- → Protocol "Rate limiting", § Security & Privacy). Enforced entirely in
-- Postgres so the service surface needs no extra infra dependency (no Redis,
-- no edge KV) — the same "runs on any Postgres" promise as 001, so this file
-- doubles as an Inkognito self-hosting setup script.
--
-- Design: one append-only row per throttled request. The route handler counts
-- rows for (ip_hash, action) inside a sliding 1-hour window and rejects once the
-- count reaches the per-action limit (create ~10/h). Raw IPs are NEVER stored —
-- only a keyed hash (HMAC-SHA256, see lib/services/publik.ts hashIp), so the
-- table holds no personally identifying network address. Expired rows are pruned
-- opportunistically on each check (no cron dependency), keeping the table bounded.
--
-- Every statement uses IF NOT EXISTS so the file is safe to re-run by hand,
-- independent of the `npm run db:migrate` bookkeeping (matching 001).

create table if not exists publik_rate_limits (
  id         bigint generated always as identity primary key,
  ip_hash    text        not null,   -- HMAC-SHA256 of the client IP; never the raw IP
  action     text        not null,   -- throttled action, e.g. 'create' | 'report'
  created_at timestamptz not null default now()
);

-- Covers the hot path: count/prune rows for one (ip_hash, action) within a window.
create index if not exists publik_rate_limits_lookup_idx
  on publik_rate_limits (ip_hash, action, created_at);
