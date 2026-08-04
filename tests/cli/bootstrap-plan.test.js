#!/usr/bin/env node

/**
 * Exercises `arkaik bootstrap` — the deterministic half of the bootstrap
 * method: corpus mining from a captured gh payload, work-unit planning from a
 * recon profile, corpus slicing, and the compact map index.
 * Runs in fresh mkdtemp dirs, never the repo itself.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require("fs");
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

const dir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-plan-"));
try {
  // A real .git dir is not needed — `corpus` only checks for its presence,
  // as the repo-root guard against running from a subdirectory.
  mkdirSync(path.join(dir, ".git"), { recursive: true });

  // --- dispatch ---
  const help = runCli(["bootstrap", "--help"], dir);
  check("bootstrap --help exits 0", help.status === 0, help.stderr);
  check("help lists corpus", help.stdout.includes("corpus"), help.stdout);
  check("help lists merge", help.stdout.includes("merge"), help.stdout);

  const noArgs = runCli(["bootstrap"], dir);
  check("bootstrap with no arguments exits 0", noArgs.status === 0, noArgs.stderr);
  check("bootstrap with no arguments prints usage", noArgs.stdout.includes("Subcommands:"), noArgs.stdout);

  const unknown = runCli(["bootstrap", "nope"], dir);
  check("unknown subcommand exits 1", unknown.status === 1, String(unknown.status));
  check("unknown subcommand error lands on stderr", unknown.stderr.includes("Unknown bootstrap subcommand"), unknown.stderr);

  // --- corpus from a captured gh payload ---
  const ghPayload = [
    {
      number: 1,
      title: "Add the home screen",
      body: "## Lab Note\n\n```yaml\nen:\n  title: \"Home, at last\"\n```",
      mergedAt: "2026-01-02T10:00:00Z",
      labels: [{ name: "feature" }],
      files: [{ path: "app/home/page.tsx" }],
    },
    {
      number: 2,
      title: "chore: bump deps",
      body: "",
      mergedAt: "2026-01-03T10:00:00Z",
      labels: [],
      files: [{ path: "package.json" }],
    },
  ];
  const payloadPath = path.join(dir, "gh.json");
  writeFileSync(payloadPath, JSON.stringify(ghPayload));
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "vision.md"), "# Vision\n\nWhy we build.\n");
  mkdirSync(path.join(dir, "app", "home"), { recursive: true });
  writeFileSync(path.join(dir, "app", "home", "page.tsx"), "export default function Home() {}\n");

  const corpus = runCli(["bootstrap", "corpus", "--from-json", payloadPath], dir);
  check("corpus exits 0", corpus.status === 0, corpus.stderr);

  const prLines = readFileSync(path.join(dir, ".arkaik", "corpus", "prs.jsonl"), "utf8").trim().split("\n");
  check("both PRs captured", prLines.length === 2, String(prLines.length));
  const pr1 = JSON.parse(prLines[0]);
  check("PRs sorted oldest first", pr1.number === 1, String(pr1.number));
  check("changed paths flattened to strings", pr1.files[0] === "app/home/page.tsx", JSON.stringify(pr1.files));
  check("lab note detected", pr1.has_lab_note === true, JSON.stringify(pr1.has_lab_note));
  check("chore PR has no lab note", JSON.parse(prLines[1]).has_lab_note === false, prLines[1]);

  // --- regression: merge date orders the corpus, not PR number ---
  // PR #60 merged before #50 — review latency and long-lived branches make
  // this routine, not exotic. Sorting by number alone (the original bug,
  // caught on the --from-git path but present on the gh path too) would put
  // #50 first; merge date must win.
  const orderDir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-order-"));
  try {
    mkdirSync(path.join(orderDir, ".git"), { recursive: true });
    const disagreeingPayload = [
      { number: 60, title: "PR 60, merged first", body: "", mergedAt: "2026-01-01T00:00:00Z", labels: [], files: [] },
      { number: 50, title: "PR 50, merged second", body: "", mergedAt: "2026-01-05T00:00:00Z", labels: [], files: [] },
    ];
    const disagreeingPath = path.join(orderDir, "gh.json");
    writeFileSync(disagreeingPath, JSON.stringify(disagreeingPayload));
    const orderRun = runCli(["bootstrap", "corpus", "--from-json", disagreeingPath], orderDir);
    check("merge-date-vs-number corpus exits 0", orderRun.status === 0, orderRun.stderr);
    const orderedLines = readFileSync(path.join(orderDir, ".arkaik", "corpus", "prs.jsonl"), "utf8").trim().split("\n");
    check(
      "merge date wins over number when they disagree",
      JSON.parse(orderedLines[0]).number === 60 && JSON.parse(orderedLines[1]).number === 50,
      orderedLines.join("\n"),
    );
  } finally {
    rmSync(orderDir, { recursive: true, force: true });
  }

  // --- regression: --from-git doesn't mint duplicate PR numbers ---
  // Real history duplicated numbers two ways: a `#N` mention mid-subject
  // matched the same regex as a real "Merge pull request #N" line, and the
  // positional fallback (starting at 1) could land on a real number. Three
  // merges: one GitHub-authored (#5), one plain merge with no number at all
  // (must fall back), and one that only *mentions* #5 (must NOT match it —
  // an unanchored regex would collide with the real #5 here).
  const gitDir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-fromgit-"));
  try {
    const git = (args) => spawnSync("git", args, { cwd: gitDir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    git(["commit", "-q", "--allow-empty", "-m", "chore: init"]);
    const branch = git(["symbolic-ref", "--short", "HEAD"]).stdout.trim();

    git(["checkout", "-q", "-b", "feature-a"]);
    git(["commit", "-q", "--allow-empty", "-m", "Add feature A"]);
    git(["checkout", "-q", branch]);
    git(["merge", "-q", "--no-ff", "feature-a", "-m", "Merge pull request #5 from acme/feature-a"]);

    git(["checkout", "-q", "-b", "feature-b"]);
    git(["commit", "-q", "--allow-empty", "-m", "Add feature B"]);
    git(["checkout", "-q", branch]);
    git(["merge", "-q", "--no-ff", "feature-b", "-m", "Merge branch 'feature-b'"]);

    git(["checkout", "-q", "-b", "feature-c"]);
    git(["commit", "-q", "--allow-empty", "-m", "Add feature C"]);
    git(["checkout", "-q", branch]);
    git(["merge", "-q", "--no-ff", "feature-c", "-m", "See #5 for context, unrelated change"]);

    const fromGitRun = runCli(["bootstrap", "corpus", "--from-git"], gitDir);
    check("--from-git corpus exits 0", fromGitRun.status === 0, fromGitRun.stderr);
    const fromGitPrs = readFileSync(path.join(gitDir, ".arkaik", "corpus", "prs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    check("--from-git produced 3 PRs", fromGitPrs.length === 3, String(fromGitPrs.length));
    const fromGitNumbers = fromGitPrs.map((p) => p.number);
    check(
      "--from-git numbers are all distinct (no collision)",
      new Set(fromGitNumbers).size === fromGitNumbers.length,
      JSON.stringify(fromGitNumbers),
    );
    const realFive = fromGitPrs.find((p) => p.title.startsWith("Merge pull request #5 "));
    check(
      "the anchored match won: only the GitHub-authored subject claims #5",
      realFive !== undefined && realFive.number === 5,
      JSON.stringify(fromGitPrs),
    );
    const mention = fromGitPrs.find((p) => p.title === "See #5 for context, unrelated change");
    check(
      "a mid-subject #5 mention did not steal the real PR's number",
      mention !== undefined && mention.number !== 5,
      JSON.stringify(fromGitPrs),
    );
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }

  const docs = JSON.parse(readFileSync(path.join(dir, ".arkaik", "corpus", "docs.json"), "utf8"));
  check("docs manifest found vision.md", docs.some((d) => d.path === "docs/vision.md"), JSON.stringify(docs));
  check("docs manifest carries the heading", docs.some((d) => d.title === "Vision"), JSON.stringify(docs));

  const surfacesRaw = readFileSync(path.join(dir, ".arkaik", "corpus", "surfaces.json"), "utf8");
  const surfaces = JSON.parse(surfacesRaw);
  check("surfaces found the page", surfaces.some((s) => s.path === "app/home/page.tsx"), JSON.stringify(surfaces));
  check(
    "surface classified as page (SURFACE_RULES ordering)",
    surfaces.find((s) => s.path === "app/home/page.tsx")?.kind === "page",
    JSON.stringify(surfaces),
  );

  check(
    "corpus gitignores .arkaik",
    readFileSync(path.join(dir, ".gitignore"), "utf8").includes(".arkaik/"),
    "no .gitignore entry",
  );

  const prsRaw = readFileSync(path.join(dir, ".arkaik", "corpus", "prs.jsonl"), "utf8");

  const again = runCli(["bootstrap", "corpus", "--from-json", payloadPath], dir);
  check("corpus is idempotent", again.status === 0, again.stderr);
  check(
    "gitignore not duplicated",
    readFileSync(path.join(dir, ".gitignore"), "utf8").match(/\.arkaik\//g).length === 1,
    readFileSync(path.join(dir, ".gitignore"), "utf8"),
  );
  check(
    "prs.jsonl is byte-identical on re-run",
    readFileSync(path.join(dir, ".arkaik", "corpus", "prs.jsonl"), "utf8") === prsRaw,
    "content differs between runs",
  );
  check(
    "surfaces.json is byte-identical on re-run",
    readFileSync(path.join(dir, ".arkaik", "corpus", "surfaces.json"), "utf8") === surfacesRaw,
    "content differs between runs",
  );

  // --- corpus option validation ---
  const missingValue = runCli(["bootstrap", "corpus", "--from-json"], dir);
  check("--from-json with no value exits 1", missingValue.status === 1, String(missingValue.status));
  check(
    "--from-json with no value fails fast instead of falling through to gh",
    missingValue.stderr.includes("Missing value for --from-json"),
    missingValue.stderr,
  );

  const unknownOpt = runCli(["bootstrap", "corpus", "--nope"], dir);
  check("corpus unknown option exits 1", unknownOpt.status === 1, String(unknownOpt.status));
  check("corpus unknown option reports the flag", unknownOpt.stderr.includes("Unknown option: --nope"), unknownOpt.stderr);

  const badLimit = runCli(["bootstrap", "corpus", "--from-json", payloadPath, "--limit", "abc"], dir);
  check("--limit with a non-integer exits 1", badLimit.status === 1, String(badLimit.status));
  check("--limit error names the bad value", badLimit.stderr.includes("abc"), badLimit.stderr);

  const badSince = runCli(["bootstrap", "corpus", "--from-json", payloadPath, "--since", "not-a-date"], dir);
  check("--since with an unparseable date exits 1", badSince.status === 1, String(badSince.status));
  check("--since error names the bad value", badSince.stderr.includes("not-a-date"), badSince.stderr);

  const noGitRoot = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-nogit-"));
  try {
    const outsideRepo = runCli(["bootstrap", "corpus", "--from-json", payloadPath], noGitRoot);
    check("corpus outside a repo root exits 1", outsideRepo.status === 1, String(outsideRepo.status));
    check(
      "corpus outside a repo root names the reason",
      outsideRepo.stderr.includes("repository root"),
      outsideRepo.stderr,
    );
  } finally {
    rmSync(noGitRoot, { recursive: true, force: true });
  }

  // --- plan with no profile: recon only ---
  const plan0 = runCli(["bootstrap", "plan"], dir);
  check("plan exits 0 without a profile", plan0.status === 0, plan0.stderr);
  const m0 = JSON.parse(readFileSync(path.join(dir, ".arkaik", "bootstrap", "manifest.json"), "utf8"));
  check("only the recon unit is planned", m0.units.length === 1, JSON.stringify(m0.units.map((u) => u.id)));
  check("recon unit is wave 0", m0.units[0].wave === 0, String(m0.units[0].wave));
  check("mode is greenfield with no bundle", m0.mode === "greenfield", m0.mode);

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

  // --- regression: decisions/status-arcs must not depend on eras existing ---
  // The decisions unit mines design docs; the status-arc unit arcs anatomy
  // nodes. Neither reads eras. Gating both on `profile.eras.length` means a
  // profile with real areas but zero eras (a young repo, or one where recon
  // judged there's no story worth splitting into eras yet) silently loses
  // decision-mining and status arcs even though areas — and therefore docs
  // and anatomy nodes — exist.
  const noErasDir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-noeras-"));
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
  const stubDir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-stub-"));
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

  // --- regression: agent-supplied unit ids reaching a filesystem path ---
  // Area ids and era slugs come from profile.json, written by an agent, and
  // become fragment filenames verbatim. An id containing "/" or ".." would
  // make the fragment path escape .arkaik/bootstrap/fragments/ entirely;
  // plan must refuse rather than mint a unit that writes outside its own
  // working directory.
  const unsafeIdDir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-unsafeid-"));
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

  const spaceIdDir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-spaceid-"));
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
  const dupIdDir = mkdtempSync(path.join(tmpdir(), "arkaik-bootstrap-dupid-"));
  try {
    mkdirSync(path.join(dupIdDir, ".arkaik", "bootstrap"), { recursive: true });
    writeFileSync(
      path.join(dupIdDir, ".arkaik", "bootstrap", "profile.json"),
      JSON.stringify({ areas: [], eras: [{ slug: "decisions", title: "Decisions era" }] }),
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
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
