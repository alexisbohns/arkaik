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
  FINDING_PRIORITIES,
  FINDING_SEVERITIES,
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

/**
 * `surface id -> title`, as the profile writes it.
 *
 * Built once per page and handed down, rather than derived again by every
 * component that renders a surface: the matrix's column headers, the board's
 * cards and the criteria strip all name the same axis, and three derivations of
 * it are three chances to say `supabase` where the header said "Database
 * contract".
 *
 * `CROSS_SURFACE_ID` is deliberately absent — it is a findings-only lens the
 * profile never declares — so a finding filed against it falls back to its own
 * id, which is the readable `cross-surface`.
 */
export function buildSurfaceTitles(
  section: Pick<QualitySection, "profile"> | undefined,
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const surface of asArray<SurfaceDef>(section?.profile?.surfaces)) {
    if (typeof surface?.id === "string") titles.set(surface.id, surface.title ?? surface.id);
  }
  return titles;
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
    // `Number.isFinite` rather than a `typeof` test, which admits `NaN`: a NaN
    // risk renders as the string "NaN" and silently disables the sort's risk
    // tiebreak, since every comparison against NaN is false.
    const impact = Number.isFinite(finding.impact) ? finding.impact : 0;
    const likelihood = Number.isFinite(finding.likelihood) ? finding.likelihood : 0;

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

/**
 * Display order, worst first, and the rank table the sort comparator reads.
 *
 * Both are derived from `FINDING_SEVERITIES` rather than restated. That array
 * is already declared worst first and is where the CLI reads the order from;
 * a sequence hand-written here would be a second opinion on which severity is
 * worse, free to drift from the first the day a severity is added.
 */
const SEVERITY_WORST_FIRST: readonly FindingSeverity[] = FINDING_SEVERITIES;

const SEVERITY_ORDER = Object.fromEntries(
  FINDING_SEVERITIES.map((severity, rank) => [severity, rank]),
) as Record<FindingSeverity, number>;

/**
 * Does this filter value actually narrow anything?
 *
 * `"all"` and `""` do not, per the convention below — and neither does an
 * absent key. `useQualityFilters` hydrates the set from URL search params,
 * where a filter nobody applied is simply missing from the query string; a
 * board that answered that with zero rows, or with a `TypeError` off
 * `search.trim()`, would read as broken rather than as unfiltered.
 */
function narrows(value: string | undefined | null): value is string {
  return typeof value === "string" && value !== "" && value !== "all";
}

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
  const needle = narrows(filters.search) ? filters.search.trim().toLowerCase() : "";

  const matched = rows.filter((row) => {
    if (narrows(filters.severity) && row.severity !== filters.severity) return false;
    if (narrows(filters.priority) && row.priority !== filters.priority) return false;
    if (narrows(filters.status) && row.status !== filters.status) return false;
    if (narrows(filters.surface) && row.surface !== filters.surface) return false;
    if (narrows(filters.domain) && row.domain !== filters.domain) return false;
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

/** The lane order, from the schema's own array for the reason `SEVERITY_ORDER` is. */
const PRIORITY_ORDER: readonly FindingPriority[] = FINDING_PRIORITIES;

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

/**
 * The clamp `deriveQualityMatrix` applies before it scores a cell, applied
 * identically here. Without it a `level: 7` would read "7" in the criteria
 * strip beside the very cell the matrix had already scored 100/A — one
 * assessment, two answers.
 */
function clampLevel(level: MaturityLevel): MaturityLevel {
  if (typeof level !== "number") return 0;
  return Math.min(Math.max(level, 0), 4) as MaturityLevel;
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
        level: clampLevel(assessment.level),
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

    // Deduped per finding, and string elements only: a finding that names the
    // same node twice is still one finding on that node, and a badge reading
    // "2" for it would be wrong. Non-string elements would otherwise become
    // map keys the canvas can never look up — the same guard `criteriaById`
    // and `domainNames` apply to their keys.
    const nodeIds = new Set(
      asArray<unknown>(finding.node_ids).filter((nodeId): nodeId is string => typeof nodeId === "string"),
    );

    for (const nodeId of nodeIds) {
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
  const titles = buildSurfaceTitles(section);

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
