"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import type { ProductDefinition } from "@arkaik/schema";
import type { ProjectBundle } from "@/lib/data/types";
import {
  getProductScopeId,
  setProductScopeId,
  subscribeProductScope,
} from "@/lib/utils/product-scope-store";
import {
  canOverrideProduct,
  PRODUCT_OVERRIDE_PARAM,
  resolveEffectiveProductId,
  resolveProductScope,
  type ProductScope,
} from "@/lib/utils/product-scope";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";

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
 *
 * The per-surface override added in #315 *is* a URL param — `?product=` on the
 * surface's own route — and does not contradict this. The objection above is
 * that the global scope spans every route; the override does not, which is what
 * makes it per-surface. See `resolveEffectiveProductId`.
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
 * The shell's global scope, narrowed by the surface's own `?product=` override
 * when it has one. The precedence and the validation are
 * `resolveEffectiveProductId`'s, written once and testable;
 * nothing about the rule lives here.
 *
 * **It reads the URL itself rather than taking the override as an argument, and
 * that is load-bearing.** `DeliveryFilterBar`, `AcceptanceFilterBar` and
 * `AcceptanceMatrix` each call this hook themselves rather than taking their
 * page's scope as a prop. An override that reached the page but not the bar
 * would leave the board filtered to Admin while the bar still offered the union
 * platform menu — a disagreement with no crash and no visible cause. One URL
 * read from one hook makes that unrepresentable. The cost is that a hand-typed
 * `?product=` also applies on Overview and the maps, where no control offers it;
 * it is reachable only by editing the URL, since the param is produced by four
 * controls and dropped by navigation.
 *
 * Memoized because the result carries a `Map` and feeds the `useMemo`
 * dependency lists of the scoped projections on Acceptances, Pyramid, and
 * Delivery. An object rebuilt every render would defeat every one of them.
 */
export function useEffectiveProduct(
  projectId: string,
  project: ProjectBundle | undefined,
): ProductScope & { setScope: (next: string | null) => void } {
  const { productId: globalId, setScope } = useProductScope(projectId);
  const searchParams = useSearchParams();
  const productId = resolveEffectiveProductId(project, globalId, searchParams.get(PRODUCT_OVERRIDE_PARAM));
  const scope = useMemo(() => resolveProductScope(project, productId), [project, productId]);
  return useMemo(() => ({ ...scope, setScope }), [scope, setScope]);
}

/**
 * The per-surface override's **write** side, and the only hook that has one.
 *
 * Read/write split on purpose: every surface reads the override through
 * `useEffectiveProduct` (which is why it cannot diverge), and only the four
 * controls in `ProductOverrideSelector` may move it.
 *
 * `setOverride` touches only its own key, so `species`, `panel` and the
 * acceptance filters survive a scope change; and All products **deletes** the
 * key rather than writing a sentinel, so the absence of an override is the
 * absence of a param. It writes through `useQueryWriter`, which reads the live
 * query at call time — the acceptance bar's debounced search is a second,
 * independent writer on the same surface, and a base captured at render time
 * would drop whichever of the two wrote last. `replace` (not `push`) with
 * `scroll: false` is that hook's too — narrowing a surface is not a navigation
 * and must not eat the back button.
 *
 * `overrideId` is what the control should display. It is `null` — All products —
 * whenever the surface may not override at all, or the param is absent, blank,
 * unrecognised, or overruled by a named global scope, because a trigger that
 * echoed a value the surface is not actually using would be the one thing on
 * screen lying about the content beneath it.
 */
export function useProductOverride(
  projectId: string,
  project: ProjectBundle | undefined,
): { canOverride: boolean; overrideId: string | null; setOverride: (next: string | null) => void } {
  const writeQuery = useQueryWriter();
  const searchParams = useSearchParams();
  const { productId: globalId } = useProductScope(projectId);

  const canOverride = canOverrideProduct(project, globalId);
  // Gated on `canOverride`, so the name is honest: this is the override in
  // effect, not "whatever `resolveEffectiveProductId` returned". Ungated it
  // would carry the *global* id under a named scope — correct for the scope,
  // wrong for a field called `overrideId`, and a trap for any caller that reads
  // it without checking `canOverride` first.
  const overrideId = canOverride
    ? resolveEffectiveProductId(project, globalId, searchParams.get(PRODUCT_OVERRIDE_PARAM))
    : null;

  const setOverride = useCallback(
    (next: string | null) => {
      writeQuery((params) => {
        if (next === null) params.delete(PRODUCT_OVERRIDE_PARAM);
        else params.set(PRODUCT_OVERRIDE_PARAM, next);
      });
    },
    [writeQuery],
  );

  return { canOverride, overrideId, setOverride };
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
