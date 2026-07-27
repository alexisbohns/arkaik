import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { query } from "@/lib/services/db";

/**
 * API tokens — the machine credential (db/migrations/007_api_tokens.sql).
 *
 * Security invariants enforced here, in one audited place:
 *  - The secret is returned to the caller exactly once, at mint time, and is
 *    never persisted or logged. Only `sha256(secret)` is stored — the same
 *    discipline lib/services/publik.ts applies to Publik owner keys.
 *  - Verification is an indexed lookup by the (public) prefix followed by a
 *    constant-time hash compare, so it leaks neither timing nor existence.
 *  - Expiry and revocation are checked on every verification, not at mint time.
 *  - Scopes are returned to the caller for enforcement (lib/services/auth.ts
 *    → requireScope). Nothing here is stored-and-ignored.
 */

/** Human-visible scheme prefix, so a leaked string is recognizable as an arkaik token. */
export const TOKEN_SCHEME = "ark";

/**
 * 6 bytes → 12 HEX chars. The public, indexed lookup key.
 *
 * Hex, not base64url, on purpose: the token is `ark_<prefix>_<secret>` and the
 * base64url alphabet contains `_`. A base64url prefix would make the separator
 * ambiguous, so the parse below could not tell where the prefix ended. Hex has
 * no `_`, which makes "everything after the second underscore is the secret"
 * exactly true. (The secret stays base64url — it is never split on.)
 */
const PREFIX_BYTES = 6;

/** 32 bytes → 43 base64url chars of entropy. Never stored in plaintext. */
const SECRET_BYTES = 32;

/**
 * Every scope a token can carry.
 *
 * `graph:*` is the agent plane. `synk` is the backup API, deliberately separate:
 * an agent token minted to edit a product graph has no business reading a user's
 * whole backup history, and the split makes that the default rather than a
 * discipline. Token management itself is session-only (never scoped), so a
 * leaked token can neither mint another token nor widen its own scopes.
 */
export const TOKEN_SCOPES = ["graph:read", "graph:write", "synk"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** What the settings UI mints unless told otherwise: the agent plane, nothing else. */
export const DEFAULT_TOKEN_SCOPES: readonly TokenScope[] = ["graph:read", "graph:write"];

export function isTokenScope(value: string): value is TokenScope {
  return (TOKEN_SCOPES as readonly string[]).includes(value);
}

export interface TokenRecord {
  id: string;
  ownerId: string;
  userId: number;
  name: string;
  /** The public prefix — safe to display, identifies the token in a list. */
  prefix: string;
  scopes: TokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface MintedToken {
  record: TokenRecord;
  /** The full `ark_<prefix>_<secret>` string. Returned once; never recoverable. */
  plaintext: string;
}

export interface ResolvedToken {
  id: string;
  ownerId: string;
  userId: number;
  scopes: TokenScope[];
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex of a token secret — the only form ever stored. */
export function hashTokenSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time compare of a presented secret against a stored hash. */
function secretMatches(presentedSecret: string, storedHashHex: string): boolean {
  const presented = Buffer.from(hashTokenSecret(presentedSecret), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHashHex, "hex");
  } catch {
    return false;
  }
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

/**
 * Parse `ark_<prefix>_<secret>`. Returns null for anything malformed, so callers
 * never have to distinguish "no token" from "garbage token" — both are simply
 * unauthenticated.
 *
 * Splits on the FIRST TWO underscores only, never `split("_")`: the secret is
 * base64url, whose alphabet includes `_`, so roughly half of all generated
 * secrets contain one. A three-way split rejected those tokens outright — every
 * affected credential simply failed to authenticate.
 */
export function parseToken(raw: string): { prefix: string; secret: string } | null {
  const trimmed = raw.trim();
  const firstSep = trimmed.indexOf("_");
  if (firstSep === -1) return null;
  const secondSep = trimmed.indexOf("_", firstSep + 1);
  if (secondSep === -1) return null;

  const scheme = trimmed.slice(0, firstSep);
  const prefix = trimmed.slice(firstSep + 1, secondSep);
  const secret = trimmed.slice(secondSep + 1);

  if (scheme !== TOKEN_SCHEME || !prefix || !secret) return null;
  // Prefixes are hex by construction. Rejecting anything else keeps the split
  // above unambiguous and cannot reject a token this service actually issued.
  if (!/^[0-9a-f]+$/.test(prefix)) return null;

  return { prefix, secret };
}

/** Extract a bearer credential from an Authorization header, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface TokenRow {
  id: string;
  owner_id: string;
  user_id: number;
  name: string;
  token_prefix: string;
  scopes: string[] | null;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
}

function toRecord(row: TokenRow): TokenRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    userId: Number(row.user_id),
    name: row.name,
    prefix: row.token_prefix,
    scopes: (row.scopes ?? []).filter(isTokenScope),
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

/**
 * Every column {@link toRecord} reads. Listed once, as data, so the plain and
 * table-qualified forms below cannot drift apart. `token_hash` is deliberately
 * absent: it is selected explicitly and only by {@link verifyToken}.
 */
const RECORD_COLUMN_NAMES = [
  "id",
  "owner_id",
  "user_id",
  "name",
  "token_prefix",
  "scopes",
  "created_at",
  "last_used_at",
  "expires_at",
  "revoked_at",
] as const;

const RECORD_COLUMNS = RECORD_COLUMN_NAMES.join(", ");

/** The same columns qualified for a join, e.g. `t.id, t.owner_id, …`. */
const RECORD_COLUMNS_T = RECORD_COLUMN_NAMES.map((c) => `t.${c}`).join(", ");

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface MintTokenInput {
  ownerId: string;
  userId: number;
  name: string;
  scopes?: readonly TokenScope[];
  /** Optional absolute expiry. Omitted = no expiry. */
  expiresAt?: Date | null;
}

/**
 * Mint a token for an owner. The caller is responsible for having already
 * verified that `userId` belongs to `ownerId` (lib/services/owners.ts
 * → userBelongsToOwner) — this function does not re-check membership.
 *
 * Unknown scope strings are dropped rather than rejected: the stored set is
 * always a subset of {@link TOKEN_SCOPES}, so a future client asking for a scope
 * this deployment does not know about gets a narrower token, never a broader one.
 */
export async function mintToken(input: MintTokenInput): Promise<MintedToken> {
  const id = `tok_${randomBytes(9).toString("base64url")}`;
  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const scopes = [...new Set((input.scopes ?? DEFAULT_TOKEN_SCOPES).filter(isTokenScope))];

  const { rows } = await query<TokenRow>(
    `insert into api_tokens (id, owner_id, user_id, name, token_prefix, token_hash, scopes, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${RECORD_COLUMNS}`,
    [id, input.ownerId, input.userId, input.name, prefix, hashTokenSecret(secret), scopes, input.expiresAt ?? null],
  );

  return {
    record: toRecord(rows[0]),
    plaintext: `${TOKEN_SCHEME}_${prefix}_${secret}`,
  };
}

/**
 * Resolve a presented token string to its owner/user/scopes, or null if it is
 * malformed, unknown, revoked, or expired.
 *
 * On success `last_used_at` is refreshed, but at most once a minute per token —
 * an unthrottled write here would turn every authenticated agent request into a
 * row update. The throttle is in the WHERE clause, so concurrent requests
 * collapse into one write rather than racing.
 */
export async function verifyToken(raw: string): Promise<ResolvedToken | null> {
  const parsed = parseToken(raw);
  if (!parsed) return null;

  const { rows } = await query<TokenRow & { token_hash: string }>(
    `select ${RECORD_COLUMNS}, token_hash from api_tokens where token_prefix = $1`,
    [parsed.prefix],
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  if (!secretMatches(parsed.secret, row.token_hash)) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) return null;

  await query(
    `update api_tokens
        set last_used_at = now()
      where id = $1
        and (last_used_at is null or last_used_at < now() - interval '1 minute')`,
    [row.id],
  );

  return {
    id: row.id,
    ownerId: row.owner_id,
    userId: Number(row.user_id),
    scopes: (row.scopes ?? []).filter(isTokenScope),
  };
}

/**
 * The user's tokens, newest first. Scoped through `owner_members`, so it lists
 * every token for every owner the user belongs to — never another tenant's.
 * Secrets and hashes are not selected.
 */
export async function listTokens(userId: number): Promise<TokenRecord[]> {
  const { rows } = await query<TokenRow>(
    `select ${RECORD_COLUMNS_T}
       from api_tokens t
       join owner_members m on m.owner_id = t.owner_id
      where m.user_id = $1
      order by t.created_at desc`,
    [userId],
  );
  return rows.map(toRecord);
}

/**
 * Revoke a token the user owns. Returns false when the token does not exist or
 * belongs to someone else — the caller renders both as 404, so revocation cannot
 * be used to probe for token ids.
 *
 * Revocation is a tombstone (`revoked_at`), not a delete: the row stays as an
 * audit record of a credential that once existed, and its prefix stays reserved.
 */
export async function revokeToken(id: string, userId: number): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `update api_tokens t
        set revoked_at = now()
      where t.id = $1
        and t.revoked_at is null
        and exists (select 1 from owner_members m
                     where m.owner_id = t.owner_id and m.user_id = $2)
      returning t.id`,
    [id, userId],
  );
  return rows.length > 0;
}
