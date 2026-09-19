"use client";

import { useId, useState, type ReactNode } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { PanelSection } from "@/components/panels/PanelSection";
import { NodeSearchCombobox } from "@/components/panels/NodeSearchCombobox";
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
 */
interface RelationLineProps {
  label: string;
  /** The rows. Absent means the line is heading-and-`+` only. */
  children?: ReactNode;
  /** Absent means read-only: no `+`, and the caller drops the line when empty. */
  add?: {
    counterpartSpecies: readonly SpeciesId[];
    allNodes: Node[];
    /** Ids already on this line, plus the record itself. Never offered. */
    excludeIds: readonly string[];
    onSelect: (nodeId: string) => void;
    onCreate?: (species: SpeciesId, title: string) => Promise<void> | void;
    freeText?: { render: (query: string) => ReactNode; onCommit: (text: string) => void };
    placeholder?: string;
  };
}

export function RelationLine({ label, children, add }: RelationLineProps) {
  // Per-mount: the panel stack keeps hidden panels mounted, so two open records
  // mean two "Calls" lines in one document.
  const controlsId = useId();
  const [open, setOpen] = useState(false);

  return (
    <PanelSection
      title={label}
      action={
        add && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={open ? `Close ${label} search` : `Add to ${label}`}
            aria-expanded={open}
            aria-controls={controlsId}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
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
            placement="inline"
            onSelect={(nodeId) => {
              add.onSelect(nodeId);
              setOpen(false);
            }}
            onCreate={
              add.onCreate &&
              (async (species, title) => {
                await add.onCreate?.(species, title);
                setOpen(false);
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
