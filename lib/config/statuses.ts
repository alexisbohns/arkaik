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

export const STATUS_ORDER: Record<StatusId, number> = Object.fromEntries(
  STATUSES.map((status) => [status.id, status.order]),
) as Record<StatusId, number>;

export const COUNTED_STATUS_PRESETS = {
  delivery: ["prioritized", "development", "releasing", "live", "blocked"],
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
