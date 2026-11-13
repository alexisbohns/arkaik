/**
 * The two seals of the two panels whose subject is not a graph species.
 *
 * A node panel wears its species' shape (`SpeciesShape`); a criterion and a
 * finding have no species, so each gets a shape no species owns, drawn the
 * way `ExpressiveShape` draws the species ones — a polar curve in a 100×100
 * box, generated once and hard-coded:
 *
 * - `rubric`, a soft pentagon point up: the badge a standard is stamped on.
 *   The criterion panel wears it, and so does every way into one (the finding
 *   panel's criterion pill, the section marks of the criterion panel).
 * - `alert`, an eight-point boom, sharper than the acceptance's sunny burst:
 *   something went off. The finding panel wears it.
 *
 * Decorative only: every use is `aria-hidden` and filled with `currentColor`,
 * and what the shape stands for is always also said in words beside it.
 *
 * The same two paths travel as CSS masks in `app/m3/quality-panels.css`
 * (`--kp-mask-rubric`, `--kp-mask-alert`), for the section headlines that draw
 * the mark as a pseudo-element; change one, change both.
 */
export const QUALITY_PANEL_SHAPES = {
  rubric:
    "M50.0 1.5L52.0 1.6L54.0 2.0L56.0 2.5L57.9 3.3L59.7 4.2L61.5 5.4L63.1 6.6L64.7 7.8L66.3 9.0L67.8 10.1L69.3 11.2L70.8 12.3L72.2 13.4L73.7 14.5L75.1 15.5L76.6 16.5L78.0 17.6L79.5 18.6L80.9 19.7L82.4 20.7L83.9 21.8L85.4 22.9L86.9 24.0L88.5 25.1L90.2 26.3L91.9 27.5L93.5 28.8L95.0 30.2L96.3 31.8L97.4 33.5L98.3 35.3L99.1 37.2L99.6 39.1L99.9 41.1L100.0 43.2L99.9 45.2L99.5 47.3L98.9 49.3L98.3 51.2L97.6 53.1L97.0 55.0L96.4 56.8L95.8 58.5L95.2 60.3L94.7 62.0L94.1 63.7L93.5 65.4L93.0 67.1L92.4 68.8L91.9 70.5L91.4 72.2L90.8 73.9L90.2 75.7L89.7 77.4L89.1 79.3L88.5 81.1L87.9 83.0L87.3 85.0L86.6 87.0L85.7 88.8L84.6 90.6L83.3 92.1L81.9 93.6L80.3 94.9L78.6 96.0L76.8 96.9L74.9 97.6L72.9 98.1L70.9 98.4L68.8 98.5L66.7 98.4L64.7 98.4L62.8 98.4L60.9 98.4L59.0 98.4L57.2 98.4L55.4 98.3L53.6 98.3L51.8 98.3L50.0 98.3L48.2 98.3L46.4 98.3L44.6 98.3L42.8 98.4L41.0 98.4L39.1 98.4L37.2 98.4L35.3 98.4L33.3 98.4L31.2 98.5L29.1 98.4L27.1 98.1L25.1 97.6L23.2 96.9L21.4 96.0L19.7 94.9L18.1 93.6L16.7 92.1L15.4 90.6L14.3 88.8L13.4 87.0L12.7 85.0L12.1 83.0L11.5 81.1L10.9 79.3L10.3 77.4L9.8 75.7L9.2 73.9L8.6 72.2L8.1 70.5L7.6 68.8L7.0 67.1L6.5 65.4L5.9 63.7L5.3 62.0L4.8 60.3L4.2 58.5L3.6 56.8L3.0 55.0L2.4 53.1L1.7 51.2L1.1 49.3L0.5 47.3L0.1 45.2L0.0 43.2L0.1 41.1L0.4 39.1L0.9 37.2L1.7 35.3L2.6 33.5L3.7 31.8L5.0 30.2L6.5 28.8L8.1 27.5L9.8 26.3L11.5 25.1L13.1 24.0L14.6 22.9L16.1 21.8L17.6 20.7L19.1 19.7L20.5 18.6L22.0 17.6L23.4 16.5L24.9 15.5L26.3 14.5L27.8 13.4L29.2 12.3L30.7 11.2L32.2 10.1L33.7 9.0L35.3 7.8L36.9 6.6L38.5 5.4L40.3 4.2L42.1 3.3L44.0 2.5L46.0 2.0L48.0 1.6Z",
  alert:
    "M50.0 0.0L51.9 0.5L53.8 1.9L55.5 3.9L56.9 6.4L58.2 8.8L59.4 11.0L60.5 12.8L61.7 14.1L62.9 14.9L64.3 15.6L65.7 16.0L67.2 16.3L68.9 16.3L70.9 15.8L73.3 15.1L76.0 14.3L78.7 13.6L81.4 13.3L83.6 13.6L85.4 14.6L86.4 16.4L86.7 18.6L86.4 21.3L85.7 24.0L84.9 26.7L84.2 29.1L83.7 31.1L83.7 32.8L84.0 34.3L84.4 35.7L85.1 37.1L85.9 38.3L87.2 39.5L89.0 40.6L91.2 41.8L93.6 43.1L96.1 44.5L98.1 46.2L99.5 48.1L100.0 50.0L99.5 51.9L98.1 53.8L96.1 55.5L93.6 56.9L91.2 58.2L89.0 59.4L87.2 60.5L85.9 61.7L85.1 62.9L84.4 64.3L84.0 65.7L83.7 67.2L83.7 68.9L84.2 70.9L84.9 73.3L85.7 76.0L86.4 78.7L86.7 81.4L86.4 83.6L85.4 85.4L83.6 86.4L81.4 86.7L78.7 86.4L76.0 85.7L73.3 84.9L70.9 84.2L68.9 83.7L67.2 83.7L65.7 84.0L64.3 84.4L62.9 85.1L61.7 85.9L60.5 87.2L59.4 89.0L58.2 91.2L56.9 93.6L55.5 96.1L53.8 98.1L51.9 99.5L50.0 100.0L48.1 99.5L46.2 98.1L44.5 96.1L43.1 93.6L41.8 91.2L40.6 89.0L39.5 87.2L38.3 85.9L37.1 85.1L35.7 84.4L34.3 84.0L32.8 83.7L31.1 83.7L29.1 84.2L26.7 84.9L24.0 85.7L21.3 86.4L18.6 86.7L16.4 86.4L14.6 85.4L13.6 83.6L13.3 81.4L13.6 78.7L14.3 76.0L15.1 73.3L15.8 70.9L16.3 68.9L16.3 67.2L16.0 65.7L15.6 64.3L14.9 62.9L14.1 61.7L12.8 60.5L11.0 59.4L8.8 58.2L6.4 56.9L3.9 55.5L1.9 53.8L0.5 51.9L0.0 50.0L0.5 48.1L1.9 46.2L3.9 44.5L6.4 43.1L8.8 41.8L11.0 40.6L12.8 39.5L14.1 38.3L14.9 37.1L15.6 35.7L16.0 34.3L16.3 32.8L16.3 31.1L15.8 29.1L15.1 26.7L14.3 24.0L13.6 21.3L13.3 18.6L13.6 16.4L14.6 14.6L16.4 13.6L18.6 13.3L21.3 13.6L24.0 14.3L26.7 15.1L29.1 15.8L31.1 16.3L32.8 16.3L34.3 16.0L35.7 15.6L37.1 14.9L38.3 14.1L39.5 12.8L40.6 11.0L41.8 8.8L43.1 6.4L44.5 3.9L46.2 1.9L48.1 0.5Z",
} as const;

export type QualityPanelShapeName = keyof typeof QUALITY_PANEL_SHAPES;

export function QualityPanelShape({ shape, className }: { shape: QualityPanelShapeName; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" className={className}>
      <path d={QUALITY_PANEL_SHAPES[shape]} fill="currentColor" />
    </svg>
  );
}
