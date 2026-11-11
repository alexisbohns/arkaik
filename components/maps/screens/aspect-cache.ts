import type { PlatformId } from "@/lib/config/platforms";

/**
 * Measured proportions of the Screens map's shots, for the tab's lifetime.
 *
 * Nothing records an image's dimensions, so a frame starts at its platform's
 * default shape and takes the shot's own once it has loaded (spec § Images).
 * Kept at module level, keyed `viewId|platform`, so leaving the map and coming
 * back keeps every proportion already learned: a frame changes width at most
 * once per shot per tab. Each entry remembers the slot value it was measured
 * from and answers only while that is still the slot's value — a new shot
 * starts from the default again rather than wearing the old one's shape.
 *
 * Reports arrive one `onLoad` at a time; they are applied together once per
 * animation frame, so a screenful of loading shots re-lays the wall once, not
 * once per image. The store is copy-on-write — each applied batch is a new
 * map — so it reads through `useSyncExternalStore` with no version counter.
 */

export interface AspectEntry {
  value: string;
  ratio: number;
}

const EMPTY: ReadonlyMap<string, AspectEntry> = new Map();

let snapshot: ReadonlyMap<string, AspectEntry> = EMPTY;
let pending = new Map<string, AspectEntry>();
let frame: number | null = null;
const listeners = new Set<() => void>();

const keyOf = (viewId: string, platform: PlatformId) => `${viewId}|${platform}`;

function flush(): void {
  frame = null;
  let next: Map<string, AspectEntry> | null = null;
  for (const [key, entry] of pending) {
    const known = snapshot.get(key);
    if (known && known.value === entry.value && known.ratio === entry.ratio) continue;
    next ??= new Map(snapshot);
    next.set(key, entry);
  }
  pending = new Map();
  if (next === null) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** A shot loaded: `ratio` = naturalWidth / naturalHeight of `value`. Applied on the next animation frame. */
export function reportAspect(viewId: string, platform: PlatformId, value: string, ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  pending.set(keyOf(viewId, platform), { value, ratio });
  if (frame === null) frame = window.requestAnimationFrame(flush);
}

export function subscribeAspects(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAspectSnapshot(): ReadonlyMap<string, AspectEntry> {
  return snapshot;
}

/** The server has measured nothing. */
export function getServerAspectSnapshot(): ReadonlyMap<string, AspectEntry> {
  return EMPTY;
}

/** The slot's measured ratio, or undefined unless it was measured from `value` itself. */
export function aspectFrom(
  aspects: ReadonlyMap<string, AspectEntry>,
  viewId: string,
  platform: PlatformId,
  value: string,
): number | undefined {
  const entry = aspects.get(keyOf(viewId, platform));
  return entry && entry.value === value ? entry.ratio : undefined;
}
