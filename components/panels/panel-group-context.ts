import { createContext, useContext } from "react";

/**
 * Whether the subtree is inside a {@link PanelGroup}.
 *
 * Its own module, and not a `createContext` at the top of `PanelGroup.tsx`,
 * because `PanelGroup` imports `PANEL_GUTTER` from `PanelSection` and
 * `PanelSection` reads this context: folded into one module those two imports
 * form a cycle. What a cycle costs here is not worth finding out empirically —
 * a module-scope `createContext` read across one is exactly the binding that
 * can be hit before it is initialised, and the failure lands as a throw or a
 * `useContext(undefined)` somewhere in the panel tree rather than anywhere near
 * the edit that caused it. Splitting the context out means the cycle never
 * exists, which is cheaper than reasoning about it.
 *
 * The alternative considered: move `PANEL_GUTTER` into a token module of its
 * own, which dissolves the cycle at its other end and would let the context live
 * beside `PanelGroup`. A defensible cut, declined because it churns six files
 * that import the gutter today for no change in behaviour.
 *
 * `false` is the honest default: a `PanelSection` rendered outside any group —
 * which is every call site in `CriterionDetailPanel` and `CellDetailPanel` —
 * is a level-three section of the record, exactly as it was before groups
 * existed.
 */
export const PanelGroupContext = createContext(false);

/** True inside a `PanelGroup`, and the reason a nested section heads at `h4`. */
export function useInPanelGroup(): boolean {
  return useContext(PanelGroupContext);
}
