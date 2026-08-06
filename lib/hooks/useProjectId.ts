"use client";

import { useParams } from "next/navigation";

/**
 * The route-param unwrapping every project surface pasted for itself — thirteen
 * copies of `Array.isArray(params.id) ? params.id[0] : params.id ?? ""` across
 * the ten project pages, the project layout and `ProjectPanels` (audit
 * `factorization-12`).
 *
 * **What an absent id means is decided here, once.** The `?? ""` those thirteen
 * copies carried is kept, and it is a real choice worth naming: an empty string
 * flows on into `useProject` / `useNodes` as a project id that matches nothing,
 * so the surface renders its empty state rather than throwing. That is the right
 * behaviour under this router — a page under `app/project/[id]/` cannot render
 * without a matched `[id]` segment, so the fallback is unreachable in practice
 * and exists only to keep the type a `string`. If the day comes that an absent
 * id should redirect or throw instead, it changes in this file and nowhere else.
 *
 * The array branch is not defensive coding either: `useParams` types every value
 * as `string | string[]` because a catch-all segment (`[...slug]`) yields an
 * array, and TypeScript cannot tell which kind of segment a given route used.
 */
export function useRouteParam(name: string): string {
  const params = useParams();
  const value = params[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The `[id]` segment of a project route — the id every project hook takes. */
export function useProjectId(): string {
  return useRouteParam("id");
}
