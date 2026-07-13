import "server-only";

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { parseBundle, validateBundle, type ValidationFinding } from "@arkaik/schema";

import { query } from "@/lib/services/db";

/**
 * Server-side Publik logic (docs/spec/services.md § Publik). Kept out of the
 * route handlers so the security-critical bits — owner-key hashing, journal
 * strip, IP-hashed rate limiting, schema validation — live in one audited place
 * and can be unit/integration tested by importing this module or the handlers
 * that call it.
 *
 * Invariants enforced here (§ Security & Privacy):
 *  - Owner keys are never persisted or logged; only their SHA-256 hash is stored.
 *  - Journals are stripped server-side by default; opt-in is explicit.
 *  - Raw client IPs are never stored; only a keyed HMAC-SHA256 hash is.
 *  - Every SQL statement is parameterized via the shared `query()` helper.
 */

/** Import cap mirrored from the app (docs/spec/services.md § Publik → "Size cap 5 MB"). */
export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

/** Per-IP creation throttle: ~10 creations per hour (§ Publik → "Rate limiting"). */
export const CREATE_RATE_LIMIT = 10;

/** Per-IP report throttle. More lenient than creation but still real (§ Moderation). */
export const REPORT_RATE_LIMIT = 30;

/** `report_count` at/above which a snapshot is flagged for review (§ Moderation). */
export const REPORT_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

/**
 * Server-generated snapshot id: 16 random bytes (128-bit) as URL-safe base64
 * → 22 chars, no padding. Unguessable and non-sequential, comfortably above
 * the spec's "≥ 10 chars of ≥ 64-bit randomness" floor (§ Publik → "id").
 */
export function generateSnapshotId(): string {
  return randomBytes(16).toString("base64url");
}

/** Owner key: a UUID v4, returned to the caller exactly once (§ Publik → "owner_key"). */
export function generateOwnerKey(): string {
  return randomUUID();
}

/** SHA-256 hex of an owner key — the only form ever stored (§ Security & Privacy). */
export function hashOwnerKey(ownerKey: string): string {
  return createHash("sha256").update(ownerKey).digest("hex");
}

/**
 * Salt/key for the IP HMAC. A plain SHA-256 of an IPv4 is trivially reversible
 * (the address space is tiny), so the hash is keyed. In production AUTH_SECRET
 * is set and used; self-hosters can set RATE_LIMIT_SALT; the constant fallback
 * still avoids persisting any raw address, which is the stored-data guarantee
 * the spec requires.
 */
function ipHashKey(): string {
  return process.env.RATE_LIMIT_SALT ?? process.env.AUTH_SECRET ?? "arkaik-publik-rate-limit-v1";
}

/** Keyed HMAC-SHA256 of a client IP — never the raw IP (§ Security & Privacy). */
export function hashIp(ip: string): string {
  return createHmac("sha256", ipHashKey()).update(ip).digest("hex");
}

/**
 * Constant-time comparison of a presented owner key against a stored hash.
 * Both operands are 32-byte SHA-256 digests, so lengths always match and
 * `timingSafeEqual` never throws; the compare leaks no timing signal about how
 * many bytes matched (§ Publik → DELETE "constant-time hash compare").
 */
export function ownerKeyMatches(presentedKey: string, storedHashHex: string): boolean {
  const presented = Buffer.from(hashOwnerKey(presentedKey), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHashHex, "hex");
  } catch {
    return false;
  }
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/**
 * Client IP from the first `x-forwarded-for` hop (Vercel sets it), falling back
 * to `x-real-ip`, then a shared "unknown" bucket. The first hop is the closest
 * the platform can attest to the real client; later hops are proxy addresses.
 */
export function deriveClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return "unknown";
}

/** True when the services surface has no database configured. */
export function servicesConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * 503 for when `DATABASE_URL` is unset: the local-first app still builds and
 * serves, and the client gets a clear, non-crashing signal that hosted services
 * are absent on this deployment (docs/spec/services.md § Backend — env vars).
 */
export function servicesUnavailable(): Response {
  return Response.json(
    {
      error: "services_unavailable",
      message: "arkaik services (Publik) are not configured on this deployment.",
    },
    { status: 503 },
  );
}

// ---------------------------------------------------------------------------
// Journal strip
// ---------------------------------------------------------------------------

/**
 * Remove the `journal` array from a bundle, returning a shallow copy with every
 * other key preserved verbatim. The privacy default of docs/spec/journal.md is
 * enforced here, server-side — it MUST NOT depend on client behavior (§ Publik).
 */
export function stripJournal(bundle: Record<string, unknown>): Record<string, unknown> {
  const { journal: _journal, ...rest } = bundle;
  void _journal;
  return rest;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface BundleValidation {
  ok: boolean;
  /** Error-severity findings (shape + semantic), structured for a 422 body. */
  findings: ValidationFinding[];
}

/** Map a zod issue to the same finding shape `validateBundle` emits. */
function zodIssueToFinding(issue: { path: PropertyKey[]; code: string; message: string }): ValidationFinding {
  return {
    path: issue.path.map((p) => String(p)).join("."),
    rule: issue.code,
    message: issue.message,
    severity: "error",
  };
}

/**
 * Full inbound gate: `parseBundle` (shape, zod) then `validateBundle` (semantic
 * graph rules). Errors from either become structured findings for a 422; zod
 * shape errors short-circuit the semantic pass since it assumes a rough shape.
 * Warnings never fail (§ Publik → "warnings pass").
 */
export function validateInboundBundle(input: unknown): BundleValidation {
  const parsed = parseBundle(input);
  if (!parsed.success) {
    return { ok: false, findings: parsed.error.issues.map(zodIssueToFinding) };
  }
  const semantic = validateBundle(input);
  if (!semantic.valid) {
    return { ok: false, findings: semantic.errors };
  }
  return { ok: true, findings: [] };
}

// ---------------------------------------------------------------------------
// Rate limiting (Postgres-backed, per-IP)
// ---------------------------------------------------------------------------

export type RateLimitResult = { limited: false } | { limited: true; retryAfter: number };

/**
 * Sliding-window per-IP throttle in Postgres (§ Publik → "Rate limiting").
 * Prunes this key's expired rows first (opportunistic cleanup, no cron), counts
 * rows in the window, and either records a fresh hit (allowed) or reports how
 * many seconds until the oldest in-window hit expires (rejected).
 */
export async function checkRateLimit(
  ipHash: string,
  action: string,
  limit: number,
): Promise<RateLimitResult> {
  // The 1-hour window is a fixed SQL literal — never interpolated from input —
  // so the whole file keeps its "every value goes through $-params" property.
  await query(
    `delete from publik_rate_limits
      where ip_hash = $1 and action = $2 and created_at <= now() - interval '1 hour'`,
    [ipHash, action],
  );

  const { rows } = await query<{ hits: number; retry_after: number | null }>(
    `select count(*)::int as hits,
            ceil(extract(epoch from (min(created_at) + interval '1 hour' - now())))::int as retry_after
       from publik_rate_limits
      where ip_hash = $1 and action = $2 and created_at > now() - interval '1 hour'`,
    [ipHash, action],
  );

  const hits = Number(rows[0]?.hits ?? 0);
  if (hits >= limit) {
    const retryAfter = Math.max(1, Number(rows[0]?.retry_after ?? 3600));
    return { limited: true, retryAfter };
  }

  await query(`insert into publik_rate_limits (ip_hash, action) values ($1, $2)`, [ipHash, action]);
  return { limited: false };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StoredSnapshot {
  id: string;
  ownerKey: string;
}

/**
 * Persist a validated, already-stripped bundle. Generates the id + owner key,
 * stores only `sha256(owner_key)`, and returns the plaintext owner key to the
 * caller for its one-and-only-time delivery. Snapshots are immutable — there is
 * no update path (§ Publik → Storage).
 */
export async function storeSnapshot(bundle: Record<string, unknown>): Promise<StoredSnapshot> {
  const id = generateSnapshotId();
  const ownerKey = generateOwnerKey();
  const ownerKeyHash = hashOwnerKey(ownerKey);

  const project = (bundle.project ?? {}) as Record<string, unknown>;
  const title = typeof project.title === "string" ? project.title : "Untitled";
  const schemaVersion =
    typeof bundle.schema_version === "number" ? bundle.schema_version : 1;
  const sizeBytes = Buffer.byteLength(JSON.stringify(bundle), "utf8");

  await query(
    `insert into publik_snapshots
       (id, owner_key_hash, bundle, schema_version, title, size_bytes)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, ownerKeyHash, JSON.stringify(bundle), schemaVersion, title, sizeBytes],
  );

  return { id, ownerKey };
}

/** Fetch the stored bundle JSON for an id, or null if none exists. */
export async function fetchSnapshotBundle(id: string): Promise<unknown | null> {
  const { rows } = await query<{ bundle: unknown }>(
    `select bundle from publik_snapshots where id = $1`,
    [id],
  );
  return rows.length ? rows[0].bundle : null;
}

export interface SnapshotSummary {
  /** The stored bundle JSON, verbatim (post journal-strip unless opted in). */
  bundle: unknown;
  /** ISO 8601 timestamp of when the snapshot was created. */
  createdAt: string;
}

/**
 * Fetch a snapshot's bundle plus its creation timestamp, for the `/p/{id}`
 * preview page (docs/spec/services.md § Publik → Surfaces: "created date").
 * Kept separate from {@link fetchSnapshotBundle} — which backs `GET
 * /api/publik/{id}` and must keep returning the bundle alone — so that
 * endpoint's response shape never changes.
 */
export async function fetchSnapshotSummary(id: string): Promise<SnapshotSummary | null> {
  const { rows } = await query<{ bundle: unknown; created_at: Date }>(
    `select bundle, created_at from publik_snapshots where id = $1`,
    [id],
  );
  if (!rows.length) return null;
  return { bundle: rows[0].bundle, createdAt: rows[0].created_at.toISOString() };
}

export type DeleteOutcome = "deleted" | "not_found" | "forbidden";

/**
 * Delete a snapshot iff the presented owner key hashes to the stored hash.
 * Constant-time compare; missing row → not_found, mismatch → forbidden.
 */
export async function deleteSnapshot(id: string, presentedKey: string): Promise<DeleteOutcome> {
  const { rows } = await query<{ owner_key_hash: string }>(
    `select owner_key_hash from publik_snapshots where id = $1`,
    [id],
  );
  if (!rows.length) return "not_found";
  if (!ownerKeyMatches(presentedKey, rows[0].owner_key_hash)) return "forbidden";

  await query(`delete from publik_snapshots where id = $1`, [id]);
  return "deleted";
}

export interface ReportOutcome {
  found: boolean;
  reportCount: number;
  flagged: boolean;
}

/** Increment `report_count`; flag for review at/above the threshold (§ Moderation). */
export async function reportSnapshot(id: string): Promise<ReportOutcome> {
  const { rows } = await query<{ report_count: number }>(
    `update publik_snapshots
        set report_count = report_count + 1
      where id = $1
      returning report_count`,
    [id],
  );
  if (!rows.length) return { found: false, reportCount: 0, flagged: false };
  const reportCount = Number(rows[0].report_count);
  return { found: true, reportCount, flagged: reportCount >= REPORT_THRESHOLD };
}
