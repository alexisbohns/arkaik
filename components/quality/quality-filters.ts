"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  FINDING_PRIORITIES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  type FindingPriority,
  type FindingSeverity,
  type FindingStatus,
} from "@arkaik/schema";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import { EMPTY_QUALITY_FILTERS, parseCellKey } from "@/lib/utils/quality";
import type { QualityFilters, QualitySort } from "@/lib/utils/quality";

export { EMPTY_QUALITY_FILTERS } from "@/lib/utils/quality";
export type { QualityFilters, QualitySort } from "@/lib/utils/quality";

const KEYS = ["search", "severity", "surface", "priority", "domain", "status", "cell", "sort"] as const;

/**
 * The sort axes, in menu order. Exported because `QualityFilterBar` renders
 * exactly this list: a second copy there would be a menu free to offer an order
 * this module refuses to read back off the URL.
 */
export const QUALITY_SORTS: readonly QualitySort[] = ["severity", "priority", "surface", "domain"];

/**
 * A closed-set param, or `"all"` for anything else — including the value being
 * absent, or a stale id a pack no longer defines. `"all"` is the one word this
 * whole module uses for "do not narrow on this"; see `filterFindings`, which
 * treats `""` identically, and note that a filter value of `""` is therefore
 * never meaningful. In particular `domain: ""` — which is what a finding whose
 * `criterion_id` the pack does not define carries — selects everything, not the
 * orphans. Isolating those would need a sentinel of its own, the way
 * `lib/utils/acceptance-matrix.ts` has `UNANCHORED_FILTER`, and nothing asks
 * for one yet.
 */
function oneOf<T extends string>(value: string | null, allowed: readonly string[]): T | "all" {
  return value && allowed.includes(value) ? (value as T) : "all";
}

/** The sort axis, the one param whose "nothing set" value is not `"all"`. */
function sortOf(value: string | null): QualitySort {
  const allowed: readonly string[] = QUALITY_SORTS;
  return value !== null && allowed.includes(value) ? (value as QualitySort) : EMPTY_QUALITY_FILTERS.sort;
}

/**
 * `criterion` and `csurface` are deliberately absent from `KEYS`, exactly as
 * `product` is absent from `useAcceptanceFilters`'.
 *
 * The Quality page owns both — they address the criterion panel in the shared
 * stack, and the page syncs them itself through the same `useQueryWriter`. Two
 * consequences, both wanted: this module never touches a panel's address, and
 * "Clear filters", which deletes every key in `KEYS`, leaves an open panel
 * open. Reading a criterion is not a filter, and emptying a search box must not
 * shut the thing you were reading while you searched.
 */
function readFilters(params: URLSearchParams): QualityFilters {
  const cell = params.get("cell");

  return {
    search: params.get("search") ?? "",
    severity: oneOf<FindingSeverity>(params.get("severity"), FINDING_SEVERITIES),
    // Surfaces and domains are the profile's and the pack's, not a constant, so
    // there is no set to validate against here. An id neither of them names
    // narrows to nothing, which is the honest answer: the URL asked for a
    // surface this project does not have.
    surface: params.get("surface") || "all",
    priority: oneOf<FindingPriority>(params.get("priority"), FINDING_PRIORITIES),
    domain: params.get("domain") || "all",
    status: oneOf<FindingStatus>(params.get("status"), FINDING_STATUSES),
    // Validated through the parser the matrix encodes with, so a hand-typed
    // `?cell=SEC` — which `filterFindings` would ignore — cannot leave the bar
    // showing a dismissible chip for a cell that is narrowing nothing.
    cell: parseCellKey(cell) ? cell : null,
    sort: sortOf(params.get("sort")),
  };
}

/** URL-persisted findings filters. `setFilters` replaces the URL (no history push, no scroll). */
export function useQualityFilters(): {
  filters: QualityFilters;
  setFilters: (next: QualityFilters) => void;
  reset: () => void;
} {
  const writeQuery = useQueryWriter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readFilters(new URLSearchParams(searchParams.toString())), [searchParams]);

  // Writes through `useQueryWriter`, which reads the live query at call time.
  // Rebuilding from the closed-over `searchParams` would drop a `?criterion=`
  // written by the page since this render — same URL, second writer. Only
  // `KEYS` are touched, so the panel's address survives untouched.
  const setFilters = useCallback(
    (next: QualityFilters) => {
      writeQuery((params) => {
        for (const key of KEYS) params.delete(key);
        if (next.search) params.set("search", next.search);
        if (next.severity !== "all") params.set("severity", next.severity);
        if (next.surface !== "all") params.set("surface", next.surface);
        if (next.priority !== "all") params.set("priority", next.priority);
        if (next.domain !== "all") params.set("domain", next.domain);
        if (next.status !== "all") params.set("status", next.status);
        if (next.cell) params.set("cell", next.cell);
        // The default sort is the one thing here with a value other than "all",
        // so it is written only when it is not the default — a URL that says
        // nothing about sorting is the same URL as one that asks for the
        // default, and shared links should not carry the difference.
        if (next.sort !== EMPTY_QUALITY_FILTERS.sort) params.set("sort", next.sort);
      });
    },
    [writeQuery],
  );

  const reset = useCallback(() => setFilters(EMPTY_QUALITY_FILTERS), [setFilters]);
  return { filters, setFilters, reset };
}
