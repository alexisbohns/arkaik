#!/usr/bin/env bash
# ============================================================================
# create-issues.sh
# Creates labels, milestones, and issues for the arkaik project.
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - Run from the root of the arkaik repository, or set REPO below
#
# Usage:
#   chmod +x .github/scripts/create-issues.sh
#   ./.github/scripts/create-issues.sh
#
# The script is idempotent for labels and milestones (uses --force for labels,
# checks existence for milestones). Issues are always created new.
# ============================================================================

set -euo pipefail

REPO="${REPO:-alexisbohns/arkaik}"

echo "🏷️  Creating labels..."

gh label create "setup"  --repo "$REPO" --color "0E8A16" --description "Project setup and scaffolding" --force
gh label create "config" --repo "$REPO" --color "FBCA04" --description "Configuration files"          --force
gh label create "data"   --repo "$REPO" --color "1D76DB" --description "Data layer and storage"       --force
gh label create "graph"  --repo "$REPO" --color "D93F0B" --description "Graph canvas and rendering"   --force
gh label create "ui"     --repo "$REPO" --color "7057FF" --description "UI components"                --force
gh label create "ux"     --repo "$REPO" --color "E4E669" --description "User experience and interaction" --force
gh label create "export" --repo "$REPO" --color "0075CA" --description "Import/export functionality"  --force
gh label create "infra"  --repo "$REPO" --color "B60205" --description "Infrastructure and deployment" --force

echo "✅ Labels created."

# ============================================================================
# Milestones
# ============================================================================
echo ""
echo "🏁 Creating milestones..."

create_milestone() {
  local title="$1"
  local description="$2"
  # Check if milestone already exists
  if gh api "repos/$REPO/milestones" --paginate --jq '.[].title' 2>/dev/null | grep -qxF "$title"; then
    echo "  ⏭️  Milestone '$title' already exists, skipping."
  else
    gh api "repos/$REPO/milestones" -f title="$title" -f description="$description" -f state="open" >/dev/null
    echo "  ✅ Created milestone: $title"
  fi
}

create_milestone "0 · Scaffold"      "Get the project skeleton running — Next.js app, Tailwind, React Flow, config files, deployed to Vercel."
create_milestone "1 · Data Layer"    "Build the typed data model and the storage abstraction."
create_milestone "2 · Graph Canvas"  "Render the graph with custom node components for each species."
create_milestone "3 · Interaction"   "Make the graph navigable with semantic zoom."
create_milestone "4 · Detail Panels" "Build the side panel for inspecting and editing nodes."
create_milestone "5 · CRUD & Seed"   "Full create/edit/delete workflow for nodes and edges, plus seed data."
create_milestone "6 · Polish & Ship" "Home page, export/import UI, visual polish, keyboard shortcuts, README."
create_milestone "7 · Post-MVP"      "Migration to Supabase, auth, RLS, auto-layout, cross-layer jumps, image uploads."

echo "✅ Milestones created."

# ============================================================================
# Helper: create_issue MILESTONE LABELS TITLE BODY
# ============================================================================
create_issue() {
  local milestone="$1"
  local labels="$2"
  local title="$3"
  local body="$4"

  gh issue create \
    --repo "$REPO" \
    --title "$title" \
    --body "$body" \
    --label "$labels" \
    --milestone "$milestone"

  echo "  ✅ Created issue: $title"
}

# ============================================================================
# Phase 0 · Scaffold
# ============================================================================
echo ""
echo "📦 Phase 0 · Scaffold"

create_issue "0 · Scaffold" "setup" \
  "Set up folder structure per spec" \
  "## Context

This issue is part of **Phase 0 · Scaffold** — getting the project skeleton running.

Create the full directory structure as defined in the arkaik spec so that all future modules have a clear home.

## Folder Structure

\`\`\`
src/
  app/
    page.tsx                    ← Home: project selector
    project/[id]/
      page.tsx                  ← Graph canvas for a project
      layout.tsx
  components/
    graph/
      Canvas.tsx                ← React Flow wrapper
      nodes/                    ← Custom node components
      edges/                    ← Custom edge components
    panels/
      NodeDetailPanel.tsx
      NewNodeForm.tsx
      PlatformVariants.tsx
    layout/
      Breadcrumb.tsx, Minimap.tsx, Sidebar.tsx, StatusBadge.tsx, PlatformDots.tsx
  lib/
    config/                     ← species.ts, statuses.ts, edge-types.ts, platforms.ts
    data/
      types.ts, data-provider.ts, local-provider.ts
    hooks/
      useProject.ts, useNodes.ts, useEdges.ts, useGraphNavigation.ts
    utils/
      layout.ts, export.ts
  seed/
    pebbles.json                ← Example project data
\`\`\`

## Acceptance Criteria

- [ ] All directories from the spec exist: \`components/graph/nodes\`, \`components/panels\`, \`lib/config\`, \`lib/data\`, \`lib/hooks\`, \`lib/utils\`, \`seed/\`"

create_issue "0 · Scaffold" "config" \
  "Create config files: species, statuses, edge types, platforms" \
  "## Context

This issue is part of **Phase 0 · Scaffold**. Create the initial config modules so the app can import a single source of truth for the species hierarchy, lifecycle statuses, edge types, and platform variants.

### Species Model (Atomic Hierarchy)

- Level 0: **Token** (color token, spacing value, translation key)
- Level 1: **State** (button:hover, card:loading, input:error)
- Level 2: **Component** (Button, Card, Input)
- Level 3: **Section** (Card grid, Header bar)
- Level 4: **View / Step** (a page or screen in a flow)
- Level 5: **Flow** (a sequence of steps)
- Level 6: **Scenario** (a composed set of flows)
- Level 7: **Product** (top-level)

Plus two parallel layers: **Data Models** and **API Endpoints**.

### Lifecycle Statuses

Idea → Planned → In Development → Live → Deprecated

### Edge Types

composes, branches, calls, displays, queries

### Platforms

Web 🟢, iOS 🔵, Android 🟣

## Acceptance Criteria

- [ ] \`species.ts\`, \`statuses.ts\`, \`edge-types.ts\`, \`platforms.ts\` exported as typed constants matching the spec"

create_issue "0 · Scaffold" "infra" \
  "Deploy empty shell to Vercel" \
  "## Context

This issue is part of **Phase 0 · Scaffold**. Connect the GitHub repo to Vercel so that every push to main automatically deploys the app.

## Acceptance Criteria

- [ ] GitHub repo connected to Vercel
- [ ] Push to main triggers auto-deploy
- [ ] Live URL accessible"

# ============================================================================
# Phase 1 · Data Layer
# ============================================================================
echo ""
echo "📦 Phase 1 · Data Layer"

create_issue "1 · Data Layer" "data" \
  "Define TypeScript types: Node, Edge, Project, ProjectBundle" \
  "## Context

This issue is part of **Phase 1 · Data Layer** — building the typed data model and storage abstraction.

Define the core TypeScript interfaces that represent the arkaik data model. These types mirror the SQL schema and will be used throughout the application.

### Data Model

Three tables: \`projects\`, \`nodes\`, \`edges\`. Every node and edge is scoped to a \`project_id\` for future multi-tenancy.

### Key Types

- **Node**: id, project_id, species, title, description, status, platforms, parent_id, position_x, position_y, metadata
- **Edge**: id, project_id, source_id, target_id, edge_type, metadata
- **Project**: id, title, description, created_at, updated_at
- **ProjectBundle**: project + nodes[] + edges[] (for import/export)

### Union Types (derived from config)

- \`Species\`: derived from species.ts config
- \`Status\`: derived from statuses.ts config
- \`Platform\`: derived from platforms.ts config
- \`EdgeType\`: derived from edge-types.ts config

## Acceptance Criteria

- [ ] \`types.ts\` exports \`Node\`, \`Edge\`, \`Project\`, \`ProjectBundle\` interfaces matching the SQL schema
- [ ] \`Species\`, \`Status\`, \`Platform\`, \`EdgeType\` as union types derived from config"

create_issue "1 · Data Layer" "data" \
  "Create DataProvider interface with all CRUD methods" \
  "## Context

This issue is part of **Phase 1 · Data Layer**. Define the \`DataProvider\` interface that abstracts all storage operations. This abstraction allows swapping between localStorage (MVP) and Supabase (future) without changing consuming code.

## Acceptance Criteria

- [ ] \`data-provider.ts\` exports interface with: \`getProject\`, \`getNodes\`, \`getEdges\`, \`createNode\`, \`updateNode\`, \`deleteNode\`, \`createEdge\`, \`deleteEdge\`, \`exportProject\`, \`importProject\`"

create_issue "1 · Data Layer" "data" \
  "Implement LocalProvider with localStorage" \
  "## Context

This issue is part of **Phase 1 · Data Layer**. Implement the \`DataProvider\` interface using \`localStorage\` for the local-first MVP. All CRUD operations should persist data so it survives page refreshes.

## Acceptance Criteria

- [ ] \`local-provider.ts\` implements \`DataProvider\`
- [ ] All CRUD ops persist to localStorage
- [ ] Data survives page refresh"

create_issue "1 · Data Layer" "data" \
  "Create useProject, useNodes, useEdges hooks" \
  "## Context

This issue is part of **Phase 1 · Data Layer**. Create React hooks that wrap the DataProvider, providing a reactive interface for components to consume.

## Acceptance Criteria

- [ ] React hooks wrapping the DataProvider
- [ ] \`useNodes(projectId)\` returns nodes + loading state
- [ ] Mutations trigger re-renders"

create_issue "1 · Data Layer" "data,export" \
  "Implement JSON export/import utility" \
  "## Context

This issue is part of **Phase 1 · Data Layer**. Build utility functions to export a full project (with all nodes and edges) as a JSON bundle, and to import such a bundle into storage.

### ProjectBundle Format

\`\`\`typescript
interface ProjectBundle {
  project: Project;
  nodes: Node[];
  edges: Edge[];
}
\`\`\`

## Acceptance Criteria

- [ ] \`export.ts\` exports \`exportProject(id)\` → \`ProjectBundle\` JSON
- [ ] \`importProject(bundle)\` → creates project + nodes + edges in storage"

# ============================================================================
# Phase 2 · Graph Canvas
# ============================================================================
echo ""
echo "📦 Phase 2 · Graph Canvas"

create_issue "2 · Graph Canvas" "graph" \
  "Build Canvas.tsx wrapper with React Flow + minimap + controls" \
  "## Context

This issue is part of **Phase 2 · Graph Canvas** — rendering the interactive graph. Build the main Canvas component that wraps React Flow with standard affordances.

## Acceptance Criteria

- [ ] Canvas component renders React Flow with MiniMap, Controls, and Background
- [ ] Accepts nodes and edges as props
- [ ] Fills viewport"

create_issue "2 · Graph Canvas" "graph,ui" \
  "Create ProductNode custom component" \
  "## Context

This issue is part of **Phase 2 · Graph Canvas**. The ProductNode is the top-level node (Level 7) representing the entire product.

## Acceptance Criteria

- [ ] Large circle node showing product title, icon, status badge
- [ ] Styled with Tailwind
- [ ] Registers as custom nodeType in React Flow"

create_issue "2 · Graph Canvas" "graph,ui" \
  "Create ScenarioNode custom component" \
  "## Context

This issue is part of **Phase 2 · Graph Canvas**. The ScenarioNode (Level 6) represents a composed set of flows, e.g. \"Record a full pebble\".

## Acceptance Criteria

- [ ] Rounded rect node with title, status badge, expand/collapse indicator
- [ ] Platform dots if platforms are set"

create_issue "2 · Graph Canvas" "graph,ui" \
  "Create FlowNode custom component" \
  "## Context

This issue is part of **Phase 2 · Graph Canvas**. The FlowNode (Level 5) represents a sequence of steps, e.g. \"Shape an emotion\".

## Acceptance Criteria

- [ ] Rounded rect with accent border
- [ ] Title, status badge, platform dots
- [ ] Visually distinct from ScenarioNode"

create_issue "2 · Graph Canvas" "graph,ui" \
  "Create StepNode custom component" \
  "## Context

This issue is part of **Phase 2 · Graph Canvas**. The StepNode (Level 4) represents a page or screen in a flow, with platform-aware rendering.

### Platform-Aware Rendering

- Steps shared across all platforms → single stacked node
- Steps differing by platform → separate color-coded nodes (Web 🟢, iOS 🔵, Android 🟣)

## Acceptance Criteria

- [ ] Rect node
- [ ] If shared across 3 platforms, shows stacked card visual
- [ ] Platform-specific nodes show single platform color"

create_issue "2 · Graph Canvas" "graph,ui" \
  "Create ConditionNode custom component" \
  "## Context

This issue is part of **Phase 2 · Graph Canvas**. The ConditionNode appears in flowcharts when a Flow is expanded, representing user actions or data conditions that branch the flow.

## Acceptance Criteria

- [ ] Diamond-shaped node
- [ ] Shows label text (user action or data condition)
- [ ] Visually distinct from step nodes"

create_issue "2 · Graph Canvas" "graph,ui" \
  "Create DataModelNode and ApiEndpointNode components" \
  "## Context

This issue is part of **Phase 2 · Graph Canvas**. These two node types represent the parallel layers that sit alongside the UI hierarchy:

- **Data Models** — database tables, fields, relations
- **API Endpoints** — routes, methods, payloads, responses

## Acceptance Criteria

- [ ] DataModelNode: rect with DB icon
- [ ] ApiEndpointNode: rect with plug icon
- [ ] Both show title and status, visually distinct from UI species nodes"

create_issue "2 · Graph Canvas" "ui" \
  "Create StatusBadge and PlatformDots reusable components" \
  "## Context

This issue is part of **Phase 2 · Graph Canvas**. These are shared components used across all custom node types.

### StatusBadge

Renders a colored pill indicating the lifecycle status (Idea, Planned, In Development, Live, Deprecated). Colors come from statuses config.

### PlatformDots

Renders colored dots indicating which platforms a node targets:
- Web 🟢
- iOS 🔵
- Android 🟣

## Acceptance Criteria

- [ ] StatusBadge renders colored pill from status config
- [ ] PlatformDots renders colored dots (Web 🟢, iOS 🔵, Android 🟣)
- [ ] Both config-driven"

create_issue "2 · Graph Canvas" "graph,data" \
  "Render nodes from data provider on canvas" \
  "## Context

This issue is part of **Phase 2 · Graph Canvas**. Wire the data layer to the graph canvas so that nodes and edges from storage are rendered as the appropriate custom node types.

## Acceptance Criteria

- [ ] \`project/[id]/page.tsx\` fetches nodes and edges via hooks
- [ ] Maps species to custom nodeTypes
- [ ] Renders on Canvas with positions from node data"

# ============================================================================
# Phase 3 · Interaction
# ============================================================================
echo ""
echo "📦 Phase 3 · Interaction"

create_issue "3 · Interaction" "ux,graph" \
  "Implement expand/collapse on Product node → show/hide Scenarios" \
  "## Context

This issue is part of **Phase 3 · Interaction** — making the graph navigable with semantic zoom.

### Semantic Zoom Model

- **Level 0 — Product map**: central Product node(s), radiating Scenarios
- Clicking a Product node expands to show its child Scenarios

## Acceptance Criteria

- [ ] Clicking a Product node fetches child Scenarios (via \`parent_id\`) and renders them around it with compose edges
- [ ] Click again to collapse"

create_issue "3 · Interaction" "ux,graph" \
  "Implement expand/collapse on Scenario node → show/hide Flows" \
  "## Context

This issue is part of **Phase 3 · Interaction**. Continuing the semantic zoom model:

- **Level 1 — Scenario anatomy**: click a Scenario → expands to show its Flows

## Acceptance Criteria

- [ ] Clicking a Scenario expands child Flows as connected nodes
- [ ] Flows are laid out horizontally or vertically
- [ ] Collapse hides them"

create_issue "3 · Interaction" "ux,graph" \
  "Implement expand/collapse on Flow node → show Steps as flowchart" \
  "## Context

This issue is part of **Phase 3 · Interaction**. The deepest level of semantic zoom:

- **Level 2 — Flow anatomy**: click a Flow → expands into a flowchart with Steps (views), Condition nodes (diamonds: user actions, data checks), and Dead-end nodes (error states)

## Acceptance Criteria

- [ ] Clicking a Flow expands into a flowchart showing Steps and Conditions connected by edges
- [ ] Condition diamonds between step rects"

create_issue "3 · Interaction" "ux" \
  "Implement useGraphNavigation hook for semantic zoom state" \
  "## Context

This issue is part of **Phase 3 · Interaction**. Create a hook that manages the state of the semantic zoom: which nodes are expanded, the current zoom level, and the breadcrumb trail for navigation.

## Acceptance Criteria

- [ ] Hook manages \`expandedNodeIds\` set, current zoom level, breadcrumb trail
- [ ] Provides \`expand(nodeId)\`, \`collapse(nodeId)\`, \`navigateTo(nodeId)\`"

create_issue "3 · Interaction" "ui,ux" \
  "Build Breadcrumb component showing navigation path" \
  "## Context

This issue is part of **Phase 3 · Interaction**. The Breadcrumb provides a clickable navigation path through the species hierarchy, updating as the user drills into the graph.

## Acceptance Criteria

- [ ] Breadcrumb shows clickable path: \`Product > Scenario > Flow > Step\`
- [ ] Updates on expand/drill
- [ ] Clicking any crumb navigates back to that level"

create_issue "3 · Interaction" "ux,ui" \
  "Implement ghost node rendering for Idea status" \
  "## Context

This issue is part of **Phase 3 · Interaction**. Nodes with lifecycle status \"Idea\" should be visually distinct to indicate they are not yet committed to.

## Acceptance Criteria

- [ ] Nodes with status \`idea\` render with dashed border and reduced opacity
- [ ] Clearly distinct from planned/live nodes"

create_issue "3 · Interaction" "ux,graph" \
  "Platform-aware step rendering: stacked vs split nodes" \
  "## Context

This issue is part of **Phase 3 · Interaction**. Implement the platform-aware rendering logic for Step nodes.

### Rules

- Steps shared across all platforms → single stacked card visual
- Steps differing by platform → separate color-coded nodes per platform (Web 🟢, iOS 🔵, Android 🟣)
- Flows can branch by use case, condition, or platform

## Acceptance Criteria

- [ ] Steps shared by all platforms show as stacked card
- [ ] Steps differing by platform render as separate nodes per platform, color-coded"

# ============================================================================
# Phase 4 · Detail Panels
# ============================================================================
echo ""
echo "📦 Phase 4 · Detail Panels"

create_issue "4 · Detail Panels" "ui" \
  "Build NodeDetailPanel (Shadcn Sheet) with node info display" \
  "## Context

This issue is part of **Phase 4 · Detail Panels** — building the side panel that opens when clicking a node.

### View Detail (Level 3 of Semantic Zoom)

Click a Step → side panel with platform variant tabs, linked components, data models, API endpoints.

## Acceptance Criteria

- [ ] Clicking any node opens a slide-in Sheet showing: title, species, status, platforms, description
- [ ] Read-only first"

create_issue "4 · Detail Panels" "ui,data" \
  "Add inline editing to NodeDetailPanel" \
  "## Context

This issue is part of **Phase 4 · Detail Panels**. Make the detail panel editable so users can modify node properties directly.

## Acceptance Criteria

- [ ] All fields in the detail panel are editable
- [ ] Changes persist to data provider on blur/save
- [ ] Status and platforms use Select/MultiSelect inputs"

create_issue "4 · Detail Panels" "ui,graph" \
  "Show linked nodes list in NodeDetailPanel" \
  "## Context

This issue is part of **Phase 4 · Detail Panels**. Display the node's connections (parent, children, cross-layer links) in the detail panel for easy navigation.

## Acceptance Criteria

- [ ] Panel shows a \"Connections\" section listing parent, children, and cross-layer linked nodes (data models, API endpoints)
- [ ] Each link is clickable to navigate"

create_issue "4 · Detail Panels" "ui,ux" \
  "Build PlatformVariants tab view in detail panel" \
  "## Context

This issue is part of **Phase 4 · Detail Panels**. For Step/View nodes, show platform-specific tabs so users can add notes and (later) screenshots per platform.

## Acceptance Criteria

- [ ] For Step/View nodes, panel shows tabs for Web, iOS, Android
- [ ] Each tab shows a placeholder for screenshot/notes
- [ ] No upload needed yet, just text notes"

# ============================================================================
# Phase 5 · CRUD & Seed
# ============================================================================
echo ""
echo "📦 Phase 5 · CRUD & Seed"

create_issue "5 · CRUD & Seed" "ui,data" \
  "Build NewNodeForm: create a node from the canvas or panel" \
  "## Context

This issue is part of **Phase 5 · CRUD & Seed** — full create/edit/delete workflow for nodes and edges.

## Acceptance Criteria

- [ ] Button on canvas or in panel opens a form (Shadcn Dialog)
- [ ] User sets title, species, status, platforms, parent
- [ ] Node appears on canvas after creation"

create_issue "5 · CRUD & Seed" "ux,data" \
  "Implement add-child-node action from an existing node" \
  "## Context

This issue is part of **Phase 5 · CRUD & Seed**. Quick action to add a child node from an existing node, pre-filling the parent and suggesting the next species level in the hierarchy.

## Acceptance Criteria

- [ ] Right-click or button on a node to \"Add child\"
- [ ] Pre-fills \`parent_id\` and suggests next species level
- [ ] Creates node + compose edge automatically"

create_issue "5 · CRUD & Seed" "graph,data" \
  "Implement edge creation by dragging between nodes" \
  "## Context

This issue is part of **Phase 5 · CRUD & Seed**. Enable edge creation through the React Flow drag interface.

### Edge Types

- **composes** — parent-child within the species hierarchy
- **branches** — conditional flow branching
- **calls** — API endpoint invocation
- **displays** — UI shows data from a model
- **queries** — data model relationship

## Acceptance Criteria

- [ ] User can drag from a node handle to another node to create an edge
- [ ] Prompt for edge type (composes, branches, calls, displays, queries)
- [ ] Edge persists to storage"

create_issue "5 · CRUD & Seed" "data,ui" \
  "Implement delete node and delete edge actions" \
  "## Context

This issue is part of **Phase 5 · CRUD & Seed**. Allow users to delete nodes and edges with appropriate confirmation and cascade behavior.

## Acceptance Criteria

- [ ] Delete button on detail panel and on edge selection
- [ ] Confirmation dialog
- [ ] Deleting a node also deletes its edges
- [ ] Cascade to children optional (prompt user)"

create_issue "5 · CRUD & Seed" "data" \
  "Create Pebbles seed data JSON file" \
  "## Context

This issue is part of **Phase 5 · CRUD & Seed**. Create a realistic example dataset to demonstrate arkaik's capabilities. \"Pebbles\" is the reference product used throughout the spec.

## Acceptance Criteria

- [ ] \`seed/pebbles.json\` contains a full \`ProjectBundle\`: Pebbles product, 4 scenarios, 10+ flows, 20+ steps, sample data models and API endpoints with edges"

create_issue "5 · CRUD & Seed" "ux,data" \
  "Build seed import on first visit (empty state)" \
  "## Context

This issue is part of **Phase 5 · CRUD & Seed**. When a user first visits the app with no data, show an empty state with an option to load the example project.

## Acceptance Criteria

- [ ] Home page shows empty state with \"Import example project\" button
- [ ] Clicking loads \`pebbles.json\` into storage and navigates to the project canvas"

# ============================================================================
# Phase 6 · Polish & Ship
# ============================================================================
echo ""
echo "📦 Phase 6 · Polish & Ship"

create_issue "6 · Polish & Ship" "ui" \
  "Build home page: project selector with create/import/delete" \
  "## Context

This issue is part of **Phase 6 · Polish & Ship** — home page, export/import UI, visual polish, keyboard shortcuts, README.

## Acceptance Criteria

- [ ] Home page lists all projects as cards
- [ ] Create new project button
- [ ] Import project from JSON
- [ ] Delete project with confirmation"

create_issue "6 · Polish & Ship" "export,ui" \
  "Add JSON export button per project" \
  "## Context

This issue is part of **Phase 6 · Polish & Ship**. Allow users to export a full project bundle as a downloadable JSON file.

## Acceptance Criteria

- [ ] Button in project toolbar exports full \`ProjectBundle\` as downloadable \`.json\` file"

create_issue "6 · Polish & Ship" "export,ui" \
  "Add JSON import button on home and in project" \
  "## Context

This issue is part of **Phase 6 · Polish & Ship**. Allow users to import a project from a JSON file with validation.

## Acceptance Criteria

- [ ] File picker to import a \`ProjectBundle\` JSON
- [ ] Validates structure before importing
- [ ] Shows success/error toast"

create_issue "6 · Polish & Ship" "ui" \
  "Polish node visuals: shadows, hover states, transitions" \
  "## Context

This issue is part of **Phase 6 · Polish & Ship**. Add visual polish to all custom node components for a professional, cohesive look.

## Acceptance Criteria

- [ ] All custom nodes have subtle shadow, hover highlight, smooth expand/collapse transitions
- [ ] Consistent with Shadcn/Tailwind design tokens"

create_issue "6 · Polish & Ship" "ux" \
  "Add keyboard shortcuts: Escape to close panel, Delete to remove selected" \
  "## Context

This issue is part of **Phase 6 · Polish & Ship**. Add keyboard shortcuts for common actions to improve power-user efficiency.

## Acceptance Criteria

- [ ] Escape closes detail panel
- [ ] Delete/Backspace deletes selected node (with confirmation)
- [ ] Cmd+E exports project"

create_issue "6 · Polish & Ship" "infra" \
  "Write README.md for GitHub" \
  "## Context

This issue is part of **Phase 6 · Polish & Ship**. Write a comprehensive README that explains what arkaik is, how to set it up, and how to contribute.

## Acceptance Criteria

- [ ] README covers: what arkaik is, screenshot, local setup (\`npm install && npm run dev\`), folder structure overview, how to contribute, license"

# ============================================================================
# Phase 7 · Post-MVP
# ============================================================================
echo ""
echo "📦 Phase 7 · Post-MVP"

create_issue "7 · Post-MVP" "data,infra" \
  "Implement SupabaseProvider (swap from localStorage to Supabase)" \
  "## Context

This issue is part of **Phase 7 · Post-MVP** — migration to Supabase, auth, RLS, and other enhancements after the local-first MVP ships.

## Acceptance Criteria

- [ ] \`supabase-provider.ts\` implements \`DataProvider\` interface
- [ ] All CRUD ops hit Supabase
- [ ] Toggle provider via env variable"

create_issue "7 · Post-MVP" "infra,data" \
  "Add Supabase Auth + user profiles" \
  "## Context

This issue is part of **Phase 7 · Post-MVP**. Add authentication so users can log in and see their own projects.

## Acceptance Criteria

- [ ] Supabase Auth configured (email + GitHub OAuth)
- [ ] \`profiles\` table created on sign-up
- [ ] User can log in and see their projects"

create_issue "7 · Post-MVP" "data,infra" \
  "Add RLS policies scoping data to project members" \
  "## Context

This issue is part of **Phase 7 · Post-MVP**. Add Row Level Security so users can only access their own projects, with a join table for future sharing.

## Acceptance Criteria

- [ ] RLS on \`nodes\`, \`edges\`, \`projects\` tables
- [ ] Users can only read/write their own projects
- [ ] \`project_members\` join table for future sharing"

create_issue "7 · Post-MVP" "graph,ux" \
  "Implement dagre auto-layout for expanded subgraphs" \
  "## Context

This issue is part of **Phase 7 · Post-MVP**. Use the dagre layout algorithm to automatically position child nodes when expanding a parent, instead of relying on manual coordinates.

## Acceptance Criteria

- [ ] When expanding a node, child nodes are auto-positioned using dagre layout algorithm instead of manual \`position_x\`/\`position_y\`"

create_issue "7 · Post-MVP" "ux,graph" \
  "Add cross-layer jump: click icon on a View to see linked Data Models and API Endpoints" \
  "## Context

This issue is part of **Phase 7 · Post-MVP**. Enable quick navigation from UI nodes to their linked Data Models and API Endpoints.

## Acceptance Criteria

- [ ] Small icon on View/Step nodes
- [ ] Clicking opens a side panel showing linked Data Models and API Endpoints with quick navigation"

create_issue "7 · Post-MVP" "ui" \
  "Support image/screenshot upload on platform variant tabs" \
  "## Context

This issue is part of **Phase 7 · Post-MVP**. Allow users to upload screenshots for each platform variant of a Step/View node.

## Acceptance Criteria

- [ ] Drag-and-drop or file picker to upload a screenshot per platform variant
- [ ] Stored as base64 in localStorage or in Supabase Storage later"

# ============================================================================
echo ""
echo "🎉 All done! Labels, milestones, and issues have been created."
echo "   Visit https://github.com/$REPO/issues to see them."
