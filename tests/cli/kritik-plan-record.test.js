#!/usr/bin/env node

/**
 * Recording a planned partial audit — `arkaik kritik matrix <planId> --record --plan`
 * (docs/superpowers/specs/2026-11-11-kritik-planner-design.md, "matrix --record --plan").
 *
 * The spec's eight acceptance steps end to end, every refusal of the record function,
 * the CLI's own refusals around a plan, coverage beside every roll-up, the first audit
 * that is a plan, the scope's anchor guard, and `regressions` reading a plan's parts
 * as one reading.
 *
 * Drives the BUILT CLI (`test:cli` builds it first) in mkdtemp repos against the
 * shipped criteria pack. The fixture is synthetic: a five-surface profile, a full
 * audit's 338 assessments generated from `applicableCells`, findings and part scores
 * written as files. No model is called. TypeScript is reached only through
 * tests/schema/load-schema.js — CI runs Node 20, which cannot require a .ts file.
 *
 * Plan ids are never computed from the clock: each is read back from the plan file
 * `kritik plan` wrote, so a run across midnight cannot expect a day the plan was not
 * made on. Hand-named audits that only need to sort before a later plan may take
 * their month from the clock; ones that must sort after a plan take it from its id.
 *
 * A plan record clears a stale cell only for a resolution that happened before the
 * plan's part scored that cell (the `ts` of the part's assessment), so part scores
 * that should clear a cell are stamped when they are written — after the fixture's
 * resolutions — and ones that should not keep the full audit's older stamp.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
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
const pack = JSON.parse(readFileSync(path.join(ROOT, "packages", "kritik-library", "framework.json"), "utf8"));
const SURFACES = ["web", "ios", "android", "admin", "supabase"];
/** Every applicable (criterion, surface) pair — a full audit's cells, 338 on the shipped pack. */
const ALL_CELLS = applicableCells(pack, SURFACES).flatMap((entry) => entry.surfaces.map((surface) => [entry.criterion_id, surface]));
const APPLICABLE = Object.fromEntries(SURFACES.map((surface) => [surface, ALL_CELLS.filter(([, s]) => s === surface).length]));
const FULL = "2026-01";
/** When the full audit's cells were scored: before every resolution the fixture records. */
const OLD_TS = "2026-01-15T00:00:00.000Z";

// Hand-named audits that only have to sort BEFORE a plan made later may take
// their month from the clock. Plan ids never do.
const now = new Date();
const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const PLAN_ID = /^\d{4}-\d{2}-zplan-\d{2}00$/;

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

const dirs = [];
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-kritik-plan-record-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), BUNDLE);
  const at = (...parts) => path.join(dir, ...parts);
  const run = (args) => spawnSync(process.execPath, [CLI, "kritik", ...args], { encoding: "utf8", cwd: dir });
  const ok = (args) => {
    const result = run(args);
    if (result.status !== 0) {
      failures++;
      console.log(`FAIL: setup — kritik ${args.join(" ")}\n${result.stderr}${result.stdout}`);
    }
    return result;
  };
  const writeJson = (relative, value) => {
    const target = at(relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  };
  /** One audit's scores.json. `ts` defaults to the full audit's stamp; pass "now" to stamp the write's own time. */
  const writeScores = (auditId, cells, level, ts = OLD_TS) => {
    const stamp = ts === "now" ? new Date().toISOString() : ts;
    writeJson(`docs/quality/audits/${auditId}/scores.json`, {
      audit_id: auditId,
      framework_version: pack.version,
      assessments: cells.map(([criterion_id, surface]) => ({
        criterion_id,
        surface,
        level,
        evidence: `${criterion_id}.ts:1`,
        audit_id: auditId,
        ts: stamp,
      })),
    });
  };
  const journal = () => {
    const file = at("docs", "arkaik", "journal.jsonl");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const findingsText = () => {
    const audits = at("docs", "quality", "audits");
    if (!existsSync(audits)) return "";
    return readdirSync(audits)
      .sort()
      .map((id) => {
        const file = path.join(audits, id, "findings.json");
        return `${id}\n${existsSync(file) ? readFileSync(file, "utf8") : "-"}`;
      })
      .join("\n");
  };
  const plans = () => {
    const folder = at("docs", "quality", "plans");
    return existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort() : [];
  };
  /** A plan made through the real `kritik plan`, read back from the file it wrote. */
  const makePlan = (...runs) => {
    const before = plans();
    ok(["plan", ...runs.flatMap((token) => ["--run", token]), "--counts-only"]);
    const made = plans().filter((id) => !before.includes(id));
    if (made.length !== 1) {
      failures++;
      console.log(`FAIL: setup — kritik plan ${runs.join(" ")} wrote ${made.length} plan files`);
      return { planId: "", parts: [] };
    }
    return JSON.parse(readFileSync(at("docs", "quality", "plans", `${made[0]}.json`), "utf8"));
  };
  const scopeJson = () => {
    try {
      return JSON.parse(run(["scope", "--json"]).stdout);
    } catch {
      return {};
    }
  };
  const scopeKeys = () => (scopeJson().cells ?? []).map((cell) => `${cell.criterion_id}::${cell.surface}`).sort();
  return { dir, at, run, ok, writeJson, writeScores, journal, findingsText, makePlan, scopeJson, scopeKeys };
}

const finding = (id, criterionId, surface) => ({
  id,
  criterion_id: criterionId,
  surface,
  title: `${criterionId} on ${surface}`,
  detail: `${criterionId} on ${surface}`,
  evidence: "x.ts:1",
  impact: 2,
  likelihood: 2,
  cost: "S",
  status: "open",
});

/** A five-surface repo with one full audit recorded and two of its findings resolved after it (spec step 4). */
function auditedRepo() {
  const r = repo();
  r.ok(["profile", ...SURFACES.flatMap((surface) => ["--surface", surface])]);
  r.writeScores(FULL, ALL_CELLS, 2);
  r.writeJson(`docs/quality/audits/${FULL}/findings.json`, {
    audit_id: FULL,
    framework_version: pack.version,
    findings: [
      finding("F-2026-01-SEC-web-01", "SEC-01", "web"),
      finding("F-2026-01-AGT-ios-01", "AGT-01", "ios"),
      finding("F-2026-01-PRV-web-01", "PRV-01", "web"),
    ],
  });
  r.ok(["matrix", FULL, "--record"]);
  r.ok(["finding", "resolve", "F-2026-01-SEC-web-01", "--by", "https://github.com/o/r/pull/1"]);
  r.ok(["finding", "resolve", "F-2026-01-AGT-ios-01", "--by", "https://github.com/o/r/pull/2"]);
  return r;
}

const cellsOf = (part) => (part?.cells ?? []).map((cell) => [cell.criterion_id, cell.surface]);

/** A refusal: exit 1, nothing appended to the journal, and the message says each needle. */
function refuses(target, label, args, needles) {
  const before = target.journal().length;
  const result = target.run(args);
  check(
    `${label}: refused with exit 1, nothing appended`,
    result.status === 1 && target.journal().length === before,
    `status ${result.status}\n${result.stderr}${result.stdout.slice(0, 300)}`,
  );
  for (const needle of needles) check(`${label}: says "${needle}"`, result.stderr.includes(needle), result.stderr);
}

try {
  // === Acceptance: Pebbles, SEC on web (spec "Acceptance", steps 1 to 8) =========

  const a = auditedRepo();
  // Two hand-named audits the part has to sort after (step 2).
  mkdirSync(a.at("docs", "quality", "audits", `${MONTH}-sec-web`), { recursive: true });
  mkdirSync(a.at("docs", "quality", "audits", `${MONTH}-scoped`), { recursive: true });

  // 1. The plan.
  const plan = a.makePlan("SEC:web");
  const planId = plan.planId;
  const part = plan.parts[0] ?? { cells: [] };
  check(
    "1. `plan --run SEC:web --counts-only` writes <YYYY-MM>-zplan-<DD>00.json",
    PLAN_ID.test(planId) && existsSync(a.at("docs", "quality", "plans", `${planId}.json`)),
    planId,
  );
  check(
    "1. one part: 6 cells, 36 steps, included",
    plan.parts.length === 1 && part.cells.length === 6 && part.steps === 36 && part.status === "included",
    JSON.stringify({ cells: part.cells.length, steps: part.steps, status: part.status }),
  );

  // 2. Sort-last.
  const others = readdirSync(a.at("docs", "quality", "audits"));
  check(
    "2. the part id sorts after every audit id, including a hand-named <month>-sec-web and <month>-scoped",
    others.length === 3 && others.every((id) => part.auditId > id),
    `${part.auditId} vs ${others.join(", ")}`,
  );

  // 3. The part's prompt.
  const prompt = part.prompt ?? "";
  const named = [...prompt.matchAll(/^\s+- (\S+) on web: `arkaik kritik score /gm)].map((match) => match[1]).sort();
  check("3. the part prompt names exactly its 6 cells", JSON.stringify(named) === JSON.stringify(part.cells.map((cell) => cell.criterion_id).sort()), JSON.stringify(named));
  check(
    "3. every score line passes --audit <partId>",
    prompt.split("\n").filter((line) => line.includes("kritik score")).every((line) => line.includes(`--audit ${part.auditId}`)),
    prompt,
  );
  check("3. the part prompt never records", !prompt.includes("--record"));

  // 4. The journal holds a resolution on SEC on web and one on AGT on iOS, after the full audit.
  check("4. the scope lists the SEC-on-web and the AGT-on-iOS cells", JSON.stringify(a.scopeKeys()) === JSON.stringify(["AGT-01::ios", "SEC-01::web"]), JSON.stringify(a.scopeKeys()));

  // 5. The part's scores — scored now, after both resolutions — then the record.
  a.writeScores(part.auditId, cellsOf(part), 4, "now");
  const findingsBefore = a.findingsText();
  const journalBefore = a.journal().length;

  const preview = a.run(["matrix", planId, "--plan"]);
  check(
    "a preview (`matrix <planId> --plan`) prints the plan's reading and writes nothing",
    preview.status === 0 &&
      preview.stdout.includes(`planned partial audit ${planId}: 6 cells re-scored in 1 part since ${FULL}`) &&
      a.journal().length === journalBefore &&
      !existsSync(a.at("docs", "quality", "audits", planId)),
    preview.stderr + preview.stdout.slice(-600),
  );

  const recorded = a.run(["matrix", planId, "--record", "--plan"]);
  check("5. `matrix <planId> --record --plan` records", recorded.status === 0, recorded.stderr + recorded.stdout.slice(-400));
  const appended = a.journal().slice(journalBefore);
  const event = appended[0] ?? {};
  check(
    "5. exactly one event, a quality.audit.completed under the plan id",
    appended.length === 1 && event.type === "quality.audit.completed" && event.audit_id === planId,
    JSON.stringify(appended.map((e) => [e.type, e.audit_id])),
  );
  check("5. the record writes no audit directory for the plan", !existsSync(a.at("docs", "quality", "audits", planId)));

  // 6. The event.
  const scope = event.scope ?? {};
  check("6. scope.partial is true and scope.plan is the plan id", scope.partial === true && scope.plan === planId, String(JSON.stringify(scope)).slice(0, 300));
  check(
    "6. scope.scored holds the 6 cells and scope.parts the one part",
    scope.cells === 6 &&
      JSON.stringify([...(scope.scored ?? [])].sort()) === JSON.stringify(part.cells.map((cell) => `${cell.criterion_id}::web`).sort()) &&
      JSON.stringify(scope.parts) === JSON.stringify([part.auditId]),
    String(JSON.stringify(scope)).slice(0, 400),
  );
  check("6. since is the full audit the plan followed", scope.since === FULL, String(scope.since));
  check(
    "6. coverage: 6 re-scored, every applicable cell assessed",
    scope.coverage?.scored === 6 &&
      scope.coverage?.assessed === ALL_CELLS.length &&
      scope.coverage?.applicable === ALL_CELLS.length &&
      scope.coverage?.surfaces?.web?.applicable === APPLICABLE.web,
    String(JSON.stringify(scope.coverage)).slice(0, 300),
  );
  check(
    "6. the recorded matrix is the merged one: SEC on web at the part's 100, every other cell at its last score",
    event.scores?.web?.SEC === 100 && event.scores?.ios?.SEC === 50 && Object.keys(event.scores ?? {}).length === SURFACES.length,
    JSON.stringify(event.scores?.web),
  );
  check("6. so its web composite is not the 6-cell score", Object.values(event.scores?.web ?? {}).some((score) => score !== 100), JSON.stringify(event.scores?.web));

  // 7. Findings untouched; the window closed per cell.
  check("7. no finding changed status", a.findingsText() === findingsBefore);
  check("7. AGT on iOS is still listed and SEC on web is not", JSON.stringify(a.scopeKeys()) === JSON.stringify(["AGT-01::ios"]), JSON.stringify(a.scopeKeys()));
  check("7. the scope is still measured from the full audit", a.scopeJson().since === FULL, String(a.scopeJson().since));

  // 8. The same sequence through today's workaround, in a second repo.
  const b = auditedRepo();
  check("8. the second repo starts from the same scope", JSON.stringify(b.scopeKeys()) === JSON.stringify(["AGT-01::ios", "SEC-01::web"]), JSON.stringify(b.scopeKeys()));
  const handNamed = `${MONTH}-sec-web`;
  b.writeScores(handNamed, cellsOf(part), 4, "now");
  b.ok(["matrix", handNamed, "--record", "--scope"]);
  check(
    "8. `matrix <id> --record --scope` drops the AGT-on-iOS cell from the scope: the trap",
    b.scopeJson().since === handNamed && !b.scopeKeys().includes("AGT-01::ios"),
    String(JSON.stringify(b.scopeJson())).slice(0, 300),
  );

  // === Every refusal of the record function exits 1 and appends nothing =========

  const r = auditedRepo();
  const rPlan = r.makePlan("SEC:web");
  const rPart = rPlan.parts[0] ?? { cells: [] };
  const rCells = cellsOf(rPart);
  const recordArgs = ["matrix", rPlan.planId, "--record", "--plan"];

  refuses(r, "a part with no directory", recordArgs, [
    "6 plan cells have no score yet",
    `${rPart.auditId}: no audit directory in this checkout`,
    "another worktree",
    `plan --status ${rPlan.planId}`,
  ]);
  r.writeScores(rPart.auditId, rCells.slice(0, 3), 3);
  refuses(r, "plan cells with no score", recordArgs, [
    "3 plan cells have no score yet",
    `${rPart.auditId}: ${rCells.slice(3).map(([criterion]) => `${criterion} on web`).join(", ")}`,
  ]);
  r.writeScores(rPart.auditId, [...rCells, ["PRV-01", "web"]], 3);
  refuses(r, "a score outside the plan", recordArgs, [
    "1 score outside plan",
    `${rPart.auditId}: PRV-01 on web`,
    `delete its row from docs/quality/audits/${rPart.auditId}/scores.json`,
  ]);
  // The part's scores keep the full audit's old stamp: scored BEFORE the fixture's resolutions.
  r.writeScores(rPart.auditId, rCells, 3);

  const planFile = r.at("docs", "quality", "plans", `${rPlan.planId}.json`);
  const planText = readFileSync(planFile, "utf8");
  writeFileSync(planFile, JSON.stringify({ ...rPlan, frameworkVersion: "0.0.1" }, null, 2));
  refuses(r, "a framework that moved since the plan", recordArgs, ["the cells have moved", "0.0.1", "--run SEC:web"]);
  writeFileSync(planFile, JSON.stringify({ ...rPlan, parts: [{ ...rPart, cells: rPart.cells.slice(1) }] }, null, 2));
  refuses(r, "cells that moved since the plan", recordArgs, ["the cells have moved", `SEC:web gained ${rPart.cells[0]?.criterion_id}`]);
  writeFileSync(planFile, planText);

  // An audit that now sorts after the part — a scoped re-audit or another plan
  // made meanwhile — would win the merge on every cell both hold.
  const foreign = `${rPlan.planId.slice(0, 7)}-zz-foreign`;
  r.writeScores(foreign, [["SEC-01", "web"]], 1);
  refuses(r, "a part an audit now sorts after", recordArgs, [
    `${rPart.auditId}: "${foreign}"`,
    "would lose the merge",
    "Make a new plan for the affected parts",
    "--run SEC:web",
  ]);
  rmSync(r.at("docs", "quality", "audits", foreign), { recursive: true, force: true });

  // A file whose name is a plan id it was never written under: the schema refuses it.
  const broken = "2000-01-zplan-3198";
  r.writeJson(`docs/quality/plans/${broken}.json`, { schema: "arkaik.kritik.plan/9" });
  refuses(r, "a plan file that fails the schema", ["matrix", broken, "--record", "--plan"], [`${broken}.json`]);
  rmSync(r.at("docs", "quality", "plans", `${broken}.json`));
  refuses(r, "a plan file that is not there", ["matrix", "2000-01-zplan-3199", "--record", "--plan"], ["no plan at"]);

  const rBefore = r.journal().length;
  r.ok(recordArgs);
  check("once every check holds, the plan records", r.journal().length === rBefore + 1);
  check(
    "a resolution after the part scored its cell, and before the record, keeps the cell listed",
    JSON.stringify(r.scopeKeys()) === JSON.stringify(["AGT-01::ios", "SEC-01::web"]),
    JSON.stringify(r.scopeKeys()),
  );
  refuses(r, "a plan already recorded", recordArgs, ["already recorded", "make a new plan", "--run SEC:web"]);

  // === The CLI's own refusals around a plan ======================================

  refuses(a, "recording a part id directly", ["matrix", part.auditId, "--record"], [`is one part of plan "${planId}"`, `arkaik kritik matrix ${planId} --record --plan`]);
  refuses(a, "recording the newest audit when it is a part", ["matrix", "--record"], [`arkaik kritik matrix ${planId} --record --plan`]);
  refuses(a, "declaring a part scoped", ["matrix", part.auditId, "--scope"], [`is one part of plan "${planId}"`]);
  refuses(a, "a plan id without --plan", ["matrix", planId], ["is a plan, not an audit", `arkaik kritik matrix ${planId} --plan`]);
  refuses(a, "--plan with --scope", ["matrix", planId, "--plan", "--scope"], ["cannot be combined"]);
  refuses(a, "--plan with no plan id", ["matrix", "--plan"], ["--plan needs the plan id", planId]);
  refuses(a, "--plan with a part id", ["matrix", part.auditId, "--plan"], [`is one part of plan "${planId}"`, `arkaik kritik matrix ${planId} --record --plan`]);
  refuses(a, "--record --plan with --no-journal", ["matrix", planId, "--record", "--plan", "--no-journal"], ["--no-journal"]);
  const partTable = a.run(["matrix", part.auditId]);
  check("a part's own table still prints: only recording or declaring it is refused", partTable.status === 0, partTable.stderr);

  const nb = repo();
  nb.ok(["profile", ...SURFACES.flatMap((surface) => ["--surface", surface])]);
  const nbPlan = nb.makePlan("SEC:web");
  rmSync(nb.at("docs", "arkaik", "bundle.json"));
  refuses(nb, "--record --plan with no journal to append to", ["matrix", nbPlan.planId, "--record", "--plan"], ["needs a journal", "no bundle at"]);

  // === Coverage beside every roll-up, and the first audit that is a plan =========

  const fullTable = a.run(["matrix", FULL]);
  check("a full audit's table carries no coverage lines", fullTable.status === 0 && !fullTable.stdout.includes("coverage —"), fullTable.stdout.slice(-400));

  const aTrend = a.run(["trend"]);
  check("trend marks the plan's row", aTrend.status === 0 && aTrend.stdout.includes(`planned partial audit: 6 cells re-scored in 1 part since ${FULL}`), aTrend.stdout);
  const aRows = JSON.parse(a.run(["trend", "--json"]).stdout || "{}").rows ?? [];
  check("trend --json carries the plan marker, not a scope marker", aRows[1]?.plan?.plan === planId && aRows[1]?.scope === undefined, String(JSON.stringify(aRows[1])).slice(0, 300));
  check(
    "its delta moves only where the plan looked: web compared, iOS not",
    aRows[1]?.cells?.web?.delta !== null && aRows[1]?.cells?.web?.delta === aRows[1]?.cells?.web?.score - aRows[0]?.cells?.web?.score && aRows[1]?.cells?.ios?.delta === null,
    JSON.stringify(aRows[1]?.cells),
  );

  const c = repo();
  c.ok(["profile", ...SURFACES.flatMap((surface) => ["--surface", surface])]);
  const cPlan = c.makePlan("SEC:web");
  const cPart = cPlan.parts[0] ?? { cells: [] };
  c.writeScores(cPart.auditId, cellsOf(cPart), 3);
  const webLine = new RegExp(`web \\d+, from 6 of ${APPLICABLE.web} cells`);
  const iosLine = `ios —, from 0 of ${APPLICABLE.ios} cells`;

  const cPreview = c.run(["matrix", cPlan.planId, "--plan"]);
  check(
    "first audit as a plan: the preview prints coverage beside the roll-ups",
    cPreview.status === 0 && cPreview.stdout.includes("coverage —") && webLine.test(cPreview.stdout) && cPreview.stdout.includes(iosLine),
    cPreview.stderr + cPreview.stdout.slice(-800),
  );
  check(
    "and says no full audit came before it",
    cPreview.stdout.includes(`planned partial audit ${cPlan.planId}: 6 cells re-scored in 1 part, with no full audit before it`),
    cPreview.stdout.slice(-400),
  );

  const cRecorded = c.run(["matrix", cPlan.planId, "--record", "--plan"]);
  const cEvent = c.journal().filter((e) => e.type === "quality.audit.completed").at(-1) ?? {};
  check("first audit as a plan records", cRecorded.status === 0 && cEvent.audit_id === cPlan.planId, cRecorded.stderr);
  check("its record has no since", cEvent.scope !== undefined && !("since" in cEvent.scope), String(JSON.stringify(cEvent.scope)).slice(0, 200));
  check(
    "its coverage: 6 scored, 6 assessed, 338 applicable",
    cEvent.scope?.coverage?.scored === 6 && cEvent.scope?.coverage?.assessed === 6 && cEvent.scope?.coverage?.applicable === ALL_CELLS.length,
    String(JSON.stringify(cEvent.scope?.coverage)).slice(0, 300),
  );
  check(
    "per surface: web 6 of its cells, iOS none of its",
    cEvent.scope?.coverage?.surfaces?.web?.assessed === 6 &&
      cEvent.scope?.coverage?.surfaces?.web?.applicable === APPLICABLE.web &&
      cEvent.scope?.coverage?.surfaces?.ios?.assessed === 0 &&
      cEvent.scope?.coverage?.surfaces?.ios?.applicable === APPLICABLE.ios,
    JSON.stringify(cEvent.scope?.coverage?.surfaces),
  );
  check("the record prints its coverage too", webLine.test(cRecorded.stdout), cRecorded.stdout.slice(-600));

  const cPartTable = c.run(["matrix", cPart.auditId]);
  check("a part's own table carries coverage", cPartTable.status === 0 && webLine.test(cPartTable.stdout), cPartTable.stdout.slice(-600));

  const cTrend = c.run(["trend"]);
  check(
    "trend prints the plan line and its coverage lines",
    cTrend.status === 0 &&
      cTrend.stdout.includes("planned partial audit: 6 cells re-scored in 1 part — no full audit before it") &&
      webLine.test(cTrend.stdout) &&
      cTrend.stdout.includes(iosLine),
    cTrend.stdout,
  );

  // === The scope's anchor guard, and an empty scope that says why ================

  refuses(a, "a plan id as --since", ["scope", "--since", planId], ["is a plan record, never a scope's anchor", `recorded: ${FULL}`]);
  refuses(a, "a part id as --since", ["scope", "--since", part.auditId], ["never a scope's anchor"]);

  // Named from the plan's own month, so it sorts after the plan's part whatever the clock says.
  const later = `${planId.slice(0, 7)}-zz-later`;
  a.writeScores(later, [["SEC-04", "ios"]], 3);
  const declared = a.run(["matrix", later, "--scope"]);
  check(
    "a hand-declared scoped audit after a plan is measured from the full audit, never the plan or its part",
    declared.status === 0 && declared.stdout.includes(`since ${FULL}`) && !declared.stdout.includes(`since ${part.auditId}`) && !declared.stdout.includes(`since ${planId}`),
    declared.stderr + declared.stdout.slice(-400),
  );
  // It sorts after the recorded part, so every writer would now refuse that part as outsorted.
  rmSync(a.at("docs", "quality", "audits", later), { recursive: true, force: true });

  const cScope = c.run(["scope"]);
  check(
    "with only plan records, scope says why it is empty",
    cScope.status === 0 && cScope.stdout.includes("only plan records") && cScope.stdout.includes(cPlan.planId) && cScope.stdout.includes("never what a scope is measured from"),
    cScope.stdout,
  );
  check("and its JSON carries the same note", (c.scopeJson().note ?? "").includes("only plan records"), String(JSON.stringify(c.scopeJson())).slice(0, 300));
  refuses(c, "score --scope with only plan records", ["score", "SEC-01", "web", "3", "--evidence", "x.ts:1", "--scope"], ["only plan records", "never what a scope is measured from"]);

  // A recorded plan's parts are recorded audits for every writer (part 3's recordedAuditIds).
  const intoPart = a.run(["score", "SEC-01", "web", "3", "--evidence", "x.ts:1", "--audit", part.auditId]);
  check("a plain score into a recorded part warns that it rewrites a recorded reading", intoPart.status === 0 && intoPart.stdout.includes(`${part.auditId} is already recorded`), intoPart.stdout + intoPart.stderr);
  refuses(a, "a recorded part as a scoped re-audit's target", ["score", "AGT-01", "ios", "3", "--evidence", "x.ts:1", "--scope", "--audit", part.auditId], ["already recorded"]);

  // ── later sections are inserted above this line ──
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll kritik plan-record checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
