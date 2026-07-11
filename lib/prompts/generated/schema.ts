// GENERATED FILE — DO NOT EDIT BY HAND.
// Built from packages/schema/src via `npm run generate`
// (docs/spec/toolchain.md § @arkaik/schema).

export const SPECIES_IDS = ["flow", "view", "data-model", "api-endpoint"] as const;
export const STATUS_IDS = ["idea", "backlog", "prioritized", "development", "releasing", "live", "archived", "blocked"] as const;
export const PLATFORM_IDS = ["web", "ios", "android"] as const;
export const EDGE_TYPE_IDS = ["composes", "calls", "displays", "queries"] as const;

export const SPECIES_PREFIXES: Record<(typeof SPECIES_IDS)[number], string> = {
  "flow": "F-",
  "view": "V-",
  "data-model": "DM-",
  "api-endpoint": "API-",
};

export const SCHEMA_BLOCK = `## TypeScript Types (ProjectBundle Schema)

\`\`\`typescript
type SpeciesId = "flow" | "view" | "data-model" | "api-endpoint";
type StatusId = "idea" | "backlog" | "prioritized" | "development" | "releasing" | "live" | "archived" | "blocked";
type PlatformId = "web" | "ios" | "android";
type EdgeTypeId = "composes" | "calls" | "displays" | "queries";

type PlaylistEntry =
  | { type: "view"; view_id: string }
  | { type: "flow"; flow_id: string }
  | { type: "condition"; label: string; if_true: PlaylistEntry[]; if_false: PlaylistEntry[] }
  | { type: "junction"; label: string; cases: JunctionCase[] };

interface JunctionCase {
  label: string;
  entries: PlaylistEntry[];
}

interface FlowPlaylist {
  entries: PlaylistEntry[];
}

type PlatformNotesMap = Partial<Record<PlatformId, string>>;
type PlatformStatusMap = Partial<Record<PlatformId, StatusId>>;
type PlatformScreenshotsMap = Partial<Record<PlatformId, string>>;

interface NodeMetadata extends Record<string, unknown> {
  stage?: string;
  playlist?: FlowPlaylist;
  platformNotes?: PlatformNotesMap;
  platformStatuses?: PlatformStatusMap;
  platformScreenshots?: PlatformScreenshotsMap;
}

interface Node {
  id: string;
  project_id: string;
  species: SpeciesId;
  title: string;
  description?: string;
  status: StatusId;
  platforms: PlatformId[];
  metadata?: NodeMetadata;
}

interface Edge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  edge_type: EdgeTypeId;
  metadata?: Record<string, unknown>;
}

interface ProjectMetadata extends Record<string, unknown> {
  view_card_variant?: "compact" | "large";
}

interface Project {
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

interface ProjectBundle {
  project: Project;
  nodes: Node[];
  edges: Edge[];
}
\`\`\``;
