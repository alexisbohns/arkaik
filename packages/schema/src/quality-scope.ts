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
 * **A plan record closes the window per cell** (the Kritik planner, spec "The
 * window closes per cell"). A `quality.audit.completed` whose `scope` names a
 * plan re-scored a known list of cells and nothing else, so it is never the
 * audit a scope is measured from, and it clears only the cells it lists.
 *
 * Same two disciplines as `quality-regressions.ts` and `quality-trend.ts`:
 * zod-free and fs-free (the runtime imports are `orderEvents`, a constant and
 * `quality-plan.ts`'s pure readers), and nothing mutates its input. Lenient and
 * total: no events, no recorded audit, no findings — each is an empty scope,
 * never a throw. A scope is a plan; refusing to produce one would only send the
 * auditor back to the comprehensive audit this exists to spare them.
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
import { isPlanId, isPlanPartId, readPlanScope } from "./quality-plan";

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
   * Never a plan record: a project whose only records are plans has none.
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
  /**
   * The audit to measure from. Default: the newest `quality.audit.completed`
   * that is not a plan record. A plan id or a part id names no anchor, so it
   * gives an empty scope whose `since` is `null`.
   */
  since?: string;
  /** Add the one-hop node neighbours. Default: on. */
  widen?: boolean;
}

const rowsOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

const stringsOf = (value: unknown): string[] => rowsOf<unknown>(value).filter(isString);

/** Same `criterion::surface` key `quality-regressions.ts` uses, for the same reasons. */
const cellKey = (criterionId: string, surface: string): string => `${criterionId}::${surface}`;

/** The journal's object rows in `orderEvents` order — the one order every reader here uses. */
const orderedRows = (events: readonly JournalEvent[] | null | undefined): JournalEvent[] =>
  orderEvents(rowsOf<JournalEvent>(events).filter((event) => typeof event === "object" && event !== null));

/**
 * Whether `event` is a plan record: a `quality.audit.completed` whose `scope`
 * names a plan (`matrix <planId> --record --plan`), or whose `audit_id` is a
 * plan id. The second reading catches a damaged record — `scope.plan` missing
 * or not a string — which would otherwise pass for a full audit, become the
 * anchor and clear every stale cell; it is read as a plan with no parts and no
 * scored cells. Lenient: anything else, malformed rows included, is not one.
 */
export function isPlanRecord(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const { type, scope, audit_id: auditId } = event as { type?: unknown; scope?: unknown; audit_id?: unknown };
  return type === "quality.audit.completed" && (readPlanScope(scope) !== null || isPlanId(auditId));
}

/** One recorded plan, as its event carries it. */
export interface RecordedPlan {
  plan: string;
  /** The plan's part ids, plan order. */
  parts: string[];
  /** `criterion::surface` per cell the plan re-scored. */
  scored: string[];
  /** When it was recorded; `null` for a row with no `ts`. */
  ts: string | null;
}

/**
 * Every plan record in the journal, in journal order, one entry per record. A
 * damaged one (see {@link isPlanRecord}) is listed under its `audit_id`, with
 * no parts and no scored cells: nothing it carries can be trusted to say which.
 */
export function recordedPlans(events: readonly JournalEvent[]): RecordedPlan[] {
  const plans: RecordedPlan[] = [];
  for (const event of orderedRows(events)) {
    if (!isPlanRecord(event)) continue;
    const reading = readPlanScope((event as { scope?: unknown }).scope);
    const ts = isString(event.ts) ? event.ts : null;
    if (reading === null) plans.push({ plan: (event as { audit_id?: unknown }).audit_id as string, parts: [], scored: [], ts });
    else plans.push({ plan: reading.plan, parts: stringsOf(reading.parts), scored: stringsOf(reading.scored), ts });
  }
  return plans;
}

/**
 * Every audit id the journal has a `quality.audit.completed` for, in recording
 * order, each once. What a caller names in the refusal when `since` asks for an
 * audit that was never recorded.
 *
 * A plan record's parts follow its plan id: each part is an audit directory
 * whose reading the plan recorded, so a score written into one after the
 * record would silently rewrite history — every guard that asks "is this id
 * recorded?" has to see them.
 */
export function recordedAuditIds(events: readonly JournalEvent[]): string[] {
  const ids: string[] = [];
  const note = (id: unknown) => {
    if (isString(id) && !ids.includes(id)) ids.push(id);
  };
  for (const event of orderedRows(events)) {
    if (event.type !== "quality.audit.completed") continue;
    note((event as { audit_id?: unknown }).audit_id);
    for (const part of readPlanScope((event as { scope?: unknown }).scope)?.parts ?? []) note(part);
  }
  return ids;
}

/**
 * {@link recordedAuditIds} over the records a scope can be measured from: every
 * one but a plan record, so neither a plan id nor a part id is ever offered as
 * a `since`.
 */
export function recordedSinceIds(events: readonly JournalEvent[]): string[] {
  return recordedAuditIds(rowsOf<JournalEvent>(events).filter((event) => !isPlanRecord(event)));
}

/**
 * The index in `ordered` of the record a scope is measured from: the newest
 * `quality.audit.completed` that is not a plan record (rule 1), or the newest
 * recording of `since` when one is named. `-1` when there is none — and a
 * `since` naming a plan or a part never matches, because no non-plan record
 * carries that id.
 */
function anchorIndex(ordered: readonly JournalEvent[], since: string | undefined): number {
  for (let i = ordered.length - 1; i >= 0; i--) {
    const event = ordered[i];
    if (event.type !== "quality.audit.completed" || isPlanRecord(event)) continue;
    if (since !== undefined && (event as { audit_id?: unknown }).audit_id !== since) continue;
    return i;
  }
  return -1;
}

/**
 * Whether `id` names a plan or one of its parts: by its shape, or because a
 * plan record in `ordered` carries it as its `audit_id`, its `scope.plan` or
 * one of its `parts`. Such an id is never a scope's `since`.
 */
function namesPlan(ordered: readonly JournalEvent[], id: string): boolean {
  if (isPlanId(id) || isPlanPartId(id)) return true;
  return ordered.some((event) => {
    if (!isPlanRecord(event)) return false;
    if ((event as { audit_id?: unknown }).audit_id === id) return true;
    const reading = readPlanScope((event as { scope?: unknown }).scope);
    return reading !== null && (reading.plan === id || reading.parts.includes(id));
  });
}

/**
 * The audit id of the newest record that is not a plan record — the `since` an
 * unscoped {@link deriveAuditScope} measures from, and the `since` a plan
 * record carries. `null` when there is none, or when that record names no id.
 */
export function scopeAnchorId(events: readonly JournalEvent[]): string | null {
  const ordered = orderedRows(events);
  const at = anchorIndex(ordered, undefined);
  if (at === -1) return null;
  const id = (ordered[at] as { audit_id?: unknown }).audit_id;
  return isString(id) ? id : null;
}

/**
 * The cells a batch of fixes made stale since an audit.
 *
 * - **The window.** Every `quality.finding.resolved` ordered (by `orderEvents`)
 *   after the `since` audit's recording. A re-recorded audit id is measured
 *   from its latest recording, the reading the trend keeps too. `since`
 *   defaults to the newest recording that is not a plan record; a plan record
 *   is never the audit a scope is measured from.
 * - **Per cell, after a plan.** The last plan record whose `scored` lists a
 *   cell sets that cell's floor, and a resolution counts toward the cell only
 *   above it. The floor is when the plan's part scored the cell — the newest
 *   `ts` among the section's assessments of that cell whose `audit_id` is one
 *   of the record's `parts` — and a resolution is above it when its own `ts`
 *   is later (raw strings, the key `orderEvents` sorts by): a part is scored
 *   before its plan is recorded, sometimes days before, and a fix landing in
 *   between is not in that score. With no such timed assessment the floor is
 *   the record's own place in the journal. A finding resolved more than once
 *   counts by its latest resolution.
 * - **Direct cells.** Each resolved finding's own `(criterion_id, surface)`,
 *   read from `section.findings` — the event does not carry them — when
 *   `score` could re-score it; a finding whose cell it could not (a retired
 *   criterion, an undeclared surface) is reported in `unscorable`. A
 *   `cross-surface` finding scopes every surface its criterion applies to: the
 *   contract lens has no column of its own, so the fix lands in the columns
 *   either side of it. The per-cell rule then judges each of those cells alone.
 * - **Accepted and refuted are out.** An accepted risk is a decision, not a
 *   fix, and the code did not change; the same goes for a refutation. Neither
 *   writes a `resolved` event in a repository, and a finding whose section
 *   status is one of them despite one (the fold's first-decision-wins rule) is
 *   read the way the findings board reads it.
 * - **Widening** (default on) is one hop over `node_ids`: any *assessed* cell
 *   whose criterion applies to its surface, and whose findings share a node id
 *   with a resolved finding, joins with `because: [node ids]` — counting a
 *   node only through a resolution that counts for that cell. One hop only — a
 *   second would pull the whole graph in, and a scope that says "everything"
 *   is the comprehensive audit again.
 * - **Reported lists.** `findings` and `resolved_by` hold only the findings
 *   that still drive a listed cell; `unknown` and `unscorable` hold every
 *   resolution in the window, plan or no plan.
 */
export function deriveAuditScope(
  events: readonly JournalEvent[],
  section: Pick<QualitySection, "findings" | "assessments"> & Partial<Pick<QualitySection, "profile">>,
  library: Pick<KritikLibrary, "criteria">,
  options: AuditScopeOptions = {},
): AuditScope {
  const ordered = orderedRows(events);
  // Rule 1: the anchor is never a plan record.
  const sinceIndex = anchorIndex(ordered, options.since);

  // An unrecorded `since` is echoed back, so the caller can say which audit
  // it never found — unless it names a plan or a part, which `since` never is.
  const asked = options.since;
  const empty: AuditScope = {
    since: asked === undefined || namesPlan(ordered, asked) ? null : asked,
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

  // When each audit scored each cell: the newest `ts` per (cell, audit id)
  // among every assessment row the section holds, not only the latest per
  // cell — a later audit may have outvoted a plan part's score in the merge.
  const scoredAt = new Map<string, Map<string, string>>();
  for (const assessment of rowsOf<QualityAssessment>(section?.assessments)) {
    if (!isString(assessment?.criterion_id) || !isString(assessment?.surface) || !isString(assessment?.audit_id)) continue;
    if (!isString(assessment.ts)) continue;
    const key = cellKey(assessment.criterion_id, assessment.surface);
    const byAudit = scoredAt.get(key) ?? new Map<string, string>();
    const seen = byAudit.get(assessment.audit_id);
    if (seen === undefined || seen < assessment.ts) byAudit.set(assessment.audit_id, assessment.ts);
    scoredAt.set(key, byAudit);
  }

  // Rule 2's floor per cell, set by the last plan record that re-scored it: the
  // `ts` its part scored the cell at when the section holds it, else the
  // record's own index. Plan records before the anchor need no entry — the
  // anchor's index is already higher, and so is every resolution counted here.
  // A damaged plan record (no readable `scope.plan`) names no cell, so it sets
  // no floor: it is skipped here exactly as it is skipped as an anchor.
  const planFloor = new Map<string, { index: number; ts: string | null }>();
  for (let i = sinceIndex + 1; i < ordered.length; i++) {
    const event = ordered[i];
    if (event.type !== "quality.audit.completed") continue;
    const reading = readPlanScope((event as { scope?: unknown }).scope);
    if (reading === null) continue;
    for (const key of reading.scored) {
      let ts: string | null = null;
      for (const part of reading.parts) {
        const at = scoredAt.get(key)?.get(part);
        if (at !== undefined && (ts === null || ts < at)) ts = at;
      }
      planFloor.set(key, { index: i, ts });
    }
  }
  // The raw `ts` string `orderEvents` sorts by, so "later" here and "after" in
  // `ordered` never disagree: a greater index never has a smaller key.
  const sortKeyAt = (index: number): string => {
    const ts = ordered[index]?.ts;
    return typeof ts === "string" ? ts : "";
  };
  /** Whether the resolution at `index` counts for `key` under rule 2. */
  const countsFor = (key: string, index: number): boolean => {
    const floor = planFloor.get(key);
    if (floor === undefined) return index > sinceIndex;
    return floor.ts !== null ? sortKeyAt(index) > floor.ts : index > floor.index;
  };

  // Resolutions in order, one entry per finding: the index of its latest
  // resolution, and each node id an event carried with the index of the
  // latest event that carried it. A later NAMED `resolved_by` wins over an
  // earlier one — the rule `foldQualityEvents` applies, so the run sheet and
  // the findings board name the same PR.
  const resolutions = new Map<string, { last: number; resolved_by?: string; nodes: Map<string, number> }>();
  for (let i = sinceIndex + 1; i < ordered.length; i++) {
    const event = ordered[i];
    if (event.type !== "quality.finding.resolved") continue;
    const findingId = (event as { finding_id?: unknown }).finding_id;
    if (!isString(findingId)) continue;
    const entry = resolutions.get(findingId) ?? { last: i, nodes: new Map<string, number>() };
    entry.last = i;
    const by = (event as { resolved_by?: unknown }).resolved_by;
    if (isString(by)) entry.resolved_by = by;
    for (const node of stringsOf((event as { node_ids?: unknown }).node_ids)) entry.nodes.set(node, i);
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
  // Node id → index of the latest counted resolution that touched it. Whether
  // it counts for a candidate cell is decided per cell, against that cell's floor.
  const resolvedNodes = new Map<string, number>();
  const touch = (node: string, index: number) => {
    if ((resolvedNodes.get(node) ?? -1) < index) resolvedNodes.set(node, index);
  };

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
    // when its own cell is one nothing can re-score. The finding's own nodes
    // date from its latest resolution; an event's nodes from that event.
    for (const node of stringsOf(finding.node_ids)) touch(node, resolution.last);
    for (const [node, index] of resolution.nodes) touch(node, index);
    if (targets.length === 0) {
      unscorable.push(findingId);
      continue;
    }

    // Rules 2 to 4, per target cell: a plan whose part scored the cell after
    // this finding's latest resolution already holds the fix.
    const live = targets.filter((surface) => countsFor(cellKey(finding.criterion_id, surface), resolution.last));
    if (live.length === 0) continue;

    drivers.push(findingId);
    if (resolution.resolved_by !== undefined) resolvedBy[findingId] = resolution.resolved_by;
    for (const surface of live) addDirect(finding.criterion_id, surface, findingId);
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
      // Rule 5: a node counts for this cell only through a resolution above
      // the cell's floor — a plan whose part scored this cell after it holds it.
      // The node's latest index is enough: a greater index never sorts earlier.
      const shared = [...(nodesByCell.get(key) ?? [])]
        .filter((node) => {
          const at = resolvedNodes.get(node);
          return at !== undefined && countsFor(key, at);
        })
        .sort();
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
  /**
   * Every audit id that exists: on disk in a repo, in the section and
   * journal when hosted. Order does not matter — the newest is found by
   * sorting, not by position, since the hosted caller builds this from a
   * union of several sources with no inherent order.
   */
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
 * when the caller found one and no known id sorts after it — an `open` a
 * newer audit already outsorts is stale and falls through to naming a fresh
 * candidate instead), else opens `<month>-scoped`, then `<month>-scoped-02`
 * and on, the convention SPEC § 6 names. After a plan in the same month,
 * `<month>-scoped` would sort before the plan's parts, so the candidates start
 * from the newest part instead: `<partId>-scoped`, `<partId>-scoped-02` (see
 * `scopedCandidates`).
 *
 * A requested id shaped like a plan id or a plan part id is refused: those
 * names are reserved for a plan's record and its parts.
 */
export function scopedAuditId(input: ScopedAuditIdInput): string {
  const { since, month, requested, known, recorded, open } = input;
  const newest = [...known].sort().at(-1);

  if (requested !== undefined) {
    if (requested === since) {
      throw new Error(
        `"${requested}" is the audit this scope is measured from — its recorded reading is history. ` +
          `Name a new audit (e.g. \`${suggestedAuditId(input)}\`); every other cell keeps its score through the merge.`,
      );
    }
    if (recorded.includes(requested)) {
      throw new Error(`"${requested}" is already recorded — its reading is history. Name a new audit.`);
    }
    // A plan's id names its file and its record, and a part's id one of its parts: an audit
    // directory named either way could never be recorded, nor read as the plan it looks like.
    if (isPlanId(requested) || isPlanPartId(requested)) {
      throw new Error(
        `"${requested}" is reserved for plans and their parts — a plan id (YYYY-MM-zplan-DDNN) names a plan, ` +
          `and <planId>-<domain>-<surface> one of its parts, so an audit under that id could never be recorded or read as one. ` +
          `Name a scoped re-audit (e.g. \`${suggestedAuditId({ ...input, requested: undefined })}\`).`,
      );
    }
    if (newest !== undefined && requested < newest) {
      throw new Error(
        `"${requested}" sorts before "${newest}", and audits merge latest-wins in lexical order — ` +
          `its scores would be outvoted by the older ones they replace. Name one that sorts last (e.g. \`${suggestedAuditId(input)}\`).`,
      );
    }
    return requested;
  }

  if (open !== undefined && (newest === undefined || open >= newest)) return open;

  for (const candidate of scopedCandidates(month, known)) {
    if (known.includes(candidate)) continue;
    if (newest !== undefined && candidate < newest) {
      throw new Error(
        `"${candidate}" would sort before "${newest}", so its scores would lose the latest-wins merge. ` +
          `Name the scoped audit yourself, one that sorts after "${newest}" (e.g. \`${suggestedAuditId(input)}\`).`,
      );
    }
    return candidate;
  }
  throw new Error(`99 scoped audits in ${month} — name the next one yourself.`);
}

/**
 * `<base>-scoped`, then `<base>-scoped-02` … `-99` — the convention SPEC § 6
 * names, in the order a new audit takes them.
 *
 * The base is `month`, unless `<month>-scoped` sorts before the newest known id
 * and that id is a plan part, or a scoped re-audit named after one (its stem,
 * minus `-scoped` / `-scoped-NN`, is a plan part). Then the base is that part
 * id: a plan's parts sort after every same-month id by design
 * (`2026-11-zplan-…`), so a month-based candidate could only be refused, and
 * `<partId>-scoped` is the nearest id that sorts after them.
 */
function* scopedCandidates(month: string, known: readonly string[]): Generator<string> {
  const newest = [...known].sort().at(-1) ?? "";
  const stem = newest.replace(/-scoped(-\d+)?$/, "");
  const base = `${month}-scoped` < newest && isPlanPartId(stem) ? stem : month;
  for (let n = 1; n < 100; n++) yield n === 1 ? `${base}-scoped` : `${base}-scoped-${String(n).padStart(2, "0")}`;
}

/**
 * The example id a refusal suggests — one the caller could send back and have
 * accepted. Suggesting `<month>-scoped` blindly could name the very id just
 * refused (a scope measured from this month's own scoped audit) or one that
 * already exists, and an agent follows the example literally: it would loop.
 *
 * So it walks the same candidates the unrequested path does and takes the
 * first that is taken by nothing (known, recorded, the scope's own `since`,
 * the requested id) and sorts after every one of them. When no candidate this
 * month can — a later month is already known — it names one that sorts after
 * the newest taken id by extending it, which by construction nothing else is.
 */
function suggestedAuditId({ since, month, requested, known, recorded }: ScopedAuditIdInput): string {
  const taken = new Set<string>([...known, ...recorded, since, ...(requested !== undefined ? [requested] : [])]);
  const floor = [...taken].sort().at(-1);
  for (const candidate of scopedCandidates(month, known)) {
    if (taken.has(candidate)) continue;
    if (floor === undefined || candidate > floor) return candidate;
  }
  return `${floor}-scoped`;
}

/**
 * The one-line total a run sheet ends on — built here so the CLI and the MCP
 * tool cannot word the same scope two ways. With no driving finding — an
 * empty scope, or only widened cells left after a plan cleared the direct
 * ones — the "from N resolved findings" clause is left out rather than read
 * "from 0".
 */
export function scopeSummary(scope: AuditScope): string {
  const direct = scope.cells.length - scope.widened;
  const cells = `${scope.cells.length} cell${scope.cells.length === 1 ? "" : "s"} to re-score`;
  const split = scope.widened > 0 ? ` (${direct} direct, ${scope.widened} widened)` : "";
  const count = scope.findings.length;
  const from = count > 0 ? ` from ${count} resolved finding${count === 1 ? "" : "s"}` : "";
  return `${cells}${split}${from}${scope.since !== null ? ` since ${scope.since}` : ""}`;
}
