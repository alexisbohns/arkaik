"use client";

import { useEffect } from "react";

import { syncManager } from "@/lib/sync/sync-manager";

/**
 * Boots the Synk client sync engine (docs/spec/services.md § Synk → Client
 * sync engine, issue #244). Mounted once in `app/layout.tsx` so `syncManager`
 * starts listening for local mutation notifications for the lifetime of the
 * app shell — `.start()` is idempotent, so React Strict Mode's dev-only
 * double-invoke of effects is harmless.
 *
 * `syncManager` itself stays dormant (no timers, no fetches) until
 * `GET /api/auth/status` reports a signed-in user — this component's only
 * other job is refreshing that cached auth check on window focus, so signing
 * in (or out) in another tab is noticed promptly rather than only on the next
 * mutation.
 *
 * Renders nothing — a pure side-effect component, the same shape as
 * `components/ui/toaster.tsx`'s `AppToaster`.
 */
export function SyncProvider() {
  useEffect(() => {
    syncManager.start();

    function onFocus() {
      void syncManager.refreshAuth();
    }
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      syncManager.stop();
    };
  }, []);

  return null;
}
