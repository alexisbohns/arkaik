import type { PlatformId } from "@arkaik/schema";

export const PLATFORMS = [
  { id: "web",     label: "Web",     icon: "Monitor" },
  { id: "ios",     label: "iOS",     icon: "Apple" },
  { id: "android", label: "Android", icon: "Bot" },
] as const satisfies readonly { id: PlatformId; label: string; icon: string }[];

export type { PlatformId };
/** @deprecated Use PlatformId */
export type Platform = PlatformId;
