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
  Lightbulb, Compass, CircleDashed, CirclePlay, CircleFadingArrowUp,
  CircleCheckBig, CircleSlash,
  ThumbsUp, CircleX, Replace, CircleDotDashed,
  Figma, Github, Gitlab, Ticket, GitPullRequest, GitMerge, ExternalLink, Link2,
} from "lucide-react";

// One row per status: text color, dot fill, and SVG arc stroke. A ring, a bar
// and a badge therefore can never drift apart on color.
/**
 * Per-status classes. `surface` is the status's soft wash — its own hue at low
 * opacity — for an area that belongs to the status as a whole (a Delivery
 * column), where the solid `dot` would shout.
 * Colors are the palette's status tones (app/m3/basalt.css), light and dark from one class.
 */
export const STATUS_STYLES: Record<StatusId, { badge: string; dot: string; stroke: string; surface: string }> = {
  idea:        { badge: "text-tone-neutral", dot: "bg-tone-neutral", stroke: "stroke-tone-neutral", surface: "bg-tone-neutral/10" },
  discovery:   { badge: "text-tone-ember",   dot: "bg-tone-ember",   stroke: "stroke-tone-ember",   surface: "bg-tone-ember/10"   },
  backlog:     { badge: "text-tone-slate",   dot: "bg-tone-slate",   stroke: "stroke-tone-slate",   surface: "bg-tone-slate/10"   },
  development: { badge: "text-tone-indigo",  dot: "bg-tone-indigo",  stroke: "stroke-tone-indigo",  surface: "bg-tone-indigo/10"  },
  releasing:   { badge: "text-tone-plum",    dot: "bg-tone-plum",    stroke: "stroke-tone-plum",    surface: "bg-tone-plum/10"    },
  live:        { badge: "text-tone-green",   dot: "bg-tone-green",   stroke: "stroke-tone-green",   surface: "bg-tone-green/10"   },
  archived:    { badge: "text-tone-neutral", dot: "bg-tone-neutral", stroke: "stroke-tone-neutral", surface: "bg-tone-neutral/10" },
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

/**
 * The canvas species glyphs, kept exported under their historical name.
 * {@link SPECIES_GRAPH_ICONS} in `lib/config/species-icons.ts` is the
 * definition — this alias exists because `SPECIES_ICONS` is what importers
 * already say, and because the *other* map that shared that name (the sidebar's
 * navigation vocabulary) is now a separate export, so the ambiguity the alias
 * used to carry is gone.
 */
export { SPECIES_GRAPH_ICONS as SPECIES_ICONS } from "@/lib/config/species-icons";

/**
 * The parallel-layer species' accent — the one color a data model or an API
 * endpoint *is* — in the two spellings the app needs it: Tailwind classes for
 * `SystemLayerNode`'s card, and hex for {@link SPECIES_MINIMAP_FILL} below.
 *
 * Whole literal class strings, never composed from a shade: Tailwind's scanner
 * reads source text, so a `border-${shade}` would generate no CSS at all.
 *
 * Flow and view have no entry here on purpose — their cards are status-colored,
 * so their minimap fills are chosen rather than inherited.
 */
export type SystemLayerSpecies = Extract<SpeciesId, "data-model" | "api-endpoint">;

export const SYSTEM_LAYER_STYLES: Record<SystemLayerSpecies, { border: string; icon: string; fill: string }> = {
  "data-model":   { border: "border-amber-500", icon: "text-amber-500", fill: "#f59e0b" },
  "api-endpoint": { border: "border-teal-500",  icon: "text-teal-500",  fill: "#14b8a6" },
};

/**
 * Species → minimap fill. Hex, not Tailwind classes: React Flow paints minimap
 * nodes as SVG rects, and an SVG `fill` can't take a class name.
 *
 * Data models and API endpoints *read* their fill off the border color their
 * cards already wear, so a species keeps one identity across the map and the
 * minimap by construction rather than by two hex literals agreeing. Flow and
 * view cards are status-colored and had no species color to inherit, so they
 * take violet-500 and blue-500 — far enough apart to stay legible at minimap
 * scale, where a node is a few pixels wide.
 */
export const SPECIES_MINIMAP_FILL: Record<SpeciesId, string> = {
  flow:           "#8b5cf6", // violet-500
  view:           "#3b82f6", // blue-500
  "data-model":   SYSTEM_LAYER_STYLES["data-model"].fill,
  "api-endpoint": SYSTEM_LAYER_STYLES["api-endpoint"].fill,
  acceptance:     "#22c55e", // green-500
  decision:       "#f43f5e", // rose-500 — unclaimed by any existing species identity
};

/**
 * Status → minimap fill, the twin of {@link STATUS_STYLES} as a CSS color. Kept
 * beside it so a status can't read as one color on a card badge and another in
 * the minimap. React Flow paints minimap nodes through inline `style`, which
 * reads the variable, so the fill flips with the theme like the class does.
 */
export const STATUS_MINIMAP_FILL: Record<StatusId, string> = {
  idea:        "var(--tone-neutral)",
  discovery:   "var(--tone-ember)",
  backlog:     "var(--tone-slate)",
  development: "var(--tone-indigo)",
  releasing:   "var(--tone-plum)",
  live:        "var(--tone-green)",
  archived:    "var(--tone-neutral)",
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
  proposed:   { badge: "text-tone-neutral", dot: "bg-tone-neutral" },
  approved:   { badge: "text-tone-indigo",  dot: "bg-tone-indigo"  },
  enacted:    { badge: "text-tone-green",   dot: "bg-tone-green"   },
  rejected:   { badge: "text-tone-red",     dot: "bg-tone-red"     },
  deprecated: { badge: "text-tone-amber",   dot: "bg-tone-amber"   },
  superseded: { badge: "text-tone-plum",    dot: "bg-tone-plum"    },
};

/**
 * A decision status as a **boxed mark** — the shared 24px tile's colours, one
 * row per status.
 *
 * The same families {@link DECISION_STATUS_STYLES} paints a badge and a dot in,
 * turned into the tint-plus-readable-text pair every tile on a timeline rail
 * wears (the Changelog's shipped mark, the Findings board's verdicts). Whole
 * literal class strings, never composed from a shade, for the reason stated at
 * the top of this file.
 */
export const DECISION_STATUS_TILE: Record<DecisionStatusId, string> = {
  proposed:   "bg-tone-neutral/10 text-tone-neutral",
  approved:   "bg-tone-indigo/10 text-tone-indigo",
  enacted:    "bg-tone-green/10 text-tone-green",
  rejected:   "bg-tone-red/10 text-tone-red",
  deprecated: "bg-tone-amber/10 text-tone-amber",
  superseded: "bg-tone-plum/10 text-tone-plum",
};

export const DECISION_STATUS_ICONS: Record<DecisionStatusId, LucideIcon> = {
  proposed:   CircleDotDashed,
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
