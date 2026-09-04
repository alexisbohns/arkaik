import arkaikSelfMap from "@/seed/arkaik-self-map.json";
import pebbles from "@/seed/pebbles.json";
import { LANDING_QUALITY, LANDING_QUALITY_EVENTS } from "@/components/landing/quality-fixture";
import type { ProjectBundle } from "@/lib/data/types";
import type { PreviewSource } from "@/components/landing/previews/ids";

/**
 * The seeds as the landing page reads them: build-time JSON imports, typed
 * through the same cast `lib/data/arkaik-seed.ts` uses. Not the seed provider —
 * that module drags the client data layer into a server tree. `pilot-audit` is
 * Pebbles carrying the illustrative Kritik section and its two journal facts.
 */
export function loadLandingSeeds(): Record<PreviewSource, ProjectBundle> {
  const pebblesBundle = pebbles as unknown as ProjectBundle;
  return {
    "self-map": arkaikSelfMap as unknown as ProjectBundle,
    pebbles: pebblesBundle,
    "pilot-audit": {
      ...pebblesBundle,
      quality: LANDING_QUALITY,
      journal: [...(pebblesBundle.journal ?? []), ...LANDING_QUALITY_EVENTS],
    },
  };
}
