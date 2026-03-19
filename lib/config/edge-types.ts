export const EDGE_TYPES = [
  { id: "composes", label: "Composes" },
  { id: "branches", label: "Branches" },
  { id: "calls",    label: "Calls" },
  { id: "displays", label: "Displays" },
  { id: "queries",  label: "Queries" },
] as const;

export type EdgeTypeId = (typeof EDGE_TYPES)[number]["id"];
