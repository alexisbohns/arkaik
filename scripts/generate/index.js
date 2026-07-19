#!/usr/bin/env node

/**
 * Regenerates every contract artifact derived from @arkaik/schema
 * (docs/spec/toolchain.md § @arkaik/schema). Run via `npm run generate`;
 * CI fails the build if this produces an uncommitted diff.
 */

const { execFileSync } = require("child_process");
const path = require("path");

const STEPS = [
  "generate-json-schema.js",
  "build-validator.js",
  "generate-schema-doc.js",
  "generate-prompt-fragments.js",
  // Icon-wobble filter registry (issue #271): scans lucide usage and emits
  // lib/wobble/wobble-registry.generated.ts + app/wobble.generated.css.
  "generate-icon-wobble.js",
  // Must run last: copies the just-regenerated validate-bundle.js and
  // schema.md into the plugin channel (docs/spec/toolchain.md § Skill
  // Distribution).
  "generate-plugin.js",
];

for (const step of STEPS) {
  execFileSync(process.execPath, [path.join(__dirname, step)], { stdio: "inherit" });
}
