/**
 * The product scope *value*, held once per project in a module-level store.
 *
 * Deliberately module state rather than `useState` inside the hook. Two
 * independent callers read this scope — the sidebar selector and every surface
 * (via `useEffectiveProduct`) — and they must agree. Per-component `useState`
 * would give each of them a private copy, so picking "Admin dashboard" in the
 * sidebar would relabel the selector and change nothing else; a same-tab
 * `localStorage.setItem` fires no `storage` event, so persistence alone does
 * not propagate either. § Decision 2 requires "every view respects it", which
 * means one value and a subscriber list.
 *
 * Shaped for `useSyncExternalStore`, matching lib/sync/sync-manager.ts and
 * lib/hooks/useModKeyLabel.ts. Snapshots are `string | null` — a primitive, so
 * they are referentially stable by construction and React never sees the
 * "getSnapshot should be cached" warning.
 */

const STORAGE_PREFIX = "arkaik:product-scope:";

/** `projectId → scope`, lazily hydrated from localStorage on first read. */
const scopes = new Map<string, string | null>();
const listeners = new Set<() => void>();

/**
 * Guarded twice over: `window` is absent during SSR, and `localStorage` itself
 * throws in private-mode browsers that enforce a zero quota rather than
 * reporting one.
 */
function readStored(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    return stored === null || stored === "" ? null : stored;
  } catch {
    return null;
  }
}

function writeStored(projectId: string, next: string | null) {
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
 * The current scope for a project. The first read hydrates from localStorage
 * and caches; every later read is the cached value, which is what makes this
 * safe to call from `getSnapshot` on every render.
 */
export function getProductScopeId(projectId: string): string | null {
  if (!scopes.has(projectId)) scopes.set(projectId, readStored(projectId));
  return scopes.get(projectId) ?? null;
}

/** Set the scope, persist it, and notify every subscriber. */
export function setProductScopeId(projectId: string, next: string | null) {
  if (getProductScopeId(projectId) === next) return;
  scopes.set(projectId, next);
  writeStored(projectId, next);
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore`-friendly: fires whenever ANY project's scope changes. */
export function subscribeProductScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam only — drops cached scopes and subscribers. Never called by the app. */
export function resetProductScopeStore() {
  scopes.clear();
  listeners.clear();
}
