/**
 * Turn an era's `from`/`to` strings into a half-open `[start, end)` instant
 * pair — the one piece of date math `profile-validate.ts` (overlap detection
 * at plan time) and `slice.ts` (PR membership at slice time) both need, and
 * must agree on.
 *
 * A prior version of this logic lived separately in each file, both using
 * inclusive-inclusive bounds, and disagreed with reality under a common
 * shape: `Date.parse("2026-01-31")` is that day's `T00:00:00Z`, so an
 * inclusive `merged <= to` check with `to: "2026-01-31"` excluded every PR
 * merged LATER that same day — on a real 4-era partition of this repo, 51 of
 * 195 PRs merged on a boundary day landed in NEITHER era. Half-open bounds
 * with end-of-day expansion for a date-only `to` close that: the whole named
 * day is included, and two eras can share a boundary date exactly (one's
 * `to` equal to the other's `from`) without a gap or a double-count.
 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `from`'s instant, as epoch ms (`NaN` if unparseable). `Date.parse` already
 * treats a date-only ISO string as that day's `T00:00:00Z`, so no adjustment
 * is needed regardless of whether `value` carries an explicit time
 * component — the start of a window is always "at or after this instant."
 */
export function eraStart(value: string): number {
  return Date.parse(value);
}

/**
 * `to`'s instant, as epoch ms, EXCLUSIVE (`NaN` if unparseable). A date-only
 * value means "through the end of that day" — expanded to the START of the
 * NEXT day, so the half-open interval `[start, end)` includes every moment
 * of the named day. A value with an explicit time component is treated as
 * an exact, deliberate cutoff and is used unmodified — the caller meant a
 * precise instant, not a whole day.
 */
export function eraEnd(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return parsed;
  return DATE_ONLY_RE.test(value) ? parsed + ONE_DAY_MS : parsed;
}
