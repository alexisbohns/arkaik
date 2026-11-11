import type { MapDefinition } from "@arkaik/schema";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { Edge as DataEdge, JournalEvent, Node as DataNode, PlaylistEntry, Project } from "@/lib/data/types";
import { createVisualNodeId } from "@/lib/utils/graph-build";
import { resolveJourneySelection } from "@/lib/utils/journey-graph";
import type { ProductGraph, ProductScope } from "@/lib/utils/product-scope";

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

  const screens = buildScreens(input, viewsById, strips);
  return { strips, screens, platforms, empty, anyShot: false };
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

/** One screen per scoped view, in snapshot order. */
function buildScreens(
  input: WallInput,
  viewsById: ReadonlyMap<string, DataNode>,
  strips: readonly WallStrip[],
): Map<string, WallScreen> {
  const touchesByView = indexTouches(input.nodes, input.edges);
  const screens = new Map<string, WallScreen>();
  for (const viewNode of viewsById.values()) {
    screens.set(viewNode.id, {
      viewId: viewNode.id,
      title: viewNode.title,
      cells: {},
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
