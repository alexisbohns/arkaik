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
  FINDING_SEVERITIES,
  acceptedDetail,
  gradeOf,
  isOpenFinding,
  priorityOf,
  severityOf,
  deriveFindingsBurndown,
  type BurndownPoint,
  type FindingPriority,
  type FindingSeverity,
  type FindingsBurndown,
  type FindingStatus,
  type JournalEvent,
  type KritikCriterion,
  type KritikDomain,
  type KritikLibrary,
  type MaturityLevel,
  type QualityAssessment,
  type QualityFinding,
  type QualityGrade,
  type QualityMatrix,
  type QualityMatrixCell,
  type QualitySection,
  type QualityTrend,
  type RemediationCost,
  type ScoreDelta,
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
 * One criterion out of the pack, by id.
 *
 * Here rather than in a panel, though both its callers are panels: the
 * criterion panel had it, and the finding panel's Criterion card — which
 * previews the same criterion's question — reached across and imported it from
 * its sibling. A panel is a rendering of an answer, not the place other panels
 * ask the question, and that import coupled two panels that have no business
 * knowing about each other. This module already owns every other read of the
 * pack, including the private `criteriaById` above.
 *
 * A linear `find` rather than that index, deliberately: the index pays for
 * itself over a whole projection pass, and this is one lookup by one panel.
 */
export function criterionOf(
  criterionId: string,
  library?: KritikLibrary,
): KritikCriterion | undefined {
  return library?.criteria?.find((candidate) => candidate?.id === criterionId);
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
  // Priority first, severity inside it — the board's two scales in the order a
  // reader triages them. Severity alone put a Critical that is only worth doing
  // opportunistically above a P0, which is the one ordering the priority lane
  // exists to prevent.
  sort: "priority",
};

/**
 * The findings board's opening filter set: everything, minus the findings
 * somebody has already answered.
 *
 * Distinct from {@link EMPTY_QUALITY_FILTERS}, which stays what it says —
 * *narrows nothing* — because three panels pass it purely to borrow
 * `filterFindings`' comparator, and a criterion read in a panel must still show
 * the finding that was resolved against it. Only the URL layer
 * (`useQualityFilters`) defaults to this one: the board is the triage queue,
 * and a queue that opens holding work somebody finished cannot be emptied.
 */
export const DEFAULT_QUALITY_FILTERS: QualityFilters = {
  ...EMPTY_QUALITY_FILTERS,
  status: "open",
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

/** One card in a domain gallery: the cell, plus what the card must name. */
export interface DomainSurfaceCard {
  surface: string;
  /** The profile's title for the surface, falling back to its id. */
  title: string;
  /** `null` when this domain was not scored on this surface. */
  cell: QualityMatrixCell | null;
  /**
   * The cell against the last recorded audit (`deriveQualityTrend`). Absent
   * when the page has no trend or the cell is unscored; `previous: null` when
   * no earlier reading exists, which is a first audit and draws no arrow.
   */
  delta?: ScoreDelta;
}

/** One stacked section on the Matrix page: a domain and its surfaces. */
export interface DomainSection {
  domain: string;
  name: string;
  description?: string;
  cards: DomainSurfaceCard[];
  /**
   * The mean of the scored cells, rounded — the heading's headline number.
   * `null` when this domain was scored on no surface at all, which reads as
   * "not audited here" rather than as a zero.
   *
   * Deliberately unweighted across surfaces: `deriveQualityMatrix` weights
   * criteria *within* a cell, and no weight exists that says a web surface
   * counts more than an iOS one. A plain mean is the only honest roll-up, and
   * it is a heading, not a score anybody acts on.
   */
  average: number | null;
  /** How many of the matrix's surfaces this domain was actually scored on. */
  scored: number;
}

/**
 * The Matrix page's sections: one per library domain, in the library's own
 * order, each carrying one card per surface in the matrix's own order.
 *
 * A projection rather than a derivation inside the component, so the numbers
 * the headings quote are testable without React. Nothing is scored here —
 * every cell comes from `deriveQualityMatrix` untouched, and a domain the
 * matrix does not carry is simply absent.
 */
export function buildDomainSections(
  matrix: QualityMatrix,
  section: Pick<QualitySection, "profile"> | undefined,
  library?: KritikLibrary,
  trend?: Pick<QualityTrend, "deltaCell"> | null,
): DomainSection[] {
  const titles = buildSurfaceTitles(section);
  const meta = new Map<string, KritikDomain>();
  for (const domain of asArray<KritikDomain>(library?.domains)) {
    if (typeof domain?.code === "string") meta.set(domain.code, domain);
  }

  return matrix.domains.map((domain) => {
    const cards = matrix.surfaces.map((surface): DomainSurfaceCard => {
      const cell = matrix.matrix[domain]?.[surface] ?? null;
      return {
        surface,
        title: titles.get(surface) ?? surface,
        cell,
        // No delta on an unscored cell: it has no number for the arrow to sit
        // beside, and "N/A, down from 66" is a sentence about a different cell.
        ...(trend && cell ? { delta: trend.deltaCell(domain, surface) } : {}),
      };
    });

    const scores = cards
      .map((card) => card.cell?.score)
      .filter((score): score is number => typeof score === "number");

    const definition = meta.get(domain);
    return {
      domain,
      name: (definition?.name as string | undefined) ?? domain,
      description: definition?.description as string | undefined,
      cards,
      average:
        scores.length === 0
          ? null
          : Math.round(scores.reduce((total, score) => total + score, 0) / scores.length),
      scored: scores.length,
    };
  });
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
  /** The roll-up against the last recorded audit — see {@link DomainSurfaceCard.delta}. */
  delta?: ScoreDelta;
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
  trend?: Pick<QualityTrend, "deltaOverall"> | null,
): SurfaceGauge[] {
  const titles = buildSurfaceTitles(section);

  const openPerSurface = new Map<string, number>();
  for (const finding of asArray<QualityFinding>(section?.findings)) {
    if (!isOpenFinding(finding)) continue;
    openPerSurface.set(finding.surface, (openPerSurface.get(finding.surface) ?? 0) + 1);
  }

  return matrix.surfaces.map((surface): SurfaceGauge => {
    const score = matrix.overall[surface] ?? null;
    return {
      surface,
      title: titles.get(surface) ?? surface,
      score,
      grade: score === null ? null : gradeOf(score, library),
      openFindings: openPerSurface.get(surface) ?? 0,
      ...(trend && score !== null ? { delta: trend.deltaOverall(surface) } : {}),
    };
  });
}

/**
 * A delta in words, for a card's accessible name and its `title` — the arrow
 * spelled out, with the score it was read against and the audit it came from:
 * "up 6 from 66 at the 2026-08 audit". `null` when there is no earlier reading
 * at all, so a first audit says nothing rather than "unchanged". A reading
 * that exists but cannot be compared (a framework major bump since) still
 * names the previous score, and says why there is no arrow.
 */
export function describeDelta(delta: ScoreDelta | undefined): string | null {
  if (!delta || delta.previous === null) return null;
  const where = delta.audit_id ? ` at the ${delta.audit_id} audit` : "";
  if (delta.delta === null) return `${delta.previous}${where}, not comparable since the framework changed`;
  if (delta.delta > 0) return `up ${delta.delta} from ${delta.previous}${where}`;
  if (delta.delta < 0) return `down ${Math.abs(delta.delta)} from ${delta.previous}${where}`;
  return `unchanged from ${delta.previous}${where}`;
}

/**
 * A `quality.audit.completed` in words, for the journal feed.
 *
 * A scoped re-audit (issue #443) says so — "Scoped re-audit of 12 cells" — so
 * nobody reads a between-milestone pass over a dozen cells as the whole audit
 * it is not. Its scores are the merged picture either way; what differs is how
 * much was actually looked at, and that is the thing a reader of the feed needs.
 * Lenient like every reader of stored events: a malformed `scope` falls back to
 * the plain wording rather than rendering "of undefined cells".
 */
export function describeAuditCompleted(event: Readonly<Record<string, unknown>>): { text: string; meta?: string } {
  const str = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  const audit = str(event.audit_id);
  const framework = str(event.framework_version);
  const kritik = framework ? `Kritik ${framework}` : undefined;

  const scope = event.scope as { partial?: unknown; cells?: unknown; since?: unknown } | null | undefined;
  if (typeof scope !== "object" || scope === null || scope.partial !== true) {
    const text = `Audit ${audit ?? "?"} completed`;
    return kritik ? { text, meta: kritik } : { text };
  }

  // The count leads when there is one, and the audit id moves to the meta;
  // without a count the id is all the headline has to say which pass it was.
  const cells = typeof scope.cells === "number" && Number.isFinite(scope.cells) ? scope.cells : undefined;
  const since = str(scope.since);
  const text = cells !== undefined ? `Scoped re-audit of ${cells} cell${cells === 1 ? "" : "s"}` : `Scoped re-audit ${audit ?? "?"}`;
  const meta = [cells !== undefined ? audit : undefined, since ? `since ${since}` : undefined, kritik]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
  return meta === "" ? { text } : { text, meta };
}

/** One recorded audit's reading of a cell, for the cell panel's History. */
export interface CellHistoryRow {
  auditId: string;
  ts: string;
  commit?: string;
  /** `null` when that audit did not score the cell — not assessed, not zero. */
  score: number | null;
  /** False when a framework major bump sits between this audit and the one before it. */
  comparable: boolean;
}

/**
 * A cell's score at every recorded audit, oldest first — the cell panel's
 * journal section, by analogy with the node panel's History. Every snapshot is
 * a row, an audit that skipped the cell reading as unscored: a scoped audit
 * records the merged picture, so a gap here is a real gap, and hiding it would
 * make three audits look like two.
 */
export function buildCellHistory(
  trend: Pick<QualityTrend, "snapshots"> | undefined,
  domain: string,
  surface: string,
): CellHistoryRow[] {
  return (trend?.snapshots ?? []).map((snapshot) => ({
    auditId: snapshot.audit_id,
    ts: snapshot.ts,
    ...(snapshot.commit !== undefined ? { commit: snapshot.commit } : {}),
    score: snapshot.scores[surface]?.[domain] ?? null,
    comparable: snapshot.comparable,
  }));
}

/**
 * Fold hosted-write journal events over a stored section: `quality.finding.resolved`
 * and `quality.finding.accepted` (issue #382 phase E; accepted events added for
 * #400 hosted Kritik), and `quality.assessment.scored` (issue #473, hosted
 * write path part 2).
 *
 * The webhook — and, for accepted and scored, the hosted write route —
 * appends, and appends only: a merged PR that fixes a finding, a person
 * accepting a risk, or a re-audit scoring a cell, writes a journal fact, and
 * `snapshot.quality` is never rewritten to match it. This is the projection
 * that makes the fact visible, and it is the reading RFC § 3.2 declared from
 * the start — current state is the latest audit plus open-minus-decided, plus
 * whatever a later scored event has since said about a cell.
 *
 * **Findings: first decision wins.** Events are walked in journal order, and
 * the FIRST decision on an open finding wins: once an event has moved a
 * finding out of `open`, every later event naming that finding is ignored,
 * with one exception (below). This mirrors the write route: it refuses to
 * accept a `quality.finding.accepted` or `quality.finding.resolved` event
 * against a finding that is not currently `open`, so an event that would have
 * been refused at write time must never take effect here at read time either
 * — the journal cannot literally contain two decisions on the same finding
 * once the write path enforces this, but the fold has to be safe against a
 * journal from before that enforcement existed (or one written by a client
 * that skipped it) all the same.
 *
 * The one exception, preserving phase E's original behavior: for `resolved_by`
 * specifically, the LATEST `resolved` event that NAMES one wins, not the
 * first. A resolution carrying no url is a real shape (`findingResolvedInput`
 * omits `resolved_by` when it has none, which is what `arkaik kritik finding
 * resolve` without `--by` produces), and an unnamed event never erases a name
 * an earlier event carried — but a later NAMED event is new evidence and
 * overwrites whatever name (or absence of one) is there, first decision or
 * not. This only ever touches a status THIS fold produced (guarded by
 * `patched.has`); a `resolved` status that was already in the snapshot is
 * left untouched, same as `refuted` and `accepted-risk`.
 *
 * **Scores: latest wins.** A finding decision is a verdict the write route
 * refuses to let a second event overwrite, which is why first wins above. A
 * score is the opposite kind of fact: it is a re-measurement, and the write
 * route welcomes a new `quality.assessment.scored` against a cell that
 * already carries one — that is what a re-audit IS. So here the LATEST scored
 * event for a `(criterion_id, surface)` cell wins outright, upserted by the
 * key `${criterion_id}::${surface}` — the same axes `deriveQualityMatrix`
 * scores a cell by — and a cell the stored section never held (a first-ever
 * score) is appended rather than dropped for having nothing to replace.
 *
 * Returns the section BY REFERENCE when neither findings nor assessments
 * changed. That is the overwhelmingly common case — every project with no
 * decision or score since its last read — and returning the same object
 * means no allocation, no changed memo identity, and no re-render for the
 * reader who gained nothing.
 *
 * `refuted` and `accepted-risk` already in the snapshot are left alone, for
 * the reason the write path refuses to touch them: they are decisions
 * somebody recorded. An event naming a finding the section does not hold is
 * ignored — `validateBundle` already warns about that class, and a read
 * projection is not the place to raise it a second time. A malformed
 * `quality.assessment.scored` event — a non-string `criterion_id`, `surface`,
 * `audit_id` or `ts`, non-string `evidence`, or a `level` that is not an
 * integer 0–4 — is skipped the same way: this is a journal nobody has
 * re-validated since it left storage, not a payload the schema package
 * already parsed. `ts` is required, matching the type and the zod schema:
 * every real event carries one, and a row this fold produced without one
 * would be a row the cell panel's History cannot place in time.
 *
 * A stored row with no string `criterion_id`/`surface` to key by is never a
 * fold target — it survives untouched, at its original position, the same as
 * a finding a decision event does not name. A duplicate stored row for one
 * cell (`validateBundle` already warns about that class too) is folded onto
 * only its LAST occurrence, the one a latest-wins reader would honor; an
 * earlier duplicate for the same cell is left exactly as stored.
 *
 * **The restore guard.** A scored event is also checked against the STORED
 * row at its cell — never against a value an earlier event in this same walk
 * already produced — and skipped outright if its `audit_id` sorts lexically
 * before the stored row's. A hosted scoped audit id always sorts after every
 * known audit (`scopedAuditId` enforces it), so this never fires on an
 * ordinary write. It exists for the case a normal write can't produce: a
 * snapshot restored to a NEWER audit sitting next to a journal that still
 * carries older hosted scores. `loadCurrentQualitySection` merges those
 * latest-wins in lexical order, and this fold must not invert that merge on
 * every subsequent read. Comparing against the stored row rather than a
 * running value keeps two scored events for the same cell resolving
 * latest-wins in journal order exactly as before — each is checked against
 * the same stored floor, not against each other.
 */
export function foldQualityEvents(
  section: QualitySection | undefined,
  events: readonly JournalEvent[],
): QualitySection | undefined {
  if (section === undefined) return undefined;
  if (events.length === 0) return section;
  const findings = Array.isArray(section.findings) ? section.findings : [];
  const assessments = asArray<QualityAssessment>(section.assessments);

  // Ids are unique by contract — `validateBundle` warns on a collision — so
  // first-occurrence-wins below is only a tie-break for malformed data, not a
  // real ambiguity. Entries that are not an object with a string `id` are
  // skipped rather than dereferenced, matching the defensive-read idiom the
  // rest of this file uses for section content nobody has re-validated since
  // it left storage.
  const byId = new Map<string, number>();
  findings.forEach((finding, index) => {
    const id = (finding as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || id === "") return;
    if (!byId.has(id)) byId.set(id, index);
  });
  const patched = new Map<number, QualityFinding>();
  const current = (index: number) => patched.get(index) ?? findings[index];

  // `criterion_id::surface` -> the ARRAY INDEX of the LAST stored row at that
  // cell. Keyed by index rather than by the row itself so a re-score can be
  // spliced back into the exact position it came from, and a row this map
  // has no key for (unkeyable, or an earlier duplicate for a keyed cell)
  // never becomes a fold target.
  const cellIndex = new Map<string, number>();
  assessments.forEach((assessment, index) => {
    const criterionId = (assessment as { criterion_id?: unknown } | null)?.criterion_id;
    const surface = (assessment as { surface?: unknown } | null)?.surface;
    if (typeof criterionId !== "string" || typeof surface !== "string") return;
    cellIndex.set(`${criterionId}::${surface}`, index);
  });
  // index -> replacement, for a cell `cellIndex` already has a position for.
  const assessmentPatches = new Map<number, QualityAssessment>();
  // key -> row, for a cell the section never held at all — appended, never
  // spliced, since there is no stored position to replace.
  const newAssessments = new Map<string, QualityAssessment>();

  for (const event of events) {
    const type = event?.type;

    if (type === "quality.assessment.scored") {
      const criterionId = (event as { criterion_id?: unknown }).criterion_id;
      const surface = (event as { surface?: unknown }).surface;
      const auditId = (event as { audit_id?: unknown }).audit_id;
      const evidence = (event as { evidence?: unknown }).evidence;
      const level = (event as { level?: unknown }).level;
      const commit = (event as { commit?: unknown }).commit;
      const ts = (event as { ts?: unknown }).ts;
      if (
        typeof criterionId !== "string" ||
        criterionId === "" ||
        typeof surface !== "string" ||
        surface === "" ||
        typeof auditId !== "string" ||
        auditId === "" ||
        typeof evidence !== "string" ||
        typeof ts !== "string" ||
        ts === "" ||
        !Number.isInteger(level) ||
        (level as number) < 0 ||
        (level as number) > 4
      ) {
        continue;
      }

      const key = `${criterionId}::${surface}`;
      const index = cellIndex.get(key);
      // The restore guard — see the docblock above. Checked against
      // `assessments[index]`, the untouched stored row, never against
      // `assessmentPatches`, so a second scored event for the same cell in
      // this same walk is judged against the same floor as the first.
      if (index !== undefined) {
        const storedAuditId = (assessments[index] as { audit_id?: unknown } | null)?.audit_id;
        if (typeof storedAuditId === "string" && auditId < storedAuditId) continue;
      }

      const row: QualityAssessment = {
        criterion_id: criterionId,
        surface,
        level: level as MaturityLevel,
        evidence,
        audit_id: auditId,
        ts,
        ...(typeof commit === "string" ? { commit } : {}),
      };
      if (index !== undefined) assessmentPatches.set(index, row);
      else newAssessments.set(key, row);
      continue;
    }

    if (type !== "quality.finding.resolved" && type !== "quality.finding.accepted") continue;
    const findingId = (event as { finding_id?: unknown }).finding_id;
    if (typeof findingId !== "string" || findingId === "") continue;
    const index = byId.get(findingId);
    if (index === undefined) continue;
    const finding = current(index);

    if (type === "quality.finding.resolved") {
      const by = (event as { resolved_by?: unknown }).resolved_by;
      const named = typeof by === "string" && by !== "" ? by : undefined;
      if (isOpenFinding(finding)) {
        patched.set(index, {
          ...finding,
          status: "resolved" as QualityFinding["status"],
          ...(named !== undefined ? { resolved_by: named } : {}),
        });
      } else if (finding.status === "resolved" && named !== undefined && patched.has(index)) {
        patched.set(index, { ...finding, resolved_by: named });
      }
      continue;
    }

    // quality.finding.accepted
    if (!isOpenFinding(finding)) continue;
    const reason = (event as { reason?: unknown }).reason;
    const note = typeof reason === "string" ? reason : "";
    patched.set(index, {
      ...finding,
      status: "accepted-risk" as QualityFinding["status"],
      detail: acceptedDetail(finding.detail, note),
    });
  }

  if (patched.size === 0 && assessmentPatches.size === 0 && newAssessments.size === 0) return section;
  return {
    ...section,
    ...(patched.size > 0
      ? { findings: findings.map((finding, index) => patched.get(index) ?? finding) }
      : {}),
    ...(assessmentPatches.size > 0 || newAssessments.size > 0
      ? {
          assessments: [
            ...assessments.map((assessment, index) => assessmentPatches.get(index) ?? assessment),
            ...newAssessments.values(),
          ],
        }
      : {}),
  };
}

/** What the Relations bar says about a node's open findings. */
export interface OpenFindingSummary {
  severity: FindingSeverity;
  count: number;
}

/**
 * The worst open finding against one node, and how many there are.
 *
 * This is what lets the Relations group's bar carry a severity chip, which is
 * what stops the move into a collapsible group from costing findings their
 * urgency: the panel used to put them high on the argument that an open critical
 * finding is the most pressing thing it can tell a reader, and the chip is that
 * argument surviving the reorganisation. The bar shows it whether the group is
 * open or shut.
 *
 * Open only, and `nodeIds` rather than a single id, matching `FindingsSection`
 * and the canvas badge exactly — all three ask the same two questions, so a node
 * wearing a red "3" opens onto a bar reading "3" and onto three rows.
 *
 * `null`, not a zero-count summary: "no open findings" is the absence of a
 * chip, and a caller handed `{ count: 0 }` would have to know to suppress it.
 *
 * Severity order comes from `SEVERITY_ORDER` — the rank table this file already
 * builds from `FINDING_SEVERITIES`, the schema package's own worst-first
 * ordering — for the reason nothing in this file reimplements a scale: a second
 * ranking here would disagree with the board the first time a pack moved a
 * bucket. The table rather than `indexOf` over the same array, which is the
 * comparison the board's own sort makes: a lookup instead of a scan per row,
 * and no `-1` for a severity the array does not hold — which `indexOf` would
 * have ranked *above* critical.
 */
export function worstOpenFindingFor(
  rows: readonly FindingRow[],
  nodeId: string,
): OpenFindingSummary | null {
  const own = rows.filter((row) => row.open && row.nodeIds.includes(nodeId));
  if (own.length === 0) return null;

  let worst = own[0].severity;
  for (const row of own) {
    if (SEVERITY_ORDER[row.severity] < SEVERITY_ORDER[worst]) {
      worst = row.severity;
    }
  }

  return { severity: worst, count: own.length };
}

// --- The findings burndown (issue #441) ---------------------------------------

/** What the burndown is narrowed to: the filter bar's surface and domain, or its cell. */
export interface BurndownFilter {
  surface?: string;
  domain?: string;
}

/**
 * The part of the board's filter set the burndown can honour.
 *
 * Surface and domain only — plus the cell, which is exactly one of each. The
 * other filters narrow *which rows are shown*, and the burndown is a count of
 * open findings over time: a search box has no history, and "status: resolved"
 * over a line of open counts would be a contradiction. A cell wins over the
 * separate menus, as it is the narrower of the two.
 */
export function burndownFilterOf(filters: Pick<QualityFilters, "surface" | "domain" | "cell">): BurndownFilter {
  const cell = parseCellKey(filters.cell);
  const surface = cell?.surface ?? (narrows(filters.surface) ? filters.surface : undefined);
  const domain = cell?.domain ?? (narrows(filters.domain) ? filters.domain : undefined);
  return { ...(surface !== undefined ? { surface } : {}), ...(domain !== undefined ? { domain } : {}) };
}

/**
 * The live open count a burndown line closes on — from the rows, never from
 * the burndown's last point. The replay is what the journal says happened;
 * the rows are what the section says *is*, and the headline's "180 open" is
 * the latter, the same number the cards' own "180 open" reads.
 */
export function countOpenFindings(rows: readonly FindingRow[], filter: BurndownFilter = {}): number {
  return rows.filter(
    (row) =>
      row.open &&
      (filter.surface === undefined || row.surface === filter.surface) &&
      (filter.domain === undefined || row.domain === filter.domain),
  ).length;
}

/**
 * The one-sentence answer to "did anything happen": `20 closed since the
 * 2026-08 audit · 180 open`. Closed counts both kinds of close — a fix and an
 * accepted risk each take a finding off the line — and {@link describeBurndownDetail}
 * says which was which.
 *
 * `null` when the journal holds nothing to replay at all: a project whose
 * findings arrived without a single event has no history to report, and a
 * sentence saying "nothing closed" would be claiming one.
 */
export function describeClosedSince(burndown: FindingsBurndown, openNow: number): string | null {
  if (burndown.points.length === 0) return null;
  const since = burndown.since;
  const closed = since ? since.resolved + since.accepted : burndown.resolved + burndown.accepted;
  const where = since ? ` since the ${since.audit_id} audit` : "";
  const lead = closed === 0 ? `Nothing closed${where}` : `${closed} closed${where}`;
  return `${lead} · ${openNow} open`;
}

/** The closed-since line's breakdown, for its `title`: which closes were fixes, which were accepted risks, and what opened. */
export function describeBurndownDetail(burndown: FindingsBurndown): string | null {
  if (burndown.points.length === 0) return null;
  const tally = burndown.since ?? burndown;
  const parts = [
    `${tally.resolved} resolved`,
    `${tally.accepted} accepted as ${tally.accepted === 1 ? "a risk" : "risks"}`,
    `${tally.opened} opened`,
  ];
  return `${parts.join(", ")} ${burndown.since ? `since the ${burndown.since.audit_id} audit` : "so far"}`;
}

/** The severities the chart stacks, worst at the baseline — `info` is a note, not a defect, as on the cells' dots. */
export const BURNDOWN_SEVERITIES: readonly FindingSeverity[] = FINDING_SEVERITIES.filter((severity) => severity !== "info");

export interface BurndownGeometry {
  /** One stacked step-area per severity, worst first (the bottom band). */
  bands: { severity: FindingSeverity; path: string }[];
  /** The total, as a step line — what the sparkline draws. */
  line: string;
  /** The x of every audit, for the ticks. */
  ticks: number[];
  /** The x each point starts at, in point order — the hover's lookup table. */
  xs: number[];
  /** The tallest stack, which the y axis is scaled to (at least 1). */
  max: number;
}

/** How much of the width the newest reading holds on to, so the last step is visible at all. */
const LAST_STEP = 0.06;

/**
 * The chart's shapes, in a `width × height` box with the origin top-left.
 *
 * **Steps, not slopes.** A count of open findings does not drift between two
 * events, it jumps — so each reading holds until the next one, and the last
 * holds for a short stub at the right edge. A sloped line would claim half a
 * finding was open halfway between two closes.
 *
 * **The bands start at zero; the line may not.** An area's size is its
 * value, so the stacked bands always stand on the baseline. The line alone
 * can be fitted to its own range (`fitLine`) — the sparkline's case, where
 * 53 → 48 on a zero-based axis is a flat line and says nothing. Its
 * accessible name carries the real numbers either way.
 *
 * **Time on x.** Spacing by event index would draw a week of silence and a
 * minute of batch-closing as the same distance. If any timestamp does not
 * parse, the points fall back to even spacing rather than collapsing.
 */
export function burndownGeometry(
  points: readonly BurndownPoint[],
  width: number,
  height: number,
  options: { severities?: readonly FindingSeverity[]; fitLine?: boolean } = {},
): BurndownGeometry {
  const severities = options.severities ?? BURNDOWN_SEVERITIES;
  if (points.length === 0) return { bands: [], line: "", ticks: [], xs: [], max: 1 };

  const times = points.map((point) => Date.parse(point.ts));
  const first = times[0];
  const last = times[times.length - 1];
  const timed = times.every(Number.isFinite) && last > first;
  const span = points.length === 1 ? width : width * (1 - LAST_STEP);
  const xs = points.map((_, index) =>
    points.length === 1 ? 0 : timed ? ((times[index] - first) / (last - first)) * span : (index / (points.length - 1)) * span,
  );
  const ends = xs.map((_, index) => (index + 1 < xs.length ? xs[index + 1] : width));

  const totals = points.map((point) => severities.reduce((sum, severity) => sum + (point.open[severity] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const y = (value: number) => height - (value / max) * height;
  const fmt = (value: number) => Number(value.toFixed(2));

  const bands: BurndownGeometry["bands"] = [];
  const below = points.map(() => 0);
  for (const severity of severities) {
    const top: string[] = [];
    const bottom: string[] = [];
    points.forEach((point, index) => {
      const lower = below[index];
      const upper = lower + (point.open[severity] ?? 0);
      top.push(`${fmt(xs[index])},${fmt(y(upper))}`, `${fmt(ends[index])},${fmt(y(upper))}`);
      bottom.unshift(`${fmt(ends[index])},${fmt(y(lower))}`, `${fmt(xs[index])},${fmt(y(lower))}`);
      below[index] = upper;
    });
    bands.push({ severity, path: `M${[...top, ...bottom].join("L")}Z` });
  }

  const low = Math.min(...totals);
  const high = Math.max(...totals);
  const lineY = !options.fitLine
    ? y
    : (value: number) => (high === low ? height / 2 : height - ((value - low) / (high - low)) * height);
  const line = totals
    .map((total, index) => `${index === 0 ? "M" : "L"}${fmt(xs[index])},${fmt(lineY(total))}L${fmt(ends[index])},${fmt(lineY(total))}`)
    .join("");

  const ticks = points.flatMap((point, index) => (point.cause.type === "audit" ? [fmt(xs[index])] : []));

  return { bands, line, ticks, xs: xs.map(fmt), max };
}

/** The point whose step covers `x` — the newest one starting at or before it. */
export function burndownPointAt(xs: readonly number[], x: number): number {
  let found = 0;
  for (let index = 0; index < xs.length; index++) {
    if (xs[index] <= x) found = index;
    else break;
  }
  return found;
}

/**
 * One burndown per surface, for the Overall cards. The same projection the
 * page-level one runs, narrowed, so a surface card and the Findings page with
 * that surface picked can never disagree.
 */
export function buildSurfaceBurndowns(
  events: readonly JournalEvent[],
  surfaces: readonly string[],
  options: { findings?: readonly QualityFinding[]; library?: KritikLibrary } = {},
): Map<string, FindingsBurndown> {
  return new Map(surfaces.map((surface) => [surface, deriveFindingsBurndown(events, { ...options, surface })]));
}


/**
 * The chart in words, for its accessible name: where the line started, where
 * it stands, and how many audits it crosses — "Open findings: 246 on
 * 2026-08-26, 244 on 2026-09-03 — 1 audit recorded". The picture's whole
 * claim, so a reader who cannot see it is told the same thing.
 */
export function describeBurndownTrend(
  burndown: Pick<FindingsBurndown, "points">,
  severities: readonly FindingSeverity[] = BURNDOWN_SEVERITIES,
): string {
  const { points } = burndown;
  if (points.length === 0) return "Open findings: no history recorded";
  const total = (point: BurndownPoint) => severities.reduce((sum, severity) => sum + (point.open[severity] ?? 0), 0);
  const day = (point: BurndownPoint) => (point.ts === "" ? "an unknown date" : point.ts.slice(0, 10));
  const first = points[0];
  const last = points[points.length - 1];
  const audits = points.filter((point) => point.cause.type === "audit").length;
  const span =
    points.length === 1 ? `${total(first)} on ${day(first)}` : `${total(first)} on ${day(first)}, ${total(last)} on ${day(last)}`;
  return `Open findings: ${span} — ${audits === 0 ? "no audit" : audits === 1 ? "1 audit" : `${audits} audits`} recorded`;
}

/** What moved the line at one point, in words, for the hover. */
export function describeBurndownCause(point: Pick<BurndownPoint, "cause">): string {
  const { type, id } = point.cause;
  if (type === "audit") return `${id} audit recorded`;
  if (type === "accepted") return `${id} accepted as a risk`;
  return `${id} ${type}`;
}
