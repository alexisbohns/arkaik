import type { LucideIcon } from "lucide-react";
import { CircleUser, CircleGauge, CircleAlert } from "lucide-react";

export const STAGES = [
  { id: "beta",       label: "Beta"       },
  { id: "monitoring", label: "Monitoring" },
  { id: "deprecated", label: "Deprecated" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export const STAGE_ICONS: Record<StageId, LucideIcon> = {
  beta:       CircleUser,
  monitoring: CircleGauge,
  deprecated: CircleAlert,
};

export const STAGE_LABELS: Record<StageId, string> = {
  beta:       "Beta",
  monitoring: "Monitoring",
  deprecated: "Deprecated",
};

export const STAGE_STYLES: Record<StageId, string> = {
  beta:       "text-purple-400",
  monitoring: "text-purple-400",
  deprecated: "text-yellow-500",
};
