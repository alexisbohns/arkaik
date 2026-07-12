import type { DataProvider } from "./data-provider";
import { localProvider } from "./local-provider";

/**
 * The provider-injection seam (issue #243) — the exact prerequisite
 * `docs/spec/services.md` § Synk "Client sync engine" and
 * `docs/rfcs/arkaik-dev.md` (Option B.1) both call for, built once to serve
 * both consumers:
 *
 * - Synk's `SyncManager` needs a stable place to read "the current provider"
 *   without caring whether it's local or (eventually) a synced/remote one.
 * - `arkaik dev`'s read-only repo-bundle viewer needs to swap in a different
 *   `DataProvider` implementation at build/hydration time without touching
 *   every hook/UI call site.
 *
 * `getProvider()` is the one seam every consumer should read through instead
 * of importing `localProvider` directly. It defaults to `localProvider`, so
 * today's behavior is unchanged; `setProvider()` is the escape hatch a future
 * provider (or a test) uses to swap it.
 */

let currentProvider: DataProvider = localProvider;

/** The active `DataProvider`. Defaults to `localProvider`. */
export function getProvider(): DataProvider {
  return currentProvider;
}

/**
 * Swap the active provider. Not needed for today's local-only app — this is
 * the injection point future providers (or tests) use. Production call sites
 * should read through {@link getProvider} rather than call this.
 */
export function setProvider(provider: DataProvider): void {
  currentProvider = provider;
}
