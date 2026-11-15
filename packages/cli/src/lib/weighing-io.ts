/**
 * What `arkaik pack`, `arkaik restore` and the MCP server need from the
 * environment to carry a project's weighing state: **fold the repo's
 * `docs/weighing/` sidecars into a bundle's `weighing` key**.
 *
 * The model, the files and the projection are `@arkaik/schema`'s
 * (`packages/schema/src/cli/weighing-files.ts`); this is only what "being the
 * CLI's environment" means — turning "there is nothing to fold" into a line a
 * human can act on. It is exported through `arkaik/io` (docs/spec/mcp.md
 * § Reuse Seams), and the repo root it folds from is the one `resolveQualityRoot`
 * already answers: which repo owns a bundle file is one question, not two.
 */

import { loadWeighingSection, weighingDir } from "@arkaik/schema/src/cli/weighing-files";

/** What {@link foldWeighingSection} did, for a caller that wants the fact rather than the sentence. */
export interface FoldWeighingResult {
  /** A section was built from `docs/weighing/` and written onto the bundle. */
  folded: boolean;
  /** Nothing was folded AND the bundle arrived carrying its own `weighing`, which is therefore still on it. */
  carriedSection: boolean;
  notice: string;
}

function isSection(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fold the repo's weighing sidecars into a bundle's `weighing` section.
 *
 * MUTATES `bundle`, like `foldQualitySection`: `runPack` owns a throwaway parse
 * of the source file, and what its caller wants back is the notice. Nothing to
 * fold is never a failure — weighing is additive, a project with no
 * `docs/weighing/` must still pack — and "leave the bundle untouched" is
 * literal: a section the bundle already carried survives, which is what lets
 * `arkaik restore <backup>` put the weighing half back too. What DOES throw is
 * a *malformed* sidecar, named by its path.
 */
export function foldWeighingSection(bundle: Record<string, unknown>, root: string): FoldWeighingResult {
  const section = loadWeighingSection(root);
  if (section === undefined) {
    const carriedSection = isSection(bundle.weighing);
    return {
      folded: false,
      carriedSection,
      notice: carriedSection
        ? `Weighing: none to fold — no files under ${weighingDir(root)}\n  Kept the weighing section this bundle already carried — nothing replaced it.`
        : `Weighing: none to fold — no files under ${weighingDir(root)}`,
    };
  }
  bundle.weighing = section;
  return {
    folded: true,
    carriedSection: false,
    notice: `Weighing: folded ${section.assessments?.length ?? 0} assessment(s), ${section.sets?.length ?? 0} set(s) from ${weighingDir(root)}`,
  };
}
