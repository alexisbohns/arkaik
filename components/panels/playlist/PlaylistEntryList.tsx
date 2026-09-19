"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRightIcon, PlusIcon, TicketCheckIcon, TicketXIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AddEntryButton } from "@/components/panels/playlist/AddEntryButton";
import { EditableLabel } from "@/components/panels/playlist/EditableLabel";
import { JunctionCaseMenu } from "@/components/panels/playlist/JunctionCaseMenu";
import { PlaylistIndexMenu } from "@/components/panels/playlist/PlaylistIndexMenu";
import { PlaylistReorderControls, rowGroupClass, rowRevealClass } from "@/components/panels/playlist/PlaylistReorderControls";
import { CopyIdChip, EntityId } from "@/components/graph/nodes/EntityBadges";
import { PlatformStatusIcons } from "@/components/graph/nodes/PlatformStatusIcons";
import { ICON_TILE } from "@/components/journal/DeliverableHoverCard";
import { getNodePlatformStatuses } from "@/lib/utils/platform-status";
import { scopedPlatforms, type ProductScope } from "@/lib/utils/product-scope";
import { describeBranchCount, describeEntryCount, moveEntry } from "@/lib/utils/playlist";
import { cn } from "@/lib/utils";
import type { Node, PlaylistEntry } from "@/lib/data/types";

/**
 * The Flow panel's playlist, drawn as a timeline.
 *
 * **The rail is the order.** A playlist *is* an ordered sequence, and the shape
 * that says so is the one the Changelog already uses for shipped work and the
 * Findings board uses for open ones: a column of marks joined by a hairline,
 * one entry beside each. Here the mark is the position itself, which is also
 * the entry's menu — see `PlaylistIndexMenu`.
 *
 * **No card per entry.** The rows used to be bordered cards, inside the
 * bordered Playlist group, inside the panel: the three-lids-for-one-fact stack
 * the Changelog removed when it built this rail. The rail carries the grouping
 * instead, and nesting is carried by a left rule rather than by a margin.
 *
 * **The list and the row share a file because they are mutually recursive.** A
 * condition holds two lists, a junction case holds one, and each of those holds
 * rows. Splitting them into two modules would buy nothing but an import cycle;
 * the parts that are *not* recursive — the composer, the label input, the index
 * menu, the arrows — are the ones that got their own files.
 */

interface PlaylistEntryListProps {
  entries: PlaylistEntry[];
  onChange: (entries: PlaylistEntry[]) => Promise<void> | void;
  flowNodeId: string;
  allNodes: Node[];
  onCycleBlocked: (candidateFlowId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  depth?: number;
  /**
   * The surface's product scope, for the per-platform marks on a step. Optional
   * because it reaches here from the panel four levels up, and a playlist that
   * has not been handed one shows titles without marks rather than nothing.
   */
  scope?: ProductScope;
}

interface PlaylistEntryRowProps {
  entry: PlaylistEntry;
  index: number;
  total: number;
  flowNodeId: string;
  allNodes: Node[];
  onCycleBlocked: (candidateFlowId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onChangeEntry: (entry: PlaylistEntry) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  onMove: (delta: -1 | 1) => Promise<void> | void;
  onMoveTo: (target: number) => Promise<void> | void;
  depth: number;
  scope?: ProductScope;
  active: boolean;
  /** Told which kind of pointer started the press — see `PlaylistEntryList`. */
  onActivate: (pointerType: string) => void;
}

/**
 * A condition's two outcomes, as marks on a rail.
 *
 * A condition holds two branches the way a junction holds cases and a playlist
 * holds steps, so it is drawn the same way: a tile, a connector, content beside
 * them. Each outcome used to be a muted "YES"/"NO" over entries wrapped in a
 * `border-l` — the quietest text on screen doing the job of telling you which
 * half you were reading, over a rule that was a second vertical line saying what
 * the entries' own rail already said.
 *
 * A ticket stamped or refused: the branch a condition takes, and the one it does
 * not. Colour rides on the **tile** and the word beside it stays system
 * foreground — the rule `DeliverableHoverCard` states for its own marks, because
 * a blue word beside a blue mark says it twice and reads worse doing it.
 *
 * `no` needs two shades of yellow, light and dark: it is the one hue in this
 * palette whose mid shades wash out on white.
 */
const BRANCH = {
  yes: { label: "Yes", Icon: TicketCheckIcon, tile: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  no: { label: "No", Icon: TicketXIcon, tile: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
} as const;


/**
 * The bar of a condition or junction row: the editable label, a disclosure
 * chevron at the far end, and — under it — what the row holds.
 *
 * **The chevron sits at the end of the row**, where every other disclosure in
 * the app puts it: `PanelGroup`'s bars, the panel's own regions. Leading with it
 * pushed the label a step right of every other row's text and made the rail's
 * numbers line up with nothing.
 *
 * **The trigger is the chevron alone, not the whole bar.** The label is an
 * `Input`, and a control inside a `CollapsibleTrigger` is the button-inside-a-
 * button that `PanelGroup`'s own doc comment rules out: invalid HTML, undefined
 * assistive-technology behaviour, and an inner control whose clicks the outer
 * trigger swallows. Keeping the trigger narrow is precisely what lets the label
 * stay editable in place.
 *
 * The count sits on its own line rather than beside the label: in a panel this
 * narrow the two would fight for the same row, and the count is the thing a
 * *shut* branch needs to say — "2 branches · 4 entries" answers how much is
 * about to unfold.
 *
 * Nothing under the bar is indented past it. With the chevron trailing, the
 * label starts at the row's own left edge, so the count and the branches start
 * there too; the nesting is carried by the rule down each nested list, not by a
 * step that would now align with nothing.
 */
/**
 * The disclosure chevron every collapsible row in this panel wears: at the end
 * of its row, pointing right when shut and down when open.
 *
 * **The group lives on the trigger, not on the `Collapsible`.** `group-data-…/x`
 * compiles to a plain descendant selector, so a name put on the root matches
 * from every ancestor carrying it — and these nest three deep (a condition
 * inside a junction case inside a condition). An open outer row would then spin
 * a shut inner row's chevron. Triggers never nest inside triggers, so naming the
 * group there makes the match exact. This is the same trap the reorder arrows
 * hit; see `PlaylistReorderControls`.
 */
function DisclosureChevron({ label }: { label: string }) {
  return (
    <CollapsibleTrigger
      aria-label={label}
      className="group/disclosure flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <ChevronRightIcon
        className="size-3.5 transition-transform group-data-[state=open]/disclosure:rotate-90"
        aria-hidden="true"
      />
    </CollapsibleTrigger>
  );
}

/**
 * One row of a branch rail — a condition's Yes/No, a junction's case — with what
 * it holds folded underneath.
 *
 * The mark, the label, the count and the chevron sit on a **24px line**, which
 * is what puts a 24px tile and a 12px word on the same centre. Left to the
 * flow-column's own height they were 4px apart, the tile riding low against a
 * label pinned to the top of the cell.
 */
function RailRow({
  mark,
  label,
  count,
  toggleLabel,
  connector,
  children,
}: {
  /** The tile on the rail: a plain span, or a button that opens a menu. */
  mark: ReactNode;
  label: ReactNode;
  count: string;
  toggleLabel: string;
  /** Whether anything follows on this rail, and so whether a line runs down to it. */
  connector: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen className="grid grid-cols-[auto_1fr] gap-x-3">
      <div className="flex flex-col items-center">
        {mark}
        {connector && (
          <span className="w-0 flex-1 border-l border-dashed border-border" aria-hidden="true" />
        )}
      </div>

      <div className={cn("flex min-w-0 flex-col", connector && "pb-4")}>
        <div className="flex h-6 items-center gap-2">
          {label}
          <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
          <DisclosureChevron label={toggleLabel} />
        </div>
        <CollapsibleContent className="mt-1.5">{children}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function BranchBar({
  entry,
  ariaLabel,
  placeholder,
  onChangeEntry,
  children,
}: {
  entry: Extract<PlaylistEntry, { type: "condition" | "junction" }>;
  ariaLabel: string;
  /** The default name, shown while the label is empty. */
  placeholder: string;
  onChangeEntry: (entry: PlaylistEntry) => Promise<void> | void;
  children: ReactNode;
}) {
  const summary = describeBranchCount(entry);

  return (
    <Collapsible defaultOpen className="flex flex-col">
      <div className="flex items-center gap-2">
        <EditableLabel
          value={entry.label}
          onCommit={(label) => void onChangeEntry({ ...entry, label })}
          ariaLabel={ariaLabel}
          placeholder={placeholder}
        />
        <DisclosureChevron label={`Toggle ${entry.label || ariaLabel}`} />
      </div>
      {summary && <p className="pt-1 text-xs text-muted-foreground">{summary}</p>}
      <CollapsibleContent className="mt-3 flex flex-col gap-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function PlaylistEntryRow({
  entry,
  index,
  total,
  flowNodeId,
  allNodes,
  onCycleBlocked,
  onCreateNode,
  onChangeEntry,
  onRemove,
  onMove,
  onMoveTo,
  depth,
  scope,
  active,
  onActivate,
}: PlaylistEntryRowProps) {
  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  const refId = entry.type === "flow" ? entry.flow_id : entry.type === "view" ? entry.view_id : undefined;
  const refNode = refId ? nodesById.get(refId) : undefined;

  return (
    <li
      data-active={active}
      // Touch has no hover, so a tap on the row stands in for it — see
      // `PlaylistReorderControls`. `onPointerDown` rather than `onClick`
      // because it is the event that says which kind of pointer this is, and a
      // mouse must not leave a row latched open behind it.
      onPointerDown={(event) => onActivate(event.pointerType)}
      className={cn(rowGroupClass(depth), "relative grid grid-cols-[auto_1fr] gap-x-3")}
    >
      {/* The rail. The connector is `flex-1` inside a stretched grid cell, so it
          runs to the bottom of the entry however tall it grows — and is absent
          on the last one, which would otherwise trail into nothing. */}
      <div className="relative flex flex-col items-center">
        <PlaylistIndexMenu index={index} total={total} onMoveTo={onMoveTo} onRemove={onRemove} />
        {/* Every entry has a connector now, because every list ends in the add
            tile — the rail runs from the first step to the place the next one
            will go.

            Solid all the way down, including the last segment. Dashing that one
            to match the tile was tried and is worse: a connector spans its
            entry's whole height, so on a junction holding four cases it became
            300px of dashes running past everything nested inside — loud, and
            easily read as a nesting rule rather than as a rail. The dashes mean
            one thing, on one 24px box: this position is not filled in yet. */}
        <span className="w-px flex-1 bg-border" aria-hidden="true" />
        <PlaylistReorderControls index={index} total={total} depth={depth} onMove={onMove} />
      </div>

      {/* The breathing room below each entry belongs to the *content* column,
          never to the `<li>`: a grid child stretches to its content box, so
          padding on the row would end the connector above the gap and leave the
          marks unlinked. */}
      <div className="flex min-w-0 flex-col pb-4">
        {(entry.type === "view" || entry.type === "flow") && refId && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <p className={cn("truncate text-sm font-medium", !refNode && "text-destructive")}>
                {refNode?.title ?? "Missing node"}
              </p>
              {/* The id is no longer written out on the row — the title says
                  which step this is, and a column of `V-…` slugs under a column
                  of titles is the same fact twice. It lives on the chip
                  instead: one click puts it on the clipboard, which is the only
                  thing anyone did with it anyway.

                  Revealed by the row, exactly as the reorder arrows are, so a
                  resting playlist is titles and status and nothing else. */}
              <CopyIdChip
                id={refId}
                className={cn(
                  "opacity-0 transition-opacity focus-visible:opacity-100",
                  rowRevealClass(depth),
                )}
              />
            </div>

            {/* A reference to a node that is not in the graph is the one case
                where the id is the only identity there is, so it is spelled out
                — losing it would leave a row reading "Missing node" and nothing
                to go and fix. */}
            {!refNode && <EntityId id={refId} />}

            {/* What used to be the word "view" or "flow" — which the panel's own
                heading already implied — is now the step's per-platform status:
                the platform's glyph in the status colour, the mark the Library
                card and the acceptance rows already use. A playlist read top to
                bottom says how far each step has got, on which platform. */}
            {refNode && scope && (
              <PlatformStatusIcons
                className="shrink-0"
                platforms={scopedPlatforms(refNode, scope)}
                platformStatuses={getNodePlatformStatuses(refNode)}
              />
            )}
          </div>
        )}

        {entry.type === "condition" && (
          <BranchBar entry={entry} ariaLabel="Condition label" placeholder="Condition" onChangeEntry={onChangeEntry}>
            {/*
              * The branch rail — the junction case rail's twin, and for the same
              * reason: two outcomes a condition holds, drawn the way everything
              * else this panel holds is drawn.
              *
              * Dashed, like the cases and unlike the steps: Yes and No are
              * alternatives, and a solid line down them would claim an order.
              * Only the first carries a connector, because there is no third
              * mark and no add tile — a condition has exactly two branches,
              * always, so there is nothing here to grow.
              *
              * No `gap` on the column: the connector is `flex-1` in a stretched
              * cell and a gap would cut it short.
              */}
            <div className="flex flex-col">
              {[
                {
                  key: "yes" as const,
                  entries: entry.if_true,
                  onChange: (next: PlaylistEntry[]) => onChangeEntry({ ...entry, if_true: next }),
                },
                {
                  key: "no" as const,
                  entries: entry.if_false,
                  onChange: (next: PlaylistEntry[]) => onChangeEntry({ ...entry, if_false: next }),
                },
              ].map((side, sideIndex) => {
                const { label, Icon, tile } = BRANCH[side.key];
                return (
                  <RailRow
                    key={side.key}
                    connector={sideIndex === 0}
                    count={describeEntryCount(side.entries)}
                    toggleLabel={`Toggle ${label} branch`}
                    mark={
                      /* A span, not a button: a condition's branches cannot be
                         added, removed or reordered, so the mark has no menu to
                         open and must not look as though it has. */
                      <span className={cn(ICON_TILE, tile)} aria-hidden="true">
                        <Icon className="size-3" />
                      </span>
                    }
                    label={
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-foreground">
                        {label}
                      </p>
                    }
                  >
                    <PlaylistEntryList
                      entries={side.entries}
                      depth={depth + 1}
                      flowNodeId={flowNodeId}
                      allNodes={allNodes}
                      onCycleBlocked={onCycleBlocked}
                      onCreateNode={onCreateNode}
                      scope={scope}
                      onChange={side.onChange}
                    />
                  </RailRow>
                );
              })}
            </div>
          </BranchBar>
        )}

        {entry.type === "junction" && (
          <BranchBar entry={entry} ariaLabel="Junction label" placeholder="Junction" onChangeEntry={onChangeEntry}>
            {/*
              * The case rail. Same grid as the entry rail above it — a mark, a
              * connector, content beside them — because a case is a thing the
              * junction holds in exactly the way a step is a thing the playlist
              * holds, and drawing one as a rail and the other as a stack of
              * boxes made a junction read as a different kind of object every
              * time you opened one.
              *
              * The connector is **dashed**, and here that earns the ink the
              * entry rail's last segment did not: a playlist is a sequence and a
              * junction's cases are alternatives, so a solid line down them
              * would claim an order that does not exist. Dashes say "these are
              * the ways out", not "first this, then that".
              *
              * No `gap` on the column, for the usual reason — the connector is
              * `flex-1` in a stretched cell and a gap would cut it.
              */}
            <div className="flex flex-col">
              {/*
                * Keyed by index, never by `playlistCase.label`: the label is
                * edited in place on this row, so a label key made every
                * persisted keystroke remount the row, drop focus, and throw away
                * whatever was typed during the in-flight write — one click per
                * character — while also wiping the nested list's own state.
                *
                * Index is the right key because `JunctionCase`
                * (packages/schema/src/playlist.ts:3-6) carries no id, and cases
                * are never reordered: this editor only appends and removes,
                * there is no case-level move control (unlike entries), and
                * nothing else in the repo sorts or splices `cases`. A removal
                * still shifts every later case up one index; `EditableLabel`
                * handles that by adopting the label that lands in the row.
                */}
              {entry.cases.map((playlistCase, caseIndex) => (
                <RailRow
                  key={caseIndex}
                  connector
                  count={describeEntryCount(playlistCase.entries)}
                  toggleLabel={`Toggle case ${caseIndex + 1}`}
                  mark={
                    <JunctionCaseMenu
                      index={caseIndex}
                      total={entry.cases.length}
                      onRemove={() => {
                        const nextCases = entry.cases.filter((_, idx) => idx !== caseIndex);
                        void onChangeEntry({ ...entry, cases: nextCases });
                      }}
                    />
                  }
                  label={
                    <EditableLabel
                      value={playlistCase.label}
                      onCommit={(label) => {
                        const nextCases = entry.cases.map((item, idx) => {
                          if (idx !== caseIndex) return item;
                          return { ...item, label };
                        });
                        void onChangeEntry({ ...entry, cases: nextCases });
                      }}
                      ariaLabel={`Junction case ${caseIndex + 1} label`}
                      placeholder={`Case ${caseIndex + 1}`}
                    />
                  }
                >
                  {/* No rule around these entries: they are a rail, the case
                      rail is a second line beside them, and a `border-l`
                      between the two would be a third. */}
                  <PlaylistEntryList
                    entries={playlistCase.entries}
                    depth={depth + 1}
                    flowNodeId={flowNodeId}
                    allNodes={allNodes}
                    onCycleBlocked={onCycleBlocked}
                    onCreateNode={onCreateNode}
                    scope={scope}
                    onChange={(nextEntries) => {
                      const nextCases = entry.cases.map((item, idx) => {
                        if (idx !== caseIndex) return item;
                        return { ...item, entries: nextEntries };
                      });
                      return onChangeEntry({ ...entry, cases: nextCases });
                    }}
                  />
                </RailRow>
              ))}

              {/* The rail's next position, the way `AddEntryButton` is the entry
                  rail's — dashed like it, blue like the case marks above it, so
                  "add a case" and "add a step" are never the same button in two
                  places on one screen. */}
              <div className="grid grid-cols-[auto_1fr] gap-x-3">
                <button
                  type="button"
                  aria-label="Add case"
                  title="Add case"
                  onClick={() => void onChangeEntry({
                    ...entry,
                    cases: [...entry.cases, { label: `Case ${entry.cases.length + 1}`, entries: [] }],
                  })}
                  className={cn(
                    ICON_TILE,
                    "cursor-pointer border border-dashed border-blue-500/40 text-blue-600/70 transition-colors dark:text-blue-400/70",
                    "hover:border-solid hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <PlusIcon className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </BranchBar>
        )}
      </div>
    </li>
  );
}

export function PlaylistEntryList({
  entries,
  onChange,
  flowNodeId,
  allNodes,
  onCycleBlocked,
  onCreateNode,
  depth = 0,
  scope,
}: PlaylistEntryListProps) {
  /**
   * Which row is showing its reorder arrows on a touch device. Per-list: a tap
   * moves it, and the only thing it controls is whether two small buttons are
   * visible.
   *
   * **A mouse clears it instead of claiming it.** Latching on any click meant a
   * row you had clicked kept its arrows lit while you hovered a different row,
   * so two rows offered to move at once and neither said which one the arrows
   * belonged to. A mouse already has hover — it has never needed this — so the
   * press that sets the row is a touch or a pen, and a mouse press puts the
   * list back to hover alone, including after a tap on a hybrid device. The
   * other half of that fix is in `PlaylistReorderControls`: nothing reveals on
   * focus *within* the row either.
   */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  async function handleMove(index: number, delta: -1 | 1) {
    const next = moveEntry(entries, index, index + delta);
    if (next === entries) return;
    await onChange(next);
  }

  async function handleMoveTo(index: number, target: number) {
    const next = moveEntry(entries, index, target);
    if (next === entries) return;
    await onChange(next);
  }

  async function handleRemove(index: number) {
    await onChange(entries.filter((_, idx) => idx !== index));
  }

  async function handleReplace(index: number, entry: PlaylistEntry) {
    const next = entries.map((item, idx) => (idx === index ? entry : item));
    await onChange(next);
  }

  const body = (
    <>
      {entries.length > 0 && (
        <ol className="flex flex-col">
          {entries.map((entry, index) => (
            <PlaylistEntryRow
              key={`${entry.type}-${index}`}
              entry={entry}
              index={index}
              total={entries.length}
              flowNodeId={flowNodeId}
              allNodes={allNodes}
              onCycleBlocked={onCycleBlocked}
              onCreateNode={onCreateNode}
              depth={depth}
              scope={scope}
              active={activeIndex === index}
              onActivate={(pointerType) => setActiveIndex(pointerType === "mouse" ? null : index)}
              onMove={(delta) => handleMove(index, delta)}
              onMoveTo={(target) => handleMoveTo(index, target)}
              onRemove={() => handleRemove(index)}
              onChangeEntry={(nextEntry) => handleReplace(index, nextEntry)}
            />
          ))}
        </ol>
      )}
      {/* On the `<ol>`'s grid but outside it: the add tile is where the next
          step will go, not a step, and an `<li>` that is not an entry would put
          it in the list a screen reader reads out. No gap above it either — the
          column is `flex flex-col` with none — so the dashed connector coming
          down from the last entry meets it. */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        <AddEntryButton
          flowNodeId={flowNodeId}
          allNodes={allNodes}
          entries={entries}
          onChange={onChange}
          onCycleBlocked={onCycleBlocked}
          onCreateNode={onCreateNode}
        />
        {entries.length === 0 && (
          <p className="self-center text-xs text-muted-foreground">No entries yet.</p>
        )}
      </div>
    </>
  );

  // No `gap`: the rail is one continuous line from the first entry to the add
  // tile, and a gap between the `<ol>` and the tile would break it and leave the
  // tile floating again.
  return <div className="flex flex-col">{body}</div>;
}
