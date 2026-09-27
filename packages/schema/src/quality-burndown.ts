/**
 * The findings burndown: how many findings were open at each moment, and what
 * moved the number (issue #441).
 *
 * The matrix measures *what the code is* — a cell's score only moves when the
 * cell is re-scored, which is SPEC § 6's rule and stays it. So a week of
 * closing findings leaves the matrix looking exactly as it did, and the work is
 * invisible to anyone who did not do it. The history is already recorded:
 * `quality.finding.opened` / `resolved` / `accepted` land per finding, and
 * `quality.audit.completed` carries the open counts at each audit. This module
 * replays them into a series, so the page can show *what you did* the day a
 * finding closes, without waiting for the next audit.
 *
 * Same disciplines as `quality-trend.ts`: zod-free and fs-free, nothing mutates
 * its input, and lenient and total — a malformed event is skipped, never a
 * throw, because a hand-edited journal must never blank the page.
 *
 * **The replay.** Events in `orderEvents` order (ts, then id):
 *
 * - `opened` adds the finding at the severity **stored on the event** — never
 *   re-derived, so a retuned pack cannot rewrite history. An `opened` for a
 *   finding already open is a re-run and moves nothing; one for a finding
 *   closed earlier reopens it.
 * - `resolved` / `accepted` take the finding out of the bucket it was opened
 *   in. One for a finding nobody saw open (it predates the journal, or a
 *   `journal.baseline` swallowed it) still counts as a close, and decrements
 *   nothing. A second close of the same finding counts once.
 * - `audit.completed` **re-baselines** the open counts from its `counts`, so a
 *   finding closed outside the tools (a hand-edited `findings.json`) is
 *   corrected at the next audit rather than drifting forever.
 *
 * **Findings no event opened.** A restored audit's findings arrive in the
 * section with no `opened` event behind them. Handed the section's `findings`,
 * the replay takes each one it never saw opened or closed to have been open
 * since the first recorded audit, at its severity under the current pack (the
 * best available — no event recorded one). That is what lets a close of such a
 * finding move its bucket, and what gives a filtered view a starting level.
 *
 * **Filters.** `surface` and `domain` narrow to findings on that surface and in
 * that domain (`SEC-01` → `SEC`, via the library when a criterion names its
 * own). An audit's `counts` are project-wide, so a filtered view is never
 * re-baselined — it is the finding-by-finding replay alone — and a close whose
 * finding cannot be placed (never opened, not in the section) is left out of
 * it rather than guessed into it. Audits still mark the series either way.
 */

import { orderEvents, type JournalEvent } from "./journal";
import {
  FINDING_SEVERITIES,
  severityOf,
  type FindingSeverity,
  type KritikLibrary,
  type QualityFinding,
} from "./quality";
import { domainCodeOf } from "./quality-ops";

export type BurndownCauseType = "opened" | "resolved" | "accepted" | "audit";

export interface BurndownPoint {
  /** The event's timestamp. */
  ts: string;
  /** Open findings by severity at this instant, after the event applied. */
  open: Record<FindingSeverity, number>;
  /** What moved it: the event's kind, and the finding id (or the audit id). */
  cause: { type: BurndownCauseType; id: string };
}

/** The newest recorded audit, and what moved after it — the page's "closed since" line. */
export interface BurndownSince {
  audit_id: string;
  ts: string;
  opened: number;
  resolved: number;
  accepted: number;
}

export interface FindingsBurndown {
  /** Oldest first, one per event that touched the view. Empty for an empty journal. */
  points: BurndownPoint[];
  /** Findings opened, resolved and accepted across the whole journal. */
  opened: number;
  resolved: number;
  accepted: number;
  /** `null` until an audit has been recorded. */
  since: BurndownSince | null;
}

export interface BurndownOptions {
  surface?: string;
  domain?: string;
  library?: KritikLibrary;
  /** The section's findings — see the head of this file for what they stand in for. */
  findings?: readonly QualityFinding[];
}

const EVENT_CAUSE: Readonly<Record<string, BurndownCauseType>> = {
  "quality.finding.opened": "opened",
  "quality.finding.resolved": "resolved",
  "quality.finding.accepted": "accepted",
  "quality.audit.completed": "audit",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

const emptyCounts = (): Record<FindingSeverity, number> => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });

const asSeverity = (value: unknown): FindingSeverity | null =>
  typeof value === "string" && (FINDING_SEVERITIES as readonly string[]).includes(value) ? (value as FindingSeverity) : null;

/** An audit's `counts`, kept to finite non-negative numbers; a missing bucket is 0. */
function cleanCounts(raw: unknown): Record<FindingSeverity, number> {
  const counts = emptyCounts();
  if (!isRecord(raw)) return counts;
  for (const severity of FINDING_SEVERITIES) {
    const value = raw[severity];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) counts[severity] = value;
  }
  return counts;
}

/** Every open finding across the buckets — `info` included, as the matrix's own `finding_counts` count it. */
export function openTotal(open: Readonly<Record<FindingSeverity, number>>): number {
  return FINDING_SEVERITIES.reduce((sum, severity) => sum + (open[severity] ?? 0), 0);
}

/** What the replay knows about one finding. */
interface Tracked {
  severity: FindingSeverity | null;
  open: boolean;
  surface?: string;
  criterion_id?: string;
}

/**
 * Replay the finding stream into the burndown. See the head of this file for
 * the rules; `options` narrows it and supplies what the events cannot.
 */
export function deriveFindingsBurndown(
  events: readonly JournalEvent[] | null | undefined,
  options: BurndownOptions = {},
): FindingsBurndown {
  const { surface, domain, library } = options;
  const filtered = surface !== undefined || domain !== undefined;

  const sectionById = new Map<string, QualityFinding>();
  for (const finding of Array.isArray(options.findings) ? options.findings : []) {
    if (isRecord(finding) && isString(finding.id)) sectionById.set(finding.id, finding as QualityFinding);
  }

  const inView = (where: { surface?: unknown; criterion_id?: unknown } | undefined): boolean => {
    if (!filtered) return true;
    if (where === undefined) return false;
    if (surface !== undefined && where.surface !== surface) return false;
    if (domain !== undefined && (!isString(where.criterion_id) || domainCodeOf(where.criterion_id, library) !== domain)) {
      return false;
    }
    return true;
  };

  // Narrowed before ordering: `orderEvents` reads `ts` off every entry, and a
  // journal line that parsed to `null` must not throw here.
  const relevant = (Array.isArray(events) ? events : []).filter(
    (event): event is JournalEvent => isRecord(event) && typeof event.type === "string" && event.type in EVENT_CAUSE,
  );

  const tracked = new Map<string, Tracked>();
  const open = emptyCounts();
  const points: BurndownPoint[] = [];
  const totals = { opened: 0, resolved: 0, accepted: 0 };
  let since: BurndownSince | null = null;
  let seeded = false;

  const bump = (severity: FindingSeverity | null, by: 1 | -1) => {
    if (severity !== null) open[severity] = Math.max(0, open[severity] + by);
  };
  const mark = (event: JournalEvent, type: BurndownCauseType, id: string) => {
    points.push({ ts: typeof event.ts === "string" ? event.ts : "", open: { ...open }, cause: { type, id } });
  };
  const count = (type: "opened" | "resolved" | "accepted") => {
    totals[type]++;
    if (since !== null) since[type]++;
  };

  for (const event of orderEvents(relevant)) {
    const type = EVENT_CAUSE[event.type];

    if (type === "audit") {
      if (!seeded) {
        seeded = true;
        for (const [id, finding] of sectionById) {
          if (tracked.has(id) || finding.status === "refuted" || !inView(finding)) continue;
          const severity = severityOf(finding, library);
          tracked.set(id, { severity, open: true, surface: finding.surface, criterion_id: finding.criterion_id });
          bump(severity, 1);
        }
      }
      if (!filtered) Object.assign(open, cleanCounts(event.counts));
      const auditId = isString(event.audit_id) ? event.audit_id : isString(event.id) ? event.id : "";
      since = { audit_id: auditId, ts: typeof event.ts === "string" ? event.ts : "", opened: 0, resolved: 0, accepted: 0 };
      mark(event, "audit", auditId);
      continue;
    }

    const id = event.finding_id;
    if (!isString(id)) continue;
    const known = tracked.get(id);

    if (type === "opened") {
      if (known?.open) continue;
      if (!inView(event as { surface?: unknown; criterion_id?: unknown })) continue;
      const severity = asSeverity(event.severity);
      tracked.set(id, {
        severity,
        open: true,
        ...(typeof event.surface === "string" ? { surface: event.surface } : {}),
        ...(typeof event.criterion_id === "string" ? { criterion_id: event.criterion_id } : {}),
      });
      bump(severity, 1);
      count("opened");
      mark(event, "opened", id);
      continue;
    }

    // resolved | accepted
    if (known !== undefined) {
      if (!known.open) continue;
      known.open = false;
      bump(known.severity, -1);
    } else {
      // Never seen open. Placed through the section when it can be — a
      // filtered view counts only what it can place — and remembered closed,
      // so the seed at the first audit does not reopen it.
      const fromSection = sectionById.get(id);
      if (!inView(fromSection)) continue;
      tracked.set(id, {
        severity: null,
        open: false,
        ...(fromSection ? { surface: fromSection.surface, criterion_id: fromSection.criterion_id } : {}),
      });
    }
    count(type);
    mark(event, type, id);
  }

  return { points, ...totals, since };
}
