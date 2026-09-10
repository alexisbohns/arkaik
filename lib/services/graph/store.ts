import "server-only";

import { randomBytes } from "node:crypto";

import type { PoolClient } from "pg";

import {
  MutationError,
  STATUS_VOCABULARY_VERSION,
  applyOps,
  migrateStatusVocabulary,
  orderEvents,
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

import { ADVISORY_LOCK, getUserTier, query, withTransaction } from "@/lib/services/db";
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
 * ── The one exception to "append-only" ──────────────────────────────────────
 * Steps 1–4 above never delete a `graph_events` row — the mutation path only
 * ever adds. `replaceProjectBundle`, below, is the one verb in this file (and
 * the one destructive verb in the graph API) that deletes from the journal at
 * all: bootstrap's whole-bundle restore replaces a project's entire event log
 * wholesale, because mined history has no other landing path onto a hosted
 * project (docs/superpowers/specs/2026-08-04-bootstrap-method-design.md § 7).
 * See that function's own doc comment, and `replaceJournalRows`'s, for why
 * that is safe here and nowhere else in this file.
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

/**
 * The read validators of a project — what the read routes' ETags are built
 * from (lib/services/graph/etag.ts explains the composites and why they are
 * weak; docs/spec/services.md § Hosted Graph Projects → Read contract).
 *
 * All three are STRINGS: `version` is a bigint and the counts are bigints
 * too, and `pg` hands both over as decimal strings. They are compared and
 * concatenated, never arithmetically used, so nothing here ever goes through
 * `Number()` — past 2^53 that would silently collapse two versions into one.
 */
export interface ProjectValidators {
  version: string;
  /** Every `graph_events` row of the project — `/journal` and `/export` depend on all of them. */
  eventCount: string;
  /** Only the `quality.finding.*` decisions — the ones `foldFindingEvents` reads into the bundle. */
  qualityEventCount: string;
}

interface ValidatorColumns {
  version: string;
  event_count: string;
  quality_event_count: string;
}

/**
 * The validator columns, selected off `graph_projects p` in the SAME
 * statement as whatever body a read returns, so ETag and body come from one
 * snapshot-consistent read. `count(*)`, not `max(seq)`: `appendJournalEvents`
 * inserts outside a transaction, so two concurrent appends can commit out of
 * `seq` order and a max taken between them would never learn about the
 * earlier row; a count moves on every commit whatever the order.
 */
const VALIDATOR_COLUMNS = `
            p.version::text as version,
            (select count(*) from graph_events e where e.project_id = p.id)::text as event_count,
            (select count(*) from graph_events e
              where e.project_id = p.id
                and e.event->>'type' in ('quality.finding.resolved', 'quality.finding.accepted'))::text as quality_event_count`;

/**
 * The owner scope every read shares — and deliberately NO `archived_at`
 * filter: an archived project is still readable (and exportable) by its
 * owner; only the writes refuse it. A conditional read must answer 304 or
 * 200 for exactly the projects an unconditional one answers 200 for, or an
 * archived project would silently start 404ing on revalidation.
 */
const READ_SCOPE = `p.id = $1 and p.owner_id = any($2::text[])`;

function toValidators(row: ValidatorColumns): ProjectValidators {
  return {
    version: String(row.version),
    eventCount: String(row.event_count),
    qualityEventCount: String(row.quality_event_count),
  };
}

/**
 * The validators alone — the 304 path. No snapshot leaves Postgres: a
 * revalidation that matches costs the auth queries plus this one statement.
 */
export async function loadValidators(
  projectId: string,
  ownerIds: readonly string[],
): Promise<ProjectValidators | null> {
  const { rows } = await query<ValidatorColumns>(
    `select ${VALIDATOR_COLUMNS}
       from graph_projects p
      where ${READ_SCOPE}`,
    [projectId, ownerIds],
  );
  return rows.length === 0 ? null : toValidators(rows[0]);
}

interface LoadedProject {
  snapshot: SnapshotShape;
  validators: ProjectValidators;
}

async function loadProject(
  projectId: string,
  ownerIds: readonly string[],
): Promise<LoadedProject | null> {
  const { rows } = await query<ValidatorColumns & { snapshot: SnapshotShape }>(
    `select p.snapshot, ${VALIDATOR_COLUMNS}
       from graph_projects p
      where ${READ_SCOPE}`,
    [projectId, ownerIds],
  );
  if (rows.length === 0) return null;
  return { snapshot: rows[0].snapshot, validators: toValidators(rows[0]) };
}

/**
 * One top-level array of the snapshot with the validators, in one statement.
 * `snapshot->'nodes'` rather than the whole column: Postgres still detoasts
 * the datum to evaluate the operator, but only the array crosses the wire and
 * gets JSON-parsed in Node — the same trick `listProjects` already plays with
 * `jsonb_array_length`.
 */
async function loadSnapshotArray<T>(
  projectId: string,
  ownerIds: readonly string[],
  field: "nodes" | "edges",
): Promise<{ items: T[]; validators: ProjectValidators } | null> {
  const { rows } = await query<ValidatorColumns & { items: T[] | null }>(
    `select p.snapshot->'${field}' as items, ${VALIDATOR_COLUMNS}
       from graph_projects p
      where ${READ_SCOPE}`,
    [projectId, ownerIds],
  );
  if (rows.length === 0) return null;
  return { items: rows[0].items ?? [], validators: toValidators(rows[0]) };
}

export async function getNodes(
  projectId: string,
  ownerIds: readonly string[],
): Promise<{ nodes: Node[]; validators: ProjectValidators } | null> {
  const loaded = await loadSnapshotArray<Node>(projectId, ownerIds, "nodes");
  return loaded ? { nodes: loaded.items, validators: loaded.validators } : null;
}

export async function getEdges(
  projectId: string,
  ownerIds: readonly string[],
): Promise<{ edges: Edge[]; validators: ProjectValidators } | null> {
  const loaded = await loadSnapshotArray<Edge>(projectId, ownerIds, "edges");
  return loaded ? { edges: loaded.items, validators: loaded.validators } : null;
}

/**
 * The project's events in server order, with the validators.
 *
 * Validators FIRST, then the rows — the order is the correctness argument.
 * The two run as separate statements on separate pool connections, so an
 * append can land between them; taken in this order the ETag can only be
 * OLDER than the body, which costs one extra 200 on the next revalidation.
 * The other order could stamp a fresh ETag on a body that predates an event,
 * and a client would then sit on a 304 with stale history until the next
 * write. The validator query is also the owner check: no snapshot is loaded
 * to authorize a journal read any more.
 */
export async function getJournal(
  projectId: string,
  ownerIds: readonly string[],
): Promise<{ journal: JournalEvent[]; validators: ProjectValidators } | null> {
  const validators = await loadValidators(projectId, ownerIds);
  if (!validators) return null;
  const { rows } = await query<{ event: JournalEvent }>(
    `select event from graph_events where project_id = $1 order by seq asc`,
    [projectId],
  );
  return { journal: rows.map((row) => row.event), validators };
}

/**
 * A project's `quality.finding.resolved` and `quality.finding.accepted`
 * events, and nothing else.
 *
 * The Quality surfaces need these to fold both kinds of decision over the
 * stored findings (`foldFindingEvents` in lib/utils/quality.ts), and a
 * project's full history is the wrong price for a handful of events — the
 * Pebbles journal alone runs to thousands of rows.
 *
 * Owner-scoped with the same `READ_SCOPE` clause every read uses, as a
 * one-row existence check rather than a snapshot load: both callers (the
 * project GET and the quality-events POST) have already loaded the snapshot
 * through `getProject`, and loading it a second time here purely to
 * authorize was the bundle GET's second multi-megabyte read.
 */
export async function qualityFindingEvents(
  projectId: string,
  ownerIds: readonly string[],
): Promise<JournalEvent[]> {
  const owned = await query<{ owned: number }>(
    `select 1 as owned from graph_projects p where ${READ_SCOPE}`,
    [projectId, ownerIds],
  );
  if (owned.rows.length === 0) return [];
  const { rows } = await query<{ event: JournalEvent }>(
    `select event from graph_events
      where project_id = $1
        and event->>'type' in ('quality.finding.resolved', 'quality.finding.accepted')
      order by seq asc`,
    [projectId],
  );
  return rows.map((row) => row.event);
}

/**
 * Append pre-stamped journal events WITHOUT touching the snapshot — the
 * journal-only write path (slice 3: the Lab Note webhook). Unlike
 * `applyMutation` there are no graph ops and no version bump: the snapshot is
 * authoritative for state and unchanged; the journal is authoritative for
 * history and grows. Owner-scoped like every other write.
 */
export async function appendJournalEvents(
  projectId: string,
  ownerIds: readonly string[],
  events: readonly JournalEvent[],
  actor: string,
): Promise<{ ok: true } | StoreFailure> {
  const { rows } = await query<{ id: string }>(
    `select id from graph_projects where id = $1 and owner_id = any($2::text[]) and archived_at is null`,
    [projectId, ownerIds],
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  for (const event of events) {
    await query(
      `insert into graph_events (id, project_id, event, actor) values ($1, $2, $3, $4)`,
      [event.id, projectId, JSON.stringify(event), actor],
    );
  }
  return { ok: true };
}

/**
 * Snapshot + version, without the (potentially large) journal. `version`
 * stays a top-level field beside the validators: the project GET's JSON
 * `version` is what `arkaik restore` builds its `If-Match` from, and the
 * pollen route and the GitHub App's planner read `bundle` off this shape.
 */
export async function getProject(
  projectId: string,
  ownerIds: readonly string[],
): Promise<{ bundle: SnapshotShape; version: string; validators: ProjectValidators } | null> {
  const loaded = await loadProject(projectId, ownerIds);
  return loaded
    ? { bundle: loaded.snapshot, version: loaded.validators.version, validators: loaded.validators }
    : null;
}

/**
 * The full interchange bundle: snapshot with its journal embedded. One
 * snapshot load, then the rows — the journal query does not re-authorize
 * (the snapshot statement just did), and the validators are the snapshot
 * statement's, so they can only be older than the embedded journal (see
 * `getJournal` for why that direction is the safe one).
 */
export async function exportProject(
  projectId: string,
  ownerIds: readonly string[],
): Promise<{ bundle: ProjectBundle; validators: ProjectValidators } | null> {
  const loaded = await loadProject(projectId, ownerIds);
  if (!loaded) return null;
  const { rows } = await query<{ event: JournalEvent }>(
    `select event from graph_events where project_id = $1 order by seq asc`,
    [projectId],
  );
  const journal = rows.map((row) => row.event);
  return { bundle: { ...loaded.snapshot, journal } as ProjectBundle, validators: loaded.validators };
}

// ---------------------------------------------------------------------------
// Journal (graph_events) — read/write helpers shared by createProject (fresh
// import) and replaceProjectBundle (wholesale replace): one writer for
// CLIENT-SUPPLIED journals (import and restore), so those two paths cannot
// become two subtly different insert loops over time. `applyMutation` also
// inserts into this table, but it is a THIRD, separate writer, not a second
// copy of this one: it derives its own events from `applyOps` rather than
// accepting a caller-supplied array, and — deliberately — has no `on
// conflict` clause at all, so a duplicate id there is a genuine bug and
// throws, where a client-supplied journal (which arrives already-written,
// possibly re-imported, and cannot be trusted the same way) tolerates it.
// ---------------------------------------------------------------------------

/**
 * Replace a project's ENTIRE journal: delete every existing row, then insert
 * the given events, sorted, as one writer for both callers below.
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
 * asc` reads back events in whatever order they were INSERTED. Rather than
 * resting entirely on an unenforced caller promise across an HTTP boundary
 * (bundle validation for create; the CLI's `merge`, which sorts by `ts`, for
 * restore), `events` is run through `@arkaik/schema`'s own {@link orderEvents}
 * (sorts by `ts`, tiebreak `id`) here, server-side, before the insert loop —
 * free to call, and it means an unsorted inbound journal cannot persist
 * unsorted just because one caller forgot to sort it first.
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
  for (const event of orderEvents(events)) {
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

  const id = generateProjectId();
  const { journal = [], ...snapshot } = bundle;

  return withTransaction<{ ok: true; id: string; version: string } | StoreFailure>(async (client) => {
    // Serialize this owner's creates, then count INSIDE the transaction. The
    // count used to run before `withTransaction` opened, which made it a
    // check-then-act: two concurrent creates from an owner at the cap minus one
    // both read the same count and both inserted. See lib/services/db.ts §
    // ADVISORY_LOCK for why a lock rather than `select … for update` — the race
    // is an owner whose count is zero, where there are no rows to lock.
    // `hashtext` maps the text owner id into the int4 key space; a collision
    // between two owners costs a little contention and nothing else, because
    // the lock is only ever an ordering device.
    await client.query(`select pg_advisory_xact_lock($1::int, hashtext($2))`, [
      ADVISORY_LOCK.graphOwner,
      input.ownerId,
    ]);

    const { rows: existing } = await client.query<{ n: string }>(
      `select count(*) as n from graph_projects where owner_id = $1 and archived_at is null`,
      [input.ownerId],
    );
    const projectCount = Number(existing[0]?.n ?? 0);
    if (projectCount + 1 > limits.projects) {
      // Returning (rather than throwing) commits a transaction that wrote
      // nothing, which is the intent: the refusal is an outcome, not a fault.
      return { ok: false, reason: "limit", limit: limits.projects, actual: projectCount + 1, tier: input.tier };
    }

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
    // is the one writer for CLIENT-SUPPLIED journals (see its own doc comment
    // for why `applyMutation`'s inserts are a separate, third writer, not a
    // second copy of this one) — a fresh project has nothing for its leading
    // `delete` to remove, so this call is equivalent to the insert loop this
    // replaced, just shared with restore.
    await replaceJournalRows(client, id, journal);

    return { ok: true, id, version: "1" };
  });
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
 * `select … for update` on a REAL write, same as {@link applyMutation} and
 * for the same reason: this is the one destructive verb in the API, so two
 * restores (or a restore and a mutation) racing the same project MUST
 * serialize rather than one silently computing its delta or its write
 * against a row the other is simultaneously replacing. Whichever
 * transaction's lock is acquired first holds the row until it commits or
 * rolls back; the other blocks and then reads the POST-write state — which
 * is exactly what makes its own `If-Match` check (if it has one) meaningful
 * rather than decorative. A DRY RUN takes `for share` instead — it still
 * blocks a concurrent writer from changing the row mid-comparison (the
 * property that matters), but doesn't need the exclusive lock a call that
 * provably never writes has no use for, and taking it anyway would
 * needlessly serialize dry-runs against each other and against real writes.
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
    // FOR UPDATE on a real write — hold the row until commit, same lock
    // applyMutation takes and for the same reason. FOR SHARE on a dry run:
    // a preview only needs to block a CONCURRENT WRITER from changing the
    // row mid-comparison, not exclude every other reader (including another
    // dry run), and a dry run never reaches the `update`/`replaceJournalRows`
    // calls below regardless of which lock mode this is — see this
    // function's own doc comment for why that is structural. Taking the
    // exclusive lock anyway for a call that provably never writes would
    // serialize dry-runs (and real writes) against each other for no reason.
    //
    // Two full, literal query strings rather than splicing the lock keyword
    // into one shared template: `db.ts`'s own rule is "values go through
    // $-params, never interpolation" (docs/spec/services.md § Security &
    // Privacy), and a lock mode can't be a $-param at all (Postgres doesn't
    // parameterize keywords) — branching on the whole query text keeps this
    // function honestly at zero string-built SQL, rather than technically
    // safe (only two fixed literals feed it, never request input) but
    // shaped like the exact pattern that rule exists to rule out.
    const selectResult = input.dryRun
      ? await client.query<{ snapshot: SnapshotShape; version: string }>(
          `select snapshot, version from graph_projects
            where id = $1 and owner_id = any($2::text[]) and archived_at is null
            for share`,
          [input.projectId, input.ownerIds],
        )
      : await client.query<{ snapshot: SnapshotShape; version: string }>(
          `select snapshot, version from graph_projects
            where id = $1 and owner_id = any($2::text[]) and archived_at is null
            for update`,
          [input.projectId, input.ownerIds],
        );
    const { rows } = selectResult;
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

    // `bundle_id` and `schema_version` are real columns `createProject` sets
    // on write (see its own insert above) but this statement previously left
    // untouched on restore — reachable drift, not hypothetical: a restored
    // bundle whose `project.id` differs from what created the row would
    // commit a snapshot saying one thing while the column said another, and
    // `bundle_id` is what `arkaik link` uses to recognise a repo's working
    // copy (db/migrations/008_graph_projects.sql) — exactly the CLI-driven
    // flow this endpoint serves. Both are set from the SAME migrated bundle
    // being written, the same fallback `createProject` uses for each.
    await client.query(
      `update graph_projects
          set snapshot = $2, version = $3, entity_count = $4, title = $5,
              bundle_id = $6, schema_version = $7, updated_at = now()
        where id = $1`,
      [
        input.projectId,
        JSON.stringify(snapshot),
        nextVersion,
        check.actual,
        snapshot.project.title ?? "Untitled",
        snapshot.project.id,
        snapshot.schema_version ?? STATUS_VOCABULARY_VERSION,
      ],
    );
    await replaceJournalRows(client, input.projectId, journal);

    return { ok: true, version: nextVersion, delta } as const;
  });
}

/**
 * The caller's tier from `users.tier`, defaulting to the safe floor.
 *
 * Re-exported from lib/services/db.ts, which owns the single definition —
 * lib/services/synk.ts held a byte-identical copy. Kept exported here so every
 * graph route keeps importing it from the store it already imports.
 */
export { getUserTier };
