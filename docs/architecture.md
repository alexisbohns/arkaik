# Architecture

## Overview

arkaik is a product graph browser built on Next.js 16 App Router with React Flow (`@xyflow/react`). It renders an interactive graph centered on reusable flows and views, with parallel layers for data models and API endpoints.

## App Router Structure

```
app/
  layout.tsx            # Root layout: fonts (Geist), ThemeProvider, global CSS
  page.tsx              # Home page: component showcase / project list
  project/
    [id]/
      layout.tsx        # Shared project shell with persistent sidebar + project switcher
      page.tsx          # Redirects to /project/[id]/canvas
      canvas/
        page.tsx        # Main canvas — playlist expansion and status rollups
      library/
        page.tsx        # Filterable gallery/directory node browser
```

The canvas page (`app/project/[id]/canvas/page.tsx`) is the core of the graph renderer. It:

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
  layout/
    Minimap.tsx             # React Flow minimap wrapper (unused — Canvas uses @xyflow/react MiniMap directly)
    PlatformDots.tsx        # Colored dots for web/ios/android
    ProjectSidebar.tsx      # Persistent in-project sidebar navigation
    ProjectSwitcher.tsx     # Sidebar header dropdown for cross-project navigation
    StatusBadge.tsx         # Colored pill with status label
  library/
    LibraryFilterBar.tsx # Species/search/display controls for the library page
    NodeCard.tsx         # Gallery-mode card for a single node
    NodeTable.tsx        # Directory-mode sortable table for nodes
  panels/
    NewNodeForm.tsx         # Dialog form for creating a node with species-aware status/platform defaults
    InsertBetweenDialog.tsx # Dialog for insert-between actions: choose view/flow, search existing, or create inline
    NodeDetailPanel.tsx     # Slide-in sheet: edit node fields, platform-specific statuses, computed rollups, and flow playlists
    PlaylistEditor.tsx      # Flow-only playlist editor: add/remove/reorder and branch editing
    PlaylistEntryRow.tsx    # Recursive playlist row renderer for condition/junction branches
    NodeSearchCombobox.tsx  # Search-or-create selector for flow/view references
    PlatformVariants.tsx    # Platform tab switcher with per-platform status and notes
  ui/                       # shadcn/ui primitives (button, card, dialog, input, etc.)
    dropdown-menu.tsx       # Radix dropdown wrapper used by the project switcher
    popover.tsx             # Radix popover wrapper used by View card API/platform details
    sidebar.tsx             # shadcn sidebar primitives used by the project layout shell
```

## Data Flow

```
localStorage
    ↕ (read/write)
localProvider (implements DataProvider)
    ↕ (async calls)
Hooks: useNodes, useEdges, useProject, useProjects
    ↕ (state)
app/project/[id]/layout.tsx (sidebar shell + route-aware navigation)
  ↕ (props)
ProjectSidebar + ProjectSwitcher
  ↕ (route changes)
app/project/[id]/canvas/page.tsx (playlist expansion + status rollup logic)
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
```

All data mutations flow through the `DataProvider` interface (`lib/data/data-provider.ts`). The current implementation is `localProvider` backed by `localStorage`. The interface is designed for a future Supabase migration — swap the provider, keep the hooks and UI unchanged.

## Playlist Expansion

The project page manages one expansion set as local `useState`:

- `expandedFlows` — which flows show their direct flow/view children

When `project.root_node_id` is present, that node is rendered as the primary anchor and top-level compose children fan out from it. When it is missing, root nodes are inferred from nodes with no compose parent.

Expanded flows reveal ordered children from `metadata.playlist` and `composes` edges.

Nodes are positioned dynamically:

- Root flows: horizontal row near the top of the canvas
- Root views: horizontal row below root flows
- Flow children: vertical column to the right of the parent flow

Canvas visibility rule:

- Rendered nodes: `flow`, `view`
- Hidden from canvas cards: `data-model`, `api-endpoint` (still persisted in project data)

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
- **Filter controls**: `LibraryFilterBar` owns species filtering and text search.

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

- Graph orchestration: [app/project/[id]/canvas/page.tsx](../app/project/[id]/canvas/page.tsx)
- Project shell: [app/project/[id]/layout.tsx](../app/project/[id]/layout.tsx)
- Library orchestration: [app/project/[id]/library/page.tsx](../app/project/[id]/library/page.tsx)
- Sidebar components: [components/layout/ProjectSidebar.tsx](../components/layout/ProjectSidebar.tsx), [components/layout/ProjectSwitcher.tsx](../components/layout/ProjectSwitcher.tsx)
- React Flow registry: [components/graph/Canvas.tsx](../components/graph/Canvas.tsx)
- Data hooks: [lib/hooks/useNodes.ts](../lib/hooks/useNodes.ts), [lib/hooks/useEdges.ts](../lib/hooks/useEdges.ts), [lib/hooks/useProject.ts](../lib/hooks/useProject.ts), [lib/hooks/useProjects.ts](../lib/hooks/useProjects.ts)
- Data provider: [lib/data/local-provider.ts](../lib/data/local-provider.ts)
