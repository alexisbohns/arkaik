"use client";

import { useEffect, useReducer, useState } from "react";
import { CloudUploadIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuthStatus } from "@/lib/hooks/useAuthStatus";
import { syncManager } from "@/lib/sync/sync-manager";
import type { ProjectBundle } from "@/lib/data/types";

const DISMISSED_KEY = "arkaik:synk-onboarding-dismissed";

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Best-effort only — a full localStorage or private-mode browser just
    // means the banner may reappear next session, not a functional failure.
  }
}

interface SynkOnboardingBannerProps {
  /** The already-loaded local project list (app/projects/page.tsx owns the fetch) — avoids a second listProjects() round-trip. */
  projects: ProjectBundle[];
}

/**
 * Lokal → Synk onboarding, "the primary conversion funnel"
 * (docs/spec/services.md § Synk → Client sync engine: "after first sign-in,
 * existing local projects are offered for backup with one click each — the
 * data never moves, it *gains* a backup. No migration of storage, no
 * account-gating of local features"). Deliberately lightweight: a
 * dismissible inline banner, not a modal wall — hidden entirely for signed-
 * out/unconfigured users (this is the only thing that changes on sign-in),
 * and it disappears on its own once every candidate is backed up.
 */
export function SynkOnboardingBanner({ projects }: SynkOnboardingBannerProps) {
  const auth = useAuthStatus();
  const [serverProjectIds, setServerProjectIds] = useState<Set<string> | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const [backingUpId, setBackingUpId] = useState<string | null>(null);

  // Re-render whenever ANY project's live sync status changes, so a project
  // that just got backed up (via this banner or the per-card control) drops
  // out of the candidate list without a page reload.
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0);
  useEffect(() => syncManager.subscribe(forceUpdate), []);

  useEffect(() => {
    if (auth.state !== "signed-in") {
      setServerProjectIds(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/synk/projects", { cache: "no-store" });
        if (!res.ok) {
          if (active) setServerProjectIds(new Set());
          return;
        }
        const body = (await res.json()) as { projects?: Array<{ project_id: string }> };
        if (active) setServerProjectIds(new Set((body.projects ?? []).map((p) => p.project_id)));
      } catch {
        if (active) setServerProjectIds(new Set());
      }
    })();
    return () => {
      active = false;
    };
  }, [auth.state]);

  if (auth.state !== "signed-in" || serverProjectIds === null) return null;

  const candidates = projects.filter((bundle) => {
    const id = bundle.project.id;
    if (serverProjectIds.has(id)) return false;
    if (dismissed.has(id)) return false;
    if (syncManager.getStatus(id).state === "backed-up") return false; // just backed up this session
    return true;
  });

  if (candidates.length === 0) return null;

  function dismissAll() {
    const next = new Set(dismissed);
    for (const bundle of candidates) next.add(bundle.project.id);
    setDismissed(next);
    writeDismissed(next);
  }

  async function backupOne(projectId: string) {
    setBackingUpId(projectId);
    try {
      await syncManager.backupNow(projectId);
      const status = syncManager.getStatus(projectId);
      if (status.state === "backed-up") {
        toast.success("Backed up to Synk.");
      } else if (status.state === "limit-exceeded") {
        toast.error(`${status.limit}-entity limit exceeded (${status.actual}) — ${status.tier} tier.`);
      } else if (status.state === "error") {
        toast.error(status.message);
      }
    } finally {
      setBackingUpId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <CloudUploadIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Back up your local projects to Synk</p>
            <p className="text-xs text-muted-foreground">
              Your data stays on this device — Synk only adds a backup. One click each, nothing moves.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 cursor-pointer"
          onClick={dismissAll}
          aria-label="Dismiss backup suggestions"
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <ul className="flex flex-wrap gap-2">
        {candidates.map((bundle) => (
          <li key={bundle.project.id}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="cursor-pointer"
              disabled={backingUpId === bundle.project.id}
              onClick={() => void backupOne(bundle.project.id)}
            >
              {backingUpId === bundle.project.id ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              Back up &quot;{bundle.project.title}&quot;
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
