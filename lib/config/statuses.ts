export const STATUSES = [
  { id: "idea",           label: "Idea",           order: 0 },
  { id: "planned",        label: "Planned",        order: 1 },
  { id: "in-development", label: "In Development", order: 2 },
  { id: "live",           label: "Live",           order: 3 },
  { id: "deprecated",     label: "Deprecated",     order: 4 },
] as const;

export type StatusId = (typeof STATUSES)[number]["id"];
/** @deprecated Use StatusId */
export type Status = StatusId;
