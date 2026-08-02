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
import type { PlatformId } from "@/lib/config/platforms";
import {
  closeAt as closeStackAt,
  initStack,
  openFrom,
  reconcileArrival,
  unwindTo as unwindStackTo,
  type PanelEntry,
} from "@/lib/utils/panel-stack";

/** The search param that addresses the top panel, on whatever route you're on. */
export const NODE_PANEL_PARAM = "node";

export interface NodePanelDescriptor {
  nodeId: string;
  /** Platform tab the variants section opens on — the Delivery board's column. */
  initialPlatform?: PlatformId;
}

export type NodePanelEntry = PanelEntry<NodePanelDescriptor>;

interface NodePanelsValue {
  entries: NodePanelEntry[];
  /** The node the URL addresses: the spotlight anchor, and Delete's target. */
  topNodeId: string | null;
  /**
   * Open a node from a depth. Depth 0 is the surface itself (a canvas, board,
   * or list click); the panel at index `i` is depth `i + 1`.
   */
  openNode: (descriptor: NodePanelDescriptor, fromDepth?: number) => void;
  closeAt: (index: number) => void;
  unwindTo: (depth: number) => void;
  /** Drop panels whose node no longer exists — deleted out from under the stack. */
  pruneMissing: (existingIds: Set<string>) => void;
}

const NodePanelsContext = createContext<NodePanelsValue | null>(null);

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
 * The URL addresses the top panel only. Everything below it is exploration
 * history, not an address. User actions publish the new top themselves, and
 * `reconcileArrival` handles the arrivals nobody published — a cold load, Back,
 * Forward — where the id comes with no intent attached.
 */
export function NodePanelsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlNodeId = searchParams.get(NODE_PANEL_PARAM);

  const [entries, setEntries] = useState<NodePanelEntry[]>(initStack<NodePanelDescriptor>);
  const [addressed, setAddressed] = useState<string | null>(null);

  // An id can arrive without us having published it: a cold load, Back,
  // Forward, a link from elsewhere. Adjusting during render rather than in an
  // effect means the stack and the address are never painted out of step —
  // React discards this pass and re-renders with the reconciled stack.
  if (urlNodeId !== addressed) {
    setAddressed(urlNodeId);
    setEntries((previous) => reconcileArrival(previous, urlNodeId, { nodeId: urlNodeId ?? "" }));
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

  const openNode = useCallback(
    (descriptor: NodePanelDescriptor, fromDepth = 0) => {
      setEntries((previous) => {
        // The Delivery board opens a node on a platform; following a reference
        // out of that panel stays on the platform you were reading.
        const initialPlatform =
          descriptor.initialPlatform ?? previous[fromDepth - 1]?.payload.initialPlatform;

        return openFrom(previous, fromDepth, descriptor.nodeId, {
          nodeId: descriptor.nodeId,
          initialPlatform,
        });
      });

      publishTop(descriptor.nodeId);
    },
    [publishTop],
  );

  const closeAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= entries.length) return;

      setEntries((previous) => closeStackAt(previous, index));

      // Closing below the top leaves the address alone — the top is unchanged.
      if (index === entries.length - 1) {
        publishTop(entries[index - 1]?.key ?? null);
      }
    },
    [entries, publishTop],
  );

  const unwindTo = useCallback(
    (depth: number) => {
      if (depth >= entries.length) return;

      setEntries((previous) => unwindStackTo(previous, depth));
      publishTop(entries[depth - 1]?.key ?? null);
    },
    [entries, publishTop],
  );

  const pruneMissing = useCallback(
    (existingIds: Set<string>) => {
      const next = entries.filter((entry) => existingIds.has(entry.key));
      if (next.length === entries.length) return;

      setEntries(next);
      const nextTop = next[next.length - 1]?.key ?? null;
      if (nextTop !== urlNodeId) publishTop(nextTop);
    },
    [entries, publishTop, urlNodeId],
  );

  const value = useMemo<NodePanelsValue>(
    () => ({
      entries,
      topNodeId: entries[entries.length - 1]?.key ?? null,
      openNode,
      closeAt,
      unwindTo,
      pruneMissing,
    }),
    [closeAt, entries, openNode, pruneMissing, unwindTo],
  );

  return <NodePanelsContext.Provider value={value}>{children}</NodePanelsContext.Provider>;
}

export function useNodePanels(): NodePanelsValue {
  const value = useContext(NodePanelsContext);

  if (!value) {
    throw new Error("useNodePanels must be used inside a NodePanelsProvider (app/project/[id]/layout.tsx)");
  }

  return value;
}
