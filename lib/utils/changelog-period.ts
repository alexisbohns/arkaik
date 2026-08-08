/**
 * Period arithmetic for the Changelog's year/month filter.
 *
 * Kept pure and DOM-free so it can be tested without a browser or a database.
 *
 * Timestamps are read off the ISO string rather than through `new Date(...)`:
 * a `Date` renders in the reader's zone, so `2026-01-01T00:30:00Z` becomes
 * December for anyone west of UTC and a release would vanish from the year it
 * is tagged with. The journal's own calendar is the one the page filters by.
 */

/** Month names in index order — `MONTH_LABELS[0]` is January. */
export const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface Period {
  /** Four-digit year, or `null` for "all years". */
  year: number | null;
  /** Zero-based month index, or `null` for "all months". */
  month: number | null;
}

/** No filter at all — every timestamp matches. */
export const ALL_PERIODS: Period = { year: null, month: null };

const ISO_PREFIX = /^(\d{4})-(\d{2})/;

/**
 * The `{year, month}` an ISO timestamp falls in, or `null` when the string is
 * not one this can read (render-never-crash: an unparseable stamp is simply
 * never filtered out).
 */
export function periodOf(ts: string): { year: number; month: number } | null {
  const match = ISO_PREFIX.exec(ts);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isInteger(year) || month < 0 || month > 11) return null;
  return { year, month };
}

/** Whether a timestamp survives the filter. Unreadable stamps always survive. */
export function matchesPeriod(ts: string, period: Period): boolean {
  if (period.year === null && period.month === null) return true;
  const at = periodOf(ts);
  if (at === null) return true;
  if (period.year !== null && at.year !== period.year) return false;
  if (period.month !== null && at.month !== period.month) return false;
  return true;
}

/** Every year the given timestamps touch, newest first — the year menu's options. */
export function listYears(timestamps: readonly string[]): number[] {
  const years = new Set<number>();
  for (const ts of timestamps) {
    const at = periodOf(ts);
    if (at) years.add(at.year);
  }
  return [...years].sort((a, b) => b - a);
}
