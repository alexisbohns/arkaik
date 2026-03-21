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
      layout.tsx        # Minimal wrapper
      page.tsx          # Main canvas — semantic zoom logic lives here
```

The project page (`app/project/[id]/page.tsx`) is the core of the app. It:

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
    Sidebar.tsx             # Left panel container (stub)
    StatusBadge.tsx         # Colored pill with status label
  panels/
    NewNodeForm.tsx         # Dialog form for creating a node with species-aware status/platform defaults
    InsertBetweenDialog.tsx # Dialog for insert-between actions: choose view/flow, search existing, or create inline
    NodeDetailPanel.tsx     # Slide-in sheet: edit node fields, platform-specific statuses, computed rollups, and flow playlists
    PlaylistEditor.tsx      # Flow-only playlist editor: add/remove/reorder and branch editing
    PlaylistEntryRow.tsx    # Recursive playlist row renderer for condition/junction branches
    NodeSearchCombobox.tsx  # Search-or-create selector for flow/view references
    PlatformVariants.tsx    # Platform tab switcher with per-platform status and notes
  ui/                       # shadcn/ui primitives (button, card, dialog, input, etc.)
    popover.tsx             # Radix popover wrapper used by View card API/platform details
```

## Data Flow

```
localStorage
    ↕ (read/write)
localProvider (implements DataProvider)
    ↕ (async calls)
Hooks: useNodes, useEdges, useProject
    ↕ (state)
app/project/[id]/page.tsx (semantic zoom + status rollup logic)
    ↕ (props)
Canvas → ReactFlow → Custom Nodes/Edges
    ↕ (click events)
NodeDetailPanel → Hook (updateNode) → Provider → Storage
NewNodeForm (Dialog) → Hook (addNode) → Provider → Storage
View card variant selector → Hook (useProject.updateProject) → Provider → Storage
```

All data mutations flow through the `DataProvider` interface (`lib/data/data-provider.ts`). The current implementation is `localProvider` backed by `localStorage`. The interface is designed for a future Supabase migration — swap the provider, keep the hooks and UI unchanged.

## Semantic Zoom

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
- **Platform Variants** (view only): per-platform status + notes stored in `node.metadata`
- **Computed gauges** (`flow`): read-only per-platform rollups built from descendant views
- **Playlist editor** (`flow`): ordered `metadata.playlist.entries` editing with add/remove/reorder and recursive condition/junction branch editing

Flow playlist editing uses fuzzy search-or-create for `view` and `flow` entries. When adding a flow reference, cycle checks run before persisting and invalid inserts are blocked with toast feedback.

Compose edges in expanded sequences expose a single insert action. It opens `InsertBetweenDialog`, where users choose `view`, `flow`, `condition`, or `junction`. For `view`/`flow`, the dialog reuses `NodeSearchCombobox` to select existing nodes or create new ones inline; for `condition`/`junction`, it inserts structured entries with sensible defaults. Node-reference inserts are placed at the correct playlist position and ensure the compose edge exists.

Edits call `useNodes.updateNode` which flows through the `DataProvider`.

## Theming

- `next-themes` for light/dark mode
- `ThemeProvider` wraps the entire app in the root layout
- `ThemeToggle` component for user switching
- Tailwind CSS with shadcn/ui design tokens

## Source References

- Graph orchestration: [app/project/[id]/page.tsx](../app/project/[id]/page.tsx)
- React Flow registry: [components/graph/Canvas.tsx](../components/graph/Canvas.tsx)
- Data hooks: [lib/hooks/useNodes.ts](../lib/hooks/useNodes.ts), [lib/hooks/useEdges.ts](../lib/hooks/useEdges.ts)
- Data provider: [lib/data/local-provider.ts](../lib/data/local-provider.ts)
