import { PLATFORM_IDS, resolvePlatformStatus, type MutationOp, type Node, type PlatformId, type StatusId } from "@arkaik/schema";

/**
 * The pure core behind `POST /api/graph/projects/{id}/live` (issue #424) —
 * the one write a deployment is allowed to make: *this acceptance reached
 * `live` on this platform*.
 *
 * Shape validation plus the same all-or-nothing refusal posture
 * `persistMutation` and `planQualityEvents` use, with the project's nodes
 * taken as a plain argument rather than read here. That is what keeps this
 * module DB-free (no db/auth imports, no `server-only`) and importable by the
 * DB-free test loader (tests/services/load-live.js); the route in
 * `app/api/graph/projects/[projectId]/live/route.ts` is the only caller that
 * supplies real data.
 *
 * **What this door cannot do is the design.** It moves exactly one status,
 * `live`; only on `species: acceptance`; only on a platform the acceptance
 * lists; and never the base status — an unscoped `live` would mark every
 * platform without an entry of its own as delivered, the strongest claim in
 * the system and the last one a CI job should make by omission. So
 * `platform` is required, and a platform the acceptance does not list is
 * refused and reported, never guessed at (the webhook's posture,
 * lib/services/github/pull-request.ts). `archived` is refused on the base
 * status and on the platform's own entry alike — a platform deliberately
 * dropped is not brought back by a deploy.
 *
 * **Already live is a skip, not a refusal.** A deploy job re-runs; the
 * second run must get a 200 and write nothing. Everything else that is wrong
 * refuses the whole batch, so a caller never reasons about a partial write.
 *
 * The write itself is an ordinary `update_node` op through `applyMutation`,
 * so the row lock, the validators, the entity limits and the version bump all
 * apply unchanged, and the journal gets an ordinary `node.status_changed`
 * carrying `platform` — plus the `detail` this planner hands back as an
 * annotation for the store to stamp on that event.
 */

/** One caller-supplied entry, after the shape check. */
export interface LiveEntry {
  node_id: string;
  platform: PlatformId;
  /** Free-form evidence: the deployment URL, the store build number. */
  detail?: string;
}

export type LiveRefusalReason = "unknown_node" | "not_acceptance" | "archived" | "platform_not_applicable";

/** Why one entry refused the batch. `index` is its position in `entries`. */
export interface LiveRefusal {
  index: number;
  node_id: string;
  platform: PlatformId;
  reason: LiveRefusalReason;
  detail?: string;
}

/** An entry that wrote nothing because there was nothing to write. */
export interface LiveSkip {
  index: number;
  node_id: string;
  platform: PlatformId;
  reason: "already_live";
}

/** One platform this batch moves to live; `from` is its resolved status before the write. */
export interface LiveApplied {
  node_id: string;
  platform: PlatformId;
  from: StatusId;
  to: "live";
}

/** What the store stamps onto the matching derived `node.status_changed`. */
export interface LiveAnnotation {
  node_id: string;
  platform: PlatformId;
  detail: string;
}

export type LivePlan =
  | { ok: true; ops: MutationOp[]; applied: LiveApplied[]; skipped: LiveSkip[]; annotations: LiveAnnotation[] }
  | { ok: false; refusals: LiveRefusal[] };

const MAX_ENTRIES = 50;
const MAX_DETAIL_LENGTH = 2000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isPlatformId(value: unknown): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value as string);
}

/**
 * Shape-validate a request body into a batch of {@link LiveEntry}. Purely
 * structural: it never looks at a node, so it cannot refuse `unknown_node` —
 * that is {@link planLive}'s job. 1–50 entries; `node_id` a non-empty string;
 * `platform` required and one of `PLATFORM_IDS`; `detail` a non-empty string
 * of at most 2000 characters when present; no (node_id, platform) pair twice.
 */
export function parseLiveEntries(body: unknown): LiveEntry[] | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be an object with an entries array" };
  }
  const { entries } = body as { entries?: unknown };
  if (!Array.isArray(entries)) return { error: "entries must be an array" };
  if (entries.length === 0) return { error: "entries must contain at least one entry" };
  if (entries.length > MAX_ENTRIES) return { error: `entries must contain at most ${MAX_ENTRIES} entries` };

  const parsed: LiveEntry[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of entries.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { error: `entries[${index}] must be an object` };
    }
    const entry = raw as Record<string, unknown>;
    if (!isNonEmptyString(entry.node_id)) {
      return { error: `entries[${index}].node_id must be a non-empty string` };
    }
    if (!isPlatformId(entry.platform)) {
      return {
        error: `entries[${index}].platform is required and must be one of: ${PLATFORM_IDS.join(", ")}`,
      };
    }
    if (entry.detail !== undefined) {
      if (!isNonEmptyString(entry.detail)) {
        return { error: `entries[${index}].detail must be a non-empty string when present` };
      }
      if (entry.detail.length > MAX_DETAIL_LENGTH) {
        return { error: `entries[${index}].detail must be at most ${MAX_DETAIL_LENGTH} characters` };
      }
    }
    const key = `${entry.node_id}@${entry.platform}`;
    if (seen.has(key)) {
      return { error: `entries[${index}] repeats ${key}; each (node_id, platform) pair may appear once` };
    }
    seen.add(key);
    parsed.push({
      node_id: entry.node_id,
      platform: entry.platform,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    });
  }
  return parsed;
}

/**
 * Decide the batch against the project's nodes. Refusals are per entry and
 * all-or-nothing; `already_live` is reported under `skipped` and writes
 * nothing. Every surviving entry for a node is gathered and merged over its
 * metadata once, into ONE `update_node` op — `applyOps` replaces `metadata`
 * wholesale, so one op per entry would erase each other's platform entry.
 */
export function planLive(nodes: readonly Node[], entries: readonly LiveEntry[]): LivePlan {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const refusals: LiveRefusal[] = [];
  const skipped: LiveSkip[] = [];
  const applied: LiveApplied[] = [];
  const annotations: LiveAnnotation[] = [];
  const additions = new Map<string, { node: Node; statuses: Partial<Record<PlatformId, StatusId>> }>();

  for (const [index, entry] of entries.entries()) {
    const { node_id, platform } = entry;
    const node = byId.get(node_id);
    if (!node) {
      refusals.push({ index, node_id, platform, reason: "unknown_node" });
      continue;
    }
    if (node.species !== "acceptance") {
      refusals.push({
        index,
        node_id,
        platform,
        reason: "not_acceptance",
        detail: `${node_id} is a ${node.species}; only acceptances go live`,
      });
      continue;
    }
    if (node.status === "archived") {
      refusals.push({ index, node_id, platform, reason: "archived" });
      continue;
    }
    if (!node.platforms.includes(platform)) {
      refusals.push({
        index,
        node_id,
        platform,
        reason: "platform_not_applicable",
        detail:
          node.platforms.length > 0
            ? `${node_id} lists: ${node.platforms.join(", ")}`
            : `${node_id} lists no platforms`,
      });
      continue;
    }
    // Defined: `includes` just passed. The fallback is only for the type.
    const from = resolvePlatformStatus(node, platform) ?? node.status;
    if (from === "archived") {
      refusals.push({ index, node_id, platform, reason: "archived" });
      continue;
    }
    if (from === "live") {
      skipped.push({ index, node_id, platform, reason: "already_live" });
      continue;
    }
    applied.push({ node_id, platform, from, to: "live" });
    const addition = additions.get(node_id) ?? { node, statuses: {} };
    addition.statuses[platform] = "live";
    additions.set(node_id, addition);
    if (entry.detail !== undefined) annotations.push({ node_id, platform, detail: entry.detail });
  }

  if (refusals.length > 0) return { ok: false, refusals };

  const ops: MutationOp[] = [];
  for (const [nodeId, { node, statuses }] of additions) {
    ops.push({
      op: "update_node",
      node_id: nodeId,
      patch: {
        metadata: {
          ...node.metadata,
          platformStatuses: { ...node.metadata?.platformStatuses, ...statuses },
        },
      },
    });
  }
  return { ok: true, ops, applied, skipped, annotations };
}
