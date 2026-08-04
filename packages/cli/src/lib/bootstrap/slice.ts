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
 *
 * The PR-body cap (`boundBody`) lives in its own module, `body-budget.ts` —
 * see that file for why. The half-open date math (`eraStart`/`eraEnd`) lives
 * in `era-window.ts`, shared with `profile-validate.ts`'s overlap check, so
 * the two can't independently drift the way they once did (see `eraWindows`).
 */
import { existsSync, readFileSync } from "node:fs";

import { boundBody } from "./body-budget";
import type { CorpusDoc, CorpusPr, CorpusSurface } from "./corpus";
import { readCorpusPrs } from "./corpus";
import { eraEnd, eraStart } from "./era-window";
import type { WorkUnit } from "./manifest";
import { readProfile } from "./manifest";
import { at, DOCS_FILE, PROFILE_FILE, SURFACES_FILE } from "./paths";
import { assertEraWindow } from "./profile-validate";

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
 *
 * Trade-off, accepted: a repo-relative path that legitimately contains a
 * literal backslash in a filename (valid on POSIX, just unusual) would be
 * mangled by this too. Judged vanishingly unlikely next to a Windows-style
 * or copy-pasted path arriving in profile.json.
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
 * this bug (era filtering not running at all) needed. The trade-off: if
 * profile.json's dates are edited without re-running `plan`, a unit already
 * marked `done` won't notice its window changed — a real but narrower gap
 * than the one this file exists to close, and the same shape of gap
 * `sameSlice` already accepts for purely cosmetic fields like `era.title`.
 *
 * Two things are enforced eagerly here, both because profile.json can drift
 * out from under an already-planned manifest (edited, or an era removed,
 * without a re-plan) and this must not be a silent-empty-slice the way it
 * used to be:
 *
 *  - A slug with NO matching profile entry throws, naming the slug and
 *    `PROFILE_FILE` — it used to resolve to `{}` (an unbounded window,
 *    which `matchesEras` then matches nothing), so `bootstrap slice
 *    w3-<slug>` exited 0 with an empty `prs: []` and no signal anything was
 *    wrong. That is exactly the silent-empty-story-fragment failure
 *    `assertEraWindow` exists to make loud at `plan` time — happening one
 *    stage later, quietly, at `slice` time instead.
 *  - A slug that IS found is re-validated with the same `assertEraWindow`
 *    `plan` already ran on it — not just trusted. `plan` only validated the
 *    window at THAT moment; if profile.json is edited afterward (a bound
 *    changed to something unparseable) without a re-plan, `matchesEras`
 *    would otherwise silently discard the bad bound and widen the window —
 *    reproduced before this fix: `from: "whenever", to: "2026-03-01"`
 *    widened to "everything before 2026-03-01" and one era's slice returned
 *    another era's PRs. Same check, same message, same loudness as `plan`,
 *    wherever it runs.
 */
function eraWindows(cwd: string, slugs: readonly string[]): EraWindow[] {
  if (slugs.length === 0) return [];
  const profile = readProfile(cwd);
  const bySlug = new Map((profile?.eras ?? []).map((e) => [e.slug, e]));
  return slugs.map((slug) => {
    const era = bySlug.get(slug);
    if (!era) {
      throw new Error(
        `era "${slug}" is not declared in ${PROFILE_FILE}'s "eras" list, but a work unit's slice references it. ` +
          "profile.json may have been edited (or the era removed) since `arkaik bootstrap plan` last ran. " +
          "Restore the era in profile.json and re-run `arkaik bootstrap plan`, or reconcile the manifest by hand.",
      );
    }
    assertEraWindow(era);
    return { from: era.from, to: era.to };
  });
}

/**
 * True when `mergedAt` falls inside at least one of `windows`, using the
 * half-open `[start, end)` semantics `era-window.ts` documents (a date-only
 * `to` includes the whole of that day; an exact-instant `to` does not).
 *
 * `eraWindows` above now re-validates every window it returns with the same
 * check `plan` uses, so in practice this function is never handed a window
 * with a missing-or-garbage bound through the normal `resolveSlice` path.
 * It stays defensive anyway — a function whose failure mode is "match the
 * entire corpus" shouldn't rely on an upstream validator being correct, and
 * this was reproduced for real: with both bounds unparseable, every guard
 * used to fall through and this matched everything. A bound that's missing
 * OR doesn't parse is discarded as "not usable" (not "unbounded") — one bad
 * side next to one good one still leaves the good side constraining the
 * match, but if BOTH sides end up unusable there is nothing left to
 * constrain on, and the window matches nothing, not everything.
 *
 * A PR whose own `merged_at` doesn't parse can't be shown to fall inside any
 * window either, so it is excluded the same way `corpus.ts`'s `--since`
 * excludes an undated PR — consistent with, not contradicting, that file's
 * existing convention.
 */
export function matchesEras(mergedAt: string, windows: readonly EraWindow[]): boolean {
  const merged = Date.parse(mergedAt);
  if (Number.isNaN(merged)) return false;
  return windows.some((w) => {
    const start = w.from !== undefined ? eraStart(w.from) : undefined;
    const end = w.to !== undefined ? eraEnd(w.to) : undefined;
    const usableStart = start !== undefined && !Number.isNaN(start) ? start : undefined;
    const usableEnd = end !== undefined && !Number.isNaN(end) ? end : undefined;
    if (usableStart === undefined && usableEnd === undefined) return false;
    if (usableStart !== undefined && merged < usableStart) return false;
    if (usableEnd !== undefined && merged >= usableEnd) return false;
    return true;
  });
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
  // unit always has a slug in `eras` that resolves to a validated window
  // (planUnits rejects a dateless or unparseable one; eraWindows re-checks
  // at slice time) — so this fallback can only be reached by one of those
  // three unit kinds, never by an authoring mistake in profile.json.
  let prs: CorpusPr[];
  let surfacesOut: CorpusSurface[];
  if (paths.length > 0) {
    prs = allPrs.filter((pr) => pr.files.some((f) => matchesPaths(f, paths)));
    surfacesOut = surfaces.filter((s) => matchesPaths(s.path, paths));
  } else if (eraSlugs.length > 0) {
    const windows = eraWindows(cwd, eraSlugs);
    prs = allPrs.filter((pr) => matchesEras(pr.merged_at, windows));
    // A story unit works from PRs and, when it asks, the docs manifest —
    // never the code-surface inventory (that's an anatomy-wave hint, keyed
    // by path, and an era has no path scope to key it by). Matching every
    // path-scoped unit's "exactly the subset this unit needs," not the
    // whole-corpus fallback the three hardcoded kinds below intentionally
    // get.
    surfacesOut = [];
  } else {
    prs = allPrs;
    surfacesOut = surfaces;
  }
  prs = prs.map((pr) => ({ ...pr, body: boundBody(pr.body) }));

  const slice: Slice = {
    unit: unit.id,
    wave: unit.wave,
    scope: unit.scope,
    fragment: unit.fragment,
    prs,
    surfaces: surfacesOut,
  };

  if (unit.slice.docs) slice.docs = readJsonArray<CorpusDoc>(at(cwd, DOCS_FILE));

  return slice;
}
