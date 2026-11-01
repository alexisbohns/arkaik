import { PLATFORM_IDS, decideScreenshot, type MutationOp, type Node, type PlatformId } from "@arkaik/schema";

/**
 * The pure core behind `POST /api/graph/projects/{id}/screenshots` (spec
 * 2026-11-01 § 3): a CI job says *here is a screenshot of this node on this
 * platform, from this commit*, and nothing else.
 *
 * Same posture as lib/services/graph/live.ts: shape validation, then a plan
 * over the project's nodes taken as a plain argument (DB-free, loadable by
 * tests/services/load-screenshots.js), all-or-nothing refusals, skips that
 * write nothing. The decision itself is `decideScreenshot` from
 * @arkaik/schema — the same function `applyOps` runs under the lock — so the
 * plan this returns and the write that follows cannot disagree, except when
 * the project changed between the read and the write, which the route
 * handles by re-reading and re-planning on a version conflict.
 *
 * `source` is forced to `ci` and `form` to `url`: a token that holds only
 * `screenshot:append` is a machine, and a machine posts URLs.
 */

export interface ScreenshotEntry {
  node_id: string;
  platform: PlatformId;
  url: string;
  commit: string;
  order: number;
  detail?: string;
}

export type ScreenshotRefusalReason = "unknown_node" | "not_shot_bearing" | "platform_not_applicable" | "invalid_url";

export interface ScreenshotRefusal {
  index: number;
  node_id: string;
  platform: PlatformId;
  reason: ScreenshotRefusalReason;
  detail?: string;
}

export interface ScreenshotSkip {
  index: number;
  node_id: string;
  platform: PlatformId;
  reason: "stale_order" | "unchanged";
}

export interface ScreenshotApplied {
  node_id: string;
  platform: PlatformId;
  url: string;
}

export type ScreenshotPlan =
  | { ok: true; ops: MutationOp[]; applied: ScreenshotApplied[]; skipped: ScreenshotSkip[] }
  | { ok: false; refusals: ScreenshotRefusal[] };

const MAX_ENTRIES = 100;
const MAX_DETAIL_LENGTH = 2000;
const BODY_KEYS: ReadonlySet<string> = new Set(["entries"]);
const ENTRY_KEYS: ReadonlySet<string> = new Set(["node_id", "platform", "url", "commit", "order", "detail"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isPlatformId(value: unknown): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value as string);
}

/**
 * Shape-validate a request body into a batch of {@link ScreenshotEntry}.
 * Purely structural: `url` must be a non-empty string here; whether it is an
 * `https://` URL is `decideScreenshot`'s call, reported as `invalid_url`.
 */
export function parseScreenshotEntries(body: unknown): ScreenshotEntry[] | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be an object with an entries array" };
  }
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) return { error: `body has an unknown key: ${key}` };
  }
  const { entries } = body as { entries?: unknown };
  if (!Array.isArray(entries)) return { error: "entries must be an array" };
  if (entries.length === 0) return { error: "entries must contain at least one entry" };
  if (entries.length > MAX_ENTRIES) return { error: `entries must contain at most ${MAX_ENTRIES} entries` };

  const parsed: ScreenshotEntry[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of entries.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: `entries[${index}] must be an object` };
    const e = raw as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      if (!ENTRY_KEYS.has(key)) return { error: `entries[${index}] has an unknown key: ${key}` };
    }
    if (!isNonEmptyString(e.node_id)) return { error: `entries[${index}].node_id must be a non-empty string` };
    if (!isPlatformId(e.platform)) return { error: `entries[${index}].platform is required and must be one of: ${PLATFORM_IDS.join(", ")}` };
    if (!isNonEmptyString(e.url)) return { error: `entries[${index}].url must be a non-empty string` };
    if (!isNonEmptyString(e.commit)) return { error: `entries[${index}].commit must be a non-empty string` };
    if (typeof e.order !== "number" || !Number.isInteger(e.order) || e.order < 0) {
      return { error: `entries[${index}].order must be a non-negative integer (the commit's height on the default branch)` };
    }
    if (e.detail !== undefined) {
      if (!isNonEmptyString(e.detail)) return { error: `entries[${index}].detail must be a non-empty string when present` };
      if (e.detail.length > MAX_DETAIL_LENGTH) return { error: `entries[${index}].detail must be at most ${MAX_DETAIL_LENGTH} characters` };
      if (CONTROL_CHARACTERS.test(e.detail)) return { error: `entries[${index}].detail must not contain control characters` };
    }
    const key = `${e.node_id}@${e.platform}`;
    if (seen.has(key)) return { error: `entries[${index}] repeats ${key}; each (node_id, platform) pair may appear once` };
    seen.add(key);
    parsed.push({
      node_id: e.node_id,
      platform: e.platform,
      url: e.url,
      commit: e.commit,
      order: e.order,
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
    });
  }
  return parsed;
}

/** Decide the batch against the project's nodes. One refusal refuses it all; skips write nothing. */
export function planScreenshots(nodes: readonly Node[], entries: readonly ScreenshotEntry[]): ScreenshotPlan {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const refusals: ScreenshotRefusal[] = [];
  const skipped: ScreenshotSkip[] = [];
  const applied: ScreenshotApplied[] = [];
  const ops: MutationOp[] = [];

  for (const [index, entry] of entries.entries()) {
    const { node_id, platform } = entry;
    const input = {
      node_id,
      platform,
      source: "ci" as const,
      form: "url" as const,
      value: entry.url,
      commit: entry.commit,
      order: entry.order,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    };
    const decision = decideScreenshot(byId.get(node_id), input);
    if (decision.kind === "refuse") {
      const reason: ScreenshotRefusalReason =
        decision.code === "node_not_found" ? "unknown_node"
        : decision.code === "invalid_screenshot" ? "invalid_url"
        : decision.code;
      refusals.push({ index, node_id, platform, reason, detail: decision.message });
      continue;
    }
    if (decision.kind === "skip") {
      skipped.push({ index, node_id, platform, reason: decision.reason });
      continue;
    }
    applied.push({ node_id, platform, url: entry.url });
    ops.push({ op: "record_screenshot", ...input });
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, ops, applied, skipped };
}
