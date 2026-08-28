/**
 * The Quality page's projections.
 *
 * Everything here reads `bundle.quality` and a resolved Kritik library and
 * returns plain data. Not one scale is reimplemented: severity, priority,
 * grades and the comparative matrix all come from `@arkaik/schema`, which is
 * where the CLI and MCP read them too. A second implementation of `severityOf`
 * living in the app would be a second answer to "how bad is this", and the two
 * would drift the first time a pack moved a bucket.
 *
 * These live app-side rather than in the schema package for the reason
 * `coverage.ts`, `delivery.ts` and `pyramid.ts` do: they are page shapes with
 * one consumer. `deriveQualityMatrix` is in the schema package because
 * `arkaik kritik matrix` and `kritik_matrix` both call it.
 */

import {
  gradeOf,
  isOpenFinding,
  priorityOf,
  severityOf,
  type FindingPriority,
  type FindingSeverity,
  type FindingStatus,
  type KritikCriterion,
  type KritikDomain,
  type KritikLibrary,
  type MaturityLevel,
  type QualityAssessment,
  type QualityFinding,
  type QualityGrade,
  type QualityMatrix,
  type QualitySection,
  type RemediationCost,
  type SurfaceDef,
} from "@arkaik/schema";

/** A finding with everything the board renders, resolved once. */
export interface FindingRow {
  id: string;
  criterionId: string;
  /** The criterion's name from the pack, falling back to its id. */
  criterionName: string;
  /** Owning domain code, `""` when the pack does not define the criterion. */
  domain: string;
  domainName: string;
  surface: string;
  title: string;
  detail: string;
  evidence: string;
  impact: number;
  likelihood: number;
  /** `impact x likelihood` — the number the severity bucket is read from. */
  risk: number;
  cost: RemediationCost;
  severity: FindingSeverity;
  priority: FindingPriority;
  status: FindingStatus;
  open: boolean;
  /** Always an array; a finding with no links is `[]`, never `undefined`. */
  nodeIds: string[];
  issueUrl?: string;
  /**
   * Carried through as the schema declares it rather than restated: the verdict
   * is a closed set the refutation pass owns, and a widened copy here would let
   * the board render a verdict the pack never issues.
   */
  verification?: QualityFinding["verification"];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** `criterion id -> criterion`, built once per projection pass. */
function criteriaById(library?: KritikLibrary): Map<string, KritikCriterion> {
  const index = new Map<string, KritikCriterion>();
  for (const criterion of asArray<KritikCriterion>(library?.criteria)) {
    if (typeof criterion?.id === "string") index.set(criterion.id, criterion);
  }
  return index;
}

/** `domain code -> display name`, falling back to the code itself. */
function domainNames(library?: KritikLibrary): Map<string, string> {
  const index = new Map<string, string>();
  for (const domain of asArray<KritikDomain>(library?.domains)) {
    if (typeof domain?.code === "string") index.set(domain.code, domain.name ?? domain.code);
  }
  return index;
}

/**
 * Every finding, denormalized.
 *
 * The single place a finding is flattened. The board, the node index and the
 * criterion panel all consume this rather than walking `section.findings`
 * again, so severity is computed once per finding and the three surfaces
 * cannot disagree about what a finding is.
 *
 * A finding whose `criterion_id` the pack does not define gets `domain: ""`.
 * That is deliberate and matches `deriveQualityMatrix`, which drops it from
 * every cell: nobody wrote a weight for it, so it cannot be scored into a
 * domain. It is still a row, because a finding the UI cannot place is still a
 * finding somebody has to act on — dropping it here would make it invisible.
 */
export function buildFindingRows(
  section: Pick<QualitySection, "findings"> | undefined,
  library?: KritikLibrary,
): FindingRow[] {
  const criteria = criteriaById(library);
  const names = domainNames(library);

  return asArray<QualityFinding>(section?.findings).map((finding) => {
    const criterion = criteria.get(finding.criterion_id);
    const domain = typeof criterion?.domain === "string" ? criterion.domain : "";
    const impact = typeof finding.impact === "number" ? finding.impact : 0;
    const likelihood = typeof finding.likelihood === "number" ? finding.likelihood : 0;

    return {
      id: finding.id,
      criterionId: finding.criterion_id,
      criterionName: (criterion?.name as string | undefined) ?? finding.criterion_id,
      domain,
      domainName: names.get(domain) ?? domain,
      surface: finding.surface,
      title: finding.title,
      detail: finding.detail,
      evidence: finding.evidence,
      impact,
      likelihood,
      risk: impact * likelihood,
      cost: finding.cost,
      severity: severityOf(finding, library),
      priority: priorityOf(finding, library),
      status: finding.status ?? "open",
      open: isOpenFinding(finding),
      nodeIds: asArray<string>(finding.node_ids),
      issueUrl: finding.issue_url,
      verification: finding.verification,
    };
  });
}

/**
 * The board's filter set. `cell` is encoded `"<domain>|<surface>"` because it
 * travels in the URL and a matrix cell is exactly a domain and a surface.
 */
export interface QualityFilters {
  search: string;
  severity: FindingSeverity | "all";
  surface: string;
  priority: FindingPriority | "all";
  domain: string;
  status: FindingStatus | "all";
  /** `"SEC|web"`, or `null` for no active cell. */
  cell: string | null;
  sort: QualitySort;
}

export type QualitySort = "severity" | "priority" | "surface" | "domain";

export const EMPTY_QUALITY_FILTERS: QualityFilters = {
  search: "",
  severity: "all",
  surface: "all",
  priority: "all",
  domain: "all",
  status: "all",
  cell: null,
  sort: "severity",
};

/** Encode a matrix cell for the URL and the filter set. */
export function cellKey(domain: string, surface: string): string {
  return `${domain}|${surface}`;
}

/** Decode a cell key; `null` for anything that is not one. */
export function parseCellKey(key: string | null): { domain: string; surface: string } | null {
  if (!key) return null;
  const separator = key.indexOf("|");
  if (separator <= 0 || separator === key.length - 1) return null;
  return { domain: key.slice(0, separator), surface: key.slice(separator + 1) };
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Narrow the rows. Every filter is a conjunction, `"all"` and `""` meaning
 * "do not narrow on this" — the same convention `filterAcceptances` uses, so a
 * reader who knows one bar knows this one.
 *
 * Search reaches title, detail, evidence, criterion id and criterion name,
 * because the pilot's own console searched file paths and the evidence field is
 * where a `file:line` citation lives.
 */
export function filterFindings(rows: FindingRow[], filters: QualityFilters): FindingRow[] {
  const cell = parseCellKey(filters.cell);
  const needle = filters.search.trim().toLowerCase();

  const matched = rows.filter((row) => {
    if (filters.severity !== "all" && row.severity !== filters.severity) return false;
    if (filters.priority !== "all" && row.priority !== filters.priority) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.surface !== "all" && row.surface !== filters.surface) return false;
    if (filters.domain !== "all" && row.domain !== filters.domain) return false;
    if (cell && (row.domain !== cell.domain || row.surface !== cell.surface)) return false;
    if (needle === "") return true;

    return [row.title, row.detail, row.evidence, row.criterionId, row.criterionName]
      .join("\n")
      .toLowerCase()
      .includes(needle);
  });

  return sortFindings(matched, filters.sort);
}

/** Worst first on every axis; the id breaks ties so the order is stable. */
function sortFindings(rows: FindingRow[], sort: QualitySort): FindingRow[] {
  const bySeverity = (a: FindingRow, b: FindingRow) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.risk - a.risk;

  return [...rows].sort((a, b) => {
    if (sort === "priority") return a.priority.localeCompare(b.priority) || bySeverity(a, b) || a.id.localeCompare(b.id);
    if (sort === "surface") return a.surface.localeCompare(b.surface) || bySeverity(a, b) || a.id.localeCompare(b.id);
    if (sort === "domain") return a.domain.localeCompare(b.domain) || bySeverity(a, b) || a.id.localeCompare(b.id);
    return bySeverity(a, b) || a.id.localeCompare(b.id);
  });
}

export interface PriorityGroup {
  priority: FindingPriority;
  rows: FindingRow[];
}

const PRIORITY_ORDER: readonly FindingPriority[] = ["P0", "P1", "P2", "P3"];

/**
 * Findings by priority, worst lane first.
 *
 * Empty groups are retained rather than dropped: a board that silently omits P0
 * when there is no P0 reads as a board that has not loaded. "None at this
 * priority" is information, and it is the good news.
 */
export function groupByPriority(rows: FindingRow[]): PriorityGroup[] {
  return PRIORITY_ORDER.map((priority) => ({
    priority,
    rows: rows.filter((row) => row.priority === priority),
  }));
}

/** One criterion inside an open matrix cell. */
export interface CriterionRow {
  criterionId: string;
  name: string;
  question?: string;
  level: MaturityLevel;
  evidence: string;
  auditId: string;
  ts: string;
  /** Open findings filed against this criterion on this surface. */
  openFindings: number;
}

/**
 * The criteria behind one matrix cell, with the level each was scored at.
 *
 * Scored criteria only. A criterion the audit skipped has no assessment and is
 * absent here for the same reason it is absent from the cell's score: a narrow
 * audit must read as narrow, not as bad.
 */
export function buildCellCriteria(
  section: Pick<QualitySection, "assessments" | "findings"> | undefined,
  library: KritikLibrary | undefined,
  domain: string,
  surface: string,
): CriterionRow[] {
  const criteria = criteriaById(library);
  const openPerCriterion = new Map<string, number>();
  for (const finding of asArray<QualityFinding>(section?.findings)) {
    if (!isOpenFinding(finding) || finding.surface !== surface) continue;
    openPerCriterion.set(finding.criterion_id, (openPerCriterion.get(finding.criterion_id) ?? 0) + 1);
  }

  return asArray<QualityAssessment>(section?.assessments)
    .filter((assessment) => {
      if (assessment.surface !== surface) return false;
      return criteria.get(assessment.criterion_id)?.domain === domain;
    })
    .map((assessment) => {
      const criterion = criteria.get(assessment.criterion_id);
      return {
        criterionId: assessment.criterion_id,
        name: (criterion?.name as string | undefined) ?? assessment.criterion_id,
        question: criterion?.question as string | undefined,
        level: assessment.level,
        evidence: assessment.evidence,
        auditId: assessment.audit_id,
        ts: assessment.ts,
        openFindings: openPerCriterion.get(assessment.criterion_id) ?? 0,
      };
    })
    .sort((a, b) => a.criterionId.localeCompare(b.criterionId));
}

export interface NodeFindingSummary {
  counts: Record<FindingSeverity, number>;
  /** The most severe severity present on this node. */
  worst: FindingSeverity;
  total: number;
}

const SEVERITY_WORST_FIRST: readonly FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

/**
 * `node id -> its open findings`, built once per page.
 *
 * A map rather than a per-node scan: the canvas asks this question once per
 * node, and a filter over 246 findings per node is 246 x n comparisons for a
 * badge most nodes do not draw. Resolved, refuted and accepted-risk findings
 * are excluded — a badge is a call to act, and those are not.
 */
export function buildNodeFindingIndex(
  section: Pick<QualitySection, "findings"> | undefined,
  library?: KritikLibrary,
): Map<string, NodeFindingSummary> {
  const index = new Map<string, NodeFindingSummary>();

  for (const finding of asArray<QualityFinding>(section?.findings)) {
    if (!isOpenFinding(finding)) continue;
    const severity = severityOf(finding, library);

    for (const nodeId of asArray<string>(finding.node_ids)) {
      let summary = index.get(nodeId);
      if (!summary) {
        summary = {
          counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          worst: "info",
          total: 0,
        };
        index.set(nodeId, summary);
      }
      summary.counts[severity]++;
      summary.total++;
    }
  }

  for (const summary of index.values()) {
    summary.worst = SEVERITY_WORST_FIRST.find((severity) => summary.counts[severity] > 0) ?? "info";
  }

  return index;
}

export interface SurfaceGauge {
  surface: string;
  title: string;
  /** The matrix's own roll-up; `null` when nothing was scored on this surface. */
  score: number | null;
  grade: QualityGrade | null;
  openFindings: number;
}

/**
 * One gauge per profile surface for the Overview.
 *
 * The score is read straight off `matrix.overall` rather than recomputed, so
 * the card and the page can never disagree. The grade is banded from that
 * score *without* re-applying caps: caps shape the cell a reader acts on, and
 * `deriveQualityMatrix` already declined to fold them into the roll-up.
 */
export function buildSurfaceGauges(
  matrix: QualityMatrix,
  section: Pick<QualitySection, "profile" | "findings"> | undefined,
  library?: KritikLibrary,
): SurfaceGauge[] {
  const titles = new Map<string, string>();
  for (const surface of asArray<SurfaceDef>(section?.profile?.surfaces)) {
    if (typeof surface?.id === "string") titles.set(surface.id, surface.title ?? surface.id);
  }

  const openPerSurface = new Map<string, number>();
  for (const finding of asArray<QualityFinding>(section?.findings)) {
    if (!isOpenFinding(finding)) continue;
    openPerSurface.set(finding.surface, (openPerSurface.get(finding.surface) ?? 0) + 1);
  }

  return matrix.surfaces.map((surface) => {
    const score = matrix.overall[surface] ?? null;
    return {
      surface,
      title: titles.get(surface) ?? surface,
      score,
      grade: score === null ? null : gradeOf(score, library),
      openFindings: openPerSurface.get(surface) ?? 0,
    };
  });
}
