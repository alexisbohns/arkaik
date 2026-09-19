"use client";

import { ExternalLinkIcon } from "lucide-react";
import { CROSS_SURFACE_ID, type QualitySection } from "@arkaik/schema";
import { PanelSection, PANEL_GUTTER } from "@/components/panels/PanelSection";
import { AcceptedRiskCallout } from "@/components/quality/AcceptedRiskCallout";
import { FindingMark } from "@/components/quality/FindingMark";
import { FindingScales } from "@/components/quality/FindingScales";
import { VERDICT_LABEL } from "@/components/quality/quality-styles";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { Node } from "@/lib/data/types";
import type { FindingRow } from "@/lib/utils/quality";
import { cn } from "@/lib/utils";

interface FindingDetailPanelProps {
  findingId: string;
  /**
   * The title the descriptor carried. Only ever shown when the id resolves to
   * nothing — a live row's own title is the truth, and it is what the panel
   * renders.
   */
  title: string;
  /**
   * Every finding in the section, denormalized once by `ProjectPanels`. The
   * panel picks its own out by id rather than being handed a row, so an audit
   * arriving under an open panel reaches it.
   */
  findings: FindingRow[];
  /** The audit profile, for naming the surface the way the matrix names it. */
  section?: QualitySection;
  /** The graph, so a linked node reads as a title rather than as an id. */
  nodesById: ReadonlyMap<string, Node>;
  onOpenNode: (nodeId: string) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/**
 * A surface id as the profile titles it.
 *
 * `cross-surface` is a findings-only lens no profile declares, so it is named
 * here rather than left to print its raw slug — the rule `FindingCard` follows,
 * and the reason a reader scoped to one surface cannot mistake it for theirs.
 */
function surfaceTitleOf(surface: string, section?: QualitySection): string {
  if (surface === CROSS_SURFACE_ID) return "Cross-surface";
  return section?.profile?.surfaces?.find((candidate) => candidate?.id === surface)?.title ?? surface;
}

/**
 * What identifies the panel in the stack's header: the finding's own mark, its
 * title, and the surface it was filed on. The close button belongs to
 * `PanelStack`, which owns every panel's frame.
 *
 * The mark is the same component the board draws down its rail, which is how
 * the panel says it is the row the reader just clicked.
 */
export function FindingDetailPanelHeader({
  findingId,
  title,
  findings,
  section,
}: Pick<FindingDetailPanelProps, "findingId" | "title" | "findings" | "section">) {
  const row = findings.find((candidate) => candidate.id === findingId);

  return (
    <>
      {row && <FindingMark row={row} />}
      <span className="truncate text-sm font-medium">{row?.title ?? title}</span>
      {row && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {surfaceTitleOf(row.surface, section)}
        </span>
      )}
    </>
  );
}

/**
 * One finding, in full.
 *
 * A finding is an entity, so it is read the way every other entity in this app
 * is read — in a panel. It used to be read by expanding a row in place, which
 * cost the board its scannability exactly when a reader needed it: detail,
 * evidence, a verification note, the linked nodes and two identifiers is
 * several screens, and the rows under it went off the bottom.
 *
 * Addressless in the stack — see the head of `lib/utils/project-panels.ts`. The
 * Findings page owns `?finding=`.
 *
 * Read-only, like the criterion and cell panels beside it. Resolving a finding
 * and accepting a risk are journal writes the CLI and the MCP server make
 * (`quality.finding.resolved`, `quality.finding.accepted`); this app has no
 * write path for either, and inventing one here would be inventing it in the
 * wrong place.
 *
 * Every section but Reference is conditional on having something to say, the
 * rule `CriterionDetailPanel` states: a heading over nothing reads as a panel
 * that failed to load rather than as a finding nobody wrote evidence for.
 * Reference is the exception because it can never be empty — a row that
 * resolved has an `id`, which is the thing that section exists to hand over.
 */
export function FindingDetailPanel({
  findingId,
  title,
  findings,
  section,
  nodesById,
  onOpenNode,
  onOpenCriterion,
}: FindingDetailPanelProps) {
  // The second linear scan of the same list this render — the header ran the
  // first. Deliberate, and the shape `CriterionDetailPanel` already uses:
  // `criterionOf` is an unmemoized `find` its header and its body each call
  // for themselves. A few hundred rows scanned twice is nothing next to a
  // context threaded through the stack to carry one row, and the panel takes
  // an id rather than a row for the reason `findingId` documents above.
  const row = findings.find((candidate) => candidate.id === findingId);

  // Say so rather than rendering nothing. This is where a stale `?finding=`
  // link lands, and where a re-imported bundle that dropped the finding leaves
  // an open panel — and in both cases a blank body would read as a bug.
  if (!row) {
    return (
      <div className={cn(PANEL_GUTTER, "min-h-0 flex-1 overflow-y-auto py-5 lg:py-6")}>
        <EmptyState
          message={
            <>
              This audit carries no finding with the id{" "}
              <span className="font-mono">{findingId}</span>
              {title !== "" ? ` (“${title}”)` : ""}. A later import may have dropped it, or the link
              may be out of date.
            </>
          }
        />
      </div>
    );
  }

  const verdict = row.verification?.verdict;
  const acceptedRisk = row.status === "accepted-risk";
  // The guard that keeps one sentence from appearing twice: a finding carries
  // no dedicated note field, so an accepted risk's rationale is the refutation
  // pass's note when it wrote one and the filed detail otherwise — and the
  // detail is also what the Detail section renders.
  //
  // `||` rather than `??`, because `""` is not a note somebody wrote.
  const acceptedNote = acceptedRisk ? row.verification?.note || row.detail : undefined;

  return (
    // No `opacity-70` on a decided finding, unlike the card: dimming says "this
    // row is history" to somebody scanning a board, and there is no board here
    // — the reader asked for this one record, and greying what they asked for
    // reads as broken rather than as filed away.
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
      {/* The identity block. The header states the same three things in one
          truncating row; here the title gets to wrap, and the parameters a
          reader triages from get a line each. */}
      <div className={cn(PANEL_GUTTER, "flex flex-col gap-2")}>
        <p className="text-sm font-medium leading-relaxed">{row.title}</p>

        {/* Which criterion this answers to, and on which surface — what
            somebody quotes when they argue it. Its own line rather than
            fighting five numbers for space. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => onOpenCriterion(row.criterionId, row.surface)}
            className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-muted hover:text-foreground"
            title={`Open ${row.criterionName}`}
          >
            {row.criterionId}
          </button>
          {row.criterionName !== row.criterionId && <span>{row.criterionName}</span>}
          {row.surface === CROSS_SURFACE_ID ? (
            <Badge variant="outline" className="font-normal">
              Cross-surface
            </Badge>
          ) : (
            <span title={row.surface}>· {surfaceTitleOf(row.surface, section)}</span>
          )}
        </div>

        {/* The scales. The priority is not repeated: it is the mark in the
            header, the same square the rail carried. */}
        <FindingScales row={row} />
      </div>

      {/* An accepted risk is a decision, so it reads as one — the decision
          log's bordered row with its status stated, first thing under the
          identity block. Somebody already weighed this and said "not now", and
          burying that invites the next reader to re-litigate it. */}
      <AcceptedRiskCallout note={acceptedNote} className={PANEL_GUTTER} />

      {row.detail !== "" && row.detail !== acceptedNote && (
        <PanelSection title="Detail">
          <p className="text-sm leading-relaxed">{row.detail}</p>
        </PanelSection>
      )}

      {row.evidence !== "" && (
        <PanelSection title="Evidence">
          {/* Monospace and preserved line breaks: this field is where
              `file:line` citations live, and a citation reflowed into prose is
              a citation nobody can paste into an editor. */}
          <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
            {row.evidence}
          </p>
        </PanelSection>
      )}

      {verdict && row.verification?.note && row.verification.note !== acceptedNote && (
        <PanelSection title="Verification">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{VERDICT_LABEL[verdict]}</span> —{" "}
            {row.verification.note}
          </p>
        </PanelSection>
      )}

      {row.nodeIds.length > 0 && (
        <PanelSection title="In the graph">
          <div className="flex flex-wrap gap-1.5">
            {row.nodeIds.map((nodeId) => {
              const node = nodesById.get(nodeId);
              return (
                <button
                  key={nodeId}
                  type="button"
                  onClick={() => onOpenNode(nodeId)}
                  // Still a button when the id resolves to nothing: a finding
                  // filed against a node that has since been deleted is a fact
                  // about the audit, and a silently dropped chip would hide it.
                  // The panel it opens says so.
                  title={node ? nodeId : `${nodeId} — not in this project's graph`}
                  className={cn(
                    "max-w-full truncate rounded border px-1.5 py-0.5 text-xs transition-colors hover:bg-muted",
                    node ? "text-foreground" : "border-dashed font-mono text-muted-foreground",
                  )}
                >
                  {node?.title ?? nodeId}
                </button>
              );
            })}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Reference">
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {/* What somebody pastes into an issue or hands to `arkaik kritik`. */}
          <span className="select-all font-mono">{row.id}</span>
          {row.issueUrl && (
            // `break-all` on the text and `shrink-0` on the icon: a GitHub
            // issue URL is long enough to be cut off mid-path rather than
            // wrapped.
            <a
              href={row.issueUrl}
              target="_blank"
              rel="nofollow noreferrer"
              className="inline-flex min-w-0 max-w-full items-start gap-1.5 underline underline-offset-4 hover:text-foreground"
            >
              <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-all">{row.issueUrl}</span>
            </a>
          )}
        </div>
      </PanelSection>
    </div>
  );
}
