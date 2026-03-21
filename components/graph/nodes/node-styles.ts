import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import type { LucideIcon } from "lucide-react";
import { Monitor, Apple, Bot } from "lucide-react";

export const STATUS_STYLES: Record<StatusId, { badge: string; dot: string }> = {
  idea: { badge: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
  planned: { badge: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  "in-development": { badge: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  live: { badge: "bg-green-100 text-green-700", dot: "bg-green-500" },
  deprecated: { badge: "bg-red-100 text-red-700", dot: "bg-red-500" },
};

export const STATUS_LABELS: Record<StatusId, string> = {
  idea: "Idea",
  planned: "Planned",
  "in-development": "In Development",
  live: "Live",
  deprecated: "Deprecated",
};

export const PLATFORM_ICONS: Record<PlatformId, LucideIcon> = {
  web: Monitor,
  ios: Apple,
  android: Bot,
};

export const PLATFORM_DOT_STYLES: Record<PlatformId, string> = {
  web: "bg-green-500",
  ios: "bg-blue-500",
  android: "bg-purple-500",
};

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  web: "Web",
  ios: "iOS",
  android: "Android",
};

export const PLATFORM_BORDER_STYLES: Record<PlatformId, string> = {
  web: "border-green-500",
  ios: "border-blue-500",
  android: "border-purple-500",
};

export const STATUS_GHOST_STYLES: Record<StatusId, { wrapper: string; border: string }> = {
  idea: { wrapper: "opacity-60", border: "border-dashed" },
  planned: { wrapper: "", border: "" },
  "in-development": { wrapper: "", border: "" },
  live: { wrapper: "", border: "" },
  deprecated: { wrapper: "", border: "" },
};
