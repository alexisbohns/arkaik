import type { QueryFunctionContext } from "@tanstack/query-core";

import { setHostedAvailable } from "@/lib/data/hosted-availability";
import { invalidateProjects } from "@/lib/data/project-queries";

/**
 * `GET /api/auth/status` (docs/spec/services.md § Synk → Auth) as ONE query
 * in the shared cache, read by `useAuthStatus`.
 *
 * It used to be a fetch per mounted consumer: the `/projects` page alone
 * mounted six (the switcher, the auth button, the page, each sync control…),
 * all asking the same question within the same frame. As a query they share
 * one request, and a remount inside the stale window reads the cache.
 *
 * The side effects live in the queryFn, not in the hook, so they run once
 * per answer rather than once per consumer:
 *  - the hosted-availability gate the routing provider awaits before listing
 *    hosted projects (lib/data/hosted-availability.ts);
 *  - marking the projects listing stale the first time the account is known,
 *    since a listing cached before then lacks its hosted half.
 *
 * Default staleness on purpose: signing in or out goes through a full-page
 * redirect, which starts a fresh cache anyway, and a session that lapses
 * while the tab is open is caught on the next focus refetch.
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

/** What the query resolves to — every state but the one meaning "not yet". */
export type ResolvedAuthStatus = Exclude<AuthStatus, { state: "loading" }>;

export const authStatusKey = () => ["auth", "status"] as const;

/**
 * Never throws. Any failure reads as "auth unavailable", which hides the
 * account surfaces and never blocks the local-first shell — and a queryFn
 * that threw would be retried, holding every consumer in `loading` meanwhile.
 */
async function readAuthStatus(): Promise<ResolvedAuthStatus> {
  try {
    const res = await fetch("/api/auth/status", { cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data: { configured: boolean; user: AuthStatusUser | null } = await res.json();
    if (!data.configured) return { state: "unconfigured" };
    return data.user ? { state: "signed-in", user: data.user } : { state: "signed-out" };
  } catch {
    return { state: "unconfigured" };
  }
}

export function authStatusQueryOptions() {
  return {
    queryKey: authStatusKey(),
    queryFn: async ({ client }: QueryFunctionContext): Promise<ResolvedAuthStatus> => {
      const previous = client.getQueryData<ResolvedAuthStatus>(authStatusKey());
      const status = await readAuthStatus();
      // Before the query settles, so the first render that knows the user is
      // signed in also knows the account is reachable.
      setHostedAvailable(status.state === "signed-in");
      if (status.state === "signed-in" && previous?.state !== "signed-in") void invalidateProjects();
      return status;
    },
  };
}
