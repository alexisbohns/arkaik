import { QueryCache, QueryClient, focusManager } from "@tanstack/query-core";

import { RemoteProviderError } from "./remote-provider";

/**
 * The one TanStack `QueryClient` behind the data hooks — React-free, so the
 * cache can be reached from anywhere a write bypasses the hooks
 * (`lib/utils/export.ts`, the raw-bundle panel) without threading a client
 * through props. `components/query/QueryProvider.tsx` hands the same instance
 * to React; `lib/data/project-queries.ts` is the only module that writes to it.
 *
 * Freshness policy (docs/superpowers/plans/2026-09-10-reactive-data-layer.md
 * § D4): a project read is fresh for 30 s — navigating between a project's
 * surfaces inside that window is a cache hit with no request; beyond it the
 * cached entry paints immediately and a background refetch runs. Entries
 * survive 30 min without an observer so a round trip through the projects
 * list does not re-download a map. One retry, never on a 4xx: a 404 or a 401
 * will not change on a second try, a 500 might.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      // The hooks used to log every failed read; the cache does it once here
      // so the log stays as useful as it was without each hook repeating it.
      onError: (error, query) => {
        console.error("[query] read failed:", query.queryKey, error);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) =>
          failureCount < 1 && !(error instanceof RemoteProviderError && error.status < 500),
      },
    },
  });
}

let browserClient: QueryClient | null = null;
let testClient: QueryClient | null = null;

/**
 * The client every seam reads. A browser gets one module singleton for the
 * life of the page. The server gets a fresh client per call: nothing on the
 * server observes queries, and a shared server-side cache would leak one
 * request's reads into the next. There is no registration step on purpose —
 * a React initializer that ran twice under StrictMode could otherwise
 * register a client it went on to discard.
 */
export function getQueryClient(): QueryClient {
  if (testClient) return testClient;
  if (typeof window === "undefined") return createQueryClient();
  if (!browserClient) browserClient = createQueryClient();
  return browserClient;
}

/**
 * Test seam: make {@link getQueryClient} answer with `client` until reset with
 * `null`. Node has no `window`, so without this a test's seams would each get
 * a throwaway client and nothing could assert on them.
 */
export function setQueryClientForTests(client: QueryClient | null): void {
  testClient = client;
}

/**
 * TanStack's stock focus listener, restored on cleanup: `visibilitychange`
 * alone. Calling the setter with no argument makes the manager re-derive
 * focus from `document.visibilityState`, which is what the default does.
 */
function defaultFocusSetup(setFocused: (focused?: boolean) => void): () => void {
  const listener = () => setFocused();
  window.addEventListener("visibilitychange", listener, false);
  return () => window.removeEventListener("visibilitychange", listener);
}

/**
 * Make `refetchOnWindowFocus` fire on window `focus` as well as
 * `visibilitychange`. The default listens to visibility only, and switching
 * from a terminal to a browser window that stayed visible on screen fires
 * neither — so the revalidation the policy promises never ran in the one
 * situation that matters most while working next to an agent. Returns the
 * cleanup that puts the default listener back; a no-op off the browser.
 */
export function configureFocusManager(): () => void {
  if (typeof window === "undefined") return () => {};
  focusManager.setEventListener((setFocused) => {
    // No explicit boolean: the manager reads `document.visibilityState` when
    // asked, so a `focus` on a hidden window still counts as unfocused.
    const listener = () => setFocused();
    window.addEventListener("visibilitychange", listener, false);
    window.addEventListener("focus", listener, false);
    return () => {
      window.removeEventListener("visibilitychange", listener);
      window.removeEventListener("focus", listener);
    };
  });
  return () => focusManager.setEventListener(defaultFocusSetup);
}
