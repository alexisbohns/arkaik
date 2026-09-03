"use client";

import type { ReactNode } from "react";
import { OverviewLayoutProvider } from "@/components/overview/OverviewLayoutContext";

/**
 * The one client leaf `OverviewCardsPreview` needs: a context provider cannot
 * be rendered from a server component, so this thin wrapper sets the grid
 * layout and hands the cards through. No data, no state.
 */
export function OverviewGridLayout({ children }: { children: ReactNode }) {
  return <OverviewLayoutProvider value="grid">{children}</OverviewLayoutProvider>;
}
