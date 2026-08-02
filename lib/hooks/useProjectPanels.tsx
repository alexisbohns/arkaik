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
  /**
   * Asked before this panel is closed — not a pure predicate. Return true to
   * let the close through, or false to veto and *defer*: the panel raises its
   * own confirm and calls `resume` once the user has answered, which finishes
   * the close they originally asked for. A panel that vetoes without ever
   * calling `resume` makes the close silently do nothing, forever.
   */
  requestClose?: (resume: () => void) => boolean;
  /** Visual state of the cell. "editing" draws a dashed destructive border. */
  accent?: "editing" | null;
}

/** What the registry holds: the normalised form of what a panel handed in. */
export interface RegisteredPanelState {
  requestClose: (resume: () => void) => boolean;
  accent: "editing" | null;
}

interface ProjectPanelsValue {
  entries: ProjectPanelEntry[];
  /**
   * The node `?node=` names: the spotlight anchor, and what a cold load or Back
   * restores. *Not* necessarily the top panel — a raw panel sitting above a node
   * panel does not displace the address. For "what is on screen right now", and
   * for anything destructive, use `topPanelNodeId`.
   */
  addressedNodeId: string | null;
  /**
   * The node the topmost panel actually shows, `null` when the top panel is not
   * a node at all. Delete targets this rather than the address: with a raw panel
   * on top, aiming at the address would raise a confirm dialog for a node the
   * user cannot see.
   */
  topPanelNodeId: string | null;
  /**
   * Open a node from a depth. Depth 0 is the surface itself (a canvas, board,
   * or list click); the panel at index `i` is depth `i + 1`.
   */
  openNode: (descriptor: OpenNodeInput, fromDepth?: number) => void;
  /** Open the raw bundle on top of whatever is open, or reveal the one already there. */
  openRaw: () => void;
  closeAt: (index: number) => void;
  unwindTo: (depth: number) => void;
  /**
   * Drop node panels whose node no longer exists — deleted out from under the
   * stack. Non-node panels are not subject to the node lifecycle and always
   * survive, so passing a set of node ids can never evict the raw panel.
   */
  pruneMissingNodes: (existingIds: Set<string>) => void;
  /**
   * What each open panel has told the stack about itself, keyed by `instanceId`
   * rather than `key`. That is load-bearing: it inherits `PanelEntry.instanceId`'s
   * contract, so a *refresh* (the same subject landing back in the same slot)
   * keeps a panel's registered state, while a *swap* (a different subject taking
   * the slot) drops it — an unsaved-draft veto must not outlive the draft and
   * start blocking closes for the entity that replaced it.
   *
   * Typed as possibly-`undefined` per key because it genuinely is for every
   * panel that has not registered — which is all of them until a panel opts in.
   * `tsconfig` has `strict` but not `noUncheckedIndexedAccess`, so without this
   * the compiler would call the lookup always-present and invite someone to
   * delete the `?.` guards that are the only thing keeping closes working.
   */
  panelStates: Record<string, RegisteredPanelState | undefined>;
  /** Registers one panel's self-state; `null` deregisters it on unmount. */
  registerPanelState: (instanceId: string, state: PanelSelfState | null) => void;
}

const ProjectPanelsContext = createContext<ProjectPanelsValue | null>(null);

/**
 * Owns the panel stack for a project: the transitions from
 * `lib/utils/panel-stack.ts`, and the `?node=` contract on top of them.
 *
 * It mounts in `app/project/[id]/layout.tsx` rather than in a page, because a
 * page segment remounts whenever its dynamic params change — which would reset
 * the stack on every navigation. Two of the five surfaces are components
 * rendered inside a page, so a provider in the project layout serves all five
 * without restructuring any route.
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
  const [panelStates, setPanelStates] = useState<Record<string, RegisteredPanelState>>({});

  // An id can arrive without us having published it: a cold load, Back,
  // Forward, a link from elsewhere. Adjusting during render rather than in an
  // effect means the stack and the address are never painted out of step —
  // React discards this pass and re-renders with the reconciled stack.
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
  // layout every single time a panel opened. It reads the route through a ref
  // to stay stable; only `publishTop` needs the route, and only when called.
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

  // Every transition that can close a panel commits through here, so that
  // recomputing the address is not something a future transition can forget to
  // do — the failure mode being a `?node=` left naming a panel that just closed,
  // which a refresh would then faithfully re-open.
  const commitEntries = useCallback(
    (next: ProjectPanelEntry[]) => {
      setEntries(next);

      const nextTop = topNodeKey(next);
      if (nextTop !== urlNodeId) publishTop(nextTop);
    },
    [publishTop, urlNodeId],
  );

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
      commitEntries(closeStackAt(entries, index));
    },
    [commitEntries, entries],
  );

  const unwindTo = useCallback(
    (depth: number) => {
      if (depth >= entries.length) return;
      commitEntries(unwindStackTo(entries, depth));
    },
    [commitEntries, entries],
  );

  // Raw opens on top of the trail rather than collapsing it. Appending cannot
  // change the top node, so it publishes nothing and can stay in the updater
  // form — which is what keeps "at most one raw panel, ever" true even if two
  // opens land in one batch. Revealing a raw panel that is already open can
  // close node panels above it, so that path goes through `unwindTo`, which
  // recomputes the address.
  const openRaw = useCallback(() => {
    const existing = entries.findIndex((entry) => entry.key === RAW_PANEL_KEY);
    if (existing >= 0) {
      unwindTo(existing + 1);
      return;
    }

    setEntries((previous) =>
      previous.some((entry) => entry.key === RAW_PANEL_KEY)
        ? previous
        : openFrom<PanelDescriptor>(previous, previous.length, RAW_PANEL_KEY, { kind: "raw" }),
    );
  }, [entries, unwindTo]);

  const pruneMissingNodes = useCallback(
    (existingIds: Set<string>) => {
      const next = pruneNodeEntries(entries, existingIds);
      if (next === entries) return;

      commitEntries(next);
    },
    [commitEntries, entries],
  );

  const registerPanelState = useCallback((instanceId: string, state: PanelSelfState | null) => {
    setPanelStates((previous) => {
      if (state === null) {
        if (!(instanceId in previous)) return previous;
        const next = { ...previous };
        delete next[instanceId];
        return next;
      }

      // Normalised on the way in, so every reader gets the same shape and
      // `RegisteredPanelState` stays an honest description of what is stored.
      return {
        ...previous,
        [instanceId]: {
          requestClose: state.requestClose ?? (() => true),
          accent: state.accent ?? null,
        },
      };
    });
  }, []);

  const value = useMemo<ProjectPanelsValue>(() => {
    const top = entries[entries.length - 1];

    return {
      entries,
      addressedNodeId: topNodeKey(entries),
      topPanelNodeId: top && isNodeEntry(top) ? top.key : null,
      openNode,
      openRaw,
      closeAt,
      unwindTo,
      pruneMissingNodes,
      panelStates,
      registerPanelState,
    };
  }, [
    closeAt,
    entries,
    openNode,
    openRaw,
    panelStates,
    pruneMissingNodes,
    registerPanelState,
    unwindTo,
  ]);

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
 * Register what this panel wants the stack to know about it.
 *
 * `requestClose` is read through a ref that an effect keeps current, rather than one
 * written during render: a render pass can be discarded and replayed, so a
 * render-phase write can latch a value from a pass that was never committed —
 * and this very file discards a pass every time it reconciles an arriving
 * `?node=`. Going through the ref is also what lets a closure that changes on
 * every render avoid re-registering on every render. `accent` is a primitive, so
 * it drives re-registration directly.
 */
export function usePanelSelfState(instanceId: string, state: PanelSelfState): void {
  const { registerPanelState } = useProjectPanels();
  const accent = state.accent ?? null;

  const requestCloseRef = useRef(state.requestClose);

  useEffect(() => {
    requestCloseRef.current = state.requestClose;
  });

  useEffect(() => {
    registerPanelState(instanceId, {
      requestClose: (resume) => requestCloseRef.current?.(resume) ?? true,
      accent,
    });

    return () => registerPanelState(instanceId, null);
  }, [accent, instanceId, registerPanelState]);
}
