import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import type { SpeciesId } from "@/lib/config/species";
import type { RefType } from "@/lib/data/types";
import type { DecisionStatusId } from "@/lib/config/decision-statuses";
import type { LucideIcon } from "lucide-react";
import {
  Monitor,
  Apple,
  Bot,
  MonitorSmartphone,
  Network,
  Database,
  Plug,
  ClipboardCheck,
  Scale,
  Lightbulb, Compass, CircleDashed, CirclePlay, CircleFadingArrowUp,
  CircleCheckBig, CircleSlash,
  ThumbsUp, CircleX, Replace,
  Figma, Github, Gitlab, Ticket, GitPullRequest, GitMerge, ExternalLink, Link2,
} from "lucide-react";

// One row per status: text color, dot fill, and SVG arc stroke. A ring, a bar
// and a badge therefore can never drift apart on color.
export const STATUS_STYLES: Record<StatusId, { badge: string; dot: string; stroke: string }> = {
  idea:        { badge: "text-gray-400",    dot: "bg-gray-400",    stroke: "stroke-gray-400"   },
  discovery:   { badge: "text-violet-400",  dot: "bg-violet-400",  stroke: "stroke-violet-400" },
  backlog:     { badge: "text-blue-400",    dot: "bg-blue-400",    stroke: "stroke-blue-400"   },
  development: { badge: "text-blue-500",    dot: "bg-blue-500",    stroke: "stroke-blue-500"   },
  releasing:   { badge: "text-purple-500",  dot: "bg-purple-500",  stroke: "stroke-purple-500" },
  live:        { badge: "text-green-500",   dot: "bg-green-500",   stroke: "stroke-green-500"  },
  archived:    { badge: "text-gray-400",    dot: "bg-gray-400",    stroke: "stroke-gray-400"   },
};

export const STATUS_ICONS: Record<StatusId, LucideIcon> = {
  idea:        Lightbulb,
  discovery:   Compass,
  backlog:     CircleDashed,
  development: CirclePlay,
  releasing:   CircleFadingArrowUp,
  live:        CircleCheckBig,
  archived:    CircleSlash,
};

export const STATUS_LABELS: Record<StatusId, string> = {
  idea:        "Idea",
  discovery:   "Discovery",
  backlog:     "Backlog",
  development: "Development",
  releasing:   "Releasing",
  live:        "Live",
  archived:    "Archived",
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
  acceptance: ClipboardCheck,
  decision: Scale,
};

/**
 * Species → minimap fill. Hex, not Tailwind classes: React Flow paints minimap
 * nodes as SVG rects, and an SVG `fill` can't take a class name.
 *
 * Data models and API endpoints reuse the border colors their cards already
 * wear (amber-500, teal-500), so a species keeps one identity across the map
 * and the minimap. Flow and view cards are status-colored and had no species
 * color to inherit, so they take violet-500 and blue-500 — far enough apart to
 * stay legible at minimap scale, where a node is a few pixels wide.
 */
export const SPECIES_MINIMAP_FILL: Record<SpeciesId, string> = {
  flow:           "#8b5cf6", // violet-500
  view:           "#3b82f6", // blue-500
  "data-model":   "#f59e0b", // amber-500
  "api-endpoint": "#14b8a6", // teal-500
  acceptance:     "#22c55e", // green-500
  decision:       "#f43f5e", // rose-500 — unclaimed by any existing species identity
};

/**
 * Status → minimap fill, the hex twin of {@link STATUS_STYLES}. Kept beside it
 * so a status can't read as one color on a card badge and another in the
 * minimap; the comments name the Tailwind shade each one mirrors.
 */
export const STATUS_MINIMAP_FILL: Record<StatusId, string> = {
  idea:        "#9ca3af", // gray-400
  discovery:   "#a78bfa", // violet-400
  backlog:     "#60a5fa", // blue-400
  development: "#3b82f6", // blue-500
  releasing:   "#a855f7", // purple-500
  live:        "#22c55e", // green-500
  archived:    "#9ca3af", // gray-400
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
  discovery:   { wrapper: "",           border: ""              },
  backlog:     { wrapper: "",           border: ""              },
  development: { wrapper: "",           border: ""              },
  releasing:   { wrapper: "",           border: ""              },
  live:        { wrapper: "",           border: ""              },
  archived:    { wrapper: "opacity-60", border: ""              },
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

// One row per decision status — badge text color, dot fill. The exhaustive
// Record is the compile-time gate for future vocabulary edits, exactly like
// STATUS_STYLES above.
export const DECISION_STATUS_STYLES: Record<DecisionStatusId, { badge: string; dot: string }> = {
  proposed:   { badge: "text-gray-400",   dot: "bg-gray-400"   },
  approved:   { badge: "text-blue-400",   dot: "bg-blue-400"   },
  enacted:    { badge: "text-green-500",  dot: "bg-green-500"  },
  rejected:   { badge: "text-red-400",    dot: "bg-red-400"    },
  deprecated: { badge: "text-amber-500",  dot: "bg-amber-500"  },
  superseded: { badge: "text-violet-400", dot: "bg-violet-400" },
};

export const DECISION_STATUS_ICONS: Record<DecisionStatusId, LucideIcon> = {
  proposed:   CircleDashed,
  approved:   ThumbsUp,
  enacted:    CircleCheckBig,
  rejected:   CircleX,
  deprecated: CircleSlash,
  superseded: Replace,
};

export const DECISION_STATUS_LABELS: Record<DecisionStatusId, string> = {
  proposed:   "Proposed",
  approved:   "Approved",
  enacted:    "Enacted",
  rejected:   "Rejected",
  deprecated: "Deprecated",
  superseded: "Superseded",
};
