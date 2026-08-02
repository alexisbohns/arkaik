"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ProductDefinition } from "@arkaik/schema";
import type { ProjectBundle } from "@/lib/data/types";
import {
  getProductScopeId,
  setProductScopeId,
  subscribeProductScope,
} from "@/lib/utils/product-scope-store";
import { resolveProductScope, type ProductScope } from "@/lib/utils/product-scope";

/**
 * The global product scope, persisted per project in localStorage.
 *
 * Not a URL param on purpose: the scope spans every route under
 * /project/[id], so a query param would have to be threaded through all of
 * them while fighting the existing `species` / `panel` param handling in
 * app/project/[id]/layout.tsx. The trade-off — a shared link does not carry
 * scope — is fine, because a link to a node is about the node.
 *
 * The value lives in lib/utils/product-scope-store.ts, not in this hook. The
 * sidebar selector and every surface both call in here, and they have to see
 * the same value: per-hook `useState` would give each its own copy, and the
 * selector would be the only thing that ever moved.
 *
 * `getServerSnapshot` is `null` (All products) because localStorage does not
 * exist during SSR. React renders that during hydration and re-reads the real
 * store immediately after, so there is no mismatch. Nothing visibly flashes
 * either, for a reason that has nothing to do with this hook: `useProject`
 * loads the bundle in an effect, so `project` is `undefined` on the server
 * *and* on the client's first render, and with no products declared
 * `productPlatforms` short-circuits to every platform — so every field of the
 * resolved scope except `productId` is identical across that boundary whatever
 * localStorage held.
 */
export function useProductScope(projectId: string) {
  const productId = useSyncExternalStore(
    subscribeProductScope,
    () => getProductScopeId(projectId),
    () => null,
  );

  const setScope = useCallback((next: string | null) => setProductScopeId(projectId, next), [projectId]);

  return { productId, setScope };
}

/**
 * What every surface calls — never `useProductScope` directly.
 *
 * Today this is the global scope, resolved against the project. The deferred
 * per-surface override milestone changes exactly this function to
 * `override ?? global`, which is why no surface may read the global value
 * itself.
 *
 * Memoized because the result carries a `Map` and feeds the `useMemo`
 * dependency lists of the scoped projections on Acceptances, Pyramid, and
 * Delivery. An object rebuilt every render would defeat every one of them.
 */
export function useEffectiveProduct(
  projectId: string,
  project: ProjectBundle | undefined,
): ProductScope & { setScope: (next: string | null) => void } {
  const { productId, setScope } = useProductScope(projectId);
  const scope = useMemo(() => resolveProductScope(project, productId), [project, productId]);
  return useMemo(() => ({ ...scope, setScope }), [scope, setScope]);
}

/**
 * The project's declared products as an array, in declaration order — what the
 * create forms hand to `ProductPicker`.
 *
 * A one-liner with a hook around it, because the alternative is the same
 * `[...scope.productsById.values()]` written at every surface that can create a
 * node: the array identity feeds a dialog's props, so an unmemoized spread hands
 * it a new array on every render of the page behind it, and the memo is only
 * correct if its dependency is `productsById` rather than `scope` (which
 * `useEffectiveProduct` rebuilds whenever `setScope` changes identity).
 *
 * Empty when the project declares no products, which is the value every caller
 * guards on to render nothing at all — the degenerate-case guarantee.
 */
export function useProductList(scope: ProductScope): ProductDefinition[] {
  return useMemo(() => [...scope.productsById.values()], [scope.productsById]);
}
