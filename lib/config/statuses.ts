export const STATUSES = [
  { id: "idea",        label: "Idea",        order: 0 },
  { id: "backlog",     label: "Backlog",     order: 1 },
  { id: "prioritized", label: "Prioritized", order: 2 },
  { id: "development", label: "Development", order: 3 },
  { id: "releasing",   label: "Releasing",   order: 4 },
  { id: "live",        label: "Live",        order: 5 },
  { id: "archived",    label: "Archived",    order: 6 },
  { id: "blocked",     label: "Blocked",     order: 7 },
] as const;

export type StatusId = (typeof STATUSES)[number]["id"];
/** @deprecated Use StatusId */
export type Status = StatusId;
