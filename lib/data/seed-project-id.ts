/**
 * The reserved id of the built-in public self-map project (self-map program,
 * cycle 4). Like the hosted `prj_` prefix, this is a routing namespace:
 * `createRoutingProvider` sends this id to the in-memory seed provider, so no
 * local or imported project may ever hold it — `lib/utils/export.ts` regenerates
 * it on import exactly as it does for `prj_…` ids.
 */
export const SEED_PROJECT_ID = "arkaik-self-map";

/** Whether `id` names the built-in public seed project. */
export function isSeedProjectId(id: string): boolean {
  return id === SEED_PROJECT_ID;
}
