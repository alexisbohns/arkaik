"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";
import { EMPTY_FILTERS } from "@/lib/utils/acceptance-matrix";

export { EMPTY_FILTERS } from "@/lib/utils/acceptance-matrix";
export type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";

const KEYS = ["search", "platform", "status", "value", "anchor", "parity_gap"] as const;

function readFilters(params: URLSearchParams): AcceptanceFilters {
  return {
    search: params.get("search") ?? "",
    platform: (params.get("platform") as AcceptanceFilters["platform"]) || "all",
    status: (params.get("status") as AcceptanceFilters["status"]) || "all",
    value: (params.get("value") as AcceptanceFilters["value"]) || "all",
    anchor: params.get("anchor") || "all",
    parityGap: params.get("parity_gap") === "1",
  };
}

/** URL-persisted acceptance filters. `setFilters` replaces the URL (no history push, no scroll). */
export function useAcceptanceFilters(): {
  filters: AcceptanceFilters;
  setFilters: (next: AcceptanceFilters) => void;
  reset: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readFilters(new URLSearchParams(searchParams.toString())), [searchParams]);

  const setFilters = useCallback(
    (next: AcceptanceFilters) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of KEYS) params.delete(key);
      if (next.search) params.set("search", next.search);
      if (next.platform !== "all") params.set("platform", next.platform);
      if (next.status !== "all") params.set("status", next.status);
      if (next.value !== "all") params.set("value", next.value);
      if (next.anchor !== "all") params.set("anchor", next.anchor);
      if (next.parityGap) params.set("parity_gap", "1");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const reset = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters]);
  return { filters, setFilters, reset };
}
