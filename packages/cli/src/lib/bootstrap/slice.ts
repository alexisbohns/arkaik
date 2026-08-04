/**
 * Resolve exactly the corpus subset one work unit needs.
 *
 * This is the method's primary token lever: an agent reads ~30-60KB of its own
 * slice instead of the whole mined corpus. Path matching is prefix-based on
 * repo-relative POSIX paths — a unit that owns `app/home` gets every PR that
 * touched anything beneath it. Era matching is date-range based: a wave-3
 * story unit's `slice.eras` names a slug, and this file looks that slug's
 * `from`/`to` window up in profile.json — see `eraWindows` below for why the
 * window lives there and not in the manifest itself.
 */
import { existsSync, readFileSync } from "node:fs";

import type { CorpusDoc, CorpusPr, CorpusSurface } from "./corpus";
import { readCorpusPrs } from "./corpus";
import type { WorkUnit } from "./manifest";
import { readProfile } from "./manifest";
import { at, DOCS_FILE, SURFACES_FILE } from "./paths";

export interface Slice {
  unit: string;
  wave: number;
  scope: string;
  fragment: string;
  prs: CorpusPr[];
  surfaces: CorpusSurface[];
  docs?: CorpusDoc[];
}

function readJsonArray<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/**
 * `paths` comes from profile.json, written by an agent, not this code —
 * nothing stops it from spelling a path `app\\home` (a Windows-style mental
 * model, a copy-paste artifact). The corpus itself is always POSIX
 * (corpus.ts normalizes with `.split(path.sep).join("/")` at mining time), so
 * without this a backslash-spelled path would never agree with the corpus
 * and the unit would silently get an EMPTY slice instead of the one it asked
 * for — wrong in the opposite direction from this file's usual concern, but
 * just as silent.
 */
function toPosix(value: string): string {
  return value.includes("\\") ? value.split("\\").join("/") : value;
}

/**
 * True when `filePath` sits at or beneath any of `paths`. The trailing-slash
 * normalization is what keeps a path like `app/home` from matching
 * `app/homepage/thing.ts`: a bare `startsWith(p)` would treat "app/home" as a
 * string-prefix of "app/homepage" and match it wrongly. Appending "/" first
 * (when `p` doesn't already end with one) turns the check into "does
 * app/homepage/thing.ts start with app/home/", which it does not.
 */
export function matchesPaths(filePath: string, paths: readonly string[]): boolean {
  const file = toPosix(filePath);
  return paths.some((raw) => {
    const p = toPosix(raw);
    return file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`);
  });
}

/** One era's date window, resolved from profile.json by slug. */
interface EraWindow {
  from?: string;
  to?: string;
}

/**
 * Look `slugs` (a work unit's `slice.eras`) up in profile.json's `eras`
 * list. The manifest stores only the slug, not the window: `planUnits`
 * (manifest.ts) never reads `era.from`/`era.to` today, so embedding the
 * dates into `WorkUnit.slice` would mean changing the manifest schema and
 * its `sameSlice` re-plan invalidation logic too — a much bigger change than
 * this bug (era filtering not running at all) needs. The trade-off: if
 * profile.json's dates are edited without re-running `plan`, a unit already
 * marked `done` won't notice its window changed — a real but narrower gap
 * than the one this file exists to close, and the same shape of gap
 * `sameSlice` already accepts for purely cosmetic fields like `era.title`.
 *
 * A slug with no matching profile entry (profile.json edited or deleted
 * after `plan` ran) resolves to an empty window, which `matchesEras` treats
 * as "matches nothing" — fail closed, not fail open.
 */
function eraWindows(cwd: string, slugs: readonly string[]): EraWindow[] {
  if (slugs.length === 0) return [];
  const profile = readProfile(cwd);
  const bySlug = new Map((profile?.eras ?? []).map((e) => [e.slug, e]));
  return slugs.map((slug) => {
    const era = bySlug.get(slug);
    return era ? { from: era.from, to: era.to } : {};
  });
}

/**
 * True when `mergedAt` falls inside at least one of `windows`. A window with
 * neither `from` nor `to` matches nothing, deliberately: the whole reason
 * this function exists is to stop a wave-3 era unit from silently reading
 * the entire PR corpus (era filtering was declared on `WorkUnit.slice` but
 * never consumed — see the plan's Task 4 notes), so an era nobody gave a
 * boundary to should read as "not resolvable yet," not as "unbounded" —
 * treating it as unbounded would just move the same silent-everything bug
 * one level down. A PR whose own `merged_at` doesn't parse can't be shown to
 * fall inside any window either, so it is excluded the same way
 * `corpus.ts`'s `--since` excludes an undated PR — consistent with, not
 * contradicting, that file's existing convention.
 */
export function matchesEras(mergedAt: string, windows: readonly EraWindow[]): boolean {
  const merged = Date.parse(mergedAt);
  if (Number.isNaN(merged)) return false;
  return windows.some((w) => {
    if (w.from === undefined && w.to === undefined) return false;
    const from = w.from !== undefined ? Date.parse(w.from) : undefined;
    const to = w.to !== undefined ? Date.parse(w.to) : undefined;
    // An unparseable bound (an agent typo in profile.json) is treated as "no
    // bound on that side" rather than silently excluding every PR from an
    // era someone clearly meant to declare — a softer trust boundary than
    // assertSafeId's, appropriate here because the worst case is a slightly
    // too-generous story slice, not a filesystem escape.
    if (from !== undefined && !Number.isNaN(from) && merged < from) return false;
    if (to !== undefined && !Number.isNaN(to) && merged > to) return false;
    return true;
  });
}

/**
 * Longest PR body handed out inside one slice. A slice exists to bound what
 * one agent reads (~30-60KB, this method's primary token lever) — an
 * ordinary merged-PR body is a few hundred bytes to a few KB (this repo's
 * own merge-commit bodies run from ~130B to ~5.8KB), but nothing stops one
 * outlier — a pasted CI log, a giant checklist — from dominating a slice on
 * its own. This only trims outliers past this length; it never touches the
 * corpus file on disk, only what one slice hands out.
 */
const MAX_BODY_CHARS = 4000;

function boundBody(pr: CorpusPr): CorpusPr {
  if (pr.body.length <= MAX_BODY_CHARS) return pr;
  const cut = pr.body.length - MAX_BODY_CHARS;
  return { ...pr, body: `${pr.body.slice(0, MAX_BODY_CHARS)}\n\n…[truncated ${cut} more characters]` };
}

export function resolveSlice(cwd: string, unit: WorkUnit): Slice {
  const paths = unit.slice.paths ?? [];
  const eraSlugs = unit.slice.eras ?? [];
  const allPrs = readCorpusPrs(cwd);
  const surfaces = readJsonArray<CorpusSurface>(at(cwd, SURFACES_FILE));

  // Exactly three unit kinds ever reach the final (no paths, no eras)
  // branch: w0-recon, w3-decisions and w3-status-arcs (see manifest.ts's
  // planUnits) — all three are, by design, whole-corpus consumers: recon
  // needs the shape of everything to write profile.json in the first place;
  // decisions and status-arcs both need visibility across the whole
  // timeline, not one area or era. Every area-scoped unit always has a
  // non-empty `paths` (planUnits rejects an empty one); every era-scoped
  // unit always has a slug in `eras`, even one that resolves to zero PRs
  // above rather than "everything" — so this fallback can only be reached by
  // one of those three unit kinds, never by an authoring mistake in
  // profile.json.
  let prs: CorpusPr[];
  if (paths.length > 0) {
    prs = allPrs.filter((pr) => pr.files.some((f) => matchesPaths(f, paths)));
  } else if (eraSlugs.length > 0) {
    const windows = eraWindows(cwd, eraSlugs);
    prs = allPrs.filter((pr) => matchesEras(pr.merged_at, windows));
  } else {
    prs = allPrs;
  }
  prs = prs.map(boundBody);

  const slice: Slice = {
    unit: unit.id,
    wave: unit.wave,
    scope: unit.scope,
    fragment: unit.fragment,
    prs,
    surfaces: paths.length > 0 ? surfaces.filter((s) => matchesPaths(s.path, paths)) : surfaces,
  };

  if (unit.slice.docs) slice.docs = readJsonArray<CorpusDoc>(at(cwd, DOCS_FILE));

  return slice;
}
