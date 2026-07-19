const { loadValueIcons, BUILD_DIR } = require("./load-value-icons");
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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) { console.log(`\n${failures} value-icon test(s) failed.`); process.exit(1); }
console.log("\nAll value-icon tests passed.");
