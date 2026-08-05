#!/usr/bin/env node

/**
 * Direct unit tests for `packages/cli/src/lib/bootstrap/era-window.ts` — the
 * half-open date-window math shared by `profile-validate.ts` (era overlap
 * detection at plan time) and `slice.ts` (PR membership at slice time).
 *
 * Loaded via ./load-bootstrap-lib.js rather than a direct `require(".ts")` —
 * that works on a dev machine (recent Node strips TS types natively) but not
 * in CI, which pins Node 20 (see that file's comment for the full story).
 * Same as bootstrap-body-budget.test.js — no CLI build needed. This module
 * is the one piece of date math a real critical bug came from (inclusive-
 * inclusive bounds silently dropped every PR merged on a boundary day — 51
 * of 195 on a real 4-era partition), so it gets its own direct coverage
 * rather than being pinned only through the full corpus -> plan -> slice CLI
 * round trip.
 */
const { loadBootstrapModule } = require("./load-bootstrap-lib");

const { eraStart, eraEnd } = loadBootstrapModule("era-window");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;

// --- eraStart: no adjustment needed either way ---
check("eraStart: a date-only value is that day's T00:00:00Z", eraStart("2026-01-31") === Date.parse("2026-01-31T00:00:00.000Z"), String(eraStart("2026-01-31")));
check(
  "eraStart: a value with an explicit time is that exact instant, unmodified",
  eraStart("2026-01-31T15:30:00Z") === Date.parse("2026-01-31T15:30:00Z"),
  String(eraStart("2026-01-31T15:30:00Z")),
);
check("eraStart: an unparseable value is NaN", Number.isNaN(eraStart("whenever")), String(eraStart("whenever")));

// --- eraEnd: date-only expands to the NEXT day; a time component does not ---
check(
  "eraEnd: a date-only value expands to the next day's T00:00:00Z (the whole named day is included)",
  eraEnd("2026-01-31") === Date.parse("2026-02-01T00:00:00.000Z"),
  String(eraEnd("2026-01-31")),
);
check(
  "eraEnd: expansion is exactly +1 day, not rounded or approximated",
  eraEnd("2026-01-31") - eraStart("2026-01-31") === DAY,
  String(eraEnd("2026-01-31") - eraStart("2026-01-31")),
);
check(
  "eraEnd: a value with an explicit time is that exact instant, NOT expanded",
  eraEnd("2026-01-31T15:30:00Z") === Date.parse("2026-01-31T15:30:00Z"),
  String(eraEnd("2026-01-31T15:30:00Z")),
);
check("eraEnd: an unparseable value is NaN, not NaN+1day (which would be a finite, wrong number)", Number.isNaN(eraEnd("whenever")), String(eraEnd("whenever")));

// --- the critical fix itself: a PR merged on the boundary day is inside [start, end) for a date-only `to` ---
{
  const start = eraStart("2026-01-01");
  const end = eraEnd("2026-01-31"); // half-open: end = Feb 1 00:00:00Z, so all of Jan 31 is included
  const midDayOnBoundary = Date.parse("2026-01-31T12:00:00Z");
  const lateOnBoundary = Date.parse("2026-01-31T23:59:59Z");
  const startOfNextEra = Date.parse("2026-02-01T00:00:00Z");
  check(
    "critical fix: a PR merged mid-day on the `to` date is INSIDE the window (start <= merged < end)",
    start <= midDayOnBoundary && midDayOnBoundary < end,
    `start=${start} merged=${midDayOnBoundary} end=${end}`,
  );
  check(
    "critical fix: a PR merged at 23:59:59 on the `to` date is still inside the window",
    start <= lateOnBoundary && lateOnBoundary < end,
    `start=${start} merged=${lateOnBoundary} end=${end}`,
  );
  check(
    "critical fix: the very start of the NEXT day is excluded (the window is genuinely half-open, not inclusive)",
    !(start <= startOfNextEra && startOfNextEra < end),
    `start=${start} nextDay=${startOfNextEra} end=${end}`,
  );
}

// --- two eras written as `to: dayX` / `from: dayX+1` touch exactly, with zero gap and zero overlap ---
{
  const eraOneEnd = eraEnd("2026-01-31");
  const eraTwoStart = eraStart("2026-02-01");
  check(
    "adjacent eras (to: day / from: next day) touch exactly — no gap, no overlap",
    eraOneEnd === eraTwoStart,
    `eraOneEnd=${eraOneEnd} eraTwoStart=${eraTwoStart}`,
  );
}

// --- two eras written as `to: dayX` / `from: dayX` (the SAME calendar date) overlap by a full day ---
{
  const eraOneEnd = eraEnd("2026-02-01"); // expands to include all of Feb 1 -> ends at start of Feb 2
  const eraTwoStart = eraStart("2026-02-01"); // starts at the very beginning of Feb 1
  check(
    "same-date to/from overlap by a full day (eraOneEnd is a whole day past eraTwoStart)",
    eraOneEnd - eraTwoStart === DAY,
    `eraOneEnd=${eraOneEnd} eraTwoStart=${eraTwoStart} diff=${eraOneEnd - eraTwoStart}`,
  );
}

process.exit(failures === 0 ? 0 : 1);
