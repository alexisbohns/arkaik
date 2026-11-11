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

// --- summary ------------------------------------------------------------------------

console.log(failures === 0 ? "\nAll quality-plan checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
