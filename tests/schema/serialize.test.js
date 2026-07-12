#!/usr/bin/env node

/**
 * Exercises the canonical bundle serializer `serializeBundle()`
 * (docs/spec/bundle-format.md § Canonical Serialization, issue #216).
 *
 * Covers:
 *  - formatting: LF newlines, 2-space indent, trailing newline;
 *  - top-level key order (schema_version, project, nodes, edges, journal) with
 *    unknown top-level keys kept after these, codepoint-sorted;
 *  - nodes/edges sorted by id via raw codepoint comparison (not localeCompare);
 *  - object field order from the schema, with unknown fields after the known
 *    ones, codepoint-sorted, and never stripped;
 *  - journal[] array order is preserved (not re-sorted by a bundle-level key);
 *  - idempotence: serialize(JSON.parse(serialize(x))) === serialize(x);
 *  - order-independence: shuffling nodes/edges yields identical output.
 */

const fs = require("fs");
const path = require("path");

const { loadSchema, BUILD_DIR } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");

function shuffleReverse(arr) {
  return arr.slice().reverse();
}

function shuffleRotate(arr) {
  if (arr.length < 2) return arr.slice();
  return [...arr.slice(1), arr[0]];
}

function main() {
  const { serializeBundle } = loadSchema();
  let failures = 0;
  const assert = (cond, message) => {
    if (!cond) {
      failures++;
      console.log(`FAIL: ${message}`);
    } else {
      console.log(`PASS: ${message}`);
    }
  };

  // --- Real seed: formatting + idempotence + order-independence ---------------
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8"));
  const seedOut = serializeBundle(seed);

  assert(seedOut.endsWith("\n"), "seed: output ends with a trailing newline");
  assert(!seedOut.includes("\r"), "seed: output uses LF line endings (no CR)");
  assert(/\n {2}"project":/.test(seedOut), "seed: 2-space indent at top level");

  // Idempotence — serializing already-canonical JSON is a fixed point.
  assert(
    serializeBundle(JSON.parse(seedOut)) === seedOut,
    "seed: idempotent (serialize(parse(serialize(x))) === serialize(x))",
  );

  // Order-independence — shuffling nodes/edges must not change the output.
  const shuffled = {
    ...seed,
    nodes: shuffleReverse(seed.nodes),
    edges: shuffleRotate(seed.edges),
  };
  assert(
    serializeBundle(shuffled) === seedOut,
    "seed: shuffling nodes/edges yields byte-identical output",
  );

  // nodes/edges are emitted sorted by id (codepoint ascending).
  const seedParsed = JSON.parse(seedOut);
  const nodeIds = seedParsed.nodes.map((n) => n.id);
  const edgeIds = seedParsed.edges.map((e) => e.id);
  const isCodepointSorted = (ids) => ids.every((id, i) => i === 0 || ids[i - 1] <= id);
  assert(isCodepointSorted(nodeIds), "seed: nodes sorted by id (codepoint ascending)");
  assert(isCodepointSorted(edgeIds), "seed: edges sorted by id (codepoint ascending)");

  // --- Inline bundle: raw codepoint order, unknown keys, journal order --------
  const inline = {
    // Deliberately out of canonical order to prove reordering.
    edges: [],
    zeta_extra: "z-top",
    project: {
      updated_at: "2026-01-02T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      title: "Inline",
      id: "inline",
      forward_compat: "kept",
    },
    schema_version: 2,
    alpha_extra: { keep: true },
    nodes: [
      // 'a' (0x61) vs 'B' (0x42): codepoint puts uppercase B before lowercase a,
      // whereas a locale-aware compare would typically order 'a' first.
      {
        id: "N-a",
        project_id: "inline",
        species: "view",
        title: "lower a",
        status: "idea",
        platforms: ["web"],
        zzz_unknown: 1,
        aaa_unknown: 2,
      },
      {
        id: "N-B",
        project_id: "inline",
        species: "view",
        title: "upper B",
        status: "idea",
        platforms: ["web"],
      },
    ],
    journal: [
      { id: "01B", ts: "2026-01-02T00:00:00.000Z", type: "node.created" },
      { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created" },
    ],
  };

  const inlineOut = serializeBundle(inline);
  const inlineParsed = JSON.parse(inlineOut);

  // Top-level key order: known keys first (present ones), then unknown keys
  // codepoint-sorted (alpha_extra before zeta_extra).
  assert(
    JSON.stringify(Object.keys(inlineParsed)) ===
      JSON.stringify(["schema_version", "project", "nodes", "edges", "journal", "alpha_extra", "zeta_extra"]),
    "inline: top-level key order (schema keys, then unknown codepoint-sorted)",
  );
  assert(
    inlineParsed.zeta_extra === "z-top" && inlineParsed.alpha_extra.keep === true,
    "inline: unknown top-level keys preserved (values intact)",
  );

  // Project key order: known schema order, unknown 'forward_compat' after them.
  assert(
    JSON.stringify(Object.keys(inlineParsed.project)) ===
      JSON.stringify(["id", "title", "created_at", "updated_at", "forward_compat"]),
    "inline: project keys in schema order, unknown key after and preserved",
  );

  // Nodes sorted by id via codepoint: 'N-B' before 'N-a'.
  assert(
    JSON.stringify(inlineParsed.nodes.map((n) => n.id)) === JSON.stringify(["N-B", "N-a"]),
    "inline: nodes sorted by raw codepoint (N-B before N-a), not localeCompare",
  );

  // Node field order: known schema fields first, then unknown fields
  // codepoint-sorted (aaa_unknown before zzz_unknown), both preserved.
  const nodeA = inlineParsed.nodes.find((n) => n.id === "N-a");
  assert(
    JSON.stringify(Object.keys(nodeA)) ===
      JSON.stringify([
        "id",
        "project_id",
        "species",
        "title",
        "status",
        "platforms",
        "aaa_unknown",
        "zzz_unknown",
      ]),
    "inline: node keys in schema order, unknown fields after and codepoint-sorted",
  );
  assert(
    nodeA.aaa_unknown === 2 && nodeA.zzz_unknown === 1,
    "inline: unknown node fields preserved (not stripped)",
  );

  // journal[] keeps its original array order (NOT re-sorted by a bundle key).
  assert(
    JSON.stringify(inlineParsed.journal.map((j) => j.id)) === JSON.stringify(["01B", "01A"]),
    "inline: journal array order preserved (not re-sorted)",
  );

  // Idempotence + order-independence on the inline bundle too.
  assert(serializeBundle(JSON.parse(inlineOut)) === inlineOut, "inline: idempotent");
  assert(
    serializeBundle({ ...inline, nodes: shuffleReverse(inline.nodes) }) === inlineOut,
    "inline: shuffling nodes yields identical output",
  );

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} serialize test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll serialize tests passed.");
}

main();
