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
 *
 * ── Coordinator review, round 1 — corrections folded in below, not hidden ───
 * Independent review confirmed the key-order reasoning (probe 3) against
 * Postgres' own docs and source, and confirmed all three `If-Match` refusals
 * against RFC 9110. It also found three places where a comment claimed more
 * than the code delivered — recorded at each fix site below rather than only
 * here, so the reasoning stays next to the code it justifies:
 *
 *  1. `deepEqualIgnoringKeyOrder` had no depth cap and could throw a
 *     `RangeError` on caller-supplied metadata nested a few thousand levels
 *     deep — reachable, because `metadata` is an unconstrained `z.record` in
 *     `@arkaik/schema` that zod does not recurse into. Fixed with a depth cap.
 *  2. The "stored versions are lowercase hex" claim was flatly wrong — that
 *     describes `generateProjectId`, not the `version` column. Fixed: see
 *     {@link classifyIfMatch}'s doc comment for the real format.
 *  3. `checkHostedEntityLimit` returned `Infinity` on the SUCCESS path for an
 *     uncapped tier, contradicting `limits.ts`'s own stated invariant that
 *     `Infinity` never reaches a response body. Fixed: `limit` is
 *     `number | null`.
 *
 * Two more came from the same pass: `versionMatches`' boolean collapsed three
 * different client errors into one "false" (fixed by adding
 * {@link classifyIfMatch}), and `nodesMalformed`/`edgesMalformed`/
 * `eventsMalformed` summed both sides of the restore, hiding which side the
 * garbage was actually on (fixed: incoming-bundle-only, see
 * {@link computeBundleDelta}). `nodesBefore`/`nodesAfter` (and the edge/event
 * equivalents) were added so a restore's totals can be reconciled at a
 * glance, not just its deltas.
 */

// ---------------------------------------------------------------------------
// Optimistic concurrency
// ---------------------------------------------------------------------------

export type IfMatchClassification = "match" | "absent" | "unsupported" | "stale";

/**
 * Classify an `If-Match` header against the version this caller actually
 * read, for the one destructive verb in the graph API.
 *
 * Four outcomes, not a boolean, because collapsing them into one "false"
 * conflates three different CLIENT ERRORS, and only one of them is actually
 * a version conflict:
 *
 *  - **"absent"** — no version was stated at all (missing / null / empty /
 *    whitespace-only). There is nothing to compare against; the caller needs
 *    to supply a version, not retry the identical request. Task 11 maps this
 *    to `428 Precondition Required`.
 *  - **"unsupported"** — a shape this endpoint deliberately refuses to honor:
 *    a wildcard (bare or quoted `*`), a weak validator (`W/"7"`), a
 *    multi-value list (`"6", "7"`), or an explicitly-empty quoted token
 *    (`""`). The caller sent something malformed FOR THIS ENDPOINT, not
 *    something stale — Task 11 maps this to `400 Bad Request`.
 *  - **"stale"** — a single, well-formed version that does not equal
 *    `current`. This is the one genuine conflict: someone else changed the
 *    project since the caller read it, and "re-pull and retry" is the
 *    correct advice. Task 11 maps this to `412 Precondition Failed`.
 *  - **"match"** — the exact version, and only that version.
 *
 * Why the distinction is load-bearing rather than cosmetic: a caller that
 * trips the weak-ETag or multi-value refusal would otherwise be told "your
 * version is stale, re-pull and retry" when it isn't — a bad loop on the one
 * verb where the caller has already been made to take a backup first.
 *
 * ── Each refusal, checked against the actual RFC (RFC 9110, which obsoletes
 * RFC 7232) ──────────────────────────────────────────────────────────────────
 *  - Weak-validator refusal is COMPLIANCE, not strictness: §13.1.1 requires
 *    `If-Match` to use the strong comparison function, and §8.8.3.2 defines
 *    strong comparison to exclude any weak validator, full stop — accepting
 *    `W/"7"` here would not be lenient, it would be non-conformant.
 *  - `*` refusal is a deliberate, defensible deviation: §13.1.2 defines `*`
 *    as "any current representation is fine," which is a sensible default
 *    for an ordinary conditional GET/PUT and the exact opposite of what a
 *    destructive whole-bundle replace should ever accept unconditionally.
 *  - Multi-value refusal is safe rather than merely convenient: a version is
 *    always a plain decimal integer string (see below), which can never
 *    contain a comma — so no legitimate version is ever rejected by this
 *    rule; only a header shaped to offer more than one candidate at once is.
 *
 * ── Version format, precisely (the first draft got this wrong; get it right
 * before generalizing from it) ───────────────────────────────────────────────
 * A project's `version` is a Postgres `bigint` column
 * (`db/migrations/008_graph_projects.sql:44`: `version bigint not null
 * default 1`), read back as `String(row.version)` and bumped via
 * `(BigInt(version) + BigInt(1)).toString()` (`store.ts`). So `current` here
 * is always a plain decimal integer string — `"1"`, `"2"`, `"103"` — never a
 * hex string. `randomBytes(...).toString("hex")` mints nothing here at all;
 * that generator (`generateProjectId`) mints PROJECT IDS
 * (`prj_${randomBytes(12).toString("base64url")}`), a different value,
 * serving a different purpose, using a different (mixed-case!) encoding.
 * Every conclusion above still holds against the REAL format — decimal
 * digits have no case to fold and can never contain a comma — but it has to
 * rest on what the column actually produces. The test fixtures in
 * `tests/services/graph-restore.test.js` use realistic decimal versions
 * (`"7"`, not `"v7"`) for exactly this reason.
 *
 * A bare token and a double-quoted one compare equal (`7` and `"7"` both
 * match a stored version of `7`): both are honest statements of the same
 * version, one with the ETag quoting `arkaik restore` sends and one without.
 */
export function classifyIfMatch(ifMatch: string | undefined | null, current: string): IfMatchClassification {
  if (typeof ifMatch !== "string") return "absent";
  const trimmed = ifMatch.trim();
  if (trimmed.length === 0) return "absent";
  if (trimmed === "*") return "unsupported";
  // A comma anywhere means "this is the multi-value grammar" — see the doc
  // comment above for why that form is refused outright rather than parsed
  // into a list and checked for membership.
  if (trimmed.includes(",")) return "unsupported";
  // Weak validator prefix, case-insensitive: a client that means the marker
  // could plausibly send either case, and neither gets strong-comparison
  // treatment (RFC 9110 §8.8.3.2).
  if (/^w\//i.test(trimmed)) return "unsupported";

  const normalized =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  // An explicitly-empty or wildcard value once unquoted is the same
  // "unsupported shape," not "stale" — the caller did not state a real
  // version to be stale AGAINST.
  if (normalized.length === 0 || normalized === "*") return "unsupported";
  return normalized === current ? "match" : "stale";
}

/**
 * `classifyIfMatch(ifMatch, current) === "match"` — a fine predicate for a
 * caller that only needs the boolean and doesn't need to distinguish WHY a
 * non-match happened. Prefer {@link classifyIfMatch} directly wherever the
 * distinction between "absent," "unsupported," and "stale" drives a
 * different response (as it does in Task 11's route).
 */
export function versionMatches(ifMatch: string | undefined | null, current: string): boolean {
  return classifyIfMatch(ifMatch, current) === "match";
}

// ---------------------------------------------------------------------------
// Dry-run indicator
// ---------------------------------------------------------------------------

export type DryRunClassification = { ok: true; dryRun: boolean } | { ok: false };

/**
 * Classify `PUT .../bundle`'s `?dryRun=` query parameter — fails CLOSED the
 * same way {@link classifyIfMatch} does, in the direction that matters here:
 * an UNRECOGNIZED token must never silently fall back to the DESTRUCTIVE
 * (non-dry-run) branch.
 *
 * A first version of the route accepted exactly two spellings
 * (`dryRunParam === "1" || dryRunParam === "true"`) and treated EVERYTHING
 * else — a bare `?dryRun` (empty string), `?dryRun=yes`, `?dryRun=on`, a typo
 * — as `false`, i.e. as authorization to write. That makes this the only
 * input on this endpoint that fails open: `classifyIfMatch` refuses a
 * wildcard, a weak ETag, and a multi-value list on principle, and this
 * endpoint is the one destructive verb in the graph API — the one place a
 * caller who believed they were previewing must never get the write instead.
 *
 * Outcomes:
 *  - **absent** (`raw === null`, the param wasn't sent at all) → `{ ok: true,
 *    dryRun: false }`. This is the ordinary case for a real `arkaik restore`
 *    call and must default to the real write, not a preview — the opposite
 *    failure direction from every other case here.
 *  - **bare or a recognized "true" spelling** (`""`, `"1"`, `"true"`) →
 *    `{ ok: true, dryRun: true }`. A bare `?dryRun` (no `=value` at all) is
 *    treated as "yes, preview" — the same convention `curl -d` and most CLI
 *    flag parsers use for a boolean flag with no explicit value.
 *  - **a recognized "false" spelling** (`"0"`, `"false"`) → `{ ok: true,
 *    dryRun: false }`, an explicit opt-out, distinct from the param being
 *    absent only in intent, not in outcome.
 *  - **anything else** (`"yes"`, `"on"`, `"TRUE"`, ...) → `{ ok: false }`.
 *    The route maps this to `400 Bad Request` rather than guessing which way
 *    the caller meant it — the only safe default for a token this endpoint
 *    doesn't recognize, on a destructive verb.
 *
 * Deliberately narrow: this only ever sees the VALUE of the `dryRun` key,
 * never the query string itself, so a caller who typos the key entirely
 * (`?dry_run=1`) reads as "absent" (real write) — that failure mode belongs
 * to whatever names the query parameter, not to this classifier, and is
 * unchanged from how any other unrecognized query key on any other route
 * behaves.
 */
export function classifyDryRun(raw: string | null): DryRunClassification {
  if (raw === null) return { ok: true, dryRun: false };
  if (raw === "" || raw === "1" || raw === "true") return { ok: true, dryRun: true };
  if (raw === "0" || raw === "false") return { ok: true, dryRun: false };
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Bundle delta
// ---------------------------------------------------------------------------

export interface BundleDelta {
  /** Raw node count on each side — "you are replacing N nodes with M" in one place. */
  nodesBefore: number;
  nodesAfter: number;
  nodesAdded: number;
  nodesRemoved: number;
  nodesChanged: number;
  /**
   * Entries in the INCOMING bundle (`next`) only that have no usable string
   * `id` or reuse one already seen in the same array — see
   * {@link computeBundleDelta} for why this is one-sided.
   */
  nodesMalformed: number;

  edgesBefore: number;
  edgesAfter: number;
  edgesAdded: number;
  edgesRemoved: number;
  edgesChanged: number;
  edgesMalformed: number;

  eventsBefore: number;
  eventsAfter: number;
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
  /** Count of entries this list cannot match against anything else at all. */
  malformed: number;
}

/**
 * Index a caller-supplied list by `id`, tolerant of every shape a hostile or
 * merely buggy bundle can offer: the field absent, `null`, or not an array at
 * all; an item with no `id`; a non-string or empty-string `id`; two items
 * reusing the same `id`. This runs on a caller-supplied bundle, so all of
 * these are the normal case to plan for, not an edge case to shrug off.
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
 * genuinely unchecked corner (journal ids), either way worth a nonzero
 * number instead of silence.
 *
 * This function does one level of list membership only — it does not walk
 * into any item's fields, so it carries none of {@link deepEqualIgnoringKeyOrder}'s
 * recursion-depth concerns itself.
 */
function indexById(list: unknown): IndexedList {
  const byId = new Map<string, unknown>();
  let malformed = 0;
  if (!Array.isArray(list)) return { byId, malformed };

  for (const item of list) {
    const id = (item as Identified)?.id;
    if (typeof id !== "string" || id.length === 0) {
      malformed += 1;
      continue;
    }
    // `byId.has(id)` doubles as the "already seen" check — a second Set with
    // identical membership would be dead weight.
    if (byId.has(id)) malformed += 1;
    byId.set(id, item);
  }
  return { byId, malformed };
}

/** Raw element count — 0 for anything that isn't an array. Used for the "before/after" totals, deliberately not id-filtered: it's literally "how many entries are in this array," the plainest reading of "you are replacing N nodes." */
function arrayLength(list: unknown): number {
  return Array.isArray(list) ? list.length : 0;
}

/** How deep {@link deepEqualIgnoringKeyOrder} will recurse before giving up and reporting "not equal." See that function's doc comment for why this exists and why 64 is a wide margin, not a realistic ceiling. */
const MAX_COMPARE_DEPTH = 64;

/**
 * Deep-equal for JSON-shaped values, ignoring object KEY ORDER but NOT array
 * element order — correct for JSON-shaped values specifically, not a general
 * deep-equal (see the caveats at the bottom).
 *
 * Why this exists: a node/edge/event read back out of Postgres' `jsonb`
 * column and the "same" object freshly assembled by the CLI are not
 * byte-identical even when every field holds the same value. Postgres
 * documents that jsonb does not preserve the input's key order — shorter
 * keys sort before longer ones, with a byte-comparison tie-break among
 * equal-length keys that is NOT a lexicographic sort (confirmed against
 * Postgres' own docs and source, independently reviewed — this comment
 * deliberately does not claim more precision about the tie-break than that).
 * A `JSON.stringify` equality check would therefore call almost every
 * round-tripped node "changed," which would make
 * `nodesChanged`/`edgesChanged`/`eventsChanged` read as "all of them" on
 * literally every restore — a number a human stops trusting, which is worse
 * than not printing one at all (the exact failure this function exists to
 * prevent; see `tests/services/graph-restore.test.js`'s key-order assertions
 * for the regression case).
 *
 * Array order is left alone on purpose: it IS real signal here (a flow's
 * `metadata.playlist` entries reordering is a genuine change, not noise),
 * and jsonb does not reorder array elements — only object keys.
 *
 * ── Depth cap (coordinator review, round 1, finding 1) ──────────────────────
 * Recursion is capped at {@link MAX_COMPARE_DEPTH} (64 — a real bundle's
 * `metadata` nests roughly 4 levels deep in practice; 64 is a wide margin,
 * not a realistic ceiling anyone should ever hit). Past the cap, two values
 * are reported UNEQUAL rather than compared further. This matters because
 * `metadata` is `z.record(z.string(), z.unknown())` in `@arkaik/schema` —
 * zod does not recurse into it at all — so a caller-supplied bundle can nest
 * `metadata` arbitrarily deep and still pass `validateInboundBundle` before
 * ever reaching this comparator. An uncapped recursive walk over that is a
 * stack-exhausting `RangeError`, reachable from a single field on the one
 * endpoint whose failure mode must never be an unhandled 500. Reporting
 * "changed" past the cap is the conservative default: a false "changed" just
 * asks a human to look again, exactly as a shallower genuine change would.
 * Verified with a fixture nested 10,000 levels deep — does not throw.
 *
 * NO cycle detection, deliberately: both `a` and `b` always arrive via
 * `JSON.parse` (a stored jsonb snapshot on one side, a request body on the
 * other), and `JSON.parse` cannot produce a cyclic structure — there is
 * nothing here for a cycle guard to catch, so one is not added.
 *
 * ── Caveats (both unreachable via `JSON.parse`, noted rather than guarded
 * against) ───────────────────────────────────────────────────────────────────
 * This is correct for JSON-shaped values specifically, not a general deep
 * equal: two key-less non-plain objects (e.g. `new Date(0)` and
 * `new Date(999)`) would compare equal here, since neither has its own
 * enumerable string keys. `JSON.parse` never produces a `Date`, a `Map`, or
 * any other non-plain object, so this is unreachable from either of this
 * function's real callers — documented so nobody generalizes this into a
 * shared deep-equal utility without noticing the gap.
 */
function deepEqualIgnoringKeyOrder(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > MAX_COMPARE_DEPTH) return false;
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false; // a === b above already covers null === null

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualIgnoringKeyOrder(item, b[i], depth + 1));
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
    return aKeys.every((key) => bSet.has(key) && deepEqualIgnoringKeyOrder(ao[key], bo[key], depth + 1));
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
    // `.has()`, not `!== undefined` — the intent is "does prev have this id
    // at all," and spelling it out this way doesn't quietly depend on the
    // invariant (true today, but not enforced here) that `indexById` never
    // stores an `undefined` value.
    if (prev.has(id) && !deepEqualIgnoringKeyOrder(prev.get(id), item)) n += 1;
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
 *
 * `*Before`/`*After` are the reconciliation totals (coordinator review,
 * round 1, finding 6): two identical bundles otherwise report zero
 * everywhere, indistinguishable from empty-to-empty — "you are replacing 412
 * nodes with 398" is the single most reassuring line to print before a
 * wholesale replace, and it was the one number missing. These are RAW array
 * lengths (0 for a non-array), not id-filtered — "how many nodes are in this
 * array" is the plainest reading of the question, independent of whether
 * every one of them is individually identifiable.
 *
 * `*Malformed` counts the INCOMING (`next`) bundle ONLY, not both sides
 * (coordinator review, round 1, finding 5). The stored side already passed
 * `validateBundle` when it was written; counting its malformed entries too
 * (the original version summed both) hides the one question that actually
 * matters before a destructive write: is the garbage in what you're about to
 * DESTROY, or in what you're about to WRITE? Only the second one should ever
 * change a caller's decision, so only the second one is counted.
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
    nodesBefore: arrayLength(prev?.nodes),
    nodesAfter: arrayLength(next?.nodes),
    nodesAdded: countMissing(nextNodes.byId, prevNodes.byId),
    nodesRemoved: countMissing(prevNodes.byId, nextNodes.byId),
    nodesChanged: countChanged(prevNodes.byId, nextNodes.byId),
    nodesMalformed: nextNodes.malformed,

    edgesBefore: arrayLength(prev?.edges),
    edgesAfter: arrayLength(next?.edges),
    edgesAdded: countMissing(nextEdges.byId, prevEdges.byId),
    edgesRemoved: countMissing(prevEdges.byId, nextEdges.byId),
    edgesChanged: countChanged(prevEdges.byId, nextEdges.byId),
    edgesMalformed: nextEdges.malformed,

    eventsBefore: arrayLength(prev?.journal),
    eventsAfter: arrayLength(next?.journal),
    eventsAdded: countMissing(nextEvents.byId, prevEvents.byId),
    eventsDropped: countMissing(prevEvents.byId, nextEvents.byId),
    eventsChanged: countChanged(prevEvents.byId, nextEvents.byId),
    eventsMalformed: nextEvents.malformed,
  };
}

// ---------------------------------------------------------------------------
// Tier limit (the pure half of "owner-only, tier-limited" — see the module
// doc comment above for where the line against SQL is drawn)
// ---------------------------------------------------------------------------

export interface EntityLimitCheck {
  ok: boolean;
  /**
   * The tier's entity cap, or `null` for an uncapped tier (`klub`).
   * Deliberately NOT `Infinity`: `limits.ts` states its own invariant that
   * `Infinity` never reaches a JSON response body, because the only place a
   * limit was serialized before this function existed was a 403 rejection
   * klub can never trigger. This function is called on the SUCCESS path too
   * (`--dry-run` prints it unconditionally), so it normalizes to `null`
   * itself rather than relying on the invariant holding by accident wherever
   * this value is eventually used.
   */
  limit: number | null;
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
  // Compare against the RAW (possibly Infinite) limit — `actual <= Infinity`
  // is always true, which is exactly the "no cap" behavior klub needs — and
  // only normalize for the RETURNED value, after the comparison is done.
  const rawLimit = getHostedLimitsForTier(tier).entities;
  const limit = Number.isFinite(rawLimit) ? rawLimit : null;
  return { ok: actual <= rawLimit, limit, actual };
}
