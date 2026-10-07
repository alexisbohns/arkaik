"use client";

import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { whenHostedAccountKnown } from "@/lib/data/hosted-availability";
import { subscribeLocalMutationsToCache } from "@/lib/data/project-queries";
import { openQueryCacheStorage } from "@/lib/data/query-cache-db";
import { configureFocusManager, getQueryClient } from "@/lib/data/query-client";
import { installQueryPersistence } from "@/lib/data/query-persistence";

/**
 * Hands the app's one `QueryClient` (`lib/data/query-client.ts`) to React and
 * wires the two things the cache needs a live browser for: the local
 * provider's mutation bus, so writes that bypass the hooks still refresh what
 * is on screen, and the focus listener that makes `refetchOnWindowFocus` fire
 * on window focus too. A separate client file, like `theme-provider.tsx`, so
 * the root layout can stay a server component.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // In the browser both StrictMode calls return the same singleton. The
  // persister goes on here rather than in the effect below because a query
  // takes its default options when it is BUILT — during the children's first
  // render, before any effect of ours runs. Installing is idempotent, so the
  // second StrictMode call is a no-op.
  const [client] = useState(() => {
    const queryClient = getQueryClient();
    if (typeof window !== "undefined") {
      installQueryPersistence(queryClient, { storage: openQueryCacheStorage(), accountKnown: whenHostedAccountKnown });
    }
    return queryClient;
  });

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
