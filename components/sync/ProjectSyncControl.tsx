"use client";

import { useState } from "react";
import { CheckCircle2Icon, CloudIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuthStatus } from "@/lib/hooks/useAuthStatus";
import { useSyncStatus } from "@/lib/sync/use-sync-status";
import { syncManager, type SyncStatus } from "@/lib/sync/sync-manager";

interface ProjectSyncControlProps {
  projectId: string;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function SyncStatusLabel({ status }: { status: SyncStatus }) {
  switch (status.state) {
    case "idle":
      return null;
    case "pending":
      return <span className="text-xs text-muted-foreground">Backup pending…</span>;
    case "syncing":
      return <span className="text-xs text-muted-foreground">Backing up…</span>;
    case "backed-up":
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2Icon className="size-3.5 text-emerald-600 dark:text-emerald-500" />
          Backed up {formatRelativeTime(status.at)}
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-xs text-destructive" title={status.message}>
          <TriangleAlertIcon className="size-3.5" />
          Backup failed
        </span>
      );
    case "limit-exceeded":
      return (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <TriangleAlertIcon className="size-3.5" />
          {status.limit}-entity limit exceeded ({status.actual}) — {status.tier} tier
        </span>
      );
  }
}

/**
 * Per-project Synk status + manual "Back up now" action (docs/spec/services.md
 * § Synk → Client sync engine: "a manual 'Back up now' action, and visible
 * per-project status"). Renders nothing when auth is unconfigured or the
 * caller is signed out — mirrors `components/auth/AuthButton.tsx`'s graceful
 * absence: this control is the *only* thing that appears once signed in, no
 * local feature is gated on it.
 */
export function ProjectSyncControl({ projectId }: ProjectSyncControlProps) {
  const auth = useAuthStatus();
  const status = useSyncStatus(projectId);
  const [backingUp, setBackingUp] = useState(false);

  if (auth.state !== "signed-in") return null;

  async function handleBackupNow() {
    setBackingUp(true);
    try {
      await syncManager.backupNow(projectId);
      const latest = syncManager.getStatus(projectId);
      if (latest.state === "backed-up") {
        toast.success("Backed up to Synk.");
      } else if (latest.state === "limit-exceeded") {
        toast.error(`${latest.limit}-entity limit exceeded (${latest.actual}) — ${latest.tier} tier.`);
      } else if (latest.state === "error") {
        toast.error(latest.message);
      }
    } finally {
      setBackingUp(false);
    }
  }

  const busy = backingUp || status.state === "syncing";

  return (
    <div className="flex items-center gap-2">
      <SyncStatusLabel status={status} />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 cursor-pointer px-2 text-xs"
        disabled={busy}
        onClick={() => void handleBackupNow()}
      >
        {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : <CloudIcon className="size-3.5" />}
        Back up
      </Button>
    </div>
  );
}
