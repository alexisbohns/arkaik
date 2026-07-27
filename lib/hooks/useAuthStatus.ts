"use client";

import { useEffect, useState } from "react";

import { setHostedAvailable } from "@/lib/data/hosted-availability";

/**
 * Shared client-side view of `GET /api/auth/status` (docs/spec/services.md
 * § Synk → Auth). Originally inlined in `components/auth/AuthButton.tsx`;
 * factored out so the Synk client surfaces (per-project backup control,
 * restore dialog, Lokal→Synk onboarding banner — issue #244) can each decide
 * independently whether to render, without duplicating the fetch-once
 * lifecycle. Every consumer, AuthButton included, polls the same cheap
 * public-profile-only endpoint; no secret ever reaches the client.
 */

export interface AuthStatusUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

export type AuthStatus =
  | { state: "loading" }
  | { state: "unconfigured" }
  | { state: "signed-out" }
  | { state: "signed-in"; user: AuthStatusUser };

export function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>({ state: "loading" });

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: { configured: boolean; user: AuthStatusUser | null } = await res.json();
        if (!active) return;
        // The routing provider reads this to decide whether hosted projects are
        // worth asking for. Set before the state update so the very first render
        // that knows the user is signed in also knows the account is reachable.
        setHostedAvailable(Boolean(data.configured && data.user));
        if (!data.configured) {
          setStatus({ state: "unconfigured" });
        } else if (data.user) {
          setStatus({ state: "signed-in", user: data.user });
        } else {
          setStatus({ state: "signed-out" });
        }
      } catch {
        // Treat any failure as "auth unavailable" — degrade to hidden, never
        // block the local-first shell.
        setHostedAvailable(false);
        if (active) setStatus({ state: "unconfigured" });
      }
    }

    void loadStatus();
    return () => {
      active = false;
    };
  }, []);

  return status;
}
