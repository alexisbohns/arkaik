"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { PanelSection } from "@/components/panels/PanelSection";
import {
  NodeSearchCombobox,
  type NodeSearchComboboxProps,
} from "@/components/panels/NodeSearchCombobox";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { Button } from "@/components/ui/button";
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
 * The combobox is `inline`, not a popover: the panel body scrolls, and a
 * floated list inside it needs portalling to escape the scroll container —
 * a second problem to solve for no gain in a column this narrow.
 *
 * **Focus makes the round trip.** Opening focuses the field, because revealing
 * a search box and leaving focus on the `+` makes the reveal inert until a
 * second click. Closing hands focus back to the `+` — from every close path,
 * the two writes and the toggle alike — because each of them unmounts the
 * field from under it and focus would otherwise fall to `<body>`, which turns
 * attaching three anchors into three Tab traversals back to where you were.
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
  const controlsId = useId();
  const [open, setOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // The toggle's close branch routes through here too. Safari on macOS does
  // not focus a `<button>` on click, so there the `×` unmounts the field
  // without ever having taken focus from it — the exact drop to `<body>` this
  // exists to prevent. Everywhere else the button already holds focus and
  // re-focusing it is a genuine no-op, which is the cheaper half of the trade.
  const close = useCallback(() => {
    setOpen(false);
    addButtonRef.current?.focus();
  }, []);

  return (
    <PanelSection
      title={label}
      action={
        add && (
          <Button
            ref={addButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={open ? `Close ${label} search` : `Add to ${label}`}
            aria-expanded={open}
            // Only while the target exists: `aria-controls` pointing at an id
            // nothing answers to is a broken reference, not an empty one.
            aria-controls={open ? controlsId : undefined}
            onClick={() => (open ? close() : setOpen(true))}
          >
            {open ? <XIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
          </Button>
        )
      }
    >
      {add && open && (
        <div id={controlsId}>
          <NodeSearchCombobox
            species={add.counterpartSpecies}
            allNodes={add.allNodes}
            excludeIds={add.excludeIds}
            placeholder={add.placeholder}
            freeText={add.freeText}
            disabled={add.disabled}
            autoFocus
            placement="inline"
            onSelect={async (nodeId) => {
              // `false` is the handler saying the write failed; the line then
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
        </div>
      )}
      {children}
    </PanelSection>
  );
}

/**
 * One row of a relation line: the entity, and — where the surface can write —
 * the `×` that removes the edge.
 *
 * `EntityRow` supplies the chip and the hover card, so a relation row copies its
 * own id and opens its own panel like every other cross-reference in a panel.
 * The trailing slot is for whatever the line has to say beyond the title (the
 * counterpart's species, an acceptance's platform glyphs).
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
    <li className="flex items-center gap-1">
      <EntityRow node={node} onOpen={onNavigate && (() => onNavigate(node))} className="min-w-0 flex-1">
        <span className="min-w-0 flex-1 truncate">{node.title}</span>
        {children}
      </EntityRow>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={removeLabel ?? `Remove ${node.title}`}
          onClick={onRemove}
        >
          <XIcon className="size-3.5" />
        </Button>
      )}
    </li>
  );
}
