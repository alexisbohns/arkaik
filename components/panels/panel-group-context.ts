import { createContext, useContext } from "react";

/**
 * Whether the subtree is inside a {@link PanelGroup}.
 *
 * Its own module, and not a `createContext` at the top of `PanelGroup.tsx`,
 * because `PanelGroup` imports `PANEL_GUTTER` from `PanelSection` and
 * `PanelSection` reads this context — as one module that is an import cycle,
 * and Next's client bundler resolves cycles by handing one side an undefined
 * binding at module-evaluation time, which shows up as a heading that is
 * sometimes `h3` and sometimes `h4` depending on which file the bundler
 * reached first.
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
