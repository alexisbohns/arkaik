#!/usr/bin/env node

/**
 * Exercises the v2 additive format fields (docs/spec/bundle-format.md
 * § Project Additions, § References): project.version, metadata.refs, and the
 * validator's ref rules. Covers the acceptance criteria for issue #202:
 *  - project.version is accepted (free-form string)
 *  - refs with a mix of known and unknown `type` values validate, and the
 *    unknown type survives a parseBundle round-trip (never rejected/stripped)
 *  - external_status / status_mapped are advisory: they never mutate node.status
 *  - validator flags duplicate ref id, missing url, and invalid status_mapped
 */

const fs = require("fs");
const path = require("path");

const { loadSchema, BUILD_DIR } = require("./load-schema");

function makeBundle(refs, extraProject = {}) {
  return {
    project: {
      id: "test-project",
      title: "Test Project",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...extraProject,
    },
    nodes: [
      {
        id: "V-home",
        project_id: "test-project",
        species: "view",
        title: "Home",
        status: "idea",
        platforms: ["web"],
        metadata: { refs },
      },
    ],
    edges: [],
  };
}

function main() {
  const { validateBundle, parseBundle } = loadSchema();
  let failures = 0;
  const assert = (cond, message) => {
    if (!cond) {
      failures++;
      console.log(`FAIL: ${message}`);
    } else {
      console.log(`PASS: ${message}`);
    }
  };

  // project.version — free-form label, accepted.
  const versioned = validateBundle(makeBundle([], { version: "2026-07" }));
  assert(versioned.valid, "project.version: free-form label is valid");
  const parsedVersion = parseBundle(makeBundle([], { version: "1.4.0" }));
  assert(
    parsedVersion.success && parsedVersion.data.project.version === "1.4.0",
    "project.version: survives parseBundle",
  );

  // Mixed known + unknown ref types validate; node.status is untouched.
  const mixed = makeBundle([
    {
      id: "gh-142",
      type: "github-issue",
      url: "https://github.com/acme/app/issues/142",
      external_status: "open",
      status_mapped: "development",
      platform: "web",
      synced_at: "2026-01-01T00:00:00.000Z",
    },
    { id: "notion-brief", type: "notion-page", url: "https://notion.so/acme/home-brief" },
  ]);
  const mixedResult = validateBundle(mixed);
  assert(mixedResult.valid, "refs: mixed known + unknown type validates");

  // Unknown ref type is preserved through a parseBundle round-trip.
  const parsedMixed = parseBundle(mixed);
  assert(parsedMixed.success, "refs: parseBundle accepts unknown ref type");
  assert(
    parsedMixed.success && parsedMixed.data.nodes[0].metadata.refs[1].type === "notion-page",
    "refs: unknown ref type value is preserved (not stripped)",
  );

  // status_mapped is advisory — it must never overwrite node.status.
  assert(
    parsedMixed.success && parsedMixed.data.nodes[0].status === "idea",
    "refs: status_mapped does not mutate node.status",
  );

  // Duplicate ref id within a node is an error.
  const dup = validateBundle(
    makeBundle([
      { id: "gh-142", type: "github-issue", url: "https://github.com/acme/app/issues/142" },
      { id: "gh-142", type: "github-pr", url: "https://github.com/acme/app/pull/143" },
    ]),
  );
  assert(!dup.valid, "refs: duplicate ref id is invalid");
  assert(
    dup.errors.some((e) => e.rule === "duplicate-ref-id"),
    "refs: duplicate ref id emits duplicate-ref-id",
  );

  // Missing / empty url is an error.
  const noUrl = validateBundle(makeBundle([{ id: "gh-1", type: "github-issue", url: "" }]));
  assert(
    !noUrl.valid && noUrl.errors.some((e) => e.rule === "ref-url-required"),
    "refs: empty url emits ref-url-required",
  );

  // status_mapped outside StatusId is an error.
  const badStatus = validateBundle(
    makeBundle([{ id: "gh-1", type: "github-issue", url: "https://x", status_mapped: "shipping" }]),
  );
  assert(
    !badStatus.valid && badStatus.errors.some((e) => e.rule === "valid-status"),
    "refs: invalid status_mapped emits valid-status",
  );

  // A valid status_mapped inside StatusId does not error.
  const goodStatus = validateBundle(
    makeBundle([{ id: "gh-1", type: "github-issue", url: "https://x", status_mapped: "live" }]),
  );
  assert(goodStatus.valid, "refs: valid status_mapped is accepted");

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} refs test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll refs tests passed.");
}

main();
