/**
 * Which release the Changelog's detail column shows.
 *
 * Pure and import-free so it is testable without a browser (see
 * `tests/app/changelog-releases.test.js`).
 */

/** The key of the "Unreleased" entry — shipped work not under any tag yet. */
export const UNRELEASED_KEY = "unreleased";

/** The query param that names the selected release. */
export const RELEASE_PARAM = "release";

/**
 * The key to select, given the keys the list currently shows (in display
 * order) and what `?release=` asks for.
 *
 * A request the list does not hold — a stale link, or a release the period
 * filters just hid — falls back to the first row rather than to nothing: the
 * detail column should always show something while the list does.
 */
export function resolveSelectedRelease(keys: readonly string[], requested: string | null): string | null {
  if (keys.length === 0) return null;
  if (requested && keys.includes(requested)) return requested;
  return keys[0];
}
