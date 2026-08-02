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
  onSortChange,
  onSelectNode,
}: NodeTableProps) {
  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
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
