# Conventions

## File Organization

```
app/                    # Next.js App Router pages and layouts
components/
  branding/            # Brand assets and logo components
  graph/                # React Flow canvas, custom nodes, custom edges
  generate/             # Prompt builder form/output components for /generate
  layout/               # Shell UI: project sidebar, switcher, breadcrumb, minimap, badges
  panels/               # The push-panel stack, its panel content, and forms
    PanelStack.tsx      # Content-agnostic column stack: keyboard, breadcrumb, visibility
    NodeDetailStack.tsx # Binds the stack to nodes — NodeDetailPanel as the content
  ui/                   # shadcn/ui primitives (do not edit directly — use CLI)
lib/
  config/               # Typed const arrays: species, statuses, platforms, edge types
  data/                 # DataProvider interface + implementations
  hooks/                # React hooks for state management
    useNodePanels.tsx   # Panel-stack provider + the `?node=` contract
  prompts/              # Prompt assembly blocks/types for the AI prompt builder
  utils/                # Helpers: layout, export, cn()
public/
  schema/               # Public JSON schema + example bundle for import contract
  llms.txt              # Concise LLM manifest
  robots.txt            # Crawl directives + sitemap pointer
seed/                   # Example project JSON for development
docs/                   # This documentation
```

## State Management

- **No global store for domain data.** No Zustand, Redux, or Context-based state for nodes, edges, projects, or the journal — those flow through hooks and props.
- **Route-shell UI state may use a scoped provider**, mounted in the project layout alongside `SidebarProvider`. The panel stack (`NodePanelsProvider`) is the one that exists; the bar for adding another is that a page segment cannot own the state, because it remounts when its dynamic params change.
- Reusable state logic lives in hooks: `useNodes`, `useEdges`, `useProject`, `useProjects`, `useJournal`.
- Hook intent:
  - `useNodes` and `useEdges` handle project graph CRUD.
  - `useProject` handles project-level metadata (including `root_node_id` and card preferences).
  - `useProjects` powers project lists/switching in route shell UI.
  - `useJournal` exposes the read-only event log for timelines and the changelog.
- The Journey map (`components/maps/JourneyMap.tsx`) uses `useNodes` and `useEdges` for data, and manages flow expansion as local `useState` (`expandedFlows`); graph construction is the pure `buildJourneyGraph` (`lib/utils/journey-graph.ts`).
- Data flows via props from the project page down to canvas components.
- Route-shell concerns such as the project switcher and persistent sidebar should stay in the project layout and use route state plus lightweight hooks instead of introducing shared global state.

## Keyboard Shortcuts

- Journey-map shortcuts are wired in `components/maps/JourneyMap.tsx` using `lib/hooks/useKeyboardShortcuts.ts`.
- Shortcut key checks and focus guards live in `lib/utils/keyboard.ts`.
- Keep shortcut handlers thin: they should call existing page handlers (`handleDeleteNodeRequest`, `handleExport`) instead of duplicating business logic.
- Delete shortcuts must not directly mutate storage. Always route through the existing confirmation dialog flow.
- Ignore destructive shortcuts when focus is in editable controls (`input`, `textarea`, `contenteditable`, or combobox/textbox roles).
- **Escape belongs to the panel stack while it is non-empty**, and `PanelStack` owns it: it pops one panel, wherever the pointer is. Surfaces must not also bind Escape to a close — with the stack empty, Escape falls through to whatever the page wants it for. An open Radix layer (dialog, popover, select, menu) still wins over the stack.

## Panel Stack

Reading a node must not cost you the graph. Node details are **inline grid
columns, not an overlay** — nothing floats over anything. Opening a panel
narrows the surface beside it; the surface only leaves once the trail is deep
enough to need the room.

The surface — canvas, board, list — **is a cell in that grid**, at index 0. It
is pushed out of the window by the same rule that hides deep panels, which is
what makes the whole thing read as one strip of columns rather than a page with
things stuck to its edge.

```
main
└─ wrapper
   ├─ header        the surface's own toolbar, full width
   └─ panel grid    breadcrumb row, then the columns
```

**Two columns, one below 768px, newest always on the right.** With no panels the
surface has the grid to itself; one panel gives `surface | panel`; two retires
the surface and shows `A | B`; deeper always shows the last two. Cells outside
that window stay mounted, so unwinding brings them back untouched.

**One rule generates the traversal: a click in panel `i` owns everything above
`i`.** Depth 0 is the surface, so a click on it always leaves exactly one panel
open (a swap); a click *inside* a panel pushes a new one.

| Action | Before | After | URL |
|---|---|---|---|
| Click a node on the surface | `canvas` | `canvas · A` | → `?node=A` |
| Click another node on the surface | `canvas · A` | `canvas · B` | → `?node=B` |
| Click a reference **inside** panel A | `canvas · A` | `canvas · A · B` | → `?node=B` |
| Esc, or close the top panel | `canvas · A · B` | `canvas · A` | → `?node=A` |
| Close a panel that isn't the top | `canvas · A · B` | `canvas · B` | unchanged |
| Breadcrumb jump to panel `i` | `canvas · A · B` | `canvas · A` | → `?node=A` |
| Browser Back | `canvas · A · B` | `canvas · A` | → `?node=A` |

Three pieces, deliberately separable — only the third knows what a node is:

- `lib/utils/panel-stack.ts` — pure transitions, no React and no DOM. Covered by `tests/app/panel-stack.test.js` (`npm run test:panel-stack`).
- `components/panels/PanelStack.tsx` — renders the columns; owns the keyboard, focus, breadcrumb, visibility rule and animation. Content-agnostic.
- `lib/hooks/useNodePanels.tsx` + `components/panels/NodeDetailStack.tsx` — the binding: node id ⇄ descriptor ⇄ `?node=`, with `NodeDetailPanel` as the content.

The URL contract: **`?node=` addresses the top panel only**, on whatever route
you are on, composing with the filters already there (`?species=view&node=…`).
The stack below the top is client state by design — it is exploration history,
not an address. User actions publish the new top themselves; `reconcileArrival`
handles the arrivals nobody published (cold load, Back, Forward), inferring
intent from where the id already sits in the stack.

Four things to keep in mind when touching it:

- **`openNode` must stay identity-stable.** It is a dependency of the graph builders, so an identity that changed with the address would re-run the ELK layout on every open.
- **Panels resolve their node by id**, against the surface's own `allNodes`. An edit reaches every panel showing that node, and a node deleted under the stack takes its panels with it — no `selectedNode` copy to keep in step.
- **Panels leave the window with `hidden`; the surface does not.** A React Flow canvas measures its container, and `display:none` gives it zero size and NaN geometry. The surface goes `invisible absolute` instead, keeping a real box — which also keeps its ELK layout and viewport intact.
- **A surface that measures itself needs `onLayoutChange`.** The columns resize as panels come and go; the maps use it to re-frame rather than show a clipped corner.

## Styling

- **Tailwind CSS** for all styling — no CSS modules, no styled-components.
- **shadcn/ui** for UI primitives (`components/ui/`). Generated via CLI — don't edit these files by hand.
- Sidebar primitives are also generated via shadcn CLI. Compose with them in `components/layout/` rather than forking the generated files.
- **class-variance-authority (CVA)** for component variants.
- **`cn()` helper** (`lib/utils.ts`) for merging Tailwind classes: `cn("base-class", conditional && "active-class")`.
- **`tailwind-merge`** resolves conflicting Tailwind classes automatically via `cn()`.

## Config / Taxonomies

All domain enums live in `lib/config/` as `const` arrays with `as const`:

```typescript
// lib/config/species.ts
export const SPECIES = [
  { id: "flow", level: 1, label: "Flow", description: "an ordered sequence of views and sub-flows" },
  // ...
] as const;

export type SpeciesId = (typeof SPECIES)[number]["id"];
```

This pattern gives you:
- Runtime array for iteration (dropdowns, mapping)
- Compile-time union type for type safety
- Single source of truth — no duplicate enum + array

To add a new taxonomy value, add it to the array. The type updates automatically.

## Components

- **Node components** receive React Flow `NodeProps` with a `data` object containing `label`, `status`, `platforms`, `expanded`, `onToggle`.
- **Edge components** receive React Flow `EdgeProps` and render SVG paths.
- All node components are in `components/graph/nodes/` and must be registered in the `nodeTypes` map in `Canvas.tsx`.
- Species affordances in panel and library cards should use a compact icon trigger with a hover card explaining the species from `lib/config/species.ts` descriptions.

## Data Mutations

All writes go through the `DataProvider` interface:

```
Component → Hook (useNodes.addNode) → Provider (localProvider.createNode) → Storage
```

Never write to `localStorage` directly. Always use the provider.

## Routing UI

- Shared project navigation belongs in `app/project/[id]/layout.tsx`, not inside individual route pages.
- Route-aware active states should derive from `usePathname()` and `useSearchParams()`.
- When a UI control represents a shareable filter, keep it URL-driven. The library `species` filter is the current example.
- Cross-project navigation should preserve the current in-project destination when it can be mapped safely.

## Cursor Semantics

Graph interactive elements must use the correct Tailwind cursor class. Do not leave clickable elements without an explicit cursor — React Flow's canvas can suppress browser defaults.

| Action | Cursor class | Example |
|---|---|---|
| Show hover card | `cursor-help` | species badge (`EntityBadges`) |
| Insert node | `cursor-copy` | insert button on compose edge |
| Unfold flow | `cursor-zoom-in` | collapsed `FlowNode` |
| Collapse flow | `cursor-zoom-out` | expanded `FlowNode` |
| Open panel | `cursor-pointer` | info button on any node |
| Show popover | `cursor-context-menu` | API/platform buttons on `ViewNode` |

Non-interactive but focusable elements (e.g. branch nodes, static cards) use `cursor-default`.

## Naming

- **Files:** kebab-case for config and utils (`edge-types.ts`), PascalCase for components (`FlowNode.tsx`)
  - Current graph node components include `FlowNode.tsx`, `ViewNode.tsx`, `DataModelNode.tsx`, `ApiEndpointNode.tsx`
- **Types:** PascalCase (`SpeciesId`, `ProjectBundle`)
- **Config arrays:** UPPER_SNAKE_CASE (`SPECIES`, `STATUSES`, `EDGE_TYPES`)
- **Hooks:** camelCase with `use` prefix (`useNodes`, `useJournal`)
