"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AddEntryButton } from "@/components/panels/playlist/AddEntryButton";
import { DebouncedLabelInput } from "@/components/panels/playlist/DebouncedLabelInput";
import { PlaylistIndexMenu } from "@/components/panels/playlist/PlaylistIndexMenu";
import { PlaylistReorderControls, rowGroupClass } from "@/components/panels/playlist/PlaylistReorderControls";
import { describeBranchCount, moveEntry } from "@/lib/utils/playlist";
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
  heading?: string;
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
  active: boolean;
  /** Told which kind of pointer started the press — see `PlaylistEntryList`. */
  onActivate: (pointerType: string) => void;
}

/** A nested list, set off by a rule down its left rather than by a margin. */
const NESTED = "border-l border-border pl-3";

/**
 * Where a row's text starts, measured from the list's left edge: the 24px index
 * tile plus the grid's 12px `gap-x-3`. The composer and the empty state take it
 * so that "No entries yet." and the thing that fixes it both sit under the
 * titles rather than under the rail.
 */
const CONTENT_COLUMN = "pl-9";

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
function BranchBar({
  entry,
  ariaLabel,
  onChangeEntry,
  children,
}: {
  entry: Extract<PlaylistEntry, { type: "condition" | "junction" }>;
  ariaLabel: string;
  onChangeEntry: (entry: PlaylistEntry) => Promise<void> | void;
  children: ReactNode;
}) {
  const summary = describeBranchCount(entry);

  return (
    <Collapsible defaultOpen className="group/branch flex flex-col">
      <div className="flex items-center gap-2">
        <DebouncedLabelInput
          value={entry.label}
          onCommit={(label) => void onChangeEntry({ ...entry, label })}
          ariaLabel={ariaLabel}
        />
        <CollapsibleTrigger
          aria-label={`Toggle ${entry.label || ariaLabel}`}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRightIcon
            className="size-3.5 transition-transform group-data-[state=open]/branch:rotate-90"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
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
  active,
  onActivate,
}: PlaylistEntryRowProps) {
  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  const refId = entry.type === "flow" ? entry.flow_id : entry.type === "view" ? entry.view_id : undefined;
  const refNode = refId ? nodesById.get(refId) : undefined;
  const last = index === total - 1;

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
        {!last && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
        <PlaylistReorderControls index={index} total={total} depth={depth} onMove={onMove} />
      </div>

      {/* The breathing room below each entry belongs to the *content* column,
          never to the `<li>`: a grid child stretches to its content box, so
          padding on the row would end the connector above the gap and leave the
          marks unlinked. */}
      <div className={cn("flex min-w-0 flex-col", !last && "pb-4")}>
        {(entry.type === "view" || entry.type === "flow") && (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={cn("truncate text-sm font-medium", !refNode && "text-destructive")}>
                {refNode?.title ?? "Missing node"}
              </p>
              <p className="truncate text-xs text-muted-foreground">{refId}</p>
            </div>
            <span className="shrink-0 pt-0.5 text-xs capitalize text-muted-foreground">{entry.type}</span>
          </div>
        )}

        {entry.type === "condition" && (
          <BranchBar entry={entry} ariaLabel="Condition label" onChangeEntry={onChangeEntry}>
            <PlaylistEntryList
              heading="Yes"
              entries={entry.if_true}
              depth={depth + 1}
              flowNodeId={flowNodeId}
              allNodes={allNodes}
              onCycleBlocked={onCycleBlocked}
              onCreateNode={onCreateNode}
              onChange={(next) => onChangeEntry({ ...entry, if_true: next })}
            />
            <PlaylistEntryList
              heading="No"
              entries={entry.if_false}
              depth={depth + 1}
              flowNodeId={flowNodeId}
              allNodes={allNodes}
              onCycleBlocked={onCycleBlocked}
              onCreateNode={onCreateNode}
              onChange={(next) => onChangeEntry({ ...entry, if_false: next })}
            />
          </BranchBar>
        )}

        {entry.type === "junction" && (
          <BranchBar entry={entry} ariaLabel="Junction label" onChangeEntry={onChangeEntry}>
            {/*
              * Keyed by index, never by `playlistCase.label`: the label is
              * edited by the Input inside this row, so a label key made every
              * persisted keystroke remount the row, drop focus, and throw away
              * whatever was typed during the in-flight write — one click per
              * character — while also wiping the nested list's own state.
              *
              * Index is the right key because `JunctionCase`
              * (packages/schema/src/playlist.ts:3-6) carries no id, and cases
              * are never reordered: this editor only appends (Add case) and
              * removes, there is no case-level move control (unlike entries),
              * and nothing else in the repo sorts or splices `cases`. A removal
              * still shifts every later case up one index; `DebouncedLabelInput`
              * handles that by adopting the label that lands in the row.
              */}
            {entry.cases.map((playlistCase, caseIndex) => (
              <div key={caseIndex} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <DebouncedLabelInput
                    value={playlistCase.label}
                    onCommit={(label) => {
                      const nextCases = entry.cases.map((item, idx) => {
                        if (idx !== caseIndex) return item;
                        return { ...item, label };
                      });
                      void onChangeEntry({ ...entry, cases: nextCases });
                    }}
                    ariaLabel={`Junction case ${caseIndex + 1} label`}
                  />
                  {/* The case keeps its own delete. A case is not an entry on
                      the rail — it has no index tile, so it has nowhere else to
                      put one. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove case ${caseIndex + 1}`}
                    className="shrink-0 cursor-pointer text-destructive"
                    onClick={() => {
                      const nextCases = entry.cases.filter((_, idx) => idx !== caseIndex);
                      void onChangeEntry({ ...entry, cases: nextCases });
                    }}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
                <div className={NESTED}>
                  <PlaylistEntryList
                    entries={playlistCase.entries}
                    depth={depth + 1}
                    flowNodeId={flowNodeId}
                    allNodes={allNodes}
                    onCycleBlocked={onCycleBlocked}
                    onCreateNode={onCreateNode}
                    onChange={(nextEntries) => {
                      const nextCases = entry.cases.map((item, idx) => {
                        if (idx !== caseIndex) return item;
                        return { ...item, entries: nextEntries };
                      });
                      return onChangeEntry({ ...entry, cases: nextCases });
                    }}
                  />
                </div>
              </div>
            ))}

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="cursor-pointer self-start"
              onClick={() => void onChangeEntry({
                ...entry,
                cases: [...entry.cases, { label: `Case ${entry.cases.length + 1}`, entries: [] }],
              })}
            >
              <PlusIcon className="size-4" />
              Add case
            </Button>
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
  heading,
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
      {entries.length === 0 && <p className={cn(CONTENT_COLUMN, "text-xs text-muted-foreground")}>No entries yet.</p>}
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
      <div className={CONTENT_COLUMN}>
        <AddEntryButton
          flowNodeId={flowNodeId}
          allNodes={allNodes}
          entries={entries}
          onChange={onChange}
          onCycleBlocked={onCycleBlocked}
          onCreateNode={onCreateNode}
        />
      </div>
    </>
  );

  if (!heading) {
    return <div className="flex flex-col gap-2">{body}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{heading}</p>
      <div className={cn(NESTED, "flex flex-col gap-2")}>{body}</div>
    </div>
  );
}
