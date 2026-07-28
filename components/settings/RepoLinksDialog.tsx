"use client";

import { useCallback, useEffect, useState } from "react";
import { GithubIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLATFORMS } from "@/lib/config/platforms";

/**
 * Linking a hosted project to the repositories that implement it.
 *
 * These links are what the GitHub webhook resolves a delivery against — without
 * one, a PR in that repo finds no project and nothing happens. So this dialog is
 * the difference between the PR-transition feature existing and being reachable.
 *
 * THE PLATFORM CHOICE IS THE POINT. Recording which platform a repository builds
 * for means a PR merged there marks only that platform shipped, with no per-PR
 * annotation and no way to forget — and the remaining platforms then show up as
 * a genuine parity gap rather than false parity.
 *
 * That guarantee is now literally true, which it was not when this comment was
 * written: a PR here naming an acceptance that does NOT list the chosen platform
 * used to fall back to an UNSCOPED ref, which moves the base status and marks
 * the acceptance shipped on every platform it does list — so an iOS-linked repo
 * could mark a web-only acceptance shipped on web. The planner now refuses that
 * case and reports it (lib/services/github/pull-request.ts, `resolveRefScopes`),
 * so choosing a platform here can never claim a different one.
 *
 * It is the DEFAULT, not the last word: a PR can name its own platform with
 * `AC-guest-checkout@ios`, which wins over whatever is chosen here. That is what
 * makes a monorepo workable — link it as "All platforms" and scope per PR — so
 * the helper text below has to say so, or people will link a monorepo three
 * times and wonder why they cannot.
 *
 * "ALL PLATFORMS" IS A CLAIM, NOT AN ABSTENTION, and the helper text has to say
 * that too. It leaves PRs moving the acceptance's BASE status, and
 * `resolvePlatformStatus` falls back to the base for every platform with no
 * entry of its own (packages/schema/src/acceptance.ts) — so one unscoped merge
 * marks the acceptance delivered on every platform that has no per-platform
 * status of its own, which for a fresh acceptance is all of them, and
 * `hasParityGap` goes quiet. A PARTLY pinned acceptance is worse rather than
 * safer: the pinned platforms hold, the rest inherit "live", and the parity gap
 * the pins were recording is erased. Reading this option as "records nothing
 * per-platform" is exactly
 * backwards, which is why the suffix is described below as required rather than
 * as a refinement.
 */

interface RepoLink {
  repoFullName: string;
  platform: string | null;
  createdAt: string;
}

/** The value the Select uses for "this repo builds every platform". */
const ALL_PLATFORMS = "__all__";

export interface RepoLinksDialogProps {
  projectId: string;
  projectTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RepoLinksDialog({ projectId, projectTitle, open, onOpenChange }: RepoLinksDialogProps) {
  const [links, setLinks] = useState<RepoLink[] | null>(null);
  const [repo, setRepo] = useState("");
  const [platform, setPlatform] = useState<string>(ALL_PLATFORMS);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/graph/projects/${encodeURIComponent(projectId)}/repos`, {
      cache: "no-store",
    });
    if (!res.ok) {
      setLinks([]);
      return;
    }
    setLinks(((await res.json()) as { repos: RepoLink[] }).repos);
  }, [projectId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  async function link() {
    const name = repo.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/graph/projects/${encodeURIComponent(projectId)}/repos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo_full_name: name,
          platform: platform === ALL_PLATFORMS ? null : platform,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        toast.error(body.message ?? body.error ?? "Could not link that repository.");
        return;
      }
      setRepo("");
      setPlatform(ALL_PLATFORMS);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function unlink(name: string) {
    const res = await fetch(
      `/api/graph/projects/${encodeURIComponent(projectId)}/repos?repo=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    if (!res.ok && res.status !== 404) {
      toast.error("Could not remove that link.");
      return;
    }
    await refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Linked repositories</DialogTitle>
          <DialogDescription>
            Pull requests in these repositories can move {projectTitle}&rsquo;s acceptances. Naming the
            platform a repository builds for means a merge there marks only that platform shipped.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="owner/repository"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void link();
              }}
              className="flex-1"
            />
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PLATFORMS}>All platforms</SelectItem>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => void link()} disabled={saving || !repo.trim()}>
              {saving ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              <span>Link</span>
            </Button>
          </div>

          {links === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repositories linked yet. Until one is, pull requests cannot move this project&rsquo;s
              acceptances.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {links.map((entry) => (
                <li key={entry.repoFullName} className="flex items-center gap-2 px-3 py-2">
                  <GithubIcon className="size-4 shrink-0 text-muted-foreground" />
                  <code className="min-w-0 flex-1 truncate font-mono text-sm">{entry.repoFullName}</code>
                  <Badge variant="outline" className="shrink-0 font-normal">
                    {entry.platform
                      ? (PLATFORMS.find((p) => p.id === entry.platform)?.label ?? entry.platform)
                      : "All platforms"}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => void unlink(entry.repoFullName)}>
                    <Trash2Icon />
                    <span className="sr-only">Unlink {entry.repoFullName}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            A pull request moves an acceptance when its title or body mentions the acceptance id (for
            example <code className="font-mono">AC-guest-checkout</code>), and the project has opted in
            with <code className="font-mono">ref_policy</code>. A pull request can name its own platform
            with <code className="font-mono">AC-guest-checkout@ios</code>, which overrides the choice
            above — link a monorepo as <em>All platforms</em> and scope <em>every</em> pull request that
            way. Under <em>All platforms</em>, a pull request that names no platform moves the base
            status, which marks the acceptance shipped on every platform that has no per-platform
            status of its own — not on none. When a repository is linked to one platform and a pull
            request names an acceptance that does not list it, nothing is moved at all — the delivery
            response says so rather than falling back to marking every platform shipped.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
