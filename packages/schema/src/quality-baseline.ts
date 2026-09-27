/**
 * The reading a restored audit never got (issue #472).
 *
 * `kritik_scope` and `kritik_trend` both measure from `quality.audit.completed`.
 * A hosted project whose audit arrived through `arkaik restore` has the audit —
 * its assessments and findings sit in `snapshot.quality` — but no recorded
 * reading of it, so the scope is always empty and the trend has no first row.
 *
 * Recording one now would be the trap the issue names: the scope counts only
 * resolutions ordered after its `since` recording, so a baseline dated today
 * drops every fix since the audit out of the window. This synthesizes the
 * reading instead, **dated where the audit was taken** — its newest assessment,
 * and never later than 1 ms before the first finding decision — and scored the
 * way the audit scored it: every finding a decision event names is read as
 * open again, because every decision is ordered after the reading, and the
 * anti-averaging caps and the counts must see the defects the audit saw. A
 * finding *opened* after the audit (a later `quality.finding.opened`) is left
 * exactly as the section reads it and so still counts in the baseline's
 * `counts` — accepted, since a restored project has no hosted open path yet
 * for that event to arrive through.
 *
 * Nothing is written here. The hosted write path (issue #473) writes this same
 * event for real the first time a hosted score would otherwise overwrite the
 * levels it is computed from.
 *
 * Same disciplines as `quality-scope.ts` and `quality-trend.ts`: zod-free and
 * fs-free, nothing mutates its input, and malformed input is no baseline
 * rather than a throw.
 */

import { orderEvents, type JournalEvent } from "./journal";
import { deriveQualityMatrix, type KritikLibrary, type QualityAssessment, type QualityFinding, type QualitySection } from "./quality";
import { auditCompletedInput } from "./quality-ops";

const EPOCH = "1970-01-01T00:00:00.000Z";
const DECISIONS = new Set(["quality.finding.resolved", "quality.finding.accepted"]);

const rowsOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

/** A plain object, never `null` and never an array — what every reader below (and `deriveQualityMatrix`) can safely dereference fields of. */
const isRow = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `value` as an array of object rows, dropping `null`/non-object entries a
 * hand-edited section or journal can carry. `deriveQualityMatrix` and this
 * module both dereference `.surface`/`.status`/`.type` unguarded, so a stray
 * `null` inside an otherwise-valid array must never reach either — the
 * "never throws" promise covers the array's *contents*, not just its shape.
 */
const objectRowsOf = <T>(value: unknown): T[] => rowsOf<unknown>(value).filter(isRow) as T[];

/** A shallow copy of `obj` without `keys` — used instead of destructure-and-discard so an omitted field never trips `no-unused-vars`. */
function omit<T extends Record<string, unknown>>(obj: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const key of keys) delete out[key];
  return out;
}

/** `x` as a canonical ISO string, or `undefined` when it does not parse. */
function isoOf(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

/**
 * `iso`, one millisecond earlier, or the epoch when that would fall outside
 * the range `Date` can represent (`iso` at or near `-271821-04-20`, the
 * minimum). `new Date(ms).toISOString()` throws on an out-of-range `ms`
 * rather than clamping, and a decision timestamped at the dawn of time is a
 * malformed row, not a real one — the epoch is the correct "never after it"
 * answer either way.
 */
function oneMsBefore(iso: string): string {
  const before = new Date(Date.parse(iso) - 1);
  return Number.isNaN(before.getTime()) ? EPOCH : before.toISOString();
}

type BaselineSection = Pick<QualitySection, "assessments" | "findings"> & Partial<Pick<QualitySection, "profile" | "framework_version" | "library">>;

/**
 * The implicit reading for `section`, or `null` when there is nothing to
 * synthesize: a real `quality.audit.completed` is already in `events`, or the
 * section carries no assessment tied to an audit run.
 */
export function implicitAuditBaseline(
  events: readonly JournalEvent[] | null | undefined,
  section: BaselineSection | null | undefined,
  library?: KritikLibrary,
): JournalEvent | null {
  const rows = objectRowsOf<JournalEvent>(events);
  if (rows.some((event) => event.type === "quality.audit.completed")) return null;

  // All valid assessment rows feed the matrix below; only the ones tagged with
  // an `audit_id` say anything about *which* audit to read or when it was
  // taken.
  const assessmentRows = objectRowsOf<QualityAssessment>(section?.assessments);
  const taggedAssessments = assessmentRows.filter((row) => isString(row.audit_id));
  if (taggedAssessments.length === 0) return null;
  const auditId = taggedAssessments.map((row) => row.audit_id as string).sort().at(-1) as string;

  // When: the audit's own newest score, capped to just before the first
  // decision — whichever is earlier — so the window keeps every fix.
  const ordered = orderEvents(rows);
  const firstDecision = ordered.find((event) => DECISIONS.has(event.type));
  const assessedAt = taggedAssessments
    .filter((row) => row.audit_id === auditId)
    .map((row) => isoOf(row.ts))
    .filter((at): at is string => at !== undefined)
    .sort()
    .at(-1);
  let ts: string;
  if (firstDecision === undefined) {
    ts = assessedAt ?? EPOCH;
  } else {
    const decidedAt = isoOf(firstDecision.ts);
    if (decidedAt === undefined) {
      ts = EPOCH;
    } else {
      const justBefore = oneMsBefore(decidedAt);
      ts = assessedAt !== undefined && assessedAt < justBefore ? assessedAt : justBefore;
    }
    // `orderEvents` (and every downstream reader — the scope, the trend) sorts
    // by the RAW `ts` string, not a parsed instant. A decision whose `ts`
    // carries a non-UTC offset (`"2026-08-04T23:00:00-02:00"`) can normalize
    // to an instant after this reading yet still sort lexically BEFORE it once
    // this event is merged into the journal — breaking the one invariant the
    // whole design leans on, that every decision sorts after its baseline.
    // Re-check on the same raw-string comparison `orderEvents` uses, and fall
    // back to the epoch — which nothing sorts before — when it doesn't hold.
    // An empty or non-string decision `ts` (sort key `""`) can never be beaten
    // this way either; that's accepted, the same as an unparsable one above.
    const decisionSortKey = typeof firstDecision.ts === "string" ? firstDecision.ts : "";
    if (!(ts < decisionSortKey)) ts = EPOCH;
  }

  // What: the audit's scores, with every decided finding open again.
  const decided = new Set<string>();
  for (const event of rows) {
    if (!DECISIONS.has(event.type)) continue;
    const id = (event as { finding_id?: unknown }).finding_id;
    if (isString(id)) decided.add(id);
  }
  const findings = objectRowsOf<QualityFinding>(section?.findings).map((finding) => {
    if (!isString(finding.id) || !decided.has(finding.id)) return finding as QualityFinding;
    return { ...omit(finding, ["resolved_by"]), status: "open" } as QualityFinding;
  });
  const matrix = deriveQualityMatrix({ quality: { ...(section as QualitySection), assessments: assessmentRows, findings } }, library);
  // `matrix.framework_version` is already `section.framework_version` — the
  // one thing `deriveQualityMatrix` reads verbatim rather than resolving
  // against `library` — so falling further back to `section?.framework_version`
  // here would only ever repeat it.
  const frameworkVersion = matrix.framework_version ?? library?.version ?? "unknown";
  const input = auditCompletedInput(matrix, { audit_id: auditId, framework_version: frameworkVersion });

  return { id: `implicit-baseline:${auditId}`, ts, type: input.type, ...input.payload, baseline: true } as JournalEvent;
}

/** `events` with the implicit baseline in front, or `events` itself when there is none. */
export function withImplicitBaseline(
  events: readonly JournalEvent[],
  section: BaselineSection | null | undefined,
  library?: KritikLibrary,
): readonly JournalEvent[] {
  const baseline = implicitAuditBaseline(events, section, library);
  return baseline === null ? events : [baseline, ...events];
}

/** The reading without its envelope — what the hosted write path hands `makeEvent` when it records the baseline for real. */
export function baselineEventPayload(event: JournalEvent): Record<string, unknown> {
  return omit(event, ["id", "ts", "type", "actor"]);
}
