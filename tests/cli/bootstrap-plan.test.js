#!/usr/bin/env node

/**
 * Exercises `arkaik bootstrap plan` — work-unit planning from a recon
 * profile: the manifest's resumability contract, mode detection, and the
 * profile.json trust boundary (agent-written input reaching filesystem
 * paths, token-budget decisions, and status carry-forward).
 *
 * `bootstrap corpus` and the dispatcher scaffold live in
 * tests/cli/bootstrap-corpus.test.js. Runs in fresh mkdtemp dirs, never the
 * repo itself.
 */

const { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require("fs");
const { spawnSync } = require("child_process");
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

/** Every `plan` test needs a repo root now (item 3: same guard as `corpus`). */
function freshRepoDir(prefix) {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(d, ".git"), { recursive: true });
  return d;
}

const dir = freshRepoDir("arkaik-bootstrap-plan-");
try {
  // --- plan with no profile: recon only ---
  const plan0 = runCli(["bootstrap", "plan"], dir);
  check("plan exits 0 without a profile", plan0.status === 0, plan0.stderr);
  const m0 = JSON.parse(readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
  check("only the recon unit is planned", m0.units.length === 1, JSON.stringify(m0.units.map((u) => u.id)));
  check("recon unit is wave 0", m0.units[0].wave === 0, String(m0.units[0].wave));
  check("mode is greenfield with no bundle", m0.mode === "greenfield", m0.mode);
  check(
    "plan gitignores .arkaik even when corpus never ran",
    readFileSync(path.join(dir, ".gitignore"), "utf8").includes(".arkaik/"),
    "no .gitignore entry",
  );

  const planAgain = runCli(["bootstrap", "plan"], dir);
  check("re-plan exits 0 (gitignore step)", planAgain.status === 0, planAgain.stderr);
  check(
    "gitignore not duplicated by a second plan run",
    readFileSync(path.join(dir, ".gitignore"), "utf8").match(/\.arkaik\//g).length === 1,
    readFileSync(path.join(dir, ".gitignore"), "utf8"),
  );

  // --- plan with a profile: full expansion ---
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "profile.json"),
    JSON.stringify({
      products: [{ id: "app", title: "App" }],
      platforms: ["web", "ios"],
      areas: [
        { id: "home", title: "Home", paths: ["app/home"] },
        { id: "settings", title: "Settings", paths: ["app/settings"] },
      ],
      eras: [{ slug: "first-light", title: "First light", from: "2026-01-01", to: "2026-02-01" }],
    }),
  );
  const plan1 = runCli(["bootstrap", "plan"], dir);
  check("plan exits 0 with a profile", plan1.status === 0, plan1.stderr);
  const m1 = JSON.parse(readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
  const ids = m1.units.map((u) => u.id);
  check("one anatomy unit per area", ids.includes("w1-home") && ids.includes("w1-settings"), JSON.stringify(ids));
  check("one acceptance unit per area", ids.includes("w2-home") && ids.includes("w2-settings"), JSON.stringify(ids));
  check("one story unit per era", ids.includes("w3-first-light"), JSON.stringify(ids));
  check("decisions unit planned", ids.includes("w3-decisions"), JSON.stringify(ids));
  check("status arcs unit planned", ids.includes("w3-status-arcs"), JSON.stringify(ids));
  check("every unit starts pending", m1.units.every((u) => u.status === "pending"), JSON.stringify(m1.units));
  check(
    "fragment paths are namespaced by unit",
    m1.units.every((u) => u.fragment === `.arkaik/bootstrap/fragments/${u.id}.json`),
    JSON.stringify(m1.units.map((u) => u.fragment)),
  );
  check(
    "units are non-decreasing in wave (the resume-at-first-pending contract depends on it)",
    m1.units.every((u, i, arr) => i === 0 || u.wave >= arr[i - 1].wave),
    JSON.stringify(m1.units.map((u) => [u.id, u.wave])),
  );

  // --- resume preserves completed status ---
  const reconUnit1 = m1.units.find((u) => u.id === "w0-recon");
  reconUnit1.status = "done";
  writeFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), JSON.stringify(m1));
  const plan2 = runCli(["bootstrap", "plan"], dir);
  check("re-plan exits 0", plan2.status === 0, plan2.stderr);
  const m2 = JSON.parse(readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
  check(
    "re-plan preserves done status for an unchanged unit",
    m2.units.find((u) => u.id === "w0-recon").status === "done",
    JSON.stringify(m2.units.find((u) => u.id === "w0-recon")),
  );

  // --- regression: a unit whose slice changed must NOT keep a stale "done" ---
  // A killed-and-resumed run trusts `status: done` to mean "the fragment on
  // disk is current." If the profile later changes an area's paths, the old
  // fragment was written against the old slice — carrying "done" forward
  // would let `merge` (Task 6) consume stale output with no signal that
  // anything is wrong. Mark two units done, change only one area's paths,
  // and confirm only the affected units reset to pending.
  m2.units.find((u) => u.id === "w1-home").status = "done";
  m2.units.find((u) => u.id === "w2-home").status = "done";
  m2.units.find((u) => u.id === "w1-settings").status = "done";
  writeFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), JSON.stringify(m2));
  writeFileSync(
    path.join(dir, ".arkaik", "bootstrap", "profile.json"),
    JSON.stringify({
      products: [{ id: "app", title: "App" }],
      platforms: ["web", "ios"],
      areas: [
        { id: "home", title: "Home", paths: ["app/home", "app/dashboard"] }, // paths changed
        { id: "settings", title: "Settings", paths: ["app/settings"] }, // unchanged
      ],
      eras: [{ slug: "first-light", title: "First light", from: "2026-01-01", to: "2026-02-01" }],
    }),
  );
  const plan3 = runCli(["bootstrap", "plan"], dir);
  check("re-plan after a profile edit exits 0", plan3.status === 0, plan3.stderr);
  const m3 = JSON.parse(readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
  check(
    "a unit whose slice changed resets to pending, not done",
    m3.units.find((u) => u.id === "w1-home").status === "pending",
    JSON.stringify(m3.units.find((u) => u.id === "w1-home")),
  );
  check(
    "every unit sharing the changed area's slice resets, including the acceptance unit",
    m3.units.find((u) => u.id === "w2-home").status === "pending",
    JSON.stringify(m3.units.find((u) => u.id === "w2-home")),
  );
  check(
    "a unit whose slice did NOT change keeps its done status",
    m3.units.find((u) => u.id === "w1-settings").status === "done",
    JSON.stringify(m3.units.find((u) => u.id === "w1-settings")),
  );
  check(
    "recon status is untouched by an area's paths changing",
    m3.units.find((u) => u.id === "w0-recon").status === "done",
    JSON.stringify(m3.units.find((u) => u.id === "w0-recon")),
  );

  // --- regression: a cosmetic era title rename must NOT reset a finished unit ---
  // Area units embed area.title in their scope text (w1/w2), so a title
  // change there already shows up as a scope change — but scope isn't even
  // compared any more (see the mode-flip regression below), so this is
  // really just "title never invalidates anything." Era units make the
  // point clearest: the story unit's scope text never mentions era.title,
  // only the unit's own display `title` does.
  const eraRenameDir = freshRepoDir("arkaik-bootstrap-erarename-");
  try {
    mkdirSync(path.join(eraRenameDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(eraRenameDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({
        areas: [],
        eras: [{ slug: "chapter-one", title: "Chapter One", from: "2026-01-01", to: "2026-02-01" }],
      }),
    );
    const eraPlanA = runCli(["bootstrap", "plan"], eraRenameDir);
    check("era-rename setup plan exits 0", eraPlanA.status === 0, eraPlanA.stderr);
    const eraManifestA = JSON.parse(readFileSync(path.join(eraRenameDir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
    eraManifestA.units.find((u) => u.id === "w3-chapter-one").status = "done";
    writeFileSync(path.join(eraRenameDir, ".arkaik", "bootstrap", "manifest.json"), JSON.stringify(eraManifestA));

    // Same slug, same window, same slice — only the display title changes.
    writeFileSync(
      path.join(eraRenameDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({
        areas: [],
        eras: [{ slug: "chapter-one", title: "Chapter One: Redux", from: "2026-01-01", to: "2026-02-01" }],
      }),
    );
    const eraPlanB = runCli(["bootstrap", "plan"], eraRenameDir);
    check("re-plan after a cosmetic era rename exits 0", eraPlanB.status === 0, eraPlanB.stderr);
    const eraManifestB = JSON.parse(readFileSync(path.join(eraRenameDir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
    const renamedUnit = eraManifestB.units.find((u) => u.id === "w3-chapter-one");
    check("a cosmetic era title rename keeps the unit done", renamedUnit.status === "done", JSON.stringify(renamedUnit));
    check(
      "the unit's title still reflects the rename (only its status is preserved)",
      renamedUnit.title === "Story — Chapter One: Redux",
      renamedUnit.title,
    );
  } finally {
    rmSync(eraRenameDir, { recursive: true, force: true });
  }

  // --- regression: a greenfield -> brownfield mode flip must NOT reset finished units ---
  // Only w1's scope text is mode-dependent ("map the anatomy" vs "reconcile
  // the existing map"). A real run flips mode exactly this way: `merge`
  // lands wave-1 nodes, the bundle now has content, and the next `plan`
  // reads brownfield — but nothing about the ALREADY-MERGED wave-1 fragment
  // became wrong. Comparing `scope` (as an earlier version of this fix did)
  // would revert every finished wave-1 unit to pending on that flip alone,
  // which under `plan --issues` (Task 8) means re-filing a GitHub issue for
  // work that already shipped.
  const modeFlipDir = freshRepoDir("arkaik-bootstrap-modeflip-");
  try {
    mkdirSync(path.join(modeFlipDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(modeFlipDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({
        areas: [{ id: "home", title: "Home", paths: ["app/home"] }],
        eras: [{ slug: "first-light", title: "First light", from: "2026-01-01", to: "2026-02-01" }],
      }),
    );
    const flipPlanA = runCli(["bootstrap", "plan"], modeFlipDir);
    check("mode-flip setup plan exits 0", flipPlanA.status === 0, flipPlanA.stderr);
    const flipManifestA = JSON.parse(readFileSync(path.join(modeFlipDir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
    check("mode-flip setup starts greenfield", flipManifestA.mode === "greenfield", flipManifestA.mode);
    for (const u of flipManifestA.units) u.status = "done";
    writeFileSync(path.join(modeFlipDir, ".arkaik", "bootstrap", "manifest.json"), JSON.stringify(flipManifestA));

    // Populate the default bundle path so the next plan reads brownfield.
    mkdirSync(path.join(modeFlipDir, "docs", "arkaik"), { recursive: true });
    writeFileSync(
      path.join(modeFlipDir, "docs", "arkaik", "bundle.json"),
      JSON.stringify({
        schema_version: 3,
        project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
        nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
        edges: [],
      }),
    );
    const flipPlanB = runCli(["bootstrap", "plan"], modeFlipDir);
    check("mode-flip re-plan exits 0", flipPlanB.status === 0, flipPlanB.stderr);
    const flipManifestB = JSON.parse(readFileSync(path.join(modeFlipDir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
    check("the mode actually flipped to brownfield", flipManifestB.mode === "brownfield", flipManifestB.mode);
    check(
      "every unit stays done across the mode flip, including w1 (whose scope text changed)",
      flipManifestB.units.every((u) => u.status === "done"),
      JSON.stringify(flipManifestB.units.map((u) => [u.id, u.status])),
    );
  } finally {
    rmSync(modeFlipDir, { recursive: true, force: true });
  }

  // --- regression: decisions/status-arcs must not depend on eras existing ---
  // The decisions unit mines design docs; the status-arc unit arcs anatomy
  // nodes. Neither reads eras. Gating both on `profile.eras.length` means a
  // profile with real areas but zero eras (a young repo, or one where recon
  // judged there's no story worth splitting into eras yet) silently loses
  // decision-mining and status arcs even though areas — and therefore docs
  // and anatomy nodes — exist.
  const noErasDir = freshRepoDir("arkaik-bootstrap-noeras-");
  try {
    mkdirSync(path.join(noErasDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(noErasDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({
        products: [{ id: "app", title: "App" }],
        platforms: ["web"],
        areas: [{ id: "home", title: "Home", paths: ["app/home"] }],
        eras: [],
      }),
    );
    const noErasPlan = runCli(["bootstrap", "plan"], noErasDir);
    check("plan exits 0 with areas but no eras", noErasPlan.status === 0, noErasPlan.stderr);
    const noErasManifest = JSON.parse(
      readFileSync(path.join(noErasDir, ".arkaik", "bootstrap", "manifest.json"), "utf8"),
    );
    const noErasIds = noErasManifest.units.map((u) => u.id);
    check(
      "decisions unit is planned even with zero eras",
      noErasIds.includes("w3-decisions"),
      JSON.stringify(noErasIds),
    );
    check(
      "status-arcs unit is planned even with zero eras",
      noErasIds.includes("w3-status-arcs"),
      JSON.stringify(noErasIds),
    );
  } finally {
    rmSync(noErasDir, { recursive: true, force: true });
  }

  // --- regression: a stub bundle (zero nodes) is still greenfield ---
  // The spec's mode rule is "no bundle, OR A STUB" — existsSync alone can't
  // tell a freshly-scaffolded `arkaik init` bundle ({nodes: [], edges: []})
  // from a real one. A 15-node beachhead should read brownfield; an empty
  // scaffold should not.
  const stubDir = freshRepoDir("arkaik-bootstrap-stub-");
  try {
    mkdirSync(path.join(stubDir, "docs", "arkaik"), { recursive: true });
    writeFileSync(
      path.join(stubDir, "docs", "arkaik", "bundle.json"),
      JSON.stringify({
        schema_version: 3,
        project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
        nodes: [],
        edges: [],
      }),
    );
    const stubPlan = runCli(["bootstrap", "plan"], stubDir);
    check("plan exits 0 against a stub bundle", stubPlan.status === 0, stubPlan.stderr);
    const stubManifest = JSON.parse(readFileSync(path.join(stubDir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
    check("a zero-node bundle still reads greenfield", stubManifest.mode === "greenfield", stubManifest.mode);

    // Now give the same bundle a real node and re-plan: brownfield.
    writeFileSync(
      path.join(stubDir, "docs", "arkaik", "bundle.json"),
      JSON.stringify({
        schema_version: 3,
        project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
        nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
        edges: [],
      }),
    );
    const populatedPlan = runCli(["bootstrap", "plan"], stubDir);
    check("plan exits 0 against a populated bundle", populatedPlan.status === 0, populatedPlan.stderr);
    const populatedManifest = JSON.parse(
      readFileSync(path.join(stubDir, ".arkaik", "bootstrap", "manifest.json"), "utf8"),
    );
    check("a bundle with real nodes reads brownfield", populatedManifest.mode === "brownfield", populatedManifest.mode);
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
  }

  // --- regression: a bundle that exists but isn't valid JSON must not crash or guess ---
  // detectMode's throw path had zero coverage — the branch most likely to
  // rot silently. plan must fail loudly, naming the bundle path, rather
  // than defaulting to either mode.
  const badJsonDir = freshRepoDir("arkaik-bootstrap-badjson-");
  try {
    mkdirSync(path.join(badJsonDir, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(badJsonDir, "docs", "arkaik", "bundle.json"), "{ not valid json");
    const badJsonPlan = runCli(["bootstrap", "plan"], badJsonDir);
    check("plan exits 1 against an unparseable bundle", badJsonPlan.status === 1, String(badJsonPlan.status));
    check("the failure names the bundle path", badJsonPlan.stderr.includes("docs/arkaik/bundle.json"), badJsonPlan.stderr);
  } finally {
    rmSync(badJsonDir, { recursive: true, force: true });
  }

  // --- regression: valid JSON that isn't bundle-shaped falls back to greenfield, not a crash ---
  // Currently true only by accident of the Array.isArray guard in detectMode
  // — pin it so it stays true on purpose.
  const notBundleDir = freshRepoDir("arkaik-bootstrap-notbundle-");
  try {
    mkdirSync(path.join(notBundleDir, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(notBundleDir, "docs", "arkaik", "bundle.json"), JSON.stringify({ hello: "world" }));
    const notBundlePlan = runCli(["bootstrap", "plan"], notBundleDir);
    check("plan exits 0 against valid JSON with no nodes array", notBundlePlan.status === 0, notBundlePlan.stderr);
    const notBundleManifest = JSON.parse(readFileSync(path.join(notBundleDir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
    check(
      "a non-bundle-shaped file falls back to greenfield rather than crashing",
      notBundleManifest.mode === "greenfield",
      notBundleManifest.mode,
    );
  } finally {
    rmSync(notBundleDir, { recursive: true, force: true });
  }

  // --- regression: an absolute --bundle path must resolve as itself, not cwd-joined ---
  // detectMode used to resolve the bundle via path.join(cwd, bundlePath),
  // which mangles an absolute path (path.join("/repo", "/abs/bundle.json")
  // -> "/repo/abs/bundle.json") and silently fell back to greenfield even
  // when the real bundle at that absolute path had real content.
  const absBundleDir = freshRepoDir("arkaik-bootstrap-absbundle-");
  const absBundleFile = path.join(absBundleDir, "elsewhere-bundle.json");
  try {
    writeFileSync(
      absBundleFile,
      JSON.stringify({
        schema_version: 3,
        project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
        nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
        edges: [],
      }),
    );
    const absPlan = runCli(["bootstrap", "plan", "--bundle", absBundleFile], absBundleDir);
    check("plan exits 0 with an absolute --bundle path", absPlan.status === 0, absPlan.stderr);
    const absManifest = JSON.parse(readFileSync(path.join(absBundleDir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
    check(
      "an absolute --bundle path resolves to itself and reads brownfield",
      absManifest.mode === "brownfield",
      absManifest.mode,
    );
  } finally {
    rmSync(absBundleDir, { recursive: true, force: true });
  }

  // --- regression: agent-supplied unit ids reaching a filesystem path ---
  // Area ids and era slugs come from profile.json, written by an agent, and
  // become fragment filenames verbatim. An id containing "/" or ".." would
  // make the fragment path escape .arkaik/bootstrap/fragments/ entirely;
  // plan must refuse rather than mint a unit that writes outside its own
  // working directory.
  const unsafeIdDir = freshRepoDir("arkaik-bootstrap-unsafeid-");
  try {
    mkdirSync(path.join(unsafeIdDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(unsafeIdDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({
        areas: [{ id: "../evil", title: "Evil", paths: ["app"] }],
        eras: [],
      }),
    );
    const unsafePlan = runCli(["bootstrap", "plan"], unsafeIdDir);
    check("plan rejects a path-traversal area id", unsafePlan.status === 1, String(unsafePlan.status));
    check(
      "the rejection names the offending id",
      unsafePlan.stderr.includes("../evil"),
      unsafePlan.stderr,
    );
    check(
      "no manifest is written when an id is unsafe",
      !existsSync(path.join(unsafeIdDir, ".arkaik", "bootstrap", "manifest.json")),
      "manifest.json was written despite the unsafe id",
    );
  } finally {
    rmSync(unsafeIdDir, { recursive: true, force: true });
  }

  const spaceIdDir = freshRepoDir("arkaik-bootstrap-spaceid-");
  try {
    mkdirSync(path.join(spaceIdDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(spaceIdDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({ areas: [], eras: [{ slug: "first light", title: "First light" }] }),
    );
    const spacePlan = runCli(["bootstrap", "plan"], spaceIdDir);
    check("plan rejects an era slug containing a space", spacePlan.status === 1, String(spacePlan.status));
  } finally {
    rmSync(spaceIdDir, { recursive: true, force: true });
  }

  // --- regression: an era slug can't silently collide with a reserved wave-3 id ---
  // "decisions" and "status-arcs" are hardcoded wave-3 unit ids. An era
  // literally named either one would otherwise mint two units with the same
  // id (and thus the same fragment path) — the second one silently
  // overwriting the first agent's output. plan must catch this at plan time,
  // not leave it for merge to discover.
  const dupIdDir = freshRepoDir("arkaik-bootstrap-dupid-");
  try {
    mkdirSync(path.join(dupIdDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(dupIdDir, ".arkaik", "bootstrap", "profile.json"),
      // Dated, so this era passes assertEraWindow and reaches the duplicate-id
      // check below — the thing this test actually exercises.
      JSON.stringify({ areas: [], eras: [{ slug: "decisions", title: "Decisions era", from: "2026-01-01", to: "2026-02-01" }] }),
    );
    const dupPlan = runCli(["bootstrap", "plan"], dupIdDir);
    check("plan rejects an era slug that collides with the reserved decisions unit", dupPlan.status === 1, String(dupPlan.status));
    check(
      "the collision error names the duplicate id",
      dupPlan.stderr.includes("w3-decisions"),
      dupPlan.stderr,
    );
  } finally {
    rmSync(dupIdDir, { recursive: true, force: true });
  }

  // --- regression: an era with neither `from` nor `to` fails open otherwise (Task 4's other primary token lever) ---
  // Overturns Task 4's original "fails closed" choice: an unbounded era used
  // to resolve to zero PRs at slice time (safer than the alternative, but
  // still silent — no error anywhere, just an empty fragment). Same
  // authoring mistake as an area with empty `paths` above, same treatment:
  // reject it here, before any agent is dispatched.
  const datelessEraDir = freshRepoDir("arkaik-bootstrap-datelessera-");
  try {
    mkdirSync(path.join(datelessEraDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(datelessEraDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({ areas: [], eras: [{ slug: "no-dates", title: "No dates" }] }),
    );
    const datelessPlan = runCli(["bootstrap", "plan"], datelessEraDir);
    check("plan rejects an era with neither from nor to", datelessPlan.status === 1, String(datelessPlan.status));
    check("the rejection names the offending era", datelessPlan.stderr.includes("no-dates"), datelessPlan.stderr);
  } finally {
    rmSync(datelessEraDir, { recursive: true, force: true });
  }

  // --- regression: an era with an unparseable from/to is rejected, not silently discarded ---
  const badEraDateDir = freshRepoDir("arkaik-bootstrap-baderadate-");
  try {
    mkdirSync(path.join(badEraDateDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(badEraDateDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({ areas: [], eras: [{ slug: "bad-date", title: "Bad date", from: "not-a-date" }] }),
    );
    const badEraDatePlan = runCli(["bootstrap", "plan"], badEraDateDir);
    check("plan rejects an era with an unparseable from", badEraDatePlan.status === 1, String(badEraDatePlan.status));
    check("the rejection names the bad value", badEraDatePlan.stderr.includes("not-a-date"), badEraDatePlan.stderr);
  } finally {
    rmSync(badEraDateDir, { recursive: true, force: true });
  }

  // --- an era with only one bound stays legal — that's a meaningful open-ended window, not a mistake ---
  const openEndedEraDir = freshRepoDir("arkaik-bootstrap-openendedera-");
  try {
    mkdirSync(path.join(openEndedEraDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(openEndedEraDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({ areas: [], eras: [{ slug: "ongoing", title: "Ongoing", from: "2026-01-01" }] }),
    );
    const openEndedPlan = runCli(["bootstrap", "plan"], openEndedEraDir);
    check("plan accepts an era with only `from` set", openEndedPlan.status === 0, openEndedPlan.stderr);
  } finally {
    rmSync(openEndedEraDir, { recursive: true, force: true });
  }

  // --- regression: overlapping era windows are rejected, not left to double-match PRs ---
  // Windows are half-open — `[start, end)` — deliberately (see era-window.ts:
  // a date-only `to` includes the whole named day, which is what actually
  // fixes the boundary-day bug; see bootstrap-slice.test.js's boundary-day
  // test for the PR-membership proof). A GENUINE overlap — one window's span
  // reaching into another's, not just sharing a boundary instant — still
  // double-matches every PR merged in it, with nothing downstream deduping
  // it, so eras are still required to partition the corpus, checked here.
  const overlapEraDir = freshRepoDir("arkaik-bootstrap-overlapera-");
  try {
    mkdirSync(path.join(overlapEraDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(overlapEraDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({
        areas: [],
        eras: [
          { slug: "era-a", title: "Era A", from: "2026-01-01", to: "2026-02-15" },
          { slug: "era-b", title: "Era B", from: "2026-02-01", to: "2026-03-01" },
        ],
      }),
    );
    const overlapPlan = runCli(["bootstrap", "plan"], overlapEraDir);
    check("plan rejects two eras with overlapping windows", overlapPlan.status === 1, String(overlapPlan.status));
    check("the rejection names both offending eras", overlapPlan.stderr.includes("era-a") && overlapPlan.stderr.includes("era-b"), overlapPlan.stderr);
  } finally {
    rmSync(overlapEraDir, { recursive: true, force: true });
  }

  // --- two eras sharing the SAME calendar date for `to` and `from` still overlap by a full day, and are rejected ---
  // era-c's `to: "2026-02-01"` expands to include the WHOLE of Feb 1st (end
  // = Feb 2 00:00, exclusive) — that's the half-open fix's whole point (a
  // date-only `to` must include its named day, see era-window.ts). era-d's
  // `from: "2026-02-01"` starts at the very beginning of Feb 1. The two
  // windows therefore share the entire day of Feb 1st, not just an instant —
  // a real overlap, correctly rejected. (Using the SAME calendar date for
  // one era's `to` and the next era's `from` is NOT the pattern that
  // partitions cleanly — see the next test for the pattern that does.)
  const sameDateEraDir = freshRepoDir("arkaik-bootstrap-samedateera-");
  try {
    mkdirSync(path.join(sameDateEraDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(sameDateEraDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({
        areas: [],
        eras: [
          { slug: "era-c", title: "Era C", from: "2026-01-01", to: "2026-02-01" },
          { slug: "era-d", title: "Era D", from: "2026-02-01", to: "2026-03-01" },
        ],
      }),
    );
    const sameDatePlan = runCli(["bootstrap", "plan"], sameDateEraDir);
    check(
      "plan rejects two eras whose to/from share the same calendar date (a full day's overlap, not a clean touch)",
      sameDatePlan.status === 1,
      sameDatePlan.stderr,
    );
  } finally {
    rmSync(sameDateEraDir, { recursive: true, force: true });
  }

  // --- the pattern that DOES partition cleanly: one era's `to` is the day BEFORE the next era's `from` ---
  // era-e ends "2026-01-31" (expands to include all of Jan 31, ending
  // exactly at Feb 1 00:00) and era-f starts "2026-02-01" (Feb 1 00:00) —
  // the two windows touch at exactly that instant with zero overlap and
  // zero gap. `plan` accepts this; bootstrap-slice.test.js's boundary-day
  // test proves a PR merged mid-day on Jan 31 actually lands in era-e alone,
  // which is the whole reason this shape was fixed.
  const touchingEraDir = freshRepoDir("arkaik-bootstrap-touchingera-");
  try {
    mkdirSync(path.join(touchingEraDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(touchingEraDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({
        areas: [],
        eras: [
          { slug: "era-e", title: "Era E", from: "2026-01-01", to: "2026-01-31" },
          { slug: "era-f", title: "Era F", from: "2026-02-01", to: "2026-03-01" },
        ],
      }),
    );
    const touchingPlan = runCli(["bootstrap", "plan"], touchingEraDir);
    check(
      "plan accepts two eras that partition cleanly (one `to` the day before the next `from`)",
      touchingPlan.status === 0,
      touchingPlan.stderr,
    );
  } finally {
    rmSync(touchingEraDir, { recursive: true, force: true });
  }

  // --- two eras that both carry only a `from` date always overlap under half-open semantics — the message should say so ---
  // Each open-ended era extends to +Infinity, so any two of them always
  // overlap, no matter how far apart their `from` dates are. The generic
  // overlap message ("narrow one or both windows") doesn't hint that the fix
  // here is specifically to add a `to` bound — this pins the clearer message.
  const bothOpenEndedDir = freshRepoDir("arkaik-bootstrap-bothopenended-");
  try {
    mkdirSync(path.join(bothOpenEndedDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(bothOpenEndedDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({
        areas: [],
        eras: [
          { slug: "era-g", title: "Era G", from: "2026-01-01" },
          { slug: "era-h", title: "Era H", from: "2026-06-01" },
        ],
      }),
    );
    const bothOpenEndedPlan = runCli(["bootstrap", "plan"], bothOpenEndedDir);
    check(
      "plan rejects two from-only eras (both extend indefinitely, so they always overlap)",
      bothOpenEndedPlan.status === 1,
      bothOpenEndedPlan.stderr,
    );
    check(
      "the message names the fix (add a `to` date) rather than the generic 'narrow one or both windows'",
      bothOpenEndedPlan.stderr.includes('"to"') || bothOpenEndedPlan.stderr.toLowerCase().includes("to date"),
      bothOpenEndedPlan.stderr,
    );
  } finally {
    rmSync(bothOpenEndedDir, { recursive: true, force: true });
  }

  // --- regression: case-differing ids collide on a case-insensitive filesystem ---
  // macOS and Windows both default to case-insensitive filesystems, so ids
  // "Home" and "home" would resolve to the SAME fragment file even though
  // they're different strings — a case-sensitive duplicate check alone
  // cannot catch that. Ids must be rejected for carrying uppercase at all,
  // not merely compared case-insensitively.
  const caseIdDir = freshRepoDir("arkaik-bootstrap-caseid-");
  try {
    mkdirSync(path.join(caseIdDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(caseIdDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({ areas: [{ id: "Home", title: "Home", paths: ["app/home"] }], eras: [] }),
    );
    const caseIdPlan = runCli(["bootstrap", "plan"], caseIdDir);
    check("plan rejects an uppercase area id", caseIdPlan.status === 1, String(caseIdPlan.status));
    check(
      "the rejection says ids must be lowercase kebab-case",
      caseIdPlan.stderr.toLowerCase().includes("lowercase"),
      caseIdPlan.stderr,
    );
  } finally {
    rmSync(caseIdDir, { recursive: true, force: true });
  }

  // --- regression: an oversized id fails at plan time, not at fragment-write time ---
  const longIdDir = freshRepoDir("arkaik-bootstrap-longid-");
  try {
    mkdirSync(path.join(longIdDir, ".arkaik", "bootstrap"), { recursive: true });
    const longId = "a".repeat(300);
    writeFileSync(
      path.join(longIdDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({ areas: [{ id: longId, title: "Too Long", paths: ["app"] }], eras: [] }),
    );
    const longIdPlan = runCli(["bootstrap", "plan"], longIdDir);
    check("plan rejects an id longer than the length cap", longIdPlan.status === 1, String(longIdPlan.status));
  } finally {
    rmSync(longIdDir, { recursive: true, force: true });
  }

  // --- regression: an area with no paths fails open otherwise (Task 4's primary token lever) ---
  // An empty/missing `paths` produces `slice: {}`, which Task 4's
  // resolveSlice reads as `?? []` -> no filter -> the WHOLE corpus, silently,
  // with nothing in the manifest that looks wrong.
  const noPathsDir = freshRepoDir("arkaik-bootstrap-nopaths-");
  try {
    mkdirSync(path.join(noPathsDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(noPathsDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({ areas: [{ id: "home", title: "Home", paths: [] }], eras: [] }),
    );
    const noPathsPlan = runCli(["bootstrap", "plan"], noPathsDir);
    check("plan rejects an area with an empty paths array", noPathsPlan.status === 1, String(noPathsPlan.status));
    check("the rejection names the offending area", noPathsPlan.stderr.includes("home"), noPathsPlan.stderr);
  } finally {
    rmSync(noPathsDir, { recursive: true, force: true });
  }

  const missingPathsDir = freshRepoDir("arkaik-bootstrap-missingpaths-");
  try {
    mkdirSync(path.join(missingPathsDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(missingPathsDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({ areas: [{ id: "home", title: "Home" }], eras: [] }),
    );
    const missingPathsPlan = runCli(["bootstrap", "plan"], missingPathsDir);
    check("plan rejects an area with no paths field at all", missingPathsPlan.status === 1, String(missingPathsPlan.status));
  } finally {
    rmSync(missingPathsDir, { recursive: true, force: true });
  }

  // --- regression: areas/eras must actually be arrays ---
  // `areas: "home"` would otherwise reach a `for...of`: a string iterates
  // its characters (silently wrong, not an error). `areas: 5` throws a raw
  // "is not iterable" with no mention of profile.json.
  const areasStringDir = freshRepoDir("arkaik-bootstrap-areasstring-");
  try {
    mkdirSync(path.join(areasStringDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(path.join(areasStringDir, ".arkaik", "bootstrap", "profile.json"), JSON.stringify({ areas: "home" }));
    const areasStringPlan = runCli(["bootstrap", "plan"], areasStringDir);
    check("plan rejects areas: <string> instead of iterating its characters", areasStringPlan.status === 1, String(areasStringPlan.status));
    check("the rejection mentions profile.json", areasStringPlan.stderr.includes("profile.json"), areasStringPlan.stderr);
  } finally {
    rmSync(areasStringDir, { recursive: true, force: true });
  }

  const areasNumberDir = freshRepoDir("arkaik-bootstrap-areasnumber-");
  try {
    mkdirSync(path.join(areasNumberDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(path.join(areasNumberDir, ".arkaik", "bootstrap", "profile.json"), JSON.stringify({ areas: 5 }));
    const areasNumberPlan = runCli(["bootstrap", "plan"], areasNumberDir);
    check("plan rejects areas: <number> with a clear message, not a raw crash", areasNumberPlan.status === 1, String(areasNumberPlan.status));
    check(
      "the rejection does not leak a raw 'is not iterable' TypeError",
      !areasNumberPlan.stderr.includes("is not iterable"),
      areasNumberPlan.stderr,
    );
  } finally {
    rmSync(areasNumberDir, { recursive: true, force: true });
  }

  const erasStringDir = freshRepoDir("arkaik-bootstrap-erasstring-");
  try {
    mkdirSync(path.join(erasStringDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(path.join(erasStringDir, ".arkaik", "bootstrap", "profile.json"), JSON.stringify({ eras: "oops" }));
    const erasStringPlan = runCli(["bootstrap", "plan"], erasStringDir);
    check("plan rejects eras: <string> instead of iterating its characters", erasStringPlan.status === 1, String(erasStringPlan.status));
  } finally {
    rmSync(erasStringDir, { recursive: true, force: true });
  }

  // --- regression: a malformed individual area/era entry must not crash ---
  const malformedAreaDir = freshRepoDir("arkaik-bootstrap-malformedarea-");
  try {
    mkdirSync(path.join(malformedAreaDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(path.join(malformedAreaDir, ".arkaik", "bootstrap", "profile.json"), JSON.stringify({ areas: [null] }));
    const malformedAreaPlan = runCli(["bootstrap", "plan"], malformedAreaDir);
    check("plan rejects a null area entry instead of crashing on .id", malformedAreaPlan.status === 1, String(malformedAreaPlan.status));
    check(
      "the rejection is a clean message, not a raw TypeError from reading .id off null",
      !malformedAreaPlan.stderr.includes("Cannot read propert"),
      malformedAreaPlan.stderr,
    );
  } finally {
    rmSync(malformedAreaDir, { recursive: true, force: true });
  }

  const malformedEraDir = freshRepoDir("arkaik-bootstrap-malformedera-");
  try {
    mkdirSync(path.join(malformedEraDir, ".arkaik", "bootstrap"), { recursive: true });
    // null, not a primitive like 42: `(42).slug` auto-boxes to `undefined`
    // (no crash risk), but `null.slug` throws a raw TypeError — the actual
    // risk this guard exists for.
    writeFileSync(path.join(malformedEraDir, ".arkaik", "bootstrap", "profile.json"), JSON.stringify({ eras: [null] }));
    const malformedEraPlan = runCli(["bootstrap", "plan"], malformedEraDir);
    check("plan rejects a null era entry instead of crashing on .slug", malformedEraPlan.status === 1, String(malformedEraPlan.status));
    check(
      "the rejection is a clean message, not a raw TypeError from reading .slug off null",
      !malformedEraPlan.stderr.includes("Cannot read propert"),
      malformedEraPlan.stderr,
    );
  } finally {
    rmSync(malformedEraDir, { recursive: true, force: true });
  }

  // --- regression: plan requires a repo root, same guard as corpus ---
  const noGitRoot = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-plan-nogit-"));
  try {
    const outsideRepo = runCli(["bootstrap", "plan"], noGitRoot);
    check("plan outside a repo root exits 1", outsideRepo.status === 1, String(outsideRepo.status));
    check("plan outside a repo root names the reason", outsideRepo.stderr.includes("repository root"), outsideRepo.stderr);
    check(
      "no manifest is written outside a repo root",
      !existsSync(path.join(noGitRoot, ".arkaik", "bootstrap", "manifest.json")),
      "manifest.json was written outside a repo root",
    );
  } finally {
    rmSync(noGitRoot, { recursive: true, force: true });
  }

  // --- regression: parse errors name the file, not just "Unexpected end of JSON input" ---
  const badProfileDir = freshRepoDir("arkaik-bootstrap-badprofile-");
  try {
    mkdirSync(path.join(badProfileDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(path.join(badProfileDir, ".arkaik", "bootstrap", "profile.json"), "{ not valid json");
    const badProfilePlan = runCli(["bootstrap", "plan"], badProfileDir);
    check("plan exits 1 against an unparseable profile.json", badProfilePlan.status === 1, String(badProfilePlan.status));
    check(
      "the failure names profile.json specifically",
      badProfilePlan.stderr.includes("profile.json"),
      badProfilePlan.stderr,
    );
  } finally {
    rmSync(badProfileDir, { recursive: true, force: true });
  }

  const badManifestDir = freshRepoDir("arkaik-bootstrap-badmanifest-");
  try {
    mkdirSync(path.join(badManifestDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(path.join(badManifestDir, ".arkaik", "bootstrap", "manifest.json"), "{ not valid json");
    const badManifestPlan = runCli(["bootstrap", "plan"], badManifestDir);
    check("plan exits 1 against an unparseable manifest.json", badManifestPlan.status === 1, String(badManifestPlan.status));
    check(
      "the failure names manifest.json specifically",
      badManifestPlan.stderr.includes("manifest.json"),
      badManifestPlan.stderr,
    );
  } finally {
    rmSync(badManifestDir, { recursive: true, force: true });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
