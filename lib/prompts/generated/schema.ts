// GENERATED FILE — DO NOT EDIT BY HAND.
// Built from packages/schema/src via `npm run generate`
// (docs/spec/toolchain.md § @arkaik/schema).

export const SPECIES_IDS = ["flow", "view", "data-model", "api-endpoint", "acceptance"] as const;
export const STATUS_IDS = ["idea", "backlog", "prioritized", "development", "releasing", "live", "archived", "blocked"] as const;
export const PLATFORM_IDS = ["web", "ios", "android"] as const;
export const EDGE_TYPE_IDS = ["composes", "calls", "displays", "queries", "covers"] as const;

export const SPECIES_PREFIXES: Record<(typeof SPECIES_IDS)[number], string> = {
  "flow": "F-",
  "view": "V-",
  "data-model": "DM-",
  "api-endpoint": "API-",
  "acceptance": "AC-",
};

export const SCHEMA_BLOCK = `## TypeScript Types (ProjectBundle Schema)

\`\`\`typescript
type SpeciesId = "flow" | "view" | "data-model" | "api-endpoint" | "acceptance";
type StatusId = "idea" | "backlog" | "prioritized" | "development" | "releasing" | "live" | "archived" | "blocked";
type PlatformId = "web" | "ios" | "android";
type EdgeTypeId = "composes" | "calls" | "displays" | "queries" | "covers";

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

type RefType =
  | "figma"
  | "github-issue"
  | "gitlab-issue"
  | "linear-issue"
  | "github-pr"
  | "gitlab-mr"
  | "url";

interface Ref {
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

interface NodeMetadata extends Record<string, unknown> {
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
  maps?: MapDefinition[];
}

interface Project {
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

interface JournalEvent extends Record<string, unknown> {
  /** ULID — sortable, collision-free without coordination. */
  id: string;
  /** ISO 8601 timestamp. */
  ts: string;
  /** Who/what wrote it: "alexis", "claude-code", "arkaik-sync", "ci". */
  actor?: string;
  /** Event type — the v1 vocabulary, or an unknown forward-compatible value. */
  type: string;
  /** Reserved per-event payload version, for the day a payload shape changes. */
  v?: number;
}

interface NodeCreatedEvent extends JournalEvent {
  type: "node.created";
  node_id: string;
  species: SpeciesId;
  title: string;
}

interface NodeUpdatedEvent extends JournalEvent {
  type: "node.updated";
  node_id: string;
  fields: string[];
  from?: unknown;
  to?: unknown;
}

interface NodeStatusChangedEvent extends JournalEvent {
  type: "node.status_changed";
  node_id: string;
  from: StatusId;
  to: StatusId;
  platform?: PlatformId;
}

interface NodeDeletedEvent extends JournalEvent {
  type: "node.deleted";
  node_id: string;
}

interface EdgeAddedEvent extends JournalEvent {
  type: "edge.added";
  edge_id: string;
  source_id: string;
  target_id: string;
  edge_type: EdgeTypeId;
}

interface EdgeRemovedEvent extends JournalEvent {
  type: "edge.removed";
  edge_id: string;
}

interface ReleaseTaggedEvent extends JournalEvent {
  type: "release.tagged";
  version: string;
  notes?: string;
  platform?: PlatformId;
}

interface IdeaProposedEvent extends JournalEvent {
  type: "idea.proposed";
  title: string;
  description?: string;
  node_id?: string;
}

interface RequestFiledEvent extends JournalEvent {
  type: "request.filed";
  title: string;
  description?: string;
  source?: string;
  node_id?: string;
}

interface RefAddedEvent extends JournalEvent {
  type: "ref.added";
  node_id: string;
  ref_id: string;
  ref_type: string;
  url: string;
}

interface RefRemovedEvent extends JournalEvent {
  type: "ref.removed";
  node_id: string;
  ref_id: string;
}

interface RefStatusChangedEvent extends JournalEvent {
  type: "ref.status_changed";
  node_id: string;
  ref_id: string;
  from?: string;
  to: string;
  synced_at: string;
}

type KnownJournalEvent =
  | NodeCreatedEvent
  | NodeUpdatedEvent
  | NodeStatusChangedEvent
  | NodeDeletedEvent
  | EdgeAddedEvent
  | EdgeRemovedEvent
  | ReleaseTaggedEvent
  | IdeaProposedEvent
  | RequestFiledEvent
  | RefAddedEvent
  | RefRemovedEvent
  | RefStatusChangedEvent;

interface ProjectBundle {
  /** Bundle Format contract version (docs/spec/bundle-format.md § Schema Versioning). Absent MUST be treated as 1. */
  schema_version?: number;
  project: Project;
  nodes: Node[];
  edges: Edge[];
  /** Optional embedded journal — the interchange projection (Level 2). Canonical storage is the JSONL sidecar; see docs/spec/journal.md. */
  journal?: JournalEvent[];
}
\`\`\``;
