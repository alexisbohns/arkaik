/**
 * The v1 tool catalog (docs/spec/mcp.md § Tool Catalog) — read tools are
 * projections, write tools follow the validator-gated dual-write path
 * (store.ts). Every result is JSON text; every schema enum comes from
 * `@arkaik/schema` ids so the catalog can't drift from the format.
 */

import {
  EDGE_TYPE_IDS,
  PLATFORM_IDS,
  SPECIES_IDS,
  STATUS_IDS,
  VALUE_IDS,
  acceptancesCovering,
  collectPlaylistNodeRefs,
  computeBacklog,
  computeChangelog,
  computeMapSubgraph,
  computeNodeTimeline,
  deriveNodeId,
  edgeId,
  hasParityGap,
  listMaps,
  orderEvents,
  resolvePlatformStatus,
  type Edge,
  type EventInput,
  type JournalEvent,
  type Node,
  type Project,
  type ReleaseTaggedEvent,
  type ValueId,
} from "@arkaik/schema";
import {
  diffNodeUpdate,
  edgeAddedInput,
  edgeRemovedInput,
  nodeCreatedInput,
  nodeDeletedInput,
} from "@arkaik/schema";
import type { BundleValidation } from "arkaik/io";
import { ToolError, type ToolDefinition, type ToolHandler } from "./protocol";
import { loadBundle, persistMutation, type WriteResult } from "./store";

interface ToolContext {
  bundlePath: string;
}

interface LoadedGraph {
  loaded: BundleValidation;
  nodes: Node[];
  edges: Edge[];
  project: Project;
  journal: JournalEvent[];
}

function load(ctx: ToolContext): LoadedGraph {
  let loaded: BundleValidation;
  try {
    loaded = loadBundle(ctx.bundlePath);
  } catch (error) {
    throw new ToolError(`Cannot load bundle at ${ctx.bundlePath}: ${(error as Error).message}`);
  }
  return {
    loaded,
    nodes: loaded.nodes as Node[],
    edges: loaded.edges as Edge[],
    project: (loaded.bundle as { project: Project }).project,
    journal: loaded.journal as JournalEvent[],
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolError(`\`${key}\` is required and must be a non-empty string.`);
  }
  return value;
}

function findNode(nodes: Node[], nodeId: string): Node {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new ToolError(`No node with id "${nodeId}".`);
  return node;
}

function nodeSummary(node: Node) {
  const base = { id: node.id, title: node.title, species: node.species, status: node.status, platforms: node.platforms };
  if (node.species !== "acceptance") return base;
  // Acceptances are the parity unit — without resolved per-platform statuses
  // and values in the summary, reading parity costs one get_node per node.
  const platform_statuses = Object.fromEntries(
    node.platforms.map((platform) => [platform, resolvePlatformStatus(node, platform)]),
  );
  return { ...base, platform_statuses, values: node.metadata?.values ?? [] };
}

/** Unwrap a write result: refusals become isError tool results with the pathed findings. */
function unwrap(result: WriteResult): { warnings: unknown[]; events: JournalEvent[] } {
  if (!result.ok) {
    throw new ToolError("Mutation refused by validateBundle — nothing was written.", {
      findings: result.errors,
      warnings: result.warnings,
    });
  }
  return { warnings: result.warnings, events: result.events };
}

const UPDATABLE_NODE_FIELDS = new Set(["title", "description", "status", "platforms", "metadata"]);

/**
 * The `composes` edges a flow's playlist requires but that don't exist yet
 * (docs/spec/mcp.md § Write Path — Playlist composition). Without this, a flow
 * cannot be created with a populated playlist in a single validated mutation
 * (issue #263): `validateBundle`'s `playlist-composes-coherence` rule demands a
 * `composes` edge for every referenced view/sub-flow, but `add_edge` cannot
 * create those until the flow node exists — a deadlock no call ordering
 * escapes. `create_node`/`update_node` synthesize the missing edges (flow → each
 * referenced view/sub-flow) and fold them into the same gated write, mirroring
 * what the app's playlist editor already does (JourneyMap.tsx). Edges that
 * already exist are left untouched; a duplicate reference yields one edge.
 */
function synthesizeComposesEdges(flow: Node, existingEdges: Edge[], projectId: string): Edge[] {
  if (flow.species !== "flow") return [];
  const entries = flow.metadata?.playlist?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const existingIds = new Set(existingEdges.map((edge) => edge.id));
  const seen = new Set<string>();
  const synthesized: Edge[] = [];
  for (const refId of collectPlaylistNodeRefs(entries)) {
    const id = edgeId(flow.id, refId);
    if (existingIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    synthesized.push({
      id,
      project_id: projectId,
      source_id: flow.id,
      target_id: refId,
      edge_type: "composes",
    });
  }
  return synthesized;
}

/** Release list for `get_changelog` with no version: newest first by each version's latest marker. */
function listReleases(journal: JournalEvent[], nodesById: Map<string, Node>) {
  const latestByVersion = new Map<string, ReleaseTaggedEvent>();
  for (const event of orderEvents(journal)) {
    if (event.type !== "release.tagged") continue;
    const tag = event as ReleaseTaggedEvent;
    latestByVersion.set(tag.version, tag);
  }
  return [...latestByVersion.values()]
    .sort((a, b) => (a.ts === b.ts ? (a.id < b.id ? 1 : -1) : a.ts < b.ts ? 1 : -1))
    .map((tag) => ({
      version: tag.version,
      ts: tag.ts,
      ...(tag.platform !== undefined ? { platform: tag.platform } : {}),
      ...(tag.notes !== undefined ? { notes: tag.notes } : {}),
      eventCount: computeChangelog(journal, tag.version, { nodesById }).events.length,
    }));
}

export function buildCatalog(ctx: ToolContext): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};

  const tool = (definition: ToolDefinition, handler: ToolHandler) => {
    tools.push(definition);
    handlers[definition.name] = handler;
  };

  // ---- Read tools -----------------------------------------------------------

  tool(
    {
      name: "list_nodes",
      description:
        "List nodes in the product graph, filtered by species, status, platform, value element, covers-anchor, parity gap, and/or a case-insensitive title/description substring. Returns summaries (acceptances include platform_statuses + values).",
      inputSchema: {
        type: "object",
        properties: {
          species: { type: "string", enum: [...SPECIES_IDS] },
          status: { type: "string", enum: [...STATUS_IDS] },
          platform: { type: "string", enum: [...PLATFORM_IDS] },
          value: {
            type: "string",
            enum: [...VALUE_IDS],
            description: "Only acceptances tagged with this value element.",
          },
          anchor: {
            type: "string",
            description: "Node id — only acceptances covering it via a covers edge.",
          },
          parity_gap: {
            type: "boolean",
            description: "Only acceptances delivered (live) on ≥1 applicable platform but not all.",
          },
          query: { type: "string", description: "Case-insensitive substring over title + description." },
          limit: { type: "integer", minimum: 1, description: "Default 50." },
        },
        additionalProperties: false,
      },
    },
    (args) => {
      const { nodes, edges } = load(ctx);
      const query = typeof args.query === "string" ? args.query.toLowerCase() : undefined;
      const limit = typeof args.limit === "number" && args.limit >= 1 ? Math.floor(args.limit) : 50;
      const anchorCoveringIds =
        typeof args.anchor === "string"
          ? new Set(acceptancesCovering(args.anchor, nodes, edges).map((node) => node.id))
          : undefined;

      const matches = nodes.filter((node) => {
        if (typeof args.species === "string" && node.species !== args.species) return false;
        if (typeof args.status === "string" && node.status !== args.status) return false;
        if (typeof args.platform === "string" && !node.platforms.includes(args.platform as Node["platforms"][number]))
          return false;
        if (typeof args.value === "string" && (node.species !== "acceptance" || !(node.metadata?.values ?? []).includes(args.value as ValueId))) return false;
        if (anchorCoveringIds !== undefined && !anchorCoveringIds.has(node.id)) return false;
        if (args.parity_gap === true && (node.species !== "acceptance" || !hasParityGap(node))) return false;
        if (query !== undefined) {
          const haystack = `${node.title}\n${node.description ?? ""}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      });

      return { total: matches.length, nodes: matches.slice(0, limit).map(nodeSummary) };
    },
  );

  tool(
    {
      name: "get_node",
      description:
        "Fetch one node in full: fields, its edges with neighbor titles, the flows that use it, its journal timeline, and (views/flows) the acceptances covering it.",
      inputSchema: {
        type: "object",
        properties: { node_id: { type: "string" } },
        required: ["node_id"],
        additionalProperties: false,
      },
    },
    (args) => {
      const nodeId = requireString(args, "node_id");
      const { nodes, edges, journal } = load(ctx);
      const node = findNode(nodes, nodeId);
      const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]));

      const relatedEdges = edges
        .filter((edge) => edge.source_id === nodeId || edge.target_id === nodeId)
        .map((edge) => {
          const otherId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
          const other = nodesById.get(otherId);
          return {
            id: edge.id,
            edge_type: edge.edge_type,
            direction: edge.source_id === nodeId ? "out" : "in",
            other: other ? { id: other.id, title: other.title, species: other.species } : { id: otherId },
          };
        });

      // "Where used": flows composing this node, plus flows whose playlist references it.
      const composingFlowIds = new Set(
        edges
          .filter((edge) => edge.edge_type === "composes" && edge.target_id === nodeId)
          .map((edge) => edge.source_id),
      );
      for (const candidate of nodes) {
        if (candidate.species !== "flow") continue;
        const playlist = candidate.metadata?.playlist;
        if (playlist !== undefined && JSON.stringify(playlist).includes(`"${nodeId}"`)) {
          composingFlowIds.add(candidate.id);
        }
      }
      const whereUsedFlows = [...composingFlowIds]
        .map((flowId) => nodesById.get(flowId))
        .filter((flow): flow is Node => flow !== undefined && flow.species === "flow")
        .map((flow) => ({ id: flow.id, title: flow.title }));

      const covered_by =
        node.species === "view" || node.species === "flow"
          ? acceptancesCovering(nodeId, nodes, edges).map(nodeSummary)
          : undefined;

      return {
        node,
        edges: relatedEdges,
        whereUsedFlows,
        timeline: computeNodeTimeline(journal, nodeId),
        ...(covered_by !== undefined ? { covered_by } : {}),
      };
    },
  );

  tool(
    {
      name: "get_changelog",
      description:
        "Without a version: every tagged release, newest first, with change counts. With a version: that release's changelog slice.",
      inputSchema: {
        type: "object",
        properties: { version: { type: "string" } },
        additionalProperties: false,
      },
    },
    (args) => {
      const { nodes, journal } = load(ctx);
      const nodesById = new Map(nodes.map((node) => [node.id, node]));
      if (typeof args.version === "string") {
        return computeChangelog(journal, args.version, { nodesById });
      }
      return { releases: listReleases(journal, nodesById) };
    },
  );

  tool(
    {
      name: "get_backlog",
      description: "Open ideas and requests — journal items not yet realized as nodes in the snapshot.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    () => {
      const { nodes, journal } = load(ctx);
      return computeBacklog(journal, { existingNodeIds: new Set(nodes.map((node) => node.id)) });
    },
  );

  tool(
    {
      name: "list_maps",
      description: "Every map the project offers — built-ins plus stored definitions — with live subgraph sizes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    () => {
      const { nodes, edges, project } = load(ctx);
      return {
        maps: listMaps(project).map((definition) => {
          const subgraph = computeMapSubgraph(definition, nodes, edges);
          return { definition, nodeCount: subgraph.nodes.length, edgeCount: subgraph.edges.length };
        }),
      };
    },
  );

  tool(
    {
      name: "get_map",
      description: "Resolve a map definition (built-in or stored) and return its computed subgraph.",
      inputSchema: {
        type: "object",
        properties: { map_id: { type: "string" } },
        required: ["map_id"],
        additionalProperties: false,
      },
    },
    (args) => {
      const mapId = requireString(args, "map_id");
      const { nodes, edges, project } = load(ctx);
      const definition = listMaps(project).find((candidate) => candidate.id === mapId);
      if (!definition) throw new ToolError(`No map with id "${mapId}".`);
      const subgraph = computeMapSubgraph(definition, nodes, edges);
      return { definition, nodes: subgraph.nodes, edges: subgraph.edges };
    },
  );

  tool(
    {
      name: "validate_bundle",
      description: "Run the full validator over the bundle (+ journal sidecar): errors, warnings, and line findings.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    () => {
      const { loaded } = load(ctx);
      return {
        valid: loaded.valid,
        errors: loaded.result.errors,
        warnings: loaded.result.warnings,
        sidecarFindings: loaded.sidecarFindings,
      };
    },
  );

  // ---- Write tools (dual-write, validator-gated) ----------------------------

  tool(
    {
      name: "create_node",
      description:
        "Create a node. The id derives from species + title; the mutation is refused (nothing written) if the result fails validation. For a flow, pass its populated metadata.playlist here — the matching composes edges to every referenced view/sub-flow are synthesized in the same mutation, so a full flow lands in one call.",
      inputSchema: {
        type: "object",
        properties: {
          species: { type: "string", enum: [...SPECIES_IDS] },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: [...STATUS_IDS], description: "Default: idea." },
          platforms: { type: "array", items: { type: "string", enum: [...PLATFORM_IDS] } },
          metadata: { type: "object" },
        },
        required: ["species", "title", "platforms"],
        additionalProperties: false,
      },
    },
    (args) => {
      const graph = load(ctx);
      const species = requireString(args, "species") as Node["species"];
      const title = requireString(args, "title");
      const platforms = Array.isArray(args.platforms) ? (args.platforms as Node["platforms"]) : [];

      const node: Node = {
        id: deriveNodeId(species, title, graph.nodes.map((candidate) => candidate.id)),
        project_id: graph.project.id,
        title,
        species,
        status: typeof args.status === "string" ? (args.status as Node["status"]) : "idea",
        platforms,
        ...(typeof args.description === "string" ? { description: args.description } : {}),
        ...(typeof args.metadata === "object" && args.metadata !== null
          ? { metadata: args.metadata as Node["metadata"] }
          : {}),
      };

      // A flow's playlist requires composes edges the validator would otherwise
      // reject as missing (issue #263) — synthesize them into the same write.
      const synthesizedEdges = synthesizeComposesEdges(node, graph.edges, graph.project.id);
      const next =
        synthesizedEdges.length > 0
          ? { nodes: [...graph.nodes, node], edges: [...graph.edges, ...synthesizedEdges] }
          : { nodes: [...graph.nodes, node] };

      const result = persistMutation(ctx.bundlePath, graph.loaded, next, [
        nodeCreatedInput(node),
        ...synthesizedEdges.map(edgeAddedInput),
      ]);
      const { warnings, events } = unwrap(result);
      return { node, edges: synthesizedEdges, events, warnings };
    },
  );

  tool(
    {
      name: "update_node",
      description:
        "Patch a node's title, description, status, platforms, or metadata. Journal events derive from the diff; refused if validation fails. When a flow's metadata.playlist gains a view/sub-flow, the matching composes edge is synthesized in the same mutation.",
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string" },
          patch: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              status: { type: "string", enum: [...STATUS_IDS] },
              platforms: { type: "array", items: { type: "string", enum: [...PLATFORM_IDS] } },
              metadata: { type: "object" },
            },
            additionalProperties: false,
          },
        },
        required: ["node_id", "patch"],
        additionalProperties: false,
      },
    },
    (args) => {
      const nodeId = requireString(args, "node_id");
      if (typeof args.patch !== "object" || args.patch === null || Array.isArray(args.patch)) {
        throw new ToolError("`patch` is required and must be an object.");
      }
      const patch = args.patch as Partial<Node>;
      for (const key of Object.keys(patch)) {
        if (!UPDATABLE_NODE_FIELDS.has(key)) {
          throw new ToolError(`Field "${key}" cannot be patched (allowed: ${[...UPDATABLE_NODE_FIELDS].join(", ")}).`);
        }
      }

      const graph = load(ctx);
      const current = findNode(graph.nodes, nodeId);
      const inputs = diffNodeUpdate(current, patch);
      if (inputs.length === 0) {
        return { node: current, events: [], note: "No-op patch — nothing changed, nothing written." };
      }

      const updated: Node = { ...current, ...patch };
      const nextNodes = graph.nodes.map((candidate) => (candidate.id === nodeId ? updated : candidate));
      // Same composes-edge synthesis as create_node (issue #263): a playlist that
      // now references a view/sub-flow gets its composes edge in this write.
      const synthesizedEdges = synthesizeComposesEdges(updated, graph.edges, graph.project.id);
      const next =
        synthesizedEdges.length > 0 ? { nodes: nextNodes, edges: [...graph.edges, ...synthesizedEdges] } : { nodes: nextNodes };

      const result = persistMutation(ctx.bundlePath, graph.loaded, next, [
        ...inputs,
        ...synthesizedEdges.map(edgeAddedInput),
      ]);
      const { warnings, events } = unwrap(result);
      return { node: updated, edges: synthesizedEdges, events, warnings };
    },
  );

  tool(
    {
      name: "delete_node",
      description: "Delete a node and cascade its edges. Emits node.deleted (the edge cascade is implied).",
      inputSchema: {
        type: "object",
        properties: { node_id: { type: "string" } },
        required: ["node_id"],
        additionalProperties: false,
      },
    },
    (args) => {
      const nodeId = requireString(args, "node_id");
      const graph = load(ctx);
      const node = findNode(graph.nodes, nodeId);

      const cascadedEdgeIds = graph.edges
        .filter((edge) => edge.source_id === nodeId || edge.target_id === nodeId)
        .map((edge) => edge.id);
      const nextNodes = graph.nodes.filter((candidate) => candidate.id !== nodeId);
      const nextEdges = graph.edges.filter((edge) => !cascadedEdgeIds.includes(edge.id));

      const result = persistMutation(ctx.bundlePath, graph.loaded, { nodes: nextNodes, edges: nextEdges }, [
        nodeDeletedInput(nodeId),
      ]);
      const { warnings, events } = unwrap(result);
      return { removed: node, cascadedEdgeIds, events, warnings };
    },
  );

  tool(
    {
      name: "add_edge",
      description:
        "Connect two nodes. The edge id derives from the endpoints; a dangling or duplicate edge is refused by the validator.",
      inputSchema: {
        type: "object",
        properties: {
          source_id: { type: "string" },
          target_id: { type: "string" },
          edge_type: { type: "string", enum: [...EDGE_TYPE_IDS] },
        },
        required: ["source_id", "target_id", "edge_type"],
        additionalProperties: false,
      },
    },
    (args) => {
      const sourceId = requireString(args, "source_id");
      const targetId = requireString(args, "target_id");
      const edgeType = requireString(args, "edge_type") as Edge["edge_type"];
      const graph = load(ctx);

      const edge: Edge = {
        id: edgeId(sourceId, targetId),
        project_id: graph.project.id,
        source_id: sourceId,
        target_id: targetId,
        edge_type: edgeType,
      };
      if (graph.edges.some((candidate) => candidate.id === edge.id)) {
        throw new ToolError(`Edge "${edge.id}" already exists.`);
      }

      const result = persistMutation(ctx.bundlePath, graph.loaded, { edges: [...graph.edges, edge] }, [
        edgeAddedInput(edge),
      ]);
      const { warnings, events } = unwrap(result);
      return { edge, events, warnings };
    },
  );

  tool(
    {
      name: "remove_edge",
      description: "Remove an edge by id.",
      inputSchema: {
        type: "object",
        properties: { edge_id: { type: "string" } },
        required: ["edge_id"],
        additionalProperties: false,
      },
    },
    (args) => {
      const edgeIdArg = requireString(args, "edge_id");
      const graph = load(ctx);
      const edge = graph.edges.find((candidate) => candidate.id === edgeIdArg);
      if (!edge) throw new ToolError(`No edge with id "${edgeIdArg}".`);

      const nextEdges = graph.edges.filter((candidate) => candidate.id !== edgeIdArg);
      const result = persistMutation(ctx.bundlePath, graph.loaded, { edges: nextEdges }, [
        edgeRemovedInput(edgeIdArg),
      ]);
      const { warnings, events } = unwrap(result);
      return { removed: edge, events, warnings };
    },
  );

  const journalOnly = (type: "idea.proposed" | "request.filed") => (args: Record<string, unknown>) => {
    const title = requireString(args, "title");
    const graph = load(ctx);
    const payload: Record<string, unknown> = { title };
    if (typeof args.description === "string") payload.description = args.description;
    if (typeof args.node_id === "string") payload.node_id = args.node_id;
    if (type === "request.filed" && typeof args.source === "string") payload.source = args.source;

    const input: EventInput = { type, payload };
    const result = persistMutation(ctx.bundlePath, graph.loaded, {}, [input]);
    const { warnings, events } = unwrap(result);
    return { events, warnings };
  };

  tool(
    {
      name: "propose_idea",
      description: "Record an idea in the journal backlog (idea.proposed). Link it to a node once one exists.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          node_id: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
    journalOnly("idea.proposed"),
  );

  tool(
    {
      name: "file_request",
      description: "Record an external request in the journal backlog (request.filed).",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          source: { type: "string" },
          node_id: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
    journalOnly("request.filed"),
  );

  return { tools, handlers };
}
