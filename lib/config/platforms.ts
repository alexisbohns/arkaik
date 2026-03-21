export const PLATFORMS = [
  { id: "web",     label: "Web",     icon: "Monitor" },
  { id: "ios",     label: "iOS",     icon: "Apple" },
  { id: "android", label: "Android", icon: "Bot" },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]["id"];
/** @deprecated Use PlatformId */
export type Platform = PlatformId;
