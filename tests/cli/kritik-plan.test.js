#!/usr/bin/env node

/**
 * `arkaik kritik plan` end to end (docs/superpowers/specs/2026-11-11-kritik-planner-design.md):
 * acceptance steps 1 to 3 (a counts-only SEC:web plan, a part id that sorts
 * after every audit on disk, a prompt that names exactly its cells and never
 * records), every plan refusal in the spec's error table, the estimator flags
 * refused, `--json`, `--dry-run`, `--out` and `--status`.
 *
 * Drives the BUILT CLI in mkdtemp repos against the shipped criteria pack, like
 * kritik-scope.test.js beside it. The fixture is synthetic: a five-surface
 * profile like Pebbles', one recorded full audit of all 338 applicable cells
 * (generated from the pack, written as a file), plus a hand-named
 * `<month>-sec-web` and a `<month>-scoped` audit. Dates are computed, never
 * hard-coded, and plan ids are read back from `--json`.
 */

const { spawnSync } = require("child_process");
const { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { loadSchema } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

const { applicableCells } = loadSchema();
const PACK = JSON.parse(readFileSync(path.join(ROOT, "packages", "kritik-library", "framework.json"), "utf8"));
const SURFACES = ["web", "ios", "android", "admin", "supabase"];

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

const BUNDLE = JSON.stringify({
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
  edges: [],
});

// The fixture's hand-named audits only need to sort before any plan made
// after them, so their month may come from the clock. Plan ids never do: each
// is read back from the command that made it (--json, or the plan file), so a
// run across midnight cannot expect a day the plan was not made on.
const localDate = (date = new Date()) => ({
  month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
  day: String(date.getDate()).padStart(2, "0"),
});
const MONTH = localDate().month;
const PLAN_ID = /^\d{4}-\d{2}-zplan-\d{4}$/;
/** A well-formed plan id no test ever makes, for refusals that never read it. */
const UNMADE_PLAN = "2000-01-zplan-0100";
const SEC_WEB = ["SEC-01", "SEC-04", "SEC-05", "SEC-06", "SEC-07", "SEC-08"];
const ESTIMATOR = (flag) => `kritik: --${flag} is not available yet — the estimator ships later, and every plan is counts-only for now.`;

const dirs = [];
function repo({ bundle = true, surfaces = SURFACES } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-kritik-plan-"));
  dirs.push(dir);
  if (bundle) {
    mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), BUNDLE);
  }
  const run = (args) => spawnSync(process.execPath, [CLI, "kritik", ...args], { encoding: "utf8", cwd: dir });
  if (surfaces !== null) {
    const profile = run(["profile", ...surfaces.flatMap((surface) => ["--surface", surface])]);
    if (profile.status !== 0) {
      failures++;
      console.log(`FAIL: setup — profile\n${profile.stderr}`);
    }
  }
  const plansDir = path.join(dir, "docs", "quality", "plans");
  const writeScores = (auditId, assessments, extra = {}) => {
    mkdirSync(path.join(dir, "docs", "quality", "audits", auditId), { recursive: true });
    writeFileSync(
      path.join(dir, "docs", "quality", "audits", auditId, "scores.json"),
      JSON.stringify({ audit_id: auditId, framework_version: PACK.version, ...extra, assessments }, null, 2),
    );
  };
  return { dir, run, plansDir, writeScores };
}

const assessment = (criterion_id, surface, auditId) => ({
  criterion_id, surface, level: 2, evidence: `${criterion_id}.ts:1`, audit_id: auditId, ts: "2026-08-20T00:00:00.000Z",
});
/** Every applicable cell of the shipped pack over the five surfaces: a full audit. */
const fullAudit = (auditId) =>
  applicableCells(PACK, SURFACES).flatMap(({ criterion_id, surfaces }) => surfaces.map((surface) => assessment(criterion_id, surface, auditId)));
/** `finding open` with every flag it requires, for the criterion and surface given. */
const FINDING = (positionals) => [
  "finding", "open", ...positionals,
  "--title", "A defect", "--evidence", "file.ts:1", "--impact", "2", "--likelihood", "2", "--cost", "S",
];
const json = (result) => {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
};

try {
  // --- no profile --------------------------------------------------------------

  {
    const { run, plansDir } = repo({ surfaces: null });
    const noProfile = run(["plan", "--run", "SEC:web"]);
    check(
      "with no profile, plan refuses and points at `arkaik kritik profile`",
      noProfile.status === 1 && noProfile.stderr.includes("arkaik kritik profile") && !existsSync(plansDir),
      noProfile.stderr,
    );
  }

  // --- the fixture ---------------------------------------------------------------

  const { dir, run, plansDir, writeScores } = repo();
  const ok = (args, label) => {
    const result = run(args);
    if (result.status !== 0) {
      failures++;
      console.log(`FAIL: setup — ${label ?? args.join(" ")}\n${result.stderr}${result.stdout}`);
    }
    return result;
  };

  const full = fullAudit("2026-08");
  check("the fixture's full audit is 338 cells", full.length === 338, String(full.length));
  writeScores("2026-08", full, { commit: "abc1234" });
  ok(["matrix", "2026-08", "--record"]);
  writeScores(`${MONTH}-sec-web`, [assessment("SEC-01", "web", `${MONTH}-sec-web`)]);
  writeScores(`${MONTH}-scoped`, [assessment("SEC-04", "web", `${MONTH}-scoped`)], { scope: { since: "2026-08" } });

  // --- refusals: each exits 1 and writes nothing ---------------------------------------

  const help = run(["plan", "--help"]);
  check("plan --help prints its usage", help.status === 0 && help.stdout.includes("--run D:S") && help.stdout.includes("--status <id>"), help.stdout);

  const noRun = run(["plan"]);
  check("no --run is refused", noRun.status === 1 && noRun.stderr.includes("at least one --run"), noRun.stderr);

  for (const token of ["SEC", "SEC:", "SEC:web:x"]) {
    const bad = run(["plan", "--run", token]);
    check(`a malformed token (${token}) is refused, showing the token`, bad.status === 1 && bad.stderr.includes(token), bad.stderr);
  }

  const unknownDomain = run(["plan", "--run", "XYZ:web"]);
  check(
    "an unknown domain is refused, listing the codes",
    unknownDomain.status === 1 && unknownDomain.stderr.includes("XYZ") && unknownDomain.stderr.includes("A11Y") && unknownDomain.stderr.includes("AGT"),
    unknownDomain.stderr,
  );

  const unknownSurface = run(["plan", "--run", "SEC:api"]);
  check(
    "a surface the profile does not declare is refused, listing the profile's surfaces",
    unknownSurface.status === 1 && unknownSurface.stderr.includes("api") && unknownSurface.stderr.includes("supabase"),
    unknownSurface.stderr,
  );

  const wrongCase = run(["plan", "--run", "SEC:Web"]);
  check("a surface is matched literally: Web is not web", wrongCase.status === 1 && wrongCase.stderr.includes("Web"), wrongCase.stderr);

  const lens = run(["plan", "--run", "SEC:cross-surface"]);
  check("cross-surface is refused as a findings-only lens", lens.status === 1 && lens.stderr.includes("cross-surface") && lens.stderr.includes("lens"), lens.stderr);

  for (const flag of ["budget", "budget-tokens", "price", "tier"]) {
    const refused = run(["plan", "--run", "SEC:web", `--${flag}`, "5"]);
    check(`--${flag} is refused until the estimator ships`, refused.status === 1 && refused.stderr.trim() === ESTIMATOR(flag), refused.stderr);
  }

  const statusAndRun = run(["plan", "--status", UNMADE_PLAN, "--run", "SEC:web"]);
  check("--status with --run is refused", statusAndRun.status === 1 && statusAndRun.stderr.includes("--status"), statusAndRun.stderr);
  const statusAndOut = run(["plan", "--status", UNMADE_PLAN, "--out", path.join(dir, "elsewhere.json")]);
  check("--status with --out is refused", statusAndOut.status === 1 && statusAndOut.stderr.includes("--status"), statusAndOut.stderr);
  const statusAndDry = run(["plan", "--status", UNMADE_PLAN, "--dry-run"]);
  check("--status with --dry-run is refused", statusAndDry.status === 1 && statusAndDry.stderr.includes("--status"), statusAndDry.stderr);

  for (const flag of ["budget", "budget-tokens", "price", "tier"]) {
    const bare = run(["plan", "--run", "SEC:web", `--${flag}`]);
    check(`--${flag} given last with no value gets the same refusal`, bare.status === 1 && bare.stderr.trim() === ESTIMATOR(flag), bare.stderr);
  }

  const dryOut = run(["plan", "--run", "SEC:web", "--dry-run", "--out", path.join(dir, "elsewhere.json")]);
  check(
    "--dry-run with --out is refused in one line",
    dryOut.status === 1 && dryOut.stderr.trim().split("\n").length === 1 && dryOut.stderr.includes("--dry-run") && dryOut.stderr.includes("--out") &&
      !existsSync(path.join(dir, "elsewhere.json")),
    dryOut.stderr,
  );

  check("no refusal wrote a plan", !existsSync(plansDir));

  // --- --dry-run --------------------------------------------------------------------

  const dry = run(["plan", "--run", "SEC:web", "--counts-only", "--dry-run"]);
  const dryId = (dry.stdout.match(/Plan (\S+)/) ?? [])[1] ?? "";
  check(
    "--dry-run prints the plan and its prompt, and writes nothing",
    dry.status === 0 &&
      PLAN_ID.test(dryId) &&
      dry.stdout.includes("dry run — nothing written") &&
      dry.stdout.includes(`Run Kritik plan ${dryId}`) &&
      !existsSync(plansDir),
    dry.stdout + dry.stderr,
  );
  const dryJson = run(["plan", "--run", "SEC:web", "--dry-run", "--json"]);
  check(
    "--dry-run --json prints the plan file and writes nothing",
    dryJson.status === 0 && PLAN_ID.test(json(dryJson)?.planId ?? "") && json(dryJson).parts.length === 1 && !dryJson.stderr.includes("wrote") && !existsSync(plansDir),
    dryJson.stdout.slice(0, 300) + dryJson.stderr,
  );

  // --- acceptance step 1: a counts-only SEC:web plan -----------------------------------------

  const firstBefore = localDate();
  const first = run(["plan", "--run", "SEC:web", "--counts-only", "--json"]);
  const firstAfter = localDate();
  const plan = json(first);
  check("plan --json exits 0 and prints the plan", first.status === 0 && plan !== null, first.stdout + first.stderr);
  const FIRST_PLAN = plan?.planId ?? "missing";
  const planFile = path.join(plansDir, `${FIRST_PLAN}.json`);
  check(
    "the plan is the day's first: <month>-zplan-<day>00",
    [firstBefore, firstAfter].some(({ month, day }) => FIRST_PLAN === `${month}-zplan-${day}00`),
    FIRST_PLAN,
  );
  check(
    "it is written to docs/quality/plans/<planId>.json, exactly as printed",
    existsSync(planFile) && JSON.stringify(JSON.parse(readFileSync(planFile, "utf8"))) === JSON.stringify(plan),
  );
  const part = plan?.parts?.[0];
  check(
    "one part: SEC:web, 6 cells, 36 steps, included, no estimate",
    plan?.parts?.length === 1 &&
      part.domain === "SEC" && part.surface === "web" &&
      part.cells.length === 6 && part.steps === 36 &&
      part.status === "included" && part.estimate === null,
    JSON.stringify(part ?? null).slice(0, 300),
  );
  check(
    "the totals count the whole product: 6 of 338",
    plan?.totals?.cells === 6 && plan.totals.steps === 36 && plan.totals.applicableCells === 338 && plan.totals.tokens === null,
    JSON.stringify(plan?.totals),
  );
  check(
    "a plan made outside git carries no commit, and the library's version",
    plan?.commit === null && plan.frameworkVersion === PACK.version && plan.schema === "arkaik.kritik.plan/1",
  );
  check("the record command names the plan", plan?.recordCommand === `arkaik kritik matrix ${FIRST_PLAN} --record --plan`);

  // --- acceptance step 2: the part id sorts last ------------------------------------------------

  const partId = `${FIRST_PLAN}-sec-web`;
  check("the part's audit id is <planId>-sec-web", part?.auditId === partId, part?.auditId);
  const audits = readdirSync(path.join(dir, "docs", "quality", "audits"));
  check(
    "it sorts after every audit in the fixture, the hand-named and the scoped one included",
    audits.includes(`${MONTH}-sec-web`) && audits.includes(`${MONTH}-scoped`) && audits.every((id) => partId > id),
    audits.join(", "),
  );

  // --- acceptance step 3: the part prompt -----------------------------------------------------

  const scoreLines = (part?.prompt ?? "").split("\n").filter((line) => line.includes("kritik score"));
  check(
    "the part prompt names exactly the 6 cells",
    JSON.stringify(scoreLines.map((line) => line.trim().split(" ")[1])) === JSON.stringify(SEC_WEB),
    scoreLines.join("\n"),
  );
  check("every score line passes --audit <partId>", scoreLines.every((line) => line.includes(`--audit ${partId}`)), scoreLines.join("\n"));
  check("the part prompt never records", !(part?.prompt ?? "--record").includes("--record"));
  check(
    "the combined prompt records once, last",
    (plan?.prompt ?? "").split("--record").length === 2 && plan.prompt.trimEnd().endsWith(`\`${plan.recordCommand}\``),
  );

  // --- the human summary, a second plan, duplicates ------------------------------------------------

  const second = run(["plan", "--run", "SEC:web", "--run", "AGT:ios", "--run", "sec:web"]);
  // Read back from the plan files: the one that is not the first.
  const SECOND_PLAN = readdirSync(plansDir).map((name) => name.replace(/\.json$/, "")).find((id) => id !== FIRST_PLAN) ?? "missing";
  const sameDay = SECOND_PLAN.slice(0, 16) === FIRST_PLAN.slice(0, 16);
  check(
    "a second plan the same day takes the next counter",
    second.status === 0 &&
      second.stdout.includes(`Plan ${SECOND_PLAN}`) &&
      (sameDay ? SECOND_PLAN === `${FIRST_PLAN.slice(0, 16)}01` : PLAN_ID.test(SECOND_PLAN) && SECOND_PLAN > FIRST_PLAN),
    second.stdout + second.stderr,
  );
  check(
    "the summary prints each part, the totals against the whole product, and the file it wrote",
    second.stdout.includes(`${SECOND_PLAN}-sec-web`) &&
      second.stdout.includes(`${SECOND_PLAN}-agt-ios`) &&
      second.stdout.includes("of 338 applicable cells") &&
      // tmpdir() may sit behind a symlink (macOS /var -> /private/var), so match the tail.
      second.stdout.includes(path.join("docs", "quality", "plans", `${SECOND_PLAN}.json`)) &&
      second.stdout.includes("  wrote "),
    second.stdout,
  );
  check("a duplicate --run is merged, with a note", second.stdout.includes("note:"), second.stdout);
  const secondPlan = JSON.parse(readFileSync(path.join(plansDir, `${SECOND_PLAN}.json`), "utf8"));
  check(
    "the duplicate collapsed: two parts, 14 cells, 78 steps",
    secondPlan.parts.length === 2 && secondPlan.totals.cells === 14 && secondPlan.totals.steps === 78,
    JSON.stringify(secondPlan.totals),
  );
  check(
    "the summary ends with the combined prompt and the record command",
    second.stdout.includes(secondPlan.prompt) && second.stdout.includes(`After every part is scored:  ${secondPlan.recordCommand}`),
  );

  // --- --out -------------------------------------------------------------------------------

  const outside = path.join(dir, "elsewhere", "plan.json");
  const out = run(["plan", "--run", "AGT:ios", "--out", outside]);
  const outPlan = existsSync(outside) ? JSON.parse(readFileSync(outside, "utf8")) : null;
  check(
    "--out writes the plan there, and says where it must be before recording",
    out.status === 0 && outPlan !== null && out.stdout.includes("move the file there before recording") &&
      !existsSync(path.join(plansDir, `${outPlan.planId}.json`)),
    out.stdout + out.stderr,
  );
  check(
    "--out says the id is reserved only once the file is under docs/quality/plans/",
    out.stdout.includes(`${outPlan?.planId} is reserved only once the file is under docs/quality/plans/`),
    out.stdout,
  );
  const outStatus = run(["plan", "--status", outPlan?.planId ?? "missing"]);
  check("--status reads only docs/quality/plans/", outStatus.status === 1 && outStatus.stderr.includes("no plan at"), outStatus.stderr);
  const outAgain = run(["plan", "--run", "AGT:ios", "--out", outside]);
  check("--out never overwrites a file", outAgain.status === 1 && outAgain.stderr.includes("already exists"), outAgain.stderr);

  // --- --status ------------------------------------------------------------------------------

  const statusJson = (id) => json(run(["plan", "--status", id, "--json"]));
  const fresh = statusJson(FIRST_PLAN);
  check(
    "--status: an unscored part is not started",
    fresh?.plan_id === FIRST_PLAN && fresh.recorded === false && fresh.parts[0].progress === "not started" && fresh.parts[0].scored === 0,
    JSON.stringify(fresh),
  );

  // Run the prompt's own score line, so its shape is proven to be a real command.
  const line = scoreLines[0];
  const [, criterion, surface, audit] = line.match(/arkaik kritik score (\S+) (\S+) <level> --evidence "<file:line …>" --audit (\S+)`/) ?? [];
  ok(["score", criterion, surface, "2", "--evidence", "app/auth.ts:12", "--audit", audit], "the prompt's first score line");
  ok(["score", "PRV-01", "web", "3", "--evidence", "app/privacy.ts:4", "--audit", partId], "a stray score");
  // And its finding line, placeholders filled: every flag it needs is spelled out.
  {
    const findingCommand = ((part?.prompt ?? "").match(/`arkaik kritik (finding open [^`]+)`/) ?? [])[1] ?? "";
    const filled = findingCommand
      .replace("<criterion>", criterion)
      .replace('"<one line>"', '"Session cookie lacks SameSite"')
      .replace(/<1-5>/g, "2")
      .replace("<S|M|L|XL>", "S")
      .replace('"<file:line …>"', '"app/auth.ts:30"');
    const argv = [...filled.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
    const opened = run(argv);
    check("the prompt's finding command runs as written once its placeholders are filled", opened.status === 0 && opened.stdout.includes(partId), opened.stderr + filled);
  }

  const started = statusJson(FIRST_PLAN);
  check(
    "--status: one plan cell scored is in progress, 1 of 6",
    started?.parts[0].progress === "in progress" && started.parts[0].scored === 1 && started.parts[0].missing.length === 5,
    JSON.stringify(started?.parts[0]),
  );
  check(
    "--status: a score outside the plan is reported as stray",
    JSON.stringify(started?.parts[0].stray) === JSON.stringify([{ criterion_id: "PRV-01", surface: "web" }]),
    JSON.stringify(started?.parts[0].stray),
  );
  const startedText = run(["plan", "--status", FIRST_PLAN]);
  check(
    "--status prints progress, the cells still to score, and the stray to remove",
    startedText.status === 0 &&
      startedText.stdout.includes("not recorded") &&
      startedText.stdout.includes("in progress") &&
      startedText.stdout.includes("1 of 6") &&
      startedText.stdout.includes("SEC-04 on web") &&
      startedText.stdout.includes("outside the plan") &&
      startedText.stdout.includes("PRV-01 on web"),
    startedText.stdout,
  );

  for (const id of SEC_WEB.slice(1)) ok(["score", id, "web", "3", "--evidence", `${id}.ts:1`, "--audit", partId], `score ${id}`);
  // Every plan cell scored, and the stray still there: not finished.
  const scoredWithStray = run(["plan", "--status", FIRST_PLAN]);
  const strayRow = scoredWithStray.stdout.split("\n").find((row) => row.includes(partId)) ?? "";
  check(
    "--status: a fully scored part holding a stray score says so in its row",
    scoredWithStray.status === 0 && strayRow.includes("scored, 1 outside the plan") && strayRow.includes("6 of 6"),
    scoredWithStray.stdout,
  );
  check(
    "--status: with a stray left, the footer never says to record once every part is scored",
    !scoredWithStray.stdout.includes("record once every part is scored") && !scoredWithStray.stdout.includes("every part is scored — record it once"),
    scoredWithStray.stdout,
  );
  check(
    "--status: the note says how to remove a stray",
    scoredWithStray.stdout.includes(`delete its row from docs/quality/audits/${partId}/scores.json`),
    scoredWithStray.stdout,
  );
  const strayJson = statusJson(FIRST_PLAN);
  check(
    "--status --json mirrors it: the part's summary, and not ready to record",
    strayJson?.parts[0].progress === "scored" && strayJson.parts[0].summary === "scored, 1 outside the plan" && strayJson.ready_to_record === false,
    JSON.stringify(strayJson),
  );
  const partScores = path.join(dir, "docs", "quality", "audits", partId, "scores.json");
  const scoresFile = JSON.parse(readFileSync(partScores, "utf8"));
  writeFileSync(partScores, JSON.stringify({ ...scoresFile, assessments: scoresFile.assessments.filter((a) => a.criterion_id !== "PRV-01") }, null, 2));
  const done = run(["plan", "--status", FIRST_PLAN]);
  check(
    "--status: every plan cell scored and nothing stray says to record, naming the command",
    done.status === 0 && done.stdout.includes("scored") && done.stdout.includes("6 of 6") && done.stdout.includes("every part is scored") &&
      done.stdout.includes(`arkaik kritik matrix ${FIRST_PLAN} --record --plan`),
    done.stdout,
  );
  const doneJson = statusJson(FIRST_PLAN);
  check(
    "--status --json: once clean, the summary is the progress and the plan is ready to record",
    doneJson?.parts[0].summary === "scored" && doneJson.ready_to_record === true,
    JSON.stringify(doneJson),
  );
  check("--status writes nothing", JSON.stringify(JSON.parse(readFileSync(planFile, "utf8"))) === JSON.stringify(plan));

  for (const id of ["../../../etc/passwd", "notes", `${FIRST_PLAN}-sec-web`]) {
    const notAnId = run(["plan", "--status", id]);
    check(
      `--status refuses ${JSON.stringify(id)}, which is not a plan id, before reading anything`,
      notAnId.status === 1 && notAnId.stderr.includes("is not a plan id") && !notAnId.stderr.includes("no plan at"),
      notAnId.stderr,
    );
  }
  {
    // A valid plan file, saved under another plan's name.
    const misnamed = `${FIRST_PLAN.slice(0, -2)}88`;
    writeFileSync(path.join(plansDir, `${misnamed}.json`), readFileSync(planFile, "utf8"));
    const wrongFile = run(["plan", "--status", misnamed]);
    check(
      "--status refuses a plan file whose planId is not the id it is named for",
      wrongFile.status === 1 && wrongFile.stderr.includes(`${misnamed}.json`) && wrongFile.stderr.includes(`"${FIRST_PLAN}"`),
      wrongFile.stderr,
    );
    rmSync(path.join(plansDir, `${misnamed}.json`));
  }

  const missing = run(["plan", "--status", `${FIRST_PLAN.slice(0, 16)}77`]);
  check("--status on a plan that does not exist is refused", missing.status === 1 && missing.stderr.includes("no plan at"), missing.stderr);

  // Last in this repo: a plan file named past every counter blocks later plans.
  const brokenId = `${FIRST_PLAN.slice(0, 16)}99`;
  writeFileSync(path.join(plansDir, `${brokenId}.json`), JSON.stringify({ schema: "arkaik.kritik.plan/9" }));
  const broken = run(["plan", "--status", brokenId]);
  check(
    "a plan file that fails the schema is refused, naming the path and the issue",
    broken.status === 1 && broken.stderr.includes(`${brokenId}.json`) && broken.stderr.includes("schema"),
    broken.stderr,
  );

  // --- sibling parts never warn about each other ------------------------------------------------
  //
  // Parts sort alphabetically, not in plan order: scoring AGT:ios after
  // SEC:web's directory exists finds a later audit on disk, but sibling parts
  // never share a cell, so no ordering note applies.

  {
    const { run: runSib } = repo();
    const made = json(runSib(["plan", "--run", "SEC:web", "--run", "AGT:ios", "--json"]));
    const [secPart, agtPart] = made?.parts?.map((p) => p.auditId) ?? [];
    const secScore = runSib(["score", "SEC-01", "web", "2", "--evidence", "app/auth.ts:1", "--audit", secPart]);
    const agtScore = runSib(["score", "AGT-01", "ios", "2", "--evidence", "ios/agent.swift:1", "--audit", agtPart]);
    check(
      "scoring the alphabetically earlier part second prints no ordering note",
      secScore.status === 0 && agtScore.status === 0 && agtPart < secPart && !agtScore.stdout.includes("note:") && !agtScore.stdout.includes("sorts before"),
      agtScore.stdout + agtScore.stderr,
    );
    const agtFinding = runSib(FINDING(["AGT-01", "ios", "--audit", agtPart]));
    check("a sibling part that sorts later never blocks a finding either", agtFinding.status === 0, agtFinding.stderr);
  }

  // --- a part that no longer sorts last is refused -----------------------------------------------

  {
    const { dir: d, run: runOut, writeScores: write } = repo();
    const made = json(runOut(["plan", "--run", "SEC:web", "--run", "AGT:ios", "--json"]));
    const [secPart, agtPart] = made?.parts?.map((p) => p.auditId) ?? [];
    // A scoped re-audit named after the newest part, made while AGT:ios is unscored.
    const scoped = `${secPart}-scoped`;
    write(scoped, [assessment("SEC-01", "web", scoped)], { scope: { since: "2026-08" } });
    const partDir = (id) => path.join(d, "docs", "quality", "audits", id);
    const refused = runOut(["score", "AGT-01", "ios", "2", "--evidence", "ios/agent.swift:1", "--audit", agtPart]);
    check(
      "a scoped directory named after a sibling part blocks the earlier part's score, naming it, and writes nothing",
      refused.status === 1 &&
        refused.stderr.includes(`"${scoped}"`) &&
        refused.stderr.includes("lose the merge") &&
        refused.stderr.includes("new plan for the parts not yet scored") &&
        !existsSync(partDir(agtPart)),
      refused.stderr + refused.stdout,
    );
    check("the refusal replaces the ordering note", !refused.stdout.includes("note:") && !refused.stderr.includes("Name a new audit"), refused.stderr);
    const refusedFinding = runOut(FINDING(["AGT-01", "ios", "--audit", agtPart]));
    check(
      "and blocks a finding opened into it, writing nothing",
      refusedFinding.status === 1 && refusedFinding.stderr.includes(`"${scoped}"`) && !existsSync(partDir(agtPart)),
      refusedFinding.stderr,
    );
    const refusedSec = runOut(["score", "SEC-04", "web", "2", "--evidence", "app/x.ts:1", "--audit", secPart]);
    check("it blocks the part it is named after too", refusedSec.status === 1 && refusedSec.stderr.includes(`"${scoped}"`), refusedSec.stderr);
  }
  {
    const { dir: d, run: runLater } = repo();
    const earlier = json(runLater(["plan", "--run", "SEC:web", "--json"]));
    const later = json(runLater(["plan", "--run", "AGT:ios", "--json"]));
    const earlierPart = earlier?.parts?.[0]?.auditId;
    const laterPart = later?.parts?.[0]?.auditId;
    const laterScore = runLater(["score", "AGT-01", "ios", "2", "--evidence", "ios/agent.swift:1", "--audit", laterPart]);
    const blocked = runLater(["score", "SEC-01", "web", "2", "--evidence", "app/auth.ts:1", "--audit", earlierPart]);
    check(
      "a later plan's part directory blocks an earlier plan's part",
      laterScore.status === 0 &&
        blocked.status === 1 &&
        blocked.stderr.includes(`"${laterPart}"`) &&
        blocked.stderr.includes(earlier?.planId) &&
        !existsSync(path.join(d, "docs", "quality", "audits", earlierPart)),
      blocked.stderr,
    );
  }

  // --- a plan file is never overwritten ---------------------------------------------------------
  //
  // listPlanIds keeps the plan id of every file, so the only way onto an
  // existing path is a race (another session writing the same id between this
  // one's read and its write). A directory named like the next plan file stands
  // in for it: listPlanIds skips it, the write would land on it.

  {
    const { run: runTaken, plansDir: takenPlans } = repo();
    const next = json(runTaken(["plan", "--run", "SEC:web", "--dry-run", "--json"]))?.planId;
    mkdirSync(path.join(takenPlans, `${next}.json`), { recursive: true });
    const taken = runTaken(["plan", "--run", "SEC:web"]);
    check(
      "a plan whose default path already exists is refused, naming the path",
      taken.status === 1 && taken.stderr.includes(`${next}.json already exists`) && readdirSync(takenPlans).length === 1,
      taken.stderr + taken.stdout,
    );
  }

  // --- a stray JSON file under plans/ is not a plan -----------------------------------------------

  {
    const { run: runStray, plansDir: strayPlans } = repo();
    mkdirSync(strayPlans, { recursive: true });
    writeFileSync(path.join(strayPlans, "notes.json"), "{}");
    const made = runStray(["plan", "--run", "SEC:web", "--json"]);
    check("a JSON file under plans/ whose name is not a plan id never blocks a plan", made.status === 0 && json(made)?.planId !== undefined, made.stderr);
  }

  // --- zero cells -----------------------------------------------------------------------------

  {
    const { run: runCli, plansDir: cliPlans } = repo({ surfaces: ["web", "cli"] });
    const zero = runCli(["plan", "--run", "SEC:cli"]);
    check(
      "a pair with no applicable cell is refused, naming the domain and the surface",
      zero.status === 1 && zero.stderr.includes('no SEC criterion applies to "cli"') && !existsSync(cliPlans),
      zero.stderr,
    );
  }

  // --- no counter sorts last -------------------------------------------------------------------

  {
    const { dir: late, run: runLate, plansDir: latePlans } = repo();
    // Past every counter of the month the plan is made in, read back from a dry run.
    const ahead = `${(json(runLate(["plan", "--run", "SEC:web", "--dry-run", "--json"]))?.planId ?? MONTH).slice(0, 7)}-zzz`;
    mkdirSync(path.join(late, "docs", "quality", "audits", ahead), { recursive: true });
    const blocked = runLate(["plan", "--run", "SEC:web"]);
    check(
      "an audit directory past every counter is refused, naming the id that blocks the sort",
      blocked.status === 1 && blocked.stderr.includes(`"${ahead}"`) && !existsSync(latePlans),
      blocked.stderr,
    );

    // The same id, recorded in the journal but with no directory: still known.
    rmSync(path.join(late, "docs", "quality", "audits", ahead), { recursive: true, force: true });
    appendFileSync(
      path.join(late, "docs", "arkaik", "journal.jsonl"),
      `${JSON.stringify({ id: "01ZZZZZZZZZZZZZZZZZZZZZZZZ", ts: new Date().toISOString(), type: "quality.audit.completed", audit_id: ahead, framework_version: PACK.version, actor: "test" })}\n`,
    );
    const recordedBlock = runLate(["plan", "--run", "SEC:web"]);
    check(
      "a recorded audit id is known too, even with no directory",
      recordedBlock.status === 1 && recordedBlock.stderr.includes(`"${ahead}"`) && !existsSync(latePlans),
      recordedBlock.stderr,
    );
  }
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll kritik plan checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
