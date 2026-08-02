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

  // Raw opens on top of the trail rather than collapsing it. Appending cannot
  // change the top node, so it publishes nothing; revealing a raw panel that is
  // already open can close node panels above it, so that path goes through
  // `unwindTo`, which recomputes the address — otherwise `?node=` would keep
  // naming a panel the reveal just closed, and a refresh would re-open it.
  const openRaw = useCallback(() => {
    const existing = entries.findIndex((entry) => entry.key === RAW_PANEL_KEY);
    if (existing >= 0) {
      unwindTo(existing + 1);
      return;
    }

    setEntries((previous) =>
      openFrom<PanelDescriptor>(previous, previous.length, RAW_PANEL_KEY, { kind: "raw" }),
    );
  }, [entries, unwindTo]);

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
 * through a ref — kept current by an effect, since writing one during render is
 * what makes a component miss its own update — so a closure that changes every
 * render does not re-register every render. `accent` is a primitive and drives
 * re-registration directly.
 */
export function usePanelSelfState(instanceId: string, state: PanelSelfState): void {
  const { registerPanelState } = useProjectPanels();
  const accent = state.accent ?? null;

  const canCloseRef = useRef(state.canClose);

  useEffect(() => {
    canCloseRef.current = state.canClose;
  });

  useEffect(() => {
    registerPanelState(instanceId, {
      canClose: () => canCloseRef.current?.() ?? true,
      accent,
    });

    return () => registerPanelState(instanceId, null);
  }, [accent, instanceId, registerPanelState]);
}
