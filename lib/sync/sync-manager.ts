import { serializeBundle as canonicalSerializeBundle, type ProjectBundle } from "@arkaik/schema";

import { getProvider } from "@/lib/data/provider-registry";
import { subscribeToMutations } from "@/lib/data/local-provider";

/**
 * The client half of Synk (docs/spec/services.md § Synk → Client sync engine,
 * issue #244 — the M4 "Lokal → Synk conversion funnel"). On every local
 * mutation notification (issue #243's `subscribeToMutations`, the engine's
 * trigger), debounce ~60s per project, then export → canonical-serialize →
 * hash → `PUT /api/synk/projects/{id}`. Also drives a manual "Back up now"
 * bypass and the per-project status the UI renders.
 *
 * Hard boundaries this module enforces (inherited from the spec):
 *  - **One-way, up.** This module never writes a byte back into local
 *    storage. It only reads (`exportProject`) and PUTs. Restore is a
 *    different, explicit code path (components/sync/RestoreDialog.tsx) that
 *    goes through the existing `importProject`/`importProjectFromFile` funnel
 *    — never this module.
 *  - **Dormant when signed out or unconfigured.** No timers, no fetches. The
 *    engine checks a cached `AuthState` synchronously before ever arming a
 *    debounce timer, and re-checks (fresh) immediately before every actual
 *    backup attempt.
 *  - **No data loss on failure.** A network failure or a 403 limit error
 *    never retries on a timer of its own — the local bundle is untouched in
 *    IndexedDB regardless, and the *next* mutation notification (or an
 *    explicit "Back up now") is what retries. This mirrors the spec's own
 *    phrasing: "network failures without data loss (retry on next
 *    mutation)".
 *
 * ── Testability ─────────────────────────────────────────────────────────
 * {@link createSyncManager} takes every side-effecting dependency as an
 * injectable override (fetch, the mutation channel, the provider's
 * `exportProject`, canonical serialization, hashing, timers, "now"). The
 * pure debounce/hash/status-transition logic is exercised in plain Node by
 * `tests/sync/sync-manager.test.js` with every dependency stubbed — no DOM,
 * no IndexedDB, no network. {@link syncManager} is the real, browser-wired
 * singleton every UI surface imports.
 */

/**
 * Matches `lib/services/synk.ts`'s `BUNDLE_SHA256_HEADER` exactly (not
 * imported from there: that module starts with `import "server-only"` and
 * would break if pulled into a client bundle — see docs/spec/services.md's
 * boundary notes). The header is advisory only (§ Backup protocol dedupe
 * contract); a mismatch here would only cost a redundant server-side
 * recomputation, never correctness.
 */
export const BUNDLE_SHA256_HEADER = "x-bundle-sha256";

/** What the engine knows about the caller's session (GET /api/auth/status). */
export interface AuthState {
  configured: boolean;
  signedIn: boolean;
}

/**
 * Per-project sync status, driving the UI (docs/spec/services.md § Synk →
 * Client sync engine: "visible per-project status (backed up · pending ·
 * error · limit-exceeded)"). `limit-exceeded` carries the full structured
 * 403 body so the UI can render it meaningfully (e.g. "250-entity limit
 * exceeded (312) — synk tier").
 */
export type SyncStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "syncing" }
  | { state: "backed-up"; at: string }
  | { state: "error"; message: string }
  | { state: "limit-exceeded"; limit: number; actual: number; tier: string };

const IDLE_STATUS: SyncStatus = { state: "idle" };

/** Minimal per-project summary read from `GET /api/synk/projects` for onboarding + status hydration. */
export interface ServerProjectSummary {
  projectId: string;
  lastBackupAt: string | null;
}

/** Mirrors `lib/data/local-provider.ts`'s `MutationEvent` shape (not imported — see the header-constant note above for the same reasoning; this one is just a plain data shape, no server-only concern, but staying import-free keeps this module's only value imports the two real seam functions it needs). */
export interface MutationEvent {
  projectId: string;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface SyncManagerDeps {
  /** `fetch`-compatible; injected so tests never touch the network. */
  fetchImpl: typeof fetch;
  /** The mutation-notification channel (lib/data/local-provider.ts, issue #243) — the engine's trigger. */
  subscribeToMutations: (cb: (event: MutationEvent) => void) => () => void;
  /** Reads the current bundle for a project through the provider-injection seam (lib/data/provider-registry.ts). */
  exportProject: (projectId: string) => Promise<ProjectBundle>;
  /** Canonical serialization (packages/schema) — the exact bytes that get hashed and PUT. */
  serializeBundle: (bundle: ProjectBundle) => string;
  /** sha256 hex of the canonical bytes (Web Crypto in the real implementation). */
  hashBundle: (canonical: string) => Promise<string>;
  /** GET /api/auth/status, parsed to the two booleans the engine needs. */
  getAuthState: () => Promise<AuthState>;
  /** GET /api/synk/projects, parsed to a minimal per-project summary (for status hydration + onboarding). */
  listServerProjects: () => Promise<ServerProjectSummary[]>;
  /** Debounce window; ~60s per docs/spec/services.md, overridable for tests. */
  debounceMs: number;
  now: () => number;
  setTimeoutFn: (cb: () => void, ms: number) => TimerHandle;
  clearTimeoutFn: (handle: TimerHandle) => void;
}

interface PutBackupResponse {
  status: number;
  body: unknown;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

/** Web Crypto SHA-256 over UTF-8 bytes, lowercase hex — the same format as `lib/services/synk.ts`'s `sha256Hex`. */
async function defaultHashBundle(canonical: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function defaultGetAuthState(fetchImpl: typeof fetch): Promise<AuthState> {
  try {
    const res = await fetchImpl("/api/auth/status", { cache: "no-store" });
    if (!res.ok) return { configured: false, signedIn: false };
    const body = (await res.json()) as { configured: boolean; user: unknown | null };
    return { configured: Boolean(body.configured), signedIn: Boolean(body.configured && body.user) };
  } catch {
    return { configured: false, signedIn: false };
  }
}

async function defaultListServerProjects(fetchImpl: typeof fetch): Promise<ServerProjectSummary[]> {
  try {
    const res = await fetchImpl("/api/synk/projects", { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      projects?: Array<{ project_id: string; latest_created_at: string | null }>;
    };
    return (body.projects ?? []).map((p) => ({ projectId: p.project_id, lastBackupAt: p.latest_created_at }));
  } catch {
    return [];
  }
}

function defaultDeps(): SyncManagerDeps {
  const fetchImpl: typeof fetch = (...args) => fetch(...args);
  return {
    fetchImpl,
    subscribeToMutations,
    exportProject: (projectId) => getProvider().exportProject(projectId),
    serializeBundle: canonicalSerializeBundle,
    hashBundle: defaultHashBundle,
    getAuthState: () => defaultGetAuthState(fetchImpl),
    listServerProjects: () => defaultListServerProjects(fetchImpl),
    debounceMs: 60_000,
    now: () => Date.now(),
    setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
    clearTimeoutFn: (handle) => clearTimeout(handle),
  };
}

export interface SyncManager {
  /** Idempotent: subscribes to mutation notifications and kicks off an initial auth check. No-ops on repeat calls. */
  start(): void;
  /** Unsubscribes from mutations and clears every pending debounce timer. */
  stop(): void;
  /** Bypasses any pending debounce and attempts a backup immediately ("Back up now"). */
  backupNow(projectId: string): Promise<void>;
  getStatus(projectId: string): SyncStatus;
  /** useSyncExternalStore-friendly: fires whenever ANY project's status changes. */
  subscribe(listener: () => void): () => void;
  /** Re-checks auth (cached between calls otherwise) — called on start, before every backup attempt, and can be called by the UI on window focus. */
  refreshAuth(): Promise<AuthState>;
  getAuthState(): AuthState;
}

/**
 * Build a SyncManager over injected dependencies. See the module doc above
 * for the testability rationale. Every side effect (network, timers,
 * hashing, the provider read, the mutation subscription) is a field on
 * {@link SyncManagerDeps}; omitted fields fall back to the real browser
 * wiring via {@link defaultDeps}.
 */
export function createSyncManager(overrides: Partial<SyncManagerDeps> = {}): SyncManager {
  const deps: SyncManagerDeps = { ...defaultDeps(), ...overrides };

  let started = false;
  let unsubscribeMutations: (() => void) | null = null;
  let authState: AuthState = { configured: false, signedIn: false };
  let hydratedFromServer = false;

  let statusMap: Map<string, SyncStatus> = new Map();
  const listeners = new Set<() => void>();
  const timers = new Map<string, TimerHandle>();

  function emit() {
    for (const listener of listeners) listener();
  }

  function setStatus(projectId: string, status: SyncStatus) {
    statusMap = new Map(statusMap);
    statusMap.set(projectId, status);
    emit();
  }

  /** Seed a project's status from the server's backup listing — but only if
   * nothing local (a pending timer, an in-flight sync, a prior error) has
   * already claimed this session's view of that project's status. */
  function seedIfUnknown(projectId: string, atIso: string) {
    if (statusMap.has(projectId)) return;
    setStatus(projectId, { state: "backed-up", at: atIso });
  }

  function clearTimer(projectId: string) {
    const handle = timers.get(projectId);
    if (handle !== undefined) {
      deps.clearTimeoutFn(handle);
      timers.delete(projectId);
    }
  }

  /** Runs once per "became signed in" transition (docs/spec/services.md's
   * onboarding funnel needs the server's view to know what's already backed
   * up; the per-project status badges benefit from it too, on cold load). */
  async function hydrateFromServer() {
    if (hydratedFromServer) return;
    hydratedFromServer = true;
    try {
      const projects = await deps.listServerProjects();
      for (const p of projects) {
        if (p.lastBackupAt) seedIfUnknown(p.projectId, p.lastBackupAt);
      }
    } catch {
      hydratedFromServer = false; // soft failure — allow a later refreshAuth to retry
    }
  }

  async function refreshAuth(): Promise<AuthState> {
    const next = await deps.getAuthState();
    const justSignedIn = !authState.signedIn && next.signedIn;
    authState = next;
    if (justSignedIn) void hydrateFromServer();
    return authState;
  }

  function onMutation(event: MutationEvent) {
    if (!started) return;
    // Dormant while signed out/unconfigured: no timer is ever armed, per the
    // spec's "SyncManager stays dormant (no timers, no fetches)".
    if (!authState.configured || !authState.signedIn) return;
    scheduleDebounced(event.projectId);
  }

  function scheduleDebounced(projectId: string) {
    clearTimer(projectId);
    setStatus(projectId, { state: "pending" });
    const handle = deps.setTimeoutFn(() => {
      void performBackup(projectId);
    }, deps.debounceMs);
    timers.set(projectId, handle);
  }

  async function putBackup(projectId: string, canonical: string, hash: string | null): Promise<PutBackupResponse> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (hash) headers[BUNDLE_SHA256_HEADER] = hash;
    const res = await deps.fetchImpl(`/api/synk/projects/${encodeURIComponent(projectId)}`, {
      method: "PUT",
      headers,
      body: canonical,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  async function performBackup(projectId: string): Promise<void> {
    clearTimer(projectId);

    // Refresh immediately before attempting (§ "refresh ... before a backup
    // attempt") — a stale cached "signed in" would otherwise fire a doomed PUT.
    await refreshAuth();
    if (!authState.configured || !authState.signedIn) {
      // Stays wherever it was (e.g. "pending"): the local bundle is safe in
      // IndexedDB regardless, and the next mutation or an explicit
      // backupNow() re-attempts once signed in again.
      return;
    }

    setStatus(projectId, { state: "syncing" });

    let bundle: ProjectBundle;
    try {
      bundle = await deps.exportProject(projectId);
    } catch (err) {
      setStatus(projectId, { state: "error", message: errorMessage(err) });
      return;
    }

    const canonical = deps.serializeBundle(bundle);
    let hash: string | null;
    try {
      hash = await deps.hashBundle(canonical);
    } catch {
      hash = null; // the header is advisory-only — a hash failure never blocks the PUT
    }

    let response: PutBackupResponse;
    try {
      response = await putBackup(projectId, canonical, hash);
    } catch (err) {
      // Network failure: no data lost, the local bundle is untouched — the
      // next mutation notification (or a manual "Back up now") retries.
      setStatus(projectId, { state: "error", message: errorMessage(err) });
      return;
    }

    switch (response.status) {
      case 200:
      case 201: {
        setStatus(projectId, { state: "backed-up", at: new Date(deps.now()).toISOString() });
        return;
      }
      case 403: {
        const body = (response.body ?? {}) as { limit?: number; actual?: number; tier?: string };
        setStatus(projectId, {
          state: "limit-exceeded",
          limit: typeof body.limit === "number" ? body.limit : 0,
          actual: typeof body.actual === "number" ? body.actual : 0,
          tier: typeof body.tier === "string" ? body.tier : "synk",
        });
        return;
      }
      case 401: {
        // Session lapsed mid-flight: stop believing we're signed in so the
        // next mutation stays dormant until a fresh sign-in proves otherwise.
        authState = { ...authState, signedIn: false };
        setStatus(projectId, { state: "error", message: "Signed out — sign in to back up this project." });
        return;
      }
      case 503: {
        setStatus(projectId, { state: "error", message: "Synk backups are not available on this deployment." });
        return;
      }
      default: {
        const body = (response.body ?? {}) as { message?: string; error?: string };
        setStatus(projectId, {
          state: "error",
          message: body.message ?? body.error ?? `Backup failed (HTTP ${response.status}).`,
        });
      }
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      unsubscribeMutations = deps.subscribeToMutations(onMutation);
      void refreshAuth();
    },
    stop() {
      started = false;
      unsubscribeMutations?.();
      unsubscribeMutations = null;
      for (const handle of timers.values()) deps.clearTimeoutFn(handle);
      timers.clear();
    },
    async backupNow(projectId: string) {
      await performBackup(projectId);
    },
    getStatus(projectId: string) {
      return statusMap.get(projectId) ?? IDLE_STATUS;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refreshAuth,
    getAuthState() {
      return authState;
    },
  };
}

/**
 * The app-wide singleton (docs/spec/services.md § Synk → Client sync engine:
 * "SyncManager (lib/sync/)"). `components/sync/SyncProvider.tsx` calls
 * `.start()` once from a client-only effect; every other UI surface (the
 * per-project status control, the onboarding banner) imports this same
 * instance so their view of status stays consistent app-wide. Constructing it
 * here is side-effect-free — `defaultDeps()` only captures function
 * references, it never calls `fetch`, IndexedDB, or Web Crypto at import
 * time — so importing this module during SSR/prerender is safe.
 */
export const syncManager: SyncManager = createSyncManager();
