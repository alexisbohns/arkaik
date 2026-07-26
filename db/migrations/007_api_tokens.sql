-- 007_api_tokens.sql
--
-- Machine credentials: the auth path a CLI, an MCP server, or a CI job uses to
-- reach arkaik as a user (docs/spec/services.md § Hosted Graph Projects → Machine
-- auth). Until now every service route was cookie-session-only, so no agent could
-- authenticate at all — the "device-token auth flow" both docs/spec/mcp.md
-- § Non-Goals and docs/vision.md § Open Questions name as the missing piece.
--
-- TOKEN SHAPE: `ark_<prefix>_<secret>`.
--   * `prefix` — 8 base64url chars, stored in the clear and UNIQUE. It is the
--     lookup key, so verification is a single indexed read rather than "load
--     every token for every user and hash-compare against each".
--   * `secret` — 32 random bytes. Only `sha256(secret)` is ever stored, and the
--     plaintext is returned exactly once at mint time, mirroring the Publik
--     owner-key discipline in lib/services/publik.ts (§ Security & Privacy:
--     "owner keys stored only as SHA-256 hashes").
--
-- SCOPES are enforced from the first request (lib/services/auth.ts → requireScope),
-- not stored-and-ignored. A token minted for the agent plane carries graph scopes
-- and cannot touch Synk backups; token management itself is session-only, so a
-- leaked token can never mint another token or widen its own scopes.
--
-- Tokens belong to an OWNER, not directly to a user (006_owners.sql): when a
-- project is shared with a team, a token keeps working without re-keying. The
-- `user_id` column records who minted it, for audit — deleting that user cascades
-- the token away with them.
--
-- Every statement uses IF NOT EXISTS so the file is safe to re-run by hand,
-- independent of the `npm run db:migrate` bookkeeping.

create table if not exists api_tokens (
  id           text        not null,
  owner_id     text        not null references owners(id) on delete cascade,
  user_id      integer     not null references users(id) on delete cascade,
  name         text        not null,
  token_prefix text        not null,
  token_hash   text        not null,
  scopes       text[]      not null default '{}',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  primary key (id)
);

-- The verification path: one indexed lookup by prefix, then a constant-time
-- hash compare. UNIQUE because the prefix alone must identify at most one row.
create unique index if not exists api_tokens_prefix_idx on api_tokens (token_prefix);

-- Listing a caller's tokens in the settings UI.
create index if not exists api_tokens_owner_idx on api_tokens (owner_id);
