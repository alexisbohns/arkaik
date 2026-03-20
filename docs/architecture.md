# Architecture

## Overview

arkaik is a product graph browser built on **Next.js 16 App Router** with **React Flow** (`@xyflow/react`). It renders an interactive, semantically zoomable graph of product architecture — from high-level products down to individual tokens, with parallel layers for data models and API endpoints.

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

1. Loads a `ProjectBundle` (project + nodes + edges) via `useProject`
2. Manages expansion state for products, scenarios, and flows
3. Maps domain nodes to React Flow nodes with position and type
4. Renders the `Canvas` component with computed nodes and edges

## Component Map

```
components/
  graph/
    Canvas.tsx              # ReactFlow wrapper — registers node/edge types
    nodes/                  # Custom React Flow node components
      ProductNode.tsx       # Level 7 — large circle, Package icon
      ScenarioNode.tsx      # Level 6 — rounded rect, platform dots
      FlowNode.tsx          # Level 5 — rounded rect, violet accent
      StepNode.tsx          # Level 4–0 — views, components, tokens
      ConditionNode.tsx     # Diamond — branching logic
      DataModelNode.tsx     # Parallel layer — amber, Database icon
      ApiEndpointNode.tsx   # Parallel layer — teal, Plug icon
      node-styles.ts        # Status/platform style maps
    edges/
      ComposeEdge.tsx       # Straight — hierarchy (composes, displays, queries)
      BranchEdge.tsx        # Bezier — flow branching
      CrossLayerEdge.tsx    # Dashed straight — cross-layer references
  layout/
    Breadcrumb.tsx          # Navigation breadcrumb trail
    Minimap.tsx             # React Flow minimap wrapper
    PlatformDots.tsx        # Colored dots for web/ios/android
    Sidebar.tsx             # Left panel container (stub)
    StatusBadge.tsx         # Colored pill with status label
  panels/
    NewNodeForm.tsx         # Quick node creation form
    NodeDetailPanel.tsx     # Slide-in sheet for node properties (stub)
    PlatformVariants.tsx    # Platform tab switcher
  ui/                       # shadcn/ui primitives (button, card, input, etc.)
```

## Data Flow

```
localStorage
    ↕ (read/write)
localProvider (implements DataProvider)
    ↕ (async calls)
Hooks: useProject, useNodes, useEdges
    ↕ (state)
app/project/[id]/page.tsx (semantic zoom logic)
    ↕ (props)
Canvas → ReactFlow → Custom Nodes/Edges
```

All data mutations flow through the `DataProvider` interface (`lib/data/data-provider.ts`). The current implementation is `localProvider` backed by `localStorage`. The interface is designed for a future Supabase migration — swap the provider, keep the hooks and UI unchanged.

## Semantic Zoom

The project page manages three expansion sets:

- `expandedProducts` — which products show their child scenarios
- `expandedScenarios` — which scenarios show their child flows
- `expandedFlows` — which flows show their child steps/conditions

When a user clicks a product node, its `onToggle` fires, adding child scenario nodes to the visible graph. Clicking a scenario reveals flows, and clicking a flow reveals steps and conditions. A breadcrumb trail tracks navigation depth.

Nodes are positioned dynamically:
- **Product children** (scenarios): radial layout around the parent
- **Scenario children** (flows): radial layout
- **Flow children** (steps/conditions): linear horizontal layout

## Theming

- `next-themes` for light/dark mode
- `ThemeProvider` wraps the entire app in the root layout
- `ThemeToggle` component for user switching
- Tailwind CSS with shadcn/ui design tokens
