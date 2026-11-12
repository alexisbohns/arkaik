import { BMC_QUESTION_KEYS } from "./constants";

/**
 * The paragraph and the canvas, linked (spec § "The paragraph and the canvas,
 * linked"): inside one `[data-canvas-link]` wrapper (components/arkademy/
 * CanvasLink.tsx), hovering or focusing an element of a question — its
 * sentence or gap pill (`data-kind`), its block (`data-block`), both carrying
 * `data-question` — highlights the question's sentence with a quiet tint and
 * its gap pill and block with a 1px outline. CSS `:has()` only, no client
 * JavaScript, so ParagraphView and CanvasGrid stay server components.
 *
 * The rules are generated here, one pair per question key, so a key added to
 * the canvas gets its rules with nothing written by hand.
 *
 * - The tint is the muted token behind foreground text; the outline is the
 *   muted-foreground token (at least 4.5:1 on the card in both themes).
 *   Neither changes layout.
 * - The current block (the tour's 2px ring) is marked `data-current` and never
 *   takes the outline, so the hover is always lighter than `current`.
 * - Hover applies only where the pointer can hover: touch gets nothing extra.
 * - The tint fades in only without reduced motion; with it, the highlight
 *   still shows, at once.
 */

/** The wrapper's attribute: one per example, so the link never crosses examples. */
export const CANVAS_LINK_ATTRIBUTE = "data-canvas-link";

/** The stylesheet's key: React 19 hoists a `<style href precedence>` once per page. */
export const CANVAS_LINK_STYLE_HREF = "arkademy-canvas-link";

export function canvasLinkCss(keys: readonly string[] = BMC_QUESTION_KEYS): string {
  const wrapper = `[${CANVAS_LINK_ATTRIBUTE}]`;
  const rules = (state: ":hover" | ":focus-within") =>
    keys
      .map((key) => {
        const question = `[data-question="${key}"]`;
        const when = `${wrapper}:has(:is([data-kind],[data-block])${question}${state})`;
        return (
          `${when} [data-kind="sentence"]${question}{background-color:hsl(var(--muted));border-radius:.25em;-webkit-box-decoration-break:clone;box-decoration-break:clone}` +
          `${when} :is([data-kind="gap"],[data-block]:not([data-current]))${question}{outline:1px solid hsl(var(--muted-foreground));outline-offset:0}`
        );
      })
      .join("\n");
  return [
    `@media (hover: hover) {\n${rules(":hover")}\n}`,
    rules(":focus-within"),
    `@media (prefers-reduced-motion: no-preference) {\n${wrapper} [data-kind="sentence"]{transition:background-color 120ms ease-out}\n}`,
  ].join("\n");
}
