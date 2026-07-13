# Arkaik ProjectBundle Schema Reference

## Table of Contents

1. [Types](#types)
2. [Playlist Entries](#playlist-entries)
3. [Edge Type Semantics](#edge-type-semantics)
4. [ID Conventions](#id-conventions)
5. [Validation Checklist](#validation-checklist)

---

## Types

The canonical shape of a ProjectBundle, generated from the `@arkaik/schema` zod
definitions (`docs/spec/toolchain.md` § @arkaik/schema). Do not hand-edit the
block below — run `npm run generate`.

<!-- GENERATED:SCHEMA:START -->
```typescript
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
```
<!-- GENERATED:SCHEMA:END -->

---

## Playlist Entries

Flows orchestrate views through an ordered playlist (`PlaylistEntry`, above).
Each entry is one of `view`, `flow`, `condition`, or `junction`.

**Condition** is a binary branch (yes/no question). The `label` is a question
(e.g., "Email verified?"), and `if_true` / `if_false` contain the entries for
each branch. Either branch can be empty `[]` to mean "skip."

**Junction** is a multi-way branch. The `label` is a question (e.g., "What
action?"), and `cases` is an array of labeled branches, each with its own
entries.

Every `view_id` and `flow_id` in playlist entries must reference node IDs that
exist in the bundle's `nodes` array.

---

## Edge Type Semantics

| Edge type | Valid source → target | Meaning |
|---|---|---|
| `composes` | flow → view | Flow contains this view in its playlist |
| `composes` | flow → flow | Flow contains this sub-flow in its playlist |
| `composes` | view → flow | View triggers/navigates to this flow |
| `composes` | view → view | View contains or navigates to this view |
| `calls` | view → api-endpoint | View calls this API |
| `calls` | flow → api-endpoint | Flow calls this API |
| `displays` | view → data-model | View displays data from this model |
| `queries` | api-endpoint → data-model | API reads or writes this model |

Any other source → target combination for a given edge type is invalid.

---

## ID Conventions

| Species | Prefix | Example |
|---|---|---|
| flow | `F-` | `F-record-pebble` |
| view | `V-` | `V-pebble-detail` |
| data-model | `DM-` | `DM-emotion-pearl` |
| api-endpoint | `API-` | `API-create-pebble` |

After the prefix, use lowercase kebab-case. Keep IDs short but meaningful —
they appear in the Arkaik UI.

Edge IDs: `e-{source_id}-{target_id}` (e.g., `e-V-home-F-onboarding`).

### IDs must be globally unique

A node ID identifies exactly one node. The graph layout (elkjs) and the canvas
(React Flow) both key nodes by ID, so **two nodes sharing an ID break the entire
graph render**, and any edge pointing at that ID silently resolves to whichever
node was defined last.

Derive IDs **deterministically from the title**, then check the result against
every existing ID before adding the node. If a derived ID already exists but the
node is genuinely different, disambiguate the ID (do not reuse it).

### Data-model IDs: concepts vs. physical tables

`DM-` nodes come in two flavors that must derive **distinct** IDs so they never
collide:

| Flavor | Title style | ID derivation | Examples |
|---|---|---|---|
| **Conceptual model** | Capitalized noun ("Pebble", "Bounce", "Soul") | `DM-<concept>` (singular) | `DM-pebble`, `DM-bounce`, `DM-soul` |
| **Physical table / view** | Exact DB identifier, lowercase snake_case (`bounces`, `karma_events`, `v_analytics_kpi_daily`) | `DM-<table_name>` with underscores → hyphens, **preserving pluralisation** | `DM-bounces`, `DM-karma-events`, `DM-v-analytics-kpi-daily` |

The concept **Bounce** (`DM-bounce`) and the table **bounces** (`DM-bounces`) are
different nodes — kebab-casing both to `DM-bounce` is the collision that broke the
map. When a concept and its backing table both exist, keep the concept singular
and the table plural/exact so their IDs differ.

### Titles

- **Views, flows, API endpoints, conceptual data-models:** 2–5 words, descriptive
  and capitalized (e.g., "User Profile", "Record Pebble", "GET /bounce", "Pebble").
- **Physical table / view data-models:** the exact database identifier verbatim
  (e.g., `bounces`, `karma_events`, `v_analytics_kpi_daily`) — do not prettify.

Every node's `title` must be present and non-empty regardless of species.

---

## Validation Checklist

Before saving any changes, verify:

1. All node IDs are unique across the whole bundle (no two nodes share an ID)
2. All node IDs have the correct species prefix
3. Every node has a non-empty `title`
4. All `node.project_id` values match `project.id`
5. All `edge.source_id` and `edge.target_id` reference existing node IDs
6. All `edge.project_id` values match `project.id`
7. Every edge ID follows `e-{source_id}-{target_id}` (update it when you repoint an edge)
8. No duplicate edge relationships (same source, target, and type)
9. `project.root_node_id` references an existing node
10. All `view_id` / `flow_id` in playlists reference existing node IDs
11. Every view/flow referenced in a playlist has a corresponding `composes` edge
12. No playlist cycles (a flow does not contain itself directly or indirectly)
13. All flow nodes have `metadata.playlist` with at least one entry
14. All `platforms` arrays have at least one value
15. Any `metadata.stage` is one of `beta` / `monitoring` / `deprecated`
16. Any `metadata.platformStatuses` / `platformNotes` use valid platforms (and statuses); `platformStatuses` keys are a subset of `node.platforms`
17. `project.metadata.view_card_variant`, if set, is `compact` or `large` (import **rejects** other values)
18. Edge types follow the valid source → target patterns
19. `created_at` / `updated_at` are valid ISO 8601 timestamps; `updated_at` is current

The bundled validator (`scripts/validate-bundle.js`) enforces every item above.
Treat a non-zero exit code as a hard stop — do not commit a bundle it rejects.
