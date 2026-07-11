import { z } from "zod";
import {
  EdgeTypeSchema,
  PlatformSchema,
  SpeciesSchema,
  StatusSchema,
  type EdgeTypeId,
  type PlatformId,
  type SpeciesId,
  type StatusId,
} from "./enums";
import { FlowPlaylistSchema, type FlowPlaylist } from "./playlist";

export type PlatformStatusMap = Partial<Record<PlatformId, StatusId>>;
export const PlatformStatusMapSchema: z.ZodType<PlatformStatusMap> = z.partialRecord(
  PlatformSchema,
  StatusSchema,
).meta({ id: "PlatformStatusMap", description: "Per-platform status overrides for view nodes." });

export type PlatformNotesMap = Partial<Record<PlatformId, string>>;
export const PlatformNotesMapSchema: z.ZodType<PlatformNotesMap> = z.partialRecord(
  PlatformSchema,
  z.string(),
).meta({ id: "PlatformNotesMap", description: "Freeform per-platform notes." });

/**
 * Per-platform screenshot. Each value is a relative path (Kommit), an
 * absolute `https://` URL (hosted modes), or a `data:` URI (Lokal/legacy) —
 * see docs/spec/bundle-format.md § Asset Values. `validateBundle()` warns on
 * `data:` values above a size threshold; it never rejects them.
 */
export type PlatformScreenshotsMap = Partial<Record<PlatformId, string>>;
export const PlatformScreenshotsMapSchema: z.ZodType<PlatformScreenshotsMap> = z.partialRecord(
  PlatformSchema,
  z.string(),
).meta({
  id: "PlatformScreenshotsMap",
  description:
    "Per-platform screenshot: a relative path, an absolute URL, or a data URI (see docs/spec/bundle-format.md § Asset Values).",
});

export interface NodeMetadata extends Record<string, unknown> {
  stage?: string;
  playlist?: FlowPlaylist;
  platformNotes?: PlatformNotesMap;
  platformStatuses?: PlatformStatusMap;
  platformScreenshots?: PlatformScreenshotsMap;
}

export const NodeMetadataSchema: z.ZodType<NodeMetadata> = z
  .object({
    stage: z.string().optional(),
    playlist: FlowPlaylistSchema.optional(),
    platformNotes: PlatformNotesMapSchema.optional(),
    platformStatuses: PlatformStatusMapSchema.optional(),
    platformScreenshots: PlatformScreenshotsMapSchema.optional(),
  })
  .catchall(z.unknown())
  .meta({ id: "NodeMetadata", description: "Optional metadata for a node." });

export interface Node {
  id: string;
  project_id: string;
  species: SpeciesId;
  title: string;
  description?: string;
  status: StatusId;
  platforms: PlatformId[];
  metadata?: NodeMetadata;
}

export const NodeSchema: z.ZodType<Node> = z.object({
  id: z.string().meta({ description: "Unique node ID. Convention: prefix with species — F- (flow), V- (view), DM- (data-model), API- (api-endpoint)." }),
  project_id: z.string().meta({ description: "Must match project.id." }),
  species: SpeciesSchema,
  title: z.string().meta({ description: "Human-readable node title." }),
  description: z.string().optional().meta({ description: "Optional description of the node's purpose." }),
  status: StatusSchema,
  platforms: z.array(PlatformSchema).meta({ description: "One or more target platforms." }),
  metadata: NodeMetadataSchema.optional(),
}).meta({ id: "Node" });

export interface Edge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  edge_type: EdgeTypeId;
  metadata?: Record<string, unknown>;
}

export const EdgeSchema: z.ZodType<Edge> = z.object({
  id: z.string().meta({ description: "Unique edge ID. Convention: e-{source_id}-{target_id}." }),
  project_id: z.string().meta({ description: "Must match project.id." }),
  source_id: z.string().meta({ description: "ID of the source node." }),
  target_id: z.string().meta({ description: "ID of the target node." }),
  edge_type: EdgeTypeSchema,
  metadata: z.record(z.string(), z.unknown()).optional().meta({ description: "Optional edge metadata." }),
}).meta({ id: "Edge" });

export interface ProjectMetadata extends Record<string, unknown> {
  view_card_variant?: "compact" | "large";
}

export const ProjectMetadataSchema: z.ZodType<ProjectMetadata> = z
  .object({
    view_card_variant: z.enum(["compact", "large"]).optional(),
  })
  .catchall(z.unknown())
  .meta({ id: "ProjectMetadata", description: "Optional project-level UI settings." });

export interface Project {
  id: string;
  title: string;
  description?: string;
  /** Optional node id used as the primary canvas anchor/root. */
  root_node_id?: string;
  /** Optional project-level UI settings and preferences. */
  metadata?: ProjectMetadata;
  /** ISO 8601 timestamp, e.g. "2024-01-01T00:00:00.000Z" */
  created_at: string;
  /** ISO 8601 timestamp, e.g. "2024-01-01T00:00:00.000Z" */
  updated_at: string;
  /** ISO 8601 timestamp when archived; null/undefined means active. */
  archived_at?: string | null;
}

export const ProjectSchema: z.ZodType<Project> = z.object({
  id: z.string().meta({ description: "Unique project identifier." }),
  title: z.string().meta({ description: "Project title." }),
  description: z.string().optional().meta({ description: "Optional project description." }),
  root_node_id: z.string().optional().meta({
    description: "ID of the root node used as the canvas entry point. Should reference an existing node.",
  }),
  metadata: ProjectMetadataSchema.optional(),
  created_at: z.string().meta({ description: "ISO 8601 creation timestamp." }),
  updated_at: z.string().meta({ description: "ISO 8601 last-update timestamp." }),
  archived_at: z.string().nullable().optional().meta({
    description: "ISO 8601 archive timestamp, or null if active.",
  }),
}).meta({ id: "Project" });

export interface ProjectBundle {
  project: Project;
  nodes: Node[];
  edges: Edge[];
}

export const ProjectBundleSchema: z.ZodType<ProjectBundle> = z.object({
  project: ProjectSchema,
  nodes: z.array(NodeSchema).meta({ description: "All nodes in the project graph." }),
  edges: z.array(EdgeSchema).meta({ description: "All edges (relationships) between nodes." }),
}).meta({
  id: "ProjectBundle",
  title: "Arkaik ProjectBundle",
  description:
    "The import/export format for an Arkaik product graph. Contains a project, its nodes (flows, views, data models, API endpoints), and edges (relationships between nodes).",
});
