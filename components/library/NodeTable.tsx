"use client";

import { ArrowUpDownIcon } from "lucide-react";
import type { Node } from "@/lib/data/types";
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
  onSortChange: (key: NodeSortKey) => void;
  onSelectNode: (node: Node) => void;
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
          <TableHead>Platforms</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.map((node) => {
          const usedInCount = usedInByNodeId[node.id] ?? 0;
          return (
            <TableRow key={node.id} className="cursor-pointer" onClick={() => onSelectNode(node)}>
              <TableCell className="font-mono text-xs">{node.id}</TableCell>
              <TableCell className="max-w-[280px] truncate">{node.title}</TableCell>
              <TableCell>{speciesLabelById[node.species] ?? node.species}</TableCell>
              <TableCell>{statusLabelById[node.status] ?? node.status}</TableCell>
              <TableCell>{usedInCount > 0 ? `${usedInCount} flow${usedInCount === 1 ? "" : "s"}` : "-"}</TableCell>
              <TableCell>{node.platforms.length > 0 ? node.platforms.join(", ") : "-"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
