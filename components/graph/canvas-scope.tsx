"use client";

import { createContext, useContext, type ReactNode } from "react";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { ProductScope } from "@/lib/utils/product-scope";

/** Every configured platform — the unscoped menu, as a stable reference. */
const ALL_PLATFORMS: readonly PlatformId[] = PLATFORMS.map((platform) => platform.id);

/**
 * The product scope, as seen by a React Flow node component.
 *
 * Node components are rendered by React Flow from a `nodeTypes` map and receive
 * only their `data` payload, so a canvas card cannot be handed a prop the way
 * `NodeCard` or `PyramidElementCard` can. The two honest options were to bake
 * the scope into every node's `data` in the graph builders — which would make
 * the whole graph rebuild on a scope change, and put a display concern in two
 * traversal modules — or to publish it once around the canvas. This is the
 * second.
 *
 * The **whole scope** rather than just its platform menu, because the two
 * questions a card asks are different. A flow's gauge list is a *shape*
 * question — how many tracks does this surface draw — and reads the menu. A
 * view's chips are a per-node fact — what does this view actually ship on — and
 * read `scopedPlatforms(node, scope)`, which intersects against the node's
 * **own** product's menu. Under All products the two answers diverge: the menu
 * is the union of every product, so a web-only admin view carrying a stale
 * three-platform array keeps claiming Android against the menu and loses it
 * against its own product. That divergence is the delivery bug the whole
 * feature exists to fix, and Library and Delivery already resolve it this way.
 *
 * It is **not** a global: `Canvas` takes `scope` as a prop and provides it.
 * Nothing here reads `useProductScope`, so the deferred per-surface-override
 * milestone stays a different argument at the map, not a different code path.
 *
 * With no provider (or no scope) the menu defaults to every configured
 * platform — exactly what `productPlatforms` returns for a project that
 * declares no products — and the per-node answer degrades to the node's own
 * array, so a canvas rendered without a scope behaves precisely as it did
 * before scopes existed.
 */
const CanvasScopeContext = createContext<ProductScope | null>(null);

export function CanvasScopeProvider({
  scope,
  children,
}: {
  scope?: ProductScope;
  children: ReactNode;
}) {
  // The identity matters — it is the context value, so a fresh object would
  // re-render every card on the canvas. `useEffectiveProduct` already memoizes
  // the scope it hands out, and `null` is a constant.
  return <CanvasScopeContext.Provider value={scope ?? null}>{children}</CanvasScopeContext.Provider>;
}

/** The scope's platform menu for the canvas this node is drawn on. */
export function useCanvasScopePlatforms(): readonly PlatformId[] {
  return useContext(CanvasScopeContext)?.platforms ?? ALL_PLATFORMS;
}

/** The scope itself, for the per-node questions the menu cannot answer. */
export function useCanvasProductScope(): ProductScope | null {
  return useContext(CanvasScopeContext);
}
