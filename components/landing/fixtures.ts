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
  "delivery-board": {
    source: "pebbles",
    // Five views across idea / development / live; V-pebble-detail is live on
    // iOS and idea elsewhere, so it sits in two columns — the point the copy makes.
    nodeIds: ["V-pebble-detail", "V-souls-list", "V-timeline", "V-home", "V-glyph-detail"],
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
  "quality-matrix": { source: "pilot-audit", nodeIds: [] }, // reads bundle.quality; the criteria list is pinned in the preview
  "findings-board": { source: "pilot-audit", nodeIds: ["V-pebble-detail", "V-souls-list", "V-timeline", "V-home"] },
  "agent-skill-diff": { source: "self-map", nodeIds: ["V-journey-map"] },
  "mcp-server": { source: "self-map" }, // the call and its response are generated; nothing to pin
  "prompt-builder": { source: "pebbles" }, // reads only the project title
  "self-map-journey": { source: "self-map" }, // the whole product: no root to pin
};
