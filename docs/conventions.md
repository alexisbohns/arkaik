# Conventions

## File Organization

```
app/                    # Next.js App Router pages and layouts
components/
  branding/            # Brand assets and logo components
  graph/                # React Flow canvas, custom nodes, custom edges
  layout/               # Shell UI: breadcrumb, sidebar, minimap, badges
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
- Reusable state logic lives in hooks: `useNodes`, `useEdges`, `useProject`, `useGraphNavigation`.
- The project canvas page (`app/project/[id]/page.tsx`) uses `useNodes` and `useEdges` for data, and manages flow expansion as local `useState` (`expandedFlows`).
- Data flows via props from the project page down to canvas components.
- `useProject` and `useGraphNavigation` exist as utilities but are not currently used on the canvas page.

## Keyboard Shortcuts

- Project-page shortcuts are wired in `app/project/[id]/page.tsx` using `lib/hooks/useKeyboardShortcuts.ts`.
- Shortcut key checks and focus guards live in `lib/utils/keyboard.ts`.
- Keep shortcut handlers thin: they should call existing page handlers (`handleDeleteNodeRequest`, `handleExport`) instead of duplicating business logic.
- Delete shortcuts must not directly mutate storage. Always route through the existing confirmation dialog flow.
- Ignore destructive shortcuts when focus is in editable controls (`input`, `textarea`, `contenteditable`, or combobox/textbox roles).

## Styling

- **Tailwind CSS** for all styling — no CSS modules, no styled-components.
- **shadcn/ui** for UI primitives (`components/ui/`). Generated via CLI — don't edit these files by hand.
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

## Naming

- **Files:** kebab-case for config and utils (`edge-types.ts`), PascalCase for components (`FlowNode.tsx`)
  - Current graph node components include `FlowNode.tsx`, `ViewNode.tsx`, `DataModelNode.tsx`, `ApiEndpointNode.tsx`
- **Types:** PascalCase (`SpeciesId`, `ProjectBundle`)
- **Config arrays:** UPPER_SNAKE_CASE (`SPECIES`, `STATUSES`, `EDGE_TYPES`)
- **Hooks:** camelCase with `use` prefix (`useNodes`, `useGraphNavigation`)
