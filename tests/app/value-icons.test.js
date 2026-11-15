const { loadValueIcons, BUILD_DIR } = require("./load-value-icons");
const { BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");
const fs = require("fs");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { valueIcons, values } = loadValueIcons();
const { VALUE_ICON_COMPONENTS } = valueIcons;
const { VALUES } = values;

check("exactly 30 icon components", Object.keys(VALUE_ICON_COMPONENTS).length === 30, String(Object.keys(VALUE_ICON_COMPONENTS).length));
check("every value id resolves to a component",
  VALUES.every((v) => { const c = VALUE_ICON_COMPONENTS[v.id]; return typeof c === "function" || typeof c === "object"; }),
  VALUES.filter((v) => !VALUE_ICON_COMPONENTS[v.id]).map((v) => v.id).join(", "));
check("resolved component matches the values.ts icon name (no drift)",
  VALUES.every((v) => { const c = VALUE_ICON_COMPONENTS[v.id]; return c && c.displayName === v.icon; }),
  VALUES.filter((v) => VALUE_ICON_COMPONENTS[v.id]?.displayName !== v.icon).map((v) => v.id).join(", "));

// The weighing library (packages/schema/src/weighing-library.ts) carries its own copy of the
// element labels and definitions, because the MCP server and the CLI cannot import lib/.
// This is the pin that keeps the two copies one.
const { VALUE_CONTRIBUTION_SET } = require(require("path").join(SCHEMA_BUILD_DIR, "index.js"));
check("the weighing library's element names match lib/config/values.ts labels (no drift)",
  VALUES.every((v) => VALUE_CONTRIBUTION_SET.criteria.find((c) => c.id === v.id)?.name === v.label),
  VALUES.filter((v) => VALUE_CONTRIBUTION_SET.criteria.find((c) => c.id === v.id)?.name !== v.label).map((v) => v.id).join(", "));
check("the weighing library's element definitions match lib/config/values.ts descriptions (no drift)",
  VALUES.every((v) => VALUE_CONTRIBUTION_SET.criteria.find((c) => c.id === v.id)?.definition === v.description),
  VALUES.filter((v) => VALUE_CONTRIBUTION_SET.criteria.find((c) => c.id === v.id)?.definition !== v.description).map((v) => v.id).join(", "));

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) { console.log(`\n${failures} value-icon test(s) failed.`); process.exit(1); }
console.log("\nAll value-icon tests passed.");
