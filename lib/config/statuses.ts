import type { StatusId } from "@arkaik/schema";

export const STATUSES = [
  { id: "idea",        label: "Idea",        order: 0 },
  { id: "discovery",   label: "Discovery",   order: 1 },
  { id: "backlog",     label: "Backlog",     order: 2 },
  { id: "development", label: "Development", order: 3 },
  { id: "releasing",   label: "Releasing",   order: 4 },
  { id: "live",        label: "Live",        order: 5 },
  { id: "archived",    label: "Archived",    order: 6 },
] as const satisfies readonly { id: StatusId; label: string; order: number }[];

export type { StatusId };
/** @deprecated Use StatusId */
export type Status = StatusId;

// Note the trap at the top of the order: `archived` (6) outranks `live` (5).
// A counted preset that ever includes a terminal status would both sort it
// first in severity and report it as the rollup's display status — today's
// `delivery` preset stops at `live`, which is what keeps that from biting.
export const STATUS_ORDER: Record<StatusId, number> = Object.fromEntries(
  STATUSES.map((status) => [status.id, status.order]),
) as Record<StatusId, number>;

export const COUNTED_STATUS_PRESETS = {
  delivery: ["backlog", "development", "releasing", "live"],
} as const satisfies Record<string, readonly StatusId[]>;

export type CountedStatusPresetId = keyof typeof COUNTED_STATUS_PRESETS;

export const DEFAULT_COUNTED_STATUS_PRESET_ID: CountedStatusPresetId = "delivery";

export function getCountedStatuses(
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): readonly StatusId[] {
  return COUNTED_STATUS_PRESETS[presetId];
}

export function isCountedStatus(
  status: StatusId,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): boolean {
  return getCountedStatuses(presetId).includes(status);
}
