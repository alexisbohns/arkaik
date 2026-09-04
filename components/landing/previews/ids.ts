/**
 * The preview catalogue: every preview the landing page can mount, with the
 * seed it renders and the frame it sits in. Pure data — the React side is
 * `registry.tsx`, whose `Record<PreviewId, …>` makes tsc refuse an id with no
 * component, and this file is what the plain-node test reads.
 */
/**
 * `pilot-audit` is Pebbles with the illustrative quality section attached
 * (`components/landing/quality-fixture.ts`): the two Kritik previews need a
 * `bundle.quality` and neither shipped seed has one.
 */
export type PreviewSource = "self-map" | "pebbles" | "pilot-audit";

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
  "quality-matrix",
  "findings-board",
  "agent-skill-diff",
  "mcp-server",
  "prompt-builder",
] as const;

export type PreviewId = (typeof PREVIEW_IDS)[number];

export interface PreviewMeta {
  source: PreviewSource;
  /** Frame height in px, fixed so canvases mounting never shift the page. */
  height: number;
  /** The in-app path shown in the frame's title bar, e.g. `["Project", "Delivery"]`. */
  breadcrumb: readonly string[];
  /**
   * Whether the preview reads `bundle.journal`; a client preview without it
   * receives `journal: []`, so the journal never crosses the RSC boundary for
   * nothing. Informational for server previews, but kept honest.
   */
  journal: boolean;
}

export const PREVIEW_META: Record<PreviewId, PreviewMeta> = {
  "journey-map":       { source: "self-map", height: 420, breadcrumb: ["Maps", "Journey"],       journal: false },
  "system-map":        { source: "self-map", height: 420, breadcrumb: ["Maps", "System"],        journal: false },
  "delivery-board":    { source: "pebbles",  height: 360, breadcrumb: ["Project", "Delivery"],   journal: false },
  "overview-cards":    { source: "pebbles",  height: 300, breadcrumb: ["Project", "Overview"],   journal: true },
  "platform-statuses": { source: "pebbles",  height: 200, breadcrumb: ["Library", "Views"],      journal: false },
  "acceptance-matrix": { source: "pebbles",  height: 340, breadcrumb: ["Project", "Acceptances"], journal: false },
  "value-pyramid":     { source: "self-map", height: 320, breadcrumb: ["Project", "Pyramid"],    journal: false },
  "decision-chain":    { source: "pebbles",  height: 280, breadcrumb: ["Project", "Decisions"],  journal: true },
  "journal-changelog": { source: "self-map", height: 360, breadcrumb: ["Project", "Changelog"],  journal: true },
  "quality-matrix":    { source: "pilot-audit", height: 300, breadcrumb: ["Quality", "Matrix"],  journal: false },
  "findings-board":    { source: "pilot-audit", height: 420, breadcrumb: ["Quality", "Findings"], journal: true },
  "agent-skill-diff":  { source: "self-map", height: 440, breadcrumb: ["Repo", "docs/arkaik"],  journal: false },
  "mcp-server":        { source: "self-map", height: 460, breadcrumb: ["arkaik-mcp"],            journal: false },
  "prompt-builder":    { source: "pebbles",  height: 440, breadcrumb: ["Generate"],              journal: false },
};
