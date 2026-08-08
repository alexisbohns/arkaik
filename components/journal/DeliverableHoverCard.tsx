"use client";

import type { ReactNode } from "react";
import { GitMergeIcon, GithubIcon, MilestoneIcon, NetworkIcon, PackageIcon } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { formatEventDateTime } from "@/components/journal/describe-event";
import { SPECIES_NAV_ICONS } from "@/lib/config/species-icons";
import type { SpeciesId } from "@/lib/config/species";
import type { StatusId } from "@/lib/config/statuses";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { prNumberOf, repoFromUrl } from "@/lib/utils/deliverable-pr";
import type { Deliverable } from "@/lib/utils/journal";
import type { Node } from "@/lib/data/types";

/** Beyond this the card is a list rather than a preview; the rest is counted. */
const MAX_NODES = 6;

/**
 * The boxed-icon tile: a 24px rounded square holding a 12px glyph.
 *
 * Exported because the timeline's merge mark is the same tile — one constant,
 * so the mark on the rail and the mark beside a label cannot drift into two
 * sizes of the same idea. Callers add their own surface colour and, where they
 * need it, their own vertical nudge.
 */
export const ICON_TILE = "inline-flex size-6 shrink-0 items-center justify-center rounded-md";

/**
 * The merge mark's purple. The same purple the `releasing` status already uses
 * on the canvas — a shipped pull request and a releasing node are the same
 * moment in the product's life, so they share a hue rather than each picking
 * one.
 *
 * The colour stays on the *tile*. Labels beside these marks are system
 * foreground: purple here means "this is the forge", and a purple word next to
 * a purple box says it twice while making the text harder to read.
 */
export const FORGE_TILE = "bg-purple-500/10 text-purple-600 dark:text-purple-400";

/** The row a boxed icon and its label form together. */
const MARK_ROW = "group inline-flex items-center gap-2 rounded-md text-xs transition-colors";

/**
 * The touched nodes, with their *current* status.
 *
 * The one fact on this page that no row can state on its own: a deliverable
 * records what it changed, the graph records where those things stand now, and
 * only the join says "shipped three views, two still in progress". Shared by
 * every preview that wants it rather than written twice.
 */
function TouchedNodes({ nodes }: { nodes: readonly Node[] }) {
  const overflow = nodes.length - MAX_NODES;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Touched</p>
      {nodes.slice(0, MAX_NODES).map((node) => {
        const Icon = SPECIES_NAV_ICONS[node.species as SpeciesId] ?? PackageIcon;

        return (
          <div key={node.id} className="flex items-center gap-2">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs">{node.title}</span>
            <StatusBadge
              status={node.status as StatusId}
              blockedBy={typeof node.metadata?.blocked_by === "string" ? node.metadata.blocked_by : undefined}
              className="shrink-0"
            />
          </div>
        );
      })}
      {overflow > 0 && (
        <p className="text-xs text-muted-foreground">
          +{overflow} more node{overflow === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

/**
 * Ids with no node behind them are dropped rather than shown as raw strings: a
 * preview repeating an id under a status badge it cannot fill is worse than
 * silence, and the count on the chip should mean "nodes I can tell you about".
 */
function resolveTouched(deliverable: Deliverable, nodesById: Map<string, Node>): Node[] {
  return deliverable.node_ids
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is Node => node !== undefined);
}

/**
 * The preview behind a deliverable's merge mark.
 *
 * It exists to say what the row cannot, which is a real constraint on what
 * belongs here: the untruncated title, the summary (even while the timeline is
 * collapsed, which is when this is most useful), the exact merge time rather
 * than the row's bare date, and the touched nodes' current status.
 *
 * The trigger is the mark, not the row. The mark is also a link, which is the
 * reason `HoverCardTrigger` takes `asChild` — the anchor stays the anchor, and
 * hovering it previews where it goes rather than replacing the click.
 */
export function DeliverableHoverCard({
  deliverable,
  nodesById,
  children,
}: {
  deliverable: Deliverable;
  nodesById: Map<string, Node>;
  children: ReactNode;
}) {
  const prNumber = prNumberOf(deliverable);
  const touched = resolveTouched(deliverable, nodesById);

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" side="right" className="w-80">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold leading-snug">{deliverable.title}</p>
            {/* The forge glyph leads the number rather than the number standing
                alone: "#376" beside a date is ambiguous on a page that also
                numbers releases, and the logo says which registry it belongs to
                in less room than the word would. */}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {prNumber !== null && (
                <>
                  <GithubIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>#{prNumber}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>{formatEventDateTime(deliverable.ts)}</span>
            </p>
          </div>

          {deliverable.summary && (
            <p className="text-xs leading-relaxed text-muted-foreground">{deliverable.summary}</p>
          )}

          {touched.length > 0 && <TouchedNodes nodes={touched} />}

          {(deliverable.platform || deliverable.releaseVersion) && (
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
              {deliverable.platform && (
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {PLATFORM_LABELS[deliverable.platform] ?? deliverable.platform}
                </span>
              )}
              {deliverable.releaseVersion && (
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                  <MilestoneIcon className="size-3" aria-hidden="true" />
                  {deliverable.releaseVersion}
                </span>
              )}
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * A deliverable's two chips: where it came from, and what it moved.
 *
 * These replace the list of node titles the expanded row used to print. That
 * list grew with the PR — a deliverable touching nine nodes wrapped to three
 * lines of grey text nobody read — and said nothing per entry beyond a name.
 * Two chips of fixed size say the same two things and hold the detail behind a
 * hover, so the row's height stops depending on how busy the pull request was.
 */
export function DeliverableChips({
  deliverable,
  nodesById,
}: {
  deliverable: Deliverable;
  nodesById: Map<string, Node>;
}) {
  const prNumber = prNumberOf(deliverable);
  const repo = repoFromUrl(deliverable.url);
  const touched = resolveTouched(deliverable, nodesById);

  // A deliverable with no link and no resolvable node has nothing to chip.
  if (deliverable.url === undefined && touched.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 pt-1">
      {deliverable.url && (
        <HoverCard openDelay={200} closeDelay={100}>
          <HoverCardTrigger asChild>
            <a
              href={deliverable.url}
              target="_blank"
              rel="noreferrer"
              aria-label={
                prNumber === null
                  ? `Open pull request: ${deliverable.title}`
                  : `Open pull request #${prNumber}`
              }
              className={`${MARK_ROW} text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`}
            >
              <span className={`${ICON_TILE} ${FORGE_TILE} group-hover:bg-purple-500/20`}>
                <GitMergeIcon className="size-3" aria-hidden="true" />
              </span>
              {/* The number when there is one; otherwise the word, so the mark
                  is never a box with nothing beside it. */}
              {prNumber === null ? "Pull request" : `#${prNumber}`}
            </a>
          </HoverCardTrigger>
          <HoverCardContent align="start" side="top" className="w-64">
            <div className="flex items-start gap-2.5">
              <GithubIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm font-semibold">
                  {prNumber === null ? "Pull request" : `#${prNumber}`}
                </p>
                {repo && <p className="truncate text-xs text-muted-foreground">{repo}</p>}
                <p className="text-xs text-muted-foreground">Merged {formatEventDateTime(deliverable.ts)}</p>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      )}

      {touched.length > 0 && (
        <HoverCard openDelay={200} closeDelay={100}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              // Not a link: there is no one node to go to. The button exists so
              // the mark is reachable and the preview is not mouse-only trivia
              // hanging off a `<span>`.
              className={`${MARK_ROW} cursor-default text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`}
            >
              <span className={`${ICON_TILE} bg-muted text-muted-foreground group-hover:bg-accent`}>
                <NetworkIcon className="size-3" aria-hidden="true" />
              </span>
              {touched.length} node{touched.length === 1 ? "" : "s"}
            </button>
          </HoverCardTrigger>
          <HoverCardContent align="start" side="top" className="w-72">
            <TouchedNodes nodes={touched} />
          </HoverCardContent>
        </HoverCard>
      )}
    </div>
  );
}
