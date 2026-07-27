/**
 * Flow-playlist cycle detection.
 *
 * The implementation moved to `@arkaik/schema` (`packages/schema/src/mutate.ts`)
 * so every writer shares it: the app's UI guards call it directly for an
 * up-front, friendly refusal, and `applyOps` enforces the same rule for the MCP
 * server and the hosted store, which previously had no equivalent and relied on
 * `validateBundle` catching the cycle after the fact.
 *
 * This module stays as the app-side import path — `@/lib/utils/cycle` is used by
 * JourneyMap and PlaylistEntryRow — so the move is invisible to call sites.
 */
export { wouldCreateCycle } from "@arkaik/schema";
