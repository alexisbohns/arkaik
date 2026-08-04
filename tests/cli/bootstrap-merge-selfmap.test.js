#!/usr/bin/env node

/**
 * Probe 6 of Task 6's review brief, verbatim: "Construct fragments from
 * seed/arkaik-self-map.json (e.g. split its nodes/edges across several
 * fragment files), merge them into an empty base, and confirm `arkaik
 * validate` passes on the result. Synthetic fixtures only ever cover the
 * shape their author imagined — that has been the root cause of nearly every
 * defect in this run."
 *
 * This is a separate file from bootstrap-merge.test.js on purpose (matching
 * the precedent bootstrap-slice.test.js and bootstrap-e2e.test.js set): a
 * real ~220-node, ~411-edge, ~84-acceptance graph needs a meaningfully
 * different fixture-building step (splitting real content into fragment
 * files) than the small synthetic fixtures the rest of that file uses.
 *
 * The split is deliberately not by species or by any convenient grouping:
 * nodes are round-robin'd across N fragment "areas" and edges are round-
 * robin'd across a DIFFERENT rotation, so most edges reference nodes created
 * by a fragment other than their own — exactly the cross-fragment edge
 * resolution `mergeFragments`'s two-pass design (all nodes, then all edges)
 * exists for, and exactly what a real multi-agent bootstrap run looks like.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const SEED_PATH = path.join(ROOT, "seed", "arkaik-self-map.json");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}
if (!existsSync(SEED_PATH)) {
  console.error(`Seed fixture not found at ${SEED_PATH}.`);
  process.exit(1);
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));
const N_FRAGMENTS = 5;

const dir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-selfmap-"));
try {
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  mkdirSync(path.join(dir, ".arkaik", "bootstrap", "fragments"), { recursive: true });

  // An "empty" base: zero nodes/edges, but a real project shell — carrying
  // over the seed's own product/map declarations (unaffected by merge; it
  // only ever touches nodes/edges/project.updated_at) so this run isn't
  // penalized with product-membership warnings that have nothing to do with
  // merge's own correctness. root_node_id is "V-projects" — a node this run
  // reintroduces under the same id, so it still resolves.
  const baseBundle = {
    schema_version: seed.schema_version ?? 3,
    project: {
      id: "self-map-probe",
      title: "Self-map probe (empty base)",
      root_node_id: seed.project.root_node_id,
      metadata: seed.project.metadata,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [],
    edges: [],
  };
  writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), JSON.stringify(baseBundle));

  // --- split nodes round-robin across N_FRAGMENTS ---
  const fragmentNodes = Array.from({ length: N_FRAGMENTS }, () => []);
  seed.nodes.forEach((node, i) => {
    // Agents never write project_id — merge assigns it.
    const { project_id, ...rest } = node;
    fragmentNodes[i % N_FRAGMENTS].push(rest);
  });

  // --- split edges round-robin too, offset from the node split so most
  // edges land in a DIFFERENT fragment than either of their endpoints ---
  const fragmentEdges = Array.from({ length: N_FRAGMENTS }, () => []);
  seed.edges.forEach((edge, i) => {
    // Fragments spell the edge's type as `kind` (merge.ts translates to the
    // bundle's own `edge_type` field — see merge.ts's pass 2 doc).
    fragmentEdges[(i + 2) % N_FRAGMENTS].push({
      source_id: edge.source_id,
      target_id: edge.target_id,
      kind: edge.edge_type,
    });
  });

  const units = [];
  for (let i = 0; i < N_FRAGMENTS; i += 1) {
    const id = `w1-chunk-${i}`;
    units.push({
      id,
      wave: 1,
      title: `Chunk ${i}`,
      scope: "",
      slice: { paths: [`chunk-${i}`] },
      fragment: `.arkaik/bootstrap/fragments/${id}.json`,
      status: "pending",
    });
    writeFileSync(
      path.join(dir, ".arkaik", "bootstrap", "fragments", `${id}.json`),
      JSON.stringify({ unit: id, wave: 1, nodes: fragmentNodes[i], edges: fragmentEdges[i] }),
    );
  }
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "manifest.json"),
    JSON.stringify({ version: 1, mode: "brownfield", bundle: "docs/arkaik/bundle.json", units }),
  );

  // --- the actual probe ---
  const merged = runCli(["bootstrap", "merge"], dir);
  check("real-data merge exits 0", merged.status === 0, merged.stderr);
  console.log(merged.stdout);

  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  check(`all ${seed.nodes.length} real nodes landed`, bundle.nodes.length === seed.nodes.length, `got ${bundle.nodes.length}`);
  check(`all ${seed.edges.length} real edges landed`, bundle.edges.length === seed.edges.length, `got ${bundle.edges.length}`);

  const journalPath = path.join(dir, "docs", "arkaik", "journal.jsonl");
  const events = readFileSync(journalPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check("one node.created per real node", events.filter((e) => e.type === "node.created").length === seed.nodes.length, String(events.length));

  const validated = runCli(["validate", "docs/arkaik/bundle.json"], dir);
  console.log(validated.stdout);
  check(
    "PROBE 6: `arkaik validate` passes (exit 0) on a real ~220-node/~411-edge graph merged from split fragments",
    validated.status === 0,
    validated.stdout + validated.stderr,
  );

  // Report (not gate on) the warning count — merge.ts does not own product/
  // map declarations, so a genuinely warning-clean result depends on more
  // than this file; the hard gate for THIS task is validateBundle's ERRORS,
  // which is what arkaik validate's own exit code reflects.
  const warningMatch = validated.stdout.match(/Warnings: (\d+)/);
  console.log(`  (informational) warning count: ${warningMatch ? warningMatch[1] : 0}`);

  // --- determinism, on real data: re-merge and diff byte-for-byte ---
  const bundleTextA = readFileSync(bundlePath, "utf8");
  const journalTextA = readFileSync(journalPath, "utf8");
  const second = runCli(["bootstrap", "merge"], dir);
  check("second real-data merge exits 0", second.status === 0, second.stderr);
  const bundleTextB = readFileSync(bundlePath, "utf8");
  const journalTextB = readFileSync(journalPath, "utf8");
  check("real-data bundle is byte-identical across two merge runs", bundleTextA === bundleTextB, "bundle differed");
  check("real-data journal is byte-identical across two merge runs", journalTextA === journalTextB, "journal differed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
