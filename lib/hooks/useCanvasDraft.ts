"use client";

import { useSyncExternalStore } from "react";

import { draftIsEmpty, draftReducer, emptyDraft, firstUnfinishedStep } from "@/lib/arkademy/canvas";
import type { CanvasDraft, DraftAction } from "@/lib/arkademy/canvas";
import {
  DRAFT_STORAGE_KEY,
  DRAFT_UNREADABLE_KEY,
  keepAside,
  readKeptAside,
  readStoredDraft,
  serializeDraft,
} from "@/lib/arkademy/canvas-storage";

/**
 * Your own canvas's draft: the only code that reads or writes its key
 * (`arkaik:arkademy:bmc`, spec § "Browser storage").
 *
 * A module store read through `useSyncExternalStore`, like
 * useOverviewLayout and useStonePreferences, so nothing calls setState in an
 * effect and the server and the first client render agree: both see
 * `{ phase: "loading" }` (the page draws a skeleton), and the draft is read
 * from storage when the first component subscribes — after mount — so a
 * stored canvas never causes a hydration mismatch and never flashes empty.
 *
 * A change is written at most 300 ms later; a pending one is written at once
 * on `pagehide` and when the last component unsubscribes (a client
 * navigation away). Another tab's write arrives as a
 * `storage` event and replaces this tab's draft: two tabs converge on the
 * last writer.
 */

/** The longest a change waits before it is written. */
export const DRAFT_WRITE_DELAY_MS = 300;

/** "on": saved in this browser. "unavailable": storage is off, throws or is full. "newer": a newer build wrote it; never saved over. */
export type DraftPersistence = "on" | "unavailable" | "newer";

export type CanvasDraftView =
  | { phase: "loading" }
  | {
      phase: "ready";
      draft: CanvasDraft;
      /** The step a visit lands on without `?step=`, fixed when the draft was read. */
      startStep: number;
      persistence: DraftPersistence;
      /**
       * Stored values this build could not read, copied aside before anything
       * overwrote them, oldest first. Read from their key on every load, so
       * the page offers them until the visitor discards them.
       */
      keptAside: string[];
    };

const LOADING: CanvasDraftView = { phase: "loading" };
const PROBE_KEY = "arkaik:arkademy:bmc:probe";

let view: CanvasDraftView = LOADING;
const listeners = new Set<() => void>();
let writeTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Whether the stored value could be read at load. A storage that refused a
 * write (full, a zero quota) is tried again on the next change; one that
 * could not even be read is never written, since it may hold a draft this
 * page has not seen.
 */
let readAtLoad = false;

function emit() {
  for (const listener of listeners) listener();
}

/** `localStorage`, or null where reaching it throws (blocked site data, some private modes). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A storage that reads may still refuse writes (a zero quota, a full disk). */
function writable(storage: Storage): boolean {
  try {
    storage.setItem(PROBE_KEY, "1");
    storage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

function load() {
  const storage = browserStorage();
  let raw: string | null = null;
  let available = storage !== null;
  readAtLoad = false;
  if (storage) {
    try {
      raw = storage.getItem(DRAFT_STORAGE_KEY);
      readAtLoad = true;
    } catch {
      available = false;
    }
    if (available && !writable(storage)) available = false;
  }

  const read = readStoredDraft(raw);
  let draft = emptyDraft();
  let persistence: DraftPersistence = available ? "on" : "unavailable";
  let keptAside: string[] = [];
  if (storage && readAtLoad) {
    try {
      keptAside = readKeptAside(storage.getItem(DRAFT_UNREADABLE_KEY));
    } catch {
      keptAside = [];
    }
  }
  if (read.status === "ok") draft = read.draft;
  if (read.status === "newer") {
    draft = read.draft;
    if (available) persistence = "newer";
  }
  if (read.status === "unreadable") {
    const kept = keepAside(keptAside, read.raw);
    if (kept.length !== keptAside.length) {
      try {
        storage?.setItem(DRAFT_UNREADABLE_KEY, JSON.stringify(kept));
      } catch {
        persistence = "unavailable";
      }
    }
    keptAside = kept;
  }
  view = { phase: "ready", draft, startStep: firstUnfinishedStep(draft), persistence, keptAside };
}

function write() {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (view.phase !== "ready" || view.persistence === "newer" || !readAtLoad) return;
  const storage = browserStorage();
  try {
    if (!storage) throw new Error("no storage");
    if (draftIsEmpty(view.draft)) storage.removeItem(DRAFT_STORAGE_KEY);
    else storage.setItem(DRAFT_STORAGE_KEY, serializeDraft(view.draft));
    if (view.persistence !== "on") {
      view = { ...view, persistence: "on" };
      emit();
    }
  } catch {
    if (view.persistence !== "unavailable") {
      view = { ...view, persistence: "unavailable" };
      emit();
    }
  }
}

/** Writes a pending change now. With nothing pending it writes nothing, so a tab at rest never overwrites another's draft. */
function flush() {
  if (writeTimer !== undefined) write();
}

function onStorage(event: StorageEvent) {
  if (event.key !== DRAFT_STORAGE_KEY && event.key !== null) return;
  if (view.phase !== "ready") return;
  const read = readStoredDraft(event.key === null ? null : event.newValue);
  if (read.status === "unreadable") return; // keep this tab's canvas
  // The other tab wrote last; a pending write here would undo it.
  clearTimeout(writeTimer);
  writeTimer = undefined;
  const draft = read.status === "none" ? emptyDraft() : read.draft;
  const persistence = read.status === "newer" && view.persistence === "on" ? "newer" : view.persistence;
  view = { ...view, draft: draftReducer(view.draft, { type: "replace", draft }), persistence };
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    load();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", flush);
  }
  listeners.add(listener);
  listener();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    flush();
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pagehide", flush);
    view = LOADING;
  };
}

function getSnapshot(): CanvasDraftView {
  return view;
}

function getServerSnapshot(): CanvasDraftView {
  return LOADING;
}

/** Every edit goes through the draft's reducer; a change is stamped and written after a pause. */
export function dispatchDraft(action: DraftAction) {
  if (view.phase !== "ready") return;
  const next = draftReducer(view.draft, action);
  if (next === view.draft) return;
  view = { ...view, draft: action.type === "reset" ? next : { ...next, updatedAt: new Date().toISOString() } };
  emit();
  // At most DRAFT_WRITE_DELAY_MS after the first unsaved change: a timer reset
  // on every keystroke would never fire while someone types without pausing.
  if (writeTimer === undefined) writeTimer = setTimeout(write, DRAFT_WRITE_DELAY_MS);
}

/** Deletes the text kept aside from unreadable drafts (the page asks first). */
export function discardKeptAside() {
  if (view.phase !== "ready") return;
  try {
    browserStorage()?.removeItem(DRAFT_UNREADABLE_KEY);
  } catch {
    // Nothing to do: the page stops offering it either way.
  }
  view = { ...view, keptAside: [] };
  emit();
}

/** The store itself, for tests in Node (a fake `window`, fake timers): what `useCanvasDraft` subscribes to. */
export const canvasDraftStore = { subscribe, getSnapshot };

export function useCanvasDraft(): CanvasDraftView {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribeToOtherTabs(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/**
 * Whether this browser holds a canvas worth continuing — for the cover's
 * "Start your own" / "Continue your canvas". The server and the first client
 * render say no; the label changes after hydration.
 */
function hasDraftSnapshot(): boolean {
  if (view.phase === "ready") return !draftIsEmpty(view.draft);
  try {
    const read = readStoredDraft(window.localStorage.getItem(DRAFT_STORAGE_KEY));
    return read.status === "newer" || (read.status === "ok" && !draftIsEmpty(read.draft));
  } catch {
    return false;
  }
}

export function useHasCanvasDraft(): boolean {
  return useSyncExternalStore(subscribeToOtherTabs, hasDraftSnapshot, () => false);
}

/** The stored value as it is, or null: what a page without a library offers to download. */
function storedTextSnapshot(): string | null {
  try {
    return window.localStorage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useStoredDraftText(): string | null {
  return useSyncExternalStore(subscribeToOtherTabs, storedTextSnapshot, () => null);
}
