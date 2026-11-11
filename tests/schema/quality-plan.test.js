#!/usr/bin/env node

/**
 * The Kritik planner's pure rules (docs/superpowers/specs/2026-11-11-kritik-planner-design.md,
 * part 1 of docs/superpowers/plans/2026-11-11-kritik-planner-stack.md): the
 * `--run` grammar, the cells per part, plan and part ids that sort last, the
 * partial-id predicates, the recorded scope marker's reader, and the plan
 * file's zod schema.
 *
 * Pure and DB-free — `quality-plan.ts` imports nothing at runtime but
 * `applicableCells`, `domainCodeOf` and a constant — so this runs in CI's fast
 * build job beside the other quality suites. TypeScript is loaded through
 * `load-schema.js` (CI runs Node 20, which cannot require a `.ts` file).
 *
 * The cell counts are pinned against the shipped pack
 * (`packages/kritik-library/framework.json`, version 0.1.0) and its Pebbles
 * profile: SEC on web is 6 cells and 36 checklist steps, AGT on iOS 8 and 42,
 * and the whole product 338 applicable cells.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/kritik-library/framework.json"), "utf8"));
const PEBBLES = PACK.profiles.pbbls.surfaces;
const SURFACES = PEBBLES.map((surface) => surface.id);
const DOMAINS = PACK.domains.map((domain) => domain.code);

const S = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}
const throws = (fn) => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error.message;
  }
};

// --- partial ids ----------------------------------------------------------------

{
  const { isScopedAuditId, isPlanId, isPlanPartId, isPartialAuditId, planIdOfPartId, planCellKey } = S;

  check("a month is a full audit id", !isPartialAuditId("2026-11") && !isScopedAuditId("2026-11") && !isPlanId("2026-11") && !isPlanPartId("2026-11"));
  check("a hand-named audit is a full audit id", !isPartialAuditId("2026-11-sec-web"));
  check("<month>-scoped and -scoped-NN are scoped", isScopedAuditId("2026-11-scoped") && isScopedAuditId("2026-11-scoped-02") && isPartialAuditId("2026-11-scoped-02"));
  check("a plan id is a plan id, not a part", isPlanId("2026-11-zplan-1100") && !isPlanPartId("2026-11-zplan-1100") && isPartialAuditId("2026-11-zplan-1100"));
  check("a plan part id is a part, not a plan", isPlanPartId("2026-11-zplan-1100-sec-web") && !isPlanId("2026-11-zplan-1100-sec-web") && isPartialAuditId("2026-11-zplan-1100-sec-web"));
  check("a part with a digit domain and a dashed surface is a part", isPlanPartId("2026-11-zplan-1100-a11y-web-app"));
  check(
    "a scoped id wins over a part: <partId>-scoped is scoped, not a part",
    isScopedAuditId("2026-11-zplan-1100-sec-web-scoped") && !isPlanPartId("2026-11-zplan-1100-sec-web-scoped") && isPartialAuditId("2026-11-zplan-1100-sec-web-scoped"),
  );
  check("upper case is not a part id", !isPlanPartId("2026-11-zplan-1100-SEC-web"));
  check("a three-digit DDN is not a plan id", !isPlanId("2026-11-zplan-110") && !isPlanPartId("2026-11-zplan-110-sec-web"));
  check("non-strings are never ids", [undefined, null, 42, {}, ["2026-11-scoped"]].every((value) => !isPartialAuditId(value)));
  check("planIdOfPartId reads the plan off a part", planIdOfPartId("2026-11-zplan-1100-sec-web") === "2026-11-zplan-1100");
  check(
    "planIdOfPartId is null for anything but a part",
    planIdOfPartId("2026-11-zplan-1100") === null && planIdOfPartId("2026-11-zplan-1100-sec-web-scoped") === null && planIdOfPartId("2026-11") === null,
  );
  check("planCellKey is criterion::surface", planCellKey("SEC-01", "web") === "SEC-01::web");
}

// --- the --run grammar ------------------------------------------------------------

{
  const { parseRun } = S;
  const vocabulary = { domains: DOMAINS, surfaces: [...SURFACES, "cross-surface"] };

  {
    const { runs, warnings } = parseRun(["SEC:web", "agt:ios", "A11Y:web", "a11y:admin"], vocabulary);
    check(
      "valid tokens parse in order, domains upper-cased, surfaces kept",
      JSON.stringify(runs) ===
        JSON.stringify([
          { domain: "SEC", surface: "web" },
          { domain: "AGT", surface: "ios" },
          { domain: "A11Y", surface: "web" },
          { domain: "A11Y", surface: "admin" },
        ]) && warnings.length === 0,
      JSON.stringify({ runs, warnings }),
    );
  }
  {
    const { runs, warnings } = parseRun(["SEC:web", "AGT:ios", "sec:web", "Sec:web"], vocabulary);
    check(
      "a duplicate after normalisation collapses into its first occurrence, one warning each",
      JSON.stringify(runs) === JSON.stringify([{ domain: "SEC", surface: "web" }, { domain: "AGT", surface: "ios" }]) &&
        warnings.length === 2 &&
        warnings[0].includes("sec:web") &&
        warnings[0].includes("SEC:web"),
      JSON.stringify({ runs, warnings }),
    );
  }
  check("no token refuses", throws(() => parseRun([], vocabulary)) === "at least one --run DOMAIN:SURFACE is required");
  for (const token of ["SEC", "SEC:", ":web", "SEC:web:x", "S:web", "SECURE:web", "SEC:we b", "SEC:web/app", "SE*:web", ""]) {
    const message = throws(() => parseRun([token], vocabulary));
    check(
      `the malformed token ${JSON.stringify(token)} refuses, showing the grammar and the token`,
      message !== undefined && message.includes(`"${token}"`) && message.includes("DOMAIN:SURFACE") && message.includes("2 to 5"),
      message,
    );
  }
  {
    const message = throws(() => parseRun(["XYZ:web"], vocabulary));
    check("an unknown domain refuses and lists the codes", message !== undefined && message.includes("XYZ") && message.includes(DOMAINS.join(", ")), message);
  }
  {
    const message = throws(() => parseRun(["SEC:api"], vocabulary));
    check(
      "an unknown surface refuses, lists the profile's surfaces and asks for a literal match",
      message !== undefined && message.includes('"api"') && message.includes(SURFACES.join(", ")) && message.includes("exactly"),
      message,
    );
  }
  {
    const message = throws(() => parseRun(["SEC:Web"], vocabulary));
    check("surfaces match literally: Web is not web", message !== undefined && message.includes('"Web"'), message);
  }
  {
    const message = throws(() => parseRun(["SEC:cross-surface"], vocabulary));
    check("cross-surface refuses as a findings-only lens", message !== undefined && message.includes("cross-surface") && message.includes("lens"), message);
  }
  {
    const message = throws(() => parseRun(["SEC:web", "SEC"], vocabulary));
    check("one bad token among good ones still refuses", message !== undefined && message.includes('"SEC"'), message);
  }
  {
    const { runs } = parseRun(["ux1:web"], { domains: ["UX1"], surfaces: ["web"] });
    check("the domain vocabulary is the caller's (an overlay code)", runs.length === 1 && runs[0].domain === "UX1");
  }
}

// --- cells per part -----------------------------------------------------------------

{
  const { planCells, applicableCellCount, signalRunSheet } = S;

  {
    const { cells, steps } = planCells(PACK, SURFACES, { domain: "SEC", surface: "web" });
    check(
      "SEC on web is 6 cells and 36 steps",
      cells.length === 6 && steps === 36 && cells.map((cell) => cell.criterion_id).join(",") === "SEC-01,SEC-04,SEC-05,SEC-06,SEC-07,SEC-08" && cells.every((cell) => cell.surface === "web"),
      JSON.stringify({ cells, steps }),
    );
  }
  {
    const { cells, steps } = planCells(PACK, SURFACES, { domain: "AGT", surface: "ios" });
    check("AGT on iOS is 8 cells and 42 steps", cells.length === 8 && steps === 42, JSON.stringify({ count: cells.length, steps }));
  }
  check("the Pebbles profile has 338 applicable cells", applicableCellCount(PACK, SURFACES) === 338, String(applicableCellCount(PACK, SURFACES)));

  // The run sheet is one row per signal, and filters on `criterion.domain`
  // with exact case — so the comparison is over its distinct cells. On the
  // shipped pack every criterion has signals and none is retired, which is
  // what makes the two sets equal.
  const mismatches = [];
  let total = 0;
  for (const domain of DOMAINS) {
    for (const surface of SURFACES) {
      const planned = planCells(PACK, SURFACES, { domain, surface }).cells.map((cell) => `${cell.criterion_id}::${cell.surface}`);
      const sheet = [...new Set(signalRunSheet(PACK, PEBBLES, { domain, surface }).map((row) => `${row.criterion_id}::${row.surface}`))];
      total += planned.length;
      if (JSON.stringify(planned) !== JSON.stringify(sheet)) mismatches.push(`${domain}:${surface}`);
    }
  }
  check("every domain × surface of the shipped pack gives the run sheet's cells, in the same order", mismatches.length === 0, mismatches.join(", "));
  check("the parts of every domain × surface add up to the applicable cells", total === 338, String(total));

  const LIB = {
    criteria: [
      { id: "SEC-01", domain: "SEC", applies_to: ["web"], checklist: ["a", "b"] },
      { id: "SEC-02", domain: "SEC", applies_to: ["web"], superseded_by: "SEC-01", checklist: ["a"] },
      { id: "SEC-03", domain: "SEC", applies_to: ["web"] },
      { id: "SEC-04", domain: "SEC", applies_to: ["ios"], checklist: ["a"] },
      { id: "SEC-05", domain: "SEC", checklist: ["a", "b", "c"] },
      { id: "UX-01", checklist: ["a"] },
    ],
  };
  {
    const { cells, steps } = planCells(LIB, ["web", "ios"], { domain: "SEC", surface: "web" });
    check(
      "retired criteria are out, no applies_to is everywhere, a missing checklist counts 0",
      cells.map((cell) => cell.criterion_id).join(",") === "SEC-01,SEC-03,SEC-05" && steps === 5,
      JSON.stringify({ cells, steps }),
    );
  }
  {
    const { cells } = planCells(LIB, ["web", "ios"], { domain: "UX", surface: "ios" });
    check("a criterion with no domain belongs to its id prefix", cells.length === 1 && cells[0].criterion_id === "UX-01");
  }
  {
    const result = planCells(LIB, ["web", "ios"], { domain: "SEC", surface: "android" });
    check("a surface outside the given surfaces gives zero cells, not an error", result.cells.length === 0 && result.steps === 0);
  }
  check("cross-surface never counts as an applicable surface", applicableCellCount(LIB, ["web", "cross-surface"]) === applicableCellCount(LIB, ["web"]));
}

// --- plan and part ids --------------------------------------------------------------

{
  const { planId, planPartId, isPlanId, isPlanPartId, isScopedAuditId } = S;
  // Local time on purpose: the id follows the local calendar, as currentAuditId() does.
  const NOW = new Date(2026, 10, 11, 9, 30);
  const RUNS = [{ domain: "SEC", surface: "web" }, { domain: "AGT", surface: "ios" }];

  check("planPartId lower-cases the domain and the surface", planPartId("2026-11-zplan-1100", "A11Y", "Web") === "2026-11-zplan-1100-a11y-web");
  for (const surface of ["scoped", "pre-scoped", "web-scoped-02"]) {
    check(`planPartId refuses the surface "${surface}", which would read as a scoped id`, throws(() => planPartId("2026-11-zplan-1100", "SEC", surface)) !== undefined);
  }
  check("planPartId accepts a surface that merely contains scoped", planPartId("2026-11-zplan-1100", "SEC", "scoped-api") === "2026-11-zplan-1100-sec-scoped-api");

  check("with nothing known, the first plan of the day is DD00", planId({ now: NOW, known: [], runs: RUNS }) === "2026-11-zplan-1100");
  check("the id pads the month and the day", planId({ now: new Date(2026, 0, 5, 12), known: [], runs: RUNS }) === "2026-01-zplan-0500");
  check(
    "a plan id is a plan id, and its parts are parts",
    isPlanId(planId({ now: NOW, known: [], runs: RUNS })) && RUNS.every((run) => isPlanPartId(planPartId("2026-11-zplan-1100", run.domain, run.surface))),
  );
  check("a known plan id is skipped", planId({ now: NOW, known: ["2026-11-zplan-1100"], runs: RUNS }) === "2026-11-zplan-1101");
  // Its parts would sort after the known one, so only the "starts with" rule skips it.
  check("a known part of a candidate is skipped", planId({ now: NOW, known: ["2026-11-zplan-1100-a11y-admin"], runs: RUNS }) === "2026-11-zplan-1101");
  check(
    "a candidate whose parts would sort before the greatest known id is skipped",
    planId({ now: NOW, known: ["2026-11-zplan-1100-zzz-web"], runs: [{ domain: "SEC", surface: "web" }] }) === "2026-11-zplan-1101",
  );
  check("known need not arrive sorted", planId({ now: NOW, known: ["2026-11-zplan-1103-sec-web", "2026-10"], runs: RUNS }) === "2026-11-zplan-1104");
  {
    const message = throws(() => planId({ now: NOW, known: ["2026-10", "2026-12"], runs: RUNS }));
    check("past NN 99 it throws, naming the greatest known id", message === 'no plan id on 2026-11-11 sorts after "2026-12"', message);
  }
  {
    const known = Array.from({ length: 100 }, (_, n) => `2026-11-zplan-11${String(n).padStart(2, "0")}`);
    const message = throws(() => planId({ now: NOW, known, runs: RUNS }));
    check("a day with all 100 plan ids taken throws", message === 'no plan id on 2026-11-11 sorts after "2026-11-zplan-1199"', message);
  }

  // Sort-last property: whatever exists, every new part id sorts after all of it.
  // mulberry32: seeded, so a failure reproduces.
  let seed = 20261111;
  const random = (n) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
  const pick = (items) => items[random(items.length)];
  const surfaces = ["web", "ios", "android", "admin", "supabase", "web-app", "api_v2"];
  const domains = ["SEC", "PRV", "GDP", "SAF", "ARC", "TST", "PLT", "A11Y", "PRF", "REL", "AGT"];
  const two = (n) => String(n).padStart(2, "0");
  const existing = () => {
    const month = `2026-${two(1 + random(11))}`;
    const plan = `${month}-zplan-${two(1 + random(28))}${two(random(90))}`;
    switch (random(7)) {
      case 0:
        return month;
      case 1:
        return `${month}-scoped`;
      case 2:
        return `${month}-scoped-${two(2 + random(98))}`;
      case 3:
        return `${month}-${pick(domains).toLowerCase()}-${pick(surfaces)}`;
      case 4:
        return plan;
      case 5:
        return `${plan}-${pick(domains).toLowerCase()}-${pick(surfaces)}`;
      default:
        return `${plan}-${pick(domains).toLowerCase()}-${pick(surfaces)}-scoped`;
    }
  };
  const violations = [];
  for (let trial = 0; trial < 500; trial++) {
    const known = Array.from({ length: 1 + random(12) }, existing);
    // Every generated id is dated on or before 2026-11-28 and numbered below
    // 90, so a plan on the 28th always fits. Same-day plans are what make the
    // NN rule, not the date, decide whether a part sorts last.
    const now = new Date(2026, 10, 28, 8);
    const runs = Array.from({ length: 1 + random(3) }, () => ({ domain: pick(domains), surface: pick(surfaces) }));
    const id = planId({ now, known, runs });
    const parts = runs.map((run) => planPartId(id, run.domain, run.surface));
    const late = parts.filter((part) => known.some((other) => !(part > other)));
    if (late.length > 0 || known.includes(id) || !parts.every((part) => isPlanPartId(part) && !isScopedAuditId(part))) violations.push(JSON.stringify({ known, runs, id }));
  }
  check("500 generated histories: every new part id sorts after every existing id", violations.length === 0, violations.slice(0, 3).join(" | "));
}

// --- summary ------------------------------------------------------------------------

console.log(failures === 0 ? "\nAll quality-plan checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
