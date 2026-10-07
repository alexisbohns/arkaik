/**
 * Whether hosted projects are reachable right now — a one-bit signal shared
 * between the auth status hook (which learns it) and the routing provider
 * (which acts on it).
 *
 * Deliberately module-level rather than React state or context: the routing
 * provider is plain data-layer code called from outside the component tree, so
 * it cannot read a hook.
 *
 * The subtlety is *timing*, not storage. `/api/auth/status` resolves a tick or
 * two after the app mounts, and the surfaces that list projects start their
 * listing on mount. A caller that merely samples the flag at that instant reads
 * the "no account" default and silently drops every hosted project — which is
 * exactly how `/projects` came to show fewer projects than the in-project
 * switcher. So the signal is not just readable but *awaitable*:
 * {@link whenHostedAvailabilityKnown} settles when the answer actually arrives.
 *
 * The wait is bounded. Not every surface renders a consumer of the auth status,
 * and nothing may hang a project listing forever waiting for a report that is
 * never coming — so an unanswered gate falls back to its current value (false,
 * i.e. local-only) after {@link DEFAULT_TIMEOUT_MS}. The worst case is then one
 * listing that misses the account, which is what the old behaviour did every
 * single time.
 *
 * Defaults to false so the local-first app never issues a hosted request it has
 * no reason to expect will succeed.
 */

/** How long to wait for a status report before answering with the default. */
const DEFAULT_TIMEOUT_MS = 3000;

export interface HostedAvailability {
  /**
   * Report the answer, releasing anything waiting on {@link HostedAvailability.whenKnown}.
   * `account` names WHOSE account is reachable — the signed-in user's id, or
   * `null` when none is. The persisted query cache scopes every entry to it,
   * so a second account on the same browser never paints the first one's
   * projects (#429).
   */
  set(available: boolean, account?: string | null): void;
  /** The answer as of right now — false until reported. */
  isAvailable(): boolean;
  /** The reachable account's id as of right now — `null` until reported, or when signed out. */
  account(): string | null;
  /**
   * The answer once it is actually known, or the current value if nothing
   * reports one within the timeout.
   */
  whenKnown(): Promise<boolean>;
}

export interface HostedAvailabilityOptions {
  timeoutMs?: number;
}

/**
 * A standalone gate. Exported so a caller that owns its own lifecycle (a test,
 * a future multi-account shell) can hold one without touching module state.
 */
export function createHostedAvailability(
  options: HostedAvailabilityOptions = {},
): HostedAvailability {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let available = false;
  let currentAccount: string | null = null;
  let known = false;
  let waiters: Array<(value: boolean) => void> = [];

  return {
    set(next: boolean, account: string | null = null) {
      available = next;
      // An account only means something while it is reachable.
      currentAccount = next ? account : null;
      known = true;
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve(available);
    },

    isAvailable: () => available,

    account: () => currentAccount,

    whenKnown() {
      if (known) return Promise.resolve(available);

      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          // Give up waiting, but leave the gate unknown: a report arriving
          // later still counts, for this caller's next listing and everyone
          // else's.
          waiters = waiters.filter((waiter) => waiter !== settle);
          resolve(available);
        }, timeoutMs);

        function settle(value: boolean) {
          clearTimeout(timer);
          resolve(value);
        }

        waiters.push(settle);
      });
    },
  };
}

const shared = createHostedAvailability();

export function setHostedAvailable(available: boolean, account: string | null = null): void {
  shared.set(available, account);
}

export function isHostedAvailable(): boolean {
  return shared.isAvailable();
}

/** @see createHostedAvailability */
export function whenHostedAvailabilityKnown(): Promise<boolean> {
  return shared.whenKnown();
}

/**
 * The signed-in account's id once the gate is known (or its current value at
 * the timeout) — `null` when no account is reachable. What the persisted query
 * cache waits on before restoring anything: an entry is only ever read back
 * for the account that wrote it.
 */
export async function whenHostedAccountKnown(): Promise<string | null> {
  await shared.whenKnown();
  return shared.account();
}
