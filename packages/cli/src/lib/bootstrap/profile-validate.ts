/**
 * profile.json's validation, in one place.
 *
 * `manifest.ts`'s `planUnits` treats profile.json as untrusted input — it's
 * agent-written, not code-written — and every field checked here either
 * reaches a filesystem path (an id becoming a fragment filename) or a
 * token-budget decision (paths/eras deciding what an agent reads). This
 * validation used to live inline in `planUnits`; by the time it was
 * extracted, it alone was roughly 30% of manifest.ts's line count.
 * `assertValidProfile` is the one call `planUnits` needs. `assertEraWindow`
 * is exported separately because `slice.ts` needs the identical check at
 * slice time too — see that file's `eraWindows` for why re-validating there,
 * not just trusting the manifest, closes a real divergence bug.
 */
import { eraEnd, eraStart } from "./era-window";
import type { Profile } from "./manifest";
import { FRAGMENTS_DIR } from "./paths";

/** Lowercase kebab-case only — no uppercase, no `/`, no `..`, no whitespace. */
const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_ID_LENGTH = 64;

/**
 * Area ids and era slugs come from profile.json — written by an agent, not
 * by this code — and become fragment filenames verbatim
 * (`${FRAGMENTS_DIR}/${id}.json`). Two things are enforced here, both about
 * that filename:
 *
 *  - No `/` or `..`, which would let the path escape the fragments
 *    directory.
 *  - Lowercase only, not merely "the duplicate check below lowercases
 *    before comparing." macOS and Windows both default to case-insensitive
 *    filesystems, so ids `Home` and `home` are the SAME fragment file there
 *    even though they're different strings — a case-sensitive `seen` set
 *    would wave both through, and the second agent's write would silently
 *    clobber the first's fragment with no error from either `plan` or
 *    `merge`. Rejecting uppercase at validation time closes that off
 *    entirely, rather than trying to catch it at comparison time. This also
 *    matches this codebase's own id convention: `kebabCase()`
 *    (packages/schema/src/id-gen.ts) lowercases everything, and the bundle
 *    schema documents node ids as kebab-case.
 *
 * A length cap (`MAX_ID_LENGTH`) is enforced for the same "fail at the one
 * place that can give a clear message" reason: an oversized id would
 * otherwise defer a raw `ENAMETOOLONG` to whenever an agent tries to write
 * the fragment.
 *
 * Reject rather than sanitize either way: silently mangling the id would let
 * two different-looking ids collide without anyone noticing.
 */
function assertSafeId(kind: "area" | "era", id: unknown): void {
  if (typeof id !== "string" || !SAFE_ID_RE.test(id) || id.length > MAX_ID_LENGTH) {
    throw new Error(
      `profile.json has an invalid ${kind} id: ${JSON.stringify(id)}. Work-unit ids become fragment filenames ` +
        `under ${FRAGMENTS_DIR}/, so they must be lowercase kebab-case (letters, digits and hyphens only, no ` +
        `uppercase, no "/", "..", or whitespace) and at most ${MAX_ID_LENGTH} characters. Fix profile.json and ` +
        "re-run `arkaik bootstrap plan`.",
    );
  }
}

/**
 * `profile.json`'s `areas`/`eras` keys, when present, must actually be
 * arrays — a string or number there (`areas: "home"`, `areas: 5`) would
 * otherwise reach a `for...of` below: a string iterates its characters
 * (silently wrong, not an error) and a number throws a raw
 * "is not iterable" with no mention of profile.json.
 */
function assertArrayField(field: "areas" | "eras", value: unknown): void {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(
      `profile.json "${field}" must be an array, got ${typeof value} (${JSON.stringify(value)}). Fix profile.json ` +
        "and re-run `arkaik bootstrap plan`.",
    );
  }
}

/**
 * An era's `from`/`to` are the only signal `bootstrap slice` has to scope a
 * wave-3 story unit to its date window. An era with neither bound is the
 * same authoring mistake as an area with empty `paths`, with the same
 * consequence class, just resolved the other way: instead of silently
 * handing that unit's agent the WHOLE corpus, an unbounded era resolves to
 * ZERO PRs (`bootstrap slice`'s date filter has nothing to constrain on) — a
 * story unit that writes an empty fragment and contributes nothing to the
 * changelog, with nothing in the manifest that looks wrong. Reject it here
 * rather than deferring to "hope the wave-3 agent notices its slice is
 * empty."
 *
 * A bound that IS present but doesn't parse is rejected the same way
 * `corpus.ts`'s `--since` validation already rejects an unparseable date —
 * same trust boundary (agent-written profile.json), same treatment. An era
 * with only one bound stays legal: that's a meaningful open-ended window,
 * not a mistake (see the overlap check below for the one place two
 * open-ended eras still collide).
 *
 * Exported (not just used internally) because `slice.ts`'s `eraWindows`
 * calls this same check again at slice time, on the era it actually looks
 * up — profile.json can be edited after `plan` ran without a re-plan, and a
 * stale, now-invalid window reaching `matchesEras` would silently widen one
 * era's slice into another's. Same validation, same loudness, wherever it
 * runs.
 */
export function assertEraWindow(era: { slug?: unknown; from?: unknown; to?: unknown }): void {
  if (era.from === undefined && era.to === undefined) {
    throw new Error(
      `profile.json era "${String(era.slug)}" has neither "from" nor "to". An unbounded era would hand that ` +
        "era's wave-3 agent zero PRs (bootstrap slice's date-window filter can't constrain anything), silently " +
        "contributing nothing to the story. Add at least one date and re-run `arkaik bootstrap plan`.",
    );
  }
  for (const [key, value] of [
    ["from", era.from],
    ["to", era.to],
  ] as const) {
    if (value === undefined) continue;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new Error(
        `profile.json era "${String(era.slug)}" has an unparseable "${key}": ${JSON.stringify(value)} (try an ISO ` +
          "date like 2026-01-31). Fix profile.json and re-run `arkaik bootstrap plan`.",
      );
    }
  }
}

/**
 * `bootstrap slice`'s era windows are half-open (`[start, end)` — see
 * `era-window.ts` for why: inclusive-inclusive bounds silently dropped every
 * PR merged on a boundary day). Half-open bounds mean two eras can share a
 * boundary date exactly with no gap and no double-count — but a genuine
 * overlap (one window's span reaching into another's) would still
 * double-match every PR merged in it, with nothing downstream deduping it.
 * Eras are required to partition the corpus without overlap, checked here
 * after each individual era's window is already known to be present and
 * parseable (`assertEraWindow` above). An open bound (`from`/`to` missing on
 * one side) extends the window to -Infinity/+Infinity for this check.
 */
function assertNoOverlappingEras(eras: ReadonlyArray<{ slug: string; from?: string; to?: string }>): void {
  const windows = eras.map((e) => ({
    slug: e.slug,
    start: e.from !== undefined ? eraStart(e.from) : -Infinity,
    end: e.to !== undefined ? eraEnd(e.to) : Infinity,
  }));
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const a = windows[i];
      const b = windows[j];
      if (a.start < b.end && b.start < a.end) {
        // Two eras that both carry only a "from" date are a natural way to
        // write successive chapters, but under half-open semantics each
        // extends to +Infinity, so they always overlap — the generic
        // message below ("narrow one or both windows") doesn't hint that
        // the actual fix is to add a "to" bound, so say so directly.
        const bothOpenEnded = a.end === Infinity && b.end === Infinity;
        throw new Error(
          bothOpenEnded
            ? `profile.json eras "${a.slug}" and "${b.slug}" both have only a "from" date, so both extend ` +
              'indefinitely and always overlap. Give the earlier era a "to" date (e.g. the later era\'s "from") ' +
              "and re-run `arkaik bootstrap plan`."
            : `profile.json eras "${a.slug}" and "${b.slug}" have overlapping date windows. Eras must partition ` +
              "the corpus without overlap — narrow one or both windows and re-run `arkaik bootstrap plan`.",
        );
      }
    }
  }
}

function assertAreas(profile: Profile): void {
  for (const rawArea of profile.areas ?? []) {
    if (rawArea === null || typeof rawArea !== "object") {
      throw new Error(
        `profile.json has a malformed area entry: ${JSON.stringify(rawArea)} (expected an object with id, title, paths).`,
      );
    }
    const area = rawArea as unknown as { id?: unknown; paths?: unknown };
    assertSafeId("area", area.id);
    if (!Array.isArray(area.paths) || area.paths.length === 0) {
      // An empty/missing `paths` produces `slice: {}`, which `bootstrap
      // slice` reads as "no filter" and hands the agent the WHOLE corpus —
      // the method's primary token lever failing open, silently, with
      // nothing in the manifest that looks wrong.
      throw new Error(
        `profile.json area "${String(area.id)}" has no paths. An empty slice would hand that unit's agent the ` +
          "entire corpus with no filtering. Add at least one path and re-run `arkaik bootstrap plan`.",
      );
    }
  }
}

function assertEras(profile: Profile): void {
  for (const rawEra of profile.eras ?? []) {
    if (rawEra === null || typeof rawEra !== "object") {
      throw new Error(
        `profile.json has a malformed era entry: ${JSON.stringify(rawEra)} (expected an object with slug, title).`,
      );
    }
    const era = rawEra as unknown as { slug?: unknown; from?: unknown; to?: unknown };
    assertSafeId("era", era.slug);
    assertEraWindow(era);
  }
  assertNoOverlappingEras(profile.eras ?? []);
}

/**
 * Validate profile.json in full. A no-op on `null` (no profile written
 * yet — nothing to validate). Everything below reaches either a filesystem
 * path or a token-budget decision, so it fails loudly and specifically
 * rather than crashing on a raw JS error or silently doing the wrong thing.
 */
export function assertValidProfile(profile: Profile | null): void {
  if (!profile) return;
  assertArrayField("areas", (profile as unknown as Record<string, unknown>).areas);
  assertArrayField("eras", (profile as unknown as Record<string, unknown>).eras);
  assertAreas(profile);
  assertEras(profile);
}
