"use client";

import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { subscribeLocalMutationsToCache } from "@/lib/data/project-queries";
import { configureFocusManager, getQueryClient } from "@/lib/data/query-client";

/**
 * Hands the app's one `QueryClient` (`lib/data/query-client.ts`) to React and
 * wires the two things the cache needs a live browser for: the local
 * provider's mutation bus, so writes that bypass the hooks still refresh what
 * is on screen, and the focus listener that makes `refetchOnWindowFocus` fire
 * on window focus too. A separate client file, like `theme-provider.tsx`, so
 * the root layout can stay a server component.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // The initializer does not register anything, so StrictMode running it twice
  // costs nothing: in the browser both calls return the same singleton.
  const [client] = useState(() => getQueryClient());

  useEffect(() => {
    const unsubscribe = subscribeLocalMutationsToCache(client);
    const restoreFocusListener = configureFocusManager();
    return () => {
      unsubscribe();
      restoreFocusListener();
    };
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
