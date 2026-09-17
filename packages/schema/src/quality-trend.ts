/**
 * The quality trend: where the product stood at each recorded audit, and which
 * way it has moved since (issue #442 — the arrow SPEC § 7 promised).
 *
 * Every `arkaik kritik matrix --record` appends one `quality.audit.completed`
 * carrying the roll-up compressed to `scores[surface][domain]` and the open
 * finding counts. Until now nothing read that back but the journal's one-line
 * summary. This module replays those events into a series of snapshots, oldest
 * first, and answers the one question the matrix could not: *from where we
 * started to where we are now*.
 *
 * Same two disciplines as `quality.ts` and `quality-regressions.ts`: zod-free
 * and fs-free (the runtime imports are `orderEvents` and `rollUpSurface`, both
 * pure), and nothing mutates its input. Lenient and total, too: a malformed
 * payload yields a snapshot with no cells rather than a throw, because a
 * hand-edited journal must never blank the matrix.
 *
 * **The baseline is the live matrix, not the last event.** The arrow a card
 * wears is `live cell − previous snapshot`. Right after a re-audit is recorded
 * the live matrix *is* the newest snapshot, and comparing the two would collapse
 * every arrow to `=` — so `previous` is the newest snapshot whose scores differ
 * from the live cell set, else the one before it. One recorded audit that the
 * live matrix matches exactly therefore has no baseline, and no arrow: a first
 * audit is a first audit, not an unchanged one.
 */

import { orderEvents, type JournalEvent } from "./journal";
import { rollUpSurface, type FindingSeverity, type QualityMatrix, type QualityProfile } from "./quality";

/** One recorded audit, as `quality.audit.completed` compressed it. */
export interface AuditSnapshot {
  audit_id: string;
  /** The event's timestamp — when the audit was recorded, not the audit id's month. */
  ts: string;
  commit?: string;
  framework_version?: string;
  /**
   * False when a framework **major** bump separates this snapshot from the one
   * before it: SPEC § 8 says matrices across a major bump are not comparable,
   * so no delta is read across that boundary. The oldest snapshot is `true`
   * (there is nothing before it to disagree with).
   */
  comparable: boolean;
  /** `scores[surface][domain]`, the 0–100 domain score — the event's own payload, cleaned. */
  scores: Record<string, Record<string, number>>;
  /** Per-surface roll-up, recomputed from `scores` with the profile's `domain_weights`. */
  overall: Record<string, number | null>;
  /** Open findings by severity at the time of the audit; a missing bucket is 0. */
  counts: Record<FindingSeverity, number>;
}

/**
 * A cell's movement against the baseline snapshot. `previous: null` means no
 * earlier reading exists for this cell — a first audit, or a surface or domain
 * the baseline never scored. `delta: null` with a `previous` means the reading
 * exists but is not comparable: no live value, or a framework major bump in
 * between. `audit_id` names the audit `previous` was read at.
 */
export interface ScoreDelta {
  previous: number | null;
  delta: number | null;
  audit_id?: string;
}

export interface QualityTrend {
  /** Oldest first, by `orderEvents` (ts, then id) — never by audit id. */
  snapshots: AuditSnapshot[];
  /** The newest recorded audit, or `null` when none has been. */
  latest: AuditSnapshot | null;
  /**
   * The baseline the live matrix is compared against: the newest snapshot whose
   * scores differ from the live cell set, else the second-newest. `null` when
   * no earlier reading exists.
   */
  previous: AuditSnapshot | null;
  /** The live `(domain × surface)` cell against `previous`. */
  deltaCell(domain: string, surface: string): ScoreDelta;
  /** The live surface roll-up against `previous`. */
  deltaOverall(surface: string): ScoreDelta;
}

const NO_DELTA: ScoreDelta = { previous: null, delta: null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The major of a semver-ish string (`1.2.0` → 1, `v2` → 2); `null` when unreadable. */
export function frameworkMajor(version: unknown): number | null {
  if (typeof version !== "string") return null;
  const match = /^\s*v?(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

/**
 * Whether two framework versions sit on the same major. Lenient on purpose: an
 * unreadable or absent version on either side is treated as comparable, since
 * refusing every delta for a snapshot that forgot its version would blank the
 * matrix for the wrong reason.
 */
export function sameFrameworkMajor(a: unknown, b: unknown): boolean {
  const left = frameworkMajor(a);
  const right = frameworkMajor(b);
  return left === null || right === null || left === right;
}

/** The event's `scores`, kept to what is actually a `surface → domain → number` map. */
function cleanScores(raw: unknown): Record<string, Record<string, number>> {
  const scores: Record<string, Record<string, number>> = {};
  if (!isRecord(raw)) return scores;
  for (const surface of Object.keys(raw)) {
    const bySurface = raw[surface];
    if (!isRecord(bySurface)) continue;
    const cleaned: Record<string, number> = {};
    for (const domain of Object.keys(bySurface)) {
      const score = bySurface[domain];
      if (typeof score === "number" && Number.isFinite(score)) cleaned[domain] = score;
    }
    scores[surface] = cleaned;
  }
  return scores;
}

function cleanCounts(raw: unknown): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  if (!isRecord(raw)) return counts;
  for (const severity of Object.keys(counts) as FindingSeverity[]) {
    const value = raw[severity];
    if (typeof value === "number" && Number.isFinite(value)) counts[severity] = value;
  }
  return counts;
}

/**
 * `surface::domain → score`, the shape two cell sets are compared in. The
 * separator cannot collide: surfaces are kebab-case and domain codes are
 * upper-case identifiers, and neither carries a colon.
 */
function cellSet(scores: Readonly<Record<string, Readonly<Record<string, number>>>>): Map<string, number> {
  const cells = new Map<string, number>();
  for (const surface of Object.keys(scores)) {
    for (const domain of Object.keys(scores[surface])) cells.set(`${surface}::${domain}`, scores[surface][domain]);
  }
  return cells;
}

/** The live matrix's cells in the same shape a snapshot carries them. */
function liveScores(live: Pick<QualityMatrix, "matrix">): Record<string, Record<string, number>> {
  const scores: Record<string, Record<string, number>> = {};
  for (const domain of Object.keys(live.matrix ?? {})) {
    const row = live.matrix[domain];
    if (!isRecord(row)) continue;
    for (const surface of Object.keys(row)) {
      const cell = row[surface];
      if (!cell || typeof cell.score !== "number") continue;
      (scores[surface] ??= {})[domain] = cell.score;
    }
  }
  return scores;
}

function sameCells(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

/**
 * Replay `quality.audit.completed` into the trend.
 *
 * - Ordered by `orderEvents` (ts, then id), **not** by `audit_id`: a scoped
 *   re-audit named `2026-09-scoped` sorts by when it happened.
 * - The same `audit_id` recorded twice (a re-run `--record`) — the latest wins
 *   and the earlier snapshot is dropped, so two consecutive records of one
 *   audit cannot read as a flat trend.
 * - `overall` is recomputed from `scores` through `rollUpSurface`, with the
 *   profile's `domain_weights`, exactly as `deriveQualityMatrix` rolls the
 *   live matrix up.
 * - A framework major bump between two snapshots marks the later one
 *   `comparable: false`; `deltaCell` reads no delta across that boundary, nor
 *   between the baseline and a live matrix on another major.
 * - `live` is the matrix the deltas are read against. Without it there is no
 *   current value, so every delta is `null` and `previous` is simply the
 *   newest snapshot — which is what the CLI's audit-by-audit listing wants.
 */
export function deriveQualityTrend(
  events: readonly JournalEvent[],
  profile?: Pick<QualityProfile, "domain_weights"> | null,
  live?: Pick<QualityMatrix, "matrix" | "overall" | "framework_version"> | null,
): QualityTrend {
  const weights = profile?.domain_weights;

  // Insertion order is event order, and a repeated audit id is deleted before
  // it is re-set so the winning record also takes the winning position.
  const byAudit = new Map<string, AuditSnapshot>();
  // Narrowed before ordering: `orderEvents` dereferences `ts` on every entry,
  // and a hand-edited journal line that parsed to `null` must not throw here.
  const audits = (Array.isArray(events) ? events : []).filter(
    (event): event is JournalEvent => isRecord(event) && event.type === "quality.audit.completed",
  );
  for (const event of orderEvents(audits)) {
    const auditId =
      typeof event.audit_id === "string" ? event.audit_id : typeof event.id === "string" ? event.id : "";
    const scores = cleanScores(event.scores);
    const overall: Record<string, number | null> = {};
    for (const surface of Object.keys(scores)) overall[surface] = rollUpSurface(scores[surface], weights);
    const snapshot: AuditSnapshot = {
      audit_id: auditId,
      ts: typeof event.ts === "string" ? event.ts : "",
      ...(typeof event.commit === "string" && event.commit !== "" ? { commit: event.commit } : {}),
      ...(typeof event.framework_version === "string" ? { framework_version: event.framework_version } : {}),
      comparable: true,
      scores,
      overall,
      counts: cleanCounts(event.counts),
    };
    byAudit.delete(auditId);
    byAudit.set(auditId, snapshot);
  }

  const snapshots = [...byAudit.values()];
  for (let i = 1; i < snapshots.length; i++) {
    snapshots[i].comparable = sameFrameworkMajor(snapshots[i - 1].framework_version, snapshots[i].framework_version);
  }

  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  let previous: AuditSnapshot | null = latest;
  if (live && latest !== null && sameCells(cellSet(latest.scores), cellSet(liveScores(live)))) {
    previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  }

  const comparable = previous !== null && live ? sameFrameworkMajor(previous.framework_version, live.framework_version) : false;

  const against = (prev: number | null | undefined, current: number | null | undefined): ScoreDelta => {
    if (previous === null || typeof prev !== "number") return NO_DELTA;
    const delta = comparable && typeof current === "number" ? current - prev : null;
    return { previous: prev, delta, audit_id: previous.audit_id };
  };

  return {
    snapshots,
    latest,
    previous,
    deltaCell: (domain, surface) =>
      against(previous?.scores[surface]?.[domain], live?.matrix?.[domain]?.[surface]?.score),
    deltaOverall: (surface) => against(previous?.overall[surface], live?.overall?.[surface]),
  };
}

/** One audit's line in the trend table: a value per surface, and how it moved since the row above. */
export interface TrendRow {
  audit_id: string;
  ts: string;
  commit?: string;
  framework_version?: string;
  comparable: boolean;
  /** Keyed by surface. `score: null` is not scored; `delta: null` is nothing comparable above it. */
  cells: Record<string, { score: number | null; delta: number | null }>;
}

/**
 * The trend as a table, oldest first — what `arkaik kritik trend` prints and
 * `kritik_trend` returns, built once here so the two cannot disagree.
 *
 * Each row's value is the surface roll-up, or the named domain's score with
 * `domain`; `surface` keeps one column. The delta is against the row above
 * (snapshot to snapshot, never the live matrix), and `null` where the row
 * above did not score that surface or a major bump sits between the two.
 * Columns are the surfaces in order of first appearance, which is the profile
 * order every `auditCompletedInput` wrote them in.
 */
export function trendRows(
  trend: Pick<QualityTrend, "snapshots">,
  filter: { surface?: string; domain?: string } = {},
): { surfaces: string[]; rows: TrendRow[] } {
  const surfaces: string[] = [];
  for (const snapshot of trend.snapshots) {
    for (const surface of Object.keys(snapshot.scores)) {
      if (filter.surface !== undefined && surface !== filter.surface) continue;
      if (!surfaces.includes(surface)) surfaces.push(surface);
    }
  }

  const valueOf = (snapshot: AuditSnapshot, surface: string): number | null => {
    if (filter.domain !== undefined) return snapshot.scores[surface]?.[filter.domain] ?? null;
    return snapshot.overall[surface] ?? null;
  };

  const rows: TrendRow[] = [];
  trend.snapshots.forEach((snapshot, index) => {
    const above = index > 0 ? trend.snapshots[index - 1] : null;
    const cells: TrendRow["cells"] = {};
    for (const surface of surfaces) {
      const score = valueOf(snapshot, surface);
      const before = above === null ? null : valueOf(above, surface);
      const delta = snapshot.comparable && score !== null && before !== null ? score - before : null;
      cells[surface] = { score, delta };
    }
    rows.push({
      audit_id: snapshot.audit_id,
      ts: snapshot.ts,
      ...(snapshot.commit !== undefined ? { commit: snapshot.commit } : {}),
      ...(snapshot.framework_version !== undefined ? { framework_version: snapshot.framework_version } : {}),
      comparable: snapshot.comparable,
      cells,
    });
  });

  return { surfaces, rows };
}

/**
 * A delta as the terminal and the card spell it: `▲ +6`, `▼ −3`, `=`; `null`
 * when there is nothing to say. One spelling for the CLI, the MCP text and
 * the UI so a reader learns it once.
 */
export function formatDelta(delta: number | null | undefined): string | null {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  if (delta > 0) return `▲ +${delta}`;
  if (delta < 0) return `▼ −${Math.abs(delta)}`;
  return "=";
}
