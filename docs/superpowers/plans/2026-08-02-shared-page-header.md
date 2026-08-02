# Shared Page Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ten hand-rolled page headers with one shared component whose second line carries the breadcrumb trail, so opening a panel no longer shifts the page — and move Export and Raw into the project switcher, with Raw rendering as a panel.

**Architecture:** A `PageHeader` renders title + meta/breadcrumbs + action. A `PageShell` pairs it with the panel grid so every page gets both from one call. The panel descriptor widens to a discriminated union so a non-node panel (Raw) can live in the same stack, and panels gain a self-state registry that lets them veto their own close and tint their own cell border.

**Tech Stack:** Next.js App Router, React 19, Tailwind v4, shadcn/ui (Radix), lucide-react, sonner. Tests are plain Node scripts run via `npm run test:*` — no test framework.

**Spec:** [`docs/superpowers/specs/2026-08-02-shared-page-header-design.md`](../specs/2026-08-02-shared-page-header-design.md)

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `lib/utils/project-panels.ts` | The panel descriptor union and its pure helpers. No React, no DOM — so it is testable in Node. |
| `lib/hooks/usePanelBreadcrumbs.ts` | Turns the panel stack into a flat crumb list, resolving node titles. |
| `components/layout/PageHeader.tsx` | The one header: title, meta/breadcrumbs, action, extras. |
| `components/layout/PageShell.tsx` | Header + panel grid, one call per page. |
| `components/panels/RawBundlePanel.tsx` | The raw bundle viewer/editor, as a panel. |
| `lib/hooks/useProjectExport.ts` | Bundle export + download, shared by the switcher and the shortcut. |
| `tests/app/project-panels.test.js` | Assertions for the pure helpers. |

**Rename:**

| From | To |
|---|---|
| `lib/hooks/useNodePanels.tsx` | `lib/hooks/useProjectPanels.tsx` |
| `components/panels/NodeDetailStack.tsx` | `components/panels/ProjectPanels.tsx` |
| `components/panels/RawBundleSheet.tsx` | `components/panels/RawBundlePanel.tsx` (rewritten, see above) |

**Modify:** `components/panels/PanelStack.tsx`, `components/layout/ProjectSwitcher.tsx`, `components/layout/ProjectSidebar.tsx`, `app/project/[id]/layout.tsx`, `tests/app/load-panel-utils.js` (renamed from `load-panel-stack.js` in Task 1), `package.json`, and the ten surfaces listed in Tasks 8–10.

---

### Task 1: The panel descriptor union and its pure helpers

**Files:**
- Create: `lib/utils/project-panels.ts`
- Create: `tests/app/project-panels.test.js`
- Modify: `tests/app/load-panel-stack.js`
- Modify: `package.json`

Every import in `project-panels.ts` must be `import type`. The test harness transpiles the file
standalone with no module resolution, so a value import would fail at `require` time.

- [ ] **Step 1: Write the failing test**

Create `tests/app/project-panels.test.js`:

```js
#!/usr/bin/env node

/**
 * The panel descriptor union (lib/utils/project-panels.ts). Pins the three
 * things the union makes newly breakable: a non-node panel must survive a node
 * prune, it must not be what the URL addresses, and pushing it must not close
 * what is already open.
 */

const fs = require("fs");
const { loadPanelStack, loadProjectPanels, BUILD_DIR } = require("./load-panel-stack");

const { openFrom, initStack } = loadPanelStack();
const { RAW_PANEL_KEY, isNodeEntry, topNodeKey, pruneNodeEntries } = loadProjectPanels();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const keys = (stack) => stack.map((entry) => entry.key).join(" · ");
const node = (id) => ({ kind: "node", nodeId: id });
const raw = () => ({ kind: "raw" });

// --- entry discrimination ---
const nodeEntry = { key: "A", instanceId: "p1", payload: node("A") };
const rawEntry = { key: RAW_PANEL_KEY, instanceId: "p2", payload: raw() };
assert(isNodeEntry(nodeEntry), "a node entry is a node entry");
assert(!isNodeEntry(rawEntry), "a raw entry is not a node entry");

// --- Raw pushes on top rather than collapsing the trail ---
const withAB = openFrom(openFrom(initStack(), 0, "A", node("A")), 1, "B", node("B"));
const withRaw = openFrom(withAB, withAB.length, RAW_PANEL_KEY, raw());
assert(
  keys(withRaw) === `A · B · ${RAW_PANEL_KEY}`,
  `opening Raw appends without closing anything (got "${keys(withRaw)}")`,
);
assert(withRaw[0] === withAB[0] && withRaw[1] === withAB[1], "the node panels keep their identity");

// --- the URL addresses the top NODE, scanning past Raw ---
assert(topNodeKey(withAB) === "B", "with no Raw open the top node is the top entry");
assert(topNodeKey(withRaw) === "B", "a Raw panel on top does not become the address");
assert(topNodeKey([rawEntry]) === null, "Raw alone addresses nothing");
assert(topNodeKey([]) === null, "an empty stack addresses nothing");

// --- pruning deleted nodes must not evict Raw ---
const pruned = pruneNodeEntries(withRaw, new Set(["A"]));
assert(
  keys(pruned) === `A · ${RAW_PANEL_KEY}`,
  `pruning drops the missing node and keeps Raw (got "${keys(pruned)}")`,
);
assert(pruned[0] === withRaw[0], "a surviving node entry keeps its identity");
assert(
  pruneNodeEntries(withRaw, new Set(["A", "B"])) === withRaw,
  "a prune that removes nothing returns the same array — no render loop",
);
assert(
  keys(pruneNodeEntries([rawEntry], new Set())) === RAW_PANEL_KEY,
  "an empty node set still keeps Raw",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll project-panels tests passed");
```

- [ ] **Step 2: Extend the loader**

In `tests/app/load-panel-stack.js`, replace the whole file with:

```js
/**
 * Loads the panel modules (lib/utils/panel-stack.ts, lib/utils/project-panels.ts)
 * into Node without a bundler — the load-graph-spotlight.js technique. Both
 * modules are import-free at runtime: panel-stack has no imports at all, and
 * project-panels uses `import type` only, which transpiles away.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-panel-stack");

function loadUtil(name) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: `${name}.ts`,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const outPath = path.join(BUILD_DIR, `${name}.js`);
  fs.writeFileSync(outPath, outputText);
  delete require.cache[outPath];
  return require(outPath);
}

const loadPanelStack = () => loadUtil("panel-stack");
const loadProjectPanels = () => loadUtil("project-panels");

module.exports = { loadPanelStack, loadProjectPanels, loadUtil, BUILD_DIR };
```

Note the removed `fs.rmSync` at the top of the old `loadPanelStack` — with two loaders writing
into one build dir, wiping on the second call would delete the first module. Each test file still
removes `BUILD_DIR` at its end.

- [ ] **Step 3: Add the npm script**

In `package.json`, after the `"test:panel-stack"` line, add:

```json
    "test:project-panels": "node tests/app/project-panels.test.js",
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test:project-panels`
Expected: FAIL — `ENOENT ... lib/utils/project-panels.ts`

- [ ] **Step 5: Write the implementation**

Create `lib/utils/project-panels.ts`:

```ts
/**
 * What a panel in the project stack can be.
 *
 * The stack was built for nodes, and nodes are still what the URL addresses.
 * Raw is the exception that proves the shape: a tool rather than a location, so
 * it rides in the same stack without an address and without being subject to
 * the node lifecycle — a node prune must not evict it, and it must never be
 * what `?node=` names.
 */

import type { PlatformId } from "@/lib/config/platforms";
import type { PanelEntry } from "@/lib/utils/panel-stack";

/** The entry key of the raw-bundle panel. There is at most one, ever. */
export const RAW_PANEL_KEY = "raw";

export type PanelDescriptor =
  | {
      kind: "node";
      nodeId: string;
      /** Platform tab the variants section opens on — the Delivery board's column. */
      initialPlatform?: PlatformId;
    }
  | { kind: "raw" };

export type ProjectPanelEntry = PanelEntry<PanelDescriptor>;

export function isNodeEntry(
  entry: ProjectPanelEntry,
): entry is PanelEntry<Extract<PanelDescriptor, { kind: "node" }>> {
  return entry.payload.kind === "node";
}

/**
 * The node the URL addresses: the topmost *node* entry, scanning past anything
 * above it. A Raw panel opened over a node panel leaves the address alone.
 */
export function topNodeKey(entries: ProjectPanelEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (isNodeEntry(entry)) return entry.key;
  }

  return null;
}

/**
 * Drop node panels whose node no longer exists — deleted out from under the
 * stack. Non-node panels are not subject to the node lifecycle and always
 * survive. Returns the same array when nothing changed, so callers can set
 * state unconditionally without looping.
 */
export function pruneNodeEntries(
  entries: ProjectPanelEntry[],
  existingNodeIds: Set<string>,
): ProjectPanelEntry[] {
  const next = entries.filter((entry) => !isNodeEntry(entry) || existingNodeIds.has(entry.key));
  return next.length === entries.length ? entries : next;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:project-panels && npm run test:panel-stack`
Expected: both print `All ... tests passed`, exit 0

- [ ] **Step 7: Commit**

```bash
git add lib/utils/project-panels.ts tests/app/project-panels.test.js tests/app/load-panel-stack.js package.json
git commit -m "feat: a panel descriptor union, so a non-node panel can share the stack"
```

---

### Task 2: Widen the panels context

**Files:**
- Rename: `lib/hooks/useNodePanels.tsx` → `lib/hooks/useProjectPanels.tsx`
- Modify: `app/project/[id]/layout.tsx:10`, `components/panels/NodeDetailStack.tsx:9,50`

- [ ] **Step 1: Rename the file**

```bash
git mv lib/hooks/useNodePanels.tsx lib/hooks/useProjectPanels.tsx
```

- [ ] **Step 2: Rewrite the module**

Replace the contents of `lib/hooks/useProjectPanels.tsx` with:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  closeAt as closeStackAt,
  initStack,
  openFrom,
  reconcileArrival,
  unwindTo as unwindStackTo,
} from "@/lib/utils/panel-stack";
import {
  isNodeEntry,
  pruneNodeEntries,
  topNodeKey,
  RAW_PANEL_KEY,
  type NodePanelDescriptor,
  type PanelDescriptor,
  type ProjectPanelEntry,
} from "@/lib/utils/project-panels";

/** The search param that addresses the top node panel, on whatever route you're on. */
export const NODE_PANEL_PARAM = "node";

/**
 * What `openNode` takes. `NodePanelDescriptor` carries the `kind: "node"`
 * discriminant, which callers should not have to spell — they are calling
 * `openNode`, so the kind is implied.
 */
export type OpenNodeInput = Omit<NodePanelDescriptor, "kind">;

/**
 * What a panel can tell the stack about itself — things the stack cannot see
 * from the outside. Both members exist for the raw editor: an unsaved draft
 * must be able to refuse a close, and edit mode must be visible on the cell.
 */
export interface PanelSelfState {
  /** Return false to veto the close. The panel is expected to raise its own confirm. */
  canClose?: () => boolean;
  /** Visual state of the cell. "editing" draws a dashed destructive border. */
  accent?: "editing" | null;
}

interface ProjectPanelsValue {
  entries: ProjectPanelEntry[];
  /** The node the URL addresses: the spotlight anchor, and Delete's target. */
  topNodeId: string | null;
  /**
   * Open a node from a depth. Depth 0 is the surface itself (a canvas, board,
   * or list click); the panel at index `i` is depth `i + 1`.
   */
  openNode: (descriptor: OpenNodeInput, fromDepth?: number) => void;
  /** Open the raw bundle on top of whatever is open, or reveal the one already there. */
  openRaw: () => void;
  closeAt: (index: number) => void;
  unwindTo: (depth: number) => void;
  /** Drop panels whose node no longer exists — deleted out from under the stack. */
  pruneMissing: (existingIds: Set<string>) => void;
  panelStates: Record<string, PanelSelfState>;
  registerPanelState: (instanceId: string, state: PanelSelfState | null) => void;
}

const ProjectPanelsContext = createContext<ProjectPanelsValue | null>(null);

/**
 * Owns the panel stack for a project: the transitions from
 * `lib/utils/panel-stack.ts`, and the `?node=` contract on top of them.
 *
 * It mounts in `app/project/[id]/layout.tsx` rather than in a page, because a
 * page segment remounts whenever its dynamic params change — which would reset
 * the stack on every navigation.
 *
 * The URL addresses the top *node* panel only. Everything below it is
 * exploration history, not an address, and the raw panel is not an address at
 * all — it is a tool, so it can sit on top without displacing what `?node=`
 * names. `reconcileArrival` handles the arrivals nobody published — a cold
 * load, Back, Forward — where the id comes with no intent attached.
 */
export function ProjectPanelsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlNodeId = searchParams.get(NODE_PANEL_PARAM);

  const [entries, setEntries] = useState<ProjectPanelEntry[]>(initStack<PanelDescriptor>);
  const [addressed, setAddressed] = useState<string | null>(null);
  const [panelStates, setPanelStates] = useState<Record<string, PanelSelfState>>({});

  // An id can arrive without us having published it: a cold load, Back,
  // Forward, a link from elsewhere. Adjusting during render rather than in an
  // effect means the stack and the address are never painted out of step.
  if (urlNodeId !== addressed) {
    setAddressed(urlNodeId);
    setEntries((previous) =>
      reconcileArrival<PanelDescriptor>(previous, urlNodeId, {
        kind: "node",
        nodeId: urlNodeId ?? "",
      }),
    );
  }

  // `openNode` is a dependency of the graph builders, so an identity that
  // changed whenever the address did would rebuild the graph and re-run the ELK
  // layout every single time a panel opened. It reads the route through a ref.
  const route = useRef({ pathname, router, searchParams });

  useEffect(() => {
    route.current = { pathname, router, searchParams };
  }, [pathname, router, searchParams]);

  const publishTop = useCallback((nodeId: string | null) => {
    const { pathname: path, router: nav, searchParams: current } = route.current;
    const params = new URLSearchParams(current.toString());
    if (nodeId) params.set(NODE_PANEL_PARAM, nodeId);
    else params.delete(NODE_PANEL_PARAM);

    const query = params.toString();
    nav.push(query ? `${path}?${query}` : path, { scroll: false });
  }, []);

  const openNode = useCallback(
    (descriptor: OpenNodeInput, fromDepth = 0) => {
      setEntries((previous) => {
        // The Delivery board opens a node on a platform; following a reference
        // out of that panel stays on the platform you were reading. A raw
        // panel below carries no platform, hence the node guard.
        const below = previous[fromDepth - 1];
        const inherited = below && isNodeEntry(below) ? below.payload.initialPlatform : undefined;

        return openFrom<PanelDescriptor>(previous, fromDepth, descriptor.nodeId, {
          kind: "node",
          nodeId: descriptor.nodeId,
          initialPlatform: descriptor.initialPlatform ?? inherited,
        });
      });

      publishTop(descriptor.nodeId);
    },
    [publishTop],
  );

  // Raw opens on top of the trail rather than collapsing it, and never touches
  // the address — so a node panel underneath keeps its `?node=`.
  const openRaw = useCallback(() => {
    setEntries((previous) => {
      const existing = previous.findIndex((entry) => entry.key === RAW_PANEL_KEY);
      if (existing >= 0) return unwindStackTo(previous, existing + 1);

      return openFrom<PanelDescriptor>(previous, previous.length, RAW_PANEL_KEY, { kind: "raw" });
    });
  }, []);

  const closeAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= entries.length) return;

      const next = closeStackAt(entries, index);
      setEntries(next);

      const nextTop = topNodeKey(next);
      if (nextTop !== urlNodeId) publishTop(nextTop);
    },
    [entries, publishTop, urlNodeId],
  );

  const unwindTo = useCallback(
    (depth: number) => {
      if (depth >= entries.length) return;

      const next = unwindStackTo(entries, depth);
      setEntries(next);

      const nextTop = topNodeKey(next);
      if (nextTop !== urlNodeId) publishTop(nextTop);
    },
    [entries, publishTop, urlNodeId],
  );

  const pruneMissing = useCallback(
    (existingIds: Set<string>) => {
      const next = pruneNodeEntries(entries, existingIds);
      if (next === entries) return;

      setEntries(next);
      const nextTop = topNodeKey(next);
      if (nextTop !== urlNodeId) publishTop(nextTop);
    },
    [entries, publishTop, urlNodeId],
  );

  const registerPanelState = useCallback((instanceId: string, state: PanelSelfState | null) => {
    setPanelStates((previous) => {
      if (state === null) {
        if (!(instanceId in previous)) return previous;
        const next = { ...previous };
        delete next[instanceId];
        return next;
      }

      return { ...previous, [instanceId]: state };
    });
  }, []);

  const value = useMemo<ProjectPanelsValue>(
    () => ({
      entries,
      topNodeId: topNodeKey(entries),
      openNode,
      openRaw,
      closeAt,
      unwindTo,
      pruneMissing,
      panelStates,
      registerPanelState,
    }),
    [closeAt, entries, openNode, openRaw, panelStates, pruneMissing, registerPanelState, unwindTo],
  );

  return <ProjectPanelsContext.Provider value={value}>{children}</ProjectPanelsContext.Provider>;
}

export function useProjectPanels(): ProjectPanelsValue {
  const value = useContext(ProjectPanelsContext);

  if (!value) {
    throw new Error(
      "useProjectPanels must be used inside a ProjectPanelsProvider (app/project/[id]/layout.tsx)",
    );
  }

  return value;
}

/**
 * Register what this panel wants the stack to know about it. `canClose` is read
 * through a ref so a changing closure does not re-register on every render;
 * `accent` is a primitive and drives re-registration directly.
 */
export function usePanelSelfState(instanceId: string, state: PanelSelfState): void {
  const { registerPanelState } = useProjectPanels();
  const accent = state.accent ?? null;

  const canCloseRef = useRef(state.canClose);
  canCloseRef.current = state.canClose;

  useEffect(() => {
    registerPanelState(instanceId, {
      canClose: () => canCloseRef.current?.() ?? true,
      accent,
    });

    return () => registerPanelState(instanceId, null);
  }, [accent, instanceId, registerPanelState]);
}
```

- [ ] **Step 3: Update the three importers**

In `app/project/[id]/layout.tsx` line 10, replace:

```tsx
import { NODE_PANEL_PARAM, NodePanelsProvider } from "@/lib/hooks/useNodePanels";
```

with:

```tsx
import { NODE_PANEL_PARAM, ProjectPanelsProvider } from "@/lib/hooks/useProjectPanels";
```

and rename both JSX tags at lines 100 and 130: `<NodePanelsProvider>` → `<ProjectPanelsProvider>`,
`</NodePanelsProvider>` → `</ProjectPanelsProvider>`.

In `components/panels/NodeDetailStack.tsx` line 9, replace:

```tsx
import { useNodePanels, type NodePanelEntry } from "@/lib/hooks/useNodePanels";
```

with:

```tsx
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import type { PanelDescriptor } from "@/lib/utils/project-panels";
```

and at line 50 replace `useNodePanels()` with `useProjectPanels()`. At line 62 replace the generic
`PanelStack<NodePanelEntry["payload"]>` with `PanelStack<PanelDescriptor>`, and at line 78 replace
`entry.payload.initialPlatform` with:

```tsx
            initialPlatform={entry.payload.kind === "node" ? entry.payload.initialPlatform : undefined}
```

- [ ] **Step 4: Verify it compiles and the tests still pass**

Run: `npx tsc --noEmit -p . && npm run test:panel-stack && npm run test:project-panels`
Expected: no output from tsc, both test scripts pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: widen the panel stack to carry a panel that is not a node"
```

---

### Task 3: `usePanelBreadcrumbs`

**Files:**
- Create: `lib/hooks/usePanelBreadcrumbs.ts`

Read `lib/hooks/useNodes.ts` first to confirm the hook's export shape; this task assumes
`useNodes(projectId)` returns `{ nodes }` as it does at `app/project/[id]/maps/page.tsx:29`.

- [ ] **Step 1: Write the implementation**

Create `lib/hooks/usePanelBreadcrumbs.ts`:

```ts
"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { RAW_PANEL_KEY } from "@/lib/utils/project-panels";

export interface PanelCrumb {
  label: string;
  /** Absent on the last crumb — you are already there. */
  onClick?: () => void;
}

/**
 * The panel trail, flattened for the header to render.
 *
 * Labels resolve here rather than in the surface, which is what lets the header
 * show a trail on pages that hold no node data of their own — Overview,
 * Settings, Pyramid, Changelog, the Maps index.
 *
 * Returns an empty list when nothing is open, which is the header's signal to
 * show the page's own meta line instead.
 */
export function usePanelBreadcrumbs(rootLabel: string): PanelCrumb[] {
  const params = useParams();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id ?? "";
  const { entries, unwindTo } = useProjectPanels();
  const { nodes } = useNodes(projectId);

  const titlesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.title])),
    [nodes],
  );

  return useMemo(() => {
    if (entries.length === 0) return [];

    const crumbs: PanelCrumb[] = [{ label: rootLabel, onClick: () => unwindTo(0) }];

    entries.forEach((entry, index) => {
      const label =
        entry.key === RAW_PANEL_KEY ? "Raw bundle" : titlesById.get(entry.key) ?? entry.key;
      const isLast = index === entries.length - 1;

      crumbs.push({ label, onClick: isLast ? undefined : () => unwindTo(index + 1) });
    });

    return crumbs;
  }, [entries, rootLabel, titlesById, unwindTo]);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p .`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/usePanelBreadcrumbs.ts
git commit -m "feat: flatten the panel trail into crumbs the header can render"
```

---

### Task 4: `PageHeader`

**Files:**
- Create: `components/layout/PageHeader.tsx`

- [ ] **Step 1: Write the implementation**

Create `components/layout/PageHeader.tsx`:

```tsx
"use client";

import { Fragment, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePanelBreadcrumbs } from "@/lib/hooks/usePanelBreadcrumbs";

export interface PageAction {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

interface PageHeaderProps {
  /** The page's own name. Also the trail's first crumb. */
  title: string;
  /** Line two when no panel is open — counts, filters, whatever the page wants. */
  meta?: ReactNode;
  action?: PageAction;
  /** Right-side controls, left of the action: display options, a version pill. */
  children?: ReactNode;
}

/**
 * The one project header. Two lines: the page's name, and below it either the
 * page's own meta or the panel trail.
 *
 * The second line is why it exists. Breadcrumbs used to mount in a row of their
 * own the moment a panel opened, which pushed the surface down every single
 * time; here the row is always present and only its contents change, so
 * opening a panel costs no layout.
 *
 * The project's own name is deliberately absent — the sidebar names it, and it
 * is the same on every page of a project.
 */
export function PageHeader({ title, meta, action, children }: PageHeaderProps) {
  const crumbs = usePanelBreadcrumbs(title);
  const ActionIcon = action?.icon;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1 cursor-pointer" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <div className="truncate text-xs text-muted-foreground">
          {crumbs.length > 0 ? (
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap gap-1 overflow-x-auto whitespace-nowrap text-xs sm:gap-1">
                {crumbs.map((crumb, index) => (
                  <Fragment key={`${crumb.label}-${index}`}>
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {crumb.onClick ? (
                        <button
                          type="button"
                          className="max-w-48 cursor-pointer truncate transition-colors hover:text-foreground"
                          onClick={crumb.onClick}
                        >
                          {crumb.label}
                        </button>
                      ) : (
                        <BreadcrumbPage className="max-w-48 truncate">{crumb.label}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          ) : (
            meta
          )}
        </div>
      </div>
      {(children || action) && (
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {children}
          {action && (
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {ActionIcon && <ActionIcon className="size-4" />}
              {action.label}
            </Button>
          )}
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p . && npx eslint components/layout/PageHeader.tsx`
Expected: no output from either

- [ ] **Step 3: Commit**

```bash
git add components/layout/PageHeader.tsx
git commit -m "feat: one page header, with the panel trail on its second line"
```

---

### Task 5: `PanelStack` gates its breadcrumb row, and honours panel self-state

**Files:**
- Modify: `components/panels/PanelStack.tsx`

The breadcrumb row stays behind a `showBreadcrumbs` prop that defaults to `true`, so surfaces not
yet converted keep theirs while converted ones use the header's. Task 11 deletes it.

- [ ] **Step 1: Add the three new props**

In the `PanelStackProps<T>` interface, after `onLayoutChange`, add:

```tsx
  /**
   * The legacy in-body breadcrumb row. `PageShell` passes false — the header
   * owns the trail now. Removed once every surface is on `PageShell`.
   */
  showBreadcrumbs?: boolean;
  /** The surface cell's accessible name. */
  surfaceLabel?: string;
  /** Per-entry visual accent. "editing" draws a dashed destructive border. */
  accentOf?: (entry: PanelEntry<T>, index: number) => "editing" | null | undefined;
  /** Consulted before closing. Returning false vetoes — the panel raises its own confirm. */
  canCloseAt?: (index: number) => boolean;
```

- [ ] **Step 2: Destructure them**

In the function signature, add `showBreadcrumbs = true`, `surfaceLabel`, `accentOf`, and
`canCloseAt` to the destructured props.

- [ ] **Step 3: Make `runClose` consult the guard**

Replace the `runClose` callback (currently lines 79–82) with:

```tsx
  // Closing a panel with focus inside it would drop focus on the document body
  // and lose the tab position. Hand it to whatever panel is on top afterwards.
  // A panel may refuse outright — an unsaved draft raises its own confirm and
  // vetoes, then calls back once the user has answered.
  const runClose = useCallback(
    (index: number, close: () => void, source: HTMLElement | null) => {
      if (canCloseAt && !canCloseAt(index)) return;
      restoreFocusRef.current = source?.contains(document.activeElement) ?? false;
      close();
    },
    [canCloseAt],
  );
```

- [ ] **Step 4: Update the four `runClose` call sites**

Each gains the index of the panel being closed as its first argument.

Escape (in the keydown effect):

```tsx
      event.preventDefault();
      runClose(entries.length - 1, () => onUnwindTo(entries.length - 1), topPanelRef.current);
```

Root crumb (inside the `showBreadcrumbs` block):

```tsx
                  onClick={() => runClose(0, () => onUnwindTo(0), topPanelRef.current)}
```

Intermediate crumb:

```tsx
                          onClick={() =>
                            runClose(index + 1, () => onUnwindTo(index + 1), topPanelRef.current)
                          }
```

Close button:

```tsx
                  onClick={(event) =>
                    runClose(index, () => onCloseAt(index), event.currentTarget.closest("section"))
                  }
```

- [ ] **Step 5: Gate the breadcrumb row and apply the accent**

Change the row's condition from `{entries.length > 0 && (` to:

```tsx
      {showBreadcrumbs && entries.length > 0 && (
```

Give the surface cell its label — replace `aria-label={rootLabel}` on the `<section>` with:

```tsx
          aria-label={surfaceLabel ?? rootLabel}
```

And in the panel `<section>`, replace the `className` with:

```tsx
              className={cn(
                cellClassName,
                "outline-none arkaik-panel-enter",
                accentOf?.(entry, index) === "editing" && "border-dashed border-destructive",
              )}
```

- [ ] **Step 6: Verify it compiles and the app still runs**

Run: `npx tsc --noEmit -p . && npx eslint components/panels/PanelStack.tsx`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add components/panels/PanelStack.tsx
git commit -m "feat: let a panel veto its own close and tint its own border"
```

---

### Task 6: `ProjectPanels` — bind both panel kinds

**Files:**
- Rename: `components/panels/NodeDetailStack.tsx` → `components/panels/ProjectPanels.tsx`

`RawBundlePanel` does not exist until Task 10. This task renders a placeholder for the raw branch
so the file compiles; Task 10 replaces it.

- [ ] **Step 1: Rename**

```bash
git mv components/panels/NodeDetailStack.tsx components/panels/ProjectPanels.tsx
```

- [ ] **Step 2: Rewrite the module**

Replace the contents of `components/panels/ProjectPanels.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelStack } from "@/components/panels/PanelStack";
import { NodeDetailPanel, NodeDetailPanelHeader } from "@/components/panels/NodeDetailPanel";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, JournalEvent, Node } from "@/lib/data/types";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { RAW_PANEL_KEY, type PanelDescriptor } from "@/lib/utils/project-panels";

interface ProjectPanelsProps {
  /** The surface — canvas, board, or list. The grid's first cell. */
  children: ReactNode;
  /** The surface's accessible name. */
  surfaceLabel: string;
  /** The legacy in-body breadcrumb row, for surfaces not yet on PageShell. */
  showBreadcrumbs?: boolean;
  /** The surface's name, for that legacy row's first crumb. */
  rootLabel: string;
  /** Fires when the columns change, so a canvas can re-frame itself. */
  onLayoutChange?: () => void;
  allNodes?: Node[];
  allEdges?: Edge[];
  journal?: JournalEvent[];
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
}

const NO_NODES: Node[] = [];
const NO_EDGES: Edge[] = [];

/**
 * Binds the panel stack to what a panel can be. A node entry resolves its id
 * against the surface's own data and renders `NodeDetailPanel`; the raw entry
 * renders the bundle editor, which needs no surface data at all — which is why
 * pages with no nodes of their own can still host it.
 *
 * Resolving by id rather than holding a node means an edit anywhere reaches
 * every panel showing that node, and a node deleted under the stack takes its
 * panels with it.
 */
export function ProjectPanels({
  children,
  surfaceLabel,
  showBreadcrumbs,
  rootLabel,
  onLayoutChange,
  allNodes = NO_NODES,
  allEdges = NO_EDGES,
  journal,
  onUpdate,
  onDelete,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  onZoomShot,
}: ProjectPanelsProps) {
  const { entries, openNode, closeAt, unwindTo, pruneMissing, panelStates } = useProjectPanels();

  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  // An empty list is the loading window, not a deleted project — pruning then
  // would close a panel restored from `?node=` before its node ever arrived.
  // It is also what every page that passes no nodes at all looks like.
  useEffect(() => {
    if (nodesById.size === 0) return;
    pruneMissing(new Set(nodesById.keys()));
  }, [nodesById, pruneMissing]);

  const labelOf = useCallback(
    (entry: { key: string }) =>
      entry.key === RAW_PANEL_KEY ? "Raw bundle" : nodesById.get(entry.key)?.title ?? entry.key,
    [nodesById],
  );

  const canCloseAt = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return true;
      return panelStates[entry.instanceId]?.canClose?.() ?? true;
    },
    [entries, panelStates],
  );

  return (
    <PanelStack<PanelDescriptor>
      entries={entries}
      surfaceLabel={surfaceLabel}
      showBreadcrumbs={showBreadcrumbs}
      rootLabel={rootLabel}
      onLayoutChange={onLayoutChange}
      labelOf={labelOf}
      accentOf={(entry) => panelStates[entry.instanceId]?.accent}
      canCloseAt={canCloseAt}
      renderHeader={(entry) => {
        if (entry.payload.kind === "raw") return <span className="text-sm font-medium">Raw bundle</span>;

        const node = nodesById.get(entry.key);
        return node ? <NodeDetailPanelHeader node={node} /> : <EntityId id={entry.key} />;
      }}
      renderBody={(entry, index) => {
        if (entry.payload.kind === "raw") return null;

        const node = nodesById.get(entry.key);
        if (!node) return null;

        return (
          <NodeDetailPanel
            node={node}
            initialPlatform={entry.payload.initialPlatform}
            onUpdate={onUpdate}
            onDelete={onDelete}
            allNodes={allNodes}
            allEdges={allEdges}
            journal={journal}
            onNavigate={(target) => openNode({ nodeId: target.id }, index + 1)}
            onCreateNode={onCreateNode}
            onCreateAcceptanceForAnchor={onCreateAcceptanceForAnchor}
            onZoomShot={onZoomShot}
          />
        );
      }}
      onCloseAt={closeAt}
      onUnwindTo={unwindTo}
    >
      {children}
    </PanelStack>
  );
}
```

- [ ] **Step 3: Update the five importers**

In each of `components/maps/JourneyMap.tsx`, `components/maps/SystemMap.tsx`,
`app/project/[id]/library/page.tsx`, `app/project/[id]/delivery/page.tsx`,
`app/project/[id]/acceptances/page.tsx`:

- change the import to `import { ProjectPanels } from "@/components/panels/ProjectPanels";`
- rename the JSX tag `<NodeDetailStack ...>` → `<ProjectPanels ...>` and its closing tag
- add `surfaceLabel={<the same string already passed as rootLabel>}` beside the existing `rootLabel`

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p . && npx eslint components/panels/ProjectPanels.tsx`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: bind the stack to panel kind, not to nodes alone"
```

---

### Task 7: `PageShell`

**Files:**
- Create: `components/layout/PageShell.tsx`

- [ ] **Step 1: Write the implementation**

Create `components/layout/PageShell.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { PageHeader, type PageAction } from "@/components/layout/PageHeader";
import { ProjectPanels } from "@/components/panels/ProjectPanels";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, JournalEvent, Node } from "@/lib/data/types";

interface PageShellProps {
  title: string;
  meta?: ReactNode;
  action?: PageAction;
  /** Right-side header controls, left of the action. */
  headerExtra?: ReactNode;
  /** The surface — canvas, board, list. The panel grid's first cell. */
  children: ReactNode;
  onLayoutChange?: () => void;
  /**
   * Node wiring for the detail panels. Optional: a page that passes none still
   * gets the grid, which is all the raw bundle panel needs.
   */
  allNodes?: Node[];
  allEdges?: Edge[];
  journal?: JournalEvent[];
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
}

/**
 * A project page: the shared header, and the panel grid holding the surface.
 *
 * Every project surface renders exactly one of these, which is what makes the
 * raw bundle reachable from anywhere — the grid it needs is no longer something
 * only five of the ten pages happen to mount.
 */
export function PageShell({
  title,
  meta,
  action,
  headerExtra,
  children,
  onLayoutChange,
  ...panelProps
}: PageShellProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader title={title} meta={meta} action={action}>
        {headerExtra}
      </PageHeader>
      <ProjectPanels
        surfaceLabel={title}
        rootLabel={title}
        showBreadcrumbs={false}
        onLayoutChange={onLayoutChange}
        {...panelProps}
      >
        {children}
      </ProjectPanels>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p . && npx eslint components/layout/PageShell.tsx`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add components/layout/PageShell.tsx
git commit -m "feat: one shell per project page — header plus panel grid"
```

---

### Task 8: Convert the five pages that have no panel wiring

**Files:**
- Modify: `app/project/[id]/overview/page.tsx:107-122`
- Modify: `app/project/[id]/maps/page.tsx:86-139`
- Modify: `app/project/[id]/changelog/page.tsx:132-147`
- Modify: `app/project/[id]/pyramid/page.tsx:75-82`
- Modify: `app/project/[id]/settings/page.tsx:65-72`

Each conversion is the same shape: delete the `<header>` and the wrapping
`<div className="h-full w-full flex flex-col">`, wrap the page body in `<PageShell>`, and drop the
now-unused `SidebarTrigger` / `Separator` imports.

- [ ] **Step 1: Convert the Maps index**

In `app/project/[id]/maps/page.tsx`, replace lines 86–139 (the wrapper div, header, and body div)
with:

```tsx
  return (
    <PageShell
      title="Maps"
      action={{
        label: "New map",
        icon: PlusIcon,
        onClick: () => {
          setEditorTarget(undefined);
          setEditorOpen(true);
        },
      }}
    >
      <div className="h-full overflow-auto p-4 md:p-6">
        <div className="mx-auto grid w-full max-w-5xl gap-4 sm:grid-cols-2">
```

…keeping the existing `maps.map(...)` block unchanged, then closing with:

```tsx
        </div>
      </div>
    </PageShell>
  );
```

The two dialogs (`MapEditorDialog`, `DeleteConfirmDialog`) move to be siblings of `<PageShell>`
inside a `<>...</>` fragment wrapping the whole return.

Swap the imports: remove `Separator` and `SidebarTrigger`, add
`import { PageShell } from "@/components/layout/PageShell";`. `Button` stays only if the body still
uses it — in this file it does not, so remove it too.

- [ ] **Step 2: Verify the Maps index in the browser**

Run the app and open `/project/<id>/maps`. Confirm: no bottom border under the header, the title
reads "Maps", "New map" still opens the editor, and the card grid scrolls.

- [ ] **Step 3: Convert Overview**

Same shape. `title="Overview"`, no action. The version pill (lines 114–121) becomes `headerExtra`:

```tsx
      headerExtra={
        projectBundle?.project.version ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Current version</span>
            <span className="rounded-full border px-2 py-0.5 font-medium text-foreground">
              {projectBundle.project.version}
            </span>
          </div>
        ) : null
      }
```

- [ ] **Step 4: Convert Changelog**

`title="Changelog"`, no action, the same `headerExtra` version pill as Overview.

- [ ] **Step 5: Convert Pyramid**

`title="Value pyramid"`, no action, no extras.

- [ ] **Step 6: Convert Settings**

`title="Settings"`, no action, no extras. The local `title` variable at line 69 is no longer read by
the header — delete it if nothing else uses it, and leave the body's Delete project button alone.

- [ ] **Step 7: Verify all five**

Run: `npx tsc --noEmit -p . && npx eslint app/project/`
Expected: no output

Then open each of the five routes and confirm the header renders with no bottom border.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: put the five panel-less pages on the shared shell"
```

---

### Task 9: Convert Library, Delivery and Acceptances

**Files:**
- Modify: `app/project/[id]/library/page.tsx:247-336`
- Modify: `app/project/[id]/delivery/page.tsx:138-196`
- Modify: `app/project/[id]/acceptances/page.tsx:125-159`

These already render `ProjectPanels`, so the conversion folds that call into `PageShell` — the
node props move across unchanged.

- [ ] **Step 1: Convert Library**

Replace the wrapper div, `<header>` and `<ProjectPanels>` opening tag with:

```tsx
    <PageShell
      title="Library"
      meta={speciesFilter === "all" ? undefined : SPECIES_SUBTITLE_LABELS[speciesFilter]}
      action={{ label: "New node", icon: PlusIcon, onClick: () => setNewNodeOpen(true) }}
      allNodes={dataNodes}
      allEdges={dataEdges}
      journal={journal}
      onUpdate={handleNodeUpdate}
      onCreateNode={handleCreateNodeFromPanel}
    >
```

The body (`<div className="h-full overflow-auto p-4 md:p-6">…`) is unchanged. Close with
`</PageShell>`, and keep `<NewNodeForm>` as a sibling inside a fragment.

- [ ] **Step 2: Convert Delivery**

`title="Delivery"`, action `New node` → `setNewNodeOpen(true)`, and the node props it already
passes to `ProjectPanels`.

- [ ] **Step 3: Convert Acceptances**

`title="Acceptances"`, meta `` `${acceptances.length} total · ${filtered.length} shown` ``, and the
existing `window.prompt` action inlined into `action.onClick` unchanged — including its
`toast.error` path.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p . && npx eslint app/project/`
Expected: no output

Then open each of the three routes, click a node to open a panel, and confirm: the surface does
**not** shift down, and the trail appears on the header's second line.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: put the three list surfaces on the shared shell"
```

---

### Task 10: Convert the two map canvases

**Files:**
- Modify: `components/maps/JourneyMap.tsx:701-776`
- Modify: `components/maps/SystemMap.tsx:253-306`

Riskiest task: both re-frame on `onLayoutChange`, and the Journey header holds four controls.

- [ ] **Step 1: Convert SystemMap**

This is a **move**, not a retype. Read `components/maps/SystemMap.tsx:253-306` first and work from
what is there:

1. Cut the entire prop list from the existing `<ProjectPanels ...>` opening tag **except**
   `rootLabel`, `surfaceLabel` and `onLayoutChange`, and paste it onto a new `<PageShell>` tag.
2. Add `title={definition.title}` and
   `action={{ label: "New node", icon: PlusIcon, onClick: () => setNewNodeOpen(true) }}`.
3. Move `onLayoutChange` across unchanged; drop `rootLabel` and `surfaceLabel` — `PageShell`
   derives both from `title`.
4. Move the header's two right-side controls — the layout `<Select>` block and the
   `<MapDisplayPopover controls={{ viewPlatforms: true }} …>` — into `headerExtra`, wrapped in a
   `<>…</>` fragment, verbatim.
5. Delete the wrapper `<div className="h-full w-full flex flex-col">`, the whole `<header>`, and
   the `<ProjectPanels>` tags. The canvas that was `ProjectPanels`' child becomes `PageShell`'s.

The result opens with `<PageShell title={definition.title} action={…} headerExtra={…}
onLayoutChange={…}` followed by the moved node props, and closes with `</PageShell>`.

- [ ] **Step 2: Verify SystemMap in the browser**

Open `/project/<id>/maps/system`. Confirm the canvas fills its cell, the layout `Select` and
Display popover both work, and opening a node panel re-frames the canvas rather than clipping it.

- [ ] **Step 3: Convert JourneyMap**

Same shape. `title={definition.title}`, action `New node`, `headerExtra` holds the Display popover
and the `playlistError` span. **Delete** the Raw button (733–736), the Export button (737–740), the
`exportError` / warning spans (713–722), the `rawOpen` state (77), and the `<RawBundleSheet>` mount
(769). Leave `handleExport` and the `useKeyboardShortcuts({ onExport })` registration in place —
Task 12 moves them.

- [ ] **Step 4: Verify JourneyMap in the browser**

Open `/project/<id>/maps/journey`. Confirm the canvas renders, Display works, New node works, and
opening a panel re-frames without a content shift.

- [ ] **Step 5: Verify the whole app compiles**

Run: `npx tsc --noEmit -p . && npx eslint components/ app/`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: put the two map canvases on the shared shell"
```

---

### Task 11: Delete the in-body breadcrumb row

Every surface is now on `PageShell`, so the legacy row has no consumer.

**Files:**
- Modify: `components/panels/PanelStack.tsx`
- Modify: `components/panels/ProjectPanels.tsx`
- Modify: `components/layout/PageShell.tsx`

- [ ] **Step 1: Strip `PanelStack`**

Delete the `showBreadcrumbs` and `rootLabel` props from the interface and the signature, delete the
entire `{showBreadcrumbs && entries.length > 0 && (…)}` block, and delete the now-unused
`Breadcrumb*` and `Fragment` imports. Make `surfaceLabel` required and use it directly:
`aria-label={surfaceLabel}`.

- [ ] **Step 2: Strip `ProjectPanels`**

Delete its `showBreadcrumbs` and `rootLabel` props and stop forwarding them.

- [ ] **Step 3: Strip `PageShell`**

Stop passing `rootLabel` and `showBreadcrumbs` to `ProjectPanels`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p . && npx eslint components/`
Expected: no output — any surviving `rootLabel` passer surfaces here as an error

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: retire the breadcrumb row that shifted the page open"
```

---

### Task 12: `RawBundlePanel`

**Files:**
- Rename: `components/panels/RawBundleSheet.tsx` → `components/panels/RawBundlePanel.tsx`
- Modify: `components/panels/ProjectPanels.tsx`

- [ ] **Step 1: Rename**

```bash
git mv components/panels/RawBundleSheet.tsx components/panels/RawBundlePanel.tsx
```

- [ ] **Step 2: Change the props and the state machine's edges**

Replace the props interface and the component signature:

```tsx
interface RawBundlePanelProps {
  projectId: string;
  /** This panel's stack instance, for registering its self-state. */
  instanceId: string;
  /** Close this panel — the stack's `closeAt` for our index. */
  onClose: () => void;
}

export function RawBundlePanel({ projectId, instanceId, onClose }: RawBundlePanelProps) {
```

Delete the `open` prop everywhere it is read. In the load effect, delete the `if (!open) return;`
guard and drop `open` from the dependency array — the panel mounts when it opens, so mounting *is*
the open.

Replace `handleOpenChange` (128–145) with the guard the stack consults:

```tsx
  // The stack asks before closing. Refusing here and raising the confirm is the
  // same contract the Sheet's onOpenChange had, minus the Sheet.
  const canClose = useCallback(() => {
    if (mode === "edit" && hasUnsavedChanges) {
      setPendingClose(true);
      setConfirmCancelOpen(true);
      return false;
    }

    return true;
  }, [hasUnsavedChanges, mode]);

  usePanelSelfState(instanceId, { canClose, accent: mode === "edit" ? "editing" : null });
```

In `handleConfirmCancel`, replace `onOpenChange(false)` with `onClose()`.

Add the import: `import { usePanelSelfState } from "@/lib/hooks/useProjectPanels";`

- [ ] **Step 3: Replace the Sheet chrome with a panel body**

The toolbar stays **inside this component**, as the body's first row, rather than being lifted into
the panel's header slot. That slot is a single left-aligned row sharing space with a fixed close
button — too tight for four controls — and lifting the toolbar would mean lifting `format`, `mode`
and every handler that reads them out of the component that owns them. The panel header gets the
title alone.

Delete `<Sheet>`, `<SheetContent>`, `<SheetHeader>`, `<SheetTitle>`, `<SheetDescription>` and their
import line, and return:

```tsx
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-6 pt-0">
        <div className="flex shrink-0 items-center justify-between gap-2 pt-4">
          {/* the existing JSON / YAML buttons and Edit-or-Cancel/Save block, verbatim */}
        </div>
        {error && (
          <span className="shrink-0 text-xs text-destructive" role="status" aria-live="polite">
            {error}
          </span>
        )}
        <div className="group relative min-h-0 flex-1">
          {/* the existing Copy button, textarea and <pre>, verbatim */}
        </div>
      </div>
      {/* the three DeleteConfirmDialogs, verbatim */}
    </>
  );
```

- [ ] **Step 4: Render it from `ProjectPanels`**

Replace the two raw branches added in Task 6:

```tsx
      renderHeader={(entry) => {
        if (entry.payload.kind === "raw") {
          return <span className="truncate text-sm font-medium">Raw project bundle</span>;
        }

        const node = nodesById.get(entry.key);
        return node ? <NodeDetailPanelHeader node={node} /> : <EntityId id={entry.key} />;
      }}
      renderBody={(entry, index) => {
        if (entry.payload.kind === "raw") {
          return (
            <RawBundlePanel
              projectId={projectId}
              instanceId={entry.instanceId}
              onClose={() => closeAt(index)}
            />
          );
        }
        …
```

`ProjectPanels` needs the project id — add `useParams()` at the top of the component:

```tsx
  const params = useParams();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id ?? "";
```

with `import { useParams } from "next/navigation";`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p . && npx eslint components/panels/`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: the raw bundle becomes a panel instead of a sheet"
```

---

### Task 13: Export and Raw in the project switcher

**Files:**
- Create: `lib/hooks/useProjectExport.ts`
- Modify: `components/layout/ProjectSwitcher.tsx`
- Modify: `components/layout/ProjectSidebar.tsx`
- Modify: `app/project/[id]/layout.tsx`
- Modify: `components/maps/JourneyMap.tsx`

- [ ] **Step 1: Extract the export handler**

Create `lib/hooks/useProjectExport.ts`, lifting the body of `JourneyMap.tsx:597-617`:

```ts
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { downloadJson, exportProject } from "@/lib/utils/export";

/**
 * Export the project bundle to a file. Lives here rather than on a map, because
 * it exports the project — the Journey canvas was only ever where the button
 * happened to sit.
 */
export function useProjectExport(projectId: string) {
  const [exporting, setExporting] = useState(false);

  const exportBundle = useCallback(async () => {
    if (!projectId || exporting) return;

    setExporting(true);
    try {
      const result = await exportProject(projectId);
      downloadJson(result);
      toast.success("Project exported.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown export error";
      toast.error(`Export failed: ${message}`);
    } finally {
      setExporting(false);
    }
  }, [exporting, projectId]);

  return { exportBundle, exporting };
}
```

Read `JourneyMap.tsx:597-617` and `lib/utils/export.ts` first — carry the real `downloadJson`
signature and the `result.warning` handling across rather than the sketch above if they differ.

- [ ] **Step 2: Add both items to the switcher**

In `components/layout/ProjectSwitcher.tsx`, add `onOpenRaw` to the props beside `onOpenPublish`,
call `useProjectExport(currentProjectId)`, and add two items to the project section between Publish
and Settings:

```tsx
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onClick={() => void exportBundle()}
              disabled={exporting}
            >
              <DownloadIcon className="size-4" />
              <span>{exporting ? "Exporting..." : "Export JSON"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2" onClick={onOpenRaw}>
              <Code2Icon className="size-4" />
              <span>Raw bundle</span>
            </DropdownMenuItem>
```

Import `Code2Icon` and `DownloadIcon` from `lucide-react`.

- [ ] **Step 3: Thread `onOpenRaw` through the sidebar**

`ProjectSidebar` takes `onOpenRaw: () => void` and forwards it to `ProjectSwitcher`, exactly as it
does `onOpenPublish`.

- [ ] **Step 4: Wire the layout**

In `app/project/[id]/layout.tsx`, the sidebar lives inside `ProjectPanelsProvider`, so a small inner
component can call `useProjectPanels()`. Extract the subtree below the provider into a
`ProjectChrome` component in the same file, and pass `onOpenRaw={openRaw}` from
`useProjectPanels()`.

Register the export shortcut there too, replacing `JourneyMap.tsx:626-629`:

```tsx
  const { exportBundle } = useProjectExport(id);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isExportShortcut(event)) return;
      event.preventDefault();
      void exportBundle();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [exportBundle]);
```

with `import { isExportShortcut } from "@/lib/utils/keyboard";`.

- [ ] **Step 5: Strip the export leftovers from JourneyMap**

Delete `handleExport`, the `exporting` and `exportError` state, and the
`useKeyboardShortcuts({ onExport })` registration. Leave the rest of that hook's other options in
place if it takes any.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p . && npx eslint components/ app/ lib/ && npm run test:panel-stack && npm run test:project-panels`
Expected: no output from tsc/eslint, both tests pass

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: export and raw move to the project switcher, where the project lives"
```

---

### Task 14: Full verification pass

**Files:** none — this task only runs things.

- [ ] **Step 1: Static checks**

Run: `npx tsc --noEmit -p . && npx eslint . && npm run test:panel-stack && npm run test:project-panels`
Expected: clean

- [ ] **Step 2: Confirm no stragglers**

Run: `grep -rn "NodeDetailStack\|useNodePanels\|RawBundleSheet\|rootLabel" --include="*.tsx" --include="*.ts" app components lib`
Expected: no matches

- [ ] **Step 3: Drive every surface**

Start the dev server and, on each of the ten routes, confirm:

1. The header has no bottom border, and line 1 is the page title, not the project title.
2. Opening a node panel does **not** move the surface, and the trail appears on line 2.
3. The primary action still works.

- [ ] **Step 4: Drive the raw panel**

From the project switcher on **Overview** (a page that had no panel grid before): open Raw bundle.
Confirm it opens as a panel column beside the surface, not an overlay. Click Edit, confirm, type a
character, and confirm the panel's border turns dashed and red. Press Escape and confirm the discard
dialog appears rather than the panel closing. Discard, then confirm the panel closes and the border
is back to normal.

- [ ] **Step 5: Drive export**

From the switcher, click Export JSON and confirm a file downloads and a success toast appears. Then
fire the keyboard shortcut from a non-map page and confirm the same.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: <whatever the pass surfaced>"
```
