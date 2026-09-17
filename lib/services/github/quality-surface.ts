// Does a resolved finding's fix appear to live where the finding does?
//
// ISSUE #440's SECOND HALF. pbbls#832 resolved five findings describing missing
// UI on iOS, Android, web and admin, with a diff that touched `packages/supabase`,
// `docs` and `.github`. The profile already said where each of those surfaces
// lives — `SurfaceDef.path`, `apps/ios` and the rest — so the delivery held both
// halves of the contradiction and said nothing.
//
// A SECOND OPINION, NOT A GATE. `path` is optional, and a real fix can
// legitimately live in a shared package or a monorepo-wide config, so refusing
// on this would fail in the opposite dangerous direction: silently not closing
// findings that genuinely were fixed. The resolution is appended either way and
// the warning rides along on the outcome.
//
// Pure, and outside quality-parse.ts on purpose: that module is about parsing a
// pull request's text and states that it has no value imports at all, which is
// what lets the suite load it with a bare transpile. A path check is not parsing.
import type { QualityProfile, SurfaceDef } from "@arkaik/schema";
import { normalizePathPrefix, pathMatchesPrefix } from "@/lib/services/github/paths";
import type { ChangedFilesEvidence } from "@/lib/services/github/pull-request";

/**
 * The sentence a resolution earns when the pull request changed no file under
 * its finding's surface — or `undefined`, which is every other case.
 *
 * SILENCE IS THE DEFAULT, and every guard below returns it rather than guessing.
 * The rule that matters most is the INCOMPLETE one: a missing file can invent a
 * MISMATCH, which would be a false accusation printed against a correct
 * resolution. `ChangedFiles` already states the mirror of this — a missing file
 * cannot invent a match, so what matched is real — and both point the same way.
 *
 * Containment is `pathMatchesPrefix`, so it is decided on segment boundaries by
 * the same code that decides it for path-scoped repository links:
 * `apps/ios-shared/x.swift` is not a file under `apps/ios`.
 *
 * Surface paths are repository-relative, as `SurfaceDef.path` documents and as
 * `docs/quality/library/framework.json` writes them. They are compared against
 * the pull request's changed paths directly, with no reference to any project's
 * link prefixes: a surface path describes where the code lives, a link prefix
 * describes what a project claims, and conflating them would make this warning
 * depend on configuration it has no business reading.
 */
export function surfaceMismatchWarning(input: {
  findingId: string;
  surface: string;
  profile: QualityProfile | undefined;
  evidence: ChangedFilesEvidence;
}): string | undefined {
  const { findingId, surface, profile, evidence } = input;

  if (evidence.kind !== "files") return undefined;
  if (evidence.incomplete.length > 0) return undefined;

  // Read defensively: this is section content nobody has re-validated since it
  // left storage, the idiom lib/utils/quality.ts uses for the same reason.
  const surfaces: readonly unknown[] = Array.isArray(profile?.surfaces) ? profile.surfaces : [];
  const declared = surfaces.find(
    (entry): entry is SurfaceDef => (entry as SurfaceDef | null)?.id === surface,
  );
  if (declared === undefined || typeof declared.path !== "string") return undefined;

  const prefix = normalizePathPrefix(declared.path);
  // `null` is a `..` the normaliser refuses; `""` is the whole repository, which
  // says nothing about where a fix belongs and so can support no warning.
  if (prefix === null || prefix === "") return undefined;

  if (evidence.paths.some((filePath) => pathMatchesPrefix(filePath, prefix))) return undefined;

  return `resolved ${findingId}, but this pull request changed no file under \`${prefix}\` (surface \`${surface}\`)`;
}
