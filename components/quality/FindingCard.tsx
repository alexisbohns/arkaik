"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { CROSS_SURFACE_ID, type QualityFinding } from "@arkaik/schema";
import type { Node } from "@/lib/data/types";
import type { FindingRow } from "@/lib/utils/quality";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  COST_CHIP,
  COST_HINT,
  COST_TERM,
  FINDING_STATUS_LABEL,
} from "@/components/quality/quality-styles";
import { ScaleChip } from "@/components/quality/ScaleChip";
import { SeverityPill } from "@/components/quality/SeverityPill";

interface FindingCardProps {
  row: FindingRow;
  /** The graph, for naming a finding's linked nodes. A `Map` satisfies this. */
  nodesById: ReadonlyMap<string, Node>;
  /**
   * `surface id -> title`, built once on the page. The card names the surface
   * the way the matrix's column header and the Surface menu name it; the id
   * itself stays one hover away, and is the fallback for a surface the profile
   * never titled — `cross-surface`, above all, which no profile declares.
   */
  surfaceTitles: ReadonlyMap<string, string>;
  onOpenNode: (nodeId: string) => void;
  /**
   * Opens the criterion this finding answers to — and, by its absence, says the
   * reader is already inside it.
   *
   * The criterion chip is a control, not a label: in the criterion panel it
   * would re-open the panel it is drawn in, under a heading that already names
   * the same criterion. So an omitted handler drops the chip and the name with
   * it, rather than leaving a dead button behind.
   */
  onOpenCriterion?: (criterionId: string, surface: string) => void;
}

/**
 * The refutation pass's verdict in prose (SPEC §6.5). `DOWNGRADED` is the one
 * that has to be spelled out: a finding the pass argued *down* still stands,
 * and a reader who takes it for a refusal will skip a real defect.
 */
const VERDICT_LABEL: Record<NonNullable<QualityFinding["verification"]>["verdict"], string> = {
  CONFIRMED: "Confirmed",
  REFUTED: "Refuted",
  DOWNGRADED: "Downgraded",
};

/**
 * One finding, collapsed to a line you can triage from and expanded to
 * everything the audit recorded.
 *
 * The severity treatment comes from `row.severity`, never from `row.risk`.
 * They agree today, and the day a pack moves a bucket they would stop agreeing
 * — with the colour saying one thing and the lane the board sorted it into
 * saying another. `severityOf` is the pack's answer; this only paints it.
 *
 * Expansion is local state and deliberately not in the URL. A reader opens
 * several entries while working through the board, and eight `?open=` ids is
 * not a link anybody wants to share.
 *
 * No card chrome. The entry sits on the timeline's rail, and a bordered box per
 * entry inside a rail that is already the grouping is the second lid the
 * Changelog dropped for the same reason: the title leads, and every parameter
 * of the finding — severity, risk, cost, criterion, surface, status — reads as
 * one meta line under it.
 */
export function FindingCard({
  row,
  nodesById,
  surfaceTitles,
  onOpenNode,
  onOpenCriterion,
}: FindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
  const verdict = row.verification?.verdict;
  const acceptedRisk = row.status === "accepted-risk";
  // What the accepted-risk callout shows, and the guard that keeps the same
  // words from appearing twice on one card: a finding carries no dedicated
  // note field, so the rationale is the refutation pass's note when it wrote
  // one and the filed detail otherwise — and the detail is also what the
  // expanded body renders.
  //
  // `||` rather than `??`, because `""` is not a note somebody wrote: a
  // verification that carries an empty one would otherwise draw the bordered
  // callout around an empty paragraph, which reads as a rationale that failed
  // to load rather than as one nobody recorded.
  const acceptedNote = acceptedRisk ? row.verification?.note || row.detail : undefined;

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-1",
        // Resolved and refuted findings are history, not work. Dimmed rather
        // than dropped, because the board is also where somebody checks what
        // was already answered — and the status filter is how you hide them.
        !row.open && "opacity-70",
      )}
    >
      {/* The name first, on the line the rail's square centres against. */}
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 text-left"
      >
        <span className="flex-1 text-sm font-medium leading-relaxed">{row.title}</span>
        <Chevron className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      {/* The reference, on its own line: which criterion this finding answers
          to, and on which surface. It is what somebody quotes when they file it
          or argue it, so it is not left to fight for space in a meta line with
          five numbers in it.

          Outside the disclosure button, because the criterion in it is a
          control of its own and a button inside a button is not markup a
          browser will honour. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {onOpenCriterion && (
          <>
            <button
              type="button"
              onClick={() => onOpenCriterion(row.criterionId, row.surface)}
              className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-muted hover:text-foreground"
              title={`Open ${row.criterionName}`}
            >
              {row.criterionId}
            </button>
            {row.criterionName !== row.criterionId && (
              <span className="max-w-[24rem] truncate">{row.criterionName}</span>
            )}
          </>
        )}
        {/* A finding that belongs to no single surface is called that, in a
            badge, rather than left to read as a surface id nobody titled —
            `cross-surface` is a findings-only lens and no profile declares it,
            so the fallback below would print the raw slug. It is also the row a
            reader is most likely to mistake for the surface they are scoped to.

            Everywhere else: the profile's title, the same word the matrix
            column header and the Surface menu use — a reader who clicked the
            "Database contract" column must not then read `supabase` on every
            card it returned. The id is on the hover. */}
        {row.surface === CROSS_SURFACE_ID ? (
          <Badge variant="outline" className="font-normal">
            Cross-surface
          </Badge>
        ) : (
          <span title={row.surface}>
            {onOpenCriterion && "· "}
            {surfaceTitles.get(row.surface) ?? row.surface}
          </span>
        )}
      </div>

      {/* The scales, on the third line: severity and cost as chips that gloss
          themselves, with the numbers severity is read from between them.

          The priority is not repeated here: it is the square on the rail. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <SeverityPill
          impact={row.impact}
          likelihood={row.likelihood}
          risk={row.risk}
          severity={row.severity}
        />
        <span>· cost</span>
        <ScaleChip
          term={COST_TERM[row.cost]}
          hint={COST_HINT[row.cost]}
          className={cn("rounded border px-1 font-medium", COST_CHIP[row.cost])}
        >
          {row.cost}
        </ScaleChip>
        {verdict && <span>· {VERDICT_LABEL[verdict]}</span>}
        {/* The accepted-risk callout below states the status in its own badge,
            in the treatment that says it is a decision; a second badge up here
            would say it twice and more quietly. */}
        {/* The rail's mark is a glyph; this is the word for it, and the only
            copy of it a screen reader meets. Tinted to match the tick for
            `resolved` alone — the same rule the rail follows, and the reason
            the badge did not simply give way to the mark. */}
        {!row.open && !acceptedRisk && (
          <Badge
            variant="outline"
            className={cn(
              "ms-auto",
              row.status === "resolved" && "border-green-500/40 text-green-700 dark:text-green-400",
            )}
          >
            {FINDING_STATUS_LABEL[row.status]}
          </Badge>
        )}
      </div>

      {/*
        An accepted risk is a decision, so it reads as one — the decision log's
        bordered row with its status stated, not a line of grey meta. It stays
        visible collapsed: the whole point of the status is that somebody
        already weighed this and said "not now", and hiding that behind a
        disclosure invites the next reader to re-litigate it.
      */}
      {acceptedRisk && (
        <div className="mt-1 rounded-lg border bg-muted/30 px-3 py-2.5">
          <Badge variant="outline" className="mb-1.5">
            {FINDING_STATUS_LABEL["accepted-risk"]}
          </Badge>
          <p className="text-sm leading-relaxed text-muted-foreground">{acceptedNote}</p>
        </div>
      )}

      {expanded && (
        <div className="mt-1.5 flex flex-col gap-3 border-l pl-3">
          {row.detail !== "" && row.detail !== acceptedNote && (
            <p className="text-sm leading-relaxed">{row.detail}</p>
          )}

          {row.evidence !== "" && (
            // Monospace and preserved line breaks: the evidence field is where
            // `file:line` citations live, and a citation reflowed into prose is
            // a citation nobody can paste into an editor.
            <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
              {row.evidence}
            </p>
          )}

          {verdict && row.verification?.note && row.verification.note !== acceptedNote && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{VERDICT_LABEL[verdict]}</span> —{" "}
              {row.verification.note}
            </p>
          )}

          {row.nodeIds.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">In the graph</span>
              <div className="flex flex-wrap gap-1.5">
                {row.nodeIds.map((nodeId) => {
                  const node = nodesById.get(nodeId);
                  return (
                    <button
                      key={nodeId}
                      type="button"
                      onClick={() => onOpenNode(nodeId)}
                      // Still a button when the id resolves to nothing: a
                      // finding filed against a node that has since been
                      // deleted is a fact about the audit, and a silently
                      // dropped chip would hide it. The panel it opens says so.
                      title={node ? nodeId : `${nodeId} — not in this project's graph`}
                      className={cn(
                        "max-w-[18rem] truncate rounded border px-1.5 py-0.5 text-xs transition-colors hover:bg-muted",
                        node ? "text-foreground" : "border-dashed font-mono text-muted-foreground",
                      )}
                    >
                      {node?.title ?? nodeId}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* The finding's own id, expanded only — it is what somebody pastes
              into an issue or hands to `arkaik kritik`, and it is also where the
              audit's raw vocabulary gets its context back, beside the surface id
              on the hover above. Collapsed it would be one more monospace token
              in a row already carrying two. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="select-all font-mono">{row.id}</span>
            {row.issueUrl && (
              // `break-all` on the text and `shrink-0` on the icon: the card
              // clips its overflow, and a GitHub issue URL is long enough to be
              // cut off mid-path rather than wrapped.
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
        </div>
      )}
    </article>
  );
}
