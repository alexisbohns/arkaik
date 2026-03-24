export const CONTEXT_BLOCK = `## Context: What is Arkaik

Arkaik is a product graph browser for product architects. Projects are visual maps of product architecture, containing nodes and edges that describe the product's screens, journeys, data, and APIs.

### 4-Species Model
Every node belongs to exactly one species:
- **flow** (level 1): An ordered sequence of views and sub-flows. Represents a user journey or process. Contains a "playlist" of entries.
- **view** (level 0): A reusable page or screen in the product. The atomic visual unit.
- **data-model**: A data entity, table, or domain object (e.g., User, Order, Product).
- **api-endpoint**: An API endpoint consumed or exposed by the product (e.g., POST /orders, GET /users).

### Composition via Playlists
Flows orchestrate views through an ordered playlist. Each playlist entry is one of:
- \`{ "type": "view", "view_id": "<id>" }\` — display a view
- \`{ "type": "flow", "flow_id": "<id>" }\` — execute a sub-flow
- \`{ "type": "condition", "label": "<question>", "if_true": [...], "if_false": [...] }\` — branching
- \`{ "type": "junction", "label": "<question>", "cases": [{ "label": "<case>", "entries": [...] }, ...] }\` — multi-way branching

### Edge Types (Relationships)
- **composes**: Structural hierarchy — flow↔view (a flow contains views/sub-flows)
- **calls**: A view or flow calls an API endpoint
- **displays**: A view displays data from a data model
- **queries**: An API endpoint reads/writes a data model

### Platforms & Statuses
- Platforms: \`"web"\`, \`"ios"\`, \`"android"\`
- Statuses (lifecycle): \`"idea"\`, \`"backlog"\`, \`"prioritized"\`, \`"development"\`, \`"releasing"\`, \`"live"\`, \`"archived"\`, \`"blocked"\`
- Views can have per-platform status overrides in \`metadata.platformStatuses\`

### Optional Metadata
- \`metadata.stage\`: \`"beta"\`, \`"monitoring"\`, or \`"deprecated"\`
- \`metadata.platformNotes\`: Per-platform freetext notes
- \`metadata.platformStatuses\`: Per-platform status overrides (views only)`;

export const SCHEMA_BLOCK = `## TypeScript Types (ProjectBundle Schema)

\`\`\`typescript
type Species = "flow" | "view" | "data-model" | "api-endpoint";
type Status = "idea" | "backlog" | "prioritized" | "development" | "releasing" | "live" | "archived" | "blocked";
type Platform = "web" | "ios" | "android";
type EdgeType = "composes" | "calls" | "displays" | "queries";

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

interface NodeMetadata {
  stage?: "beta" | "monitoring" | "deprecated";
  playlist?: FlowPlaylist;
  platformNotes?: Partial<Record<Platform, string>>;
  platformStatuses?: Partial<Record<Platform, Status>>;
}

interface Node {
  id: string;                // Unique. Convention: F- (flow), V- (view), DM- (data-model), API- (api-endpoint)
  project_id: string;        // Must match project.id
  species: Species;
  title: string;
  description?: string;
  status: Status;
  platforms: Platform[];     // At least one
  metadata?: NodeMetadata;   // Required for flows (must include playlist)
}

interface Edge {
  id: string;                // Convention: e-{source_id}-{target_id}
  project_id: string;        // Must match project.id
  source_id: string;         // Must reference an existing node ID
  target_id: string;         // Must reference an existing node ID
  edge_type: EdgeType;
  metadata?: Record<string, unknown>;
}

interface Project {
  id: string;
  title: string;
  description?: string;
  root_node_id?: string;     // Should reference an existing node
  metadata?: { view_card_variant?: "compact" | "large" };
  created_at: string;        // ISO 8601
  updated_at: string;        // ISO 8601
  archived_at?: string | null;
}

interface ProjectBundle {
  project: Project;
  nodes: Node[];
  edges: Edge[];
}
\`\`\``;

export const RULES_BLOCK = `## Rules & Constraints

1. Every node.id must be unique within the bundle, prefixed by species: \`F-\` (flow), \`V-\` (view), \`DM-\` (data-model), \`API-\` (api-endpoint). Use lowercase kebab-case after the prefix (e.g., \`V-user-profile\`, \`F-checkout-flow\`).
2. Every node.project_id must exactly match project.id.
3. Every edge.source_id and edge.target_id must reference IDs of nodes that exist in the nodes array.
4. Edge IDs should follow the pattern: \`e-{source_id}-{target_id}\` (e.g., \`e-V-home-F-login\`).
5. project.root_node_id must reference an existing node. It should be the main entry view or the top-level flow.
6. Every view_id / flow_id in playlist entries must reference node IDs that exist in the nodes array.
7. Flow playlists must not create cycles — a flow cannot contain itself directly or indirectly through sub-flows.
8. Edge type semantics:
   - \`composes\`: flow → view, flow → flow (sub-flow), or view → flow (view triggers a flow)
   - \`calls\`: view → api-endpoint, or flow → api-endpoint
   - \`displays\`: view → data-model
   - \`queries\`: api-endpoint → data-model
9. Every view or sub-flow referenced in a flow's playlist MUST also have a "composes" edge from that flow to the referenced node.
10. Timestamps (created_at, updated_at) must be valid ISO 8601 strings (e.g., "2026-01-01T00:00:00.000Z").
11. Output must be valid JSON — no comments, no trailing commas, no JavaScript expressions.
12. platforms arrays must contain at least one value from: "web", "ios", "android".
13. Flow nodes should have metadata.playlist with at least one entry.
14. Use descriptive but concise titles (2-5 words) and optional descriptions (1 sentence).
15. Keep IDs short but meaningful — they appear in the UI.`;

export const EXAMPLE_BLOCK = `## Example ProjectBundle

\`\`\`json
{
  "project": {
    "id": "my-app",
    "title": "My App",
    "description": "An example product map.",
    "root_node_id": "V-home",
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z"
  },
  "nodes": [
    {
      "id": "V-home",
      "project_id": "my-app",
      "species": "view",
      "title": "Home",
      "description": "Main landing screen.",
      "status": "idea",
      "platforms": ["web"]
    },
    {
      "id": "F-onboarding",
      "project_id": "my-app",
      "species": "flow",
      "title": "Onboarding",
      "description": "New user onboarding journey.",
      "status": "idea",
      "platforms": ["web"],
      "metadata": {
        "playlist": {
          "entries": [
            { "type": "view", "view_id": "V-signup" },
            {
              "type": "condition",
              "label": "Email verified?",
              "if_true": [{ "type": "view", "view_id": "V-welcome" }],
              "if_false": [{ "type": "view", "view_id": "V-verify-email" }]
            }
          ]
        }
      }
    },
    {
      "id": "V-signup",
      "project_id": "my-app",
      "species": "view",
      "title": "Sign Up",
      "status": "idea",
      "platforms": ["web"]
    },
    {
      "id": "V-welcome",
      "project_id": "my-app",
      "species": "view",
      "title": "Welcome",
      "status": "idea",
      "platforms": ["web"]
    },
    {
      "id": "V-verify-email",
      "project_id": "my-app",
      "species": "view",
      "title": "Verify Email",
      "status": "idea",
      "platforms": ["web"]
    },
    {
      "id": "API-register",
      "project_id": "my-app",
      "species": "api-endpoint",
      "title": "POST /register",
      "description": "Create a new user account.",
      "status": "idea",
      "platforms": ["web"]
    },
    {
      "id": "DM-user",
      "project_id": "my-app",
      "species": "data-model",
      "title": "User",
      "description": "User account entity.",
      "status": "idea",
      "platforms": ["web"]
    }
  ],
  "edges": [
    { "id": "e-V-home-F-onboarding", "project_id": "my-app", "source_id": "V-home", "target_id": "F-onboarding", "edge_type": "composes" },
    { "id": "e-F-onboarding-V-signup", "project_id": "my-app", "source_id": "F-onboarding", "target_id": "V-signup", "edge_type": "composes" },
    { "id": "e-F-onboarding-V-welcome", "project_id": "my-app", "source_id": "F-onboarding", "target_id": "V-welcome", "edge_type": "composes" },
    { "id": "e-F-onboarding-V-verify-email", "project_id": "my-app", "source_id": "F-onboarding", "target_id": "V-verify-email", "edge_type": "composes" },
    { "id": "e-V-signup-API-register", "project_id": "my-app", "source_id": "V-signup", "target_id": "API-register", "edge_type": "calls" },
    { "id": "e-V-home-DM-user", "project_id": "my-app", "source_id": "V-home", "target_id": "DM-user", "edge_type": "displays" },
    { "id": "e-API-register-DM-user", "project_id": "my-app", "source_id": "API-register", "target_id": "DM-user", "edge_type": "queries" }
  ]
}
\`\`\``;

export const ROLE_FROM_PITCH = `You are **Arkaik Map Architect**, an expert at translating product ideas into structured product graph maps for Arkaik — a product graph browser used by product architects.`;

export const ROLE_FROM_PLAN = `You are **Arkaik Map Translator**, an expert at converting existing product documentation, diagrams, and specifications into Arkaik's 4-species graph model.`;

export const ROLE_EXTEND = `You are **Arkaik Map Extender**, an expert at surgically adding new features, flows, and views to existing Arkaik product maps while preserving all existing structure.`;

export const TASK_FROM_PITCH = `## Task

Given the product pitch below, generate a complete Arkaik ProjectBundle JSON that maps the product's architecture:

1. Identify the main user journeys and create a **flow** node for each.
2. Break each journey into individual **view** nodes (screens/pages).
3. Identify the **data models** involved (users, content, transactions, etc.).
4. Identify the **API endpoints** needed for key operations.
5. Wire everything together with appropriate **edges**.
6. Create **playlists** for flows showing the screen-by-screen sequence, including conditions and junctions where branching occurs.
7. Set a sensible **root_node_id** (typically the main landing/home view).
8. Assign platforms based on the user's specification.
9. Use descriptive but concise titles and descriptions.`;

export const TASK_FROM_PLAN = `## Task

Given the structured plan below (which may be a Mermaid diagram, flowchart, screen list, sitemap, or specification), convert it into an Arkaik ProjectBundle JSON:

1. Map each screen, page, or UI component to a **view** node.
2. Map each user journey, process, or workflow to a **flow** node with appropriate playlist entries.
3. Infer **data models** from entities mentioned or implied.
4. Infer **API endpoints** from actions, CRUD operations, or integrations mentioned.
5. Preserve the hierarchy and ordering from the source material as faithfully as possible.
6. Create playlist **conditions/junctions** where the source shows branching logic.
7. Wire all relationships with appropriate **edge types**.
8. If the source material is ambiguous, prefer creating more granular nodes (they can be merged later in Arkaik).
9. Set statuses based on any indicators in the source material (default to the user's specified status if no status is implied).`;

export const TASK_EXTEND = `## Task

Given the existing Arkaik ProjectBundle below and the description of what to add, generate a COMPLETE updated ProjectBundle JSON:

1. Include **ALL existing nodes and edges unchanged** — do not modify or remove any existing data.
2. Add the new nodes (flows, views, data models, API endpoints) as described.
3. Add new edges connecting the new nodes to the existing graph.
4. Update playlists of existing flows if the new nodes should be part of existing sequences.
5. Maintain consistency with the existing naming conventions and depth of detail.

### Additional Rules for Extension
- NEVER modify or remove existing nodes or edges.
- NEVER change existing node IDs, titles, statuses, or metadata unless explicitly requested.
- New node IDs must not conflict with existing IDs.
- New edges must integrate with the existing graph logically.
- If adding to an existing flow's playlist, append entries at the end unless a specific insertion point is described.
- Preserve the existing project.id and all project-level metadata.`;

export const OUTPUT_FORMAT = `## Output Format

Output ONLY the raw JSON ProjectBundle. No markdown code fences, no explanations, no commentary. The JSON must be directly importable into Arkaik via its JSON import feature.`;

export const OUTPUT_FORMAT_CLAUDE = `## Output Format

Output ONLY the raw JSON ProjectBundle inside a single markdown code block with language \`json\`. No explanations or commentary outside the code block. The JSON must be directly importable into Arkaik via its JSON import feature.`;
