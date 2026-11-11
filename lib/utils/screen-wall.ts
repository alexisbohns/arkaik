import { resolvePlatformStatus, type MapDefinition } from "@arkaik/schema";
import { PLATFORMS, platformLabel, type PlatformId } from "@/lib/config/platforms";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import type { Edge as DataEdge, JournalEvent, Node as DataNode, PlaylistEntry, Project } from "@/lib/data/types";
import { createVisualNodeId } from "@/lib/utils/graph-build";
import { resolveJourneySelection } from "@/lib/utils/journey-graph";
import { getEffectivePlatformStatuses } from "@/lib/utils/platform-status";
import { scopedPlatforms, type ProductGraph, type ProductScope } from "@/lib/utils/product-scope";
import { staleReasons, stalenessRelatedIds } from "@/lib/utils/screenshot-staleness";

/**
 * The Screens map's wall model (docs/superpowers/specs/2026-11-11-screens-map-design.md
 * § The wall model): every flow in scope as a strip of its screens, in the
 * Journey's order, then the views no flow lists. Pure — no React, no DOM — so
 * the map's renderer and its tests read the same answer.
 */

export interface WallInput {
  /** The whole snapshot: effective statuses and membership read every node. */
  nodes: readonly DataNode[];
  edges: readonly DataEdge[];
  /** The journal projected to STALENESS_EVENT_TYPES; any order. */
  events: readonly JournalEvent[];
  project: Pick<Project, "root_node_id"> | null | undefined;
  /** The Screens definition; only `product` is read. */
  definition?: Pick<MapDefinition, "product"> | null;
  scope: ProductScope;
  graph: ProductGraph;
}

export type WallLens = PlatformId | "side";

export type ShotState =
  | "live-current" // live, a shot, not stale
  | "live-stale" // live, a shot, stale            (a gap)
  | "live-no-shot" // live, no shot                  (a gap)
  | "not-live" // on the platform, status is not live (or none)
  | "absent"; // not on this platform

export type ShotForm = "url" | "data" | "path";

export interface WallShot {
  value: string;
  /** From meta.form, else detected from the value. */
  form: ShotForm;
  /** null = legacy slot with no provenance. */
  source: "ci" | "manual" | null;
  ts: string | null;
  commit: string | null;
}

export interface StaleReason {
  eventId: string;
  ts: string;
  kind: "status" | "merge" | "shipped";
  /** The node the event is about: the view, or one of its covering acceptances. */
  nodeId: string;
  /** e.g. "AC-checkin-live moved to Live on iOS", "Pull request merged", "Shipped: Weekly wrap" */
  label: string;
}

export interface LiveProof {
  kind: "deploy" | "hand" | "unknown";
  /** The latest move to live that decided it. */
  ts: string | null;
  actor: string | null;
  detail: string | null;
}

export interface PlatformCell {
  platform: PlatformId;
  state: ShotState;
  /** Effective status; null when the platform is listed but nothing gives it one. */
  status: StatusId | null;
  /** Present whenever the slot holds a value, whatever the state. */
  shot: WallShot | null;
  /** Newest first; empty unless the shot is stale. */
  staleBecause: StaleReason[];
  /** Only for the two live-with-shot states and live-no-shot. */
  proof: LiveProof | null;
}

export interface WallTouch {
  nodeId: string;
  species: "api-endpoint" | "data-model";
  title: string;
  status: StatusId;
}

/** One per view in scope, shared by every frame that shows it. */
export interface WallScreen {
  viewId: string;
  title: string;
  /** One per platform in wall.platforms. */
  cells: Partial<Record<PlatformId, PlatformCell>>;
  /** Endpoints first, then models; each by title. */
  touches: WallTouch[];
  /** Strip ids the view appears in, in strip order. */
  stripIds: string[];
}

export type WallItem =
  | { kind: "frame"; id: string; viewId: string }
  | { kind: "jump"; id: string; flowId: string; title: string; screenCount: number }
  | { kind: "arm"; id: string; branch: "condition" | "junction"; label: string; arm: string; first: boolean; empty: boolean }
  | { kind: "end"; id: string }
  | { kind: "empty"; id: string };

export interface WallStrip {
  /** `strip:<flowId>`, or `strip:loose`. */
  id: string;
  flowId: string | null;
  title: string;
  items: WallItem[];
  /** Distinct views in the strip, in first-appearance order. */
  viewIds: string[];
}

export interface Wall {
  strips: WallStrip[];
  screens: ReadonlyMap<string, WallScreen>;
  /** The scope's menu, in PLATFORMS order: the lens options and the side-by-side rows. */
  platforms: PlatformId[];
  /** "nothing": no flow and no view in scope. "no-flows": views but no flow. */
  empty: "nothing" | "no-flows" | null;
  /** True when any screen has any shot on any platform. */
  anyShot: boolean;
}

export interface StripCounts {
  /** Distinct views in the strip. */
  views: number;
  perPlatform: Partial<Record<PlatformId, { on: number; live: number }>>;
  /** Distinct (view, lens platform) pairs. */
  stale: number;
  noShot: number;
}

export const LOOSE_STRIP_ID = "strip:loose";

/** The strip id of a flow's strip; also its header's box id and React Flow node id. */
export function stripIdOf(flowId: string): string {
  return `strip:${flowId}`;
}

const LOOSE_TITLE = "Not in a flow";

type ArmItem = Extract<WallItem, { kind: "arm" }>;
type JumpItem = Extract<WallItem, { kind: "jump" }>;

export function buildWall(input: WallInput): Wall {
  const { nodes, edges, project, definition, scope, graph } = input;

  // Rule 1: the candidates are the map's scoped nodes. The Journey's
  // selection computes exactly `mapScopedNodes(definition, nodes,
  // scope.productId, graph)` as its `nodes`, so it is read from there.
  const selection = resolveJourneySelection({
    definition: { product: definition?.product },
    dataNodes: nodes,
    dataEdges: edges,
    project,
    scope,
    graph,
  });
  const candidates = selection.nodes;
  const flowsById = new Map<string, DataNode>();
  const viewsById = new Map<string, DataNode>();
  for (const candidate of candidates) {
    if (candidate.species === "flow") flowsById.set(candidate.id, candidate);
    else if (candidate.species === "view") viewsById.set(candidate.id, candidate);
  }

  const platforms = PLATFORMS.map((platform) => platform.id).filter((id) => scope.platforms.includes(id));
  const empty = flowsById.size === 0 ? (viewsById.size === 0 ? "nothing" : "no-flows") : null;

  const strips: WallStrip[] = [];
  for (const flowId of orderFlows(selection, flowsById)) {
    const flowNode = flowsById.get(flowId)!;
    const items = stripItems(flowNode, flowsById, viewsById);
    strips.push({ id: stripIdOf(flowId), flowId, title: flowNode.title, items, viewIds: viewIdsOf(items) });
  }

  // Jump tiles count the distinct views of their target's own strip, which
  // exists for every candidate flow (rules 2 and 3 visit all of them).
  const viewCountByFlow = new Map(strips.map((strip) => [strip.flowId, strip.viewIds.length]));
  for (const strip of strips) {
    for (const item of strip.items) {
      if (item.kind === "jump") item.screenCount = viewCountByFlow.get(item.flowId) ?? 0;
    }
  }

  // Rule 4: the scoped views no strip lists, by title then id.
  const listed = new Set(strips.flatMap((strip) => strip.viewIds));
  const loose = [...viewsById.values()]
    .filter((candidate) => !listed.has(candidate.id))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || compareIds(a.id, b.id));
  if (loose.length > 0) {
    const items: WallItem[] = loose.map((candidate) => ({ kind: "frame", id: `${candidate.id}@loose`, viewId: candidate.id }));
    strips.push({ id: LOOSE_STRIP_ID, flowId: null, title: LOOSE_TITLE, items, viewIds: loose.map((candidate) => candidate.id) });
  }

  const screens = buildScreens(input, viewsById, strips, platforms);
  const anyShot = [...screens.values()].some((screen) => Object.values(screen.cells).some((cell) => cell?.shot));
  return { strips, screens, platforms, empty, anyShot };
}

/** Every frame id showing the view, strip order then item order; [] if none. */
export function frameIdsOf(wall: Wall, viewId: string): string[] {
  const ids: string[] = [];
  for (const strip of wall.strips) {
    for (const item of strip.items) {
      if (item.kind === "frame" && item.viewId === viewId) ids.push(item.id);
    }
  }
  return ids;
}

/**
 * Rules 2 and 3: the Journey's flows first, in the order the Journey lays them
 * out with everything expanded, then every other candidate flow in snapshot
 * order. Visiting a flow appends it once, then visits the sub-flows its
 * playlist reaches, depth first, arms in order.
 */
function orderFlows(selection: ReturnType<typeof resolveJourneySelection>, flowsById: ReadonlyMap<string, DataNode>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (flowId: string) => {
    const flowNode = flowsById.get(flowId);
    if (!flowNode || seen.has(flowId)) return;
    seen.add(flowId);
    order.push(flowId);
    for (const subFlowId of subFlowIds(entriesOf(flowNode))) visit(subFlowId);
  };

  if (selection.anchorNode?.species === "flow") visit(selection.anchorNode.id);
  for (const { child } of selection.composeClosure.pairs) {
    if (child.species === "flow") visit(child.id);
  }
  if (selection.anchorNode === null && selection.productId === null) {
    for (const candidate of selection.nodes) {
      if (candidate.species === "flow" && !selection.composeParentByChild.has(candidate.id)) visit(candidate.id);
    }
  }

  for (const flowId of flowsById.keys()) {
    if (!seen.has(flowId)) {
      seen.add(flowId);
      order.push(flowId);
    }
  }
  return order;
}

/** The sub-flow ids a playlist lists, in entry order, arms in order. */
function subFlowIds(entries: readonly PlaylistEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.type === "flow") ids.push(entry.flow_id);
    else if (entry.type === "condition" || entry.type === "junction") {
      for (const arm of armsOf(entry)) ids.push(...subFlowIds(arm.entries));
    }
  }
  return ids;
}

/** Rule 5: a flow's playlist as strip items; ids carry the entry's index path. */
function stripItems(
  flowNode: DataNode,
  flowsById: ReadonlyMap<string, DataNode>,
  viewsById: ReadonlyMap<string, DataNode>,
): WallItem[] {
  const flowId = flowNode.id;
  const items: WallItem[] = [];

  const walk = (entries: readonly PlaylistEntry[], prefix: string) => {
    entries.forEach((entry, index) => {
      if (!entry) return;
      const path = prefix === "" ? String(index) : `${prefix}.${index}`;
      if (entry.type === "view") {
        if (viewsById.has(entry.view_id)) {
          items.push({ kind: "frame", id: createVisualNodeId(entry.view_id, `${flowId}:${path}`), viewId: entry.view_id });
        }
        return;
      }
      if (entry.type === "flow") {
        const target = flowsById.get(entry.flow_id);
        if (target) {
          const jump: JumpItem = { kind: "jump", id: `jump:${flowId}:${path}`, flowId: target.id, title: target.title, screenCount: 0 };
          items.push(jump);
        }
        return;
      }
      if (entry.type !== "condition" && entry.type !== "junction") return;
      armsOf(entry).forEach((arm, armIndex) => {
        const marker: ArmItem = {
          kind: "arm",
          id: `arm:${flowId}:${path}.${armIndex}`,
          branch: entry.type,
          label: entry.label,
          arm: arm.label,
          first: armIndex === 0,
          empty: false,
        };
        items.push(marker);
        const before = items.length;
        walk(arm.entries, `${path}.${armIndex}`);
        marker.empty = items.length === before;
      });
      items.push({ kind: "end", id: `end:${flowId}:${path}` });
    });
  };

  walk(entriesOf(flowNode), "");
  if (items.length === 0) items.push({ kind: "empty", id: `empty:${flowId}` });
  return items;
}

function armsOf(entry: Extract<PlaylistEntry, { type: "condition" | "junction" }>): { label: string; entries: readonly PlaylistEntry[] }[] {
  if (entry.type === "condition") {
    return [
      { label: "Yes", entries: Array.isArray(entry.if_true) ? entry.if_true : [] },
      { label: "No", entries: Array.isArray(entry.if_false) ? entry.if_false : [] },
    ];
  }
  return (Array.isArray(entry.cases) ? entry.cases : []).map((playlistCase) => ({
    label: playlistCase.label,
    entries: Array.isArray(playlistCase.entries) ? playlistCase.entries : [],
  }));
}

function entriesOf(flowNode: DataNode): readonly PlaylistEntry[] {
  const entries = flowNode.metadata?.playlist?.entries;
  return Array.isArray(entries) ? entries : [];
}

function viewIdsOf(items: readonly WallItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind === "frame" && !ids.includes(item.viewId)) ids.push(item.viewId);
  }
  return ids;
}

/** One screen per scoped view, in snapshot order, with a cell per wall platform. */
function buildScreens(
  input: WallInput,
  viewsById: ReadonlyMap<string, DataNode>,
  strips: readonly WallStrip[],
  platforms: readonly PlatformId[],
): Map<string, WallScreen> {
  const touchesByView = indexTouches(input.nodes, input.edges);
  const { coveringByView, coversByTarget } = indexCovering(input.nodes, input.edges);
  const journal = indexEvents(input.events);
  const screens = new Map<string, WallScreen>();
  for (const viewNode of viewsById.values()) {
    const covering = coveringByView.get(viewNode.id) ?? [];
    // The app's own rule, handed only what it reads for this view: its
    // covering acceptances and the covers edges that point at it — the same
    // answer as the whole snapshot, without scanning it once per view.
    const statuses = getEffectivePlatformStatuses(viewNode, covering, coversByTarget.get(viewNode.id) ?? []);
    const onPlatforms = scopedPlatforms(viewNode, input.scope);
    const cells: Partial<Record<PlatformId, PlatformCell>> = {};
    for (const platform of platforms) {
      cells[platform] = cellOf(viewNode, platform, {
        on: onPlatforms.includes(platform),
        status: statuses[platform] ?? null,
        related: stalenessRelatedIds(covering, platform),
        deciding: covering.filter((ac) => resolvePlatformStatus(ac, platform) === "live").map((ac) => ac.id),
        journal,
      });
    }
    screens.set(viewNode.id, {
      viewId: viewNode.id,
      title: viewNode.title,
      cells,
      touches: touchesByView.get(viewNode.id) ?? [],
      stripIds: strips.filter((strip) => strip.viewIds.includes(viewNode.id)).map((strip) => strip.id),
    });
  }
  return screens;
}

/** What each view touches: outbound `calls` to endpoints, `displays` to models (spec F5). */
function indexTouches(nodes: readonly DataNode[], edges: readonly DataEdge[]): Map<string, WallTouch[]> {
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const byView = new Map<string, WallTouch[]>();
  for (const edge of edges) {
    const wanted = edge.edge_type === "calls" ? "api-endpoint" : edge.edge_type === "displays" ? "data-model" : null;
    if (wanted === null) continue;
    const source = nodesById.get(edge.source_id);
    const target = nodesById.get(edge.target_id);
    if (source?.species !== "view" || target?.species !== wanted) continue;
    const touches = byView.get(source.id) ?? [];
    if (touches.some((touch) => touch.nodeId === target.id)) continue;
    touches.push({ nodeId: target.id, species: wanted, title: target.title, status: target.status });
    byView.set(source.id, touches);
  }
  for (const touches of byView.values()) {
    touches.sort(
      (a, b) =>
        (a.species === b.species ? 0 : a.species === "api-endpoint" ? -1 : 1) ||
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
        compareIds(a.nodeId, b.nodeId),
    );
  }
  return byView;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The journal bucketed once: events by the node they name, and shipped
 * deliverables by each id in their `node_ids` — so a cell reads only the
 * events that can name it, however long the journal grows.
 */
interface JournalIndex {
  byNode: ReadonlyMap<string, JournalEvent[]>;
  shippedByNode: ReadonlyMap<string, JournalEvent[]>;
}

function indexEvents(events: readonly JournalEvent[]): JournalIndex {
  const byNode = new Map<string, JournalEvent[]>();
  const shippedByNode = new Map<string, JournalEvent[]>();
  for (const ev of events) {
    if (ev.type === "deliverable.shipped") {
      if (!Array.isArray(ev.node_ids)) continue;
      for (const id of new Set(ev.node_ids)) {
        if (typeof id !== "string") continue;
        const bucket = shippedByNode.get(id) ?? [];
        bucket.push(ev);
        shippedByNode.set(id, bucket);
      }
      continue;
    }
    if (typeof ev.node_id !== "string") continue;
    const bucket = byNode.get(ev.node_id) ?? [];
    bucket.push(ev);
    byNode.set(ev.node_id, bucket);
  }
  return { byNode, shippedByNode };
}

/**
 * The acceptances covering each anchor, in snapshot order — `acceptancesCovering`,
 * indexed once — and the covers edges by target, in edge order.
 */
function indexCovering(
  nodes: readonly DataNode[],
  edges: readonly DataEdge[],
): { coveringByView: Map<string, DataNode[]>; coversByTarget: Map<string, DataEdge[]> } {
  const anchorsBySource = new Map<string, string[]>();
  const coversByTarget = new Map<string, DataEdge[]>();
  for (const edge of edges) {
    if (edge.edge_type !== "covers") continue;
    const covers = coversByTarget.get(edge.target_id) ?? [];
    covers.push(edge);
    coversByTarget.set(edge.target_id, covers);
    const anchors = anchorsBySource.get(edge.source_id) ?? [];
    if (!anchors.includes(edge.target_id)) anchors.push(edge.target_id);
    anchorsBySource.set(edge.source_id, anchors);
  }
  const byAnchor = new Map<string, DataNode[]>();
  for (const candidate of nodes) {
    if (candidate.species !== "acceptance") continue;
    for (const anchorId of anchorsBySource.get(candidate.id) ?? []) {
      const covering = byAnchor.get(anchorId) ?? [];
      covering.push(candidate);
      byAnchor.set(anchorId, covering);
    }
  }
  return { coveringByView: byAnchor, coversByTarget };
}

interface CellContext {
  /** The platform is in `scopedPlatforms(view, scope)`. */
  on: boolean;
  status: StatusId | null;
  /** The covering acceptances that list the platform. */
  related: readonly string[];
  /** Those of them live on the platform: the only ones that say how the cell went live. */
  deciding: readonly string[];
  journal: JournalIndex;
}

/** The state truth table (spec § State truth table) for one view on one platform. */
function cellOf(viewNode: DataNode, platform: PlatformId, context: CellContext): PlatformCell {
  const { on, status, related, deciding, journal } = context;
  const value = viewNode.metadata?.platformScreenshots?.[platform];
  const meta = viewNode.metadata?.platformScreenshotMeta?.[platform];
  const shot = typeof value === "string" && value !== "" ? shotOf(value, meta) : null;
  const base = { platform, status, shot, staleBecause: [] as StaleReason[], proof: null };

  if (!on) return { ...base, state: "absent" };
  if (status !== "live") return { ...base, state: "not-live" };

  const proof = proofOf(viewNode.id, deciding, platform, journal);
  if (!shot) return { ...base, state: "live-no-shot", proof };

  // A deliverable naming the view and one of its acceptances is one event, counted once.
  const shipped = new Set<JournalEvent>();
  for (const id of [viewNode.id, ...related]) {
    for (const ev of journal.shippedByNode.get(id) ?? []) shipped.add(ev);
  }
  const events = [
    ...(journal.byNode.get(viewNode.id) ?? []),
    ...related.flatMap((id) => journal.byNode.get(id) ?? []),
    ...shipped,
  ];
  const ids = new Set([viewNode.id, ...related]);
  const staleBecause = staleReasons(meta, events, viewNode.id, platform, related).map((ev) => reasonOf(ev, viewNode.id, ids));
  return { ...base, state: staleBecause.length > 0 ? "live-stale" : "live-current", staleBecause, proof };
}

function shotOf(value: string, meta: { ts?: string; source?: string; form?: string; commit?: string } | undefined): WallShot {
  const form: ShotForm =
    meta?.form === "url" || meta?.form === "data" || meta?.form === "path"
      ? meta.form
      : value.startsWith("data:image/")
        ? "data"
        : /^https?:\/\//i.test(value)
          ? "url"
          : "path";
  return {
    value,
    form,
    source: meta?.source === "ci" || meta?.source === "manual" ? meta.source : null,
    ts: typeof meta?.ts === "string" ? meta.ts : null,
    commit: typeof meta?.commit === "string" ? meta.commit : null,
  };
}

/** A stale event, in words built from ids, status and platform labels, and a deliverable's own title. */
function reasonOf(ev: JournalEvent, viewId: string, ids: ReadonlySet<string>): StaleReason {
  if (ev.type === "deliverable.shipped") {
    const named = Array.isArray(ev.node_ids) ? ev.node_ids.filter((id): id is string => typeof id === "string") : [];
    const nodeId = named.includes(viewId) ? viewId : named.find((id) => ids.has(id)) ?? viewId;
    const title =
      typeof ev.title === "string" && ev.title.trim() !== ""
        ? ev.title
        : typeof ev.deliverable_id === "string"
          ? ev.deliverable_id
          : "a deliverable";
    return { eventId: ev.id, ts: ev.ts, kind: "shipped", nodeId, label: `Shipped: ${title}` };
  }
  const nodeId = String(ev.node_id);
  if (ev.type === "ref.status_changed") {
    return {
      eventId: ev.id,
      ts: ev.ts,
      kind: "merge",
      nodeId,
      label: nodeId === viewId ? "Pull request merged" : `Pull request merged on ${nodeId}`,
    };
  }
  const to = STATUSES.find((entry) => entry.id === ev.to)?.label ?? String(ev.to);
  const on = ev.platform === undefined ? "" : ` on ${platformLabel(ev.platform)}`;
  return { eventId: ev.id, ts: ev.ts, kind: "status", nodeId, label: `${nodeId} moved to ${to}${on}` };
}

/**
 * How a live cell went live (spec § Live proof). Uncovered: by hand, since the
 * deploy door refuses views. Covered: each covering acceptance live on the
 * platform has its latest move to live there (or project-wide) read — a deploy
 * when CI wrote it or it carries `detail`; the cell is a deploy only if every
 * one is. An archived acceptance leaves the view live and decides nothing.
 * A live covered cell always has one live acceptance (the weakest status of
 * the listing ones is live), so `deciding` is empty only when uncovered.
 */
function proofOf(viewId: string, deciding: readonly string[], platform: PlatformId, journal: JournalIndex): LiveProof {
  if (deciding.length === 0) {
    return { kind: "hand", ...evidenceOf(latestMoveToLive(journal.byNode.get(viewId) ?? [], platform)) };
  }
  const deploys: JournalEvent[] = [];
  const hands: JournalEvent[] = [];
  let unproven = false;
  for (const id of deciding) {
    const ev = latestMoveToLive(journal.byNode.get(id) ?? [], platform);
    if (!ev) unproven = true;
    else if (ev.actor === "arkaik-ci" || (typeof ev.detail === "string" && ev.detail.trim() !== "")) deploys.push(ev);
    else hands.push(ev);
  }
  if (hands.length > 0) return { kind: "hand", ...evidenceOf(newest(hands)) };
  if (!unproven) return { kind: "deploy", ...evidenceOf(newest(deploys)) };
  return { kind: "unknown", ts: null, actor: null, detail: null };
}

function latestMoveToLive(events: readonly JournalEvent[], platform: PlatformId): JournalEvent | null {
  return newest(
    events.filter(
      (ev) =>
        ev.type === "node.status_changed" &&
        ev.to === "live" &&
        typeof ev.ts === "string" &&
        (ev.platform === undefined || ev.platform === platform),
    ),
  );
}

function newest(events: readonly JournalEvent[]): JournalEvent | null {
  let best: JournalEvent | null = null;
  for (const ev of events) {
    if (best === null || ev.ts > best.ts || (ev.ts === best.ts && ev.id > best.id)) best = ev;
  }
  return best;
}

function evidenceOf(ev: JournalEvent | null): Omit<LiveProof, "kind"> {
  return {
    ts: ev?.ts ?? null,
    actor: typeof ev?.actor === "string" ? ev.actor : null,
    detail: typeof ev?.detail === "string" && ev.detail !== "" ? ev.detail : null,
  };
}

/* --- Counts, gaps, lens (spec § Counts and gaps) -------------------------- */

/** [lens] for a platform lens; wall.platforms for "side". */
export function lensPlatforms(wall: Wall, lens: WallLens): PlatformId[] {
  return lens === "side" ? [...wall.platforms] : [lens];
}

/** A gap: live with a stale shot, or live with no shot. */
export function isGapCell(cell: PlatformCell): boolean {
  return cell.state === "live-stale" || cell.state === "live-no-shot";
}

export function isGapFrame(wall: Wall, viewId: string, lens: WallLens): boolean {
  const screen = wall.screens.get(viewId);
  if (!screen) return false;
  return lensPlatforms(wall, lens).some((platform) => {
    const cell = screen.cells[platform];
    return cell !== undefined && isGapCell(cell);
  });
}

/** Distinct (view, lens platform) pairs that are gaps, over the whole wall. */
export function gapCount(wall: Wall, lens: WallLens): number {
  let count = 0;
  for (const screen of wall.screens.values()) {
    for (const platform of lensPlatforms(wall, lens)) {
      const cell = screen.cells[platform];
      if (cell !== undefined && isGapCell(cell)) count += 1;
    }
  }
  return count;
}

export function countStrip(wall: Wall, strip: WallStrip, lens: WallLens): StripCounts {
  const counts: StripCounts = { views: strip.viewIds.length, perPlatform: {}, stale: 0, noShot: 0 };
  for (const platform of lensPlatforms(wall, lens)) {
    const tally = { on: 0, live: 0 };
    for (const viewId of strip.viewIds) {
      const cell = wall.screens.get(viewId)?.cells[platform];
      if (!cell || cell.state === "absent") continue;
      tally.on += 1;
      if (cell.state === "not-live") continue;
      tally.live += 1;
      if (cell.state === "live-stale") counts.stale += 1;
      if (cell.state === "live-no-shot") counts.noShot += 1;
    }
    counts.perPlatform[platform] = tally;
  }
  return counts;
}

/**
 * The lens to render: with fewer than two platforms, the only one (web for an
 * empty menu); otherwise the stored lens when the wall has it, else the first.
 */
export function resolveLens(stored: WallLens | null, wall: Wall): WallLens {
  if (wall.platforms.length < 2) return wall.platforms[0] ?? "web";
  if (stored === "side" || (stored !== null && wall.platforms.includes(stored))) return stored;
  return wall.platforms[0];
}

/** The truth table's side-by-side word: "Live" | "Stale" | "No shot" | "Unset" | "Absent" | a status label. */
export function cellWord(cell: PlatformCell): string {
  switch (cell.state) {
    case "live-current":
      return "Live";
    case "live-stale":
      return "Stale";
    case "live-no-shot":
      return "No shot";
    case "absent":
      return "Absent";
    case "not-live":
      return cell.status === null ? "Unset" : STATUSES.find((entry) => entry.id === cell.status)?.label ?? cell.status;
  }
}

/** R9 header text: "3/5 live on iOS · 1 stale · 2 without a shot", or "Web 3/5 · iOS 4/5 · …" for "side". */
export function stripCountsLine(wall: Wall, strip: WallStrip, lens: WallLens): string {
  const counts = countStrip(wall, strip, lens);
  const tally = (platform: PlatformId) => counts.perPlatform[platform] ?? { on: 0, live: 0 };
  const parts =
    lens === "side"
      ? lensPlatforms(wall, lens).map((platform) => `${platformLabel(platform)} ${tally(platform).live}/${tally(platform).on}`)
      : [`${tally(lens).live}/${tally(lens).on} live on ${platformLabel(lens)}`];
  if (counts.stale > 0) parts.push(`${counts.stale} stale`);
  if (counts.noShot > 0) parts.push(`${counts.noShot} without a shot`);
  return parts.join(" · ");
}
