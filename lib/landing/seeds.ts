import arkaikSelfMap from "@/seed/arkaik-self-map.json";
import pebbles from "@/seed/pebbles.json";
import type { ProjectBundle } from "@/lib/data/types";
import type { PreviewSource } from "@/components/landing/previews/ids";

/**
 * The two shipped seeds, as the landing page reads them: build-time JSON
 * imports, typed through the same cast `lib/data/arkaik-seed.ts` uses. Not the
 * seed provider — that module drags the client data layer into a server tree.
 */
export function loadLandingSeeds(): Record<PreviewSource, ProjectBundle> {
  return {
    "self-map": arkaikSelfMap as unknown as ProjectBundle,
    pebbles: pebbles as unknown as ProjectBundle,
  };
}
