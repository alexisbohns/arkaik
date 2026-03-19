export const PLATFORMS = [
  { id: "web",     label: "Web",     emoji: "🟢" },
  { id: "ios",     label: "iOS",     emoji: "🔵" },
  { id: "android", label: "Android", emoji: "🟣" },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]["id"];
/** @deprecated Use PlatformId */
export type Platform = PlatformId;
