#!/usr/bin/env node

/**
 * Exercises validateBundle()'s data-URI size-bomb warning for
 * metadata.platformScreenshots (docs/spec/bundle-format.md § Asset Values).
 * The oversized data URI is generated in memory rather than committed as a
 * fixture — a multi-megabyte JSON file has no business living in git.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadSchema, BUILD_DIR } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");
const STANDALONE = path.join(ROOT, "docs", "arkaik-skill", "scripts", "validate-bundle.js");
const RULE = "screenshot-data-uri-size";

function makeBundle(screenshotDataUri) {
  return {
    project: {
      id: "test-project",
      title: "Test Project",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [
      {
        id: "V-home",
        project_id: "test-project",
        species: "view",
        title: "Home",
        status: "idea",
        platforms: ["web"],
        metadata: { platformScreenshots: { web: screenshotDataUri } },
      },
    ],
    edges: [],
  };
}

function dataUriOfSize(decodedBytes) {
  return "data:image/png;base64," + Buffer.alloc(decodedBytes, 65).toString("base64");
}

function main() {
  const { validateBundle } = loadSchema();
  let failures = 0;
  const assert = (cond, message) => {
    if (!cond) {
      failures++;
      console.log(`FAIL: ${message}`);
    } else {
      console.log(`PASS: ${message}`);
    }
  };

  // Small screenshot (well under the 2MB guidance) — no warning.
  const small = validateBundle(makeBundle(dataUriOfSize(1024)));
  assert(small.valid, "small data-URI screenshot: valid");
  assert(
    !small.warnings.some((w) => w.rule === RULE),
    "small data-URI screenshot: no size warning",
  );

  // Oversized screenshot — warns, but stays valid (never an error).
  const oversizedBundle = makeBundle(dataUriOfSize(2.2 * 1024 * 1024));
  const oversized = validateBundle(oversizedBundle);
  assert(oversized.valid, "oversized data-URI screenshot: still valid");
  assert(
    oversized.warnings.filter((w) => w.rule === RULE).length === 1,
    "oversized data-URI screenshot: exactly one size warning",
  );

  // Non-data-URI values (relative path, hosted URL) never warn.
  const pathBundle = validateBundle(makeBundle("assets/web/home.png"));
  assert(
    !pathBundle.warnings.some((w) => w.rule === RULE),
    "relative-path screenshot: no size warning",
  );
  const urlBundle = validateBundle(makeBundle("https://cdn.example.com/home.png"));
  assert(
    !urlBundle.warnings.some((w) => w.rule === RULE),
    "hosted-URL screenshot: no size warning",
  );

  // The standalone (esbuild-bundled) validator artifact must agree end-to-end.
  const tmpFile = path.join(os.tmpdir(), `arkaik-oversized-screenshot-${process.pid}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(oversizedBundle));
  try {
    const result = spawnSync(process.execPath, [STANDALONE, tmpFile], { encoding: "utf8" });
    assert(result.status === 0, "standalone validator: exits 0 (valid) on oversized screenshot");
    assert(
      /WARN:.*platformScreenshots/.test(result.stdout || ""),
      "standalone validator: reports the platformScreenshots warning",
    );
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} screenshot-size test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll screenshot-size tests passed.");
}

main();
