import { z } from "zod";
import { ProjectBundleSchema, type ProjectBundle } from "./bundle";

/**
 * Shape-only parse. Returns a zod `SafeParseResult`: on success `.data` is a
 * typed `ProjectBundle`; on failure `.error` carries structured issues. Does
 * not run semantic graph rules — use {@link validateBundle} (validate.ts) for
 * those. Kept in its own module (rather than alongside validateBundle) so
 * that consumers of the zod-free semantic rules don't pull zod in for it.
 */
export function parseBundle(input: unknown) {
  return ProjectBundleSchema.safeParse(input) as z.ZodSafeParseResult<ProjectBundle>;
}
