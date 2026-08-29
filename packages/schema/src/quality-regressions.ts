/**
 * Regression detection between two Kritik audits (issue #382 phase E, RFC
 * § 8.6's deferred half).
 *
 * `signals` prints a run sheet and does not execute one — that decision stands.
 * This is the other half it deferred: two audits' stored state compared, so
 * drift between them announces itself instead of waiting to be noticed on the
 * third look. Each regression becomes one `quality.signal.tripped`, which is
 * why every kind here is criterion-scoped: that event's payload requires a
 * `criterion_id` and a `surface`, and a domain-level drop has neither.
 *
 * Same two disciplines as `quality.ts` and `quality-ops.ts`: zod-free and
 * fs-free (the only imports are types and pure functions from `./quality`), and
 * nothing mutates its input.
 *
 * A tripped signal is not a finding. It is the prompt to go look — cheap,
 * frequent, allowed to be wrong — where a finding is expensive, rare, and has
 * survived an adversarial pass. Nothing here opens anything.
 */

import {
  isOpenFinding,
  severityOf,
  type KritikLibrary,
  type QualityAssessment,
  type QualityFinding,
  type QualitySection,
} from "./quality";

export type RegressionKind = "level-drop" | "new-severe-finding" | "reopened-finding";

/**
 * The statement that no longer holds, per kind — what the trip event carries in
 * its `signal` field. A pack's own `signals[]` are statements to check; these
 * are the three the framework itself asserts across audits.
 */
export const REGRESSION_SIGNALS: Readonly<Record<RegressionKind, string>> = {
  "level-drop": "maturity on this cell does not regress",
  "new-severe-finding": "no open Critical or High finding on this cell",
  "reopened-finding": "a resolved finding stays resolved",
};

export interface Regression {
  kind: RegressionKind;
  criterion_id: string;
  surface: string;
  signal: string;
  detail: string;
}

/** The half of an audit this compares — what `loadQualitySection` returns. */
export type AuditState = Pick<QualitySection, "assessments" | "findings">;

/**
 * Key a cell as `criterion::surface`.
 *
 * Surfaces are held to kebab-case by `parseSurfaceSpec`, and criterion ids are
 * pack content that follows the same convention — so in practice `::` appears
 * in neither and the key is unambiguous. It is a CONVENTION, not a guarantee:
 * `QualityAssessmentSchema` types both as bare strings, so a hand-authored pack
 * could contrive a collision (`SEC-01::web` x `x` keys the same as `SEC-01` x
 * `web::x`). The cost of that is one fabricated trip — a prompt to go look at a
 * cell that does not exist — which is the cheapest failure this module has.
 */
const cellKey = (criterionId: string, surface: string): string => `${criterionId}::${surface}`;

const rowsOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

function assessmentsByCell(state: AuditState): Map<string, QualityAssessment> {
  const cells = new Map<string, QualityAssessment>();
  for (const assessment of rowsOf<QualityAssessment>(state?.assessments)) {
    if (typeof assessment?.criterion_id !== "string" || typeof assessment?.surface !== "string") continue;
    cells.set(cellKey(assessment.criterion_id, assessment.surface), assessment);
  }
  return cells;
}

/** Open Critical/High findings per cell, ranked by the pack in force. */
function severeByCell(state: AuditState, library?: KritikLibrary): Map<string, QualityFinding[]> {
  const cells = new Map<string, QualityFinding[]>();
  for (const finding of rowsOf<QualityFinding>(state?.findings)) {
    if (typeof finding?.criterion_id !== "string" || typeof finding?.surface !== "string") continue;
    if (!isOpenFinding(finding)) continue;
    const severity = severityOf(finding, library);
    if (severity !== "critical" && severity !== "high") continue;
    const key = cellKey(finding.criterion_id, finding.surface);
    const existing = cells.get(key);
    if (existing === undefined) cells.set(key, [finding]);
    else existing.push(finding);
  }
  return cells;
}

/**
 * What got worse between two audits.
 *
 * `previous` and `next` are two audits' stored state, oldest first. The order
 * matters and is not inferred: an audit id is a convention, not a guarantee,
 * and guessing which reading came first would silently invert every verdict.
 *
 * **The guard.** `level-drop` and `new-severe-finding` each compare a cell to
 * itself, so both require the cell to be scored in BOTH audits. Without it a
 * half-finished audit fires a trip for every cell it has not reached yet —
 * hundreds of them, all meaning "not scored yet", which is the fastest way to
 * teach a reader to ignore the runner. `reopened-finding` compares a finding to
 * itself and needs no cell reading at all, so the guard does not apply to it: a
 * finding that came back matters whether or not its cell was re-scored.
 *
 * `cross-surface` needs no special case. Findings legitimately carry it, so a
 * contract finding that reopens is reported like any other; assessments on it
 * are already refused upstream, so a level drop there cannot arise.
 */
export function detectRegressions(
  previous: AuditState,
  next: AuditState,
  library?: KritikLibrary,
): Regression[] {
  const before = assessmentsByCell(previous);
  const after = assessmentsByCell(next);
  const comparable = (key: string): boolean => before.has(key) && after.has(key);
  const regressions: Regression[] = [];

  for (const [key, current] of after) {
    const earlier = before.get(key);
    if (earlier === undefined) continue;
    if (!(Number(current.level) < Number(earlier.level))) continue;
    regressions.push({
      kind: "level-drop",
      criterion_id: current.criterion_id,
      surface: current.surface,
      signal: REGRESSION_SIGNALS["level-drop"],
      detail: `level ${earlier.level} → ${current.level} (${earlier.audit_id} → ${current.audit_id})`,
    });
  }

  const severeBefore = severeByCell(previous, library);
  for (const [key, findings] of severeByCell(next, library)) {
    if (!comparable(key)) continue;
    if ((severeBefore.get(key) ?? []).length > 0) continue;
    for (const finding of findings) {
      regressions.push({
        kind: "new-severe-finding",
        criterion_id: finding.criterion_id,
        surface: finding.surface,
        signal: REGRESSION_SIGNALS["new-severe-finding"],
        detail: `${finding.id} — ${severityOf(finding, library)} (impact ${finding.impact} × likelihood ${finding.likelihood})`,
      });
    }
  }

  const resolvedBefore = new Set(
    rowsOf<QualityFinding>(previous?.findings)
      .filter((finding) => finding?.status === "resolved")
      .map((finding) => finding.id),
  );
  for (const finding of rowsOf<QualityFinding>(next?.findings)) {
    if (!isOpenFinding(finding) || !resolvedBefore.has(finding.id)) continue;
    regressions.push({
      kind: "reopened-finding",
      criterion_id: finding.criterion_id,
      surface: finding.surface,
      signal: REGRESSION_SIGNALS["reopened-finding"],
      detail: `${finding.id} — "${finding.title}"`,
    });
  }

  return regressions;
}
