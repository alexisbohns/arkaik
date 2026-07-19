"use client";

import { useEffect } from "react";

import { wireBoil } from "@/lib/wobble/boil";

/**
 * Wires the icon-wobble "boil" driver once for the app shell (issue #271).
 * Renders nothing — a pure side-effect leaf, the same shape as `SyncProvider`
 * and `AppToaster`. All hover/focus animation lives in `lib/wobble/boil.ts`;
 * this just attaches it on mount and tears it down on unmount (idempotent under
 * React Strict Mode's dev double-invoke, since each mount re-wires cleanly).
 */
export function WobbleBoil() {
  useEffect(() => wireBoil(), []);
  return null;
}
