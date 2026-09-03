/**
 * The preview catalogue: every preview the landing page can mount, with the
 * seed it renders and the frame it sits in. Pure data — the React side is
 * `registry.tsx`, whose `Record<PreviewId, …>` makes tsc refuse an id with no
 * component, and this file is what the plain-node test reads.
 */
export type PreviewSource = "self-map" | "pebbles";

export const PREVIEW_IDS = [
  "journey-map",
  "system-map",
  "delivery-board",
  "overview-cards",
  "platform-statuses",
  "acceptance-matrix",
  "value-pyramid",
  "decision-chain",
  "journal-changelog",
] as const;

export type PreviewId = (typeof PREVIEW_IDS)[number];

export interface PreviewMeta {
  source: PreviewSource;
  /** Frame height in px, fixed so canvases mounting never shift the page. */
  height: number;
  /** The in-app path shown in the frame's title bar, e.g. "Project › Delivery". */
  breadcrumb: string;
}

export const PREVIEW_META: Record<PreviewId, PreviewMeta> = {
  "journey-map":       { source: "self-map", height: 420, breadcrumb: "Maps › Journey" },
  "system-map":        { source: "self-map", height: 420, breadcrumb: "Maps › System" },
  "delivery-board":    { source: "pebbles",  height: 360, breadcrumb: "Project › Delivery" },
  "overview-cards":    { source: "pebbles",  height: 300, breadcrumb: "Project › Overview" },
  "platform-statuses": { source: "pebbles",  height: 200, breadcrumb: "Library › Views" },
  "acceptance-matrix": { source: "pebbles",  height: 340, breadcrumb: "Project › Acceptances" },
  "value-pyramid":     { source: "self-map", height: 320, breadcrumb: "Project › Pyramid" },
  "decision-chain":    { source: "pebbles",  height: 280, breadcrumb: "Project › Decisions" },
  "journal-changelog": { source: "self-map", height: 360, breadcrumb: "Project › Changelog" },
};

export const SOURCE_CAPTION: Record<PreviewSource, string> = {
  "self-map": "Rendered from Arkaik's own map, right now.",
  pebbles: "Rendered from the built-in Pebbles example, right now.",
};
