/**
 * The scoped re-audit's work list: which (criterion × surface) cells a batch of
 * fixes made stale (issue #443).
 *
 * A score is an assessment, and only a re-score moves it (SPEC § 6: "improvements
 * land, then the score moves"). Closing twenty findings therefore leaves the
 * matrix exactly where it was until somebody re-scores the cells those fixes
 * touched — and until now the only way to do that was a comprehensive audit.
 * The storage half of a partial re-audit already works: `loadCurrentQualitySection`
 * merges assessments latest-wins per cell across every audit on disk, so an
 * audit directory holding twelve assessments moves those twelve cells and
 * leaves the rest alone. What was missing is upstream of it: nothing told the
 * auditor *which* twelve. This module is that.
 *
 * The scope is **finding-driven and exact**: every `quality.finding.resolved`
 * recorded after the audit it is measured from names a finding, the finding
 * names its cell, and that cell is stale. One widening hop over `node_ids` adds
 * the neighbours a fix in a shared view plausibly moved — the auditor can say
 * "unchanged" in two seconds, but has to be pointed there to say it.
 *
 * Same two disciplines as `quality-regressions.ts` and `quality-trend.ts`:
 * zod-free and fs-free (the runtime imports are `orderEvents` and a constant),
 * and nothing mutates its input. Lenient and total: no events, no recorded
 * audit, no findings — each is an empty scope, never a throw. A scope is a
 * plan; refusing to produce one would only send the auditor back to the
 * comprehensive audit this exists to spare them.
 */

import { orderEvents, type JournalEvent } from "./journal";
import {
  CROSS_SURFACE_ID,
  type KritikCriterion,
  type KritikLibrary,
  type MaturityLevel,
  type QualityAssessment,
  type QualityFinding,
  type QualitySection,
} from "./quality";

/**
 * One cell to re-score.
 *
 * `because` is what put it here, and its meaning follows `kind`: the resolved
 * finding ids for a `direct` cell, the shared node ids for a `widened` one. The
 * two are kept apart because they ask different things of the auditor — a
 * direct cell almost certainly moved, a widened one is a two-second "did it?".
 */
export interface ScopeCell {
  criterion_id: string;
  surface: string;
  kind: "direct" | "widened";
  because: string[];
  /** The score a re-score would replace, when the cell has one. */
  current?: { level: MaturityLevel; audit_id: string };
}

export interface AuditScope {
  /**
   * The audit the scope is measured from — `null` when no audit has been
   * recorded, which is an empty scope rather than "everything since the start":
   * with no recorded reading there is nothing for a re-score to be a re-score of.
   */
  since: string | null;
  /** When that audit was recorded; `null` whenever `since` names no recorded audit. */
  since_ts: string | null;
  /** Sorted by surface (the profile's order), then criterion id. */
  cells: ScopeCell[];
  /** The resolved finding ids that drove it, in resolution order. */
  findings: string[];
  /** The PR or commit URL each driving finding was resolved by, where one was named. */
  resolved_by: Record<string, string>;
  /**
   * Resolved ids that name no finding in the section. Reported, never dropped:
   * this is the mis-closure family issue #440 describes (a PR body closing an id
   * that does not exist), and the scope is where it will be noticed.
   */
  unknown: string[];
  /**
   * Resolved findings whose cell nothing can re-score: a retired criterion, a
   * surface the profile no longer declares, or a criterion that does not apply
   * there. `score` refuses every one of those, so listing them as cells would
   * be a work item nobody can close — and dropping them silently would hide
   * that the fix happened. They come back here instead.
   */
  unscorable: string[];
  /** How many of `cells` the node-neighbour hop added. */
  widened: number;
}

export interface AuditScopeOptions {
  /** The audit to measure from. Default: the newest `quality.audit.completed`. */
  since?: string;
  /** Add the one-hop node neighbours. Default: on. */
  widen?: boolean;
}

const rowsOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

const stringsOf = (value: unknown): string[] => rowsOf<unknown>(value).filter(isString);

/** Same `criterion::surface` key `quality-regressions.ts` uses, for the same reasons. */
const cellKey = (criterionId: string, surface: string): string => `${criterionId}::${surface}`;

/**
 * Every audit id the journal has a `quality.audit.completed` for, in recording
 * order, each once. What a caller names in the refusal when `since` asks for an
 * audit that was never recorded.
 */
export function recordedAuditIds(events: readonly JournalEvent[]): string[] {
  const ids: string[] = [];
  for (const event of orderEvents(rowsOf<JournalEvent>(events))) {
    if (event?.type !== "quality.audit.completed") continue;
    const id = (event as { audit_id?: unknown }).audit_id;
    if (isString(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The cells a batch of fixes made stale since an audit.
 *
 * - **The window.** Every `quality.finding.resolved` ordered (by `orderEvents`)
 *   after the `since` audit's recording. A re-recorded audit id is measured
 *   from its latest recording, the reading the trend keeps too.
 * - **Direct cells.** Each resolved finding's own `(criterion_id, surface)`,
 *   read from `section.findings` — the event does not carry them — when
 *   `score` could re-score it; a finding whose cell it could not (a retired
 *   criterion, an undeclared surface) is reported in `unscorable`. A
 *   `cross-surface` finding scopes every surface its criterion applies to: the
 *   contract lens has no column of its own, so the fix lands in the columns
 *   either side of it.
 * - **Accepted and refuted are out.** An accepted risk is a decision, not a
 *   fix, and the code did not change; the same goes for a refutation. Neither
 *   writes a `resolved` event in a repository, and a finding whose section
 *   status is one of them despite one (the fold's first-decision-wins rule) is
 *   read the way the findings board reads it.
 * - **Widening** (default on) is one hop over `node_ids`: any *assessed* cell
 *   whose criterion applies to its surface, and whose findings share a node id
 *   with a resolved finding, joins with `because: [node ids]`. One hop only — a
 *   second would pull the whole graph in, and a scope that says "everything"
 *   is the comprehensive audit again.
 */
export function deriveAuditScope(
  events: readonly JournalEvent[],
  section: Pick<QualitySection, "findings" | "assessments"> & Partial<Pick<QualitySection, "profile">>,
  library: Pick<KritikLibrary, "criteria">,
  options: AuditScopeOptions = {},
): AuditScope {
  const ordered = orderEvents(rowsOf<JournalEvent>(events).filter((event) => typeof event === "object" && event !== null));

  let sinceIndex = -1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const event = ordered[i];
    if (event.type !== "quality.audit.completed") continue;
    const id = (event as { audit_id?: unknown }).audit_id;
    if (options.since !== undefined && id !== options.since) continue;
    sinceIndex = i;
    break;
  }

  const empty: AuditScope = {
    since: options.since ?? null,
    since_ts: null,
    cells: [],
    findings: [],
    resolved_by: {},
    unknown: [],
    unscorable: [],
    widened: 0,
  };
  if (sinceIndex === -1) return empty;

  const anchor = ordered[sinceIndex];
  const anchorId = (anchor as { audit_id?: unknown }).audit_id;
  const since = isString(anchorId) ? anchorId : null;
  const sinceTs = isString(anchor.ts) ? anchor.ts : null;

  // Resolutions in order, one entry per finding. A later NAMED `resolved_by`
  // wins over an earlier one — the rule `foldFindingEvents` applies, so the
  // run sheet and the findings board name the same PR.
  const resolutions = new Map<string, { resolved_by?: string; node_ids: Set<string> }>();
  for (const event of ordered.slice(sinceIndex + 1)) {
    if (event.type !== "quality.finding.resolved") continue;
    const findingId = (event as { finding_id?: unknown }).finding_id;
    if (!isString(findingId)) continue;
    const entry = resolutions.get(findingId) ?? { node_ids: new Set<string>() };
    const by = (event as { resolved_by?: unknown }).resolved_by;
    if (isString(by)) entry.resolved_by = by;
    for (const node of stringsOf((event as { node_ids?: unknown }).node_ids)) entry.node_ids.add(node);
    resolutions.set(findingId, entry);
  }
  if (resolutions.size === 0) return { ...empty, since, since_ts: sinceTs };

  const findings = rowsOf<QualityFinding>(section?.findings).filter(
    (finding) => isString(finding?.id) && isString(finding?.criterion_id) && isString(finding?.surface),
  );
  // Last occurrence wins: the merged section pools findings oldest audit first,
  // so if an id was ever reused across runs, the live one is the later row —
  // the same tie-break `locateFinding` makes by walking newest first.
  const findingById = new Map<string, QualityFinding>();
  for (const finding of findings) findingById.set(finding.id, finding);

  const criterionById = new Map<string, KritikCriterion>();
  for (const criterion of rowsOf<KritikCriterion>(library?.criteria)) {
    if (isString(criterion?.id)) criterionById.set(criterion.id, criterion);
  }

  // Latest per cell, the way `QualitySection.assessments` is documented —
  // re-keyed here anyway, because a hand-edited section is not a promise.
  const assessmentByCell = new Map<string, QualityAssessment>();
  for (const assessment of rowsOf<QualityAssessment>(section?.assessments)) {
    if (!isString(assessment?.criterion_id) || !isString(assessment?.surface)) continue;
    assessmentByCell.set(cellKey(assessment.criterion_id, assessment.surface), assessment);
  }

  // The columns a re-score can land in: the profile's, else (a section with no
  // profile) the surfaces its assessments name.
  const declared = rowsOf<{ id?: unknown }>(section?.profile?.surfaces)
    .map((surface) => surface?.id)
    .filter((id): id is string => isString(id) && id !== CROSS_SURFACE_ID);
  const surfaces =
    declared.length > 0
      ? [...new Set(declared)]
      : [...new Set([...assessmentByCell.values()].map((assessment) => assessment.surface))]
          .filter((id) => id !== CROSS_SURFACE_ID)
          .sort();

  const appliesTo = (criterion: KritikCriterion | undefined, surface: string): boolean =>
    criterion === undefined || !Array.isArray(criterion.applies_to) || criterion.applies_to.includes(surface);

  // Whether `score` would accept this cell — the same three refusals it makes.
  // An unknown criterion stays lenient: a hosted section with no embedded pack
  // synthesizes one with nothing but ids, and refusing every cell there would
  // blank the scope for a missing vocabulary rather than a real reason.
  const scorable = (criterionId: string, surface: string): boolean => {
    const criterion = criterionById.get(criterionId);
    if (criterion !== undefined && isString(criterion.superseded_by)) return false;
    if (declared.length > 0 && !surfaces.includes(surface)) return false;
    return appliesTo(criterion, surface);
  };

  const cells = new Map<string, ScopeCell>();
  const addDirect = (criterionId: string, surface: string, findingId: string) => {
    const key = cellKey(criterionId, surface);
    const existing = cells.get(key);
    if (existing === undefined) cells.set(key, { criterion_id: criterionId, surface, kind: "direct", because: [findingId] });
    else if (!existing.because.includes(findingId)) existing.because.push(findingId);
  };

  const drivers: string[] = [];
  const unknown: string[] = [];
  const unscorable: string[] = [];
  const resolvedBy: Record<string, string> = {};
  const resolvedNodes = new Set<string>();

  for (const [findingId, resolution] of resolutions) {
    const finding = findingById.get(findingId);
    if (finding === undefined) {
      unknown.push(findingId);
      continue;
    }
    if (finding.status === "accepted-risk" || finding.status === "refuted") continue;

    // A contract finding lands in every column its criterion reaches. An
    // unknown criterion reads as applying everywhere, as `applicableCells`
    // reads a custom criterion that forgot its `applies_to`.
    const targets = (finding.surface === CROSS_SURFACE_ID ? surfaces : [finding.surface]).filter((surface) =>
      scorable(finding.criterion_id, surface),
    );
    // The fix still happened, and still touched its nodes — so it widens even
    // when its own cell is one nothing can re-score.
    for (const node of stringsOf(finding.node_ids)) resolvedNodes.add(node);
    for (const node of resolution.node_ids) resolvedNodes.add(node);
    if (targets.length === 0) {
      unscorable.push(findingId);
      continue;
    }

    drivers.push(findingId);
    if (resolution.resolved_by !== undefined) resolvedBy[findingId] = resolution.resolved_by;
    for (const surface of targets) addDirect(finding.criterion_id, surface, findingId);
  }

  let widened = 0;
  if (options.widen !== false && resolvedNodes.size > 0) {
    // The node ids each cell's findings carry. A contract finding belongs to
    // every column its criterion reaches, so it counts toward each of them —
    // the same reading the direct fan-out above gives it.
    const nodesByCell = new Map<string, Set<string>>();
    const noteNodes = (criterionId: string, surface: string, nodes: readonly string[]) => {
      const key = cellKey(criterionId, surface);
      const bucket = nodesByCell.get(key) ?? new Set<string>();
      for (const node of nodes) bucket.add(node);
      nodesByCell.set(key, bucket);
    };
    for (const finding of findings) {
      const nodes = stringsOf(finding.node_ids);
      if (nodes.length === 0) continue;
      if (finding.surface === CROSS_SURFACE_ID) {
        for (const surface of surfaces) noteNodes(finding.criterion_id, surface, nodes);
      } else {
        noteNodes(finding.criterion_id, finding.surface, nodes);
      }
    }

    for (const [key, assessment] of assessmentByCell) {
      if (cells.has(key)) continue;
      // Only cells an auditor can actually re-score (see `scorable`), and —
      // stricter than a direct cell — only criteria the pack actually names:
      // a guess is fair for a cell a fix certainly touched, not for one it
      // merely might have.
      if (!criterionById.has(assessment.criterion_id)) continue;
      if (!surfaces.includes(assessment.surface) || !scorable(assessment.criterion_id, assessment.surface)) continue;
      const shared = [...(nodesByCell.get(key) ?? [])].filter((node) => resolvedNodes.has(node)).sort();
      if (shared.length === 0) continue;
      cells.set(key, { criterion_id: assessment.criterion_id, surface: assessment.surface, kind: "widened", because: shared });
      widened++;
    }
  }

  for (const [key, cell] of cells) {
    const assessment = assessmentByCell.get(key);
    if (assessment !== undefined && typeof assessment.level === "number" && isString(assessment.audit_id)) {
      cell.current = { level: assessment.level, audit_id: assessment.audit_id };
    }
  }

  const column = (surface: string): number => {
    const at = surfaces.indexOf(surface);
    return at === -1 ? surfaces.length : at;
  };
  const sorted = [...cells.values()].sort(
    (a, b) =>
      column(a.surface) - column(b.surface) ||
      (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0) ||
      (a.criterion_id < b.criterion_id ? -1 : a.criterion_id > b.criterion_id ? 1 : 0),
  );

  return { since, since_ts: sinceTs, cells: sorted, findings: drivers, resolved_by: resolvedBy, unknown, unscorable, widened };
}

/**
 * The pure naming core of a scoped re-audit's target id (issue #473).
 *
 * Repo mode and the hosted server agree on one meaning for "which audit does
 * this score land in" and disagree only on where the inputs come from: a repo
 * checkout's `scopedAuditTarget` (`cli/kritik-audit.ts`) reads `known` off
 * disk with `listAuditIds` and finds `open` by checking the newest directory's
 * `scores.json`; the hosted server reads both from the restored section and
 * journal instead. Neither touches fs from here, so this is what actually
 * decides, and the fs-based caller is a thin adapter over it.
 */
export interface ScopedAuditIdInput {
  /** The recorded audit the scope is measured from. */
  since: string;
  /** `YYYY-MM`, the month a new scoped audit is named for. */
  month: string;
  requested?: string;
  /** Every audit id that exists: on disk in a repo, in the section and journal when hosted. */
  known: readonly string[];
  recorded: readonly string[];
  /** A scoped audit in progress from the same `since`, not yet recorded — continued rather than forked. */
  open?: string;
}

/**
 * The audit id a scoped re-score writes into, or a refusal saying why none
 * fits.
 *
 * A scoped re-audit is its own audit, never the one it was scoped from: that
 * audit's recorded reading is history, and re-scoring inside it would rewrite
 * what the journal says was measured — the same is true of any OTHER recorded
 * audit, which is just as much history. And it must sort **after every known
 * audit id**, because the merge is latest-wins in lexical id order — a scoped
 * audit that sorts earlier has its fresh scores silently outvoted by the stale
 * ones it was meant to replace.
 *
 * Unrequested, it continues the scoped audit already in progress (`open`,
 * when the caller found one), else opens `<month>-scoped`, then
 * `<month>-scoped-02` and on, the convention SPEC § 6 names.
 */
export function scopedAuditId(input: ScopedAuditIdInput): string {
  const { since, month, requested, known, recorded, open } = input;
  const newest = known[known.length - 1];

  if (requested !== undefined) {
    if (requested === since) {
      throw new Error(
        `"${requested}" is the audit this scope is measured from — its recorded reading is history. ` +
          `Name a new audit (e.g. \`${month}-scoped\`); every other cell keeps its score through the merge.`,
      );
    }
    if (recorded.includes(requested)) {
      throw new Error(`"${requested}" is already recorded — its reading is history. Name a new audit.`);
    }
    if (newest !== undefined && requested < newest) {
      throw new Error(
        `"${requested}" sorts before "${newest}", and audits merge latest-wins in lexical order — ` +
          `its scores would be outvoted by the older ones they replace. Name one that sorts last (e.g. \`${month}-scoped\`).`,
      );
    }
    return requested;
  }

  if (open !== undefined) return open;

  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? `${month}-scoped` : `${month}-scoped-${String(n).padStart(2, "0")}`;
    if (known.includes(candidate)) continue;
    if (newest !== undefined && candidate < newest) {
      throw new Error(
        `"${candidate}" would sort before "${newest}", so its scores would lose the latest-wins merge. ` +
          `Name the scoped audit yourself, one that sorts after "${newest}".`,
      );
    }
    return candidate;
  }
  throw new Error(`99 scoped audits in ${month} — name the next one yourself.`);
}

/**
 * The one-line total a run sheet ends on — built here so the CLI and the MCP
 * tool cannot word the same scope two ways.
 */
export function scopeSummary(scope: AuditScope): string {
  const direct = scope.cells.length - scope.widened;
  const cells = `${scope.cells.length} cell${scope.cells.length === 1 ? "" : "s"} to re-score`;
  const split = scope.widened > 0 ? ` (${direct} direct, ${scope.widened} widened)` : "";
  const from = `${scope.findings.length} resolved finding${scope.findings.length === 1 ? "" : "s"}`;
  return `${cells}${split} from ${from}${scope.since !== null ? ` since ${scope.since}` : ""}`;
}
