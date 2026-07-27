/**
 * Whether hosted projects are reachable right now — a one-bit signal shared
 * between the auth status hook (which learns it) and the routing provider
 * (which acts on it).
 *
 * Deliberately a module-level flag rather than React state or context: the
 * routing provider is plain data-layer code called from outside the component
 * tree, so it cannot read a hook. The flag is set on every `/api/auth/status`
 * resolution and read at call time, so the worst case is one listing that tries
 * the account a moment early or late — which the routing provider already
 * degrades from without failing.
 *
 * Defaults to false so the local-first app never issues a hosted request it has
 * no reason to expect will succeed.
 */

let hostedAvailable = false;

export function setHostedAvailable(available: boolean): void {
  hostedAvailable = available;
}

export function isHostedAvailable(): boolean {
  return hostedAvailable;
}
