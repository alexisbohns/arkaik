import "server-only";

import { randomBytes } from "node:crypto";

import type { PoolClient } from "pg";

import {
  MutationError,
  STATUS_VOCABULARY_VERSION,
  applyOps,
  migrateStatusVocabulary,
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
import { checkHostedEntityLimit, classifyIfMatch, computeBundleDelta, type BundleDelta } from "@/lib/services/graph/restore";
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
  /** Split rather than combined: the projects page renders them separately. */
  nodeCount: number;
  edgeCount: number;
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
 * Full inbound gate for a client-supplied bundle: shape (zod), then the v3
 * status-vocabulary migration, then semantic graph rules with the journal
 * included. Used on create/import, where the bundle and its history both
 * arrive from outside and neither can be trusted.
 *
 * The order is the same one every load path uses (parse → migrate → validate)
 * and is load-bearing: the shape parse is legacy-tolerant (`AnyStatusSchema`)
 * precisely so `migrateStatusVocabulary` can erase legacy ids before
 * `validateBundle`, which enforces the strict current vocabulary. On success
 * the MIGRATED bundle is returned — that is what must be stored, so post-v3
 * data is never persisted under a pre-v3 stamp.
 */
export function validateInboundBundle(
  input: unknown,
): { ok: true; bundle: ProjectBundle } | { ok: false; findings: ValidationFinding[] } {
  const parsed = parseBundle(input);
  if (!parsed.success) {
    return { ok: false, findings: parsed.error.issues.map(zodIssueToFinding) };
  }
  // Migrate the raw input rather than `parsed.data` so fields the zod schema
  // does not model are stored verbatim, as before.
  const bundle = migrateStatusVocabulary(input as ProjectBundle);
  const semantic = validateBundle(bundle);
  return semantic.valid ? { ok: true, bundle } : { ok: false, findings: semantic.errors };
}

// ---------------------------------------------------------------------------
// Reads (every statement owner-scoped)
// ---------------------------------------------------------------------------

export async function listProjects(ownerIds: readonly string[]): Promise<GraphProjectSummary[]> {
  // Counts come from the snapshot rather than a stored column: derived at read
  // time they cannot drift from the graph, and it needs no extra column to keep
  // in step with every write.
  const { rows } = await query<{
    id: string;
    bundle_id: string;
    title: string;
    node_count: number;
    edge_count: number;
    entity_count: number;
    version: string;
    created_at: Date;
    updated_at: Date;
    archived_at: Date | null;
  }>(
    `select id, bundle_id, title, entity_count, version, created_at, updated_at, archived_at,
            coalesce(jsonb_array_length(snapshot->'nodes'), 0) as node_count,
            coalesce(jsonb_array_length(snapshot->'edges'), 0) as edge_count
       from graph_projects
      where owner_id = any($1::text[]) and archived_at is null
      order by updated_at desc`,
    [ownerIds],
  );

  return rows.map((row) => ({
    id: row.id,
    bundleId: row.bundle_id,
    title: row.title,
    nodeCount: Number(row.node_count),
    edgeCount: Number(row.edge_count),
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
// Journal (graph_events) — read/write helpers shared by createProject (fresh
// import) and replaceProjectBundle (wholesale replace), so there is exactly
// one writer for this table rather than two that could quietly drift apart.
// ---------------------------------------------------------------------------

/**
 * Replace a project's ENTIRE journal: delete every existing row, then insert
 * the given events in array order.
 *
 * Used by two callers with different starting states, on purpose: a fresh
 * project from {@link createProject} has no existing rows, so the `delete`
 * is a no-op there; {@link replaceProjectBundle} calls this against a project
 * that genuinely already has a journal, and the delete is what makes this a
 * REPLACE rather than an append. One writer either way — extracted here
 * specifically so the two paths cannot become two subtly different insert
 * loops over time.
 *
 * Insertion ORDER is what fixes the read order: `seq` is a `bigserial` with
 * no per-project reset (db/migrations/008_graph_projects.sql — it is a
 * single global sequence shared by every project's rows), so `order by seq
 * asc` reads back events in whatever order they were INSERTED, not some
 * property of their content. The caller (bundle validation for create; the
 * CLI's `merge`, which sorts by `ts`, for restore) is responsible for the
 * array already being in the right order before it reaches here.
 *
 * `on conflict (project_id, id) do nothing`, matching the behavior this loop
 * already had inline in `createProject`: two events sharing an id within the
 * SAME inbound journal is tolerated rather than crashing the request over —
 * the composite `(project_id, id)` primary key exists specifically so this
 * can happen (two owners importing the same seed bundle keep its ULIDs), and
 * `validateBundle` has no duplicate-journal-id rule to have caught it first.
 */
async function replaceJournalRows(
  client: PoolClient,
  projectId: string,
  events: readonly JournalEvent[],
): Promise<void> {
  await client.query(`delete from graph_events where project_id = $1`, [projectId]);
  for (const event of events) {
    await client.query(
      `insert into graph_events (id, project_id, event, actor) values ($1, $2, $3, $4)
       on conflict (project_id, id) do nothing`,
      [event.id, projectId, JSON.stringify(event), event.actor ?? "import"],
    );
  }
}

/**
 * A project's journal, in server order — read with `client` rather than the
 * module-level `query()` because the caller already holds the row's `for
 * update` lock on this same client, inside this same transaction. Mirrors
 * `getJournal`'s query exactly; the only difference is which connection runs
 * it.
 */
async function loadJournalRows(client: PoolClient, projectId: string): Promise<JournalEvent[]> {
  const { rows } = await client.query<{ event: JournalEvent }>(
    `select event from graph_events where project_id = $1 order by seq asc`,
    [projectId],
  );
  return rows.map((row) => row.event);
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

  // The gate returned the vocabulary-migrated bundle: store THAT, so a fresh
  // hosted project can never hold unmigrated statuses.
  const bundle = validation.bundle;
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
        // Post-migration this is always >= 3 (the migration stamps pre-v3 and
        // unversioned bundles). The fallback is defensive and MUST match the
        // current vocabulary version: stamping older than the data's vocabulary
        // would re-run the non-idempotent backlog→idea remap on a later load.
        bundle.schema_version ?? STATUS_VOCABULARY_VERSION,
        count,
      ],
    );

    // An imported bundle carries its own history, and events keep their original
    // ULIDs. Those ids are unique per project, not globally — two owners
    // importing the same bundle hold the same event ids — so the conflict target
    // is the composite key. Targeting `(id)` alone would make the second import
    // of a journal-carrying bundle silently drop every event. `replaceJournalRows`
    // is the one writer for this table (see its own doc comment) — a fresh
    // project has nothing for its leading `delete` to remove, so this call is
    // equivalent to the insert loop this replaced, just shared with restore.
    await replaceJournalRows(client, id, journal);
  });

  return { ok: true, id, version: "1" };
}

/**
 * Update project-level fields (title, description, version, metadata) without
 * touching the graph.
 *
 * Separate from {@link applyMutation} because these are not graph edits: they
 * produce no journal events, exactly as the local provider's `saveProject` is on
 * the documented no-emit list. `id`, `nodes` and `edges` are ignored if present
 * — the graph is only ever changed through the mutations endpoint, so this
 * cannot become a second, ungated write path.
 */
export async function updateProjectFields(
  projectId: string,
  ownerIds: readonly string[],
  project: Partial<Project>,
): Promise<{ ok: true; version: string } | StoreFailure> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ snapshot: SnapshotShape; version: string }>(
      `select snapshot, version from graph_projects
        where id = $1 and owner_id = any($2::text[]) and archived_at is null
        for update`,
      [projectId, ownerIds],
    );
    if (rows.length === 0) return { ok: false, reason: "not_found" } as StoreFailure;

    const snapshot = rows[0].snapshot;
    const {
      id: _ignoredId,
      ...safeFields
    } = project as Partial<Project> & { nodes?: unknown; edges?: unknown };
    void _ignoredId;
    delete (safeFields as { nodes?: unknown }).nodes;
    delete (safeFields as { edges?: unknown }).edges;

    const nextProject = { ...snapshot.project, ...safeFields, id: snapshot.project.id };
    const candidate = { ...snapshot, project: nextProject };

    const semantic = validateBundle(candidate);
    if (!semantic.valid) return { ok: false, reason: "validation", errors: semantic.errors } as StoreFailure;

    const nextVersion = (BigInt(rows[0].version) + BigInt(1)).toString();
    await client.query(
      `update graph_projects set snapshot = $2, title = $3, version = $4, updated_at = now() where id = $1`,
      [projectId, JSON.stringify(candidate), nextProject.title ?? "Untitled", nextVersion],
    );
    return { ok: true, version: nextVersion };
  });
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

// ---------------------------------------------------------------------------
// Whole-bundle restore — the one destructive verb in the graph API
// ---------------------------------------------------------------------------

export interface ReplaceProjectBundleInput {
  projectId: string;
  ownerIds: readonly string[];
  /** A full ProjectBundle from the client, already parsed as JSON. */
  bundle: unknown;
  /** The version the caller read, classified via `classifyIfMatch`. Required — there is no wildcard escape hatch for this verb. */
  ifMatch: string | undefined;
  tier: string;
  /**
   * When true, runs the identical validate → limit-check → version-check →
   * delta path and returns it WITHOUT writing anything. See the function's
   * own doc comment for how "without writing" is structural, not just an
   * early return by convention.
   */
  dryRun?: boolean;
}

export type ReplaceResult =
  | { ok: true; version: string; delta: BundleDelta }
  | { ok: false; reason: "not_found" }
  // The caller sent no `If-Match` at all (missing / empty / whitespace-only).
  | { ok: false; reason: "precondition_required" }
  // A shape this endpoint refuses on principle: wildcard, weak ETag, multi-value list.
  | { ok: false; reason: "precondition_unsupported" }
  // A well-formed version that just isn't the current one — the one genuine conflict.
  | { ok: false; reason: "conflict"; current: string }
  | { ok: false; reason: "validation"; errors: ValidationFinding[] }
  // `limit` is `number | null` (never `Infinity`) — see checkHostedEntityLimit.
  | { ok: false; reason: "limit"; limit: number | null; actual: number; tier: string };

/**
 * Replace a hosted project's snapshot AND journal wholesale.
 *
 * The mutation path (`applyMutation`) derives journal events from the diff it
 * applies, which is why it cannot express a backdated `node.status_changed`
 * or a `deliverable.shipped` mined from a merged PR. Bootstrap constructs
 * exactly that history offline, so it needs a verb that accepts a finished
 * bundle, journal included — the landing path for mined history on a hosted
 * project (docs/superpowers/specs/2026-08-04-bootstrap-method-design.md § 7).
 *
 * The bundle gets the FULL inbound gate — shape, vocabulary migration, and
 * semantic rules with the journal included — the same one `createProject`
 * applies, and for the same reason: the bundle and its history both arrive
 * from outside and neither can be trusted.
 *
 * ── Ownership ────────────────────────────────────────────────────────────
 * "Owner-only" is not a separate check bolted on: it is the SAME
 * `owner_id = any(ownerIds)` scoping every other write in this file uses. A
 * project belonging to another owner is `not_found` here exactly as it is
 * everywhere else — indistinguishable from one that does not exist.
 *
 * ── Locking ──────────────────────────────────────────────────────────────
 * `select … for update`, same as {@link applyMutation} and for the same
 * reason: this is the one destructive verb in the API, so two restores (or a
 * restore and a mutation) racing the same project MUST serialize rather than
 * one silently computing its delta or its write against a row the other is
 * simultaneously replacing. Whichever transaction's `for update` runs first
 * holds the row until it commits or rolls back; the other blocks and then
 * reads the POST-write state — which is exactly what makes its own
 * `If-Match` check (if it has one) meaningful rather than decorative.
 *
 * ── `If-Match`, read-then-compare, in the right order ──────────────────────
 * `classifyIfMatch` runs against `current.version` — the version read a
 * moment ago BY THIS SAME QUERY, under the lock this transaction now holds —
 * never a version read before the lock was acquired. Comparing against an
 * earlier read would make the check race-vulnerable: another writer could
 * commit between that read and this one taking the lock, and the comparison
 * would pass against a version that is no longer current.
 *
 * ── Dry run: structurally non-writing, not merely an early return ──────────
 * When `dryRun` is true, the function returns immediately after computing the
 * delta — BEFORE the `update graph_projects` / `replaceJournalRows` calls
 * that follow it in the source. Those two statements are the ONLY mutating
 * statements in this function, and they sit textually after this return, in
 * a straight-line function body with no loop or callback that could reach
 * them out of order. There is no boolean threaded down into a shared write
 * helper that a future edit could forget to check — the write path is
 * simply never reached, full stop, when this branch is taken. (This machine
 * has no Postgres to run an integration assertion against; verifying "no
 * write occurred" against a live database is exactly the kind of check the
 * PR should get before merge — see the task's own report for what could not
 * be verified here.)
 */
export async function replaceProjectBundle(input: ReplaceProjectBundleInput): Promise<ReplaceResult> {
  const validation = validateInboundBundle(input.bundle);
  if (!validation.ok) return { ok: false, reason: "validation", errors: validation.findings };

  // The gate returned the vocabulary-migrated bundle: store THAT, exactly as
  // createProject does, so a restored project can never hold unmigrated
  // statuses.
  const bundle = validation.bundle;

  // checkHostedEntityLimit (lib/services/graph/restore.ts) instead of
  // re-deriving `entityCount(...) > limits.entities` a third time — its
  // `actual` is the identical nodes.length + edges.length computation
  // `entityCount` performs, so it also becomes the value written to the
  // `entity_count` column below.
  const check = checkHostedEntityLimit(bundle, input.tier);
  if (!check.ok) {
    return { ok: false, reason: "limit", limit: check.limit, actual: check.actual, tier: input.tier };
  }

  const { journal = [], ...snapshot } = bundle;

  return withTransaction(async (client) => {
    // FOR UPDATE: hold the row until commit — see the doc comment above for
    // why restore needs the same lock applyMutation does.
    const { rows } = await client.query<{ snapshot: SnapshotShape; version: string }>(
      `select snapshot, version from graph_projects
        where id = $1 and owner_id = any($2::text[]) and archived_at is null
        for update`,
      [input.projectId, input.ownerIds],
    );
    const current = rows[0];
    if (!current) return { ok: false, reason: "not_found" } as const;

    // Classified against `current.version` — read by the query directly
    // above, under the lock this transaction now holds. See the "If-Match,
    // read-then-compare" note above for why the ordering here is load-bearing.
    const classification = classifyIfMatch(input.ifMatch, current.version);
    if (classification === "absent") return { ok: false, reason: "precondition_required" } as const;
    if (classification === "unsupported") return { ok: false, reason: "precondition_unsupported" } as const;
    if (classification === "stale") return { ok: false, reason: "conflict", current: current.version } as const;

    const previousJournal = await loadJournalRows(client, input.projectId);
    const delta = computeBundleDelta(
      { ...current.snapshot, journal: previousJournal },
      { ...snapshot, journal },
    );

    if (input.dryRun) {
      // No write below this line is ever reached in this branch — see the
      // function's own doc comment for why that is structural rather than
      // just "returns early."
      return { ok: true, version: current.version, delta } as const;
    }

    // `version` is a bigint column (db/migrations/008_graph_projects.sql:44),
    // bumped the same way applyMutation does it — BigInt keeps it exact past
    // 2^53. This is NOT `randomBytes(...).toString("hex")`: that generator
    // mints project ids (`generateProjectId`), a different value with a
    // different (mixed-case, base64url) encoding, for a different column.
    const nextVersion = (BigInt(current.version) + BigInt(1)).toString();

    await client.query(
      `update graph_projects
          set snapshot = $2, version = $3, entity_count = $4, title = $5, updated_at = now()
        where id = $1`,
      [input.projectId, JSON.stringify(snapshot), nextVersion, check.actual, snapshot.project.title ?? "Untitled"],
    );
    await replaceJournalRows(client, input.projectId, journal);

    return { ok: true, version: nextVersion, delta } as const;
  });
}

/** The caller's tier from `users.tier`, defaulting to the safe floor. */
export async function getUserTier(userId: number): Promise<string> {
  const { rows } = await query<{ tier: string }>(`select tier from users where id = $1`, [userId]);
  return rows[0]?.tier ?? "synk";
}
