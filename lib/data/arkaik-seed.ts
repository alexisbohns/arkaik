import arkaikSelfMap from "@/seed/arkaik-self-map.json";

import { createSeedProvider } from "./seed-provider";
import type { ProjectBundle } from "./types";

/**
 * The wired public self-map provider: the build-time-imported seed behind
 * `createSeedProvider`. Module state is per tab and per page load — which is
 * the sandbox's reset semantics: a refresh IS the reset.
 */
export const arkaikSeedProvider = createSeedProvider(() => arkaikSelfMap as unknown as ProjectBundle);
