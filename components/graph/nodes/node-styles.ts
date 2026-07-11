import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import type { SpeciesId } from "@/lib/config/species";
import type { RefType } from "@/lib/data/types";
import type { LucideIcon } from "lucide-react";
import {
  Monitor,
  Apple,
  Bot,
  MonitorSmartphone,
  Network,
  Database,
  Plug,
  Lightbulb, CircleDashed, CircleDotDashed, CirclePlay, CircleFadingArrowUp,
  CircleCheckBig, CircleSlash, CircleX,
  Figma, Github, Gitlab, Ticket, GitPullRequest, GitMerge, ExternalLink, Link2,
} from "lucide-react";

export const STATUS_STYLES: Record<StatusId, { badge: string; dot: string }> = {
  idea:        { badge: "text-gray-400",    dot: "bg-gray-400"    },
  backlog:     { badge: "text-gray-500",    dot: "bg-gray-500"    },
  prioritized: { badge: "text-blue-400",    dot: "bg-blue-400"    },
  development: { badge: "text-blue-500",    dot: "bg-blue-500"    },
  releasing:   { badge: "text-purple-500",  dot: "bg-purple-500"  },
  live:        { badge: "text-green-500",   dot: "bg-green-500"   },
  archived:    { badge: "text-gray-400",    dot: "bg-gray-400"    },
  blocked:     { badge: "text-red-500",     dot: "bg-red-500"     },
};

export const STATUS_ICONS: Record<StatusId, LucideIcon> = {
  idea:        Lightbulb,
  backlog:     CircleDashed,
  prioritized: CircleDotDashed,
  development: CirclePlay,
  releasing:   CircleFadingArrowUp,
  live:        CircleCheckBig,
  archived:    CircleSlash,
  blocked:     CircleX,
};

export const STATUS_LABELS: Record<StatusId, string> = {
  idea:        "Idea",
  backlog:     "Backlog",
  prioritized: "Prioritized",
  development: "Development",
  releasing:   "Releasing",
  live:        "Live",
  archived:    "Archived",
  blocked:     "Blocked",
};

export const PLATFORM_ICONS: Record<PlatformId, LucideIcon> = {
  web:     Monitor,
  ios:     Apple,
  android: Bot,
};

export const SPECIES_ICONS: Record<SpeciesId, LucideIcon> = {
  flow: Network,
  view: MonitorSmartphone,
  "data-model": Database,
  "api-endpoint": Plug,
};

export const PLATFORM_DOT_STYLES: Record<PlatformId, string> = {
  web:     "bg-green-500",
  ios:     "bg-blue-500",
  android: "bg-purple-500",
};

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  web:     "Web",
  ios:     "iOS",
  android: "Android",
};

export const PLATFORM_BORDER_STYLES: Record<PlatformId, string> = {
  web:     "border-green-500",
  ios:     "border-blue-500",
  android: "border-purple-500",
};

export const STATUS_GHOST_STYLES: Record<StatusId, { wrapper: string; border: string }> = {
  idea:        { wrapper: "opacity-60", border: "border-dashed" },
  backlog:     { wrapper: "",           border: ""              },
  prioritized: { wrapper: "",           border: ""              },
  development: { wrapper: "",           border: ""              },
  releasing:   { wrapper: "",           border: ""              },
  live:        { wrapper: "",           border: ""              },
  archived:    { wrapper: "opacity-60", border: ""              },
  blocked:     { wrapper: "",           border: ""              },
};

// Known `Ref.type` values (docs/spec/bundle-format.md § References). Keyed by
// plain `string`, not `RefType`, because `Ref.type` also accepts unrecognized
// values (`RefType | (string & {})`); unrecognized types fall back to
// REF_TYPE_ICON_FALLBACK / REF_TYPE_LABEL_FALLBACK and render as generic links,
// per the format's "unknown types MUST be preserved" rule.
export const REF_TYPE_ICONS: Record<string, LucideIcon> = {
  figma:            Figma,
  "github-issue":   Github,
  "gitlab-issue":   Gitlab,
  "linear-issue":   Ticket,
  "github-pr":      GitPullRequest,
  "gitlab-mr":      GitMerge,
  url:              ExternalLink,
} satisfies Record<RefType, LucideIcon>;

export const REF_TYPE_LABELS: Record<string, string> = {
  figma:            "Figma",
  "github-issue":   "GitHub Issue",
  "gitlab-issue":   "GitLab Issue",
  "linear-issue":   "Linear Issue",
  "github-pr":      "GitHub PR",
  "gitlab-mr":      "GitLab MR",
  url:              "Link",
} satisfies Record<RefType, string>;

export const REF_TYPE_ICON_FALLBACK: LucideIcon = Link2;
export const REF_TYPE_LABEL_FALLBACK = "Link";
