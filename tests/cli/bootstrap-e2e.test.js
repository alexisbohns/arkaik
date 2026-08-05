#!/usr/bin/env node

/**
 * The regression test for the METHOD, not for any one command: a tiny fixture
 * repo driven through corpus -> plan (recon-only) -> a hand-written recon
 * profile -> plan again (expands waves) -> slice one unit -> hand-written
 * fragments -> merge -> `arkaik validate`, in exactly that order and exactly
 * as a real bootstrap run goes. Every other bootstrap-*.test.js file proves
 * one command's own contract; this one is the only file that proves the
 * commands compose end to end.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
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

const dir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-e2e-"));
try {
  // `corpus` and `plan` both refuse to run outside a repository root.
  mkdirSync(path.join(dir, ".git"), { recursive: true });

  // A small fixture repo: three surfaces, a design doc, five merged PRs.
  mkdirSync(path.join(dir, "app", "home"), { recursive: true });
  mkdirSync(path.join(dir, "app", "settings"), { recursive: true });
  mkdirSync(path.join(dir, "app", "api", "notes"), { recursive: true });
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "app", "home", "page.tsx"), "export default function Home() {}\n");
  writeFileSync(path.join(dir, "app", "settings", "page.tsx"), "export default function Settings() {}\n");
  writeFileSync(path.join(dir, "app", "api", "notes", "route.ts"), "export async function GET() {}\n");
  writeFileSync(path.join(dir, "docs", "vision.md"), "# Vision\n\nA place for notes.\n");

  const prs = [
    {
      number: 1,
      title: "Home screen",
      body: '## Lab Note\n\n```yaml\nen:\n  title: "Home"\n```',
      mergedAt: "2026-01-05T10:00:00Z",
      labels: [],
      files: [{ path: "app/home/page.tsx" }],
    },
    { number: 2, title: "Notes API", body: "", mergedAt: "2026-01-10T10:00:00Z", labels: [], files: [{ path: "app/api/notes/route.ts" }] },
    { number: 3, title: "Settings screen", body: "", mergedAt: "2026-02-02T10:00:00Z", labels: [], files: [{ path: "app/settings/page.tsx" }] },
    { number: 4, title: "chore: deps", body: "", mergedAt: "2026-02-03T10:00:00Z", labels: [], files: [{ path: "package.json" }] },
    { number: 5, title: "Settings polish", body: "", mergedAt: "2026-02-10T10:00:00Z", labels: [], files: [{ path: "app/settings/page.tsx" }] },
  ];
  writeFileSync(path.join(dir, "gh.json"), JSON.stringify(prs));

  // --- corpus: mine the fixture repo ---
  const corpus = runCli(["bootstrap", "corpus", "--from-json", "gh.json"], dir);
  check("corpus mining exits 0", corpus.status === 0, corpus.stderr);
  const prLines = readFileSync(path.join(dir, ".arkaik", "corpus", "prs.jsonl"), "utf8").trim().split("\n");
  check("corpus captured all five merged PRs", prLines.length === 5, String(prLines.length));

  // --- first plan: no recon profile yet, so only the recon unit is planned ---
  const firstPlan = runCli(["bootstrap", "plan"], dir);
  check("first plan (recon-only) exits 0", firstPlan.status === 0, firstPlan.stderr);
  const manifestAfterFirstPlan = JSON.parse(
    readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"),
  );
  check(
    "first plan emits only the wave-0 recon unit",
    manifestAfterFirstPlan.units.length === 1 && manifestAfterFirstPlan.units[0].id === "w0-recon",
    JSON.stringify(manifestAfterFirstPlan.units.map((u) => u.id)),
  );

  // --- the recon agent's output: profile.json ---
  // Eras require at least one of from/to (assertEraWindow); area ids are
  // lowercase kebab-case with non-empty paths (assertAreas).
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "profile.json"),
    JSON.stringify({
      products: [{ id: "notes", title: "Notes" }],
      platforms: ["web"],
      areas: [
        { id: "home", title: "Home", paths: ["app/home"] },
        { id: "settings", title: "Settings", paths: ["app/settings"] },
        { id: "api", title: "API", paths: ["app/api"] },
      ],
      eras: [{ slug: "first-light", title: "First light", from: "2026-01-01", to: "2026-03-01" }],
    }),
  );

  // --- second plan: the profile expands waves 1-3 ---
  const secondPlan = runCli(["bootstrap", "plan"], dir);
  check("second plan (post-recon) exits 0", secondPlan.status === 0, secondPlan.stderr);
  const manifestAfterSecondPlan = JSON.parse(
    readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"),
  );
  const unitIds = manifestAfterSecondPlan.units.map((u) => u.id);
  check(
    "second plan expands to one unit per area/wave plus the era and decisions/status-arcs units",
    unitIds.length === 10,
    JSON.stringify(unitIds),
  );
  check(
    "wave-1 anatomy units exist for every area",
    ["w1-home", "w1-settings", "w1-api"].every((id) => unitIds.includes(id)),
    JSON.stringify(unitIds),
  );

  // --- slice one unit: exactly the corpus subset it needs, nothing more ---
  const sliceRun = runCli(["bootstrap", "slice", "w1-home"], dir);
  check("slice exits 0", sliceRun.status === 0, sliceRun.stderr);
  const slice = JSON.parse(sliceRun.stdout);
  check(
    "slice for w1-home returns exactly the one PR that touched app/home",
    slice.prs.length === 1 && slice.prs[0].number === 1,
    JSON.stringify(slice.prs.map((p) => p.number)),
  );
  check(
    "slice for w1-home returns the home page surface",
    slice.surfaces.some((s) => s.path === "app/home/page.tsx" && s.kind === "page"),
    JSON.stringify(slice.surfaces),
  );

  // --- the wave-1 agents' output: fragments ---
  // Node ids carry their species prefix (F-, V-, API-); edges spell their
  // type as `kind` (merge.ts translates to the bundle's own `edge_type`).
  // F-notes' playlist references V-home, which is created in the SAME
  // fragment — the cross-fragment case is the `calls` edge below, added by
  // w1-api but pointing at a node w1-home created.
  const frag = (name, body) =>
    writeFileSync(path.join(dir, ".arkaik", "bootstrap", "fragments", `${name}.json`), JSON.stringify(body));

  frag("w1-home", {
    unit: "w1-home",
    wave: 1,
    nodes: [
      {
        id: "F-notes",
        species: "flow",
        title: "Notes",
        status: "live",
        platforms: ["web"],
        created_ts: "2026-01-05T10:00:00.000Z",
        metadata: { playlist: { entries: [{ type: "view", view_id: "V-home" }] } },
      },
      { id: "V-home", species: "view", title: "Home", status: "live", platforms: ["web"], created_ts: "2026-01-05T10:00:00.000Z" },
    ],
    edges: [{ source_id: "F-notes", target_id: "V-home", kind: "composes" }],
  });
  frag("w1-settings", {
    unit: "w1-settings",
    wave: 1,
    nodes: [{ id: "V-settings", species: "view", title: "Settings", status: "live", platforms: ["web"], created_ts: "2026-02-02T10:00:00.000Z" }],
    edges: [],
  });
  frag("w1-api", {
    unit: "w1-api",
    wave: 1,
    nodes: [{ id: "API-get-notes", species: "api-endpoint", title: "GET /api/notes", status: "live", platforms: ["web"], created_ts: "2026-01-10T10:00:00.000Z" }],
    // Cross-fragment: source_id V-home was created by w1-home, not w1-api.
    edges: [{ source_id: "V-home", target_id: "API-get-notes", kind: "calls" }],
  });

  // --- merge: assemble the fragments onto the bundle, then validate ---
  const merged = runCli(["bootstrap", "merge"], dir);
  check("merge exits 0", merged.status === 0, merged.stderr);
  check("merge reports the bundle size", merged.stdout.includes("KB"), merged.stdout);

  const validated = runCli(["validate", "docs/arkaik/bundle.json"], dir);
  check("arkaik validate passes clean on the merged bundle", validated.status === 0, validated.stdout + validated.stderr);

  const bundle = JSON.parse(readFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), "utf8"));
  check("all four nodes across all three fragments landed", bundle.nodes.length === 4, JSON.stringify(bundle.nodes.map((n) => n.id)));
  check("both edges landed", bundle.edges.length === 2, JSON.stringify(bundle.edges.map((e) => e.id)));
  check(
    "the cross-fragment edge resolved (w1-api's edge references w1-home's node)",
    bundle.edges.some((e) => e.id === "e-V-home-API-get-notes" && e.edge_type === "calls"),
    JSON.stringify(bundle.edges),
  );
  check(
    "the same-fragment composes edge resolved too",
    bundle.edges.some((e) => e.id === "e-F-notes-V-home" && e.edge_type === "composes"),
    JSON.stringify(bundle.edges),
  );

  const events = readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check("one node.created event per node, no more", events.length === 4 && events.every((e) => e.type === "node.created"), String(events.length));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
