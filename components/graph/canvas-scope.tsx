"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";

/** Every configured platform — the unscoped menu, as a stable reference. */
const ALL_PLATFORMS: readonly PlatformId[] = PLATFORMS.map((platform) => platform.id);

/**
 * The product scope's platform menu, as seen by a React Flow node component.
 *
 * Node components are rendered by React Flow from a `nodeTypes` map and receive
 * only their `data` payload, so a canvas card cannot be handed a prop the way
 * `NodeCard` or `PyramidElementCard` can. The two honest options were to bake
 * the menu into every node's `data` in the graph builders — which would make the
 * whole graph rebuild on a scope change, and put a display concern in two
 * traversal modules — or to publish it once around the canvas. This is the
 * second.
 *
 * It is **not** a global: `Canvas` takes `scopePlatforms` as a prop and provides
 * it. Nothing here reads `useProductScope`, so the deferred per-surface-override
 * milestone stays a different argument at the map, not a different code path.
 *
 * The default is every configured platform, which is exactly what
 * `productPlatforms` returns for a project that declares no products — so a
 * canvas rendered without a provider behaves precisely as it did before scopes
 * existed.
 */
const CanvasScopeContext = createContext<readonly PlatformId[]>(ALL_PLATFORMS);

export function CanvasScopeProvider({
  platforms,
  children,
}: {
  platforms?: readonly PlatformId[];
  children: ReactNode;
}) {
  // The identity matters — it is the context value, so a fresh array would
  // re-render every card on the canvas. `useEffectiveProduct` already memoizes
  // the scope it hands out; this only keeps the `undefined` case stable too.
  const value = useMemo(() => platforms ?? ALL_PLATFORMS, [platforms]);
  return <CanvasScopeContext.Provider value={value}>{children}</CanvasScopeContext.Provider>;
}

/** The scope's platform menu for the canvas this node is drawn on. */
export function useCanvasScopePlatforms(): readonly PlatformId[] {
  return useContext(CanvasScopeContext);
}
