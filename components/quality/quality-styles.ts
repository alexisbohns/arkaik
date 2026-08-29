import type {
  FindingPriority,
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
 * A grade as a cell tint: green at A through red at E, the same direction the
 * severity families run so a red cell and a red chip mean the same kind of bad.
 */
export const GRADE_TINT: Record<QualityGrade, string> = {
  A: "bg-green-500/10 text-green-700 dark:text-green-400",
  B: "bg-lime-500/10 text-lime-700 dark:text-lime-400",
  C: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  D: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  E: "bg-red-500/10 text-red-700 dark:text-red-400",
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
