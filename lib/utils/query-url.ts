/**
 * The pure half of "write the query string without clobbering the other writer".
 *
 * A surface can have more than one independent query writer — Acceptances has
 * two, `useAcceptanceFilters` and `useProductOverride` — and each used to
 * rebuild the string from the `searchParams` captured in its own `useCallback`
 * closure. Neither sees the other's write until the App Router transition
 * commits, so a write landing inside that window is built from a stale base and
 * silently drops the other's change: pick a product mid-debounce and the typed
 * search text vanishes from the box.
 *
 * The fix is to read the query at *call* time rather than from a closure, which
 * makes each writer independently correct with no coordination between them.
 * `window.location.search` is the only base that is always current: the browser
 * updates it synchronously on `router.replace`, before and regardless of when
 * React commits the transition.
 *
 * This module is the part of that with no React in it — given a base string and
 * a mutation, produce the href. `useQueryWriter` supplies the base.
 */

/** Mutates the params in place; the return value is ignored. */
export type QueryMutation = (params: URLSearchParams) => void;

/**
 * `pathname` when the mutation leaves no params, `pathname?qs` otherwise — never
 * a bare trailing `?`, which would make two equivalent URLs compare unequal and
 * push a pointless entry through `replace`.
 *
 * `search` may carry its leading `?` or not; `URLSearchParams` accepts both.
 */
export function buildQueryHref(pathname: string, search: string, mutate: QueryMutation): string {
  const params = new URLSearchParams(search);
  mutate(params);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * The live query string, or `""` where there is no `window` (SSR, tests).
 *
 * The fallback is safe because every caller runs inside an event handler or a
 * debounce timer — client-only by construction — and a writer that somehow ran
 * during SSR has no router to write to either.
 */
export function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}
