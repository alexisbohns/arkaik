"use client";

import { useQuery } from "@tanstack/react-query";

import { authStatusQueryOptions, type AuthStatus } from "@/lib/data/auth-status";

export type { AuthStatus, AuthStatusUser } from "@/lib/data/auth-status";

/**
 * Shared client-side view of `GET /api/auth/status` (docs/spec/services.md
 * § Synk → Auth). Originally inlined in `components/auth/AuthButton.tsx`;
 * factored out so the Synk client surfaces (per-project backup control,
 * restore dialog, Lokal→Synk onboarding banner — issue #244) can each decide
 * independently whether to render. Every consumer reads the same cached
 * query (lib/data/auth-status.ts), so however many mount, the endpoint is
 * asked once; no secret ever reaches the client.
 */
export function useAuthStatus(): AuthStatus {
  const { data } = useQuery(authStatusQueryOptions());
  return data ?? { state: "loading" };
}
