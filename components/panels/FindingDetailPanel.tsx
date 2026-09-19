"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon, ExternalLinkIcon, ListChecksIcon } from "lucide-react";
import { CROSS_SURFACE_ID, type KritikLibrary, type QualitySection } from "@arkaik/schema";
import { EntityId, PanelHeaderEntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelSection, PANEL_GUTTER } from "@/components/panels/PanelSection";
import { AcceptedRiskCallout } from "@/components/quality/AcceptedRiskCallout";
import {
  COST_CHIP,
  COST_HINT,
  COST_TERM,
  FINDING_STATUS_LABEL,
  PRIORITY_CHIP,
  PRIORITY_GLOSS,
  SEVERITY_CHIP,
  SEVERITY_HINT,
  SEVERITY_LABEL,
  VERDICT_LABEL,
} from "@/components/quality/quality-styles";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { Node } from "@/lib/data/types";
import { criterionOf, type FindingRow } from "@/lib/utils/quality";
import { cn } from "@/lib/utils";

interface FindingDetailPanelProps {
  findingId: string;
  /**
   * Every finding in the section, denormalized once by `ProjectPanels`. The
   * panel picks its own out by id rather than being handed a row, so an audit
   * arriving under an open panel reaches it.
   */
  findings: FindingRow[];
  /** The audit profile, for naming the surface the way the matrix names it. */
  section?: QualitySection;
  /**
   * The criteria pack, for the question the Criterion card previews. Optional
   * the way it is on the criterion and cell panels: a bundle can travel without
   * its pack, and then there is no question to show and the card shows what the
   * projection already carries. `FindingDetailPanelHeader` does not take it —
   * nothing in the header comes from the pack.
   */
  library?: KritikLibrary;
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
 * What identifies the panel in the stack's header: what kind of thing this is,
 * which one it is, and the surface it was filed on. The close button belongs
 * to `PanelStack`, which owns every panel's frame.
 *
 * **A panel header in this app never carries a title.** A node's header is its
 * species badge and its id; a criterion's is its domain and its id. The title
 * is body content — on a node it is an editable field down there, which is
 * exactly why it cannot also be the identity up here — and the stack's own
 * `h2` is `sr-only` for the same reason. This header had the title and no id
 * at all, which read fine and was the one panel out of step with every other.
 *
 * The rail's mark is not here either. It is a status, and no header in the
 * stack carries one: a decision panel's header does not wear its
 * `DecisionStatusBadge`. Recognition is the id's job — and the mark is not in
 * the body now either, since the Risk section states the priority it carried.
 */
export function FindingDetailPanelHeader({
  findingId,
  findings,
  section,
}: Pick<FindingDetailPanelProps, "findingId" | "findings" | "section">) {
  const row = findings.find((candidate) => candidate.id === findingId);

  return (
    <>
      {/* Grouped so the two chips never separate when the header row runs out
          of room; the row itself is `PanelStack`'s. The idiom, and this
          comment, are `CriterionDetailPanelHeader`'s — the neighbouring panel
          whose subject is also not a graph node. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
          <ListChecksIcon className="size-3.5" aria-hidden="true" />
          Finding
        </span>
        <PanelHeaderEntityId id={findingId} />
      </div>
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
 * Every section carrying prose somebody had to write is conditional on having
 * something to say, the rule `CriterionDetailPanel` states: a heading over
 * nothing reads as a panel that failed to load rather than as a finding nobody
 * wrote evidence for. Risk, Criterion and Reference are the exceptions,
 * because none of them can ever be empty — the projection derives all five
 * scales for every row, every finding answers to a criterion on a surface, and
 * a row that resolved still has the `id` Reference exists to hand over.
 */
export function FindingDetailPanel({
  findingId,
  findings,
  section,
  library,
  nodesById,
  onOpenNode,
  onOpenCriterion,
}: FindingDetailPanelProps) {
  // The second linear scan of the same list this render — the header ran the
  // first. Deliberate, and the shape `CriterionDetailPanel` already uses:
  // `criterionOf` is an unmemoized `find` its header and its body each call
  // for themselves. A few hundred rows scanned twice is nothing next to a
  // context threaded through the stack to carry one row, and the panel takes
  // an id rather than a row for the reason `findings` documents above.
  const row = findings.find((candidate) => candidate.id === findingId);

  // Say so rather than rendering nothing: a blank body would read as a bug.
  //
  // Not where a stale `?finding=` link lands — the Findings page refuses to
  // open a panel for an id it cannot resolve, and drops the param instead.
  // What reaches here is a finding that goes missing *under* a panel already
  // open: a re-imported bundle that dropped it, or one opened above depth 0
  // from a node or criterion panel, where no address is watching. In both the
  // reader was just looking at it, so they are owed an account of where it
  // went.
  if (!row) {
    return (
      <div className={cn(PANEL_GUTTER, "min-h-0 flex-1 overflow-y-auto py-5 lg:py-6")}>
        <EmptyState
          message={
            <>
              This audit carries no finding with the id{" "}
              <span className="font-mono">{findingId}</span>. A later import may have dropped it,
              or the link may be out of date.
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

  // The pack's own prose for the criterion this answers to. `""` whenever the
  // bundle carries no pack, or carries one that does not define this id — both
  // are ordinary states here, and the card simply has one line fewer.
  const criterion = criterionOf(row.criterionId, library);
  const question = typeof criterion?.question === "string" ? criterion.question : "";

  return (
    // No `opacity-70` on a decided finding, unlike the card: dimming says "this
    // row is history" to somebody scanning a board, and there is no board here
    // — the reader asked for this one record, and greying what they asked for
    // reads as broken rather than as filed away.
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
      {/* The title block. The same shape every other panel's title sits in — a
          gutter'd `gap-1.5` column at `text-lg font-semibold` (`NodeDetailPanel`,
          `CriterionDetailPanel`). It used to be `text-sm font-medium`, which
          made the finding the one record in the stack whose name read as body
          copy, and put it below its own section headings in the visual
          hierarchy. */}
      <div className={cn(PANEL_GUTTER, "flex flex-col gap-1.5")}>
        {/* No mark before the title. It carried the priority on an open
            finding, and the Risk section below now states the priority in
            words with its gloss — a `P0` square beside the title was the same
            fact, said smaller and worse, and said first. On a decided finding
            it carried the verdict glyph instead, and that is covered too: the
            badge on this row names `resolved` and `refuted`, and an accepted
            risk has its callout. So nothing was lost with it, which is the
            only reason it could go. */}
        <div className="flex items-start gap-2">
          <p className="flex-1 text-lg font-semibold leading-relaxed text-foreground">
            {row.title}
          </p>
          {/* The status in a word, and the only copy of it a screen reader
              meets now the rail's glyph is gone from this panel — inherited
              from `FindingScales` when the scales left. Green for `resolved`
              alone, the rule the rail follows. An accepted risk is
              deliberately absent: its callout below states the status in the
              treatment that says it is a decision, and a badge up here would
              say it twice and more quietly. */}
          {!row.open && !acceptedRisk && (
            <Badge
              variant="outline"
              className={cn(
                "ms-auto mt-1 shrink-0",
                row.status === "resolved" &&
                  "border-green-500/40 text-green-700 dark:text-green-400",
              )}
            >
              {FINDING_STATUS_LABEL[row.status]}
            </Badge>
          )}
        </div>
      </div>

      {/* An accepted risk is a decision, so it reads as one — the decision
          log's bordered row with its status stated, first thing under the
          identity block. Somebody already weighed this and said "not now", and
          burying that invites the next reader to re-litigate it. */}
      <AcceptedRiskCallout note={acceptedNote} className={PANEL_GUTTER} />

      {/* The bill, spelled out. On the board these five numbers are
          `FindingScales`, a compact line whose figures and glosses live behind
          a hover — right for a row in a list of twenty, wrong here: the reader
          asked for this one finding, and "why is this a P0" should not require
          them to find a chip and keep a pointer on it. So the panel renders
          what the popover held, unconditionally and as text. Nothing in this
          section needs a hover.

          Unconditional, unlike every other section below: a row always has an
          impact, a likelihood, a severity, a priority and a cost — the
          projection derives all five — so there is no empty state to guard. */}
      <PanelSection title="Risk">
        <dl className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
          <BillRow label="Impact" value={<span className="tabular-nums">{row.impact}</span>} />
          <BillRow
            label="Likelihood"
            value={<span className="tabular-nums">× {row.likelihood}</span>}
          />
          {/* The rule `SeverityPill`'s popover draws in the same place: what is
              above it is the two factors, what is below it is what they bought.
              A separator rather than a second heading, because the bill is one
              table and not two. */}
          <div className="my-0.5 border-t" aria-hidden="true" />
          <BillRow
            label="Risk"
            value={<span className="font-semibold tabular-nums">{row.risk}</span>}
            gloss="Impact × likelihood."
          />
          <BillRow
            label="Severity"
            value={<Chip className={SEVERITY_CHIP[row.severity]}>{SEVERITY_LABEL[row.severity]}</Chip>}
            gloss={SEVERITY_HINT[row.severity]}
          />
          <BillRow
            label="Priority"
            value={<Chip className={PRIORITY_CHIP[row.priority]}>{row.priority}</Chip>}
            gloss={PRIORITY_GLOSS[row.priority]}
          />
          <BillRow
            label="Remediation cost"
            value={
              <>
                <Chip className={COST_CHIP[row.cost]}>{row.cost}</Chip>
                <span className="text-muted-foreground">{COST_TERM[row.cost]}</span>
              </>
            }
            gloss={COST_HINT[row.cost]}
          />
        </dl>
      </PanelSection>

      {/* The criterion, as a card that previews it rather than a mono chip in
          a meta line. It is the thing a reader most often follows out of a
          finding — what somebody quotes when they argue it — and the old line
          gave it ten pixels of monospace between a domain it did not name and
          five numbers it had to share a row with.

          The whole card is the button, the way a `CriteriaList` row is: a
          target this size with one destination should not make the reader aim
          at the id inside it. */}
      <PanelSection title="Criterion">
        <button
          type="button"
          onClick={() => onOpenCriterion(row.criterionId, row.surface)}
          className="group flex w-full flex-col gap-1.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
        >
          <div className="flex w-full items-center gap-2">
            {/* The domain, in the bordered chip `CriterionDetailPanelHeader`
                wears for the same value, so the card and the panel it opens
                say it the same way. Absent when the pack does not define the
                criterion — `buildFindingRows` leaves `domainName` empty then,
                and an empty chip would read as a domain called nothing. */}
            {row.domainName !== "" && (
              <span className="inline-flex shrink-0 items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {row.domainName}
              </span>
            )}
            <EntityId id={row.criterionId} />
            {/* The surface this was filed on, pushed to the end of the row.
                `cross-surface` is a findings-only lens no profile declares, so
                it is badged rather than left to print its raw slug — see
                `surfaceTitleOf`, and the reason a reader scoped to one surface
                cannot mistake it for theirs. */}
            {row.surface === CROSS_SURFACE_ID ? (
              <Badge variant="outline" className="ms-auto shrink-0 font-normal">
                Cross-surface
              </Badge>
            ) : (
              <span
                className="ms-auto min-w-0 truncate text-xs text-muted-foreground"
                title={row.surface}
              >
                {surfaceTitleOf(row.surface, section)}
              </span>
            )}
            <ChevronRightIcon
              className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              aria-hidden="true"
            />
          </div>
          {/* Wrapping rather than truncating: this is the expansive reading of
              the criterion, and a name cut mid-word is the board's compromise,
              not this panel's. Skipped when the projection fell back to the id
              for want of a pack definition — the id is already in the row
              above, and printing it twice would look like two facts. */}
          {row.criterionName !== row.criterionId && (
            <p className="text-sm font-medium">{row.criterionName}</p>
          )}
          {question !== "" && (
            <p className="text-sm leading-relaxed text-muted-foreground">{question}</p>
          )}
        </button>
      </PanelSection>

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

/**
 * One line of the risk bill: what it is called, what it is, and what that
 * means in a sentence.
 *
 * The gloss lives inside the `<dd>` rather than beside it, because it is part
 * of the same answer — `SEVERITY_HINT` says what `High` claims, and a reader
 * who takes the word without it has the label and not the meaning. It is also
 * why the value column is left-aligned instead of right: a column of
 * right-aligned prose is a column nobody reads.
 *
 * The label column is fixed so the six values line up; `w-28` clears
 * "Remediation cost", the longest of them, at `text-xs`.
 */
function BillRow({ label, value, gloss }: { label: string; value: ReactNode; gloss?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-28 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">{value}</span>
        {gloss && <span className="text-xs leading-relaxed text-muted-foreground">{gloss}</span>}
      </dd>
    </div>
  );
}

/**
 * A scale's chip in the bill — the shared geometry, with the tint passed in
 * from `quality-styles`.
 *
 * Not `ScaleChip`: that component's whole job is to hang a term and a hint off
 * a hover, and this section exists precisely because nothing in it should
 * require one. What is left once the popover goes is a border, a radius and
 * some padding, which is this.
 */
function Chip({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}
