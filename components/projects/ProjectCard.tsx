"use client";

import Link from "next/link";
import { CloudUploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProjectSyncControl } from "@/components/sync/ProjectSyncControl";
import type { ProjectSummary } from "@/lib/data/data-provider";

interface ProjectCardProps {
  summary: ProjectSummary;
  /** True when the signed-in user has somewhere to move a local project to. */
  canHost: boolean;
  /** True while THIS project is being copied into the account. */
  moving: boolean;
  onMoveToAccount: () => void;
}

/**
 * One project card. THE CARD IS THE OPEN BUTTON.
 *
 * It used to carry a row of buttons — Open, Publish, Repos, Delete — which made
 * the common action (open it) one target among four, and put a destructive one
 * next to it. Each of the others now lives where it belongs once you are inside
 * the project: Publish in the sidebar footer, repositories and deletion on the
 * project's Settings page. What is left here is the one thing a listing is for.
 *
 * The title is a real `<Link>` stretched over the whole card with
 * `after:absolute after:inset-0`, rather than an `onClick` on the div: that
 * keeps keyboard focus, the browser status bar, and open-in-new-tab working,
 * and announces one link per card to a screen reader instead of a clickable
 * nothing. Anything else interactive on the card has to sit above that overlay
 * — hence `relative z-10` on the sync control and the move button.
 *
 * "Move to account" stays, because with sections it is the ONLY way a Lokal or
 * Synked project becomes Hosted. No "In your account" badge: the section
 * heading above already says so.
 */
export function ProjectCard({ summary, canHost, moving, onMoveToAccount }: ProjectCardProps) {
  const showMove = !summary.hosted && canHost;

  return (
    <Card className="relative gap-4 transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-within:border-foreground/20">
      <CardHeader>
        <CardTitle className="truncate">
          <Link
            href={`/project/${summary.project.id}`}
            className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {summary.project.title}
          </Link>
        </CardTitle>
        {summary.project.description && (
          <CardDescription>{summary.project.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {summary.nodeCount} node{summary.nodeCount !== 1 ? "s" : ""} ·{" "}
          {summary.edgeCount} edge{summary.edgeCount !== 1 ? "s" : ""}
        </p>
      </CardContent>
      {/* Synk backs up browser-held projects; a hosted project is already on the
          server and has nothing to back up — so a hosted card has no footer at
          all, and the card is nothing but its link. `empty:hidden` covers the
          signed-out case, where both children render nothing and the bare
          footer would otherwise show as padding under the counts. */}
      {summary.hosted ? null : (
        <CardFooter className="relative z-10 flex flex-wrap items-center gap-2 empty:hidden">
          <ProjectSyncControl projectId={summary.project.id} />
          {showMove ? (
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              disabled={moving}
              onClick={onMoveToAccount}
            >
              <CloudUploadIcon />
              {moving ? "Moving…" : "Move to account"}
            </Button>
          ) : null}
        </CardFooter>
      )}
    </Card>
  );
}
