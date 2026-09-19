"use client";

import { PRODUCT_MEMBERSHIP_SPECIES, resolvePlatformStatus } from "@arkaik/schema";
import type { Node } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import { blockedByOf } from "@/lib/utils/blocked";
import { scopedPlatforms, type ProductScope } from "@/lib/utils/product-scope";
import { CopyIdChip, SpeciesBadge } from "@/components/graph/nodes/EntityBadges";
import { StatusMark } from "@/components/graph/nodes/StatusMark";
import { RelatedNodesPopover } from "@/components/layout/RelatedNodesPopover";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type NodeSortKey = "title" | "species" | "status" | "usedIn";
export type SortDirection = "asc" | "desc";

export interface NodeSortState {
  key: NodeSortKey;
  direction: SortDirection;
}

interface NodeTableProps {
  nodes: Node[];
  sort: NodeSortState;
  speciesLabelById: Record<string, string>;
  /** What each species *is*, for the species glyph's hover card. */
  speciesDescriptionById?: Record<string, string>;
  /**
   * `nodeId → the flows whose playlist reaches it`, from `findWhereUsed`.
   *
   * The nodes themselves, not a count: the cell shows the number and opens the
   * list behind it, so a reader who sees "3" can find out which three without
   * leaving the table.
   */
  usedInByNodeId: Record<string, Node[]>;
  /** The surface's product scope — resolved once at the page, never per row. */
  scope: ProductScope;
  /**
   * `nodeId → product titles`, from `productLabelsOfNode`.
   *
   * **`undefined` is not an empty map.** It means the project declares no
   * products, and the table renders exactly the columns it did before this
   * feature existed. A map with an empty entry means products exist and this
   * node is in none of them.
   */
  productLabelsByNodeId?: Record<string, string[]>;
  /**
   * The selected node ids, or `undefined` when the surface has no selection.
   *
   * **`undefined` is not an empty set**, the same distinction
   * `productLabelsByNodeId` above draws: it means there is no selection
   * mechanism here, so the checkbox column does not exist and the table renders
   * exactly the columns it did before. An empty set means the surface selects
   * and nothing is selected yet.
   */
  selectedIds?: ReadonlySet<string>;
  onToggleSelected?: (nodeId: string) => void;
  /**
   * Adds every row **this table was given** to the selection, or removes them
   * all when they are already in it — the filtered, searched, currently-visible
   * list, never the whole library, and never at the expense of a selection made
   * under another filter. See the page's `toggleAllVisible`.
   */
  onToggleAll?: () => void;
  onSortChange: (key: NodeSortKey) => void;
  onSelectNode: (node: Node) => void;
  /**
   * Fill the pane instead of being a block in a scrolling column: the table owns
   * the scrollport, so its header stays put over the rows moving under it.
   *
   * The directory view's default. A table is the one surface that reads as the
   * whole panel — the column labels are the only thing telling you what the
   * numbers mean, and losing them off the top edge is losing the table.
   */
  fill?: boolean;
}

/**
 * The Product cell, mirroring `NodeCard`'s badge and for the same reason: a flow
 * stores its membership, a data model only ever derives one from who reaches it,
 * and an empty derivation is the finding rather than a blank. A table column is
 * already labelled, so the cell drops the card's "Used by:" prefix and keeps
 * only what the two cases genuinely differ on — "Unattached" versus "-".
 */
function productCellText(node: Node, labels: string[]): string {
  if (labels.length > 0) return labels.join(", ");
  return PRODUCT_MEMBERSHIP_SPECIES.includes(node.species) ? "-" : "Unattached";
}

/**
 * A sortable column label.
 *
 * **No sort glyph.** An `ArrowUpDownIcon` after every label is five identical
 * arrows saying "this is a table", in a header where at most one column is
 * sorted at a time — and the double-headed arrow does not even say which way.
 * The column actually in force is the one drawn in the foreground colour, the
 * direction is in the screen-reader text, and the affordance is that the label
 * is a button.
 */
function SortHeader({
  column,
  label,
  sort,
  onSortChange,
  className,
}: {
  column: NodeSortKey;
  label: string;
  sort: NodeSortState;
  onSortChange: (key: NodeSortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSortChange(column)}
        className={cn(
          "inline-flex cursor-pointer items-center text-xs font-semibold uppercase tracking-wide",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        <span className="sr-only">{active ? `sorted ${sort.direction}` : "not sorted"}</span>
      </button>
    </TableHead>
  );
}

export function NodeTable({
  nodes,
  sort,
  speciesLabelById,
  speciesDescriptionById,
  usedInByNodeId,
  scope,
  productLabelsByNodeId,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  onSortChange,
  onSelectNode,
  fill,
}: NodeTableProps) {
  // Checked only when every visible row is in the set — and `nodes.length > 0`
  // so an empty table does not render a ticked "select all" over nothing.
  const allVisibleSelected =
    selectedIds !== undefined &&
    nodes.length > 0 &&
    nodes.every((node) => selectedIds.has(node.id));

  /**
   * SOME-BUT-NOT-ALL is a third state, and it has to be shown: without it a
   * partial selection renders an empty box indistinguishable from "nothing
   * selected", and the control would misreport what a click is about to do —
   * the box is unchecked, so clicking it *adds* the rest, while it looks like
   * clicking will do nothing at all.
   *
   * Radix takes `checked="indeterminate"` as a plain prop, so this is now the
   * whole of it. The native `indeterminate` it replaces is an IDL property
   * settable only from JavaScript, which is why this used to need a ref and an
   * effect to reach the DOM node after every render.
   */
  const someVisibleSelected =
    selectedIds !== undefined && nodes.some((node) => selectedIds.has(node.id));
  const selectAllState = allVisibleSelected
    ? true
    : someVisibleSelected
      ? "indeterminate"
      : false;

  return (
    <Table
      className="text-sm"
      containerClassName={fill ? "h-full overflow-auto" : undefined}
    >
      {/* `bg-card` on the sticky header is load-bearing: a `<thead>` pinned over
          a transparent background lets the rows read straight through it.

          So is the shadow, and it is a *shadow* rather than the `border-b` the
          header row already carries. The table collapses its borders, so a
          collapsed border belongs to the table's own border box and not to the
          `<thead>` that declared it — it stays where the table's first row
          started and scrolls away with it, leaving rows to slide under an
          opaque band with no edge to slide under. An inset shadow is painted by
          the sticky element itself, so it travels with it. */}
      <TableHeader
        className={
          fill
            ? "sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_0_hsl(var(--border))]"
            : undefined
        }
      >
        <TableRow>
          {selectedIds !== undefined && (
            <TableHead className="w-8">
              <Checkbox
                aria-label="Select all visible nodes"
                className="cursor-pointer"
                checked={selectAllState}
                onCheckedChange={() => onToggleAll?.()}
              />
            </TableHead>
          )}
          {/* Species first: it is the one column that says what kind of thing
              the row is, and a reader scanning a mixed library sorts by shape
              before they read a single title. Then the title, its status, where
              it is available, and what uses it. */}
          {/* Every column but the title shrinks to its own content —
              `w-px` on a table cell is the "as narrow as it can be" idiom, since
              a table's own layout raises it to the widest cell in the column.
              The title takes everything that is left, so a row of four glyphs
              stays a row of four glyphs instead of being dealt out across the
              width of the pane with a hand's width of nothing between each. */}
          <SortHeader className="w-px" column="species" label="Species" sort={sort} onSortChange={onSortChange} />
          <SortHeader className="w-full" column="title" label="Title" sort={sort} onSortChange={onSortChange} />
          <SortHeader className="w-px" column="status" label="Status" sort={sort} onSortChange={onSortChange} />
          <TableHead className="w-px">Platforms</TableHead>
          <SortHeader className="w-px" column="usedIn" label="Used in" sort={sort} onSortChange={onSortChange} />
          {productLabelsByNodeId !== undefined && <TableHead className="w-px">Product</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.map((node) => {
          const usedIn = usedInByNodeId[node.id] ?? [];
          const platforms = scopedPlatforms(node, scope);
          return (
            <TableRow key={node.id} data-wobble-group className="group/row cursor-pointer" onClick={() => onSelectNode(node)}>
              {selectedIds !== undefined && (
                // The whole row opens the node, so the cell swallows the click
                // as well as the box: a fat-fingered tap on the padding around
                // a checkbox must not navigate away mid-selection.
                <TableCell className="w-8" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    // Titles are not unique in this app — two products' "Home"
                    // views are ordinary — so the accessible name says the id
                    // too rather than reading out three identical "Select Home"
                    // boxes. It is the one place the id is always spoken now
                    // that the chip beside the title only appears on hover.
                    aria-label={`Select ${node.title} (${node.id})`}
                    className="cursor-pointer"
                    checked={selectedIds.has(node.id)}
                    onCheckedChange={() => onToggleSelected?.(node.id)}
                  />
                </TableCell>
              )}
              {/* The glyph the canvas uses for this species, with the name and
                  its definition in the hover card — the badge the panel header
                  and the cards already carry. A column of repeated words became
                  a column of shapes you can scan. */}
              <TableCell className="w-px" onClick={(event) => event.stopPropagation()}>
                <SpeciesBadge
                  species={node.species}
                  label={speciesLabelById[node.species] ?? node.species}
                  description={speciesDescriptionById?.[node.species]}
                />
              </TableCell>
              {/* The id rides on the title, and only under the pointer: it is
                  a column of hashes at rest, saying the same nothing in every
                  row, and the one thing anybody wants from it is the clipboard.
                  It keeps its slot whether or not it is showing — `opacity`,
                  not a mount — so a title does not jump sideways as the pointer
                  crosses the row. Focus reveals it too, since a keyboard reader
                  tabbing to the chip must be able to see what they are on. */}
              {/* `w-full max-w-0` is what makes the truncation work: a table
                  cell is sized by its content, so a long title would widen the
                  column rather than clip, whatever `min-w-0` the flex child
                  carries. Zero max-width takes that vote away, and `w-full`
                  hands the cell every pixel the shrunk columns did not take. */}
              <TableCell className="w-full max-w-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate">{node.title}</span>
                  <span
                    onClick={(event) => event.stopPropagation()}
                    className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                  >
                    <CopyIdChip id={node.id} />
                  </span>
                </span>
              </TableCell>
              {/* `StatusBadge`, so the status is the same coloured glyph here
                  as on the canvas, with its name in the tooltip — and so the
                  blocked overlay comes from the one component that draws it,
                  rather than from a red `BanIcon` this table pinned on itself. */}
              <TableCell className="w-px">
                <StatusBadge status={node.status as StatusId} blockedBy={blockedByOf(node.metadata)} />
              </TableCell>
              {/* One {@link StatusMark} per platform: the platform by its
                  shape, its status on that platform by its colour, both names
                  in the tooltip. The strip the Acceptances matrix reads with,
                  in place of "web, ios" repeated down the column. */}
              <TableCell className="w-px">
                {platforms.length === 0 ? (
                  "-"
                ) : (
                  <span className="flex items-center gap-1.5">
                    {platforms.map((platform) => (
                      <StatusMark key={platform} platform={platform} status={resolvePlatformStatus(node, platform)} />
                    ))}
                  </span>
                )}
              </TableCell>
              {/* A number, and the flows themselves one hover away. "3 flows"
                  spelled the unit out in every row of a column already headed
                  "Used in"; which three was the part nobody could get to. */}
              <TableCell className="w-px" onClick={(event) => event.stopPropagation()}>
                {usedIn.length === 0 ? (
                  "-"
                ) : (
                  <RelatedNodesPopover
                    label="Used in"
                    nodes={usedIn}
                    onSelect={onSelectNode}
                    trigger={
                      <button
                        type="button"
                        aria-label={`Used in ${usedIn.length} flow${usedIn.length === 1 ? "" : "s"}`}
                        className="cursor-pointer tabular-nums underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {usedIn.length}
                      </button>
                    }
                  />
                )}
              </TableCell>
              {productLabelsByNodeId !== undefined && (
                <TableCell className="w-px">{productCellText(node, productLabelsByNodeId[node.id] ?? [])}</TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
