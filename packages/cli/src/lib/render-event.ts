/**
 * Plain-text rendering of a single journal event for the CLI — the terminal
 * counterpart to the app's `components/journal/describe-event.ts`, mirroring its
 * wording but dropping the lucide icons and the app's config label maps (which
 * the CLI can't import). Raw enum ids (`live`, `composes`, …) stand in for the
 * app's human labels; the CLI is a developer tool, so the ids read fine.
 *
 * Pure and presentation-only: it formats one already-selected event, never
 * touches the projections themselves.
 */
import type { JournalEvent, Node } from "@arkaik/schema";

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Resolve a node id to its current snapshot title, falling back to the raw id. */
function title(id: unknown, nodesById?: ReadonlyMap<string, Pick<Node, "title">>): string {
  const nodeId = str(id);
  if (nodeId === undefined) return "?";
  return nodesById?.get(nodeId)?.title ?? nodeId;
}

/**
 * A one-line human description of `event`. `nodesById` (from the bundle
 * snapshot) resolves node titles; without it, raw node ids are shown. An unknown
 * `type` renders as its raw type string — forward-compatible, never throwing.
 */
export function renderEventLine(
  event: JournalEvent,
  nodesById?: ReadonlyMap<string, Pick<Node, "title">>,
): string {
  switch (event.type) {
    case "node.created": {
      const species = str(event.species);
      return `${title(event.node_id, nodesById)} created${species ? ` (${species})` : ""}`;
    }
    case "node.updated": {
      const fields = Array.isArray(event.fields)
        ? event.fields.filter((f): f is string => typeof f === "string")
        : [];
      const from = str(event.from);
      const to = str(event.to);
      if (fields.length === 1 && fields[0] === "title" && from !== undefined && to !== undefined) {
        return `Title changed: "${from}" -> "${to}"`;
      }
      return `${title(event.node_id, nodesById)} updated${fields.length > 0 ? ` (${fields.join(", ")})` : ""}`;
    }
    case "node.status_changed": {
      const from = str(event.from) ?? "?";
      const to = str(event.to) ?? "?";
      const platform = str(event.platform);
      return `${title(event.node_id, nodesById)}: ${from} -> ${to}${platform ? ` [${platform}]` : ""}`;
    }
    case "node.deleted":
      return `${title(event.node_id, nodesById)} deleted`;
    case "edge.added": {
      const edgeType = str(event.edge_type);
      return `${title(event.source_id, nodesById)} -> ${title(event.target_id, nodesById)}${edgeType ? ` (${edgeType})` : ""}`;
    }
    case "edge.removed":
      return "Edge removed";
    case "release.tagged": {
      const version = str(event.version) ?? "?";
      const platform = str(event.platform);
      return `Released ${version}${platform ? ` [${platform}]` : ""}`;
    }
    case "idea.proposed":
      return `Idea: ${str(event.title) ?? "Untitled"}`;
    case "request.filed": {
      const source = str(event.source);
      return `Request: ${str(event.title) ?? "Untitled"}${source ? ` (${source})` : ""}`;
    }
    case "ref.added": {
      const refType = str(event.ref_type);
      return `${title(event.node_id, nodesById)}: reference added${refType ? ` (${refType})` : ""}`;
    }
    case "ref.removed":
      return `${title(event.node_id, nodesById)}: reference removed`;
    case "ref.status_changed": {
      const from = str(event.from);
      const to = str(event.to) ?? "?";
      return `${title(event.node_id, nodesById)}: reference ${from ? `${from} -> ${to}` : to}`;
    }
    default:
      // Unknown type — forward-compatible: render the raw type rather than erroring.
      return event.type;
  }
}

/** `ts` formatted as a short ISO date (YYYY-MM-DD); falls back to the raw string. */
export function formatEventDate(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toISOString().slice(0, 10);
}
