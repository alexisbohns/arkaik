# Conventions

## File Organization

```
app/                    # Next.js App Router pages, layouts, and route handlers (app/api/)
components/
  branding/             # Brand assets and logo components
  background/           # Ambient canvases (the ASCII terrain on the landing page)
  graph/                # React Flow canvas, custom nodes, custom edges
  maps/                 # Map surfaces: JourneyMap, SystemMap, cards, editor dialog
  overview/ delivery/   # The dashboard cards, and the delivery board
  acceptances/ decisions/ pyramid/ values/   # The acceptance + decision + value surfaces
  library/ journal/     # Node browser; one event's human sentence
  projects/             # The project-list surfaces (create, import, seed, restore)
  generate/             # Prompt builder form/output components for /generate
  publik/ sync/ auth/   # Share, Synk backup, sign-in surfaces
  settings/             # Product manager, repo links, token manager
  layout/               # Shell UI: project sidebar, switcher, command palette, minimap, badges
  panels/               # The push-panel stack, its panel content, and forms
    PanelStack.tsx      # Content-agnostic column stack: keyboard, breadcrumb, visibility
    ProjectPanels.tsx   # Binds the stack to panel kind: node detail, or the raw bundle
  docs/                 # Markdown renderer + docs search for the in-app /docs space
  ui/                   # shadcn/ui primitives (do not edit directly — use CLI)
  wobble/               # The hand-drawn icon effect (docs/icon-wobble.md)
lib/
  config/               # Labels + display order for the ids in @arkaik/schema (§ Config / Taxonomies)
  data/                 # DataProvider interface + local, remote, seed and routing implementations
  hooks/                # React hooks for state management
    useProjectPanels.tsx # Panel-stack provider + the `?node=` contract
  services/             # Server-only: hosted graph store, publik, synk, auth, GitHub App
  sync/                 # Client sync engine (Synk SyncManager)
  prompts/              # Prompt assembly blocks/types for the AI prompt builder
  utils/                # Helpers: layout, export, projections, cn()
packages/               # The MIT toolchain, an npm workspace
  schema/               # @arkaik/schema — canonical zod model, ids, validation, projections
  cli/                  # arkaik — the CLI
  mcp/                  # arkaik-mcp — the stdio MCP server
plugin/                 # Claude Code plugin: the agent skill + generated assets
db/                     # Postgres migrations + the migrate runner
public/
  schema/               # Public JSON schema + example bundle for import contract
  llms.txt              # Concise LLM manifest
  robots.txt            # Crawl directives + sitemap pointer
seed/                   # Example project JSON: pebbles.json, arkaik-self-map.json
tests/                  # The test:* suites CI runs
docs/                   # This documentation
```

## State Management

- **No global store for domain data.** No Zustand, Redux, or Context-based state for nodes, edges, projects, or the journal — those flow through hooks and props.
- **Route-shell UI state may use a scoped provider**, mounted in the project layout alongside `SidebarProvider`. The panel stack (`ProjectPanelsProvider`) is the one that exists; the bar for adding another is that a page segment cannot own the state, because it remounts when its dynamic params change.
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
- The ⌘K command palette is wired in `app/project/[id]/layout.tsx` (`isCommandPaletteShortcut`), so it answers from every project page. The docs space wires the same shortcut in `components/docs/DocsSearch.tsx` — one overlay, one ranker, a catalogue each (`buildProjectCommands` / `buildDocsCommands`).
- Shortcut key checks and focus guards live in `lib/utils/keyboard.ts`.
- Keep shortcut handlers thin: they should call existing page handlers (`handleDeleteNodeRequest`, `handleExport`) instead of duplicating business logic.
- Delete shortcuts must not directly mutate storage. Always route through the existing confirmation dialog flow.
- Ignore destructive shortcuts when focus is in editable controls (`input`, `textarea`, `contenteditable`, or combobox/textbox roles). Modifier chords such as ⌘K are the exception — they cannot collide with typing, and stay live inside inputs.
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
- `lib/hooks/useProjectPanels.tsx` + `components/panels/ProjectPanels.tsx` — the binding: what a panel can be (a node, or the raw bundle), node id ⇄ descriptor ⇄ `?node=`, with `NodeDetailPanel` as a node panel's content.

The URL contract: **`?node=` addresses the top *node* panel only**, on whatever
route you are on, composing with the filters already there
(`?species=view&node=…`). It scans past a panel that is not a node — the raw
bundle is a tool rather than a location, so opening it over a node panel leaves
that node's address standing.
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

A taxonomy lives in **two files**, and the split is the point: an id is part of the portable format, a label is not.

**Ids belong to the schema package.** `packages/schema/src/ids.ts` holds plain `as const` arrays — `SPECIES_IDS`, `STATUS_IDS`, `PLATFORM_IDS`, `EDGE_TYPE_IDS`, `VALUE_IDS` — with each union type derived from its array, and deliberately no zod dependency so the standalone validator can read them without pulling the runtime in. Everything that must agree about the vocabulary reads from there: the validator, the CLI, the MCP server, the generated JSON Schema.

**Labels and display order belong to `lib/config/`**, and each array is *checked against* the ids rather than redefining them:

```typescript
// lib/config/species.ts
import type { SpeciesId } from "@arkaik/schema";

export const SPECIES = [
  { id: "flow", level: 1, label: "Flow", description: "an ordered sequence of views and sub-flows" },
  // ...
] as const satisfies readonly { id: SpeciesId; level: number | null; label: string; description: string }[];

export type { SpeciesId };
```

`as const satisfies` is what makes that safe. `as const` keeps the literal tuple, so iteration and narrowing still work; `satisfies` makes the compiler reject any `id` that is not a real `SpeciesId` — without widening the array's type the way an annotation would. There is still exactly one source of truth for the vocabulary; it just moved down a layer.

To add a taxonomy value:

1. Add the id to the array in `packages/schema/src/ids.ts` — plus its admissible source/target pairs in `VALID_EDGE_SEMANTICS` if it is an edge type.
2. Add the matching entry (label, order, icon, whatever the app renders) to the `lib/config/` array. Doing this first will not compile — that failing `satisfies` check is the guard working, not a problem to route around.
3. Run `npm run generate`. The JSON Schema, the standalone validator, the skill reference and the prompt fragments are all derived, and CI fails the PR on any drift.
4. Update [graph-model.md](graph-model.md), the documented source of truth for the taxonomy.

`lib/config/stages.ts` is the one exception, and legitimately so: `metadata.stage` is a free `string` in the format, so `STAGES` is a plain app-side `as const` with no schema id to satisfy.

## Components

- **Node components** receive React Flow `NodeProps` with a `data` object containing `label`, `status`, `platforms`, `expanded`, `onToggle`.
- **Edge components** receive React Flow `EdgeProps` and render SVG paths.
- All node components are in `components/graph/nodes/` and must be registered in the `nodeTypes` map in `Canvas.tsx`.
- Species affordances in panel and library cards should use a compact icon trigger with a hover card explaining the species from `lib/config/species.ts` descriptions.

## Data Mutations

All writes go through the `DataProvider` interface:

```
Component → Hook (useNodes.addNode) → getProvider().createNode(node) → the routed backend
```

Never write to `localStorage`, IndexedDB, or `/api/graph` directly, and never import `localProvider` at a call site. `getProvider()` is the seam — it is what lets the same component work against a local, hosted, or seed project without knowing which it has ([data-layer.md § Providers](data-layer.md)).

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
