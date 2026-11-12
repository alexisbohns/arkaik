import type { PlatformId } from "@/lib/config/platforms";

/**
 * What the Screens map learns about its shots, for the tab's lifetime: each
 * shot's measured proportions, and which shots failed to load.
 *
 * Nothing records an image's dimensions, so a frame starts at its platform's
 * default shape and takes the shot's own once it has loaded (spec § Images).
 * Kept at module level, keyed `viewId|platform`, so leaving the map and coming
 * back keeps every proportion already learned: a frame changes width at most
 * once per shot per tab. Each entry remembers the shot it was measured from —
 * by its fingerprint, `shotKey` — and answers only while that is still the
 * slot's shot: a new shot starts from the default again rather than wearing
 * the old one's shape.
 *
 * The fingerprint, not the value: a shot can be a multi-megabyte data URI,
 * and the cache is consulted for every frame on every re-layout and kept for
 * the life of the tab. Its length, its `meta.ts` and its first and last 64
 * characters tell one shot from the next for a fraction of the cost.
 *
 * Reports arrive one `onLoad` at a time; they are applied together once per
 * animation frame, so a screenful of loading shots re-lays the wall once, not
 * once per image. The store is copy-on-write — each applied batch is a new
 * map — so it reads through `useSyncExternalStore` with no version counter.
 *
 * Failures are kept the same way (slot and key), applied at once: frames
 * unmount when they leave the viewport, so a failure held in the frame's own
 * state was forgotten and the broken image requested again every time its
 * frame came back. Remembered here, it shows its ghost on return without a
 * request.
 */

export interface AspectEntry {
  /** `shotKey` of the shot the ratio was measured from. */
  key: string;
  ratio: number;
}

/** How many characters of each end of a shot's value its fingerprint keeps. */
const KEY_END = 64;

/**
 * A shot's fingerprint: its value's length, its `meta.ts` when there is one,
 * and the first and last 64 characters of the value. Cheap on a data URI of
 * any size; a short URL is kept whole.
 */
export function shotKey(shot: { value: string; ts: string | null }): string {
  const { value } = shot;
  const ends = value.length <= 2 * KEY_END ? value : `${value.slice(0, KEY_END)}…${value.slice(-KEY_END)}`;
  return `${value.length}|${shot.ts ?? ""}|${ends}`;
}

const EMPTY: ReadonlyMap<string, AspectEntry> = new Map();

let snapshot: ReadonlyMap<string, AspectEntry> = EMPTY;
let pending = new Map<string, AspectEntry>();
let frame: number | null = null;
const listeners = new Set<() => void>();

const slotOf = (viewId: string, platform: PlatformId) => `${viewId}|${platform}`;

function flush(): void {
  frame = null;
  let next: Map<string, AspectEntry> | null = null;
  for (const [slot, entry] of pending) {
    const known = snapshot.get(slot);
    if (known && known.key === entry.key && known.ratio === entry.ratio) continue;
    next ??= new Map(snapshot);
    next.set(slot, entry);
  }
  pending = new Map();
  if (next === null) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** A shot loaded: `key` = `shotKey(shot)`, `ratio` = naturalWidth / naturalHeight. Applied on the next animation frame. */
export function reportAspect(viewId: string, platform: PlatformId, key: string, ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  pending.set(slotOf(viewId, platform), { key, ratio });
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

/** The slot's measured ratio, or undefined unless it was measured from the shot `key` names. */
export function aspectFrom(
  aspects: ReadonlyMap<string, AspectEntry>,
  viewId: string,
  platform: PlatformId,
  key: string,
): number | undefined {
  const entry = aspects.get(slotOf(viewId, platform));
  return entry && entry.key === key ? entry.ratio : undefined;
}

const failures = new Set<string>();
const failureListeners = new Set<() => void>();

const failureOf = (viewId: string, platform: PlatformId, key: string) => `${slotOf(viewId, platform)}|${key}`;

/** A shot did not load (`key` = `shotKey(shot)`): remembered for the tab, applied at once. */
export function reportShotFailure(viewId: string, platform: PlatformId, key: string): void {
  const entry = failureOf(viewId, platform, key);
  if (failures.has(entry)) return;
  failures.add(entry);
  for (const listener of failureListeners) listener();
}

/** Whether this slot's shot (`key`) already failed in this tab. */
export function hasShotFailed(viewId: string, platform: PlatformId, key: string): boolean {
  return failures.has(failureOf(viewId, platform, key));
}

export function subscribeShotFailures(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}
