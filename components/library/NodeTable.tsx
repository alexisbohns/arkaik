"use client";

import { ArrowUpDownIcon } from "lucide-react";
import { PRODUCT_MEMBERSHIP_SPECIES } from "@arkaik/schema";
import type { Node } from "@/lib/data/types";
import { scopedPlatforms, type ProductScope } from "@/lib/utils/product-scope";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type NodeSortKey = "id" | "title" | "species" | "status" | "usedIn";
export type SortDirection = "asc" | "desc";

export interface NodeSortState {
  key: NodeSortKey;
  direction: SortDirection;
}

interface NodeTableProps {
  nodes: Node[];
  sort: NodeSortState;
  speciesLabelById: Record<string, string>;
  statusLabelById: Record<string, string>;
  usedInByNodeId: Record<string, number>;
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
   * Ticks or clears every row **this table was given** — which is the filtered,
   * searched, currently-visible list, never the whole library. See the page's
   * `toggleAllVisible`.
   */
  onToggleAll?: () => void;
  onSortChange: (key: NodeSortKey) => void;
  onSelectNode: (node: Node) => void;
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

const SORTABLE_COLUMNS: Array<{ key: NodeSortKey; label: string }> = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "species", label: "Species" },
  { key: "status", label: "Status" },
  { key: "usedIn", label: "Used in" },
];

export function NodeTable({
  nodes,
  sort,
  speciesLabelById,
  statusLabelById,
  usedInByNodeId,
  scope,
  productLabelsByNodeId,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  onSortChange,
  onSelectNode,
}: NodeTableProps) {
  // Checked only when every visible row is in the set — and `nodes.length > 0`
  // so an empty table does not render a ticked "select all" over nothing.
  const allVisibleSelected =
    selectedIds !== undefined &&
    nodes.length > 0 &&
    nodes.every((node) => selectedIds.has(node.id));

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          {selectedIds !== undefined && (
            <TableHead className="w-8">
              <input
                type="checkbox"
                aria-label="Select all visible nodes"
                className="size-4 cursor-pointer accent-primary"
                checked={allVisibleSelected}
                onChange={() => onToggleAll?.()}
              />
            </TableHead>
          )}
          {SORTABLE_COLUMNS.map((column) => (
            <TableHead key={column.key}>
              <button
                type="button"
                onClick={() => onSortChange(column.key)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {column.label}
                <ArrowUpDownIcon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">
                  {sort.key === column.key ? `sorted ${sort.direction}` : "not sorted"}
                </span>
              </button>
            </TableHead>
          ))}
          {productLabelsByNodeId !== undefined && <TableHead>Product</TableHead>}
          <TableHead>Platforms</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.map((node) => {
          const usedInCount = usedInByNodeId[node.id] ?? 0;
          const platforms = scopedPlatforms(node, scope);
          return (
            <TableRow key={node.id} data-wobble-group className="cursor-pointer" onClick={() => onSelectNode(node)}>
              {selectedIds !== undefined && (
                // The whole row opens the node, so the cell swallows the click
                // as well as the box: a fat-fingered tap on the padding around
                // a checkbox must not navigate away mid-selection.
                <TableCell className="w-8" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${node.title}`}
                    className="size-4 cursor-pointer accent-primary"
                    checked={selectedIds.has(node.id)}
                    onChange={() => onToggleSelected?.(node.id)}
                  />
                </TableCell>
              )}
              <TableCell className="font-mono text-xs">{node.id}</TableCell>
              <TableCell className="max-w-[280px] truncate">{node.title}</TableCell>
              <TableCell>{speciesLabelById[node.species] ?? node.species}</TableCell>
              <TableCell>{statusLabelById[node.status] ?? node.status}</TableCell>
              <TableCell>{usedInCount > 0 ? `${usedInCount} flow${usedInCount === 1 ? "" : "s"}` : "-"}</TableCell>
              {productLabelsByNodeId !== undefined && (
                <TableCell>{productCellText(node, productLabelsByNodeId[node.id] ?? [])}</TableCell>
              )}
              <TableCell>{platforms.length > 0 ? platforms.join(", ") : "-"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
