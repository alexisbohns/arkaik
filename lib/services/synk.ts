import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  parseBundle,
  serializeBundle,
  validateBundle,
  type ProjectBundle,
  type ValidationFinding,
} from "@arkaik/schema";

import { query } from "@/lib/services/db";
import { getLimitsForTier } from "@/lib/services/limits";

/**
 * Server-side Synk logic (docs/spec/services.md § Synk). Kept out of the route
 * handlers so the security-critical bits — user-scoped authorization, content-
 * hash dedupe, tier-limit enforcement, and retention pruning — live in one
 * audited place and can be integration-tested by importing this module or the
 * handlers that call it (mirrors lib/services/publik.ts).
 *
 * Hard boundaries inherited from the spec, enforced here:
 *  - One-way, browser-authoritative. The server stores what the client sends,
 *    verbatim; it never re-projects, merges, or writes server state back down.
 *  - Journal INCLUDED. Unlike Publik there is no strip — a backup is the user's
 *    private data and must round-trip history intact (§ Synk → "Journal
 *    included").
 *  - Authorization is by ownership. Every row carries `user_id`; every query in
 *    this module filters on the caller's user id (§ "Authorization is by
 *    ownership"). No query is reachable that returns another user's rows.
 *  - Every SQL statement is parameterized via the shared `query()` helper.
 *
 * ── Dedupe contract (§ "Content-hash dedupe") ──────────────────────────────
 * The client serializes with the canonical `serializeBundle()` and MAY send the
 * resulting sha256 in the `x-bundle-sha256` request header. That header is
 * ADVISORY — a skip-early optimization only: when it equals the latest stored
 * hash, the server short-circuits to `deduped` without re-validating. Otherwise
 * the server recomputes the hash from its OWN canonicalization of the received
 * body (`sha256(serializeBundle(bundle))`) and treats that server-computed hash
 * as the single source of truth for both the dedupe comparison and the value
 * persisted on the backup row. A lying or stale client header can only cause the
 * client to skip storing its own change — never a wrong hash on disk.
 */

/** Header the client uses to advertise the canonical hash (skip-early only). */
export const BUNDLE_SHA256_HEADER = "x-bundle-sha256";

// ---------------------------------------------------------------------------
// Availability (mirrors lib/services/publik.ts § graceful absence)
// ---------------------------------------------------------------------------

/** True when the services surface has a database configured. */
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
      message: "arkaik services (Synk) are not configured on this deployment.",
    },
    { status: 503 },
  );
}

// ---------------------------------------------------------------------------
// Crypto / small helpers
// ---------------------------------------------------------------------------

/**
 * Server-generated backup id: 16 random bytes (128-bit) as URL-safe base64 →
 * 22 chars, no padding. Globally unique (its own primary key), unguessable, and
 * non-sequential (mirrors publik.ts's snapshot id).
 */
export function generateBackupId(): string {
  return randomBytes(16).toString("base64url");
}

/** SHA-256 hex of a string — used for the canonical-serialization content hash. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Entity count for tier enforcement: nodes.length + edges.length (§ Limits). */
export function countEntities(bundle: Record<string, unknown>): number {
  const nodes = Array.isArray(bundle.nodes) ? bundle.nodes.length : 0;
  const edges = Array.isArray(bundle.edges) ? bundle.edges.length : 0;
  return nodes + edges;
}

// ---------------------------------------------------------------------------
// Validation (mirrors lib/services/publik.ts's inbound gate)
// ---------------------------------------------------------------------------

export interface BundleValidation {
  ok: boolean;
  findings: ValidationFinding[];
}

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
 * shape errors short-circuit the semantic pass. Warnings never fail — the server
 * accepts conformance Levels 0–2 like every consumer.
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
// Tier lookup
// ---------------------------------------------------------------------------

/**
 * The caller's tier from `users.tier`. M4 has no path that sets it to anything
 * but the 'synk' default, but the lookup is real so M5 billing only flips the
 * column. A missing row (should not happen for a valid session) resolves to the
 * safe 'synk' floor via getLimitsForTier.
 */
export async function getUserTier(userId: number): Promise<string> {
  const { rows } = await query<{ tier: string }>(`select tier from users where id = $1`, [userId]);
  return rows[0]?.tier ?? "synk";
}

// ---------------------------------------------------------------------------
// Reads (every statement user-scoped)
// ---------------------------------------------------------------------------

export interface ProjectListing {
  project_id: string;
  title: string;
  updated_at: string;
  latest_backup_id: string | null;
  latest_sha256: string | null;
  latest_size_bytes: number | null;
  latest_entity_count: number | null;
  latest_created_at: string | null;
}

/** List the caller's backed-up projects with each project's latest backup metadata. */
export async function listProjects(userId: number): Promise<ProjectListing[]> {
  const { rows } = await query<ProjectListing>(
    `select p.id                as project_id,
            p.title             as title,
            p.updated_at        as updated_at,
            b.id                as latest_backup_id,
            b.sha256            as latest_sha256,
            b.size_bytes        as latest_size_bytes,
            b.entity_count      as latest_entity_count,
            b.created_at        as latest_created_at
       from synk_projects p
       left join lateral (
         select id, sha256, size_bytes, entity_count, created_at
           from synk_backups
          where user_id = p.user_id and project_id = p.id
          order by created_at desc
          limit 1
       ) b on true
      where p.user_id = $1
      order by p.updated_at desc`,
    [userId],
  );
  return rows;
}

export interface BackupListing {
  id: string;
  created_at: string;
  size_bytes: number;
  entity_count: number;
  sha256: string;
}

/**
 * List the retained backup versions of one project (id, created_at, size,
 * content hash), newest first. User-scoped: a project id belonging to another
 * user yields an empty list, never their rows.
 */
export async function listBackups(userId: number, projectId: string): Promise<BackupListing[]> {
  const { rows } = await query<BackupListing>(
    `select id, created_at, size_bytes, entity_count, sha256
       from synk_backups
      where user_id = $1 and project_id = $2
      order by created_at desc`,
    [userId, projectId],
  );
  return rows;
}

/** True when the caller owns a project row with this id. */
export async function projectExists(userId: number, projectId: string): Promise<boolean> {
  const { rowCount } = await query(`select 1 from synk_projects where user_id = $1 and id = $2`, [
    userId,
    projectId,
  ]);
  return (rowCount ?? 0) > 0;
}

/**
 * The stored bundle JSON for a backup id, or null when no such backup exists FOR
 * THIS USER. The `user_id = $2` filter is the authorization boundary: a backup
 * id owned by another user is indistinguishable from a missing one.
 */
export async function getBackupBundle(userId: number, backupId: string): Promise<unknown | null> {
  const { rows } = await query<{ bundle: unknown }>(
    `select bundle from synk_backups where id = $1 and user_id = $2`,
    [backupId, userId],
  );
  return rows.length ? rows[0].bundle : null;
}

/**
 * Delete a project and (via the composite cascade FK) all its backups. Returns
 * true when a row was removed, false when the caller owns no such project.
 */
export async function deleteProject(userId: number, projectId: string): Promise<boolean> {
  const { rowCount } = await query(`delete from synk_projects where user_id = $1 and id = $2`, [
    userId,
    projectId,
  ]);
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Prune backups older than `retentionDays` for one project in a single
 * statement — except the newest backup per project, which is NEVER pruned
 * regardless of age (§ Retention). Runs on every successful write (no cron), and
 * is exported so it can be exercised directly in tests.
 *
 * The `id <> (newest)` subquery is what keeps the newest-even-when-stale row:
 * if every backup is older than the window, the delete still spares the most
 * recent one. Klub's `retention_days` is Infinity → not finite → we prune
 * nothing (keep every backup forever), which also keeps `make_interval` from
 * ever seeing a non-integer.
 */
export async function pruneRetention(
  userId: number,
  projectId: string,
  retentionDays: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays)) return 0;
  const { rowCount } = await query(
    `delete from synk_backups
      where user_id = $1
        and project_id = $2
        and created_at < now() - make_interval(days => $3::int)
        and id <> (
          select id
            from synk_backups
           where user_id = $1 and project_id = $2
           order by created_at desc
           limit 1
        )`,
    [userId, projectId, retentionDays],
  );
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Write (PUT backup) — validation, dedupe, limits, store, prune
// ---------------------------------------------------------------------------

export type PutBackupResult =
  | { status: "invalid"; findings: ValidationFinding[] }
  | { status: "limit"; limit: number; actual: number; tier: string }
  | { status: "deduped" }
  | { status: "stored"; backupId: string };

/** Latest stored content hash for a project, or null when it has no backups. */
async function latestHash(userId: number, projectId: string): Promise<string | null> {
  const { rows } = await query<{ sha256: string }>(
    `select sha256 from synk_backups
      where user_id = $1 and project_id = $2
      order by created_at desc
      limit 1`,
    [userId, projectId],
  );
  return rows.length ? rows[0].sha256 : null;
}

/**
 * Store a backup version for `projectId` owned by `userId`, or report why not.
 * Order (§ Backup protocol): advisory skip → validate → dedupe → limits → store
 * → prune.
 *
 *  1. If the client's advisory `clientHash` equals the latest stored hash, the
 *     content is unchanged — short-circuit to `deduped` without re-validating.
 *  2. Validate through @arkaik/schema; invalid → `invalid` (→ 422).
 *  3. Recompute the server-truth hash from the canonical serialization and
 *     compare to the latest stored hash; equal → `deduped` (→ 200). A no-op
 *     re-backup is deduped BEFORE limits, so an unchanged bundle never 403s.
 *  4. Enforce tier limits on the content actually being stored — entities
 *     (nodes + edges) and, for a project new to this user, the project count.
 *     Violation → `limit` (→ 403 with { limit, actual, tier }).
 *  5. Upsert the project row, insert the backup (with the server-truth hash),
 *     then prune retention. → `stored` (→ 201).
 */
export async function putBackup(args: {
  userId: number;
  projectId: string;
  input: unknown;
  clientHash?: string | null;
}): Promise<PutBackupResult> {
  const { userId, projectId, input, clientHash } = args;

  const priorHash = await latestHash(userId, projectId);

  // 1. Advisory skip-early: trust the client's claim of "nothing changed" only
  //    to AVOID work, never to write. The prior bundle was validated when stored.
  if (clientHash && priorHash && clientHash === priorHash) {
    return { status: "deduped" };
  }

  // 2. Validate.
  const validation = validateInboundBundle(input);
  if (!validation.ok) {
    return { status: "invalid", findings: validation.findings };
  }
  const bundle = input as Record<string, unknown>;

  // 3. Server-truth hash + dedupe.
  const canonical = serializeBundle(bundle as unknown as ProjectBundle);
  const serverHash = sha256Hex(canonical);
  if (priorHash && serverHash === priorHash) {
    return { status: "deduped" };
  }

  // 4. Tier limits on what is about to be stored.
  const tier = await getUserTier(userId);
  const limits = getLimitsForTier(tier);

  const entities = countEntities(bundle);
  if (entities > limits.entities) {
    return { status: "limit", limit: limits.entities, actual: entities, tier };
  }

  const isNewProject = !(await projectExists(userId, projectId));
  if (isNewProject) {
    const { rows } = await query<{ n: number }>(
      `select count(*)::int as n from synk_projects where user_id = $1`,
      [userId],
    );
    const wouldBe = Number(rows[0]?.n ?? 0) + 1;
    if (wouldBe > limits.projects) {
      return { status: "limit", limit: limits.projects, actual: wouldBe, tier };
    }
  }

  // 5. Store: upsert project (denormalized title), insert backup, prune.
  const project = (bundle.project ?? {}) as Record<string, unknown>;
  const title = typeof project.title === "string" && project.title.trim() ? project.title : "Untitled";
  const sizeBytes = Buffer.byteLength(canonical, "utf8");
  const backupId = generateBackupId();

  await query(
    `insert into synk_projects (user_id, id, title)
     values ($1, $2, $3)
     on conflict (user_id, id) do update set title = excluded.title, updated_at = now()`,
    [userId, projectId, title],
  );

  await query(
    `insert into synk_backups (id, user_id, project_id, bundle, sha256, size_bytes, entity_count)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [backupId, userId, projectId, JSON.stringify(bundle), serverHash, sizeBytes, entities],
  );

  await pruneRetention(userId, projectId, limits.retention_days);

  return { status: "stored", backupId };
}
