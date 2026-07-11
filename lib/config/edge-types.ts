import type { EdgeTypeId } from "@arkaik/schema";

export const EDGE_TYPES = [
  { id: "composes", label: "Composes" },
  { id: "calls",    label: "Calls" },
  { id: "displays", label: "Displays" },
  { id: "queries",  label: "Queries" },
] as const satisfies readonly { id: EdgeTypeId; label: string }[];

export type { EdgeTypeId };
/** @deprecated Use EdgeTypeId */
export type EdgeType = EdgeTypeId;
