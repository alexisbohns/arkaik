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
    const message = throws(() => parseRun(["pay:web"], { domains: ["SEC", "pay", "PAYMENT"], surfaces: ["web"] }));
    check(
      "a declared code that can never be planned is not listed as valid, and is named as unplannable",
      message !== undefined &&
        message.includes("PAY is not a domain") &&
        message.includes("Domain codes: SEC.") &&
        message.includes("pay, PAYMENT cannot be planned") &&
        message.includes("2 to 5 upper-case letters or digits"),
      message,
    );
  }
  {
    const message = throws(() => parseRun(["pay:web"], { domains: ["pay"], surfaces: ["web"] }));
    check(
      "with no plannable code at all, the refusal says so",
      message !== undefined && message.includes("Domain codes: none that can be planned.") && message.includes("pay cannot be planned"),
      message,
    );
  }
  {
    const message = throws(() => parseRun(["XYZ:web"], vocabulary));
    check("a library whose codes all fit the grammar gets no unplannable sentence", message !== undefined && !message.includes("cannot be planned"), message);
  }
  {
    const cased = { domains: ["SEC", "AGT"], surfaces: ["Web", "web", "ios"] };
    const message = throws(() => parseRun(["SEC:Web", "AGT:ios", "sec:web"], cased));
    check(
      "two runs that would share one part id (surfaces differing only by case) refuse, naming both tokens",
      message !== undefined && message.includes('"SEC:Web"') && message.includes('"sec:web"') && message.includes("sec-web"),
      message,
    );
    const { runs } = parseRun(["SEC:Web", "AGT:web"], cased);
    check("the same surface casing under two domains is two parts", runs.length === 2);
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

  {
    const message = throws(() => planId({ now: NOW, known: [], runs: [] }));
    check("planId with no runs throws", message !== undefined && message.includes("run"), message);
  }
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
  // The plan is made on 2026-11-28. Every generated id is dated on or before
  // that day and numbered below 90, so a plan always fits; half of them are
  // plan ids or parts of that same day, which is where the NN counter, not the
  // date, decides whether a part sorts last.
  const DAY = "2026-11-zplan-28";
  const sameDay = () => {
    const plan = `${DAY}${two(random(90))}`;
    return random(2) === 0 ? plan : `${plan}-${pick(domains).toLowerCase()}-${pick(surfaces)}`;
  };
  const earlier = () => {
    const month = `2026-${two(1 + random(11))}`;
    const plan = `${month}-zplan-${two(1 + random(27))}${two(random(90))}`;
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
  const existing = () => (random(2) === 0 ? sameDay() : earlier());
  const now = new Date(2026, 10, 28, 8);
  // The two rules, restated independently of planId: (a) the candidate is
  // neither a known id nor the plan of one, (b) every part it would get sorts
  // after every known id.
  const fits = (candidate, known, runs) =>
    !known.some((id) => id === candidate || id.startsWith(`${candidate}-`)) &&
    runs.every((run) => known.every((id) => planPartId(candidate, run.domain, run.surface) > id));
  const violations = [];
  const notMinimal = [];
  let sameDayDecided = 0;
  for (let trial = 0; trial < 500; trial++) {
    const known = Array.from({ length: 1 + random(12) }, existing);
    const runs = Array.from({ length: 1 + random(3) }, () => ({ domain: pick(domains), surface: pick(surfaces) }));
    const id = planId({ now, known, runs });
    const parts = runs.map((run) => planPartId(id, run.domain, run.surface));
    const late = parts.filter((part) => known.some((other) => !(part > other)));
    if (late.length > 0 || known.includes(id) || !parts.every((part) => isPlanPartId(part) && !isScopedAuditId(part))) violations.push(JSON.stringify({ known, runs, id }));
    const nn = Number(id.slice(DAY.length));
    if (!id.startsWith(DAY) || !fits(id, known, runs)) violations.push(JSON.stringify({ known, runs, id }));
    for (let smaller = 0; smaller < nn; smaller++) {
      if (fits(`${DAY}${two(smaller)}`, known, runs)) {
        notMinimal.push(JSON.stringify({ known, runs, id, smaller }));
        break;
      }
    }
    if (nn > 0) sameDayDecided++;
  }
  check("500 generated histories: every new part id sorts after every existing id", violations.length === 0, violations.slice(0, 3).join(" | "));
  check("500 generated histories: the NN chosen is the smallest that satisfies both rules", notMinimal.length === 0, notMinimal.slice(0, 3).join(" | "));
  check("the generated histories exercise the day counter (most choose an NN above 00)", sameDayDecided > 250, String(sameDayDecided));

  // Histories no plan made that day can sort after: a later month, or a
  // same-month id that sorts after "z".
  const poisons = () => {
    switch (random(4)) {
      case 0:
        return "2026-12";
      case 1:
        return `2027-${two(1 + random(12))}-${pick(domains).toLowerCase()}-${pick(surfaces)}`;
      case 2:
        return "2026-11-zz-web";
      default:
        return `2026-11-zzz${pick(surfaces)}`;
    }
  };
  const noThrow = [];
  for (let trial = 0; trial < 100; trial++) {
    const poison = poisons();
    const known = [...Array.from({ length: random(8) }, existing), poison];
    for (let i = known.length - 1; i > 0; i--) {
      const j = random(i + 1);
      [known[i], known[j]] = [known[j], known[i]];
    }
    const runs = Array.from({ length: 1 + random(3) }, () => ({ domain: pick(domains), surface: pick(surfaces) }));
    const greatest = [...known].sort().at(-1);
    const message = throws(() => planId({ now, known, runs }));
    const anyFits = Array.from({ length: 100 }, (_, n) => `${DAY}${two(n)}`).some((candidate) => fits(candidate, known, runs));
    if (message !== `no plan id on 2026-11-28 sorts after "${greatest}"` || anyFits) noThrow.push(JSON.stringify({ known, runs, message }));
  }
  check("100 generated histories holding a later month or a same-month id after z: planId throws, naming the greatest id", noThrow.length === 0, noThrow.slice(0, 3).join(" | "));
}

// --- a part that no longer sorts last --------------------------------------------------

{
  const { outsortedBy } = S;
  const SEC = "2026-11-zplan-1100-sec-web";
  const AGT = "2026-11-zplan-1100-agt-ios";
  const TST = "2026-11-zplan-1100-tst-web";

  check("sibling parts are never returned", outsortedBy(AGT, [SEC, TST, "2026-11-zplan-1100"]).length === 0, JSON.stringify(outsortedBy(AGT, [SEC, TST])));
  {
    const known = [AGT, SEC, TST, `${SEC}-scoped`];
    check(
      "a scoped id named after a sibling part is returned for the parts that sort before it",
      JSON.stringify(outsortedBy(AGT, known)) === JSON.stringify([`${SEC}-scoped`]) &&
        JSON.stringify(outsortedBy(SEC, known)) === JSON.stringify([`${SEC}-scoped`]) &&
        outsortedBy(TST, known).length === 0,
      JSON.stringify([outsortedBy(AGT, known), outsortedBy(SEC, known), outsortedBy(TST, known)]),
    );
  }
  {
    const later = ["2026-11-zplan-1101-agt-ios", "2026-11-zplan-1101", "2026-11-zplan-1101-agt-ios"];
    check(
      "a later plan and its parts are returned, each once, sorted",
      JSON.stringify(outsortedBy(SEC, later)) === JSON.stringify(["2026-11-zplan-1101", "2026-11-zplan-1101-agt-ios"]),
      JSON.stringify(outsortedBy(SEC, later)),
    );
  }
  check(
    "an earlier audit is not returned",
    outsortedBy(SEC, ["2026-11", "2026-11-scoped", "2026-11-sec-web", "2026-10-zplan-3100-sec-web", "2026-11-zplan-1000-sec-web"]).length === 0,
  );
  check("a later month is returned", JSON.stringify(outsortedBy(SEC, ["2026-12", "2026-10"])) === JSON.stringify(["2026-12"]));
  check("an id that is not a plan part is never outsorted", outsortedBy("2026-11", ["2026-12"]).length === 0 && outsortedBy("2026-11-zplan-1100", ["2026-12"]).length === 0 && outsortedBy(`${SEC}-scoped`, ["2026-12"]).length === 0);
  {
    const known = Object.freeze(["2026-12", SEC]);
    outsortedBy(AGT, known);
    check("known is not mutated", JSON.stringify(known) === JSON.stringify(["2026-12", SEC]));
  }
}

// --- the recorded scope marker ------------------------------------------------------

{
  const { readPlanScope } = S;
  const coverage = { scored: 14, assessed: 152, applicable: 338, surfaces: { web: { assessed: 40, applicable: 71 } } };
  const full = {
    partial: true,
    cells: 14,
    since: "2026-10",
    plan: "2026-11-zplan-1100",
    parts: ["2026-11-zplan-1100-sec-web", "2026-11-zplan-1100-agt-ios"],
    scored: ["SEC-01::web", "AGT-08::ios"],
    coverage,
  };
  check(
    "a full marker reads back field for field",
    JSON.stringify(readPlanScope(full)) ===
      JSON.stringify({ plan: full.plan, parts: full.parts, scored: full.scored, cells: 14, since: "2026-10", coverage }),
    JSON.stringify(readPlanScope(full)),
  );
  check(
    "a first audit's marker has no since",
    readPlanScope({ ...full, since: undefined }).since === null && readPlanScope({ partial: true, plan: "2026-11-zplan-1100" }).since === null,
  );
  check(
    "a scoped re-audit's marker is not a plan",
    readPlanScope({ partial: true, cells: 12, since: "2026-10" }) === null && readPlanScope({ partial: true, plan: "" }) === null,
  );
  check("anything but an object is not a plan", [undefined, null, "2026-11-zplan-1100", 42, true].every((value) => readPlanScope(value) === null));
  {
    const reading = readPlanScope({ plan: "2026-11-zplan-1100", parts: ["a", 3, "", null, "b"], scored: "SEC-01::web", cells: -1 });
    check(
      "malformed fields are dropped or null, never thrown on",
      reading !== null && JSON.stringify(reading.parts) === '["a","b"]' && reading.scored.length === 0 && reading.cells === null && reading.coverage === null,
      JSON.stringify(reading),
    );
  }
  {
    const reading = readPlanScope({ plan: "p", coverage: { scored: 1, assessed: 2, applicable: 3, surfaces: { web: { assessed: 1, applicable: 2 }, ios: { assessed: "x" }, admin: null } } });
    check(
      "a coverage keeps its well-formed surfaces only",
      JSON.stringify(reading.coverage) === JSON.stringify({ scored: 1, assessed: 2, applicable: 3, surfaces: { web: { assessed: 1, applicable: 2 } } }),
      JSON.stringify(reading.coverage),
    );
  }
  {
    const scope = JSON.parse(
      '{"plan":"p","coverage":{"scored":1,"assessed":2,"applicable":3,"surfaces":{"__proto__":{"assessed":1,"applicable":2},"web":{"assessed":1,"applicable":2}}}}',
    );
    const surfaces = readPlanScope(scope).coverage.surfaces;
    check(
      "a __proto__ key in coverage.surfaces is skipped, never set as the prototype",
      Object.getPrototypeOf(surfaces) === Object.prototype && JSON.stringify(Object.keys(surfaces)) === '["web"]' && surfaces.assessed === undefined,
      JSON.stringify({ keys: Object.keys(surfaces), proto: Object.getPrototypeOf(surfaces) }),
    );
  }
  check("a coverage missing a count is null", readPlanScope({ plan: "p", coverage: { scored: 1, assessed: 2 } }).coverage === null);
  {
    const input = JSON.parse(JSON.stringify(full));
    readPlanScope(input);
    check("nothing is mutated", JSON.stringify(input) === JSON.stringify(full));
  }
}

// --- the plan file schema -----------------------------------------------------------

{
  const { parseKritikPlan, KritikPlanSchema, KritikPlanPartSchema, KRITIK_PLAN_SCHEMA, PLAN_PLANS_DIR } = S;
  const part = (domain, surface, cells, steps) => ({
    domain,
    surface,
    auditId: `2026-11-zplan-1100-${domain.toLowerCase()}-${surface}`,
    cells: cells.map((criterion_id) => ({ criterion_id, surface })),
    steps,
    estimate: null,
    status: "included",
    prompt: `Run part ${domain}:${surface} of Kritik plan 2026-11-zplan-1100.`,
  });
  const PLAN = {
    schema: "arkaik.kritik.plan/1",
    planId: "2026-11-zplan-1100",
    createdAt: "2026-11-11T09:30:00.000Z",
    commit: "3f9c2e1",
    frameworkVersion: "0.1.0",
    tier: null,
    budgetTokens: null,
    budgetUsd: null,
    pricePerMTok: null,
    parts: [part("SEC", "web", ["SEC-01", "SEC-04"], 12), part("AGT", "ios", ["AGT-01"], 5)],
    totals: { cells: 3, steps: 17, applicableCells: 338, tokens: null, usd: null },
    prompt: "Run Kritik plan 2026-11-zplan-1100.",
    recordCommand: "arkaik kritik matrix 2026-11-zplan-1100 --record --plan",
  };
  const withPlan = (over) => ({ ...JSON.parse(JSON.stringify(PLAN)), ...over });

  check("the schema constants", KRITIK_PLAN_SCHEMA === "arkaik.kritik.plan/1" && PLAN_PLANS_DIR === "plans");
  {
    const result = parseKritikPlan(PLAN);
    check("a counts-only plan parses and round-trips unchanged", result.ok === true && JSON.stringify(result.plan) === JSON.stringify(PLAN), JSON.stringify(result));
    const again = parseKritikPlan(JSON.parse(JSON.stringify(result.plan)));
    check("its serialized form parses to the same plan", again.ok === true && JSON.stringify(again.plan) === JSON.stringify(PLAN));
  }
  {
    const band = { low: 1, mid: 2, high: 3 };
    const estimated = withPlan({
      budgetTokens: 400000,
      budgetUsd: 5,
      pricePerMTok: 3,
      tier: "opus",
      parts: [
        { ...part("SEC", "web", ["SEC-01"], 6), estimate: { tokens: band, usd: band, inputs: { P: 1, B: 2, c: band, q: band, h: band, V: band }, calibrated: false } },
        { ...part("AGT", "ios", ["AGT-01"], 5), status: "deferred" },
      ],
      totals: { cells: 1, steps: 6, applicableCells: 338, tokens: band, usd: band },
    });
    const result = parseKritikPlan(estimated);
    check("a plan with an estimate, budgets and a deferred part parses", result.ok === true && JSON.stringify(result.plan) === JSON.stringify(estimated), JSON.stringify(result));
  }
  {
    const result = parseKritikPlan(withPlan({ schema: "arkaik.kritik.plan/2" }));
    check("an unknown schema version is rejected at schema", result.ok === false && result.issue.startsWith("schema: "), JSON.stringify(result));
  }
  {
    const result = parseKritikPlan(withPlan({ extra: 1, parts: [{ ...part("SEC", "web", ["SEC-01"], 6), note: "x" }] }));
    check("unknown keys are stripped, not kept", result.ok === true && !("extra" in result.plan) && !("note" in result.plan.parts[0]), JSON.stringify(result));
  }
  const rejects = (name, value, at) => {
    const result = parseKritikPlan(value);
    check(name, result.ok === false && result.issue.startsWith(`${at}: `), JSON.stringify(result));
  };
  rejects("a plan with no parts is rejected", withPlan({ parts: [] }), "parts");
  rejects("a part with no cells is rejected", withPlan({ parts: [part("SEC", "web", [], 0)] }), "parts.0.cells");
  rejects("a lower-case part domain is rejected", withPlan({ parts: [part("sec", "web", ["SEC-01"], 6)] }), "parts.0.domain");
  rejects("a six-letter part domain is rejected", withPlan({ parts: [part("SECURE", "web", ["SEC-01"], 6)] }), "parts.0.domain");
  rejects("an empty part surface is rejected", withPlan({ parts: [part("SEC", "", ["SEC-01"], 6)] }), "parts.0.surface");
  rejects("a fractional step count is rejected", withPlan({ parts: [part("SEC", "web", ["SEC-01"], 1.5)] }), "parts.0.steps");
  rejects("an unknown part status is rejected", withPlan({ parts: [{ ...part("SEC", "web", ["SEC-01"], 6), status: "skipped" }] }), "parts.0.status");
  rejects("a createdAt that is not an ISO datetime is rejected", withPlan({ createdAt: "11 Nov 2026" }), "createdAt");
  rejects("a zero token budget is rejected", withPlan({ budgetTokens: 0 }), "budgetTokens");
  rejects("a dollar budget with no price is rejected", withPlan({ budgetUsd: 5 }), "pricePerMTok");
  rejects("a missing recordCommand is rejected", withPlan({ recordCommand: undefined }), "recordCommand");
  // The ids must fit together: the plan id, each part's audit id, each cell's surface.
  {
    const result = parseKritikPlan(withPlan({}));
    check("a plan whose ids fit together still parses", result.ok === true, JSON.stringify(result));
  }
  rejects("a planId that is not a plan id is rejected", withPlan({ planId: "2026-11" }), "planId");
  rejects(
    "a part whose auditId is not planPartId(planId, domain, surface) is rejected",
    withPlan({ parts: [part("SEC", "web", ["SEC-01"], 6), { ...part("AGT", "ios", ["AGT-01"], 5), auditId: "2026-11-zplan-1100-agt-web" }] }),
    "parts.1.auditId",
  );
  rejects(
    "a part of another plan is rejected",
    withPlan({ parts: [{ ...part("SEC", "web", ["SEC-01"], 6), auditId: "2026-11-zplan-1101-sec-web" }] }),
    "parts.0.auditId",
  );
  rejects(
    "a part whose surface planPartId refuses is a mismatch, not a throw",
    withPlan({ parts: [part("SEC", "scoped", ["SEC-01"], 6)] }),
    "parts.0.auditId",
  );
  rejects(
    "two parts with the same auditId are rejected",
    withPlan({ parts: [part("SEC", "web", ["SEC-01"], 6), part("SEC", "web", ["SEC-04"], 6)] }),
    "parts.1.auditId",
  );
  rejects(
    "a cell whose surface is not its part's is rejected",
    withPlan({ parts: [{ ...part("SEC", "web", ["SEC-01", "SEC-04"], 12), cells: [{ criterion_id: "SEC-01", surface: "web" }, { criterion_id: "SEC-04", surface: "ios" }] }] }),
    "parts.0.cells.1.surface",
  );
  {
    const result = parseKritikPlan(withPlan({ parts: [part("SEC", "web", ["SEC-01"], 6), { ...part("AGT", "ios", ["AGT-01"], 5), auditId: "2026-11-zplan-1100-agt-web" }] }));
    check("an auditId mismatch names the id it expected", result.ok === false && result.issue.includes('"2026-11-zplan-1100-agt-ios"'), JSON.stringify(result));
  }
  {
    const result = parseKritikPlan([PLAN]);
    check("a value that is not an object reports at (root)", result.ok === false && result.issue.startsWith("(root): "), JSON.stringify(result));
  }
  check(
    "the exported schemas are the ones parseKritikPlan uses",
    KritikPlanSchema.safeParse(PLAN).success === true && KritikPlanPartSchema.safeParse(PLAN.parts[0]).success === true && KritikPlanPartSchema.safeParse({}).success === false,
  );
}

// --- part 2: buildKritikPlan and planPartStatuses ----------------------------------
//
// Against the shipped pack, as the cells block above is: the plan a CLI run
// would build for SEC:web + AGT:ios on a Pebbles-like profile, and the
// progress a status read derives from each part's scores.
{
  const P2 = require("./load-schema").loadSchema();
  const PACK = require("../../packages/kritik-library/framework.json");
  const SURFACES = ["web", "ios", "android", "admin", "supabase"];
  const NOW = new Date(2026, 10, 11, 9, 30); // local time, as planId reads it: day 11
  const COMMIT = "3f9c2e1d4b5a69788796a5b4c3d2e1f0a9b8c7d6";
  const KNOWN = ["2026-08", "2026-11-scoped", "2026-11-sec-web"];
  const RUNS = [{ domain: "SEC", surface: "web" }, { domain: "AGT", surface: "ios" }];

  const plan = P2.buildKritikPlan({ library: PACK, surfaces: SURFACES, runs: RUNS, known: KNOWN, now: NOW, commit: COMMIT });

  check("buildKritikPlan: the plan id is the day's first that sorts last", plan.planId === "2026-11-zplan-1100", plan.planId);
  check(
    "buildKritikPlan: one included part per run, in run order, each with its own audit id",
    JSON.stringify(plan.parts.map((part) => [part.domain, part.surface, part.auditId, part.status])) ===
      JSON.stringify([
        ["SEC", "web", "2026-11-zplan-1100-sec-web", "included"],
        ["AGT", "ios", "2026-11-zplan-1100-agt-ios", "included"],
      ]),
    JSON.stringify(plan.parts.map((part) => part.auditId)),
  );
  check(
    "buildKritikPlan: SEC:web is 6 cells and 36 steps, AGT:ios 8 and 42",
    plan.parts[0].cells.length === 6 && plan.parts[0].steps === 36 && plan.parts[1].cells.length === 8 && plan.parts[1].steps === 42,
    JSON.stringify(plan.parts.map((part) => [part.cells.length, part.steps])),
  );
  check(
    "buildKritikPlan: the cells are planCells' cells",
    JSON.stringify(plan.parts.map((part) => part.cells)) ===
      JSON.stringify(RUNS.map((run) => P2.planCells(PACK, SURFACES, run).cells)),
  );
  check("buildKritikPlan: counts only — no estimate on any part", plan.parts.every((part) => part.estimate === null));
  check(
    "buildKritikPlan: totals sum the included parts and count the whole product",
    JSON.stringify(plan.totals) === JSON.stringify({ cells: 14, steps: 78, applicableCells: 338, tokens: null, usd: null }),
    JSON.stringify(plan.totals),
  );
  check(
    "buildKritikPlan: the header is the schema, the clock, the commit and the library's version",
    plan.schema === "arkaik.kritik.plan/1" &&
      plan.createdAt === NOW.toISOString() &&
      plan.commit === COMMIT &&
      plan.frameworkVersion === PACK.version &&
      plan.tier === null && plan.budgetTokens === null && plan.budgetUsd === null && plan.pricePerMTok === null,
  );
  check("buildKritikPlan: the record command names the plan", plan.recordCommand === "arkaik kritik matrix 2026-11-zplan-1100 --record --plan");
  check(
    "buildKritikPlan: each part carries the part prompt rendered from it",
    plan.parts.every(({ prompt, ...part }) => prompt === P2.renderPartPrompt({ planId: plan.planId, commit: COMMIT }, part)),
  );
  check(
    "buildKritikPlan: the plan carries the combined prompt",
    plan.prompt === P2.renderPlanPrompt({ ...plan, parts: plan.parts.map(({ prompt: _prompt, ...part }) => part) }),
  );
  check(
    "buildKritikPlan: every part id sorts after every known id",
    plan.parts.every((part) => KNOWN.every((id) => part.auditId > id)),
  );
  const parsed = P2.parseKritikPlan(JSON.parse(JSON.stringify(plan)));
  check("buildKritikPlan: the plan parses as written to disk", parsed.ok === true, parsed.ok ? "" : parsed.issue);
  check(
    "buildKritikPlan: a plan id already taken moves the counter",
    P2.buildKritikPlan({ library: PACK, surfaces: SURFACES, runs: RUNS, known: [...KNOWN, ...plan.parts.map((part) => part.auditId)], now: NOW, commit: null }).planId ===
      "2026-11-zplan-1101",
  );

  let zero;
  try {
    P2.buildKritikPlan({ library: PACK, surfaces: [...SURFACES, "cli"], runs: [{ domain: "SEC", surface: "cli" }], known: [], now: NOW, commit: null });
  } catch (error) {
    zero = error;
  }
  check(
    "buildKritikPlan: a part with no applicable cell is refused, naming the domain and the surface",
    zero instanceof Error && zero.message.includes('no SEC criterion applies to "cli"'),
    zero?.message,
  );

  // --- planPartStatuses ---

  const DEFERRED = {
    domain: "A11Y", surface: "android", auditId: "2026-11-zplan-1100-a11y-android",
    cells: [{ criterion_id: "A11Y-01", surface: "android" }], steps: 5, estimate: null, status: "deferred", prompt: "",
  };
  const parts = [...plan.parts, DEFERRED];
  const [sec, agt] = plan.parts;
  const score = (criterion_id, surface) => ({ criterion_id, surface });

  const fresh = P2.planPartStatuses({ parts }, {});
  check(
    "planPartStatuses: with no scores every included part is not started and misses every cell",
    JSON.stringify(fresh.map((status) => [status.auditId, status.progress, status.scored, status.cells, status.missing.length, status.stray.length])) ===
      JSON.stringify([
        [sec.auditId, "not started", 0, 6, 6, 0],
        [agt.auditId, "not started", 0, 8, 8, 0],
        [DEFERRED.auditId, "deferred", 0, 1, 1, 0],
      ]),
    JSON.stringify(fresh),
  );

  const mixed = P2.planPartStatuses(
    { parts },
    {
      [sec.auditId]: [score("SEC-01", "web"), score("PRV-01", "web"), score("SEC-05", "web"), score("PRV-01", "web")],
      [agt.auditId]: agt.cells.map((cell) => score(cell.criterion_id, cell.surface)),
      "2026-08": [score("SEC-04", "web")],
    },
  );
  check(
    "planPartStatuses: some plan cells scored is in progress, missing the rest in plan order",
    mixed[0].progress === "in progress" &&
      mixed[0].scored === 2 &&
      JSON.stringify(mixed[0].missing.map((cell) => cell.criterion_id)) === JSON.stringify(["SEC-04", "SEC-06", "SEC-07", "SEC-08"]),
    JSON.stringify(mixed[0]),
  );
  check(
    "planPartStatuses: a score outside the plan is a stray, listed once",
    JSON.stringify(mixed[0].stray) === JSON.stringify([{ criterion_id: "PRV-01", surface: "web" }]),
    JSON.stringify(mixed[0].stray),
  );
  check(
    "planPartStatuses: every plan cell scored is scored",
    mixed[1].progress === "scored" && mixed[1].scored === 8 && mixed[1].missing.length === 0,
    JSON.stringify(mixed[1]),
  );
  check("planPartStatuses: another audit's scores never count for a part", mixed[0].missing.some((cell) => cell.criterion_id === "SEC-04"));

  const strayOnly = P2.planPartStatuses({ parts: [sec] }, { [sec.auditId]: [score("PRV-01", "web")] });
  check(
    "planPartStatuses: a stray alone means the part was started",
    strayOnly[0].progress === "in progress" && strayOnly[0].scored === 0 && strayOnly[0].stray.length === 1,
    JSON.stringify(strayOnly[0]),
  );
}

// --- summary ------------------------------------------------------------------------

console.log(failures === 0 ? "\nAll quality-plan checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
