import type { ExpressiveShapeName } from "@/components/arkademy/ExpressiveShape";

/** An example's accent: a shape, and its fill and ink classes (`--ink` names the letter's colour). */
export interface ExampleAccent {
  shape: ExpressiveShapeName;
  tone: string;
}

/**
 * The examples' accents, in gallery order, one shape per company: the cover's
 * carousel cards and each example's tour draw the same one, so a company
 * keeps its badge from the card to its tour. Literal class names, so Tailwind
 * finds them.
 */
export const EXAMPLE_ACCENTS: readonly ExampleAccent[] = [
  { shape: "cookie9", tone: "text-(--md-primary) [--ink:var(--md-on-primary)]" },
  { shape: "clover4", tone: "text-(--md-tertiary) [--ink:var(--md-on-tertiary)]" },
  { shape: "sunny", tone: "text-(--md-secondary) [--ink:var(--md-on-secondary)]" },
  { shape: "flower", tone: "text-(--md-primary) [--ink:var(--md-on-primary)]" },
  { shape: "cookie12", tone: "text-(--md-tertiary) [--ink:var(--md-on-tertiary)]" },
];

/** The accent of the example at `position` in the gallery (wrapping); the first one for an unknown position. */
export function exampleAccent(position: number): ExampleAccent {
  const i = Number.isInteger(position) && position >= 0 ? position : 0;
  return EXAMPLE_ACCENTS[i % EXAMPLE_ACCENTS.length];
}
