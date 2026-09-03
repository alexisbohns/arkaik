import type {
  FindingPriority,
  RemediationCost,
  FindingSeverity,
  FindingStatus,
  QualityGrade,
} from "@arkaik/schema";

/**
 * What the quality scales look like, and what they are called.
 *
 * One module rather than a map per component, for the reason `node-styles.ts`
 * keeps `STATUS_STYLES` in one place: six surfaces render a severity — the
 * matrix's finding dots, the board's chips, the filter bar's menu, the
 * criterion panel's rows, the node panel's Findings list and the canvas badge —
 * and a copy per component is six answers to "what does critical look like",
 * free to drift the day one of them is restyled.
 *
 * Whole literal class strings, never composed from a shade: Tailwind's scanner
 * reads source text, so a `bg-${family}-500` would generate no CSS at all —
 * the same rule `node-styles.ts` states for the species accents.
 *
 * Nothing here decides which bucket a finding is in. `severityOf`, `priorityOf`
 * and `gradeOf` do that in `@arkaik/schema`, and a pack is free to move every
 * boundary; these maps only say what each named bucket wears once something
 * else has named it.
 */

/** Severity as a filled dot — the `STATUS_STYLES.dot` convention, worst is red. */
export const SEVERITY_DOT: Record<FindingSeverity, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-blue-400",
  info: "bg-gray-400",
};

/**
 * Severity as a chip: the dot's family at a tenth opacity behind a text shade
 * dark enough to read on it, and a second shade for dark mode where the same
 * tint sits on near-black. Tinted rather than solid because a board of twenty
 * solid red chips is a board nobody can scan.
 */
export const SEVERITY_CHIP: Record<FindingSeverity, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "border-blue-400/40 bg-blue-400/10 text-blue-700 dark:text-blue-400",
  info: "border-gray-400/40 bg-gray-400/10 text-gray-700 dark:text-gray-400",
};

/**
 * The severity families again, one step more saturated — the score half of the
 * {@link SEVERITY_CHIP} pill. Two tints of one family rather than two colours:
 * the halves are one fact split at a hairline, not two facts sat side by side.
 */
export const SEVERITY_SCORE: Record<FindingSeverity, string> = {
  critical: "bg-red-500/20",
  high: "bg-orange-500/20",
  medium: "bg-amber-500/20",
  low: "bg-blue-400/20",
  info: "bg-gray-400/20",
};

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

/** Priority as a chip, in the severity families it is derived from. */
export const PRIORITY_CHIP: Record<FindingPriority, string> = {
  P0: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  P1: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  P2: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  P3: "border-border bg-muted text-muted-foreground",
};

/**
 * Priority as the timeline's rail mark: the chip's tint, no border.
 *
 * The Changelog's `ICON_TILE` idiom — a 24px square carrying colour on the tile
 * and nothing on its edge. On a rail the border is what the connector already
 * is, and a ringed square reads as a button somebody forgot to make clickable.
 */
export const PRIORITY_TILE: Record<FindingPriority, string> = {
  P0: "bg-red-500/10 text-red-700 dark:text-red-400",
  P1: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  P2: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  P3: "bg-muted text-muted-foreground",
};

/**
 * Remediation cost as a chip (SPEC §4.3). Neutral in every band: cost is not a
 * severity, and an XL painted red would say "alarming" about a finding whose
 * numbers may be mild. It earns a chip rather than grey prose because `S` is an
 * abbreviation, and an abbreviation on this board carries its gloss.
 */
export const COST_CHIP: Record<RemediationCost, string> = {
  S: "border-border bg-muted text-muted-foreground",
  M: "border-border bg-muted text-muted-foreground",
  L: "border-border bg-muted text-muted-foreground",
  XL: "border-border bg-muted text-muted-foreground",
};

/** What the cost band stands for — the abbreviation's expansion. */
export const COST_TERM: Record<RemediationCost, string> = {
  S: "S — Small",
  M: "M — Medium",
  L: "L — Large",
  XL: "XL — Extra large",
};

/** The cost band in a sentence, for the chip's gloss. */
export const COST_HINT: Record<RemediationCost, string> = {
  S: "Hours of work — a contained fix.",
  M: "A day or two, touching a handful of places.",
  L: "Several days, or a change that ripples.",
  XL: "A project of its own — scope it before you start it.",
};

/**
 * What each lane means, quoted from the pack spec (SPEC §4.4) rather than
 * paraphrased. `P2` on its own is a label only somebody who has read the spec
 * can act on, and the board's whole job is to be actionable.
 */
export const PRIORITY_HINT: Record<FindingPriority, string> = {
  P0: "Drop everything",
  P1: "Next milestone",
  P2: "Planned backlog",
  P3: "Opportunistic",
};

/**
 * What each severity actually claims about a defect. `Critical` and `Low` are
 * the audit's words, and a chip that only repeats them tells a reader nothing
 * they can act on; the gloss is what {@link SEVERITY_CHIP} is worn beside in
 * `ScaleChip`.
 */
export const SEVERITY_HINT: Record<FindingSeverity, string> = {
  critical: "Breaks the product or exposes data — nothing ships past it.",
  high: "A real defect users will hit, with no workaround worth the name.",
  medium: "A defect with a workaround, or a small blast radius.",
  low: "A rough edge rather than a fault.",
  info: "An observation worth recording, not a defect.",
};

/** What a priority lane is called, spelled out — the abbreviation's expansion. */
export const PRIORITY_TERM: Record<FindingPriority, string> = {
  P0: "P0 — Drop everything",
  P1: "P1 — Next milestone",
  P2: "P2 — Planned backlog",
  P3: "P3 — Opportunistic",
};

/**
 * A priority lane in a sentence, for the chip's gloss. {@link PRIORITY_HINT} is
 * the board's three-word column subtitle; this is the line that says what the
 * lane asks of you.
 */
export const PRIORITY_GLOSS: Record<FindingPriority, string> = {
  P0: "Work it now — it blocks the release, and everything else waits.",
  P1: "Scheduled into the next milestone, not into today.",
  P2: "Real work, planned into the backlog behind the current milestone.",
  P3: "Worth doing when you are already in that code.",
};

/**
 * A grade as a tint: green at A through red at E, the same direction the
 * severity families run so a red cell and a red chip mean the same kind of bad.
 *
 * Now the legend's own idiom rather than the card's. A card tinted by its grade
 * turned a gallery into a wall of colour blocks and dragged its surface title
 * into the tint with it — the title is the card's name, not a diagnosis. The
 * cards carry {@link GRADE_BORDER} and {@link GRADE_SOLID} instead: colour on
 * the edge, and one saturated square inside the grade scale.
 */
export const GRADE_TINT: Record<QualityGrade, string> = {
  A: "bg-green-500/10 text-green-700 dark:text-green-400",
  B: "bg-lime-500/10 text-lime-700 dark:text-lime-400",
  C: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  D: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  E: "bg-red-500/10 text-red-700 dark:text-red-400",
};

/**
 * A grade as a card's edge. Strong enough to read at a glance down a gallery,
 * weak enough that eleven of them stacked are not eleven alarms.
 */
export const GRADE_BORDER: Record<QualityGrade, string> = {
  A: "border-green-500/60",
  B: "border-lime-500/60",
  C: "border-amber-500/60",
  D: "border-orange-500/60",
  E: "border-red-500/60",
};

/**
 * A grade as one filled square in the grade scale — the Nutri-Score idiom: the
 * whole scale is always shown, and the grade in force is the one lit up, so the
 * reader sees *where on the scale* this sits rather than a letter they have to
 * already know how to place.
 *
 * Saturated rather than tinted, because exactly one square per scale wears it,
 * and its own text colour rather than an inherited one: `bg-amber-500` under
 * white is unreadable, and under `foreground` it inverts between themes.
 */
export const GRADE_SOLID: Record<QualityGrade, string> = {
  A: "bg-green-600 text-white",
  B: "bg-lime-600 text-white",
  C: "bg-amber-500 text-amber-950",
  D: "bg-orange-500 text-white",
  E: "bg-red-600 text-white",
};

/**
 * Finding statuses in prose. Only `accepted-risk` actually needs the map — it
 * is the one id that is not its own English — but spelling all four out keeps
 * the filter menu from mixing sentence case with a hyphenated slug.
 */
export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  refuted: "Refuted",
  "accepted-risk": "Accepted risk",
};

/**
 * A decided finding's rail mark, in place of {@link PRIORITY_TILE}.
 *
 * A finding somebody has answered has no priority worth a square: "P0" down the
 * rail beside a fix that shipped reads as work still owed, which is exactly the
 * misread that sent a resolved critical back to the top of somebody's list. The
 * lane it *was* in is not lost — it is in the mark's own gloss below.
 *
 * Green only for `resolved`, the one status that means the defect is gone.
 * `refuted` and `accepted-risk` are answers too, but neither is a fix, and a
 * green tick on an accepted risk would quietly retire a risk somebody
 * deliberately kept.
 */
export const FINDING_STATUS_TILE: Record<Exclude<FindingStatus, "open">, string> = {
  resolved: "bg-green-500/10 text-green-700 dark:text-green-400",
  refuted: "bg-muted text-muted-foreground",
  "accepted-risk": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

/** What the mark stands for — its label, with the lane it retired. */
export const FINDING_STATUS_GLOSS: Record<Exclude<FindingStatus, "open">, string> = {
  resolved: "Fixed and verified — this one is done.",
  refuted: "Argued down: the audit filed it, the review found no defect.",
  "accepted-risk": "Weighed and kept, on purpose. Not a thing to re-litigate.",
};
