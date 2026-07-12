#!/usr/bin/env node

/**
 * Unit tests for the provider-injection seam (lib/data/provider-registry.ts,
 * issue #243) — the exact prerequisite `docs/spec/services.md` § Synk "Client
 * sync engine" and `docs/rfcs/arkaik-dev.md` (Option B.1) both call for.
 *
 * Covers the acceptance list:
 *  - getProvider() defaults to the local provider singleton;
 *  - setProvider() swaps the active provider, and getProvider() reflects it
 *    immediately (module-level injection point, not a cached snapshot).
 */

const fs = require("fs");
const { loadProviderRegistry, BUILD_DIR } = require("./load-provider-registry");

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
  const { getProvider, setProvider, defaultProviderMarker } = loadProviderRegistry();

  check(
    "getProvider() defaults to the local provider singleton",
    getProvider() === defaultProviderMarker,
    JSON.stringify(getProvider()),
  );

  const customProvider = { __marker: "custom-provider" };
  setProvider(customProvider);
  check("setProvider() swaps the active provider", getProvider() === customProvider);
  check(
    "getProvider() keeps returning the swapped provider on repeated calls",
    getProvider() === customProvider,
  );

  // Restore the default so this module's global state doesn't leak into any
  // other test sharing the same process (each test file here runs standalone
  // via `node`, but this keeps the file correct if that ever changes).
  setProvider(defaultProviderMarker);
  check("setProvider() can restore the default provider", getProvider() === defaultProviderMarker);

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} provider-registry test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll provider-registry tests passed.");
}

main();
