"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { buildQueryHref, currentSearch, type QueryMutation } from "@/lib/utils/query-url";

/**
 * The single way this app mutates a surface's query string.
 *
 * Hand it a mutation over `URLSearchParams` and it applies it to the *live*
 * query — read from `window.location.search` at call time, not from a
 * `useSearchParams()` value closed over at render time. That is the whole point:
 * two writers on one surface (`useAcceptanceFilters` and `useProductOverride` on
 * Acceptances) each used to rebuild the string from their own stale closure, so
 * a write landing before the App Router transition committed dropped the other's
 * change. See `lib/utils/query-url.ts` for the failure in full.
 *
 * Mutations are keyed writes — set what you own, delete what you clear, leave
 * everything else alone. A mutation that assigns the whole string would
 * reintroduce the clobber from the other side.
 *
 * `replace` (not `push`) with `scroll: false`: filtering or narrowing a surface
 * is not a navigation and must not eat the back button.
 *
 * The returned callback is stable across renders — it closes over nothing that
 * changes except `router` and `pathname` — so it is safe in the dependency list
 * of a debounce effect without restarting the timer on every keystroke.
 */
export function useQueryWriter(): (mutate: QueryMutation) => void {
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (mutate: QueryMutation) => {
      router.replace(buildQueryHref(pathname, currentSearch(), mutate), { scroll: false });
    },
    [router, pathname],
  );
}
