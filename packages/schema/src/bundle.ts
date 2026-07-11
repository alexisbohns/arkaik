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
);

export type PlatformNotesMap = Partial<Record<PlatformId, string>>;
export const PlatformNotesMapSchema: z.ZodType<PlatformNotesMap> = z.partialRecord(
  PlatformSchema,
  z.string(),
);

/** Per-platform screenshot stored as base64 data URI. */
export type PlatformScreenshotsMap = Partial<Record<PlatformId, string>>;
export const PlatformScreenshotsMapSchema: z.ZodType<PlatformScreenshotsMap> = z.partialRecord(
  PlatformSchema,
  z.string(),
);

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
  .catchall(z.unknown());

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
  id: z.string(),
  project_id: z.string(),
  species: SpeciesSchema,
  title: z.string(),
  description: z.string().optional(),
  status: StatusSchema,
  platforms: z.array(PlatformSchema),
  metadata: NodeMetadataSchema.optional(),
});

export interface Edge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  edge_type: EdgeTypeId;
  metadata?: Record<string, unknown>;
}

export const EdgeSchema: z.ZodType<Edge> = z.object({
  id: z.string(),
  project_id: z.string(),
  source_id: z.string(),
  target_id: z.string(),
  edge_type: EdgeTypeSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export interface ProjectMetadata extends Record<string, unknown> {
  view_card_variant?: "compact" | "large";
}

export const ProjectMetadataSchema: z.ZodType<ProjectMetadata> = z
  .object({
    view_card_variant: z.enum(["compact", "large"]).optional(),
  })
  .catchall(z.unknown());

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
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  root_node_id: z.string().optional(),
  metadata: ProjectMetadataSchema.optional(),
  created_at: z.string(),
  updated_at: z.string(),
  archived_at: z.string().nullable().optional(),
});

export interface ProjectBundle {
  project: Project;
  nodes: Node[];
  edges: Edge[];
}

export const ProjectBundleSchema: z.ZodType<ProjectBundle> = z.object({
  project: ProjectSchema,
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});
