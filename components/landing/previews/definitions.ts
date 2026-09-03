import type { MapDefinition } from "@arkaik/schema";
import { FIXTURES } from "@/components/landing/fixtures";

/**
 * The two canvases' map definitions, as pure data: the client previews render
 * them and `lib/landing/prepare.ts` slices the seed down to what they draw, so
 * both sides read the same anchor.
 */
const [ROOT_FLOW_ID] = FIXTURES["journey-map"].nodeIds!;
const [SYSTEM_ANCHOR_ID] = FIXTURES["system-map"].nodeIds!;

export const JOURNEY_DEFINITION: MapDefinition = {
  id: "landing-journey",
  kind: "journey",
  title: "Journey",
  root_node_id: ROOT_FLOW_ID,
};

export const SYSTEM_DEFINITION: MapDefinition = {
  id: "landing-system",
  kind: "system",
  title: "System",
  root_node_id: SYSTEM_ANCHOR_ID,
  // One hop around the anchor: the views and endpoints that touch this model.
  depth: 1,
  layout: { algorithm: "organic" },
};
