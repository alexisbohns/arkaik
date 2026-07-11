#!/usr/bin/env node

/**
 * Arkaik ProjectBundle Validator
 *
 * Validates a bundle.json file against the Arkaik schema rules.
 * Exit code 0 = valid, 1 = errors found.
 *
 * Usage: node validate-bundle.js <path-to-bundle.json>
 */

const fs = require("fs");
const path = require("path");

const SPECIES_PREFIXES = {
  flow: "F-",
  view: "V-",
  "data-model": "DM-",
  "api-endpoint": "API-",
};

const VALID_SPECIES = ["flow", "view", "data-model", "api-endpoint"];
const VALID_STATUSES = ["idea", "backlog", "prioritized", "development", "releasing", "live", "archived", "blocked"];
const VALID_PLATFORMS = ["web", "ios", "android"];
const VALID_EDGE_TYPES = ["composes", "calls", "displays", "queries"];
const VALID_STAGES = ["beta", "monitoring", "deprecated"];
const VALID_VIEW_CARD_VARIANTS = ["compact", "large"];

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

const VALID_EDGE_SEMANTICS = {
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

function validate(filePath) {
  const errors = [];
  const warnings = [];

  // Parse JSON
  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`FATAL: Cannot parse JSON — ${e.message}`);
    process.exit(1);
  }

  const { project, nodes, edges } = bundle;
  if (!project || !nodes || !edges) {
    console.error("FATAL: Missing top-level keys (project, nodes, edges).");
    process.exit(1);
  }

  const nodeMap = new Map();
  const nodeIds = new Set();

  // --- Project-level checks ---
  if (!project.id) errors.push("project.id is missing");
  if (typeof project.title !== "string" || !project.title.trim()) {
    errors.push("project.title is missing or empty");
  }
  if (!project.created_at) errors.push("project.created_at is missing");
  if (!project.updated_at) errors.push("project.updated_at is missing");
  if (project.created_at && !isIsoDate(project.created_at)) {
    warnings.push("project.created_at is not a valid ISO 8601 timestamp");
  }
  if (project.updated_at && !isIsoDate(project.updated_at)) {
    warnings.push("project.updated_at is not a valid ISO 8601 timestamp");
  }
  if (
    project.metadata &&
    project.metadata.view_card_variant !== undefined &&
    !VALID_VIEW_CARD_VARIANTS.includes(project.metadata.view_card_variant)
  ) {
    errors.push(
      `project.metadata.view_card_variant must be one of ${VALID_VIEW_CARD_VARIANTS.join(", ")} (import rejects other values)`
    );
  }

  // --- Node checks ---
  for (const node of nodes) {
    // Unique ID
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node ID: ${node.id}`);
    }
    nodeIds.add(node.id);
    nodeMap.set(node.id, node);

    // Title present and non-empty (import renders it; empty titles show blank)
    if (typeof node.title !== "string" || !node.title.trim()) {
      errors.push(`Node ${node.id}: title is missing or empty`);
    }

    // Species prefix
    const expectedPrefix = SPECIES_PREFIXES[node.species];
    if (expectedPrefix && !node.id.startsWith(expectedPrefix)) {
      errors.push(`Node ${node.id}: species "${node.species}" should have prefix "${expectedPrefix}"`);
    }

    // Valid species
    if (!VALID_SPECIES.includes(node.species)) {
      errors.push(`Node ${node.id}: invalid species "${node.species}"`);
    }

    // project_id match
    if (node.project_id !== project.id) {
      errors.push(`Node ${node.id}: project_id "${node.project_id}" does not match project.id "${project.id}"`);
    }

    // Valid status
    if (!VALID_STATUSES.includes(node.status)) {
      errors.push(`Node ${node.id}: invalid status "${node.status}"`);
    }

    // Platforms
    if (!node.platforms || node.platforms.length === 0) {
      errors.push(`Node ${node.id}: platforms array is empty or missing`);
    } else {
      for (const p of node.platforms) {
        if (!VALID_PLATFORMS.includes(p)) {
          errors.push(`Node ${node.id}: invalid platform "${p}"`);
        }
      }
    }

    // Metadata sub-fields
    const md = node.metadata || {};
    if (md.stage !== undefined && !VALID_STAGES.includes(md.stage)) {
      errors.push(`Node ${node.id}: invalid metadata.stage "${md.stage}"`);
    }
    if (md.platformNotes) {
      for (const p of Object.keys(md.platformNotes)) {
        if (!VALID_PLATFORMS.includes(p)) {
          errors.push(`Node ${node.id}: platformNotes has invalid platform "${p}"`);
        }
      }
    }
    if (md.platformStatuses) {
      for (const [p, s] of Object.entries(md.platformStatuses)) {
        if (!VALID_PLATFORMS.includes(p)) {
          errors.push(`Node ${node.id}: platformStatuses has invalid platform "${p}"`);
        } else if (Array.isArray(node.platforms) && !node.platforms.includes(p)) {
          warnings.push(`Node ${node.id}: platformStatuses covers platform "${p}" not in node.platforms`);
        }
        if (!VALID_STATUSES.includes(s)) {
          errors.push(`Node ${node.id}: platformStatuses has invalid status "${s}" for platform "${p}"`);
        }
      }
    }

    // Flow must have playlist
    if (node.species === "flow") {
      if (!node.metadata || !node.metadata.playlist || !node.metadata.playlist.entries) {
        errors.push(`Flow ${node.id}: missing metadata.playlist.entries`);
      } else if (node.metadata.playlist.entries.length === 0) {
        warnings.push(`Flow ${node.id}: playlist is empty`);
      }
    }
  }

  // --- root_node_id ---
  if (project.root_node_id && !nodeIds.has(project.root_node_id)) {
    errors.push(`project.root_node_id "${project.root_node_id}" does not reference an existing node`);
  }

  // --- Edge checks ---
  const edgeIds = new Set();
  const edgeSignatures = new Set();
  const composesSet = new Set();

  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(`Duplicate edge ID: ${edge.id}`);
    }
    edgeIds.add(edge.id);

    // Edge ID naming convention: e-{source_id}-{target_id}. A mismatch usually
    // means an id went stale after a node rename (source/target was repointed
    // but the edge id was not updated).
    const expectedEdgeId = `e-${edge.source_id}-${edge.target_id}`;
    if (edge.id !== expectedEdgeId) {
      warnings.push(`Edge ${edge.id}: id does not match convention "${expectedEdgeId}" (stale after a rename?)`);
    }

    // Duplicate relationship (same source, target, and type)
    const signature = `${edge.source_id}->${edge.target_id}:${edge.edge_type}`;
    if (edgeSignatures.has(signature)) {
      warnings.push(`Duplicate edge relationship: ${signature}`);
    }
    edgeSignatures.add(signature);

    if (edge.project_id !== project.id) {
      errors.push(`Edge ${edge.id}: project_id does not match project.id`);
    }

    if (!nodeIds.has(edge.source_id)) {
      errors.push(`Edge ${edge.id}: source_id "${edge.source_id}" not found in nodes`);
    }
    if (!nodeIds.has(edge.target_id)) {
      errors.push(`Edge ${edge.id}: target_id "${edge.target_id}" not found in nodes`);
    }

    if (!VALID_EDGE_TYPES.includes(edge.edge_type)) {
      errors.push(`Edge ${edge.id}: invalid edge_type "${edge.edge_type}"`);
    }

    // Check edge type semantics
    const sourceNode = nodeMap.get(edge.source_id);
    const targetNode = nodeMap.get(edge.target_id);
    if (sourceNode && targetNode && VALID_EDGE_SEMANTICS[edge.edge_type]) {
      const validPairs = VALID_EDGE_SEMANTICS[edge.edge_type];
      const isValid = validPairs.some(
        ([s, t]) => s === sourceNode.species && t === targetNode.species
      );
      if (!isValid) {
        errors.push(
          `Edge ${edge.id}: "${edge.edge_type}" not valid from ${sourceNode.species} to ${targetNode.species}`
        );
      }
    }

    if (edge.edge_type === "composes") {
      composesSet.add(`${edge.source_id}->${edge.target_id}`);
    }
  }

  // --- Playlist reference checks ---
  function collectPlaylistRefs(entries, flowId, depth = 0) {
    if (depth > 50) {
      errors.push(`Flow ${flowId}: playlist nesting too deep (possible cycle)`);
      return [];
    }
    const refs = [];
    for (const entry of entries) {
      if (entry.type === "view") {
        if (!nodeIds.has(entry.view_id)) {
          errors.push(`Flow ${flowId}: playlist references non-existent view "${entry.view_id}"`);
        }
        refs.push(entry.view_id);
      } else if (entry.type === "flow") {
        if (!nodeIds.has(entry.flow_id)) {
          errors.push(`Flow ${flowId}: playlist references non-existent flow "${entry.flow_id}"`);
        }
        if (entry.flow_id === flowId) {
          errors.push(`Flow ${flowId}: playlist contains itself (direct cycle)`);
        }
        refs.push(entry.flow_id);
      } else if (entry.type === "condition") {
        if (entry.if_true) refs.push(...collectPlaylistRefs(entry.if_true, flowId, depth + 1));
        if (entry.if_false) refs.push(...collectPlaylistRefs(entry.if_false, flowId, depth + 1));
      } else if (entry.type === "junction") {
        if (entry.cases) {
          for (const c of entry.cases) {
            refs.push(...collectPlaylistRefs(c.entries || [], flowId, depth + 1));
          }
        }
      }
    }
    return refs;
  }

  for (const node of nodes) {
    if (node.species === "flow" && node.metadata?.playlist?.entries) {
      const refs = collectPlaylistRefs(node.metadata.playlist.entries, node.id);
      for (const ref of refs) {
        if (!composesSet.has(`${node.id}->${ref}`)) {
          errors.push(`Flow ${node.id}: playlist references "${ref}" but no composes edge exists`);
        }
      }
    }
  }

  // --- Cycle detection in flows ---
  function detectCycles() {
    const flowGraph = new Map();
    for (const node of nodes) {
      if (node.species === "flow" && node.metadata?.playlist?.entries) {
        const subFlows = [];
        function findSubFlows(entries) {
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
        }
        findSubFlows(node.metadata.playlist.entries);
        flowGraph.set(node.id, subFlows);
      }
    }

    const visited = new Set();
    const inStack = new Set();

    function dfs(id) {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      inStack.add(id);
      for (const child of flowGraph.get(id) || []) {
        if (dfs(child)) {
          errors.push(`Cycle detected: flow "${id}" -> "${child}"`);
          return true;
        }
      }
      inStack.delete(id);
      return false;
    }

    for (const id of flowGraph.keys()) {
      dfs(id);
    }
  }

  detectCycles();

  // --- Report ---
  const stats = {
    nodes: nodes.length,
    views: nodes.filter((n) => n.species === "view").length,
    flows: nodes.filter((n) => n.species === "flow").length,
    dataModels: nodes.filter((n) => n.species === "data-model").length,
    apiEndpoints: nodes.filter((n) => n.species === "api-endpoint").length,
    edges: edges.length,
  };

  console.log("\n  Arkaik Bundle Validation");
  console.log("  =======================\n");
  console.log(`  Nodes: ${stats.nodes} (${stats.views} views, ${stats.flows} flows, ${stats.dataModels} data-models, ${stats.apiEndpoints} api-endpoints)`);
  console.log(`  Edges: ${stats.edges}`);
  console.log("");

  if (warnings.length > 0) {
    console.log(`  Warnings: ${warnings.length}`);
    warnings.forEach((w) => console.log(`    WARN: ${w}`));
    console.log("");
  }

  if (errors.length === 0) {
    console.log("  Result: VALID\n");
    process.exit(0);
  } else {
    console.log(`  Errors: ${errors.length}`);
    errors.forEach((e) => console.log(`    ERROR: ${e}`));
    console.log("\n  Result: INVALID\n");
    process.exit(1);
  }
}

// --- CLI ---
const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node validate-bundle.js <path-to-bundle.json>");
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

validate(filePath);