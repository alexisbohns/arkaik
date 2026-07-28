#!/usr/bin/env node

/**
 * `arkaik --version` must print the version the package ships as.
 *
 * The CLI could not report its version at all until now, which is the same
 * problem its sibling had in a louder form: `arkaik-mcp@0.2.0` shipped
 * announcing "0.1.0" from a hardcoded constant nobody bumped, so anyone asking
 * "does my install have hosted mode?" got the pre-hosted answer. The CLI simply
 * had no way to ask — and `npx` resolves a version you never chose, so "which
 * build am I running?" has to be answerable.
 *
 * build.js substitutes the value from package.json, so drift needs someone to
 * reintroduce a literal. This test reads the BUILT binary rather than the
 * source, so it fails on exactly what a user would see.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(ROOT, "packages", "cli", "dist", "index.js");
const PKG = path.join(ROOT, "packages", "cli", "package.json");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function main() {
  if (!fs.existsSync(BIN)) {
    console.error(`Built CLI not found at ${BIN}. Run: npm run build -w arkaik`);
    process.exitCode = 1;
    return;
  }

  const declared = JSON.parse(fs.readFileSync(PKG, "utf8")).version;
  check(
    "precondition: package.json declares a version",
    typeof declared === "string" && declared.length > 0,
    JSON.stringify(declared),
  );

  for (const flag of ["--version", "-v", "version"]) {
    let printed;
    try {
      printed = execFileSync(process.execPath, [BIN, flag], { encoding: "utf8" }).trim();
    } catch (err) {
      // An exit code here means the flag is not recognised at all, which is the
      // state this test exists to prevent. Reported as the failure it is rather
      // than thrown, so the other spellings still get checked.
      check(`\`arkaik ${flag}\` exits cleanly`, false, String(err.status ?? err.message));
      continue;
    }
    check(`\`arkaik ${flag}\` prints the version this package ships as`, printed === declared, `printed ${JSON.stringify(printed)} vs package.json ${JSON.stringify(declared)}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} version check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll CLI version checks passed.");
}

main();
