"use client";

import { useSyncExternalStore } from "react";

import { syncManager, type SyncStatus } from "./sync-manager";

/**
 * `useSyncExternalStore`-friendly view of one project's Synk backup status
 * (docs/spec/services.md § Synk → Client sync engine: "visible per-project
 * status"). Re-renders whenever {@link syncManager} reports a change for
 * ANY project — cheap at this app's scale, and `syncManager.getStatus`
 * returns a stable object reference for an unchanged project, so React skips
 * re-rendering components whose own project didn't change.
 */
export function useSyncStatus(projectId: string): SyncStatus {
  return useSyncExternalStore(
    syncManager.subscribe,
    () => syncManager.getStatus(projectId),
    () => syncManager.getStatus(projectId),
  );
}
