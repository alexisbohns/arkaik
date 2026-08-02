"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectBundle } from "@/lib/data/types";
import { resolveProductScope, type ProductScope } from "@/lib/utils/product-scope";

const STORAGE_PREFIX = "arkaik:product-scope:";

/**
 * Read the stored scope for a project. Guarded twice over: `window` is absent
 * during SSR, and `localStorage` itself throws in private-mode browsers where a
 * storage quota of zero is enforced rather than reported.
 */
function readStoredScope(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    return stored === null || stored === "" ? null : stored;
  } catch {
    return null;
  }
}

function writeStoredScope(projectId: string, next: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (next === null) window.localStorage.removeItem(`${STORAGE_PREFIX}${projectId}`);
    else window.localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, next);
  } catch {
    // Best-effort only — a full or blocked localStorage means the scope resets
    // next session, not that switching product fails now.
  }
}

/**
 * The global product scope, persisted per project in localStorage.
 *
 * Not a URL param on purpose: the scope spans every route under
 * /project/[id], so a query param would have to be threaded through all of
 * them while fighting the existing `species` / `panel` param handling in
 * app/project/[id]/layout.tsx. The trade-off — a shared link does not carry
 * scope — is fine, because a link to a node is about the node.
 *
 * State is seeded from storage in the lazy initialiser rather than in an
 * effect, so the first client render is already the user's scope and no surface
 * flashes "All products" before settling. The effect below exists only to
 * re-seed when `projectId` changes, since a lazy initialiser runs once per
 * mount and the shell keeps this hook mounted across project switches.
 */
export function useProductScope(projectId: string) {
  const [productId, setProductId] = useState<string | null>(() => readStoredScope(projectId));
  const seededFor = useRef(projectId);

  useEffect(() => {
    if (seededFor.current === projectId) return;
    seededFor.current = projectId;
    setProductId(readStoredScope(projectId));
  }, [projectId]);

  const setScope = useCallback(
    (next: string | null) => {
      setProductId(next);
      writeStoredScope(projectId, next);
    },
    [projectId],
  );

  return { productId, setScope };
}

/**
 * What every surface calls — never `useProductScope` directly.
 *
 * Today this is the global scope, resolved against the project. The deferred
 * per-surface override milestone changes exactly this function to
 * `override ?? global`, which is why no surface may read the global value
 * itself.
 */
export function useEffectiveProduct(
  projectId: string,
  project: ProjectBundle | undefined,
): ProductScope & { setScope: (next: string | null) => void } {
  const { productId, setScope } = useProductScope(projectId);
  return { ...resolveProductScope(project, productId), setScope };
}
