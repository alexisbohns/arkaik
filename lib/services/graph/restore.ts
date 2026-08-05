import "server-only";

import { getHostedLimitsForTier } from "@/lib/services/limits";

/**
 * The rules a hosted restore obeys, as pure functions
 * (docs/superpowers/specs/2026-08-04-bootstrap-method-design.md § 7).
 *
 * A restore replaces a project's snapshot AND its journal wholesale — the
 * only way mined history can reach a hosted project, because the mutation
 * path derives its events server-side and cannot express a backdated one.
 * That makes it the one destructive verb in the graph API, so its guards
 * live here where they can be tested without a database: this machine has no
 * local Postgres, and untested SQL-adjacent logic is where the real risk
 * sits, not in the SQL itself.
 *
 * ── Where the line is drawn ─────────────────────────────────────────────────
 * The spec calls restore "owner-only" and "tier-limited." Only ONE of those
 * is a pure decision:
 *
 *  - Owner-only genuinely needs a database row: "does this caller own THIS
 *    stored project" cannot be answered without reading it. That check stays
 *    in `replaceProjectBundle` (Task 11), scoped by `owner_id = any($1)` the
 *    same way every other store function is.
 *  - Tier-limited splits in two. The LIMITS TABLE lookup
 *    (`getHostedLimitsForTier`) was already pure before this task. The
 *    remaining piece — does this bundle's entity count fit the tier's cap —
 *    needs nothing but counts already in hand once the bundle is parsed, so
 *    {@link checkHostedEntityLimit} lives here rather than being re-derived
 *    inline in the route/store layer a second time.
 */

// ---------------------------------------------------------------------------
// Optimistic concurrency
// ---------------------------------------------------------------------------

/**
 * Optimistic concurrency for the one destructive verb in the graph API.
 *
 * Fails CLOSED, and deliberately more strictly than `parseIfMatch` in
 * `app/api/graph/projects/[projectId]/mutations/route.ts`. There, a missing
 * or empty header means "apply regardless of version" — a reasonable default
 * because the row lock `applyMutation` takes already makes the WRITE safe on
 * its own; `If-Match` there is purely a courtesy so a client can notice drift.
 * Restore has no such backstop: a wholesale replace IS the operation, so
 * anything short of "the exact single version this caller says it read" is a
 * refusal, never a pass:
 *
 *  - missing / null / empty / whitespace-only  → refuse (no version stated)
 *  - `*` (bare or quoted)                       → refuse. "Any version will
 *    do" is exactly the unconditional write this endpoint must never allow —
 *    it is valid HTTP for a GET precondition, not for a destructive PUT.
 *  - a multi-value list (`"a", "b"`, valid per RFC 7232 for If-Match in
 *    general) → refuse, not parsed. This endpoint's only client
 *    (`arkaik restore`) always sends the ONE version it actually read in a
 *    prior GET; a caller offering several candidates is hedging across
 *    guesses, which is the opposite of stating "the version I read." A
 *    stored version is always a lowercase hex string with no comma in it, so
 *    this can never reject a legitimate one — only a header shaped to try
 *    more than one answer at a time.
 *  - a weak validator (`W/"v7"`) → refuse. RFC 7232 requires STRONG
 *    comparison for If-Match, and a weak validator is excluded from strong
 *    comparison by definition even when the underlying value happens to
 *    match — accepting it here would quietly downgrade the guarantee.
 *  - case differences → refuse (byte-exact compare). Stored versions are
 *    lowercase hex (`randomBytes(...).toString("hex")`), so this is never a
 *    false negative against a value this server itself produced.
 *
 * A bare token and a double-quoted one compare equal (`v7` and `"v7"` both
 * match a stored version of `v7`): both are honest statements of the same
 * version, one with the ETag quoting `arkaik restore` sends and one without.
 */
export function versionMatches(ifMatch: string | undefined | null, current: string): boolean {
  if (typeof ifMatch !== "string") return false;
  const trimmed = ifMatch.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === "*") return false;
  // A comma anywhere means "this is the multi-value grammar" — see the
  // doc comment above for why that form is refused outright rather than
  // parsed into a list and checked for membership.
  if (trimmed.includes(",")) return false;
  // Weak validator prefix, case-insensitive: a client that means the marker
  // could plausibly send either case, and neither one gets strong-comparison
  // treatment.
  if (/^w\//i.test(trimmed)) return false;

  const normalized =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  if (normalized.length === 0 || normalized === "*") return false;
  return normalized === current;
}

// ---------------------------------------------------------------------------
// Bundle delta
// ---------------------------------------------------------------------------

export interface BundleDelta {
  nodesAdded: number;
  nodesRemoved: number;
  nodesChanged: number;
  /** Entries on either side with no usable string `id` — see {@link indexById}. */
  nodesMalformed: number;
  edgesAdded: number;
  edgesRemoved: number;
  edgesChanged: number;
  edgesMalformed: number;
  eventsAdded: number;
  eventsDropped: number;
  /**
   * An event id present on BOTH sides whose payload differs. Presence-only
   * counting (`eventsAdded`/`eventsDropped`) cannot show this at all — see
   * the doc comment on {@link computeBundleDelta} for why it gets its own
   * number instead of staying invisible.
   */
  eventsChanged: number;
  eventsMalformed: number;
}

interface Identified {
  id?: unknown;
}

interface IndexedList {
  byId: Map<string, unknown>;
  /** Count of entries this bundle cannot match against the other side at all. */
  malformed: number;
}

/**
 * Index a caller-supplied list by `id`, tolerant of every shape a hostile or
 * merely buggy bundle can offer: the field absent, `null`, or not an array at
 * all; an item with no `id`; a non-string `id`; two items reusing the same
 * `id`. This runs on a caller-supplied bundle, so all four are the normal
 * case to plan for, not an edge case to shrug off.
 *
 * An entry with no usable id is NOT silently skipped into "no change" — it is
 * counted in `malformed`. The alternative (drop it and say nothing) is
 * exactly the failure mode this whole module exists to avoid: a bundle
 * padded with a pile of unidentifiable "nodes" would otherwise add zero to
 * every count in {@link BundleDelta}, and read on a human's `--dry-run`
 * screen as an empty, harmless restore.
 *
 * A REPEATED id is also counted as malformed, not just silently overwritten.
 * `byId` still keeps the LAST occurrence (something has to be comparable),
 * but a well-formed bundle should never contain the same id twice —
 * `validateBundle`'s `duplicate-node-id`/`duplicate-edge-id` rules already
 * reject that for nodes and edges before this ever runs in production, and
 * there is no equivalent rule for journal event ids at all — so seeing a
 * duplicate here means either an input that bypassed that gate or a
 * genuinely unchecked corner (journal ids), either way worth a nonzero number
 * instead of silence.
 */
function indexById(list: unknown): IndexedList {
  const byId = new Map<string, unknown>();
  let malformed = 0;
  if (!Array.isArray(list)) return { byId, malformed };

  const seen = new Set<string>();
  for (const item of list) {
    const id = (item as Identified)?.id;
    if (typeof id !== "string" || id.length === 0) {
      malformed += 1;
      continue;
    }
    if (seen.has(id)) malformed += 1;
    seen.add(id);
    byId.set(id, item);
  }
  return { byId, malformed };
}

/**
 * Deep-equal for JSON-shaped values, ignoring object KEY ORDER but NOT array
 * element order.
 *
 * Why this exists: a node/edge/event read back out of Postgres' `jsonb`
 * column and the "same" object freshly assembled by the CLI are not
 * byte-identical even when every field holds the same value. jsonb does not
 * preserve key order at all — internally it reorders object pairs by key
 * length, then lexicographically (Postgres docs, "JSON Types": jsonb "does
 * not preserve … the order of object keys"). A `JSON.stringify` equality
 * check would therefore call almost every round-tripped node "changed,"
 * which would make `nodesChanged`/`edgesChanged`/`eventsChanged` read as "all
 * of them" on literally every restore — a number a human stops trusting,
 * which is worse than not printing one at all (the exact failure this
 * function exists to prevent; see `tests/services/graph-restore.test.js`'s
 * key-order assertions for the regression case).
 *
 * Array order is left alone on purpose: it IS real signal here (a flow's
 * `metadata.playlist` entries reordering is a genuine change, not noise),
 * and jsonb does not reorder array elements — only object keys.
 */
function deepEqualIgnoringKeyOrder(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false; // a === b above already covers null === null

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualIgnoringKeyOrder(item, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    // A key holding `undefined` is indistinguishable from an absent key once
    // this object crosses a JSON boundary (jsonb storage on write, or the
    // wire on read) — `JSON.stringify` drops it either way — so it is
    // treated the same way here rather than as a phantom difference.
    const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
    const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
    if (aKeys.length !== bKeys.length) return false;
    const bSet = new Set(bKeys);
    return aKeys.every((key) => bSet.has(key) && deepEqualIgnoringKeyOrder(ao[key], bo[key]));
  }

  // Primitives of the same `typeof` reach here only when `a === b` was false
  // above (e.g. NaN !== NaN, or two different numbers/strings/booleans).
  return false;
}

function countMissing(from: Map<string, unknown>, into: Map<string, unknown>): number {
  let n = 0;
  for (const id of from.keys()) if (!into.has(id)) n += 1;
  return n;
}

function countChanged(prev: Map<string, unknown>, next: Map<string, unknown>): number {
  let n = 0;
  for (const [id, item] of next) {
    const before = prev.get(id);
    if (before !== undefined && !deepEqualIgnoringKeyOrder(before, item)) n += 1;
  }
  return n;
}

/**
 * What a restore would do, in counts — what `--dry-run` prints and what a
 * human reads before authorising a destructive replace.
 *
 * `eventsDropped` is the one to watch: the journal is append-only by
 * contract, so a nonzero value means the inbound bundle is missing events the
 * server already holds. Counting by id presence is sufficient to detect
 * THAT — an id gone is gone, full stop, regardless of what else changed. But
 * presence alone is NOT sufficient to make every risk visible: `merge` can
 * legitimately rewrite an event's payload while keeping its id (e.g.
 * reconcile canonicalizing a timestamp), and with only `eventsAdded` /
 * `eventsDropped` exposed, that rewrite contributes zero to both — it
 * disappears completely from a delta whose whole job is to not let anything
 * disappear. `eventsChanged` closes that gap: a same-id, different-payload
 * event shows up as its own number instead of as nothing.
 */
export function computeBundleDelta(
  prev: { nodes?: unknown; edges?: unknown; journal?: unknown },
  next: { nodes?: unknown; edges?: unknown; journal?: unknown },
): BundleDelta {
  const prevNodes = indexById(prev?.nodes);
  const nextNodes = indexById(next?.nodes);
  const prevEdges = indexById(prev?.edges);
  const nextEdges = indexById(next?.edges);
  const prevEvents = indexById(prev?.journal);
  const nextEvents = indexById(next?.journal);

  return {
    nodesAdded: countMissing(nextNodes.byId, prevNodes.byId),
    nodesRemoved: countMissing(prevNodes.byId, nextNodes.byId),
    nodesChanged: countChanged(prevNodes.byId, nextNodes.byId),
    nodesMalformed: prevNodes.malformed + nextNodes.malformed,

    edgesAdded: countMissing(nextEdges.byId, prevEdges.byId),
    edgesRemoved: countMissing(prevEdges.byId, nextEdges.byId),
    edgesChanged: countChanged(prevEdges.byId, nextEdges.byId),
    edgesMalformed: prevEdges.malformed + nextEdges.malformed,

    eventsAdded: countMissing(nextEvents.byId, prevEvents.byId),
    eventsDropped: countMissing(prevEvents.byId, nextEvents.byId),
    eventsChanged: countChanged(prevEvents.byId, nextEvents.byId),
    eventsMalformed: prevEvents.malformed + nextEvents.malformed,
  };
}

// ---------------------------------------------------------------------------
// Tier limit (the pure half of "owner-only, tier-limited" — see the module
// doc comment above for where the line against SQL is drawn)
// ---------------------------------------------------------------------------

export interface EntityLimitCheck {
  ok: boolean;
  limit: number;
  actual: number;
}

/**
 * Whether a bundle's total entity count (nodes + edges) fits a tier's hosted
 * limit. Pure and DB-free on purpose: this is the one half of "owner-only,
 * tier-limited" that needs no database row at all — everything it touches
 * (array lengths, `getHostedLimitsForTier`) is already in hand once the
 * bundle has been parsed. Ownership is deliberately NOT here: "does this
 * caller own this stored project" can only be answered by reading the row,
 * so that half stays in `replaceProjectBundle` (Task 11).
 *
 * Mirrors the `count > limits.entities` check already inline in
 * `createProject`/`applyMutation` in `store.ts` — Task 11 should call this
 * instead of re-deriving the same comparison a third time.
 */
export function checkHostedEntityLimit(
  bundle: { nodes?: unknown; edges?: unknown },
  tier: string,
): EntityLimitCheck {
  const nodes = Array.isArray(bundle?.nodes) ? bundle.nodes.length : 0;
  const edges = Array.isArray(bundle?.edges) ? bundle.edges.length : 0;
  const actual = nodes + edges;
  const limit = getHostedLimitsForTier(tier).entities;
  return { ok: actual <= limit, limit, actual };
}
