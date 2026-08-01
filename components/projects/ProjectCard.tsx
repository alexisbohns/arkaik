"use client";

import { CloudUploadIcon, GithubIcon, Share2Icon } from "lucide-react";

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
  onOpen: () => void;
  onPublish: () => void;
  onRepos: () => void;
  onMoveToAccount: () => void;
  onDelete: () => void;
}

/**
 * One project card.
 *
 * No "In your account" badge: the section heading above already says so, and
 * repeating it on every card was noise. "Move to account" stays, because with
 * sections it is now the ONLY way a Lokal or Synked project becomes Hosted.
 */
export function ProjectCard({
  summary,
  canHost,
  moving,
  onOpen,
  onPublish,
  onRepos,
  onMoveToAccount,
  onDelete,
}: ProjectCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{summary.project.title}</CardTitle>
        {summary.project.description && (
          <CardDescription>{summary.project.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {summary.nodeCount} node{summary.nodeCount !== 1 ? "s" : ""} ·{" "}
          {summary.edgeCount} edge{summary.edgeCount !== 1 ? "s" : ""}
        </p>
        {/* Synk backs up browser-held projects; a hosted project is already on
            the server and has nothing to back up. */}
        {summary.hosted ? null : <ProjectSyncControl projectId={summary.project.id} />}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="cursor-pointer" onClick={onOpen}>
          Open
        </Button>
        <Button size="sm" variant="outline" className="cursor-pointer" onClick={onPublish}>
          <Share2Icon />
          Publish
        </Button>
        {summary.hosted ? (
          <Button size="sm" variant="outline" className="cursor-pointer" onClick={onRepos}>
            <GithubIcon />
            Repos
          </Button>
        ) : null}
        {!summary.hosted && canHost ? (
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
        <Button size="sm" variant="outline" className="cursor-pointer" onClick={onDelete}>
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
}
