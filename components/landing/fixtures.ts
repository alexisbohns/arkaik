import type { PreviewId, PreviewSource } from "@/components/landing/previews/ids";

export interface PreviewFixture {
  source: PreviewSource;
  /** Every id here must exist in `source`; the test pins it. */
  nodeIds?: string[];
  /** Release versions that must exist in `source`'s journal. */
  versions?: string[];
}

/**
 * What each preview points at inside its seed. Literal ids, pinned by
 * tests/landing/landing.test.js: a renamed node fails the suite, never renders
 * an empty frame in production.
 */
export const FIXTURES: Record<PreviewId, PreviewFixture> = {
  "journey-map": { source: "self-map", nodeIds: ["F-audit-value-coverage"] },
  "system-map": { source: "self-map", nodeIds: ["DM-node"] },
  // Eight views for three columns — pick ids whose statuses spread across
  // backlog / development / live (the seed is mostly live; take what exists).
  "delivery-board": {
    source: "self-map",
    nodeIds: [
      "V-projects",
      "V-create-project-dialog",
      "V-maps-index",
      "V-journey-map",
      "V-system-map",
      "V-map-editor-dialog",
      "V-command-palette",
      "V-node-detail-panel",
    ],
  },
  "overview-cards": { source: "pebbles", versions: ["0.3.0", "0.4.0"] },
  "platform-statuses": { source: "pebbles", nodeIds: ["V-pebble-detail"] },
  "acceptance-matrix": { source: "pebbles", nodeIds: ["AC-pebble-draw-in-animation", "AC-emotion-palette-on-read"] },
  "value-pyramid": { source: "self-map" }, // aggregates every acceptance; no ids to pin
  "decision-chain": { source: "pebbles", nodeIds: ["DEC-adopt-glyph-wobble", "DEC-linear-glyph-fade"] },
  "journal-changelog": {
    source: "self-map",
    nodeIds: ["V-journey-map"],
    versions: ["going-multi-product", "the-self-map"],
  },
};
