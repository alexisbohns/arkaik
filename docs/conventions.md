# Conventions

## File Organization

```
app/                    # Next.js App Router pages and layouts
components/
  branding/            # Brand assets and logo components
  graph/                # React Flow canvas, custom nodes, custom edges
  layout/               # Shell UI: project sidebar, switcher, breadcrumb, minimap, badges
  panels/               # Slide-in panels and forms
  ui/                   # shadcn/ui primitives (do not edit directly — use CLI)
lib/
  config/               # Typed const arrays: species, statuses, platforms, edge types
  data/                 # DataProvider interface + implementations
  hooks/                # React hooks for state management
  utils/                # Helpers: layout, export, cn()
seed/                   # Example project JSON for development
docs/                   # This documentation
```

## State Management

- **No global store.** No Zustand, Redux, or Context-based state.
- Reusable state logic lives in hooks: `useNodes`, `useEdges`, `useProject`, `useProjects`, `useGraphNavigation`.
- Hook intent:
  - `useNodes` and `useEdges` handle project graph CRUD.
  - `useProject` handles project-level metadata (including `root_node_id` and card preferences).
  - `useProjects` powers project lists/switching in route shell UI.
  - `useGraphNavigation` remains a generic helper for graph navigation state when needed.
- The project canvas page (`app/project/[id]/canvas/page.tsx`) uses `useNodes` and `useEdges` for data, and manages flow expansion as local `useState` (`expandedFlows`).
- Data flows via props from the project page down to canvas components.
- Route-shell concerns such as the project switcher and persistent sidebar should stay in the project layout and use route state plus lightweight hooks instead of introducing shared global state.

## Keyboard Shortcuts

- Project-page shortcuts are wired in `app/project/[id]/canvas/page.tsx` using `lib/hooks/useKeyboardShortcuts.ts`.
- Shortcut key checks and focus guards live in `lib/utils/keyboard.ts`.
- Keep shortcut handlers thin: they should call existing page handlers (`handleDeleteNodeRequest`, `handleExport`) instead of duplicating business logic.
- Delete shortcuts must not directly mutate storage. Always route through the existing confirmation dialog flow.
- Ignore destructive shortcuts when focus is in editable controls (`input`, `textarea`, `contenteditable`, or combobox/textbox roles).

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

## Naming

- **Files:** kebab-case for config and utils (`edge-types.ts`), PascalCase for components (`FlowNode.tsx`)
  - Current graph node components include `FlowNode.tsx`, `ViewNode.tsx`, `DataModelNode.tsx`, `ApiEndpointNode.tsx`
- **Types:** PascalCase (`SpeciesId`, `ProjectBundle`)
- **Config arrays:** UPPER_SNAKE_CASE (`SPECIES`, `STATUSES`, `EDGE_TYPES`)
- **Hooks:** camelCase with `use` prefix (`useNodes`, `useGraphNavigation`)
