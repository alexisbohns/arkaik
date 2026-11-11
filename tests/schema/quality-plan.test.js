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

// --- summary ------------------------------------------------------------------------

console.log(failures === 0 ? "\nAll quality-plan checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
