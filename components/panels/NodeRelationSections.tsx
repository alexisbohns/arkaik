/**
 * Every relation section of a node panel — Covers, Invocation, References,
 * Findings and the one generic relation line that every edge type is rendered
 * through — plus the attach config Covers hands its own line. (Acceptances is
 * the exception, and only because `AcceptancesSection` was already a module of
 * its own.)
 *
 * A module of their own because `RelationsGroup` renders them all and
 * `NodeDetailPanel` renders `RelationsGroup`: left where they were, those files
 * would import each other, and a cycle is not something to defend. Covers is
 * here for the same reason and not only for tidiness — it came out of
 * `AcceptanceEditor`, which `NodeDetailPanel` rendered then and which Parts 3
 * and 4 have since dismantled entirely, so an import edge from the group into
 * that file was a cycle waiting for its second half. The failure it would cause is an
 * undefined component at runtime, with nothing from the compiler.
 *
 * So the rule this module keeps: a section that `RelationsGroup` renders lives
 * here, not in the editor it was cut from.
 */

"use client";

import { useMemo } from "react";
import { toast } from "sonner";

import { PanelSection } from "@/components/panels/PanelSection";
import {
  RelationLine,
  RelationRowItem,
  removeWithUndo,
} from "@/components/panels/RelationLine";
import { RefList } from "@/components/graph/nodes/RefBadges";
import { SEVERITY_CHIP, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { EMPTY_QUALITY_FILTERS, filterFindings, type FindingRow } from "@/lib/utils/quality";
import { findWhereUsed, coveredAnchorsOf } from "@/lib/utils/where-used";
import { attachEmptiesMembership } from "@/lib/utils/acceptance-intake";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { useLatest } from "@/lib/hooks/useLatest";
import type { NodeRelations } from "@/lib/hooks/useNodeRelations";
import { relationRows, type RelationLineSpec, type RelationRow } from "@/lib/utils/relation-lines";
import { cn } from "@/lib/utils";
import type { Node, Edge } from "@/lib/data/types";
import type { SpeciesId } from "@arkaik/schema";

export interface InvocationSectionProps {
  node: Node;
  allNodes: Node[];
  onNavigate: (node: Node) => void;
}

export function InvocationSection({ node, allNodes, onNavigate }: InvocationSectionProps) {
  const usages = findWhereUsed(node.id, allNodes);

  if (usages.length === 0) {
    return null;
  }

  return (
    <PanelSection title="Invocation">
      {/* `RelationRowItem` without an `onRemove`: this list is read-only on
          every surface, because a flow's playlist is `PlaylistEditor`'s to
          write and a `composes` edge removed from here would leave
          `metadata.playlist.entries` still naming the node. The row it renders
          is the chip-and-title one every other relation row uses, minus the
          trailing "Flow" label the old row repeated on every line — the chip
          already says it. */}
      <ul className="flex flex-col gap-0.5">
        {usages.map((flow) => (
          <RelationRowItem key={flow.id} node={flow} onNavigate={onNavigate} />
        ))}
      </ul>
    </PanelSection>
  );
}

export function RefsSection({ node }: { node: Node }) {
  const refs = node.metadata?.refs;

  if (!refs || refs.length === 0) {
    return null;
  }

  return (
    <PanelSection title="References">
      <RefList refs={refs} />
    </PanelSection>
  );
}

export interface FindingsSectionProps {
  node: Node;
  findings: FindingRow[];
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/**
 * The audit's open findings against this node, worst first.
 *
 * Open only, matching the canvas badge exactly: both ask `row.open`, so a node
 * wearing a red "3" opens onto three rows and never onto a resolved fourth the
 * reader has to work out is history.
 *
 * The order is `filterFindings`' own — the board's comparator, run with the
 * filter set that narrows nothing. A `sort` written here would be a second
 * opinion on which finding is worse than which, and the two lists would read
 * differently the day a pack moved a bucket.
 */
export function FindingsSection({ node, findings, onOpenCriterion }: FindingsSectionProps) {
  const own = filterFindings(
    findings.filter((row) => row.open && row.nodeIds.includes(node.id)),
    EMPTY_QUALITY_FILTERS,
  );

  if (own.length === 0) {
    return null;
  }

  return (
    <PanelSection title="Findings">
      <div className="flex flex-col gap-0.5">
        {own.map((row) => (
          // Into the criterion, not into the finding: a finding has no panel of
          // its own, and the criterion is where its question, its bands and its
          // siblings on the same surface live.
          <button
            key={row.id}
            type="button"
            onClick={() => onOpenCriterion(row.criterionId, row.surface)}
            className="flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 hover:bg-muted transition-colors w-full"
            title={`Open ${row.criterionName}`}
          >
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium",
                SEVERITY_CHIP[row.severity],
              )}
            >
              {SEVERITY_LABEL[row.severity]}
            </span>
            <span className="flex-1 truncate">{row.title}</span>
            <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
              {row.criterionId}
            </span>
          </button>
        ))}
      </div>
    </PanelSection>
  );
}

export interface EdgeRelationLineProps {
  node: Node;
  line: RelationLineSpec;
  allNodes: Node[];
  allEdges: Edge[];
  onNavigate?: (node: Node) => void;
  relations?: NodeRelations;
}

/**
 * One grammar-derived relation line, with its rows resolved.
 *
 * This is what `ConnectionsSection` and `DecisionLinksSection` both became. The
 * first flattened `calls`, `displays` and `queries` into one list and named the
 * counterpart's *species* on the right — which is not the relation, so a view
 * that calls an endpoint and a view an endpoint calls back read identically.
 * The second spelled its four lists out by hand. Both are this, given a
 * different line.
 *
 * Rows resolve through `allNodes` and unresolvable ids are dropped, as
 * `coveredAnchorsOf` does: a row naming an id the panel cannot show is worse
 * than no row.
 *
 * Everything the combobox memoises on is memoised here, and so is everything
 * those memos read: the candidate list inside `NodeSearchCombobox` fuzzy-scores
 * every node in the project and is keyed on `excludeIds`' identity, so a fresh
 * array per render would make it dead weight — on every line of every panel,
 * which is how this component differs from the one-off it was copied from.
 * `allNodes` and `allEdges` come from react-query with a module-level `select`
 * and are referentially stable, and `line` comes out of `relationLinesFor`'s
 * frozen module-level table, so the chain actually holds.
 */
export function EdgeRelationLine({ node, line, allNodes, allEdges, onNavigate, relations }: EdgeRelationLineProps) {
  const byId = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);
  const rows = useMemo(
    () =>
      relationRows(node.id, line, allEdges)
        .map((row) => ({ row, counterpart: byId.get(row.counterpartId) }))
        .filter((entry): entry is { row: RelationRow; counterpart: Node } => Boolean(entry.counterpart)),
    [node.id, line, allEdges, byId],
  );
  const excludeIds = useMemo(
    () => [node.id, ...rows.map((entry) => entry.counterpart.id)],
    [node.id, rows],
  );

  /**
   * Run one write, reporting a failure instead of swallowing it, and answering
   * whether it landed.
   *
   * The answer is what the relation line closes on: `false` keeps the line open
   * over the query that produced it, because a toast over a line that already
   * shut and dropped the typed text is a worse account of what happened than no
   * toast at all. Same shape, same reason, as `CoversSection`'s.
   */
  async function run(action: () => Promise<void>, failure: string): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (err) {
      toast.error(failure);
      console.error(err);
      return false;
    }
  }

  // A read-only line with nothing in it is a bare label over nothing — an empty
  // state, which is what the group's flags exist to avoid. With a `+` on it, it
  // is an invitation, so it stays.
  if (rows.length === 0 && !relations) return null;

  return (
    <RelationLine
      label={line.label}
      add={
        relations && {
          counterpartSpecies: line.counterpartSpecies,
          allNodes,
          excludeIds,
          onSelect: (counterpartId: string) => {
            const counterpart = byId.get(counterpartId);
            // Nothing to link to, so nothing happened: `false` keeps the line
            // open rather than closing it over a gesture that did not land.
            if (!counterpart) return false;
            // Returned, not fired and forgotten: the line closes on this
            // answer, and a write the store rejects has to leave it standing.
            return run(() => relations.link(node, counterpart, line), "Couldn't link that node.");
          },
          onCreate: (species: SpeciesId, title: string) =>
            run(async () => {
              const created = await relations.linkNew(node, line, species, title);
              if (created) toast.success(`Created "${created.title}" and linked it.`);
            }, "Couldn't create that node."),
        }
      }
    >
      {rows.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {rows.map(({ counterpart }) => (
            <RelationRowItem
              key={counterpart.id}
              node={counterpart}
              onNavigate={onNavigate}
              onRemove={
                relations &&
                (() => void run(() => relations.unlink(node, counterpart.id, line), "Couldn't unlink that node."))
              }
              removeLabel={`Remove ${counterpart.title} from ${line.label}`}
            />
          ))}
        </ul>
      )}
    </RelationLine>
  );
}

interface CoversSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  /**
   * Whether the project declares any product at all — the one thing this
   * section ever asked the whole `ProductScope` for, passed through to
   * the attach combobox's triage warning. A boolean rather than the scope,
   * because a component that takes a scope reads as one that shows products,
   * and this one does not.
   */
  hasProducts: boolean;
  onNavigate?: (node: Node) => void;
  intake?: AcceptanceIntake;
}

/**
 * The views and flows this acceptance covers — and, where the surface can
 * write, the gestures that change that list.
 *
 * Lifted out of `AcceptanceEditor` because it is a relation, not a field: it
 * says what this record points at, which is what References, Findings and
 * Connections say too, and it belongs beside them — in the Relations group, and
 * so in this module. Leaving it in the editor would have made the acceptance the
 * one species whose covers list sat apart from the rest of its
 * cross-references — under "Per-platform status", of all things. Leaving it in
 * that *file* would have been the same mistake at a remove: `RelationsGroup`
 * importing from an editor that no longer renders it is the import edge this
 * module exists to break.
 *
 * A `RelationLine` rather than the `Field` it was: inside a group this is a
 * level-four section with a heading, not a labelled control, and there is no
 * single control for a label to point at anyway. The line supplies the rest —
 * the `+` that reveals the search, and the rule that an empty writable relation
 * costs one line.
 */
export function CoversSection({ node, allNodes, allEdges, hasProducts, onNavigate, intake }: CoversSectionProps) {
  const nodesById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);
  // `coveredAnchorsOf`, not a walk of its own: `AcceptanceMembershipField` asks
  // the same question for its Product hint's anchor count, and the two answers have to be
  // the same list or the hint counts anchors this section does not show. The
  // map stays because the attach config resolves the id the combobox returns.
  const coveredAnchors = useMemo(
    () => coveredAnchorsOf(node, allNodes, allEdges),
    [node, allNodes, allEdges],
  );
  // Memoised because it is a dependency of the combobox's candidate memo, and
  // that memo fuzzy-scores every node in the project. A fresh array here would
  // miss it on every render — which is exactly what hoisting `ANCHOR_SPECIES`
  // out of the render was meant to prevent, cancelled one prop over.
  const excludeIds = useMemo(() => coveredAnchors.map((anchor) => anchor.id), [coveredAnchors]);
  // Undo outlives the render that built it; see the `restore` below.
  const intakeRef = useLatest(intake);

  /**
   * Run one intake gesture, reporting a failure instead of swallowing it.
   *
   * Every one of them is a write to a store the panel does not own, and a
   * rejected batch otherwise leaves the list looking unchanged with nothing
   * saying why — the same treatment `AcceptancesSection` gives its create.
   *
   * It answers whether the write landed, not just whether it complained: the
   * relation line closes on success and stays open on failure, and a toast
   * over a line that shut and dropped the typed query is a worse account of
   * what happened than no toast at all.
   */
  async function run(action: () => Promise<void>, failure: string | null): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (err) {
      // `null` means the caller speaks for this one — `removeWithUndo` reports
      // a failed restore itself, and two toasts describing one failure is the
      // other way to get that wrong.
      if (failure) toast.error(failure);
      console.error(err);
      return false;
    }
  }

  return (
    <RelationLine
      label="Covers"
      add={
        intake &&
        attachAnchorConfig({
          node,
          allNodes,
          allEdges,
          nodesById,
          hasProducts,
          intake,
          run,
          excludeIds,
        })
      }
    >
      {coveredAnchors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {intake
            ? "Unanchored — an idea in intake. Attach it to a view or a flow above."
            : "Unanchored (covers nothing)."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {coveredAnchors.map((anchor) => (
            <RelationRowItem
              key={anchor.id}
              node={anchor}
              onNavigate={onNavigate}
              onRemove={
                intake &&
                (() =>
                  void removeWithUndo({
                    label: anchor.title,
                    remove: () =>
                      run(() => intake.detach(node, anchor.id), "Couldn't detach that node."),
                    // `intake.attach`, not `relations.link`: covers edges stay
                    // on the intake path, and `node-relations.ts` refuses them
                    // at runtime rather than only in prose.
                    //
                    // Through the ref, not this render's `intake`: by the time
                    // Undo is clicked the detach has landed, and the captured
                    // object plans against the edge list from before it —
                    // where the edge still exists, so `planAcceptanceAttach`
                    // plans nothing and Undo does nothing, silently. See
                    // {@link useLatest}.
                    restore: () => run(() => intakeRef.current!.attach(node, anchor), null),
                  }))
              }
              removeLabel={`Stop covering ${anchor.title}`}
              removeQuestion={`Stop covering "${anchor.title}"?`}
            />
          ))}
        </ul>
      )}
    </RelationLine>
  );
}

/**
 * The species a `covers` edge may anchor to, as a module constant.
 *
 * Not an inline `["view", "flow"]`: the combobox memoises its candidate list on
 * this array's identity, and a fresh array on every render would make that
 * memo dead weight.
 */
const ANCHOR_SPECIES: readonly SpeciesId[] = ["view", "flow"];

interface AttachAnchorConfigArgs {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  nodesById: Map<string, Node>;
  /**
   * Whether the project declares any product at all. The triage warning below
   * is gated on it rather than on the membership computation alone: a project
   * that has never heard of products can still carry a stray `metadata.product`
   * from an import, and a toast naming "All products" there would introduce a
   * word the whole feature promises such a project never sees.
   */
  hasProducts: boolean;
  intake: AcceptanceIntake;
  /** Runs one write, reporting `false` when it failed. */
  run: (action: () => Promise<void>, failure: string | null) => Promise<boolean>;
  /**
   * The ids of the anchors already covered — what the list must not offer
   * again. Memoised by the caller; see the note where it is built.
   */
  excludeIds: readonly string[];
}

/**
 * Attach this acceptance to a view or a flow — one that exists, or one created
 * in the same gesture. Not a component: the `add` config its relation line
 * takes, because the `+` on the line now owns when the search appears.
 *
 * One `NodeSearchCombobox` over both anchor species, with no select in front of
 * it. It keeps the rule the insert dialog states for "an existing node, or a new
 * one by that name" — the create row appears only once something is typed that
 * no node of an admissible species already answers to — but asks for one
 * decision instead of two, since the search result already says which species
 * was picked. The playlist editor's Add step popover reached that conclusion
 * first, for a list that plays both; Covers has now joined it.
 *
 * **Attaching an unassigned anchor is allowed and announced.** An acceptance
 * anchored only to unassigned views derives an empty membership, so this gesture
 * can move an idea filed under one app back into the "All products" inbox
 * (§ Decision 5, the interaction the spec left open). Blocking it would be
 * wrong — the anchor is the truth and triage is the honest place for an
 * acceptance whose anchors are themselves in triage — but letting it happen in
 * silence means watching the acceptance vanish from the scope you were standing
 * in. So it is written, and then said. A node created here inherits the
 * acceptance's product precisely so the common path never trips this.
 */
function attachAnchorConfig({
  node,
  allNodes,
  allEdges,
  nodesById,
  hasProducts,
  intake,
  run,
  excludeIds,
}: AttachAnchorConfigArgs) {
  function announceTriage(anchor: Pick<Node, "id" | "species" | "title" | "metadata">) {
    if (!hasProducts) return;
    // Evaluated against the edges as they were BEFORE the write — the predicate
    // asks what this attach did, and the answer needs the graph it acted on.
    if (!attachEmptiesMembership(node, anchor, allEdges, nodesById)) return;
    toast.warning(`"${anchor.title}" has no product, so this acceptance now appears under All products only.`);
  }

  return {
    counterpartSpecies: ANCHOR_SPECIES,
    allNodes,
    excludeIds,
    onSelect: async (anchorId: string) => {
      const anchor = nodesById.get(anchorId);
      // Nothing to attach to, so nothing happened: `false` keeps the line open
      // rather than closing it over a gesture that did not land.
      if (!anchor) return false;
      // Awaited, not fired and forgotten: `run`'s answer is what tells the
      // line whether to close, and an attach that the store rejects has to
      // leave the line standing for the same reason a create does.
      return run(async () => {
        await intake.attach(node, anchor);
        announceTriage(anchor);
      }, "Couldn't attach that node.");
    },
    onCreate: (species: SpeciesId, title: string) =>
      run(async () => {
        // `intake.createAnchor` takes the narrow anchor species; the grammar
        // admits nothing else on this line, so the cast is the type system
        // catching up with `ANCHOR_SPECIES` above.
        const created = await intake.createAnchor(node, species as "view" | "flow", title);
        if (created) toast.success(`Created "${created.title}" and attached it.`);
      }, `Couldn't create the ${species}.`),
  };
}
