"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { PLATFORM_IDS, STATUS_IDS, VALUE_IDS } from "@arkaik/schema";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";
import { EMPTY_FILTERS } from "@/lib/utils/acceptance-matrix";

export { EMPTY_FILTERS } from "@/lib/utils/acceptance-matrix";
export type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";

const KEYS = ["search", "platform", "status", "value", "anchor", "parity_gap"] as const;

function oneOf<T extends string>(value: string | null, allowed: readonly string[]): T | "all" {
  return value && allowed.includes(value) ? (value as T) : "all";
}

/**
 * `product` is deliberately absent from `KEYS` and always read back as `null`.
 *
 * There *is* a `?product=` param since #315 — the per-surface override — but it
 * is not an acceptance filter and this module must not touch it. Two
 * consequences, both wanted: the page layers the live scope on top of what this
 * returns (`useEffectiveProduct` owns the param), and "Clear filters", which
 * deletes every key in `KEYS`, leaves the override alone. Narrowing to one app
 * is a scope, not a filter, and clearing a search box must not silently widen
 * the surface back out.
 */
function readFilters(params: URLSearchParams): AcceptanceFilters {
  return {
    search: params.get("search") ?? "",
    platform: oneOf(params.get("platform"), PLATFORM_IDS),
    status: oneOf(params.get("status"), STATUS_IDS),
    value: oneOf(params.get("value"), VALUE_IDS),
    anchor: params.get("anchor") || "all",
    parityGap: params.get("parity_gap") === "1",
    product: null,
  };
}

/** URL-persisted acceptance filters. `setFilters` replaces the URL (no history push, no scroll). */
export function useAcceptanceFilters(): {
  filters: AcceptanceFilters;
  setFilters: (next: AcceptanceFilters) => void;
  reset: () => void;
} {
  const writeQuery = useQueryWriter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readFilters(new URLSearchParams(searchParams.toString())), [searchParams]);

  // Writes through `useQueryWriter`, which reads the live query at call time.
  // Rebuilding from the closed-over `searchParams` would drop a `?product=`
  // written by `useProductOverride` since this render — same bar, second writer.
  // Only `KEYS` are touched, so anything else on the URL survives untouched.
  const setFilters = useCallback(
    (next: AcceptanceFilters) => {
      writeQuery((params) => {
        for (const key of KEYS) params.delete(key);
        if (next.search) params.set("search", next.search);
        if (next.platform !== "all") params.set("platform", next.platform);
        if (next.status !== "all") params.set("status", next.status);
        if (next.value !== "all") params.set("value", next.value);
        if (next.anchor !== "all") params.set("anchor", next.anchor);
        if (next.parityGap) params.set("parity_gap", "1");
      });
    },
    [writeQuery],
  );

  const reset = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters]);
  return { filters, setFilters, reset };
}
