import "server-only";

import { randomBytes } from "node:crypto";

import {
  MutationError,
  applyOps,
  parseBundle,
  toJournalEvents,
  validateBundle,
  type Edge,
  type JournalEvent,
  type MutationOp,
  type Node,
  type Project,
  type ProjectBundle,
  type ValidationFinding,
} from "@arkaik/schema";

import { query, withTransaction } from "@/lib/services/db";
import { getHostedLimitsForTier } from "@/lib/services/limits";

/**
 * The hosted graph store (db/migrations/008_graph_projects.sql).
 *
 * This is `packages/mcp/src/store.ts`'s `persistMutation` lifted into Postgres:
 * same shared `applyOps` for the semantics, same `validateBundle` gate, same
 * dual-write of snapshot + journal. What changes is the persistence target and
 * the concurrency story.
 *
 * ── The write path, in order ────────────────────────────────────────────────
 *  1. `select … for update` the project row, scoped to the caller's owners.
 *  2. Apply the ops in memory via `applyOps` (@arkaik/schema).
 *  3. Gate on `validateBundle`. Any error → the transaction rolls back and the
 *     pathed findings come back to the caller. Nothing is written.
 *  4. Write the snapshot, bump `version`, append the derived events.
 *
 * ── Concurrency ─────────────────────────────────────────────────────────────
 * The row lock is what makes step 2 safe: two agents mutating the same project
 * serialize, and neither can compute its next graph from a stale read. Mutations
 * are small semantic ops rather than whole-bundle writes, so the lock is held
 * briefly and contention is rare in practice.
 *
 * `version` is a separate, complementary mechanism: it is not needed for
 * correctness (the lock covers that) but lets a client detect that the project
 * changed under it. `expectedVersion` is optional — omit it for "apply
 * regardless", pass it for "only if nothing moved".
 *
 * ── Authorization ───────────────────────────────────────────────────────────
 * Every statement filters on `owner_id = any(ownerIds)`. A project belonging to
 * someone else is indistinguishable from one that does not exist: both produce
 * `not_found`, never `forbidden`, so the API cannot be used to probe for ids.
 */

export interface GraphProjectSummary {
  id: string;
  bundleId: string;
  title: string;
  entityCount: number;
  version: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type StoreFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "validation"; errors: ValidationFinding[] }
  | { ok: false; reason: "mutation"; code: string; message: string }
  | { ok: false; reason: "conflict"; version: string }
  | { ok: false; reason: "limit"; limit: number; actual: number; tier: string };

export interface MutationSuccess {
  ok: true;
  version: string;
  nodes: Node[];
  edges: Edge[];
  events: JournalEvent[];
  warnings: ValidationFinding[];
}

export type MutationResult = MutationSuccess | StoreFailure;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Server-owned project id: unguessable, non-sequential, `prj_`-prefixed. */
export function generateProjectId(): string {
  return `prj_${randomBytes(12).toString("base64url")}`;
}

interface SnapshotShape {
  schema_version?: number;
  project: Project;
  nodes: Node[];
  edges: Edge[];
}

function entityCount(nodes: readonly unknown[], edges: readonly unknown[]): number {
  return nodes.length + edges.length;
}

/** Map an `applyOps` refusal onto a store failure, preserving its code. */
function toMutationFailure(err: unknown): StoreFailure {
  if (err instanceof MutationError) {
    return { ok: false, reason: "mutation", code: err.code, message: err.message };
  }
  throw err;
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
 * Full inbound gate for a client-supplied bundle: shape (zod) then semantic
 * graph rules, with the journal included. Used on create/import, where the
 * bundle and its history both arrive from outside and neither can be trusted.
 */
export function validateInboundBundle(input: unknown): { ok: boolean; findings: ValidationFinding[] } {
  const parsed = parseBundle(input);
  if (!parsed.success) {
    return { ok: false, findings: parsed.error.issues.map(zodIssueToFinding) };
  }
  const semantic = validateBundle(input);
  return semantic.valid ? { ok: true, findings: [] } : { ok: false, findings: semantic.errors };
}

// ---------------------------------------------------------------------------
// Reads (every statement owner-scoped)
// ---------------------------------------------------------------------------

export async function listProjects(ownerIds: readonly string[]): Promise<GraphProjectSummary[]> {
  const { rows } = await query<{
    id: string;
    bundle_id: string;
    title: string;
    entity_count: number;
    version: string;
    created_at: Date;
    updated_at: Date;
    archived_at: Date | null;
  }>(
    `select id, bundle_id, title, entity_count, version, created_at, updated_at, archived_at
       from graph_projects
      where owner_id = any($1::text[]) and archived_at is null
      order by updated_at desc`,
    [ownerIds],
  );

  return rows.map((row) => ({
    id: row.id,
    bundleId: row.bundle_id,
    title: row.title,
    entityCount: Number(row.entity_count),
    version: String(row.version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  }));
}

interface LoadedProject {
  snapshot: SnapshotShape;
  version: string;
  ownerId: string;
}

async function loadProject(
  projectId: string,
  ownerIds: readonly string[],
): Promise<LoadedProject | null> {
  const { rows } = await query<{ snapshot: SnapshotShape; version: string; owner_id: string }>(
    `select snapshot, version, owner_id
       from graph_projects
      where id = $1 and owner_id = any($2::text[])`,
    [projectId, ownerIds],
  );
  if (rows.length === 0) return null;
  return { snapshot: rows[0].snapshot, version: String(rows[0].version), ownerId: rows[0].owner_id };
}

export async function getNodes(projectId: string, ownerIds: readonly string[]): Promise<Node[] | null> {
  const loaded = await loadProject(projectId, ownerIds);
  return loaded ? loaded.snapshot.nodes : null;
}

export async function getEdges(projectId: string, ownerIds: readonly string[]): Promise<Edge[] | null> {
  const loaded = await loadProject(projectId, ownerIds);
  return loaded ? loaded.snapshot.edges : null;
}

/** The project's events in server order. Owner-scoped via the project row. */
export async function getJournal(
  projectId: string,
  ownerIds: readonly string[],
): Promise<JournalEvent[] | null> {
  const loaded = await loadProject(projectId, ownerIds);
  if (!loaded) return null;
  const { rows } = await query<{ event: JournalEvent }>(
    `select event from graph_events where project_id = $1 order by seq asc`,
    [projectId],
  );
  return rows.map((row) => row.event);
}

/** Snapshot + version, without the (potentially large) journal. */
export async function getProject(
  projectId: string,
  ownerIds: readonly string[],
): Promise<{ bundle: SnapshotShape; version: string } | null> {
  const loaded = await loadProject(projectId, ownerIds);
  return loaded ? { bundle: loaded.snapshot, version: loaded.version } : null;
}

/** The full interchange bundle: snapshot with its journal embedded. */
export async function exportProject(
  projectId: string,
  ownerIds: readonly string[],
): Promise<ProjectBundle | null> {
  const loaded = await loadProject(projectId, ownerIds);
  if (!loaded) return null;
  const journal = (await getJournal(projectId, ownerIds)) ?? [];
  return { ...loaded.snapshot, journal } as ProjectBundle;
}

// ---------------------------------------------------------------------------
// Create / archive
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  ownerId: string;
  tier: string;
  /** A full ProjectBundle from the client (import), already parsed as JSON. */
  bundle: unknown;
}

export async function createProject(
  input: CreateProjectInput,
): Promise<{ ok: true; id: string; version: string } | StoreFailure> {
  const validation = validateInboundBundle(input.bundle);
  if (!validation.ok) return { ok: false, reason: "validation", errors: validation.findings };

  const bundle = input.bundle as ProjectBundle & { journal?: JournalEvent[] };
  const limits = getHostedLimitsForTier(input.tier);
  const count = entityCount(bundle.nodes, bundle.edges);
  if (count > limits.entities) {
    return { ok: false, reason: "limit", limit: limits.entities, actual: count, tier: input.tier };
  }

  const { rows: existing } = await query<{ n: string }>(
    `select count(*) as n from graph_projects where owner_id = $1 and archived_at is null`,
    [input.ownerId],
  );
  const projectCount = Number(existing[0]?.n ?? 0);
  if (projectCount + 1 > limits.projects) {
    return { ok: false, reason: "limit", limit: limits.projects, actual: projectCount + 1, tier: input.tier };
  }

  const id = generateProjectId();
  const { journal = [], ...snapshot } = bundle;

  await withTransaction(async (client) => {
    await client.query(
      `insert into graph_projects (id, owner_id, bundle_id, title, snapshot, schema_version, entity_count)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        input.ownerId,
        bundle.project.id,
        bundle.project.title ?? "Untitled",
        JSON.stringify(snapshot),
        bundle.schema_version ?? 2,
        count,
      ],
    );

    // An imported bundle carries its own history. Events keep their original
    // ULIDs, so re-importing the same bundle into a *new* project is fine while
    // a duplicate id inside one project is impossible (the primary key).
    for (const event of journal) {
      await client.query(
        `insert into graph_events (id, project_id, event, actor) values ($1, $2, $3, $4)
         on conflict (id) do nothing`,
        [event.id, id, JSON.stringify(event), event.actor ?? "import"],
      );
    }
  });

  return { ok: true, id, version: "1" };
}

/** Archive (soft-delete). Returns false when the project is not the caller's. */
export async function archiveProject(projectId: string, ownerIds: readonly string[]): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `update graph_projects
        set archived_at = now(), updated_at = now()
      where id = $1 and owner_id = any($2::text[]) and archived_at is null
      returning id`,
    [projectId, ownerIds],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// The write path
// ---------------------------------------------------------------------------

export interface ApplyMutationInput {
  projectId: string;
  ownerIds: readonly string[];
  ops: readonly MutationOp[];
  actor: string;
  tier: string;
  /** When given, the mutation is refused unless the stored version matches. */
  expectedVersion?: string;
}

/**
 * Apply a batch of ops atomically.
 *
 * ── Why validation here skips the journal ───────────────────────────────────
 * `validateBundle` runs against the mutated snapshot WITHOUT loading the
 * project's event log. The graph rules that protect integrity — duplicate ids,
 * dangling edges, playlist↔composes coherence, flow cycles — are all snapshot
 * rules and run in full. The one check that needs history, `crossCheckJournal`
 * (does every status in the snapshot have a matching `node.status_changed`?),
 * is satisfied *by construction* on this path: the events are derived from the
 * diff by `applyOps`, not supplied by the caller, so they cannot disagree with
 * the snapshot they were derived from.
 *
 * Loading the whole event log on every write to re-prove something that cannot
 * be false would make write cost grow with project history. Client-supplied
 * bundles are a different matter and DO get the full gate, journal included,
 * in {@link createProject}.
 */
export async function applyMutation(input: ApplyMutationInput): Promise<MutationResult> {
  const limits = getHostedLimitsForTier(input.tier);

  return withTransaction(async (client) => {
    // FOR UPDATE: hold the row until commit, so a concurrent writer cannot
    // compute its next graph from the state we are about to replace.
    const { rows } = await client.query<{ snapshot: SnapshotShape; version: string }>(
      `select snapshot, version
         from graph_projects
        where id = $1 and owner_id = any($2::text[]) and archived_at is null
        for update`,
      [input.projectId, input.ownerIds],
    );
    if (rows.length === 0) return { ok: false, reason: "not_found" } as StoreFailure;

    const snapshot = rows[0].snapshot;
    const version = String(rows[0].version);

    if (input.expectedVersion !== undefined && input.expectedVersion !== version) {
      return { ok: false, reason: "conflict", version } as StoreFailure;
    }

    let outcome;
    try {
      outcome = applyOps(
        { projectId: snapshot.project.id, nodes: snapshot.nodes, edges: snapshot.edges },
        input.ops,
      );
    } catch (err) {
      return toMutationFailure(err);
    }

    const count = entityCount(outcome.nodes, outcome.edges);
    if (count > limits.entities) {
      return { ok: false, reason: "limit", limit: limits.entities, actual: count, tier: input.tier } as StoreFailure;
    }

    const candidate = { ...snapshot, nodes: outcome.nodes, edges: outcome.edges };
    const semantic = validateBundle(candidate);
    if (!semantic.valid) {
      // Returning (not throwing) still rolls nothing back — no write has
      // happened yet — and lets the caller render pathed findings.
      return { ok: false, reason: "validation", errors: semantic.errors } as StoreFailure;
    }

    const events = toJournalEvents(outcome.eventInputs, input.actor);
    // `version` is a bigint column and arrives as a string; BigInt keeps it exact
    // past 2^53. Written as BigInt(1) rather than a `1n` literal because the
    // app's tsconfig target predates BigInt literals.
    const nextVersion = (BigInt(version) + BigInt(1)).toString();

    await client.query(
      `update graph_projects
          set snapshot = $2, entity_count = $3, version = $4, title = $5, updated_at = now()
        where id = $1`,
      [
        input.projectId,
        JSON.stringify(candidate),
        count,
        nextVersion,
        candidate.project.title ?? "Untitled",
      ],
    );

    for (const event of events) {
      await client.query(
        `insert into graph_events (id, project_id, event, actor) values ($1, $2, $3, $4)`,
        [event.id, input.projectId, JSON.stringify(event), input.actor],
      );
    }

    return {
      ok: true,
      version: nextVersion,
      nodes: outcome.nodes,
      edges: outcome.edges,
      events,
      warnings: semantic.warnings ?? [],
    } as MutationSuccess;
  });
}

/** The caller's tier from `users.tier`, defaulting to the safe floor. */
export async function getUserTier(userId: number): Promise<string> {
  const { rows } = await query<{ tier: string }>(`select tier from users where id = $1`, [userId]);
  return rows[0]?.tier ?? "synk";
}
