# Architecture

## Overview

arkaik is a product graph browser built on Next.js 16 App Router with React Flow (`@xyflow/react`). It renders an interactive graph centered on reusable flows and views, with parallel layers for data models and API endpoints.

## App Router Structure

```
app/
  layout.tsx            # Root layout: fonts (Geist), ThemeProvider, global CSS
  page.tsx              # Home page: component showcase / project list
  generate/
    page.tsx            # Prompt builder UI for LLM-assisted ProjectBundle generation
  llms-full.txt/
    route.ts            # Full LLM-readable context bundle (docs + schema + example)
  sitemap.ts            # XML sitemap route
  docs/
    layout.tsx          # Documentation shell with sidebar + page frame
    page.tsx            # Docs home: renders repository root README.md
    [...slug]/
      page.tsx          # Markdown document route mapped from docs/**/*.md
  project/
    [id]/
      layout.tsx        # Shared project shell with persistent sidebar + project switcher
      page.tsx          # Redirects to /project/[id]/overview — a project opens on the global picture
      canvas/
        page.tsx        # Redirects to /project/[id]/maps/journey (old links keep working)
      overview/
        page.tsx        # Overview dashboard — the strategist reading over lib/utils/coverage.ts projections
      maps/
        page.tsx        # Maps index — built-ins + custom maps from project.metadata.maps
        [mapId]/
          page.tsx      # Renderer shell: journey → JourneyMap, system → SystemMap
      library/
        page.tsx        # Gallery/directory node browser (species via sidebar ?species= links)
      delivery/
        page.tsx        # Delivery board — (node × platform) items grouped by status
      changelog/
        page.tsx        # Releases + backlog derived from the journal
  p/
    [id]/
      page.tsx          # Publik snapshot preview (server-rendered)
  api/                  # Publik, Synk, and auth route handlers (spec/services.md)
```

The Journey map (`components/maps/JourneyMap.tsx`) is the core of the graph renderer; its graph construction is the pure `buildJourneyGraph` in `lib/utils/journey-graph.ts` (golden-tested against the Pebbles seed). It:

1. Loads nodes and edges via `useNodes` and `useEdges`
2. Manages expansion state for flows via local `useState`
3. Computes per-platform view statuses and flow rollup gauges
4. Maps domain nodes to React Flow nodes with position, type, card-variant preference, and toggle handlers
5. Renders the `Canvas` component with computed nodes and edges
6. Opens `NodeDetailPanel` on node click for viewing/editing properties
7. Opens `NewNodeForm` (Dialog) via a floating "New node" button for creating nodes
8. Opens `InsertBetweenDialog` from compose-edge insert actions for search-or-create insertion in flow playlists

## Component Map

```
components/
  graph/
    Canvas.tsx              # ReactFlow wrapper — registers node/edge types, renders Controls, MiniMap, Background
    nodes/                  # Custom React Flow node components
      FlowNode.tsx          # Container card for flow nodes with rollup gauges
      ViewNode.tsx          # Variant-based View cards (compact/large), API actions, platform/API popovers
      PlatformGaugeList.tsx # Shared stacked gauge renderer for flow cards and panels
      DataModelNode.tsx     # Parallel layer — amber, Database icon
      ApiEndpointNode.tsx   # Parallel layer — teal, Plug icon
      node-styles.ts        # Status/platform style maps
    edges/
      ComposeEdge.tsx       # Straight — hierarchy (composes)
      CrossLayerEdge.tsx    # Dashed straight — cross-layer references (not yet registered in Canvas)
  maps/
    JourneyMap.tsx          # The Journey map surface: expansion state, editing, dialogs, toolbar
    SystemMap.tsx           # The System map surface: species tiers, cross-layer edges, connect-to-create
    MapCard.tsx             # Maps-index card with kind badge + subgraph counts
    MapEditorDialog.tsx     # Create/edit custom maps (project.metadata.maps)
  delivery/
    DeliveryBoard.tsx       # Status columns of (node × platform) items
    PlatformItemCard.tsx    # Slim node×platform card
    DeliveryFilterBar.tsx   # Platform/species chips, all-statuses toggle, search
  overview/
    OverviewSection.tsx     # Shared dashboard card shell (title + jump-off link)
    PlatformGaugesCard.tsx  # Product-wide per-platform delivery gauges (PlatformGaugeList)
    DeliverySnapshotCard.tsx # Board column totals without the board
    ReleasePulseCard.tsx    # Tagged releases, newest first, with change counts
    BacklogCard.tsx         # Open ideas/requests summary + first rows
    InventoryCard.tsx       # Census by species with status dots; rows link into the library
    HealthCard.tsx          # Doc-health indicators with per-indicator evidence links
    MapsCard.tsx            # Every map with live subgraph counts
  layout/
    Minimap.tsx             # React Flow minimap wrapper (unused — Canvas uses @xyflow/react MiniMap directly)
    ProjectSidebar.tsx      # Persistent in-project sidebar navigation
    ProjectSwitcher.tsx     # Sidebar header dropdown for cross-project navigation
    StatusBadge.tsx         # Colored pill with status label
  library/
    LibraryFilterBar.tsx # Species/search/display controls for the library page
    NodeCard.tsx         # Gallery-mode card for a single node
    NodeTable.tsx        # Directory-mode sortable table for nodes
  generate/
    PromptBuilderForm.tsx # Use-case aware form (pitch/plan/extend) and advanced options
    PromptOutput.tsx      # Prompt preview, token estimate, copy/download actions
  panels/
    NewNodeForm.tsx         # Dialog form for creating a node with species-aware status/platform defaults
    InsertBetweenDialog.tsx # Dialog for insert-between actions: choose view/flow, search existing, or create inline
    NodeDetailPanel.tsx     # Slide-in sheet: edit node fields, platform-specific statuses, computed rollups, and flow playlists
    PlaylistEditor.tsx      # Flow-only playlist editor: add/remove/reorder and branch editing
    PlaylistEntryRow.tsx    # Recursive playlist row renderer for condition/junction branches
    NodeSearchCombobox.tsx  # Search-or-create selector for flow/view references
    PlatformVariants.tsx    # Platform tab switcher with per-platform status and notes
    RawBundleSheet.tsx      # Raw JSON/YAML bundle viewer/editor sheet (guarded edit + save-back)
  ui/                       # shadcn/ui primitives (button, card, dialog, input, etc.)
    dropdown-menu.tsx       # Radix dropdown wrapper used by the project switcher
    popover.tsx             # Radix popover wrapper used by View card API/platform details
    sidebar.tsx             # shadcn sidebar primitives used by the project layout shell
```

## Data Flow

```
IndexedDB (Dexie)
    ↕ (read/write)
localProvider (implements DataProvider, via getProvider())
    ↕ (async calls)
Hooks: useNodes, useEdges, useProject, useProjects, useJournal
    ↕ (state)
app/project/[id]/layout.tsx (sidebar shell + route-aware navigation)
  ↕ (props)
ProjectSidebar + ProjectSwitcher
  ↕ (route changes)
components/maps/JourneyMap.tsx (expansion state; buildJourneyGraph builds topology)
    ↕ (props)
Canvas → ReactFlow → Custom Nodes/Edges
    ↕ (click events)
NodeDetailPanel → Hook (updateNode) → Provider → Storage
NewNodeForm (Dialog) → Hook (addNode) → Provider → Storage
View card variant selector → Hook (useProject.updateProject) → Provider → Storage

Library route data flow:

Hooks: useNodes, useEdges
  ↕ (state)
app/project/[id]/library/page.tsx
  ↕ (props)
LibraryFilterBar + NodeCard/NodeTable
  ↕ (click events)
NodeDetailPanel / NewNodeForm → hooks → Provider → Storage

Project-shell navigation flow:

Hooks: useProject, useProjects
  ↕ (state)
app/project/[id]/layout.tsx
  ↕ (props)
ProjectSidebar / ProjectSwitcher
  ↕ (pathname + searchParams)
Route-aware active states + cross-project navigation

Docs route flow:

app/docs/layout.tsx
  ↕ (server-loaded nav items)
DocsSidebar
  ↕ (pathname)
Route-aware docs links
  ↕ (slug lookup)
app/docs/page.tsx + app/docs/[...slug]/page.tsx
  ↕
lib/utils/docs.ts (filesystem discovery + slug-safe lookup)
  ↕
components/docs/MarkdownContent.tsx (react-markdown + GFM + highlighting)

Docs pages are rendered from markdown at request/build time using server-side file reads. The home route (`/docs`) is pinned to repository `README.md`, while nested routes resolve to markdown under `docs/`. Unknown paths redirect back to `/docs`.

Prompt generation flow:

app/generate/page.tsx
  ↕ (local state)
components/generate/PromptBuilderForm.tsx
  ↕ (typed config)
lib/prompts/assemble.ts
  ↕ (text blocks)
lib/prompts/blocks.ts + lib/prompts/types.ts
  ↕ (preview actions)
components/generate/PromptOutput.tsx

LLM affordance assets:

- `public/llms.txt` exposes a concise site + model manifest.
- `app/llms-full.txt/route.ts` serves a larger, plain-text context bundle for crawlers/agents.
- `public/schema/project-bundle.json` and `public/schema/example-bundle.json` define and demonstrate the import contract.
- `public/robots.txt` and `app/sitemap.ts` support discoverability.
```

All data mutations flow through the `DataProvider` interface (`lib/data/data-provider.ts`). The current implementation is `localProvider` backed by IndexedDB (Dexie — `lib/data/db.ts`), which writes per project rather than rewriting the whole store on every mutation. The interface plus the `getProvider()`/`setProvider()` seam (`lib/data/provider-registry.ts`) let the backend change without touching hooks or UI — the seam a future read-only repo-bundle provider ([rfcs/arkaik-dev.md](rfcs/arkaik-dev.md)) injects through.

## Playlist Expansion

The project page manages one expansion set as local `useState`:

- `expandedFlows` — which flows show their direct flow/view children

When `project.root_node_id` is present, the canvas walks the full compose closure from that node — views always render and chain the walk onward; flows render as collapsed cards. When it is missing, root nodes are inferred from nodes with no compose parent. The first top-level flow auto-expands on initial load.

Expanded flows reveal ordered children from `metadata.playlist` and `composes` edges. Positions are computed by ELK (`lib/utils/elk-layout.ts`, layered algorithm over compose edges).

Canvas visibility rule (Journey map):

- Rendered nodes: `flow`, `view`
- Not rendered here: `data-model`, `api-endpoint` (still persisted; they render on the System map once roadmap CP-C lands — [spec/maps.md](spec/maps.md))

View card variants:

- `compact` (default): header + API buttons + platform status icons
- `large`: header + optional cover + platform status rows + API buttons

Project preference source: `project.metadata.view_card_variant` in [lib/data/types.ts](../lib/data/types.ts)

## Node Detail Panel

Clicking any node opens a slide-in `Sheet` (`NodeDetailPanel`) with:

- **Editable fields**: title, description, and species-aware status/platform controls
- **Connections**: cross-layer nodes (data-model, api-endpoint) with click-to-navigate
- **Where Used**: reverse reference list showing which flow playlists currently include the selected node
- **Platform Variants** (view only): per-platform status + notes stored in `node.metadata`
- **Computed gauges** (`flow`): read-only per-platform rollups built from descendant views
- **Playlist editor** (`flow`): ordered `metadata.playlist.entries` editing with add/remove/reorder and recursive condition/junction branch editing

Flow playlist editing uses fuzzy search-or-create for `view` and `flow` entries. When adding a flow reference, cycle checks run before persisting and invalid inserts are blocked with toast feedback.

Compose edges in expanded sequences expose a single insert action. It opens `InsertBetweenDialog`, where users choose `view`, `flow`, `condition`, or `junction`. For `view`/`flow`, the dialog reuses `NodeSearchCombobox` to select existing nodes or create new ones inline; for `condition`/`junction`, it inserts structured entries with sensible defaults. Node-reference inserts are placed at the correct playlist position and ensure the compose edge exists.

Edits call `useNodes.updateNode` which flows through the `DataProvider`.

## Library

The library route (`app/project/[id]/library/page.tsx`) is the project-wide browser for reusable nodes.

- **Gallery view**: card layout using `NodeCard` for scanning titles, species/status badges, and flow playlist previews.
- **Directory view**: sortable table using `NodeTable` for dense auditing (`id`, `title`, `species`, `status`, `used in`).
- **Filter controls**: species selection is owned by the sidebar (`?species=` deep links); `LibraryFilterBar` owns text search and the gallery/directory display toggle.

Library interactions reuse the same edit/create surfaces as canvas (`NodeDetailPanel`, `NewNodeForm`) so data mutation paths stay identical.

## Sidebar Navigation

Project-level navigation is defined in `app/project/[id]/layout.tsx` and rendered by `ProjectSidebar` + `ProjectSwitcher`.

- Sidebar links are route-aware (`canvas`, `library`) and preserve active state from pathname/search params.
- The switcher supports cross-project navigation while keeping users in the closest equivalent destination.
- Keeping navigation in the shared project layout avoids duplicated route chrome in child pages.

## Theming

- `next-themes` for light/dark mode
- `ThemeProvider` wraps the entire app in the root layout
- `ThemeToggle` component for user switching
- Tailwind CSS with shadcn/ui design tokens
- Sidebar theme tokens live in `app/globals.css` and back the shadcn sidebar primitives

## Source References

- Graph orchestration: [components/maps/JourneyMap.tsx](../components/maps/JourneyMap.tsx), [lib/utils/journey-graph.ts](../lib/utils/journey-graph.ts), [lib/utils/system-graph.ts](../lib/utils/system-graph.ts)
- Project shell: [app/project/[id]/layout.tsx](../app/project/[id]/layout.tsx)
- Library orchestration: [app/project/[id]/library/page.tsx](../app/project/[id]/library/page.tsx)
- Sidebar components: [components/layout/ProjectSidebar.tsx](../components/layout/ProjectSidebar.tsx), [components/layout/ProjectSwitcher.tsx](../components/layout/ProjectSwitcher.tsx)
- Docs shell + renderer: [app/docs/layout.tsx](../app/docs/layout.tsx), [app/docs/page.tsx](../app/docs/page.tsx), [app/docs/[...slug]/page.tsx](../app/docs/[...slug]/page.tsx), [components/layout/DocsSidebar.tsx](../components/layout/DocsSidebar.tsx), [components/docs/MarkdownContent.tsx](../components/docs/MarkdownContent.tsx), [lib/utils/docs.ts](../lib/utils/docs.ts)
- Prompt builder: [app/generate/page.tsx](../app/generate/page.tsx), [components/generate/PromptBuilderForm.tsx](../components/generate/PromptBuilderForm.tsx), [components/generate/PromptOutput.tsx](../components/generate/PromptOutput.tsx), [lib/prompts/assemble.ts](../lib/prompts/assemble.ts), [lib/prompts/blocks.ts](../lib/prompts/blocks.ts), [lib/prompts/types.ts](../lib/prompts/types.ts)
- React Flow registry: [components/graph/Canvas.tsx](../components/graph/Canvas.tsx)
- Data hooks: [lib/hooks/useNodes.ts](../lib/hooks/useNodes.ts), [lib/hooks/useEdges.ts](../lib/hooks/useEdges.ts), [lib/hooks/useProject.ts](../lib/hooks/useProject.ts), [lib/hooks/useProjects.ts](../lib/hooks/useProjects.ts)
- Data provider: [lib/data/local-provider.ts](../lib/data/local-provider.ts)
- LLM surfaces: [public/llms.txt](../public/llms.txt), [app/llms-full.txt/route.ts](../app/llms-full.txt/route.ts), [public/schema/project-bundle.json](../public/schema/project-bundle.json), [public/schema/example-bundle.json](../public/schema/example-bundle.json), [public/robots.txt](../public/robots.txt), [app/sitemap.ts](../app/sitemap.ts)
