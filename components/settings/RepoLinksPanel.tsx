"use client";

import { useCallback, useEffect, useState } from "react";
import { GithubIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
 * This was a dialog opened from a button on the projects listing. It is a panel
 * now, and it lives on the project's Settings page: repository links are
 * configuration, and configuration belongs inside the project rather than on
 * the card you click to get there.
 *
 * These links are what the GitHub webhook resolves a delivery against — without
 * one, a PR in that repo finds no project and nothing happens. So this panel is
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
 * `AC-guest-checkout@ios`, which wins over whatever is chosen here.
 *
 * A LINK IS IDENTIFIED BY (REPOSITORY, PATH), NOT BY REPOSITORY, and that is
 * what makes a monorepo workable — which is a reversal of the advice this file
 * used to give. The helper text below said to link a monorepo as "All
 * platforms" and write `@platform` in every pull request, and called the suffix
 * REQUIRED, because forgetting it is an over-claim rather than an omission (see
 * the last paragraph). Linking `apps/ios` → iOS and `apps/webapp` → Web instead
 * lets the delivery read the pull request's changed files and infer the
 * platform, so there is nothing left to forget. The suffix goes back to being
 * an override, and people who link a monorepo three times are now right.
 *
 * The precedence, resolved in lib/services/github/pull-request.ts: an explicit
 * `@platform` in the mention, then the path-scoped link the changed files
 * landed in, then a link with no path. A link with no path covers the WHOLE
 * repository, so it is both the pre-path arrangement and the stated fallback
 * for anything the paths do not cover.
 *
 * A PATH THAT MATCHES NOTHING CLAIMS NOTHING. When every link is path-scoped
 * and a pull request touches none of those paths — or arkaik cannot read the
 * changed files at all, because this deployment has no GitHub App private key —
 * the delivery attaches no ref and promotes nothing, and reports that. It does
 * not borrow a platform from elsewhere: "I do not know which app this pull
 * request is" answered with an unscoped ref is a claim about every platform at
 * once (see below).
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
 * per-platform" is exactly backwards, which is why the helper text below spells
 * out what an unscoped merge marks instead of leaving "All platforms" to be
 * read as an abstention.
 */

interface RepoLink {
  repoFullName: string;
  platform: string | null;
  /**
   * The subtree this link covers, `""` for the whole repository. Part of the
   * link's IDENTITY (db/migrations/010_repo_path_prefix.sql), which is why the
   * list is keyed on it and why DELETE has to carry it: keying on the repository
   * alone renders two links to one monorepo as one row and unlinks the wrong one.
   */
  pathPrefix: string;
  createdAt: string;
}

/** The value the Select uses for "this repo builds every platform". */
const ALL_PLATFORMS = "__all__";

export interface RepoLinksPanelProps {
  projectId: string;
}

export function RepoLinksPanel({ projectId }: RepoLinksPanelProps) {
  const [links, setLinks] = useState<RepoLink[] | null>(null);
  const [repo, setRepo] = useState("");
  const [path, setPath] = useState("");
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

  // On the page rather than behind an `open` flag: the panel is only rendered
  // once its section is on screen, so mounting is the moment to load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function link() {
    const name = repo.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/graph/projects/${encodeURIComponent(projectId)}/repos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // An empty `path` is the whole repository, which is what the route reads
        // an absent one as too — so this posts exactly the row it used to before
        // paths existed.
        body: JSON.stringify({
          repo_full_name: name,
          platform: platform === ALL_PLATFORMS ? null : platform,
          path: path.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        toast.error(body.message ?? body.error ?? "Could not link that repository.");
        return;
      }
      setRepo("");
      setPath("");
      setPlatform(ALL_PLATFORMS);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  /**
   * Remove ONE link. The path travels with the repository because it is half of
   * the link's identity — dropping it here would delete the whole-repository
   * link of a monorepo whose `apps/ios` row the user clicked, and the API,
   * which deletes exactly one row, would answer 404 while the wrong row stayed.
   */
  async function unlink(name: string, pathPrefix: string) {
    const res = await fetch(
      `/api/graph/projects/${encodeURIComponent(projectId)}/repos` +
        `?repo=${encodeURIComponent(name)}&path=${encodeURIComponent(pathPrefix)}`,
      { method: "DELETE" },
    );
    if (!res.ok && res.status !== 404) {
      toast.error("Could not remove that link.");
      return;
    }
    await refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
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
          {/* Empty is the whole repository, so the placeholder has to say what
              leaving it alone means — otherwise it reads as a required field. */}
          <Input
            placeholder="apps/ios — blank for all of it"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void link();
            }}
            className="font-mono sm:w-56"
          />
        </div>
        <div className="flex gap-2">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="flex-1">
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
          <Button
            className="cursor-pointer"
            onClick={() => void link()}
            disabled={saving || !repo.trim()}
          >
            {saving ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
            <span>Link</span>
          </Button>
        </div>
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
          {/* Keyed on repository AND path: one monorepo can hold several
              links, and keying on the name alone would make React reuse one
              row for all of them. */}
          {links.map((entry) => (
            <li
              key={`${entry.repoFullName}#${entry.pathPrefix}`}
              className="flex items-center gap-2 px-3 py-2"
            >
              <GithubIcon className="size-4 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 truncate font-mono text-sm">
                {entry.repoFullName}
                {entry.pathPrefix ? (
                  <span className="text-muted-foreground">/{entry.pathPrefix}</span>
                ) : null}
              </code>
              <Badge variant="outline" className="shrink-0 font-normal">
                {entry.platform
                  ? (PLATFORMS.find((p) => p.id === entry.platform)?.label ?? entry.platform)
                  : "All platforms"}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer"
                onClick={() => void unlink(entry.repoFullName, entry.pathPrefix)}
              >
                <Trash2Icon />
                <span className="sr-only">
                  Unlink {entry.repoFullName}
                  {entry.pathPrefix ? ` (${entry.pathPrefix})` : ""}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        A pull request moves an acceptance when its title or body mentions the acceptance id (for
        example <code className="font-mono">AC-guest-checkout</code>), and the project has opted in
        with <code className="font-mono">ref_policy</code>. Leave the path blank for a repository
        that builds one thing. For a monorepo, link it <em>once per app</em> with the folder that
        app lives in — <code className="font-mono">apps/ios</code> as iOS,{" "}
        <code className="font-mono">apps/webapp</code> as Web — and the platform is read from the
        files each pull request changed, with nothing to remember. A path matches whole folders and
        is case-sensitive: <code className="font-mono">apps/ios</code> never matches{" "}
        <code className="font-mono">apps/ios-legacy</code> or <code className="font-mono">Apps/iOS</code>.
      </p>
      <p className="text-xs text-muted-foreground">
        A pull request can still name its own platform with{" "}
        <code className="font-mono">AC-guest-checkout@ios</code>, which overrides both the path and
        the choice above. A link with no path covers the whole repository and is what anything
        outside every path falls back to; with no such link, a pull request touching none of the
        paths moves nothing and the delivery response says why — as does one arkaik could not read
        the changed files for, which needs this deployment&rsquo;s GitHub App private key. Under{" "}
        <em>All platforms</em>, a pull request that names no platform moves the base status, which
        marks the acceptance shipped on every platform that has no per-platform status of its own —
        not on none. When a link names one platform and a pull request names an acceptance that does
        not list it, nothing is moved at all — the delivery response says so rather than falling
        back to marking every platform shipped.
      </p>
    </div>
  );
}
