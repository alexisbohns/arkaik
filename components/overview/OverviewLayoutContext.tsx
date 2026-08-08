"use client";

import { createContext, useContext } from "react";
import type { OverviewLayout } from "@/lib/hooks/useOverviewLayout";

/**
 * Which display the Overview is drawing, read by `OverviewSection` to pick a
 * shell — and by the two cards whose *body* differs between the displays.
 *
 * A context rather than a prop threaded through nine cards: the seven whose
 * body is identical in both displays would otherwise take a prop they never
 * read, purely to hand it to their shell. `"grid"` is the default so a card
 * rendered outside the provider (a test, a future surface) still draws.
 */
const OverviewLayoutContext = createContext<OverviewLayout>("grid");

export const OverviewLayoutProvider = OverviewLayoutContext.Provider;

export function useOverviewLayoutContext(): OverviewLayout {
  return useContext(OverviewLayoutContext);
}
