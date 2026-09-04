# Marketing Page — Part 1: Canvas Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two map canvases and the prompt builder's use-case picker a props-only entry point, so the marketing page (Parts 2–4) can render them over a fixture slice with no project hooks, no data provider, and no editing. No user-visible change.

**Architecture:** `JourneyMap` and `SystemMap` keep every hook, dialog and handler and become controllers. Each hands the pure pipeline — graph build → ELK layout → `<Canvas>` — to a new presentational component (`JourneyCanvas`, `SystemCanvas`) that takes plain data. `Canvas` gains a `readOnly` prop that turns off connecting, dragging, selection, the controls and the minimap. The use-case picker on `/generate` moves into `components/generate/UseCasePicker.tsx`.

**Tech Stack:** Next.js 16 App Router, React 19, `@xyflow/react` 12, ELK via `lib/hooks/useElkLayout.ts`, TypeScript 5. Tests are plain-node loaders (`tests/app/*.test.js`) over pure modules; there is no React render harness in this repo, so component seams are verified by `tsc`, `lint`, `build` and a Playwright smoke run.

**Spec:** `docs/superpowers/specs/2026-09-03-marketing-page-design.md` § Refactors this requires.

**Status:** implemented; the shipped `JourneyCanvas`/`SystemCanvas` latch their layout callbacks in a ref and fire only on a ready layout (a review improvement over the snippets below).

**Shipping shape:** this is **PR 1 of a 4-part `gh stack`** (spec § Shipping). Branch: `marketing-1-canvas-split`, based on `main`. Chore-only: **no Lab Note**; add the `no-lab-note` label if the advisory reminder comments. Plans for parts 2–4 are written once this part lands, because their previews import the seams created here.

**Repo rails every task must respect:**
- **CI gates on lint.** `npm run lint` must show 0 errors before any commit claim.
- **Regenerate before the PR.** Run `npm run generate` before opening the PR; commit the result if anything changes (a new lucide icon dirties the wobble CSS).
- **Existing golden tests must keep passing:** `npm run test:journey-graph`, `npm run test:spotlight`. These cover the pure builders the canvases wrap; the split must not touch `lib/utils/journey-graph.ts` or `lib/utils/system-graph.ts`.
- **The React Compiler lint rules are on** (`react-hooks/set-state-in-effect`). Any `setState` inside an effect needs the same latch-and-comment shape the existing code uses, or a callback prop instead.
- **Name npm scripts, not files, in verification.**

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `components/graph/Canvas.tsx` | React Flow wrapper | add `readOnly` prop |
| `components/graph/JourneyCanvas.tsx` | **new** — journey graph → ELK → `Canvas`, props only | create |
| `components/graph/SystemCanvas.tsx` | **new** — system graph → ELK → `Canvas`, props only | create |
| `lib/utils/system-layout-options.ts` | **new** — the two ELK option presets, shared by `SystemMap` and `SystemCanvas` | create (moved out of `SystemMap.tsx`) |
| `components/maps/JourneyMap.tsx` | controller: hooks, dialogs, handlers | render `JourneyCanvas` instead of build+layout+`Canvas` |
| `components/maps/SystemMap.tsx` | controller | render `SystemCanvas`; import layout presets |
| `components/generate/UseCasePicker.tsx` | **new** — the three use-case cards | create (moved out of `app/generate/page.tsx`) |
| `app/generate/page.tsx` | the generate page | render `UseCasePicker` |
| `docs/architecture.md` | component map | mention the two canvases |

---

### Task 1: Branch

- [x] **Step 1: Create the branch from main**

```bash
git checkout main && git pull --ff-only
git checkout -b marketing-1-canvas-split
```

Expected: `Switched to a new branch 'marketing-1-canvas-split'`.

---

### Task 2: `Canvas` gains `readOnly`

**Files:**
- Modify: `components/graph/Canvas.tsx`

- [x] **Step 1: Add the prop to the interface**

In `CanvasProps`, after `minimapColor`, add:

```ts
  /**
   * A canvas that only shows: no connecting, dragging or selecting, and no
   * controls or minimap. Panning and zooming stay on. The marketing page's
   * previews and any future embedded reading use this; the map pages never
   * pass it.
   */
  readOnly?: boolean;
```

- [x] **Step 2: Destructure it with a default**

In the `Canvas` function signature, after `minimapColor,` add `readOnly = false,`.

- [x] **Step 3: Apply it to React Flow**

Replace the `<ReactFlow ...>` opening tag's prop list and its children so they read:

```tsx
        <ReactFlow
          nodes={display.nodes}
          edges={display.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={isDark ? "dark" : "light"}
          style={flowStyle}
          fitView
          minZoom={0.05}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          onInit={handleInit}
          onNodesChange={handleNodesChange}
          onNodeClick={handleNodeClick}
          onConnect={readOnly ? undefined : onConnect}
          onEdgeClick={readOnly ? undefined : onEdgeClick}
          onNodeMouseEnter={spotlight ? handleNodeMouseEnter : undefined}
          onNodeMouseLeave={spotlight ? handleNodeMouseLeave : undefined}
        >
          {!readOnly && <Controls />}
          {!readOnly && <Minimap colorBy={minimapColor} />}
          <Background />
        </ReactFlow>
```

`onNodeClick` stays wired in read-only mode: the preview may still centre on a card, and the callback is a no-op when the caller passes none.

- [x] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (warnings that already exist on `main` are fine).

- [x] **Step 5: Commit**

```bash
git add components/graph/Canvas.tsx
git commit -m "Canvas: readOnly prop turns off editing, controls and minimap"
```

---

### Task 3: `JourneyCanvas`

**Files:**
- Create: `components/graph/JourneyCanvas.tsx`

- [x] **Step 1: Create the component**

```tsx
"use client";

import { useEffect, useMemo } from "react";
import type { Node, NodeMouseHandler, OnConnect, EdgeMouseHandler } from "@xyflow/react";
import type { MapMinimapColorMode } from "@arkaik/schema";
import { Canvas } from "@/components/graph/Canvas";
import { useElkLayout } from "@/lib/hooks/useElkLayout";
import { buildJourneyGraph, type JourneyGraphParams } from "@/lib/utils/journey-graph";
import type { ProductScope } from "@/lib/utils/product-scope";

export interface JourneyCanvasProps extends JourneyGraphParams {
  /** The product scope the cards read platforms from. */
  scope: ProductScope;
  /** Increment to re-frame the viewport (see `Canvas`). */
  fitSignal?: number;
  minimapColor?: MapMinimapColorMode;
  /** Show only: no connect, drag, select, controls or minimap. */
  readOnly?: boolean;
  onNodeClick?: NodeMouseHandler;
  onConnect?: OnConnect;
  onEdgeClick?: EdgeMouseHandler;
  /**
   * Called with the positioned nodes each time an ELK layout lands. The
   * Journey controller uses it to re-frame once the auto-expanded flow's
   * playlist has a computed layout; a preview passes nothing.
   */
  onLayout?: (nodes: Node[]) => void;
}

/**
 * The Journey map's presentational half: graph construction → ELK layout →
 * `Canvas`, driven by plain data. Holds no project hooks, no panel context, no
 * dialogs — `JourneyMap` owns all of that and renders this. The marketing
 * page renders it over a fixture slice of the self-map.
 *
 * `JourneyGraphParams` is spread straight into `buildJourneyGraph`, so the
 * props here are exactly the builder's inputs plus the canvas's own knobs.
 */
export function JourneyCanvas({
  scope,
  fitSignal,
  minimapColor,
  readOnly = false,
  onNodeClick,
  onConnect,
  onEdgeClick,
  onLayout,
  ...graphParams
}: JourneyCanvasProps) {
  const {
    dataNodes,
    dataEdges,
    nodesById,
    composeParentByChild,
    explicitRootNode,
    composeClosure,
    expandedFlows,
    display,
    viewApiRelationsByViewId,
    nodeFindings,
    handlers,
  } = graphParams;

  // Listed field by field rather than `[graphParams]`: the rest object is a
  // fresh identity every render, and a graph rebuild re-runs ELK.
  const graphData = useMemo(
    () =>
      buildJourneyGraph({
        dataNodes,
        dataEdges,
        nodesById,
        composeParentByChild,
        explicitRootNode,
        composeClosure,
        expandedFlows,
        display,
        viewApiRelationsByViewId,
        nodeFindings,
        handlers,
      }),
    [
      composeClosure,
      composeParentByChild,
      dataEdges,
      dataNodes,
      display,
      expandedFlows,
      explicitRootNode,
      handlers,
      nodeFindings,
      nodesById,
      viewApiRelationsByViewId,
    ],
  );

  const { nodes: layoutedNodes } = useElkLayout(graphData);

  useEffect(() => {
    onLayout?.(layoutedNodes);
  }, [layoutedNodes, onLayout]);

  return (
    <Canvas
      nodes={layoutedNodes}
      edges={graphData.edges}
      onNodeClick={onNodeClick}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      fitSignal={fitSignal}
      scope={scope}
      minimapColor={minimapColor}
      readOnly={readOnly}
    />
  );
}
```

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `JourneyGraphParams` is not exported from `lib/utils/journey-graph.ts`, it is (line 168) — do not duplicate it.

- [x] **Step 3: Commit**

```bash
git add components/graph/JourneyCanvas.tsx
git commit -m "JourneyCanvas: the Journey map's presentational half"
```

---

### Task 4: `JourneyMap` renders `JourneyCanvas`

**Files:**
- Modify: `components/maps/JourneyMap.tsx`

The controller currently does, in order: `useMemo(buildJourneyGraph(...))` (the block ending around line 715 whose dependency list starts with `composeClosure`), `useElkLayout(graphData)`, an effect that watches `layoutedNodes` for the pending-fit marker, then `<Canvas nodes={nodes} edges={edges} ... />` inside `PageShell`.

- [x] **Step 1: Keep the handlers object, drop the build**

Find the `graphData` `useMemo`. It builds an object literal of params and a `handlers` object. Replace the whole `useMemo` with a memoised **handlers** object only:

```tsx
  const journeyHandlers = useMemo(
    () => ({
      onToggleFlow: toggleFlow,
      onAddChild: (flowId: string) => handleAddChildNode(flowId, "view"),
      onOpenDetails: (node: DataNode) => openNode({ nodeId: node.id }),
      onZoomShot: (node: DataNode) => {
        setZoomNode(node);
        setZoomPlatform(undefined);
      },
      onInsertBetween: handleInsertBetween,
    }),
    [handleAddChildNode, handleInsertBetween, openNode, toggleFlow],
  );
```

These are the five handlers in the current `handlers:` block (lines 697–704), verbatim.

- [x] **Step 2: Replace the layout hook and the pending-fit effect with an `onLayout` callback**

Delete the line `const { nodes: layoutedNodes } = useElkLayout(graphData);` and the `useEffect` beneath it that reads `pendingFitFlowRef`. Delete `const nodes = layoutedNodes;` and `const edges = graphData.edges;`. Add in their place:

```tsx
  // The one-time ReactFlow fitView frames the pre-expansion layout; once the
  // auto-expanded flow's playlist nodes land in a computed layout, re-frame.
  // A callback rather than an effect over the canvas's nodes: the layout now
  // lives inside JourneyCanvas, and a parent must not reach into it.
  const handleLayout = useCallback((layoutedNodes: Node[]) => {
    const flowId = pendingFitFlowRef.current;
    if (!flowId) return;

    const marker = `${VISUAL_NODE_ID_SEPARATOR}${flowId}:`;
    if (!layoutedNodes.some((node) => node.id.includes(marker))) return;

    pendingFitFlowRef.current = null;
    setFitSignal((value) => value + 1);
  }, []);
```

- [x] **Step 3: Render `JourneyCanvas`**

Replace the `<Canvas nodes={nodes} edges={edges} onNodeClick={handleNodeClick} onConnect={handleConnect} onEdgeClick={handleEdgeClick} fitSignal={fitSignal} scope={scope} minimapColor={display.minimap_color} />` line with:

```tsx
          <JourneyCanvas
            dataNodes={selection.nodes}
            dataEdges={dataEdges}
            nodesById={selection.nodesById}
            composeParentByChild={selection.composeParentByChild}
            explicitRootNode={explicitRootNode}
            composeClosure={composeClosure}
            expandedFlows={expandedFlows}
            display={display}
            viewApiRelationsByViewId={viewApiRelationsByViewId}
            nodeFindings={nodeFindings}
            handlers={journeyHandlers}
            scope={scope}
            fitSignal={fitSignal}
            minimapColor={display.minimap_color}
            onNodeClick={handleNodeClick}
            onConnect={handleConnect}
            onEdgeClick={handleEdgeClick}
            onLayout={handleLayout}
          />
```

The old `useMemo` passes the product-scoped `selection.nodes` / `selection.nodesById` (not the raw hook values) and `selection.composeParentByChild`; pass exactly what it passed. Its `emptyReason` guard and the module-level `EMPTY_GRAPH` become unreachable (the canvas is only mounted in the non-empty branch) and are deleted.

- [x] **Step 4: Fix imports**

Remove `Canvas` and `useElkLayout` imports. Remove `buildJourneyGraph` from the `@/lib/utils/journey-graph` import if nothing else in the file uses it (keep the other names). Add:

```ts
import { JourneyCanvas } from "@/components/graph/JourneyCanvas";
```

Keep `type Node` from `@xyflow/react` (used by `handleLayout`); drop `type Edge` if unused.

- [x] **Step 5: Typecheck, lint, golden tests**

Run: `npx tsc --noEmit && npm run lint && npm run test:journey-graph`
Expected: no type errors, 0 lint errors, every `PASS:` line and `failures: 0` (or no `FAIL:` lines).

- [x] **Step 6: Commit**

```bash
git add components/maps/JourneyMap.tsx
git commit -m "JourneyMap: render JourneyCanvas; controller keeps hooks and dialogs"
```

---

### Task 5: System layout presets move to `lib/utils`

**Files:**
- Create: `lib/utils/system-layout-options.ts`
- Modify: `components/maps/SystemMap.tsx:40-60`

- [x] **Step 1: Create the module**

```ts
import type { ElkLayoutOptions } from "@/lib/utils/elk-layout";

export type SystemLayoutMode = "tiered" | "organic";

// Tiered: views feed APIs feed data models — pin the tiers regardless of edge
// shape (spike-verified partitioning; orphans stay in their tier).
export const SYSTEM_TIERED_LAYOUT_OPTIONS: ElkLayoutOptions = {
  algorithm: "layered",
  direction: "DOWN",
  layoutEdgeTypes: ["calls", "displays", "queries"],
  partitionByNodeType: { view: 0, apiEndpoint: 1, dataModel: 2 },
};

// Organic: force-directed structure with overlap removal — at whole-product
// scale the tiered rendition degenerates into an unreadably wide ribbon
// (docs/spec/maps.md § MapDefinition, layout.algorithm).
export const SYSTEM_ORGANIC_LAYOUT_OPTIONS: ElkLayoutOptions = {
  algorithm: "organic",
  layoutEdgeTypes: ["calls", "displays", "queries"],
};

export function systemLayoutOptions(mode: SystemLayoutMode): ElkLayoutOptions {
  return mode === "tiered" ? SYSTEM_TIERED_LAYOUT_OPTIONS : SYSTEM_ORGANIC_LAYOUT_OPTIONS;
}
```

- [x] **Step 2: Remove the two consts and the `SystemLayoutMode` type from `SystemMap.tsx`**

Delete lines 44–60 of `components/maps/SystemMap.tsx` (the two option objects, their comments, and `type SystemLayoutMode`). Replace the `import type { ElkLayoutOptions } from "@/lib/utils/elk-layout";` line with:

```ts
import { systemLayoutOptions, type SystemLayoutMode } from "@/lib/utils/system-layout-options";
```

Replace the `useElkLayout(graph, layoutMode === "tiered" ? SYSTEM_TIERED_LAYOUT_OPTIONS : SYSTEM_ORGANIC_LAYOUT_OPTIONS)` call with `useElkLayout(graph, systemLayoutOptions(layoutMode))` (this call moves again in Task 7; keep it compiling now).

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add lib/utils/system-layout-options.ts components/maps/SystemMap.tsx
git commit -m "System map layout presets move to lib/utils for reuse"
```

---

### Task 6: `SystemCanvas`

**Files:**
- Create: `components/graph/SystemCanvas.tsx`

- [x] **Step 1: Create the component**

```tsx
"use client";

import { useEffect, useMemo } from "react";
import type { NodeMouseHandler, OnConnect, EdgeMouseHandler } from "@xyflow/react";
import type { MapDefinition, MapMinimapColorMode, ResolvedMapDisplay } from "@arkaik/schema";
import { Canvas } from "@/components/graph/Canvas";
import type { Node as DataNode, Edge as DataEdge } from "@/lib/data/types";
import { useElkLayout } from "@/lib/hooks/useElkLayout";
import type { ProductScope } from "@/lib/utils/product-scope";
import type { NodeFindingSummary } from "@/lib/utils/quality";
import { buildSystemGraph, type SystemGraphHandlers, type SystemGraphScope } from "@/lib/utils/system-graph";
import { systemLayoutOptions, type SystemLayoutMode } from "@/lib/utils/system-layout-options";

export interface SystemCanvasProps {
  definition: MapDefinition;
  dataNodes: readonly DataNode[];
  dataEdges: readonly DataEdge[];
  display: ResolvedMapDisplay;
  handlers?: SystemGraphHandlers;
  /** The ambient product scope and the graph membership is resolved on. */
  productScope?: SystemGraphScope;
  nodeFindings?: ReadonlyMap<string, NodeFindingSummary>;
  layoutMode: SystemLayoutMode;
  /** The scope the cards read platforms from (`productScope.scope` when given). */
  scope?: ProductScope;
  fitSignal?: number;
  minimapColor?: MapMinimapColorMode;
  spotlight?: boolean;
  spotlightNodeId?: string | null;
  readOnly?: boolean;
  onNodeClick?: NodeMouseHandler;
  onConnect?: OnConnect;
  onEdgeClick?: EdgeMouseHandler;
  /** Called each time an ELK layout lands, with the running count. */
  onLayoutVersion?: (version: number) => void;
}

/**
 * The System map's presentational half — `JourneyCanvas`'s twin: subgraph →
 * ELK (tiered or organic) → `Canvas`, from plain data. `SystemMap` owns the
 * hooks, the rendition switch and the dialogs and renders this.
 */
export function SystemCanvas({
  definition,
  dataNodes,
  dataEdges,
  display,
  handlers,
  productScope,
  nodeFindings,
  layoutMode,
  scope,
  fitSignal,
  minimapColor,
  spotlight = false,
  spotlightNodeId = null,
  readOnly = false,
  onNodeClick,
  onConnect,
  onEdgeClick,
  onLayoutVersion,
}: SystemCanvasProps) {
  const graph = useMemo(
    () => buildSystemGraph(definition, dataNodes, dataEdges, handlers, display, productScope, nodeFindings),
    [dataEdges, dataNodes, definition, display, handlers, nodeFindings, productScope],
  );

  const { nodes, layoutVersion } = useElkLayout(graph, systemLayoutOptions(layoutMode));

  useEffect(() => {
    onLayoutVersion?.(layoutVersion);
  }, [layoutVersion, onLayoutVersion]);

  return (
    <Canvas
      nodes={nodes}
      edges={graph.edges}
      onNodeClick={onNodeClick}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      fitSignal={fitSignal}
      minimapColor={minimapColor}
      spotlight={spotlight}
      spotlightNodeId={spotlightNodeId}
      scope={scope ?? productScope?.scope}
      readOnly={readOnly}
    />
  );
}
```

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `SystemGraphHandlers` or `SystemGraphScope` is not exported from `lib/utils/system-graph.ts`, export the existing interface (do not redefine it).

- [x] **Step 3: Commit**

```bash
git add components/graph/SystemCanvas.tsx
git commit -m "SystemCanvas: the System map's presentational half"
```

---

### Task 7: `SystemMap` renders `SystemCanvas`

**Files:**
- Modify: `components/maps/SystemMap.tsx`

- [x] **Step 1: Replace the graph build with a memoised handlers object**

Replace the `const graph = useMemo(() => buildSystemGraph(...), [...])` block with:

```tsx
  const systemHandlers = useMemo(
    () => ({ onOpenDetails: (node: DataNode) => openNode({ nodeId: node.id }) }),
    [openNode],
  );
  const systemScope = useMemo(() => ({ scope, graph: productGraph }), [productGraph, scope]);
```

- [x] **Step 2: Move the layout-version effect behind a callback**

Delete `const { nodes, layoutVersion } = useElkLayout(graph, systemLayoutOptions(layoutMode));`. Replace the `useEffect` that watches `layoutVersion` with:

```tsx
  // Re-frame the viewport when a layout the user asked for lands: armed at
  // mount (ReactFlow's one-time fitView fires while nodes still sit at the
  // origin) and re-armed on each rendition switch. Data-edit relayouts leave
  // the ref unarmed so they never yank the viewport while someone works.
  const handleLayoutVersion = useCallback((layoutVersion: number) => {
    if (layoutVersion === 0 || !pendingFitRef.current) return;
    pendingFitRef.current = false;
    setFitSignal((value) => value + 1);
  }, []);
```

Keep `pendingFitRef`, `fitSignal`, `reframe` and `handleLayoutModeChange` as they are. (The `requestAnimationFrame` dance existed to survive StrictMode's doubled effects; a callback fires once per layout, so it is no longer needed.)

- [x] **Step 3: Render `SystemCanvas`**

Replace the `<Canvas ... />` element inside `PageShell` with:

```tsx
        <SystemCanvas
          definition={definition}
          dataNodes={dataNodes}
          dataEdges={dataEdges}
          display={display}
          handlers={systemHandlers}
          productScope={systemScope}
          nodeFindings={nodeFindings}
          layoutMode={layoutMode}
          scope={scope}
          fitSignal={fitSignal}
          minimapColor={display.minimap_color}
          spotlight
          spotlightNodeId={addressedNodeId}
          onNodeClick={handleNodeClick}
          onConnect={handleConnect}
          onEdgeClick={handleEdgeClick}
          onLayoutVersion={handleLayoutVersion}
        />
```

- [x] **Step 4: Fix imports**

Remove `Canvas`, `useElkLayout`, `buildSystemGraph`, `systemLayoutOptions` imports (keep `type SystemLayoutMode`). Add:

```ts
import { SystemCanvas } from "@/components/graph/SystemCanvas";
```

- [x] **Step 5: Typecheck, lint, golden tests**

Run: `npx tsc --noEmit && npm run lint && npm run test:journey-graph && npm run test:spotlight`
Expected: no type errors, 0 lint errors, no `FAIL:` lines.

- [x] **Step 6: Commit**

```bash
git add components/maps/SystemMap.tsx
git commit -m "SystemMap: render SystemCanvas; controller keeps hooks and dialogs"
```

---

### Task 8: `UseCasePicker`

**Files:**
- Create: `components/generate/UseCasePicker.tsx`
- Modify: `app/generate/page.tsx`

- [x] **Step 1: Create the component**

```tsx
"use client";

import { Lightbulb, FileText, GitBranch } from "lucide-react";
import { USE_CASES, type UseCase } from "@/lib/prompts/types";

const USE_CASE_ICONS = {
  "from-pitch": Lightbulb,
  "from-plan": FileText,
  "extend-map": GitBranch,
} as const;

interface UseCasePickerProps {
  onSelect: (useCase: UseCase) => void;
  /** Highlight one card without a hover — the marketing preview's "selected" state. */
  selected?: UseCase | null;
  className?: string;
}

/**
 * The three ways to start a map from a prompt, as cards. The generate page
 * renders it as its first screen; the marketing page renders it as a preview
 * with a fixed `selected` and a no-op `onSelect`. Labels and descriptions are
 * `USE_CASES`' own — this component holds no copy.
 */
export function UseCasePicker({ onSelect, selected = null, className }: UseCasePickerProps) {
  return (
    <div className={["grid w-full gap-4 sm:grid-cols-3", className].filter(Boolean).join(" ")}>
      {USE_CASES.map((uc) => {
        const Icon = USE_CASE_ICONS[uc.id];
        const isSelected = selected === uc.id;
        return (
          <button
            key={uc.id}
            type="button"
            onClick={() => onSelect(uc.id)}
            aria-pressed={isSelected}
            className={[
              "flex flex-col items-start gap-3 rounded-xl border bg-card p-6 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected ? "border-foreground" : "",
            ].join(" ")}
          >
            <Icon className="size-6 text-primary" />
            <div>
              <div className="font-medium">{uc.label}</div>
              <p className="mt-1 text-sm text-muted-foreground">{uc.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [x] **Step 2: Use it on the generate page**

In `app/generate/page.tsx`, delete the `USE_CASE_ICONS` const and the `Lightbulb, FileText, GitBranch` names from the `lucide-react` import (keep `ArrowLeft`). Replace the `<div className="grid w-full gap-4 sm:grid-cols-3">…</div>` block (the `USE_CASES.map` grid) with:

```tsx
          <UseCasePicker onSelect={handleUseCaseSelect} />
```

Add the import:

```ts
import { UseCasePicker } from "@/components/generate/UseCasePicker";
```

If `USE_CASES` is now only used by the `USE_CASES.find(...)` label lookup, keep its import; if unused, remove it.

- [x] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add components/generate/UseCasePicker.tsx app/generate/page.tsx
git commit -m "UseCasePicker: the generate page's use-case cards as a component"
```

---

### Task 9: Build, regenerate, docs

**Files:**
- Modify: `docs/architecture.md` (the `components/graph/` entry in the component map)

- [x] **Step 1: Regenerate and check for drift**

Run: `npm run generate && git status --short`
Expected: either clean, or only generated files changed (commit those: `git add -A && git commit -m "chore: regenerate"`).

- [x] **Step 2: Production build**

Run: `npm run build`
Expected: `✓ Compiled successfully` and no type errors. `/generate` must still prerender behind its Suspense boundary (the build fails loudly if not).

- [x] **Step 3: Document the seam**

In `docs/architecture.md`, find the component map entry for `components/graph/Canvas.tsx` and add beneath it:

```
    JourneyCanvas.tsx         # Journey graph → ELK → Canvas, props only (JourneyMap is the controller)
    SystemCanvas.tsx          # System graph → ELK → Canvas, props only (SystemMap is the controller)
```

If `docs/architecture.md` has no such entry, add the two lines to the `components/graph/` block in `README.md` § Folder Structure instead.

- [x] **Step 4: Commit**

```bash
git add docs/architecture.md README.md
git commit -m "docs: JourneyCanvas and SystemCanvas in the component map"
```

---

### Task 10: Playwright smoke run

There is no React render harness, so this is the check that the two controllers still draw. Runs against `npm run dev` on port 4242.

**Files:**
- Create (scratchpad, not committed): `$SCRATCHPAD/smoke-canvas.mjs`

- [x] **Step 1: Install Playwright in the scratchpad**

```bash
cd "$SCRATCHPAD" && npm init -y >/dev/null && npm i playwright@1 >/dev/null && npx playwright install chromium
```

- [x] **Step 2: Start the dev server in the background**

```bash
cd /Users/alexis/code/arkaik && npm run dev
```

(Run with `run_in_background`; wait for `Ready` in its output.)

- [x] **Step 3: Write the smoke script**

```js
import { chromium } from "playwright";

const base = "http://localhost:4242";
const project = "arkaik-self-map"; // SEED_PROJECT_ID in lib/data/seed-project-id.ts
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

for (const map of ["journey", "system"]) {
  await page.goto(`${base}/project/${project}/maps/${map}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  const count = await page.locator(".react-flow__node").count();
  await page.screenshot({ path: `${map}.png` });
  console.log(`${map}: ${count} nodes`);
}

await page.goto(`${base}/generate`, { waitUntil: "networkidle" });
const cards = await page.locator("button[aria-pressed]").count();
console.log(`generate: ${cards} use-case cards`);

console.log(`page errors: ${errors.length}`);
for (const e of errors) console.log("  " + e);
await browser.close();
process.exit(errors.length === 0 && cards === 3 ? 0 : 1);
```

- [x] **Step 4: Run it**

Run: `cd "$SCRATCHPAD" && node smoke-canvas.mjs`
Expected:

```
journey: <n> nodes     (n ≥ 2)
system: <m> nodes      (m ≥ 10)
generate: 3 use-case cards
page errors: 0
```

Open `journey.png` and `system.png` with the Read tool and confirm cards, edges, controls and the minimap are drawn (this part is not read-only, so both must be present).

- [x] **Step 5: Stop the dev server**

Stop the background task started in Step 2.

---

### Task 11: Open PR 1 of the stack

- [x] **Step 1: Push and open the PR with `gh stack`**

Use the `gh-stack` skill. Title: `marketing 1: JourneyCanvas, SystemCanvas, UseCasePicker seams`. Body:

```
Part 1 of 4 for the marketing page (spec: docs/superpowers/specs/2026-09-03-marketing-page-design.md).

Props-only entry points the landing previews will render:
- `Canvas` gains `readOnly`
- `JourneyCanvas` / `SystemCanvas`: graph → ELK → Canvas from plain data; the map pages become controllers
- `UseCasePicker` extracted from /generate
- System layout presets move to lib/utils

No user-visible change.
```

Add the `no-lab-note` label.

- [x] **Step 2: Read the PR comments**

Run: `gh pr view --comments`
Expected: no Lab Note reminder, or one silenced by the label. CI green on lint, build and the test jobs.

---

## Self-review

**Spec coverage (§ Refactors this requires):** `JourneyMap` → `JourneyCanvas` (Tasks 3–4), `SystemMap` → `SystemCanvas` (Tasks 5–7), `readOnly` where missing (Task 2 covers the canvas; the board/matrix/log components' `readOnly` is added in Part 2 alongside their previews, where its absence is first observable), use-case picker extraction (Task 8).

**Type consistency:** `JourneyCanvasProps extends JourneyGraphParams` (Task 3) and Task 4 passes every field of that interface by the names in `lib/utils/journey-graph.ts:168-190`. `SystemCanvasProps.productScope` is `SystemGraphScope` (Task 6) and Task 7 passes `{ scope, graph }`, which is what `buildSystemGraph`'s sixth argument already receives today. `systemLayoutOptions(mode)` is defined in Task 5 and used in Task 6.

**Placeholders:** none. The one conditional ("if not exported, export it") names the exact interface and forbids redefinition.
