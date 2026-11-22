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
type SpeciesId = "flow" | "view" | "data-model" | "api-endpoint" | "acceptance" | "decision" | "stake" | "option";
type StatusId = "idea" | "discovery" | "backlog" | "development" | "releasing" | "live" | "archived";
type PlatformId = "web" | "ios" | "android";
type EdgeTypeId = "composes" | "calls" | "displays" | "queries" | "covers" | "supersedes" | "generates" | "impacts" | "concerns" | "addresses";

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
  /** Non-empty = the node is blocked at its current status. A node id (rendered as a link) or free text. */
  blocked_by?: string;
  playlist?: FlowPlaylist;
  platformNotes?: PlatformNotesMap;
  platformStatuses?: PlatformStatusMap;
  platformScreenshots?: PlatformScreenshotsMap;
  /** Provenance of each current screenshot plus the CI order watermark; written by the screenshot ops only. */
  platformScreenshotMeta?: PlatformScreenshotMetaMap;
  refs?: Ref[];
  /** Acceptance nodes: one Given/When/Then scenario — the How (spec §3.1). */
  gherkin?: string;
  /** Acceptance nodes: value elements served — the Why (spec §3.2). */
  values?: ValueId[];
  /** Product membership; meaningful on flow, view, and acceptance only. */
  product?: string;
  /** Decision nodes: the decision's own status (spec §2). Not a lifecycle status. */
  decision_status?: DecisionStatusId;
  /** Decision nodes: Context — the Why (markdown). */
  context?: string;
  /** Decision nodes: Consequences — the How (markdown). */
  consequences?: string;
  /** Decision nodes: ISO 8601 date the decision was actually made (backfill-friendly; node.created events carry the write date, not this). */
  decided_at?: string;
  /** Stake nodes: the kind of stake (RFC § 3). */
  stake_species?: StakeSpeciesId;
  /** Stake nodes: observed (default when absent) or anticipated. */
  provenance?: StakeProvenanceId;
  /** Stake nodes: a link into a catalog; only the id is stored, nothing is copied. */
  catalog?: { source: StakeCatalogSource; id: string };
  /** Stake nodes: the signals behind the stake (written at qualification); the durable half of the signal ↔ stake link. */
  evidence?: StakeEvidence[];
  /** Bug, friction and need stakes: how the person feels it (a bug is always expected). */
  felt?: StakeFelt;
  /** Bug, friction and need stakes: how much addressing it matters, 4 (most) to 1. */
  matters?: StakeMatters;
  /** Bug, friction and need stakes: how often the situation comes up. */
  frequency?: StakeFrequency;
  /** Option nodes: the id of the request.filed journal event that seeded the option. */
  suggested_by?: string;
  /** Decision nodes: the options that lost, each with the reason it lost. */
  closed_options?: { option_id: string; reason: string }[];
}

interface PlatformScreenshotMeta {
  ts?: string;
  source?: ScreenshotSource;
  form?: ScreenshotForm;
  commit?: string;
  order?: number;
  ci_order?: number;
}

type PlatformScreenshotMetaMap = Partial<Record<PlatformId, PlatformScreenshotMeta>>;

type MapKind = "journey" | "system" | "screens";

interface MapLayoutHints extends Record<string, unknown> {
  direction?: "DOWN" | "RIGHT" | (string & {});
  /**
   * Canvas layout algorithm: `"organic"` (force-directed with overlap
   * removal) or `"layered"` (hierarchical tiers). Renderers fall back to the
   * kind's default for unknown values (docs/spec/maps.md § MapDefinition).
   */
  algorithm?: "layered" | "organic" | (string & {});
}

type MapFlowPlatformsMode = "rings" | "bars";

type MapViewPlatformsMode = "chips" | "rows";

interface MapDisplayOptions extends Record<string, unknown> {
  /** Screenshot (or cover) art on view cards. */
  images?: boolean;
  /** A flow card's platform delivery: the Pyramid's rings, or stacked bars. */
  flow_platforms?: MapFlowPlatformsMode | (string & {});
  /** A view card's platform availability: circular chips, or labelled rows. */
  view_platforms?: MapViewPlatformsMode | (string & {});
  /** What a minimap node's fill encodes: its status, or its species. */
  minimap_color?: MapMinimapColorMode | (string & {});
}

interface MapDefinition extends Record<string, unknown> {
  /** Kebab-case, unique within the project; built-in ids are reserved. */
  id: string;
  title: string;
  description?: string;
  /** Selects the renderer and the selection defaults below. */
  kind: MapKind | (string & {});
  /** Node filter; defaults by kind (docs/spec/maps.md § MapDefinition). */
  species?: (SpeciesId | (string & {}))[];
  /** Edge filter; defaults by kind. */
  edge_types?: (EdgeTypeId | (string & {}))[];
  /** Scope anchor; the journey renderer falls back to `project.root_node_id`. */
  root_node_id?: string;
  /** Product scope; absent = every product (docs/spec/bundle-format.md § Products). */
  product?: string;
  /** Traversal bound from the root; absent = unbounded. */
  depth?: number;
  layout?: MapLayoutHints;
  /** Card rendering; the human twin is `project.metadata.map_display[id]`. */
  display?: MapDisplayOptions;
}

interface Edge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  edge_type: EdgeTypeId;
  metadata?: Record<string, unknown>;
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

interface JournalEvent extends Record<string, unknown> {
  /** ULID — sortable, collision-free without coordination. */
  id: string;
  /** ISO 8601 timestamp. */
  ts: string;
  /** Who/what wrote it: "alexis", "claude-code", "arkaik-sync", "arkaik-ci". */
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
  /**
   * Free-form evidence for the move — the deployment URL, the store build
   * number. Written by the hosted `release:append` door, the one writer that
   * always knows it; edits through the mutations route never carry it.
   */
  detail?: string;
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
  /** The source's own name, a free string ("user", "beta-feedback"). Never retyped. */
  source?: string;
  node_id?: string;
  /** What sort of source: see {@link SIGNAL_SOURCE_KINDS}. Absent on a legacy request. */
  source_kind?: SignalSourceKind;
  /** The input exactly as voiced, never edited. */
  verbatim?: string;
  /** Seen in the world, or reasoned about ahead of it. Absent reads as observed. */
  provenance?: StakeProvenanceId;
  /** Stakes known at filing time. The durable link is the stake's `metadata.evidence[]`. */
  stake_ids?: string[];
  /** `source_kind: "audit-finding"`: the Kritik finding. Never put an `F-…` id in `node_id` or `stake_ids` (it reads like a flow id). */
  finding_id?: string;
  /** `source_kind: "audit-finding"`: the criterion the finding was raised against. */
  criterion_id?: string;
  url?: string;
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

interface ScreenshotRecordedEvent extends JournalEvent {
  type: "screenshot.recorded";
  node_id: string;
  platform: PlatformId;
  source: ScreenshotSource;
  form: ScreenshotForm;
  url?: string;
  commit?: string;
  order?: number;
  detail?: string;
}

interface ScreenshotRemovedEvent extends JournalEvent {
  type: "screenshot.removed";
  node_id: string;
  platform: PlatformId;
}

type KnownJournalEvent =
  | NodeCreatedEvent
  | NodeUpdatedEvent
  | NodeStatusChangedEvent
  | DecisionStatusChangedEvent
  | NodeDeletedEvent
  | EdgeAddedEvent
  | EdgeRemovedEvent
  | ReleaseTaggedEvent
  | DeliverableShippedEvent
  | IdeaProposedEvent
  | RequestFiledEvent
  | RefAddedEvent
  | RefRemovedEvent
  | RefStatusChangedEvent
  | ScreenshotRecordedEvent
  | ScreenshotRemovedEvent
  | JournalBaselineEvent
  | QualityAuditCompletedEvent
  | QualityFindingOpenedEvent
  | QualityFindingResolvedEvent
  | QualityFindingAcceptedEvent
  | QualitySignalTrippedEvent;

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
| `calls` | api-endpoint → api-endpoint | Endpoint calls another (internal or third-party) API — e.g. a server action / BFF route fanning out to external APIs |
| `calls` | api-endpoint → view | The server initiates: a webhook, an SSE stream, a push landing on this view (the View card's inbound/read affordance) |
| `displays` | view → data-model | View displays data from this model |
| `queries` | api-endpoint → data-model | API reads or writes this model |
| `covers` | acceptance → view | Acceptance anchors a testable promise to this view |
| `covers` | acceptance → flow | Acceptance anchors a testable promise to this flow |
| `supersedes` | decision → decision | The source decision replaces the target |
| `generates` | decision → acceptance | The decision produced this testable promise |
| `generates` | decision → option | The decision selected this option |
| `impacts` | decision → flow, view, data-model or api-endpoint | The decision affects this existing node |
| `impacts` | decision → stake | The decision settles this stake |
| `concerns` | stake → flow, view, data-model or api-endpoint | The part of the product the stake is about |
| `addresses` | option → stake | The option is one way to answer this stake |
| `addresses` | acceptance → stake | The acceptance is the definition of done for this stake |
| `addresses` | acceptance → option | The acceptance carries out this option |

Any other source → target combination for a given edge type is invalid.

---

## ID Conventions

| Species | Prefix | Example |
|---|---|---|
| flow | `F-` | `F-record-pebble` |
| view | `V-` | `V-pebble-detail` |
| data-model | `DM-` | `DM-emotion-pearl` |
| api-endpoint | `API-` | `API-create-pebble` |
| acceptance | `AC-` | `AC-pebble-draw-in-animation` |
| decision | `DEC-` | `DEC-adopt-glyph-wobble` |
| stake | `STK-` | `STK-pebble-reveal-too-slow` |
| option | `OPT-` | `OPT-pebble-skip-reveal-on-reopen` |

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

## Stake nodes

A `stake` (id prefix `STK-`) is something that matters about the product, anchored
to the anatomy by `concerns` edges (stake → flow / view / data-model / api-endpoint).

- `metadata.stake_species` is one of `bug`, `friction`, `need`, `requirement`,
  `risk`, `defect` (`StakeSpeciesId`). A stake missing it is legal and warned about.
- `metadata.provenance` is `observed` (the default when absent) or `anticipated`
  (`StakeProvenanceId`). An anticipated stake may only be a `need`, `requirement`,
  `risk` or `defect`: nothing exists yet to have a bug or a friction.
- `metadata.catalog` is `{ source, id }` with `source` `kritik` (a criterion id such
  as `SAF-01`) or `values` (a value id such as `reduces-anxiety`) (`StakeCatalogSource`).
  Only the id is stored, never anything copied from the catalog.
- `metadata.felt` (`expected`, `wanted`, `delight`; a bug is always `expected`),
  `metadata.matters` (1 to 4) and `metadata.frequency` (`rare`, `some`, `often`) apply
  to `bug`, `friction` and `need` only; a requirement, risk or defect carries none of
  them (the validator warns). They are shown beside a stake's pyramid score and never
  summed with it. A requirement, risk or defect is read against its Kritik criterion's
  criticality (`kritikCriticality`), never copied onto the stake.
- `platforms` is `[]`, and no product membership is stored.
- The node's own `status` is the stored lifecycle and may only be `idea`,
  `discovery` or `archived`; every other state is derived. Anything else is a warning.

## Option nodes

An `option` (id prefix `OPT-`) is one way to address a stake. It never exists
without one: link it with an outgoing `addresses` edge (option → stake), and the
validator warns when there is none.

- `platforms` is `[]`, and no product membership is stored.
- The node's own `status` is the stored lifecycle and may only be `idea`,
  `discovery` or `archived`. Whether it was selected or closed is read from the
  decision, never stored on the option. Anything else is a warning.
- Its answer type is read from the kind of stake it addresses and never stored:
  a bug is answered by a fix, a friction by an enhancement, a need by a feature, a
  requirement by diligence, a risk by a mitigation and a defect by a resolution.
  An option addressing stakes of two answer types is a warning.
- `metadata.suggested_by` is the id of the `request.filed` journal event that
  seeded the option (a string). A name matching no journal event is a warning.
- A decision settles one stake and selects one option: it `impacts` the stake and
  `generates` the option, and `metadata.closed_options` lists the options that lost
  as `{ option_id, reason }`. Writing a decision is not part of this skill yet.

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
14. All `platforms` arrays have at least one value, except on `decision`, `stake` and `option` nodes (platform-agnostic: an empty array is legal)
15. Any `metadata.stage` is one of `beta` / `monitoring` / `deprecated`
16. Any `metadata.platformStatuses` / `platformNotes` use valid platforms (and statuses); `platformStatuses` keys are a subset of `node.platforms`
17. `project.metadata.view_card_variant`, if set, is `compact` or `large` (import **rejects** other values)
18. Edge types follow the valid source → target patterns
19. `created_at` / `updated_at` are valid ISO 8601 timestamps; `updated_at` is current

The bundled validator (`scripts/validate-bundle.js`) enforces every item above.
Treat a non-zero exit code as a hard stop — do not commit a bundle it rejects.
