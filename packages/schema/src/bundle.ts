import { z } from "zod";
import {
  EdgeTypeSchema,
  PlatformSchema,
  SpeciesSchema,
  StatusSchema,
  ValueSchema,
  type EdgeTypeId,
  type PlatformId,
  type SpeciesId,
  type StatusId,
  type ValueId,
} from "./enums";
import { FlowPlaylistSchema, type FlowPlaylist } from "./playlist";
import { JournalEventSchema } from "./journal-events";
import type { JournalEvent } from "./journal";
import type { MapDefinition } from "./maps";

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

/**
 * Known external-reference types (docs/spec/bundle-format.md § References).
 * Unrecognized `type` values are preserved, never rejected — the `(string & {})`
 * arm of `Ref.type` and the free-form `z.string()` in `RefSchema` keep them
 * round-tripping so unknown types can render as generic links.
 */
export type RefType =
  | "figma"
  | "github-issue"
  | "gitlab-issue"
  | "linear-issue"
  | "github-pr"
  | "gitlab-mr"
  | "url";

export interface Ref {
  /** Unique within the node, kebab-case (e.g. "gh-142"). */
  id: string;
  /** One of {@link RefType}; unrecognized values are preserved and render as generic links. */
  type: RefType | (string & {});
  /** Canonical external URL. */
  url: string;
  /** Display label. */
  title?: string;
  /** Mirrored external state, verbatim (e.g. "open", "merged", "In Progress"). */
  external_status?: string;
  /** Optional mapping of external_status into the arkaik lifecycle. Advisory display data — never mutates node.status. */
  status_mapped?: StatusId;
  /** Optional scoping to one platform variant. */
  platform?: PlatformId;
  /** ISO 8601 — when external_status was last mirrored. */
  synced_at?: string;
}

export const RefSchema: z.ZodType<Ref> = z
  .object({
    id: z.string().meta({ description: "Unique within the node, kebab-case (e.g. \"gh-142\")." }),
    type: z.string().meta({
      description:
        "Ref type: figma | github-issue | gitlab-issue | linear-issue | github-pr | gitlab-mr | url. Unrecognized values are preserved and render as generic links.",
    }),
    url: z.string().meta({ description: "Canonical external URL." }),
    title: z.string().optional().meta({ description: "Display label." }),
    external_status: z.string().optional().meta({
      description: "Mirrored external state, verbatim (e.g. \"open\", \"merged\", \"In Progress\").",
    }),
    status_mapped: StatusSchema.optional().meta({
      description:
        "Optional mapping of external_status into the arkaik lifecycle. Advisory display data — never mutates node.status.",
    }),
    platform: PlatformSchema.optional().meta({ description: "Optional scoping to one platform variant." }),
    synced_at: z.string().optional().meta({ description: "ISO 8601 — when external_status was last mirrored." }),
  })
  .meta({ id: "Ref", description: "A typed external reference on a node (docs/spec/bundle-format.md § References)." });

export interface NodeMetadata extends Record<string, unknown> {
  stage?: string;
  playlist?: FlowPlaylist;
  platformNotes?: PlatformNotesMap;
  platformStatuses?: PlatformStatusMap;
  platformScreenshots?: PlatformScreenshotsMap;
  refs?: Ref[];
  /** Acceptance nodes: one Given/When/Then scenario — the How (spec §3.1). */
  gherkin?: string;
  /** Acceptance nodes: value elements served — the Why (spec §3.2). */
  values?: ValueId[];
}

export const NodeMetadataSchema: z.ZodType<NodeMetadata> = z
  .object({
    stage: z.string().optional(),
    playlist: FlowPlaylistSchema.optional(),
    platformNotes: PlatformNotesMapSchema.optional(),
    platformStatuses: PlatformStatusMapSchema.optional(),
    platformScreenshots: PlatformScreenshotsMapSchema.optional(),
    refs: z.array(RefSchema).optional().meta({ description: "Typed external references on the node." }),
    gherkin: z.string().optional().meta({
      description: "Acceptance nodes only: exactly one Given/When/Then scenario (the How). A second scenario is a second acceptance node.",
    }),
    values: z.array(ValueSchema).optional().meta({
      description: "Acceptance nodes only: 1..n Bain value elements served (the Why).",
    }),
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

/**
 * A stored map definition (docs/spec/maps.md). Deliberately lenient: `kind`,
 * `species`, and `edge_types` parse as free strings so an unknown value is a
 * `validateBundle()` *warning* (map-unknown-*), never a parse rejection — a
 * stale map must not fail an import. The canonical type and the projection
 * functions live in `./maps` (zod-free).
 */
export const MapDefinitionSchema: z.ZodType<MapDefinition> = z
  .object({
    id: z.string().meta({
      description: "Kebab-case, unique within the project; built-in ids (journey, system) are reserved.",
    }),
    title: z.string().meta({ description: "Display title." }),
    description: z.string().optional().meta({ description: "What this map is for." }),
    kind: z.string().meta({
      description:
        "Map kind: journey | system. Selects the renderer and selection defaults; unrecognized kinds are preserved and listed as unrenderable.",
    }),
    species: z.array(z.string()).optional().meta({
      description: "Node filter; defaults by kind (journey: flow+view; system: view+api-endpoint+data-model).",
    }),
    edge_types: z.array(z.string()).optional().meta({
      description: "Edge filter; defaults by kind (journey: composes; system: calls+displays+queries).",
    }),
    root_node_id: z.string().optional().meta({
      description: "Scope anchor: the subgraph is the undirected neighborhood reachable from this node.",
    }),
    depth: z.number().optional().meta({ description: "Traversal bound from the root; absent = unbounded." }),
    layout: z
      .object({ direction: z.string().optional() })
      .catchall(z.unknown())
      .optional()
      .meta({ description: "Renderer layout hints (e.g. direction: DOWN | RIGHT)." }),
  })
  .catchall(z.unknown())
  .meta({ id: "MapDefinition", description: "A stored map definition (docs/spec/maps.md § MapDefinition)." });

export interface ProjectMetadata extends Record<string, unknown> {
  view_card_variant?: "compact" | "large";
  maps?: MapDefinition[];
}

export const ProjectMetadataSchema: z.ZodType<ProjectMetadata> = z
  .object({
    view_card_variant: z.enum(["compact", "large"]).optional(),
    maps: z.array(MapDefinitionSchema).optional().meta({
      description: "Stored map definitions (docs/spec/maps.md § Storage) — additive; unknown fields preserved.",
    }),
  })
  .catchall(z.unknown())
  .meta({ id: "ProjectMetadata", description: "Optional project-level UI settings." });

export interface Project {
  id: string;
  title: string;
  description?: string;
  /** v2: current version label, free-form (semver recommended, not required), e.g. "1.4.0" or "2026-07". Version history lives in the journal. */
  version?: string;
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
  version: z.string().optional().meta({
    description:
      "Current version label of the mapped product (free-form; semver recommended, not required). Version history lives in the journal as release.tagged events.",
  }),
  root_node_id: z.string().optional().meta({
    description: "ID of the root node used as the canvas entry point. Should reference an existing node.",
  }),
  metadata: ProjectMetadataSchema.optional(),
  created_at: z.string().meta({ description: "ISO 8601 creation timestamp." }),
  updated_at: z.string().meta({ description: "ISO 8601 last-update timestamp." }),
  archived_at: z.string().nullable().optional().meta({
    description: "ISO 8601 archive timestamp, or null if active.",
  }),
}).catchall(z.unknown()).meta({ id: "Project" });

export interface ProjectBundle {
  /** Bundle Format contract version (docs/spec/bundle-format.md § Schema Versioning). Absent MUST be treated as 1. */
  schema_version?: number;
  project: Project;
  nodes: Node[];
  edges: Edge[];
  /** Optional embedded journal — the interchange projection (Level 2). Canonical storage is the JSONL sidecar; see docs/spec/journal.md. */
  journal?: JournalEvent[];
}

export const ProjectBundleSchema: z.ZodType<ProjectBundle> = z.object({
  schema_version: z.number().int().optional().meta({
    description:
      "Bundle Format contract version. Absent means 1 (docs/spec/bundle-format.md § Schema Versioning). Older versions migrate through an explicit chain; unknown fields from newer versions are preserved on re-export.",
  }),
  project: ProjectSchema,
  nodes: z.array(NodeSchema).meta({ description: "All nodes in the project graph." }),
  edges: z.array(EdgeSchema).meta({ description: "All edges (relationships) between nodes." }),
  journal: z.array(JournalEventSchema).optional().meta({
    description:
      "Optional embedded journal events — the Level 2 interchange projection (docs/spec/journal.md). Canonical storage in repos is the JSONL sidecar; a bundle without a journal is Level 0/1, not an error.",
  }),
}).catchall(z.unknown()).meta({
  id: "ProjectBundle",
  title: "Arkaik ProjectBundle",
  description:
    "The import/export format for an Arkaik product graph. Contains a project, its nodes (flows, views, data models, API endpoints), and edges (relationships between nodes).",
});
