"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function getSnapshot(): boolean {
  return document.visibilityState === "hidden";
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Whether the page is hidden (a background tab, a minimised window), kept
 * current. The server renders `false`; the first client render after
 * hydration corrects it. Derive from it rather than copying it into state.
 */
export function useDocumentHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
