#!/usr/bin/env node

// Conformance: the vendored validator must judge ariko's fixtures identically.
// A drift here means re-vendor lib/pollen/* from ariko, not patch locally.
const fs = require("fs");
const path = require("path");
const { loadPollen } = require("./load-pollen");

const { contract } = loadPollen();
const { validatePollen, validateIntent, validateFeed } = contract;
const FIXTURES = path.join(__dirname, "..", "fixtures", "pollen");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

for (const file of fs.readdirSync(path.join(FIXTURES, "valid"))) {
  const full = path.join(FIXTURES, "valid", file);
  if (file.endsWith(".ndjson")) {
    const results = validateFeed(fs.readFileSync(full, "utf8"));
    check(`valid/${file} feed clean`, results.every((r) => r.result.ok));
    continue;
  }
  const value = JSON.parse(fs.readFileSync(full, "utf8"));
  const result = file.startsWith("intent-") ? validateIntent(value) : validatePollen(value);
  check(`valid/${file} passes`, result.ok, result.ok ? "" : result.error);
  if (file === "noncore-kind.json") {
    check("noncore-kind has exactly one warning", result.ok && result.warnings.length === 1);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, "invalid", "manifest.json"), "utf8"));
for (const { file, error } of manifest) {
  const value = JSON.parse(fs.readFileSync(path.join(FIXTURES, "invalid", file), "utf8"));
  const result = validatePollen(value);
  check(`invalid/${file} fails with "${error}"`, !result.ok && result.error.includes(error), result.ok ? "passed" : result.error);
}

process.exit(failures ? 1 : 0);
