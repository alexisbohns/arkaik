"use client";

import { useCallback, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import { PanelSection } from "@/components/panels/PanelSection";
import { AddPopover, ADD_POPOVER_COMBOBOX } from "@/components/panels/AddPopover";
import {
  NodeSearchCombobox,
  type NodeSearchComboboxProps,
} from "@/components/panels/NodeSearchCombobox";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Node } from "@/lib/data/types";
import type { SpeciesId } from "@arkaik/schema";

/**
 * One relation of a record: its label, a `+` on that same line, its rows below.
 *
 * A `PanelSection`, not a hand-rolled heading row. That component's `action`
 * slot is already "a ghost Button pushed to the right of the heading … hoisted
 * here so the next section that needs one does not re-derive the
 * `justify-between` row", which is exactly what the `+` is — so the panel
 * gutter, the `h4`-inside-a-`PanelGroup` heading semantics and the section
 * spacing all come from one place and keep agreeing with every other section.
 *
 * **An empty writable line is one line.** No em-dash, no "None yet", no input:
 * the heading and the `+`, and nothing under them. That is the whole point of
 * the shape — a relation that has nothing in it costs a line rather than a
 * labelled empty control — and it is also why a caller with no `add` must drop
 * an empty line entirely rather than render it. A bare label over nothing is an
 * empty state; a label with a `+` is an invitation.
 *
 * The search is an {@link AddPopover} — the same card the playlist's Add step
 * opens, from the same component. See there for why it floats rather than
 * sitting in the layout, and for what Radix owns: the field takes focus on
 * open, the trigger takes it back on close, and the trigger's `aria-expanded`
 * and `aria-controls` come with it. This component adds only when to close.
 */
interface RelationLineProps {
  label: string;
  /** The rows. Absent means the line is heading-and-`+` only. */
  children?: ReactNode;
  /** Absent means read-only: no `+`, and the caller drops the line when empty. */
  add?: {
    counterpartSpecies: readonly SpeciesId[];
    allNodes: Node[];
    /**
     * Ids already on this line, plus the record itself. Never offered.
     *
     * Memoise it at the call site: it is a dependency of the combobox's
     * candidate memo, which fuzzy-scores every node in the project.
     */
    excludeIds: readonly string[];
    /**
     * Attach an existing node. Returning `false` means the write failed and
     * the line stays open over the query, as with {@link onCreate}.
     */
    onSelect: (nodeId: string) => Promise<boolean | void> | boolean | void;
    /** Create and relate. Returning `false` means the write failed. */
    onCreate?: (species: SpeciesId, title: string) => Promise<boolean | void> | boolean | void;
    /**
     * The combobox's own member type rather than a restatement of it: the
     * shape was written out in both files and nothing would have caught the
     * two copies drifting apart.
     */
    freeText?: NodeSearchComboboxProps["freeText"];
    placeholder?: string;
    /** A write is in flight — the field says so and refuses another. */
    disabled?: boolean;
    /**
     * Whether a successful pick closes the line. Default `true`. A line whose
     * common gesture is "attach three things" sets it `false` and lets the `+`
     * — now an `×` — say when it is done.
     */
    closeOnSelect?: boolean;
  };
}

export function RelationLine({ label, children, add }: RelationLineProps) {
  // Per-mount: the panel stack keeps hidden panels mounted, so two open records
  // mean two "Calls" lines in one document.
  const [open, setOpen] = useState(false);

  // Only ever called for a write that landed. A failed one leaves the card
  // open over the query that produced it, which is the whole point of the
  // `false` the handlers can return — and it is why `onOpenChange` below is
  // Radix's own dismissals and nothing else.
  const close = useCallback(() => setOpen(false), []);

  return (
    <PanelSection
      title={label}
      action={
        add && (
          <AddPopover label={`Add to ${label}`} open={open} onOpenChange={setOpen}>
            <NodeSearchCombobox
              {...ADD_POPOVER_COMBOBOX}
              species={add.counterpartSpecies}
              allNodes={add.allNodes}
              excludeIds={add.excludeIds}
              placeholder={add.placeholder}
              freeText={add.freeText}
              disabled={add.disabled}
              onSelect={async (nodeId) => {
                // `false` is the handler saying the write failed; the card then
                // stays open over the query that produced it — the combobox
                // reads the same `false` and keeps the field's text.
                if ((await add.onSelect(nodeId)) === false) return false;
                if (add.closeOnSelect !== false) close();
              }}
              onCreate={
                add.onCreate &&
                (async (species, title) => {
                  if ((await add.onCreate?.(species, title)) === false) return false;
                  close();
                })
              }
            />
          </AddPopover>
        )
      }
    >
      {children}
    </PanelSection>
  );
}

/**
 * The row's hover group, named — and exported, because a row that is not an
 * entity (`BlockedByField`'s free text) has to wear the same one to reveal its
 * `×` the same way.
 *
 * Named because `group-hover:` unnamed would also fire from `EntityRow`'s own
 * hover styling if that ever became a group, and because a named group is a
 * descendant selector: `group-hover/relation-row:` lights from ANY ancestor
 * carrying this name, so a nesting row would light every level at once. These
 * rows never nest — a relation row holds an entity, not another row — and
 * nothing above them in a panel claims this name.
 */
export const RELATION_ROW_GROUP = "group/relation-row";

/**
 * The `×`'s reveal, as one string because two components wear it: the entity
 * row below and `BlockedByField`'s plain-text row, which is not an entity and
 * so cannot use {@link RelationRowItem} but must fade identically.
 *
 * `disabled:opacity-100` keeps it on screen while its own write commits. A
 * control that vanishes mid-gesture is worse than one that greys out: the
 * round trip is exactly when the reader wants to see that something is
 * happening to the thing they clicked, and the pointer may well have drifted
 * off the row by then.
 */
export const REMOVE_ON_ROW_HOVER = cn(
  "opacity-0 transition-opacity",
  "group-hover/relation-row:opacity-100 group-focus-within/relation-row:opacity-100",
  "focus-visible:opacity-100 disabled:opacity-100",
);

/**
 * One row of a relation line: the entity, and — where the surface can write —
 * the `×` that removes the edge.
 *
 * `EntityRow` supplies the chip and the hover card, so a relation row copies its
 * own id and opens its own panel like every other cross-reference in a panel.
 * The trailing slot is for whatever the line has to say beyond the title (the
 * counterpart's species, an acceptance's platform glyphs).
 *
 * **The `×` is quiet until you reach for it.** A column of them down a list
 * reads as a column of buttons rather than a list of relations, and removal is
 * the rare gesture here. So it fades in on row hover — and on keyboard focus
 * too, via {@link REMOVE_ON_ROW_HOVER}, because hover alone would be a mouse-only
 * control. Opacity, never `hidden`: the box keeps its space, so nothing under
 * the pointer moves when the pointer arrives.
 */
export function RelationRowItem({
  node,
  onNavigate,
  onRemove,
  removeLabel,
  children,
}: {
  node: Node;
  onNavigate?: (node: Node) => void;
  onRemove?: () => void;
  /** Names the gesture for a screen reader — "Stop covering Checkout". */
  removeLabel?: string;
  children?: ReactNode;
}) {
  return (
    <li className={cn(RELATION_ROW_GROUP, "flex items-center gap-1")}>
      <EntityRow node={node} onOpen={onNavigate && (() => onNavigate(node))} className="min-w-0 flex-1">
        <span className="min-w-0 flex-1 truncate">{node.title}</span>
        {children}
      </EntityRow>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-7 shrink-0", REMOVE_ON_ROW_HOVER)}
          aria-label={removeLabel ?? `Remove ${node.title}`}
          onClick={onRemove}
        >
          <XIcon className="size-3.5" />
        </Button>
      )}
    </li>
  );
}
