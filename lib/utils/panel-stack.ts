/**
 * Push-panel stack semantics — pure state transitions, no React and no DOM.
 *
 * One rule generates all of it: **a click in panel `i` owns everything above
 * `i`.** Depth 0 is the surface behind the stack (the canvas, the board, the
 * list); the panel at entries index `i` sits at depth `i + 1`. Opening from a
 * depth truncates to it and lands the new panel in the slot just above.
 *
 * The stack below the top is client state by design — it is exploration
 * history, not an address. The URL carries the top only, which is why
 * `reconcileArrival` exists: a history entry arrives with an id and no intent,
 * so intent is inferred from where that id already sits in the stack.
 */

export interface PanelEntry<T> {
  /** Identity of the thing this panel shows — the node id, here. */
  key: string;
  /**
   * React render key. A *refresh* (same key landing in the same slot) keeps it,
   * so scroll position and in-progress edits survive; a *swap* (a different key
   * taking the slot) replaces it, so per-panel UI state never bleeds between
   * entities.
   */
  instanceId: string;
  /** Whatever the binding needs to render this panel. */
  payload: T;
}

let instanceCounter = 0;

function nextInstanceId(): string {
  instanceCounter += 1;
  return `panel-${instanceCounter}`;
}

export function initStack<T>(): PanelEntry<T>[] {
  return [];
}

/**
 * Open `key` from `depth` — a click in the panel at depth `depth`.
 *
 * Depth 0 is the surface behind the stack, so a canvas click always leaves
 * exactly one panel open; a click inside the panel at depth 1 leaves two, and
 * so on. Everything above `depth` is dropped either way.
 *
 * Clicking a reference to the entity you are already reading (a self-link)
 * refreshes that panel in place instead of opening a duplicate column.
 */
export function openFrom<T>(
  stack: PanelEntry<T>[],
  depth: number,
  key: string,
  payload: T,
): PanelEntry<T>[] {
  const base = stack.slice(0, Math.max(0, depth));
  const from = base[base.length - 1];

  if (from && from.key === key) {
    const refreshed = base.slice();
    refreshed[refreshed.length - 1] = { key, instanceId: from.instanceId, payload };
    return refreshed;
  }

  const displaced = stack[base.length];
  const instanceId = displaced && displaced.key === key ? displaced.instanceId : nextInstanceId();

  return [...base, { key, instanceId, payload }];
}

/** Close one panel by index. Panels above it stay open and slide down a slot. */
export function closeAt<T>(stack: PanelEntry<T>[], index: number): PanelEntry<T>[] {
  if (index < 0 || index >= stack.length) return stack;
  return [...stack.slice(0, index), ...stack.slice(index + 1)];
}

/**
 * Unwind to `depth` panels — the breadcrumb's jump, and Escape's pop with
 * `stack.length - 1`. Depth 0 closes the stack.
 */
export function unwindTo<T>(stack: PanelEntry<T>[], depth: number): PanelEntry<T>[] {
  const target = Math.max(0, Math.min(depth, stack.length));
  if (target === stack.length) return stack;
  return stack.slice(0, target);
}

/**
 * Reconcile the stack with an id arriving from the URL — a cold load, Back, or
 * Forward. Three paths, because a history entry carries an id and no intent:
 *
 * 1. It is already the top — we published this ourselves. Nothing to do.
 * 2. It sits below the top — Back, or a jump into the trail. Unwind to it,
 *    keeping the entries (and so the scroll positions) that survive.
 * 3. It is not in the stack — Forward into a trail we popped, or a cold load.
 *    Push it, which re-opens the branch instead of flattening it.
 *
 * A missing id closes the stack.
 */
export function reconcileArrival<T>(
  stack: PanelEntry<T>[],
  key: string | null,
  payload: T,
): PanelEntry<T>[] {
  if (!key) return stack.length === 0 ? stack : [];

  const top = stack[stack.length - 1];
  if (top && top.key === key) return stack;

  const found = stack.findIndex((entry) => entry.key === key);
  if (found >= 0) return stack.slice(0, found + 1);

  return openFrom(stack, stack.length, key, payload);
}

/**
 * Index of the first panel to render. Everything below stays mounted but
 * hidden, so unwinding brings a panel back with its scroll position intact.
 */
export function visibleFrom(length: number, maxVisible: number): number {
  return Math.max(0, length - Math.max(1, maxVisible));
}
