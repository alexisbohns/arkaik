import type { SpeciesId } from "@/lib/config/species";
import type { StatusId } from "@/lib/config/statuses";
import type { EdgeTypeId } from "@/lib/config/edge-types";
import type { PlatformId } from "@/lib/config/platforms";

/** Species of a node, derived from the SPECIES config. */
export type Species = SpeciesId;
/** Lifecycle status of a node, derived from the STATUSES config. */
export type Status = StatusId;
/** Platform the node is available on, derived from the PLATFORMS config. */
export type Platform = PlatformId;
/** Relationship type between two nodes, derived from the EDGE_TYPES config. */
export type EdgeType = EdgeTypeId;
/** Per-platform status source of truth for step-like species. */
export type PlatformStatusMap = Partial<Record<PlatformId, StatusId>>;
/** Freeform per-platform notes used by the detail panel. */
export type PlatformNotesMap = Partial<Record<PlatformId, string>>;

export type PlaylistEntry =
  | { type: "view"; view_id: string }
  | { type: "flow"; flow_id: string }
  | { type: "condition"; label: string; if_true: PlaylistEntry[]; if_false: PlaylistEntry[] }
  | { type: "junction"; label: string; cases: JunctionCase[] };

export interface JunctionCase {
  label: string;
  entries: PlaylistEntry[];
}

export interface FlowPlaylist {
  entries: PlaylistEntry[];
}

export interface NodeMetadata extends Record<string, unknown> {
  stage?: string;
  playlist?: FlowPlaylist;
  platformNotes?: PlatformNotesMap;
  platformStatuses?: PlatformStatusMap;
}

export interface Node {
  id: string;
  project_id: string;
  species: Species;
  title: string;
  description?: string;
  status: Status;
  platforms: Platform[];
  metadata?: NodeMetadata;
}

export interface Edge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  edge_type: EdgeType;
  metadata?: Record<string, unknown>;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  /** ISO 8601 timestamp, e.g. "2024-01-01T00:00:00.000Z" */
  created_at: string;
  /** ISO 8601 timestamp, e.g. "2024-01-01T00:00:00.000Z" */
  updated_at: string;
  /** ISO 8601 timestamp when archived; null/undefined means active. */
  archived_at?: string | null;
}

export interface ProjectBundle {
  project: Project;
  nodes: Node[];
  edges: Edge[];
}

/** @deprecated Use Node */
export type ArkaikNode = Node;
/** @deprecated Use Edge */
export type ArkaikEdge = Edge;
