/**
 * Human-readable rendering of a single journal event — shared by the node
 * History section (`components/panels/NodeDetailPanel.tsx`) and the
 * project-level changelog view (`app/project/[id]/changelog/page.tsx`), so the
 * two read surfaces describe the same event the same way.
 *
 * Pure and presentation-only: it never touches the journal projections
 * themselves (`lib/utils/journal.ts`), only formats one already-selected
 * event for display.
 */

import type { LucideIcon } from "lucide-react";
import {
  CirclePlus,
  Pencil,
  ArrowRightLeft,
  Trash2,
  Link2,
  Unlink,
  Tag,
  Lightbulb,
  MessageSquareText,
  RefreshCw,
} from "lucide-react";
import type { JournalEvent, Node } from "@/lib/data/types";
import { SPECIES } from "@/lib/config/species";
import { STATUSES } from "@/lib/config/statuses";
import { EDGE_TYPES } from "@/lib/config/edge-types";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";

const SPECIES_LABEL: Record<string, string> = Object.fromEntries(SPECIES.map((s) => [s.id, s.label]));
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
const EDGE_TYPE_LABEL: Record<string, string> = Object.fromEntries(EDGE_TYPES.map((e) => [e.id, e.label]));
const PLATFORM_LABEL = PLATFORM_LABELS as Record<string, string>;

const EVENT_ICONS: Record<string, LucideIcon> = {
  "node.created": CirclePlus,
  "node.updated": Pencil,
  "node.status_changed": ArrowRightLeft,
  "node.deleted": Trash2,
  "edge.added": Link2,
  "edge.removed": Unlink,
  "release.tagged": Tag,
  "idea.proposed": Lightbulb,
  "request.filed": MessageSquareText,
  "ref.added": Link2,
  "ref.removed": Unlink,
  "ref.status_changed": RefreshCw,
};

export interface DescribedEvent {
  icon: LucideIcon;
  text: string;
  meta?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Resolves a node id to its current title, falling back to the raw id (e.g. a deleted node). */
function resolveTitle(id: unknown, nodesById?: ReadonlyMap<string, Pick<Node, "title">>): string {
  const nodeId = str(id);
  if (nodeId === undefined) return "?";
  return nodesById?.get(nodeId)?.title ?? nodeId;
}

export function describeJournalEvent(
  event: JournalEvent,
  nodesById?: ReadonlyMap<string, Pick<Node, "title">>,
): DescribedEvent {
  const icon = EVENT_ICONS[event.type] ?? Pencil;

  switch (event.type) {
    case "node.created": {
      const species = str(event.species);
      return {
        icon,
        text: `${resolveTitle(event.node_id, nodesById)} created`,
        meta: species ? SPECIES_LABEL[species] ?? species : undefined,
      };
    }
    case "node.updated": {
      const fields = Array.isArray(event.fields)
        ? event.fields.filter((f): f is string => typeof f === "string")
        : [];
      const from = str(event.from);
      const to = str(event.to);
      if (fields.length === 1 && fields[0] === "title" && from !== undefined && to !== undefined) {
        return { icon, text: `Title changed: "${from}" → "${to}"` };
      }
      return {
        icon,
        text: `${resolveTitle(event.node_id, nodesById)} updated`,
        meta: fields.length > 0 ? fields.join(", ") : undefined,
      };
    }
    case "node.status_changed": {
      const from = str(event.from);
      const to = str(event.to);
      const platform = str(event.platform);
      return {
        icon,
        text: `${resolveTitle(event.node_id, nodesById)}: ${from ? STATUS_LABEL[from] ?? from : "?"} → ${to ? STATUS_LABEL[to] ?? to : "?"}`,
        meta: platform ? PLATFORM_LABEL[platform] ?? platform : undefined,
      };
    }
    case "node.deleted":
      return { icon, text: `${resolveTitle(event.node_id, nodesById)} deleted` };
    case "edge.added": {
      const edgeType = str(event.edge_type);
      return {
        icon,
        text: `${resolveTitle(event.source_id, nodesById)} → ${resolveTitle(event.target_id, nodesById)}`,
        meta: edgeType ? EDGE_TYPE_LABEL[edgeType] ?? edgeType : undefined,
      };
    }
    case "edge.removed":
      return { icon, text: "Edge removed" };
    case "release.tagged": {
      const version = str(event.version) ?? "?";
      const platform = str(event.platform);
      return {
        icon,
        text: `Released ${version}`,
        meta: platform ? PLATFORM_LABEL[platform] ?? platform : undefined,
      };
    }
    case "idea.proposed":
      return { icon, text: `Idea: ${str(event.title) ?? "Untitled"}` };
    case "request.filed":
      return {
        icon,
        text: `Request: ${str(event.title) ?? "Untitled"}`,
        meta: str(event.source),
      };
    case "ref.added":
      return {
        icon,
        text: `${resolveTitle(event.node_id, nodesById)}: reference added`,
        meta: str(event.ref_type),
      };
    case "ref.removed":
      return { icon, text: `${resolveTitle(event.node_id, nodesById)}: reference removed` };
    case "ref.status_changed": {
      const from = str(event.from);
      const to = str(event.to) ?? "?";
      return {
        icon,
        text: `${resolveTitle(event.node_id, nodesById)}: reference ${from ? `${from} → ${to}` : to}`,
      };
    }
    default:
      // Unknown type — forward-compatible: render the raw type rather than erroring.
      return { icon, text: event.type };
  }
}

/** `ts` formatted as a short date; falls back to the raw string if unparseable. */
export function formatEventDate(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
