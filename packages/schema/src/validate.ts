import {
  EDGE_TYPE_IDS,
  PLATFORM_IDS,
  SPECIES_IDS,
  STATUS_IDS,
  type EdgeTypeId,
  type SpeciesId,
} from "./ids";
import type { PlaylistEntry } from "./playlist";

/**
 * Semantic validation for Arkaik ProjectBundles.
 *
 * These are the graph rules JSON Schema cannot express — duplicate IDs,
 * dangling edge endpoints, playlist↔composes coherence, flow cycles,
 * species/edge-type semantics — which is why zod/code is the canonical
 * definition (`docs/spec/toolchain.md` § @arkaik/schema). The rule set is a
 * faithful port of the standalone validator in
 * `docs/arkaik-skill/scripts/validate-bundle.js`; a parity fixture test keeps
 * the two in agreement.
 *
 * Deliberately zod-free (only plain ID lists from ./ids, no schema imports):
 * the esbuild-bundled standalone validator is built from this file, and
 * pulling zod in would bloat it for no benefit — this logic never calls into
 * zod at runtime. Shape parsing against the zod schemas lives in parse.ts.
 */

export type Severity = "error" | "warning";

/** A single validation finding with a JSON path, rule id, and severity. */
export interface ValidationFinding {
  /** JSON path to the offending value, e.g. `nodes[3].platforms`. */
  path: string;
  /** Stable rule identifier, e.g. `duplicate-node-id`. */
  rule: string;
  /** Human-readable description of the problem. */
  message: string;
  severity: Severity;
}

export interface ValidationResult {
  /** True when there are no `error`-severity findings. Warnings do not fail. */
  valid: boolean;
  /** All findings (errors and warnings), in the order they were detected. */
  findings: ValidationFinding[];
  /** The subset of `findings` with severity `error`. */
  errors: ValidationFinding[];
  /** The subset of `findings` with severity `warning`. */
  warnings: ValidationFinding[];
}

const SPECIES_PREFIXES: Record<string, string> = {
  flow: "F-",
  view: "V-",
  "data-model": "DM-",
  "api-endpoint": "API-",
};

const VALID_STAGES = ["beta", "monitoring", "deprecated"];
const VALID_VIEW_CARD_VARIANTS = ["compact", "large"];

const VALID_EDGE_SEMANTICS: Record<EdgeTypeId, ReadonlyArray<[SpeciesId, SpeciesId]>> = {
  composes: [
    ["flow", "view"],
    ["flow", "flow"],
    ["view", "flow"],
    ["view", "view"],
  ],
  calls: [
    ["view", "api-endpoint"],
    ["flow", "api-endpoint"],
  ],
  displays: [["view", "data-model"]],
  queries: [["api-endpoint", "data-model"]],
};

function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// Loose views over the bundle: validateBundle accepts unknown input and reports
// structural problems as findings rather than throwing, so it must not assume
// the strict types hold before the checks below have run.
type LooseNode = Record<string, unknown>;
type LooseEdge = Record<string, unknown>;

/**
 * Validate a ProjectBundle against the full semantic rule set. Returns
 * structured findings (JSON path + rule id + message + severity). Warnings do
 * not make a bundle invalid; only `error`-severity findings do.
 */
export function validateBundle(input: unknown): ValidationResult {
  const findings: ValidationFinding[] = [];
  const error = (path: string, rule: string, message: string) =>
    findings.push({ path, rule, message, severity: "error" });
  const warn = (path: string, rule: string, message: string) =>
    findings.push({ path, rule, message, severity: "warning" });

  const result = (): ValidationResult => {
    const errors = findings.filter((f) => f.severity === "error");
    const warnings = findings.filter((f) => f.severity === "warning");
    return { valid: errors.length === 0, findings, errors, warnings };
  };

  // --- Structural guards (mirror the standalone validator's FATAL checks) ---
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    error("", "bundle-shape", "Bundle must be an object with project, nodes, and edges.");
    return result();
  }

  const bundle = input as Record<string, unknown>;
  const project = bundle.project as Record<string, unknown> | undefined;
  const nodesRaw = bundle.nodes;
  const edgesRaw = bundle.edges;

  if (!project || !nodesRaw || !edgesRaw) {
    error("", "bundle-shape", "Missing top-level keys (project, nodes, edges).");
    return result();
  }
  if (!Array.isArray(nodesRaw)) {
    error("nodes", "bundle-shape", "nodes must be an array.");
    return result();
  }
  if (!Array.isArray(edgesRaw)) {
    error("edges", "bundle-shape", "edges must be an array.");
    return result();
  }

  const nodes = nodesRaw as LooseNode[];
  const edges = edgesRaw as LooseEdge[];

  const nodeMap = new Map<string, LooseNode>();
  const nodeIds = new Set<string>();

  // --- Project-level checks ---
  if (!project.id) error("project.id", "project-id-required", "project.id is missing");
  if (typeof project.title !== "string" || !project.title.trim()) {
    error("project.title", "title-non-empty", "project.title is missing or empty");
  }
  if (!project.created_at) {
    error("project.created_at", "timestamp-required", "project.created_at is missing");
  }
  if (!project.updated_at) {
    error("project.updated_at", "timestamp-required", "project.updated_at is missing");
  }
  if (project.created_at && !isIsoDate(project.created_at)) {
    warn("project.created_at", "iso-timestamp", "project.created_at is not a valid ISO 8601 timestamp");
  }
  if (project.updated_at && !isIsoDate(project.updated_at)) {
    warn("project.updated_at", "iso-timestamp", "project.updated_at is not a valid ISO 8601 timestamp");
  }
  const projectMetadata = project.metadata as Record<string, unknown> | undefined;
  if (
    projectMetadata &&
    projectMetadata.view_card_variant !== undefined &&
    !VALID_VIEW_CARD_VARIANTS.includes(projectMetadata.view_card_variant as string)
  ) {
    error(
      "project.metadata.view_card_variant",
      "view-card-variant",
      `project.metadata.view_card_variant must be one of ${VALID_VIEW_CARD_VARIANTS.join(", ")} (import rejects other values)`,
    );
  }

  // --- Node checks ---
  nodes.forEach((node, i) => {
    const base = `nodes[${i}]`;
    const nodeId = node.id as string;

    // Unique ID
    if (nodeIds.has(nodeId)) {
      error(`${base}.id`, "duplicate-node-id", `Duplicate node ID: ${nodeId}`);
    }
    nodeIds.add(nodeId);
    nodeMap.set(nodeId, node);

    // Title present and non-empty (import renders it; empty titles show blank)
    if (typeof node.title !== "string" || !node.title.trim()) {
      error(`${base}.title`, "title-non-empty", `Node ${nodeId}: title is missing or empty`);
    }

    // Species prefix
    const species = node.species as string;
    const expectedPrefix = SPECIES_PREFIXES[species];
    if (expectedPrefix && !(typeof nodeId === "string" && nodeId.startsWith(expectedPrefix))) {
      error(
        `${base}.id`,
        "species-prefix",
        `Node ${nodeId}: species "${species}" should have prefix "${expectedPrefix}"`,
      );
    }

    // Valid species
    if (!SPECIES_IDS.includes(species as SpeciesId)) {
      error(`${base}.species`, "valid-species", `Node ${nodeId}: invalid species "${species}"`);
    }

    // project_id match
    if (node.project_id !== project.id) {
      error(
        `${base}.project_id`,
        "project-id-match",
        `Node ${nodeId}: project_id "${node.project_id}" does not match project.id "${project.id}"`,
      );
    }

    // Valid status
    if (!STATUS_IDS.includes(node.status as (typeof STATUS_IDS)[number])) {
      error(`${base}.status`, "valid-status", `Node ${nodeId}: invalid status "${node.status}"`);
    }

    // Platforms
    const platforms = node.platforms as unknown[] | undefined;
    if (!platforms || platforms.length === 0) {
      error(`${base}.platforms`, "platforms-non-empty", `Node ${nodeId}: platforms array is empty or missing`);
    } else {
      for (const p of platforms) {
        if (!PLATFORM_IDS.includes(p as (typeof PLATFORM_IDS)[number])) {
          error(`${base}.platforms`, "valid-platform", `Node ${nodeId}: invalid platform "${p}"`);
        }
      }
    }

    // Metadata sub-fields
    const md = (node.metadata as Record<string, unknown>) || {};
    if (md.stage !== undefined && !VALID_STAGES.includes(md.stage as string)) {
      error(`${base}.metadata.stage`, "valid-stage", `Node ${nodeId}: invalid metadata.stage "${md.stage}"`);
    }
    const platformNotes = md.platformNotes as Record<string, unknown> | undefined;
    if (platformNotes) {
      for (const p of Object.keys(platformNotes)) {
        if (!PLATFORM_IDS.includes(p as (typeof PLATFORM_IDS)[number])) {
          error(
            `${base}.metadata.platformNotes`,
            "valid-platform",
            `Node ${nodeId}: platformNotes has invalid platform "${p}"`,
          );
        }
      }
    }
    const platformStatuses = md.platformStatuses as Record<string, unknown> | undefined;
    if (platformStatuses) {
      for (const [p, s] of Object.entries(platformStatuses)) {
        if (!PLATFORM_IDS.includes(p as (typeof PLATFORM_IDS)[number])) {
          error(
            `${base}.metadata.platformStatuses`,
            "valid-platform",
            `Node ${nodeId}: platformStatuses has invalid platform "${p}"`,
          );
        } else if (Array.isArray(platforms) && !platforms.includes(p)) {
          warn(
            `${base}.metadata.platformStatuses`,
            "platform-statuses-subset",
            `Node ${nodeId}: platformStatuses covers platform "${p}" not in node.platforms`,
          );
        }
        if (!STATUS_IDS.includes(s as (typeof STATUS_IDS)[number])) {
          error(
            `${base}.metadata.platformStatuses`,
            "valid-status",
            `Node ${nodeId}: platformStatuses has invalid status "${s}" for platform "${p}"`,
          );
        }
      }
    }

    // Flow must have playlist
    if (species === "flow") {
      const playlist = md.playlist as { entries?: unknown[] } | undefined;
      if (!node.metadata || !playlist || !playlist.entries) {
        error(`${base}.metadata.playlist`, "flow-playlist-required", `Flow ${nodeId}: missing metadata.playlist.entries`);
      } else if (playlist.entries.length === 0) {
        warn(`${base}.metadata.playlist`, "flow-playlist-empty", `Flow ${nodeId}: playlist is empty`);
      }
    }
  });

  // --- root_node_id ---
  const rootNodeId = project.root_node_id as string | undefined;
  if (rootNodeId && !nodeIds.has(rootNodeId)) {
    error(
      "project.root_node_id",
      "root-node-exists",
      `project.root_node_id "${rootNodeId}" does not reference an existing node`,
    );
  }

  // --- Edge checks ---
  const edgeIds = new Set<string>();
  const edgeSignatures = new Set<string>();
  const composesSet = new Set<string>();

  edges.forEach((edge, j) => {
    const base = `edges[${j}]`;
    const edgeId = edge.id as string;
    const sourceId = edge.source_id as string;
    const targetId = edge.target_id as string;
    const edgeType = edge.edge_type as string;

    if (edgeIds.has(edgeId)) {
      error(`${base}.id`, "duplicate-edge-id", `Duplicate edge ID: ${edgeId}`);
    }
    edgeIds.add(edgeId);

    // Edge ID naming convention: e-{source_id}-{target_id}. A mismatch usually
    // means an id went stale after a node rename (source/target was repointed
    // but the edge id was not updated).
    const expectedEdgeId = `e-${sourceId}-${targetId}`;
    if (edgeId !== expectedEdgeId) {
      warn(
        `${base}.id`,
        "edge-id-convention",
        `Edge ${edgeId}: id does not match convention "${expectedEdgeId}" (stale after a rename?)`,
      );
    }

    // Duplicate relationship (same source, target, and type)
    const signature = `${sourceId}->${targetId}:${edgeType}`;
    if (edgeSignatures.has(signature)) {
      warn(`${base}`, "duplicate-edge-relationship", `Duplicate edge relationship: ${signature}`);
    }
    edgeSignatures.add(signature);

    if (edge.project_id !== project.id) {
      error(`${base}.project_id`, "project-id-match", `Edge ${edgeId}: project_id does not match project.id`);
    }

    if (!nodeIds.has(sourceId)) {
      error(`${base}.source_id`, "dangling-edge", `Edge ${edgeId}: source_id "${sourceId}" not found in nodes`);
    }
    if (!nodeIds.has(targetId)) {
      error(`${base}.target_id`, "dangling-edge", `Edge ${edgeId}: target_id "${targetId}" not found in nodes`);
    }

    if (!EDGE_TYPE_IDS.includes(edgeType as EdgeTypeId)) {
      error(`${base}.edge_type`, "valid-edge-type", `Edge ${edgeId}: invalid edge_type "${edgeType}"`);
    }

    // Check edge type semantics
    const sourceNode = nodeMap.get(sourceId);
    const targetNode = nodeMap.get(targetId);
    const semantics = VALID_EDGE_SEMANTICS[edgeType as EdgeTypeId];
    if (sourceNode && targetNode && semantics) {
      const isValid = semantics.some(([s, t]) => s === sourceNode.species && t === targetNode.species);
      if (!isValid) {
        error(
          `${base}.edge_type`,
          "edge-semantics",
          `Edge ${edgeId}: "${edgeType}" not valid from ${sourceNode.species} to ${targetNode.species}`,
        );
      }
    }

    if (edgeType === "composes") {
      composesSet.add(`${sourceId}->${targetId}`);
    }
  });

  // --- Playlist reference checks ---
  const collectPlaylistRefs = (entries: PlaylistEntry[], flowId: string, path: string, depth = 0): string[] => {
    if (depth > 50) {
      error(path, "playlist-depth", `Flow ${flowId}: playlist nesting too deep (possible cycle)`);
      return [];
    }
    const refs: string[] = [];
    for (const entry of entries) {
      if (entry.type === "view") {
        if (!nodeIds.has(entry.view_id)) {
          error(path, "playlist-ref-exists", `Flow ${flowId}: playlist references non-existent view "${entry.view_id}"`);
        }
        refs.push(entry.view_id);
      } else if (entry.type === "flow") {
        if (!nodeIds.has(entry.flow_id)) {
          error(path, "playlist-ref-exists", `Flow ${flowId}: playlist references non-existent flow "${entry.flow_id}"`);
        }
        if (entry.flow_id === flowId) {
          error(path, "playlist-self-cycle", `Flow ${flowId}: playlist contains itself (direct cycle)`);
        }
        refs.push(entry.flow_id);
      } else if (entry.type === "condition") {
        if (entry.if_true) refs.push(...collectPlaylistRefs(entry.if_true, flowId, path, depth + 1));
        if (entry.if_false) refs.push(...collectPlaylistRefs(entry.if_false, flowId, path, depth + 1));
      } else if (entry.type === "junction") {
        if (entry.cases) {
          for (const c of entry.cases) {
            refs.push(...collectPlaylistRefs(c.entries || [], flowId, path, depth + 1));
          }
        }
      }
    }
    return refs;
  };

  nodes.forEach((node, i) => {
    const md = node.metadata as { playlist?: { entries?: PlaylistEntry[] } } | undefined;
    if (node.species === "flow" && md?.playlist?.entries) {
      const path = `nodes[${i}].metadata.playlist`;
      const nodeId = node.id as string;
      const refs = collectPlaylistRefs(md.playlist.entries, nodeId, path);
      for (const ref of refs) {
        if (!composesSet.has(`${nodeId}->${ref}`)) {
          error(
            path,
            "playlist-composes-coherence",
            `Flow ${nodeId}: playlist references "${ref}" but no composes edge exists`,
          );
        }
      }
    }
  });

  // --- Cycle detection in flows ---
  const flowGraph = new Map<string, string[]>();
  const flowPath = new Map<string, string>();
  nodes.forEach((node, i) => {
    const md = node.metadata as { playlist?: { entries?: PlaylistEntry[] } } | undefined;
    if (node.species === "flow" && md?.playlist?.entries) {
      const nodeId = node.id as string;
      const subFlows: string[] = [];
      const findSubFlows = (entries: PlaylistEntry[]) => {
        for (const e of entries) {
          if (e.type === "flow") subFlows.push(e.flow_id);
          if (e.type === "condition") {
            if (e.if_true) findSubFlows(e.if_true);
            if (e.if_false) findSubFlows(e.if_false);
          }
          if (e.type === "junction" && e.cases) {
            for (const c of e.cases) findSubFlows(c.entries || []);
          }
        }
      };
      findSubFlows(md.playlist.entries);
      flowGraph.set(nodeId, subFlows);
      flowPath.set(nodeId, `nodes[${i}].metadata.playlist`);
    }
  });

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const dfs = (id: string): boolean => {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const child of flowGraph.get(id) || []) {
      if (dfs(child)) {
        error(flowPath.get(id) ?? "", "flow-cycle", `Cycle detected: flow "${id}" -> "${child}"`);
        return true;
      }
    }
    inStack.delete(id);
    return false;
  };
  for (const id of flowGraph.keys()) {
    dfs(id);
  }

  return result();
}
