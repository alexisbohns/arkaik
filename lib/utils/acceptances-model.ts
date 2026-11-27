/**
 * The Acceptances surfaces' rules, as data: the directory (Contents, Mapping,
 * Value), the Parity monitor and the acceptance panel all render these models
 * and never re-derive a rule. The rules, read through the shared helpers:
 *
 *   - a promise's marks follow the ARITY RULE of `AcceptanceMatrix`: at ≥ 2
 *     platforms in scope one mark per scope platform; at ≤ 1 a single mark with
 *     NO platform in it (the lifecycle status alone);
 *   - a PARITY GAP is `hasParityGap` (some platforms delivered, not all);
 *   - an anchor group is `groupAcceptancesByAnchor` (a promise covering n anchors
 *     appears in n groups; unanchored last);
 *   - a JOURNEY is a flow: its playlist's views (sub-flows included,
 *     `collectFlowViewIds`) plus the views the flow itself `composes`. A
 *     view→view compose chain never pulls a screen into a flow (owner rule);
 *   - WEIGHT is `deriveWeighing` over the project's weighing section: served and
 *     cost are NEVER netted; a seeded cell (+1 per claimed value, never scored)
 *     is a guess and says so.
 *   - KEPT EVERYWHERE is live on every platform the promise applies to; a
 *     platform it does not target (N/A) never counts against it, so a web-only
 *     group can be kept.
 */
import {
  collectPlaylistNodeRefs,
  computeParityGaps,
  deriveWeighing,
  hasParityGap,
  resolvePlatformStatus,
  type EffectiveCell,
  type ElementMass,
  type PromiseWeighing,
  type ValueId,
  type WeighingSection,
  type WeighingView,
} from "@arkaik/schema";
import type { Edge, Node } from "@/lib/data/types";
import type { StatusId } from "@arkaik/schema";
import type { PlatformId } from "@/lib/config/platforms";
import { STATUSES } from "@/lib/config/statuses";
import { VALUES } from "@/lib/config/values";
import { groupAcceptancesByAnchor, UNANCHORED_GROUP_LABEL } from "@/lib/utils/acceptance-matrix";
import { addNodeToRollup, collectFlowViewIds, createEmptyRollup, type PlatformStatusRollup } from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";

// ── shared ──────────────────────────────────────────────────────────────────

const STATUS_ORDER = new Map<string, number>(STATUSES.map((s) => [s.id, s.order]));
export const statusOrder = (status: StatusId | undefined): number => (status ? STATUS_ORDER.get(status) ?? -1 : -1);
export const statusLabel = (status: StatusId | undefined): string =>
  STATUSES.find((s) => s.id === status)?.label ?? "No status";

/** One mark of a promise's availability strip. `platform: null` = arity ≤ 1: the lifecycle status alone, no platform. */
export interface PromiseMark {
  platform: PlatformId | null;
  status: StatusId | undefined;
  /** Delivered (live/releasing per the schema's default) — the fill the owner liked. */
  live: boolean;
}

export interface AnchorRef {
  id: string;
  title: string;
  species: Node["species"];
}

/** What every section that renders ONE promise receives. */
export interface PromiseModel {
  node: Node;
  id: string;
  title: string;
  status: StatusId;
  /** The arity rule already applied: render these, in order. */
  marks: PromiseMark[];
  /** `hasParityGap`: some platforms delivered, not all. Only meaningful when `marks.length >= 2`. */
  hasGap: boolean;
  /** For a gap: the platforms delivered, and the lagging ones with their status. */
  delivered: PlatformId[];
  lagging: { platform: PlatformId; status: StatusId }[];
  /** Live on every mark that APPLIES ("not applicable" dashes ignored), with at least one that applies. */
  liveEverywhere: boolean;
  /** The values the author claimed (metadata.values), in claim order. */
  values: ValueId[];
  gherkin: string;
  description: string;
  anchors: AnchorRef[];
  /** Journeys (flows) whose views or own node this promise covers. */
  journeys: AnchorRef[];
  /** `null` when the project has no active value matrix. */
  weighing: PromiseWeighing | null;
  /** True when every non-blank cell is a seed (+1 per claimed value): the weight is a guess. */
  unweighed: boolean;
}

function coversOf(id: string, edges: readonly Edge[]): string[] {
  return edges.filter((e) => e.edge_type === "covers" && e.source_id === id).map((e) => e.target_id);
}

// ── journeys (needed by every view: a promise names its journeys) ───────────

export interface JourneyIndex {
  flows: Node[];
  /** flow id → the views it holds (playlist incl. sub-flows + direct composes). */
  viewsOf: Map<string, Set<string>>;
  /** view id → flow ids holding it. */
  flowsOfView: Map<string, Set<string>>;
  /** flow id → flows whose playlist reaches it (it is a sub-flow there). */
  parentsOf: Map<string, Set<string>>;
}

export function buildJourneyIndex(nodes: readonly Node[], edges: readonly Edge[], nodesById: ReadonlyMap<string, Node>): JourneyIndex {
  const flows = nodes.filter((n) => n.species === "flow").sort((a, b) => a.title.localeCompare(b.title));
  const viewsOf = new Map<string, Set<string>>();
  const flowsOfView = new Map<string, Set<string>>();
  const parentsOf = new Map<string, Set<string>>();
  for (const flow of flows) {
    const views = collectFlowViewIds(flow, nodesById);
    for (const e of edges) {
      if (e.edge_type === "composes" && e.source_id === flow.id && nodesById.get(e.target_id)?.species === "view") views.add(e.target_id);
    }
    viewsOf.set(flow.id, views);
    for (const v of views) {
      const set = flowsOfView.get(v) ?? new Set<string>();
      set.add(flow.id);
      flowsOfView.set(v, set);
    }
    // Sub-flows: every `flow_id` the playlist references, through condition/junction branches.
    const entries = Array.isArray(flow.metadata?.playlist?.entries) ? flow.metadata.playlist.entries : [];
    for (const ref of collectPlaylistNodeRefs(entries)) {
      if (ref === flow.id || nodesById.get(ref)?.species !== "flow") continue;
      const set = parentsOf.get(ref) ?? new Set<string>();
      set.add(flow.id);
      parentsOf.set(ref, set);
    }
  }
  return { flows, viewsOf, flowsOfView, parentsOf };
}

// ── the promise model ───────────────────────────────────────────────────────

export interface PromiseContext {
  columns: readonly (PlatformId | null)[];
  edges: readonly Edge[];
  nodesById: ReadonlyMap<string, Node>;
  journeys: JourneyIndex;
  weighingById: ReadonlyMap<string, PromiseWeighing>;
}

export function buildPromise(node: Node, ctx: PromiseContext): PromiseModel {
  const marks: PromiseMark[] = ctx.columns.map((platform) => {
    const status = platform === null ? node.status : resolvePlatformStatus(node, platform);
    return { platform, status, live: status === "live" || status === "releasing" };
  });
  const gap = computeParityGaps([node])[0];
  const anchors: AnchorRef[] = coversOf(node.id, ctx.edges)
    .map((id) => ctx.nodesById.get(id))
    .filter((n): n is Node => !!n)
    .map((n) => ({ id: n.id, title: n.title, species: n.species }));
  const journeyIds = new Set<string>();
  for (const a of anchors) {
    if (a.species === "flow") journeyIds.add(a.id);
    for (const f of ctx.journeys.flowsOfView.get(a.id) ?? []) journeyIds.add(f);
  }
  const journeys = [...journeyIds]
    .map((id) => ctx.nodesById.get(id))
    .filter((n): n is Node => !!n)
    .map((n) => ({ id: n.id, title: n.title, species: n.species }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const weighing = ctx.weighingById.get(node.id) ?? null;
  return {
    node,
    id: node.id,
    title: node.title,
    status: node.status,
    marks,
    hasGap: marks.length >= 2 && hasParityGap(node),
    delivered: gap?.delivered ?? [],
    lagging: gap ? (Object.entries(gap.missing) as [PlatformId, StatusId][]).map(([platform, status]) => ({ platform, status })) : [],
    liveEverywhere: marks.some((m) => m.status !== undefined) && marks.every((m) => m.status === undefined || m.status === "live"),
    values: (node.metadata?.values ?? []) as ValueId[],
    gherkin: (node.metadata?.gherkin as string | undefined) ?? "",
    description: node.description ?? "",
    anchors,
    journeys,
    weighing,
    unweighed: weighing ? weighing.cells.every((c) => c.source === "seed") : true,
  };
}

// ── PARITY ──────────────────────────────────────────────────────────────────

export interface ParityGroup {
  key: string;
  anchor: Node | null;
  anchorSpecies: Node["species"] | null;
  label: string;
  promises: PromiseModel[];
  gapCount: number;
  /** Share at parity (1 when the group has no gap). */
  balancedRatio: number;
  /** Every promise live everywhere it applies (N/A ignored), so a web-only group can be kept. */
  allKept: boolean;
  /** Per-platform delivery rollup the shipped wheels are drawn from. */
  rollup: PlatformStatusRollup;
  /** The shipped parity wheel shows only in a multi-platform scope with ≥ 1 gap. */
  showParityWheel: boolean;
  parityLabel: string;
  /** Journeys this anchor sits in (a flow anchor is its own journey). */
  journeys: AnchorRef[];
}

export interface ParityModel {
  columns: readonly (PlatformId | null)[];
  isMultiPlatform: boolean;
  /** The scope's platforms (always ≥ 1 entry for a multi-platform scope). */
  platforms: readonly PlatformId[];
  groups: ParityGroup[];
  /** Each promise once (groups repeat a promise covering several anchors). */
  promises: PromiseModel[];
  /** The Ledger inbox: each promise with a gap, once, most-lagging first. */
  gaps: PromiseModel[];
  totals: {
    promises: number;
    gaps: number;
    liveEverywhere: number;
    /** Per mark column: how many promises sit at each status (unique promises). */
    byColumn: { platform: PlatformId | null; counts: Partial<Record<StatusId, number>>; live: number }[];
  };
  empty: boolean;
  emptyMessage: string;
}

export function buildParity(
  filtered: readonly Node[],
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
  scope: Pick<ProductScope, "isMultiPlatform" | "platforms">,
  promiseOf: (node: Node) => PromiseModel,
  journeys: JourneyIndex,
): ParityModel {
  const columns: (PlatformId | null)[] = scope.isMultiPlatform ? [...scope.platforms] : [scope.platforms[0] ?? null];
  const { groups: raw } = groupAcceptancesByAnchor(filtered, edges, nodesById);
  const groups: ParityGroup[] = raw.map((g) => {
    const promises = g.acceptances.map(promiseOf);
    const balanced = promises.length - g.gapCount;
    const balancedRatio = promises.length === 0 ? 1 : balanced / promises.length;
    const journeyIds = g.anchorId
      ? g.anchorSpecies === "flow"
        ? [g.anchorId]
        : [...(journeys.flowsOfView.get(g.anchorId) ?? [])]
      : [];
    return {
      key: g.anchorId ?? "__unanchored__",
      anchor: g.anchorNode,
      anchorSpecies: g.anchorSpecies,
      label: g.anchorNode ? g.anchorNode.title : UNANCHORED_GROUP_LABEL,
      promises,
      gapCount: g.gapCount,
      balancedRatio,
      allKept: promises.every((p) => p.liveEverywhere),
      rollup: g.acceptances.reduce((r, a) => addNodeToRollup(r, a), createEmptyRollup()),
      showParityWheel: scope.isMultiPlatform && g.gapCount > 0,
      parityLabel: `${balanced} of ${promises.length} at parity · ${g.gapCount} gap${g.gapCount === 1 ? "" : "s"}`,
      journeys: journeyIds
        .map((id) => nodesById.get(id))
        .filter((n): n is Node => !!n)
        .map((n) => ({ id: n.id, title: n.title, species: n.species })),
    };
  });
  const promises = filtered.map(promiseOf);
  const gaps = promises
    .filter((p) => p.hasGap)
    .sort((a, b) => b.lagging.length - a.lagging.length || a.title.localeCompare(b.title));
  const byColumn = columns.map((platform, i) => {
    const counts: Partial<Record<StatusId, number>> = {};
    let live = 0;
    for (const p of promises) {
      const s = p.marks[i]?.status;
      if (s) counts[s] = (counts[s] ?? 0) + 1;
      if (s === "live") live++;
    }
    return { platform, counts, live };
  });
  return {
    columns,
    isMultiPlatform: scope.isMultiPlatform,
    platforms: scope.platforms,
    groups,
    promises,
    gaps,
    totals: { promises: promises.length, gaps: gaps.length, liveEverywhere: promises.filter((p) => p.liveEverywhere).length, byColumn },
    empty: groups.length === 0,
    emptyMessage: "No acceptances match these filters.",
  };
}

// ── MAPPING ─────────────────────────────────────────────────────────────────

export interface JourneyScreen {
  view: Node;
  /** Promises covering this view (filtered). */
  promises: PromiseModel[];
}

export interface Journey {
  flow: Node;
  id: string;
  title: string;
  /** Flows whose playlist reaches this one (it is a sub-flow there). Empty = a top-level journey. */
  parents: AnchorRef[];
  /** Views the journey holds, in title order, each with its promises — views with no promise included. */
  screens: JourneyScreen[];
  /** Promises covering the flow node itself. */
  direct: PromiseModel[];
  /** Every promise of the journey, once. */
  promises: PromiseModel[];
  /** Σ served / Σ cost of `promises` (never netted). `null` without an active value matrix. */
  weight: { served: number; cost: number; guesswork: number } | null;
  gaps: number;
  liveEverywhere: number;
  /** Views with no promise at all — what the journey shows but never promises. */
  uncovered: number;
}

export interface MappingModel {
  journeys: Journey[];
  /** Views no journey holds, that carry promises: "outside any journey". */
  outside: JourneyScreen[];
  unanchored: PromiseModel[];
  /** The heaviest journey's served mass — size bars against it. */
  maxServed: number;
  /** The most promises any journey holds — size by count when weight is absent. */
  maxPromises: number;
  totals: { journeys: number; promises: number; outside: number; unanchored: number };
  empty: boolean;
  emptyMessage: string;
}

function weightOf(promises: readonly PromiseModel[]): Journey["weight"] {
  if (promises.length === 0) return { served: 0, cost: 0, guesswork: 0 };
  if (promises.some((p) => !p.weighing)) return null;
  let served = 0;
  let cost = 0;
  let guessServed = 0;
  for (const p of promises) {
    const w = p.weighing!;
    served += w.served;
    cost += w.cost;
    guessServed += w.served * w.guesswork.served;
  }
  return { served, cost, guesswork: served === 0 ? 0 : guessServed / served };
}

export function buildMapping(
  filtered: readonly Node[],
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
  promiseOf: (node: Node) => PromiseModel,
  journeys: JourneyIndex,
): MappingModel {
  const filteredIds = new Set(filtered.map((n) => n.id));
  const byAnchor = new Map<string, PromiseModel[]>();
  const unanchored: PromiseModel[] = [];
  for (const node of filtered) {
    const anchors = coversOf(node.id, edges).filter((id) => nodesById.has(id));
    if (anchors.length === 0) unanchored.push(promiseOf(node));
    for (const a of anchors) {
      const list = byAnchor.get(a) ?? [];
      list.push(promiseOf(node));
      byAnchor.set(a, list);
    }
  }
  const held = new Set<string>();
  const list: Journey[] = journeys.flows.map((flow) => {
    const viewIds = [...(journeys.viewsOf.get(flow.id) ?? [])];
    viewIds.forEach((v) => held.add(v));
    const screens = viewIds
      .map((id) => nodesById.get(id))
      .filter((n): n is Node => !!n)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((view) => ({ view, promises: byAnchor.get(view.id) ?? [] }));
    const direct = byAnchor.get(flow.id) ?? [];
    const seen = new Map<string, PromiseModel>();
    for (const p of [...direct, ...screens.flatMap((s) => s.promises)]) seen.set(p.id, p);
    const promises = [...seen.values()];
    return {
      flow,
      id: flow.id,
      title: flow.title,
      parents: [...(journeys.parentsOf.get(flow.id) ?? [])]
        .map((id) => nodesById.get(id))
        .filter((n): n is Node => !!n)
        .map((n) => ({ id: n.id, title: n.title, species: n.species })),
      screens,
      direct,
      promises,
      weight: weightOf(promises),
      gaps: promises.filter((p) => p.hasGap).length,
      liveEverywhere: promises.filter((p) => p.liveEverywhere).length,
      uncovered: screens.filter((s) => s.promises.length === 0).length,
    };
  });
  // A filter narrows promises; a journey left with none drops out (unless nothing is filtered).
  const anyFilter = filteredIds.size < [...nodesById.values()].filter((n) => n.species === "acceptance").length;
  const shown = anyFilter ? list.filter((j) => j.promises.length > 0) : list;
  const outside: JourneyScreen[] = [...byAnchor.entries()]
    .filter(([id]) => nodesById.get(id)?.species === "view" && !held.has(id))
    .map(([id, promises]) => ({ view: nodesById.get(id)!, promises }))
    .sort((a, b) => a.view.title.localeCompare(b.view.title));
  return {
    journeys: shown,
    outside,
    unanchored,
    maxServed: Math.max(0, ...shown.map((j) => j.weight?.served ?? 0)),
    maxPromises: Math.max(0, ...shown.map((j) => j.promises.length)),
    totals: {
      journeys: shown.length,
      promises: filtered.length,
      outside: outside.reduce((n, s) => n + s.promises.length, 0),
      unanchored: unanchored.length,
    },
    empty: filtered.length === 0,
    emptyMessage: "No acceptances match these filters.",
  };
}

// ── VALUE ───────────────────────────────────────────────────────────────────

export interface ValueElement {
  id: ValueId;
  label: string;
  tier: string;
  mass: ElementMass;
  /** promised − kept: what is promised for this element but not yet live everywhere. */
  owed: number;
  /** Promises that touch this element (non-blank cell), served side and cost side. */
  serving: PromiseModel[];
  costing: PromiseModel[];
  /** Weight in the active positioning, if any (1–3). */
  positioned: number | null;
}

export interface ValueModel {
  /** False when the project has no active value matrix: say so, render nothing else. */
  available: boolean;
  view: WeighingView | null;
  /** Elements with any mass, heaviest promised first. Zero-mass elements are left out. */
  elements: ValueElement[];
  /** Gaps first: elements by owed (promised − kept), descending, owed > 0 only. */
  owed: ValueElement[];
  /** Promises with any cost, heaviest cost first — "unclaimed costs are the most valuable thing an audit finds". */
  costs: PromiseModel[];
  /** Promises that carry a flag (claim not supported / contradicted / unclaimed value / unclaimed cost / review). */
  flagged: { promise: PromiseModel; flags: string[] }[];
  /** Every filtered promise, heaviest served first. */
  promises: PromiseModel[];
  /** Promises whose weight is only seeds: nobody has weighed them. */
  unweighed: number;
  totals: WeighingView["totals"] | null;
  /** Per journey (from mapping): served / cost, for a journey-level read. */
  journeys: Journey[];
  maxPromised: number;
  maxCost: number;
  empty: boolean;
  emptyMessage: string;
}

const VALUE_META = new Map<string, { label: string; tier: string }>(VALUES.map((v) => [v.id, { label: v.label, tier: v.tier }]));

export function buildValue(
  filtered: readonly Node[],
  weighing: WeighingView | undefined,
  promiseOf: (node: Node) => PromiseModel,
  mapping: MappingModel,
): ValueModel {
  const promises = filtered.map(promiseOf);
  if (!weighing) {
    return {
      available: false, view: null, elements: [], owed: [], costs: [], flagged: [], promises, unweighed: promises.length,
      totals: null, journeys: mapping.journeys, maxPromised: 0, maxCost: 0, empty: promises.length === 0,
      emptyMessage: "This project has no active value matrix.",
    };
  }
  const elements: ValueElement[] = (Object.entries(weighing.elements) as [ValueId, ElementMass][])
    .filter(([, m]) => m.promised > 0 || m.cost > 0)
    .map(([id, mass]) => {
      const touching = (sign: 1 | -1) =>
        promises.filter((p) => p.weighing?.cells.some((c: EffectiveCell) => c.criterion === id && (sign > 0 ? c.level > 0 : c.level < 0)));
      return {
        id,
        label: VALUE_META.get(id)?.label ?? id,
        tier: VALUE_META.get(id)?.tier ?? "functional",
        mass,
        owed: Math.max(0, mass.promised - mass.kept),
        serving: touching(1),
        costing: touching(-1),
        positioned: weighing.positioning?.active ? weighing.positioning.weights.get(id) ?? null : null,
      };
    })
    .sort((a, b) => b.mass.promised - a.mass.promised);
  const flagged = promises
    .map((promise) => {
      const f = promise.weighing?.flags;
      const flags = f
        ? [
            ...f.claim_not_supported.map((e) => `claim not supported · ${e}`),
            ...f.claim_contradicted.map((e) => `claim contradicted · ${e}`),
            ...f.unclaimed_value.map((e) => `unclaimed value · ${e}`),
            ...f.unclaimed_cost.map((e) => `unclaimed cost · ${e}`),
            ...(promise.weighing?.review ?? []).map((e) => `review · ${e}`),
          ]
        : [];
      return { promise, flags };
    })
    .filter((x) => x.flags.length > 0);
  return {
    available: true,
    view: weighing,
    elements,
    owed: elements.filter((e) => e.owed > 0).sort((a, b) => b.owed - a.owed),
    costs: promises.filter((p) => (p.weighing?.cost ?? 0) > 0).sort((a, b) => (b.weighing?.cost ?? 0) - (a.weighing?.cost ?? 0)),
    flagged,
    promises: [...promises].sort((a, b) => (b.weighing?.served ?? 0) - (a.weighing?.served ?? 0)),
    unweighed: promises.filter((p) => p.unweighed).length,
    totals: weighing.totals,
    journeys: mapping.journeys,
    maxPromised: Math.max(0, ...elements.map((e) => e.mass.promised)),
    maxCost: Math.max(0, ...elements.map((e) => e.mass.cost)),
    empty: promises.length === 0,
    emptyMessage: "No acceptances match these filters.",
  };
}

// ── the whole page, in one call ─────────────────────────────────────────────

export interface AcceptancesModel {
  parity: ParityModel;
  mapping: MappingModel;
  value: ValueModel;
  /** All acceptances (unfiltered) count, and the filtered one. */
  total: number;
  shown: number;
  filtered: boolean;
  /** Build one promise's model (memo per id within this build). */
  promiseOf: (node: Node) => PromiseModel;
}

export function buildAcceptancesModel(params: {
  nodes: readonly Node[];
  edges: readonly Edge[];
  nodesById: ReadonlyMap<string, Node>;
  /** The filtered acceptances, as the page's `filterAcceptances` returns them. */
  filtered: readonly Node[];
  scope: Pick<ProductScope, "isMultiPlatform" | "platforms">;
  weighingSection: WeighingSection | undefined;
}): AcceptancesModel {
  const { nodes, edges, nodesById, filtered, scope, weighingSection } = params;
  const all = nodes.filter((n) => n.species === "acceptance");
  const weighing = deriveWeighing(nodes, weighingSection);
  const weighingById = new Map((weighing?.promises ?? []).map((p) => [p.node_id, p]));
  const journeys = buildJourneyIndex(nodes, edges, nodesById);
  const columns: (PlatformId | null)[] = scope.isMultiPlatform ? [...scope.platforms] : [scope.platforms[0] ?? null];
  const ctx: PromiseContext = { columns, edges, nodesById, journeys, weighingById };
  const cache = new Map<string, PromiseModel>();
  const promiseOf = (node: Node) => {
    let p = cache.get(node.id);
    if (!p) {
      p = buildPromise(node, ctx);
      cache.set(node.id, p);
    }
    return p;
  };
  const parity = buildParity(filtered, edges, nodesById, scope, promiseOf, journeys);
  const mapping = buildMapping(filtered, edges, nodesById, promiseOf, journeys);
  const value = buildValue(filtered, weighing, promiseOf, mapping);
  return { parity, mapping, value, total: all.length, shown: filtered.length, filtered: filtered.length !== all.length, promiseOf };
}

// ── the acceptance panel ────────────────────────────────────────────────────

/** One journey this promise lives in, and where inside it. */
export interface AcceptancePlace {
  journey: Node;
  /** The journeys above it, outermost first (the first parent each time). */
  trail: Node[];
  /** The screens this promise covers that the journey holds. */
  screens: Node[];
  /** The promise covers the journey (the flow) itself. */
  direct: boolean;
}

/** WHERE a promise lives, as journey › screen, and what stands beside it. */
export interface AcceptanceWhere {
  /** Covers no screen or flow at all. */
  unanchored: boolean;
  places: AcceptancePlace[];
  /** Screens the promise covers that no journey holds. */
  outside: Node[];
  /** The screen the panel orients by: the first screen of the first journey, else the first outside one. */
  screen: Node | null;
  /** Other promises covering that screen. */
  beside: Node[];
}

export interface AcceptancePanelModel {
  promise: PromiseModel;
  /** No save path (e.g. opened from the Changelog): show, offer nothing. */
  readOnly: boolean;
  /** The scope's platforms (the Platforms section edits one row per platform). */
  platforms: readonly PlatformId[];
  where: AcceptanceWhere;
}

export function buildAcceptancePanel(params: {
  node: Node;
  nodes: readonly Node[];
  edges: readonly Edge[];
  scope: Pick<ProductScope, "isMultiPlatform" | "platforms">;
  weighingSection: WeighingSection | undefined;
  readOnly: boolean;
}): AcceptancePanelModel {
  const { node, nodes, edges, scope, weighingSection, readOnly } = params;
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const weighing = deriveWeighing(nodes, weighingSection);
  const weighingById = new Map((weighing?.promises ?? []).map((p) => [p.node_id, p]));
  const journeys = buildJourneyIndex(nodes, edges, nodesById);
  const columns: (PlatformId | null)[] = scope.isMultiPlatform ? [...scope.platforms] : [scope.platforms[0] ?? null];
  const promise = buildPromise(node, { columns, edges, nodesById, journeys, weighingById });
  return { promise, readOnly, platforms: scope.platforms, where: buildWhere(promise, edges, nodesById, journeys) };
}

function buildWhere(promise: PromiseModel, edges: readonly Edge[], nodesById: ReadonlyMap<string, Node>, index: JourneyIndex): AcceptanceWhere {
  const chain = (id: string): Node[] => {
    const out: Node[] = [];
    const seen = new Set([id]);
    let cur = [...(index.parentsOf.get(id) ?? [])][0];
    while (cur && !seen.has(cur)) {
      const n = nodesById.get(cur);
      if (!n) break;
      out.unshift(n);
      seen.add(cur);
      cur = [...(index.parentsOf.get(cur) ?? [])][0];
    }
    return out;
  };
  const views = promise.anchors.filter((a) => a.species === "view");
  const nodeOf = (a: { id: string }) => nodesById.get(a.id);
  const isNode = (n: Node | undefined): n is Node => !!n;
  const places: AcceptancePlace[] = promise.journeys
    .map((j) => nodesById.get(j.id))
    .filter(isNode)
    .map((journey) => ({
      journey,
      trail: chain(journey.id),
      screens: views.filter((a) => index.viewsOf.get(journey.id)?.has(a.id)).map(nodeOf).filter(isNode),
      direct: promise.anchors.some((a) => a.id === journey.id),
    }));
  const outside = views.filter((a) => !index.flowsOfView.has(a.id)).map(nodeOf).filter(isNode);
  const screen = places[0]?.screens[0] ?? outside[0] ?? null;
  const beside = screen
    ? edges
        .filter((e) => e.edge_type === "covers" && e.target_id === screen.id && e.source_id !== promise.id)
        .map((e) => nodesById.get(e.source_id))
        .filter((n): n is Node => !!n && n.species === "acceptance")
    : [];
  return { unanchored: promise.anchors.length === 0, places, outside, screen, beside };
}
