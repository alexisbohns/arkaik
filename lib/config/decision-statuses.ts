import type { DecisionStatusId } from "@arkaik/schema";

export const DECISION_STATUSES = [
  { id: "proposed",   label: "Proposed",   order: 0 },
  { id: "approved",   label: "Approved",   order: 1 },
  { id: "enacted",    label: "Enacted",    order: 2 },
  { id: "rejected",   label: "Rejected",   order: 3 },
  { id: "deprecated", label: "Deprecated", order: 4 },
  { id: "superseded", label: "Superseded", order: 5 },
] as const satisfies readonly { id: DecisionStatusId; label: string; order: number }[];

export type { DecisionStatusId };
