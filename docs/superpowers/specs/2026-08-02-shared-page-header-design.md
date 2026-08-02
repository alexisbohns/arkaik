# Shared page header, panels everywhere, Raw as a panel

**Date:** 2026-08-02
**Status:** Approved, ready for planning

## Problem

Ten project surfaces hand-roll the same `<header>`. The class string is byte-identical in all ten:

```
flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80
```

So is the left cluster: `SidebarTrigger`, a vertical `Separator`, then the **project title** on line 1
and a page subtitle on line 2. The project title is the same on every page of a project and is already
the first thing the sidebar shows — it spends the header's most prominent line saying nothing.

Three further duplications ride along:

- The **`rootLabel`** passed to `NodeDetailStack` repeats the subtitle expression verbatim at all five
  call sites (`JourneyMap.tsx:748`, `SystemMap.tsx:287`, `library/page.tsx:269`, `delivery/page.tsx:154`,
  `acceptances/page.tsx:159`).
- The **primary action** — New map, New node, New acceptance — is the same `size="sm"` button with a
  `PlusIcon` in a `ml-auto flex items-center gap-3` wrapper, six times.
- The **version pill** is copied between `overview/page.tsx:114-121` and `changelog/page.tsx:139-146`.

And a layout bug: breadcrumbs render in a conditional row inside `PanelStack.tsx:121-167`, gated on
`entries.length > 0`. That row is `shrink-0` with `border-b` and `py-2`, and it sits *below* the header
inside the page's flex column. Opening the first panel inserts ~33px of chrome and pushes the canvas,
board or list down; closing the last panel yanks it back. Every first panel open costs a content shift.

Separately, two Journey-map-only buttons are misfiled. **Export JSON** exports the whole project bundle,
and **Raw** shows the whole project bundle — both are project-scoped, both reachable only from one map.
Raw is also the repo's last app-level `Sheet`: it overlays and dims the surface it is describing, which
is the opposite of what the panel grid was built to do.

## Intent

One header component, no bottom border, used by all ten surfaces. The page title takes the promoted
line; breadcrumbs take the line below, always present so nothing shifts. The primary action, the
breadcrumb trail and the panel grid are bound by shared components rather than by each page. Export and
Raw move to the project switcher beside Publish and Settings, and Raw becomes a panel.

## Decisions record

| Question | Decision |
|---|---|
| Line 2 when no panels are open | **The page's own meta** (`Views · 12 nodes`, `12 total · 5 shown`), swapped for the breadcrumb trail when panels open. Fixed height either way, so no shift, and today's per-page counts survive. |
| Breadcrumb root crumb | **The header's own `title`.** Kills the `rootLabel` prop and its five duplicated expressions. |
| Panel grid scope | **Every page.** Raw opens from the switcher, so it must render anywhere. Overview, Maps index, Changelog, Pyramid and Settings gain a grid they lack today. |
| Raw's unsaved-changes guard | **A close guard in the panels layer.** Panels can veto their own close; `PanelStack` consults the guard from Escape and from the X button. |
| Raw edit-mode affordance | **The panel cell's border goes dashed and destructive-colored.** Shares one registration mechanism with the close guard. |
| Raw's place in the URL | **Absent.** `?node=` addresses the top *node* panel; Raw is a tool, not a location, so opening it never touches the address. |
| Raw's place in the stack | **Pushed on top** (`fromDepth = entries.length`), so it does not wipe open node panels. Re-invoking unwinds to the existing Raw rather than duplicating it. |
| Export's keyboard shortcut | **Moves to the project layout**, so it works on every page now that its button does. |
| Map display options | **Unchanged.** `MapDisplayPopover` and the System map's layout `Select` pass through the header's extras slot. |

## Design

### 1. `PageHeader` — the shared header

`components/layout/PageHeader.tsx`.

```ts
interface PageAction {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

interface PageHeaderProps {
  title: string;
  /** Line 2 when no panels are open. Replaced by the breadcrumb trail when they are. */
  meta?: ReactNode;
  action?: PageAction;
  /** Extra right-side controls, left of the action: Display popover, layout Select, version pill. */
  children?: ReactNode;
}
```

Same `h-12` box and the same backdrop treatment, **without `border-b`**. Line 1 is `truncate text-sm
font-medium`; line 2 is a `truncate text-xs text-muted-foreground` slot that always occupies its row.

The header calls `usePanelBreadcrumbs()` itself — pages never pass crumbs. When the stack is empty it
renders `meta`; otherwise it renders the trail, using its own `title` as the root crumb.

### 2. `usePanelBreadcrumbs` — the binding

`lib/hooks/usePanelBreadcrumbs.ts`.

Reads `useProjectPanels()` for entries and `useProject(id)` for node titles, and returns a flat list the
header can render without knowing anything about panels:

```ts
interface Crumb { label: string; onClick?: () => void }  // last crumb has no onClick
usePanelBreadcrumbs(rootLabel: string): Crumb[]          // [] when the stack is empty
```

Node entries label from the node's title, falling back to the entry key. The Raw entry labels
`Raw bundle`. Clicking the root crumb unwinds to depth 0; clicking crumb `i` unwinds to `i + 1` —
the same mapping `PanelStack` uses today.

Resolving labels here rather than in the surface is what lets the header work on the five pages that
have no node data of their own.

### 3. `PageShell` — header plus grid

`components/layout/PageShell.tsx`.

```tsx
<PageShell title="Library" meta="Views · 12 nodes" action={...} headerExtra={...}
           nodes={dataNodes} edges={dataEdges} journal={journal} onUpdateNode={...}>
  {surface}
</PageShell>
```

Renders `<div className="flex h-full w-full flex-col">` containing `<PageHeader>` and then
`<ProjectPanels>` wrapping `children`. Every page renders exactly one.

The node-data props are optional. A page that passes none still gets the grid — enough for Raw, which
needs no node data — so Overview, Maps index, Changelog, Pyramid and Settings adopt `PageShell` without
gaining node-panel wiring they have no use for.

### 4. Panels widen to carry a non-node panel

`lib/hooks/useNodePanels.tsx` → `lib/hooks/useProjectPanels.tsx`. The descriptor becomes a
discriminated union:

```ts
export type PanelDescriptor =
  | { kind: "node"; nodeId: string; initialPlatform?: PlatformId }
  | { kind: "raw" };
```

The entry key is the node id for nodes and the literal `"raw"` for Raw. Consequences, each of which is
a real hazard the union introduces:

- **`publishTop`** takes the top *node* entry, scanning past a Raw entry above it. Opening or closing
  Raw therefore leaves `?node=` alone, and a Raw panel on top cannot clobber the address of the node
  panel beneath it.
- **`reconcileArrival`** only ever constructs node entries, so a cold load, Back or Forward can never
  materialise a Raw panel out of the URL.
- **`pruneMissing`** filters `kind === "node"` entries only. Left as-is it would evict Raw on the next
  node-list change, because `NodeDetailStack.tsx:56-59` prunes against `nodesById.keys()`.
- **`openRaw()`** pushes at `fromDepth = entries.length` rather than 0, so it does not close what is
  already open. If a Raw entry exists it unwinds to it instead of pushing a second one.

`openNode`'s existing platform-inheritance rule (`useNodePanels.tsx:110-111`, which reads
`previous[fromDepth - 1]?.payload.initialPlatform`) must now guard on the previous entry being a node —
a Raw entry has no `initialPlatform`.

### 5. Panels describe themselves to the stack

One registration hook serves both the close guard and the edit-mode border, because both are the same
shape: a panel telling the stack something the stack cannot see.

```ts
interface PanelSelfState {
  /** Return false to veto the close. The panel is expected to raise its own confirm. */
  canClose?: () => boolean;
  /** Visual state of the cell. "editing" draws a dashed destructive border. */
  accent?: "editing" | null;
}

usePanelSelfState(instanceId: string, state: PanelSelfState): void
```

Registered in the panels context, cleaned up on unmount. `PanelStack` consults it in two places:

- **`runClose`** — both the Escape handler (`PanelStack.tsx:100-114`) and the X button
  (`PanelStack.tsx:211-213`) check `canClose()` for the entry being closed and bail when it returns
  `false`. The guard is synchronous; a panel that wants a confirm returns `false`, opens its dialog, and
  calls close again once resolved. That is the shape `RawBundleSheet.handleOpenChange:128-145` already
  uses, so the conversion is a re-home rather than a rewrite.
- **The cell class** — `accent === "editing"` adds `border-dashed border-destructive` to the
  `cellClassName` at `PanelStack.tsx:116-117`.

Escape's existing bail-outs stay: `isEditableElement` and the open-Radix-overlay check are unrelated
concerns and still fire first.

### 6. `RawBundlePanel`

`components/panels/RawBundleSheet.tsx` → `components/panels/RawBundlePanel.tsx`.

The Sheet chrome comes off: no `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`,
no `open`/`onOpenChange` pair. What was `SheetHeader`'s toolbar row (JSON/YAML toggle, Edit, or
Cancel/Save) becomes the panel's `renderHeader` content. The body keeps its `min-h-0 flex-1` scroll
container, its hover-revealed Copy button, and its textarea/`<pre>` branch unchanged.

The three `DeleteConfirmDialog`s stay as siblings. The component registers:

- `canClose: () => mode !== "edit" || !hasUnsavedChanges` — returning `false` opens the discard confirm,
  exactly as `handleOpenChange` does today.
- `accent: mode === "edit" ? "editing" : null`.

The `key={rawOpen ? "raw-open" : "raw-closed"}` remount trick at `JourneyMap.tsx:769` is dropped;
`PanelEntry.instanceId` already gives per-slot mount semantics.

`components/ui/sheet.tsx` is **not** deleted — `components/ui/sidebar.tsx:202-216` still uses it for the
mobile sidebar.

### 7. `ProjectPanels`

`components/panels/NodeDetailStack.tsx` → `components/panels/ProjectPanels.tsx`, keeping its role as
the only `PanelStack` binding but branching on entry kind: `node` renders `NodeDetailPanel` and
`NodeDetailPanelHeader`, `raw` renders `RawBundlePanel`.

The breadcrumb row and its `rootLabel` prop leave `PanelStack` entirely — the trail is now the header's
job via `usePanelBreadcrumbs`. `labelOf` **stays**, narrowed to its remaining single purpose: the
`aria-label` on each panel cell and on its close button. `PanelStack` gains a `surfaceLabel` prop for the
surface cell's `aria-label`, which `PageShell` fills with the page title — the one thing `rootLabel` did
that was not breadcrumb-specific.

### 8. Export and Raw move to the project switcher

`ProjectSwitcher.tsx` gains both beside Publish and Settings, in the project section:

| Item | Icon | Behaviour |
|---|---|---|
| Publish | `Share2Icon` | unchanged |
| Export JSON | `DownloadIcon` | `exportProject(id)` → `downloadJson(bundle)`; errors and the warning become toasts |
| Raw bundle | `Code2Icon` | `openRaw()` |
| Settings | `Settings2Icon` | unchanged |

Export's logic moves out of `JourneyMap.tsx:597-617` into `lib/hooks/useProjectExport.ts` so the switcher
and the keyboard shortcut share one implementation. The shortcut registration moves from
`JourneyMap.tsx:626-629` to `app/project/[id]/layout.tsx`, matching the command palette's shortcut that
already lives there.

The Journey header's inline `exportError` and warning `<span>`s (`JourneyMap.tsx:713-722`) are removed;
`playlistError` at `723-727` stays, since it is map-scoped.

### 9. Per-page titles and meta

| Page | Title | Meta (line 2) | Action | Extras |
|---|---|---|---|---|
| Overview | `Overview` | — | — | version pill |
| Maps index | `Maps` | — | New map | — |
| Journey map | `definition.title` | — | New node | Display |
| System map | `definition.title` | — | New node | layout `Select`, Display |
| Library | `Library` | species label when filtered | New node | — |
| Delivery | `Delivery` | — | New node | — |
| Changelog | `Changelog` | — | — | version pill |
| Acceptances | `Acceptances` | `12 total · 5 shown` | New acceptance | — |
| Pyramid | `Value pyramid` | — | — | — |
| Settings | `Settings` | — | — | — |

The `Maps ·` prefix the two map surfaces carry today is dropped along with the project title, on the
same reasoning: the sidebar's Maps group already shows where you are, and the crumb trail names the map.

`settings/page.tsx:69` currently renders a local `title` variable where the other nine render
`projectBundle?.project.title` — that divergence disappears with the project title itself.

## Testing

The panel state machine is the only pure logic here, and it already has a home:
`lib/utils/panel-stack.ts` is DB-free and testable. New assertions go into the existing
`tests/app/panel-stack.test.js` (`npm run test:panel-stack`), which needs no database and so runs
locally as well as in CI's fast build job:

1. `openFrom` at `fromDepth === entries.length` appends without closing anything.
2. A prune against a node-id set keeps a `kind: "raw"` entry and drops missing node entries.
3. The top-node scan skips a Raw entry and returns the node beneath it — and returns `null` when Raw is
   the only entry.
4. `reconcileArrival` never produces a Raw entry.

The close guard, the dashed border, the breadcrumb relocation and the absence of content shift are
presentation, verified by running the app: open a panel on each surface and confirm the surface does not
move, and open Raw, enter edit mode, type, and press Escape.

## Out of scope

- Making Raw addressable in the URL.
- Touching `MapDisplayPopover`, the layout `Select`, or per-map display persistence.
- Deleting `components/ui/sheet.tsx` (still used by the mobile sidebar).
- The Acceptances page's `window.prompt` action, which stays a deliberate deviation.
- Any change to `NodeDetailPanel`'s contents.
