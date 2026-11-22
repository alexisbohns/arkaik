#!/usr/bin/env node

/**
 * The weighing tool catalog over stdio (docs/rfcs/weighing.md) — `get_matrix`,
 * `assess` and `save_positioning`, against a tmpdir repo (the sidecars under
 * `docs/weighing/`) and against a stub of the hosted API (events).
 *
 * What this covers that tests/schema/weighing-*.test.js cannot: that an agent
 * gets the same answers through MCP as the schema derives, that `assess` goes
 * through the same validator-gated gate as every other writer, that an agent is
 * stamped an agent whatever it says, and that what an agent writes in a repo is
 * what `arkaik pack` folds into the bundle.
 *
 * Run via `npm run test:mcp` (builds `arkaik` and `arkaik-mcp` first).
 */

const { spawn, spawnSync } = require("child_process");
const http = require("node:http");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { devNull, tmpdir } = require("os");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = path.join(ROOT, "packages", "mcp", "dist", "index.js");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(SERVER) || !existsSync(CLI)) {
  console.error("arkaik-mcp / arkaik are not built. Run: npm run build -w arkaik -w arkaik-mcp (test:mcp does this).");
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ISO = "2026-01-01T00:00:00.000Z";
const NODES = [
  {
    id: "AC-consent",
    project_id: "demo",
    species: "acceptance",
    title: "You agree to the terms knowingly, not by accident",
    status: "development",
    platforms: ["web", "ios"],
    metadata: { gherkin: "Given the consent page\nWhen I tick both boxes\nThen the button wakes", values: ["reduces-risk", "reduces-anxiety"], platformStatuses: { web: "live", ios: "development" } },
  },
  {
    id: "AC-invite",
    project_id: "demo",
    species: "acceptance",
    title: "Accept an invite",
    status: "live",
    platforms: ["web"],
    metadata: { gherkin: "Given a link\nWhen I tap it\nThen we connect", values: ["connects"] },
  },
  { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] },
  { id: "STK-slow", project_id: "demo", species: "stake", title: "Finding an invite takes too long", status: "idea", platforms: [], metadata: { stake_species: "need", felt: "wanted", matters: 3, frequency: "often" } },
  { id: "STK-crash", project_id: "demo", species: "stake", title: "The app loses an invite", status: "idea", platforms: [], metadata: { stake_species: "bug", felt: "expected", matters: 4 } },
  { id: "STK-treat", project_id: "demo", species: "stake", title: "A little animation on connecting", status: "idea", platforms: [], metadata: { stake_species: "need", felt: "delight", matters: 2 } },
  { id: "STK-token", project_id: "demo", species: "stake", title: "A leaked token", status: "idea", platforms: [], metadata: { stake_species: "risk", catalog: { source: "kritik", id: "SAF-01" } } },
];
const BUNDLE = { schema_version: 3, project: { id: "demo", title: "Demo", created_at: ISO, updated_at: ISO }, nodes: NODES, edges: [] };
const CREATED = NODES.map((n, i) => JSON.stringify({ id: `01A${i}`, ts: ISO, type: "node.created", node_id: n.id, species: n.species, title: n.title }));

/**
 * A copy of `env` that git cannot be steered by: no global or system config, and none of the variables
 * that redirect it (an outer `git commit` hook or a CI runner sets some of them), so what a test says
 * about git config is about the config the test wrote. Both the fixture's git and the server's.
 */
function isolatedGitEnv(env = process.env) {
  const out = { ...env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1" };
  for (const key of Object.keys(out)) {
    if (["GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"].includes(key) || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete out[key];
  }
  return out;
}

/** Run git in `cwd`, throwing on failure — fixture setup only. */
function git(cwd, ...args) {
  const done = spawnSync("git", args, { cwd, encoding: "utf8", env: isolatedGitEnv() });
  if (done.status !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
}

/**
 * Spawn a server over a fresh tmpdir repo (or hosted, with extra args); returns an rpc client.
 *
 * `gitConfig` makes the tmpdir a git repo with those LOCAL config values (e.g. `{ "user.name": "…" }`).
 * The server's git is isolated from this machine's: no global or system config is read, and an inherited
 * ARKAIK_ON_BEHALF_OF is dropped, so "none set" really is none. `env` is applied on top.
 */
function startSession(extraArgs = [], env = {}, gitConfig = undefined) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-mcp-weighing-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  writeFileSync(bundlePath, JSON.stringify(BUNDLE, null, 2));
  writeFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), `${CREATED.join("\n")}\n`);
  const isolated = isolatedGitEnv();
  delete isolated.ARKAIK_ON_BEHALF_OF;
  if (gitConfig !== undefined) {
    git(dir, "init", "-q");
    for (const [key, value] of Object.entries(gitConfig)) git(dir, "config", "--local", key, value);
  }

  const args = extraArgs.length > 0 ? extraArgs : ["--bundle", bundlePath];
  const child = spawn(process.execPath, [SERVER, ...args], { stdio: ["pipe", "pipe", "pipe"], cwd: dir, env: { ...isolated, ...env } });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000).unref?.();
    });
  const call = async (name, args = {}) => {
    const response = await request("tools/call", { name, arguments: args });
    const text = response.result?.content?.[0]?.text ?? "";
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
    return { isError: response.result?.isError === true, json, text };
  };
  return {
    dir,
    bundlePath,
    request,
    call,
    readJson: (...parts) => JSON.parse(readFileSync(path.join(dir, ...parts), "utf8")),
    stop: () => {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function main() {
  const repo = startSession();
  try {
    await repo.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weighing-test", version: "0" } });

    const listed = await repo.request("tools/list");
    const names = (listed.result?.tools ?? []).map((t) => t.name);
    check("the catalog lists get_matrix, assess and save_positioning", ["get_matrix", "assess", "save_positioning"].every((n) => names.includes(n)), names.join());
    const assessDef = listed.result.tools.find((t) => t.name === "assess");
    check("assess's description tells what a repo session writes about its author, and the opt-out", /git author name/.test(assessDef.description) && /arkaik\.user/.test(assessDef.description) && /nobody/.test(assessDef.description), assessDef.description.slice(-400));
    check("model, run and commit are capped at 200 in the input schema", ["model", "run", "commit"].every((k) => assessDef.inputSchema.properties[k].maxLength === 200));
    check("assess takes no scorer — an agent cannot claim to be a human", assessDef !== undefined && !("scorer" in assessDef.inputSchema.properties) && !("kind" in assessDef.inputSchema.properties));
    check("assess's level is the signed scale", assessDef !== undefined && assessDef.inputSchema.properties.level.minimum === -3 && assessDef.inputSchema.properties.level.maximum === 3);

    // --- get_matrix with nothing assessed: seeds, honestly labelled --------------
    const first = await repo.call("get_matrix");
    check("get_matrix answers with nothing stored", !first.isError, first.text.slice(0, 200));
    check("it judges the two acceptances, not the view", first.json.totals.promises === 2, JSON.stringify(first.json.totals));
    check("nothing is assessed, and it says every figure is a guess", first.json.totals.assessed === 0 && first.json.notes.some((n) => /seeded/.test(n)), JSON.stringify(first.json.notes));
    check("all of it is guesswork", first.json.totals.guesswork.promised === 1);
    const consent = first.json.promises.find((p) => p.node_id === "AC-consent");
    check("served is seeded at +1 per claim, whatever the order: (1 + 1) / 3 = 0.67", consent.served === 0.67 && consent.cost === 0, JSON.stringify(consent));
    check("kept share is live platforms over applicable ones", consent.kept_share === 0.5);
    check("no positioning, no positioned figure", consent.positioned === null && first.json.positioning === null);
    check("a list row carries no cells; the subject read does", consent.cells === undefined);
    check("nothing stored was dropped, so there is no skipped list", first.json.skipped === undefined);

    const one = await repo.call("get_matrix", { subject: "AC-consent" });
    check("a subject read returns every cell with its scorer", one.json.promise.cells.length === 2 && one.json.promise.cells.every((c) => c.source === "seed" && c.scorer.kind === "rule" && c.confidence === 0));
    check("…and the scale's anchors, so the agent scores against words", one.json.scale.anchors["-3"] && one.json.scale.anchors["3"] && one.json.confidence_anchors["0"]);
    const anxietyElement = one.json.elements?.find((e) => e.id === "reduces-anxiety");
    check("…and every element's question and reach ladder", one.json.elements?.length === 30 && typeof anxietyElement?.question === "string" && typeof anxietyElement?.anchors?.["1"] === "string" && typeof anxietyElement?.anchors?.["-3"] === "string", JSON.stringify(anxietyElement));
    check("probabilities stay out of a subject read unless asked", one.json.promise.cells.every((c) => !("p_serves" in c) && !("p_costs" in c)));
    check("a view is not a subject", (await repo.call("get_matrix", { subject: "V-home" })).isError);
    check("an unknown matrix is an error", (await repo.call("get_matrix", { matrix: "nope" })).isError);
    check("a bad sort is an error", (await repo.call("get_matrix", { sort: "vibes" })).isError);

    // --- assess: validator-gated, agent-stamped -----------------------------------
    // The planner owns every value rule, so a refusal carries ITS reason (a repo's and a hosted one's alike).
    const bad = [
      ["an unknown element", { subject: "AC-consent", criterion: "teleports", level: 1, confidence: 0 }, "unknown_criterion"],
      ["a level of 4", { subject: "AC-consent", criterion: "connects", level: 4, confidence: 0 }, "level_out_of_range"],
      ["a level of -4", { subject: "AC-consent", criterion: "connects", level: -4, confidence: 0 }, "level_out_of_range"],
      ["a view as the subject", { subject: "V-home", criterion: "connects", level: 1, confidence: 0 }, "unknown_subject"],
      ["a missing acceptance", { subject: "AC-gone", criterion: "connects", level: 1, confidence: 0 }, "unknown_subject"],
      ["a model of 201 characters", { subject: "AC-consent", criterion: "connects", level: 1, confidence: 0, model: "m".repeat(201) }, "invalid_entry"],
      ["a run of 201 characters", { subject: "AC-consent", criterion: "connects", level: 1, confidence: 0, run: "r".repeat(201) }, "invalid_entry"],
      ["a commit of 201 characters", { subject: "AC-consent", criterion: "connects", level: 1, confidence: 0, commit: "c".repeat(201) }, "invalid_entry"],
      ["evidence of 2001 characters", { subject: "AC-consent", criterion: "connects", level: 1, confidence: 1, evidence: "e".repeat(2001) }, "invalid_entry"],
      ["evidence that is only whitespace", { subject: "AC-consent", criterion: "connects", level: 1, confidence: 0, evidence: "   " }, "invalid_entry"],
      ["evidence missing above confidence 0", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 2 }, undefined],
      ["whitespace evidence above confidence 0", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 2, evidence: "  \n" }, undefined],
      ["a level that is not an integer", { subject: "AC-consent", criterion: "connects", level: 1.5, confidence: 0 }, undefined],
      ["an unknown matrix", { subject: "AC-consent", criterion: "connects", level: 1, confidence: 0, matrix: "nope" }, undefined],
    ];
    for (const [label, args, reason] of bad) {
      const res = await repo.call("assess", args);
      check(`assess refuses ${label}`, res.isError, res.text.slice(0, 160));
      if (reason !== undefined) check(`…with the planner's reason, ${reason}`, res.json.refusals?.[0]?.reason === reason, res.text.slice(0, 240));
    }
    check("…and wrote nothing", !existsSync(path.join(repo.dir, "docs", "weighing")));

    const scored = await repo.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 2, evidence: "the Then clause removes one worry (accidental consent), not the page's overall anxiety", model: "claude" });
    check("assess records a judgement", !scored.isError && scored.json.assessment.level === 1, scored.text.slice(0, 300));
    check("the scorer is stamped an agent, with the model", scored.json.assessment.scorer.kind === "agent" && scored.json.assessment.scorer.model === "claude");
    // D14: with nothing set anywhere the field is absent (the tmpdir is not a git repo, and no global config is read).
    check("on_behalf_of is absent when nothing says whose it is", !("on_behalf_of" in scored.json.assessment.scorer), JSON.stringify(scored.json.assessment.scorer));
    check("the basis is stamped: fingerprint and the set's version", /^fp1-/.test(scored.json.assessment.basis.fingerprint) && scored.json.assessment.basis.set_version === "2.0.0");
    check("the reply carries the level's anchor — the element's own ladder, not the scale's generic words", scored.json.anchor === anxietyElement.anchors["1"] && scored.json.anchor !== one.json.scale.anchors["1"], String(scored.json.anchor));
    const file = repo.readJson("docs", "weighing", "assessments", "value.json");
    check("it upserts docs/weighing/assessments/value.json — the sidecar is the record", file.matrix === "value" && file.assessments.length === 1);
    check("…and writes nothing to the journal", !readFileSync(path.join(repo.dir, "docs", "arkaik", "journal.jsonl"), "utf8").includes("weighing."));

    const cost = await repo.call("assess", { subject: "AC-consent", criterion: "reduces-effort", level: -1, confidence: 1, evidence: "two boxes before the button wakes" });
    check("a negative level is a cost, and an unclaimed one", !cost.isError && cost.json.assessment.level === -1);
    const rescored = await repo.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 2, confidence: 2, evidence: "second reading" });
    check("re-scoring replaces in place and reports the old level", rescored.json.replaced_level === 1);
    check("…leaving two rows, not three", repo.readJson("docs", "weighing", "assessments", "value.json").assessments.length === 2);

    // --- the read now reflects it -------------------------------------------------------
    const after = await repo.call("get_matrix", { subject: "AC-consent" });
    const p = after.json.promise;
    check("served and cost are never netted: +1 seed, +2 scored, −1 scored", p.served === 1 && p.cost === 0.33, JSON.stringify(p));
    check("a scored claim reads at the scorer's level", p.cells.find((c) => c.criterion === "reduces-anxiety").level === 2 && p.cells.find((c) => c.criterion === "reduces-anxiety").source === "stored");
    check("the unclaimed cost is flagged", p.flags.unclaimed_cost.join() === "reduces-effort");
    check("guesswork is only the seeded reduces-risk cell now", p.guesswork.served === 0.33, String(p.guesswork.served));
    check("assessed is one promise", (await repo.call("get_matrix")).json.totals.assessed === 1);

    // --- staleness: edit the promise, the score goes stale ---------------------------------
    await repo.call("update_node", { node_id: "AC-consent", patch: { title: "You agree to the terms, knowingly" } });
    const stale = await repo.call("get_matrix", { subject: "AC-consent" });
    check("editing the title marks the scored cells stale", stale.json.promise.stale.sort().join() === "reduces-anxiety,reduces-effort", JSON.stringify(stale.json.promise.stale));
    check("…without changing their level", stale.json.promise.cells.find((c) => c.criterion === "reduces-anxiety").level === 2);
    check("filter=stale lists it", (await repo.call("get_matrix", { filter: "stale" })).json.promises.map((x) => x.node_id).join() === "AC-consent");
    check("filter=unassessed lists the other", (await repo.call("get_matrix", { filter: "unassessed" })).json.promises.map((x) => x.node_id).join() === "AC-invite");
    check("filter=flagged lists the one with an unclaimed cost", (await repo.call("get_matrix", { filter: "flagged" })).json.promises.map((x) => x.node_id).join() === "AC-consent");

    // --- a human's file is never overwritten by an agent ---------------------------------------
    const filePath = path.join(repo.dir, "docs", "weighing", "assessments", "value.json");
    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    onDisk.assessments.push({ matrix: "value", subject: "AC-consent", criterion: "reduces-anxiety", level: 3, scorer: { kind: "human", id: "alexis" }, confidence: 3, evidence: "I wrote it", basis: { fingerprint: "fp1-0", set_version: "1.0.0" }, ts: "2026-11-15T09:00:00.000Z" });
    writeFileSync(filePath, JSON.stringify(onDisk, null, 2));
    const afterHuman = await repo.call("get_matrix", { subject: "AC-consent" });
    const cell = afterHuman.json.promise.cells.find((c) => c.criterion === "reduces-anxiety");
    check("a human's level beats the agent's", cell.level === 3 && cell.scorer.kind === "human");
    check("…and the agent's rides beside it", cell.others?.[0]?.level === 2);
    check("…and the cell is on the review list only when they differ by 2 or more (3 vs 2: not)", !cell.review);
    const again = await repo.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 0, confidence: 2, evidence: "I disagree" });
    check("an agent that disagrees is told a human's level stands", again.json.notes?.some((n) => /human's level already stands/.test(n) && /review/.test(n)), JSON.stringify(again.json.notes));
    check("…and the human's row is still on disk", repo.readJson("docs", "weighing", "assessments", "value.json").assessments.some((a) => a.scorer?.kind === "human" && a.level === 3));
    const near = await repo.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 2, confidence: 2, evidence: "close to theirs" });
    check("an agent one level off a human is told theirs stands, but is NOT told the cell is on the review list", near.json.notes?.some((n) => /human's level already stands/.test(n)) && !near.json.notes.some((n) => /review/.test(n)), JSON.stringify(near.json.notes));

    // --- positioning ----------------------------------------------------------------------------------
    const draft = await repo.call("save_positioning", { elements: [{ id: "reduces-anxiety", weight: 3, anchors: { 3: "removes a worry the user names", 0: "nothing to do with worry" } }, { id: "connects" }] });
    check("save_positioning writes a draft by default", !draft.isError && draft.json.positioning.status === "draft" && draft.json.notes.some((n) => /draft/.test(n)), draft.text.slice(0, 200));
    check("…to docs/weighing/sets/positioning.json", repo.readJson("docs", "weighing", "sets", "positioning.json").criteria.length === 2);
    const drafted = await repo.call("get_matrix");
    check("a draft feeds no roll-up: no positioned figure, and it says so", drafted.json.promises.every((x) => x.positioned === null) && drafted.json.notes.some((n) => /draft/.test(n)));
    check("…but get_matrix shows the draft", drafted.json.positioning.status === "draft" && drafted.json.positioning.elements.length === 2);
    const dup = await repo.call("save_positioning", { elements: [{ id: "connects", weight: 2 }, { id: "connects", weight: 5 }, { id: "informs" }] });
    check("a duplicated element is saved as given (the planner does not fix it)", !dup.isError && dup.json.positioning.criteria.length === 3);
    const dupRead = (await repo.call("get_matrix")).json.positioning.elements;
    check("get_matrix reads weights through the derivation's rule: the first duplicate wins, a missing weight is 1", dupRead.length === 2 && dupRead[0].weight === 2 && dupRead[1].id === "informs" && dupRead[1].weight === 1, JSON.stringify(dupRead));
    const refusedSets = [
      ["a weight given as a string", [{ id: "connects", weight: "3" }]],
      ["a negative weight", [{ id: "connects", weight: -1 }]],
      ["anchors on a level off the scale", [{ id: "connects", anchors: { 9: "x" } }]],
      ["anchors that are not words", [{ id: "connects", anchors: { 3: 7 } }]],
      ["an element that is not an object", [null]],
    ];
    for (const [label, elements] of refusedSets) {
      const res = await repo.call("save_positioning", { elements });
      check(`save_positioning refuses ${label}, passed through as given`, res.isError && res.json.refusals?.[0]?.reason === "invalid_set", res.text.slice(0, 200));
    }
    check("…and a refused save left the saved positioning as it was", repo.readJson("docs", "weighing", "sets", "positioning.json").criteria.length === 3);
    const active = await repo.call("save_positioning", { status: "active", elements: [{ id: "reduces-anxiety", weight: 3 }, { id: "connects" }] });
    check("saving it active replaces it whole", !active.isError && repo.readJson("docs", "weighing", "sets", "positioning.json").status === "active");
    const positioned = (await repo.call("get_matrix", { subject: "AC-consent" })).json.promise.positioned;
    check("an active positioning gives positioned figures: anxiety 3/3 × weight 3", positioned.served === 3 && positioned.cost === 0, JSON.stringify(positioned));
    check("a positioning naming a non-element is refused", (await repo.call("save_positioning", { elements: [{ id: "teleports" }] })).isError);
    check("a weight of 0 is refused", (await repo.call("save_positioning", { elements: [{ id: "connects", weight: 0 }] })).isError);

    // --- what the agent wrote is what pack folds ---------------------------------------------------------
    const packed = spawnSync(process.execPath, [CLI, "pack", repo.bundlePath], { encoding: "utf8", cwd: repo.dir });
    const out = JSON.parse(packed.stdout);
    check("arkaik pack folds the agent's file into bundle.weighing", out.weighing?.assessments?.length === 3 && out.weighing.sets[0].id === "positioning", packed.stderr);
    check("validate_bundle reports no error for the repo", (await repo.call("validate_bundle")).json.errors?.length === 0);

    // --- probabilities: a probabilistic scorer's certainty, stored sparingly --------------------------
    const offRange = await repo.call("assess", { subject: "AC-invite", criterion: "simplifies", level: 1, confidence: 1, evidence: "one tap", p_serves: 1.4 });
    check("a probability off 0..1 is refused with the planner's reason", offRange.isError && offRange.json.refusals?.[0]?.reason === "invalid_entry", offRange.text.slice(0, 200));
    const unsure = await repo.call("assess", { subject: "AC-invite", criterion: "simplifies", level: 1, confidence: 1, evidence: "one tap instead of a form", model: "jev-1.14.0", p_serves: 0.55, p_costs: 0.2 });
    check("assess records p_serves and p_costs on the row", !unsure.isError && unsure.json.assessment.p_serves === 0.55 && unsure.json.assessment.p_costs === 0.2, unsure.text.slice(0, 300));
    const invite = (await repo.call("get_matrix", { subject: "AC-invite" })).json.promise;
    const simplifies = invite.cells.find((c) => c.criterion === "simplifies");
    check("an unsure level is marked uncertain, and the promise lists it", simplifies.uncertain === true && invite.uncertain.join() === "simplifies", JSON.stringify(simplifies));
    check("…its numbers stay out unless asked", !("p_serves" in simplifies));
    const withP = (await repo.call("get_matrix", { subject: "AC-invite", probabilities: true })).json.promise.cells.find((c) => c.criterion === "simplifies");
    check("probabilities: true adds them", withP.p_serves === 0.55 && withP.p_costs === 0.2);
    check("filter=uncertain lists it", (await repo.call("get_matrix", { filter: "uncertain" })).json.promises.map((x) => x.node_id).join() === "AC-invite");

    // --- stakes: a reference declares the kinds it scores (stake architecture, part 4) -------------------
    const stakeRead = await repo.call("get_matrix", { subject: "STK-slow" });
    check("get_matrix defaults a stake subject to the stakes matrix", !stakeRead.isError && stakeRead.json.matrix.id === "stakes" && stakeRead.json.matrix.set === "value-contribution@2", stakeRead.text.slice(0, 200));
    check("…and shows the stake's kind, reference, felt, matters and frequency beside the score", JSON.stringify(stakeRead.json.promise.stake) === JSON.stringify({ stake_species: "need", reference: { kind: "weighing-set", set: "value-contribution@2" }, felt: "wanted", matters: 3, frequency: "often" }), JSON.stringify(stakeRead.json.promise.stake));
    check("a stake is never seeded: no cells until it is scored", stakeRead.json.promise.cells.length === 0 && stakeRead.json.notes?.some((n) => /never seeded/.test(n)), JSON.stringify(stakeRead.json.notes));
    const stakeScored = await repo.call("assess", { subject: "STK-slow", criterion: "saves-time", level: 1, confidence: 1, evidence: "the list has no search" });
    check("assess weighs a need on the stakes matrix by default", !stakeScored.isError && stakeScored.json.assessment.matrix === "stakes", stakeScored.text.slice(0, 300));
    check("…into its own sidecar, never the value matrix's", repo.readJson("docs", "weighing", "assessments", "stakes.json").assessments.length === 1 && repo.readJson("docs", "weighing", "assessments", "value.json").assessments.every((a) => a.subject !== "STK-slow"));
    const stakeList = (await repo.call("get_matrix", { matrix: "stakes" })).json;
    const grouped = stakeList.groups.map((g) => `${g.stake_species}:${g.felt}=${g.promises.map((x) => x.node_id).join("+")}`).join();
    check("the stakes matrix lists the weighable stakes only, one list per kind and felt, with their facts", grouped === "bug:expected=STK-crash,need:wanted=STK-slow,need:delight=STK-treat" && stakeList.groups[1].promises[0].stake.matters === 3, grouped);
    check("…and never one ranked list or one summed mass across kinds", stakeList.promises === undefined && stakeList.elements === undefined && stakeList.totals.promised === undefined && stakeList.groups.every((g) => g.totals !== undefined) && stakeList.notes.some((n) => /not ranked against each other/.test(n)), JSON.stringify(stakeList.totals));
    check("…the scored need's mass stays in its own group", stakeList.groups[1].totals.promised > 0 && stakeList.groups[0].totals.promised === 0 && stakeList.groups[2].totals.promised === 0, JSON.stringify(stakeList.groups.map((g) => g.totals)));
    const unknownMatrix = await repo.call("assess", { subject: "STK-slow", criterion: "saves-time", level: 1, confidence: 0, matrix: "nope" });
    check("an unknown matrix names both built-in ones", unknownMatrix.isError && /"value" and "stakes"/.test(unknownMatrix.json.message), unknownMatrix.text.slice(0, 200));
    const patched = await repo.call("update_node", { node_id: "STK-slow", patch: { metadata: { frequency: "rare" } } });
    check("update_node on a stake merges metadata key by key: the kind and the rest survive", !patched.isError && patched.json.node.metadata.stake_species === "need" && patched.json.node.metadata.felt === "wanted" && patched.json.node.metadata.frequency === "rare", patched.text.slice(0, 300));
    const cleared = await repo.call("update_node", { node_id: "STK-slow", patch: { metadata: { frequency: null } } });
    check("…a null clears one key", !cleared.isError && !("frequency" in cleared.json.node.metadata) && cleared.json.node.metadata.matters === 3, cleared.text.slice(0, 300));
    const asBug = await repo.call("update_node", { node_id: "STK-treat", patch: { metadata: { stake_species: "bug" } } });
    check("…and the stake rules apply: a bug is felt as expected", !asBug.isError && asBug.json.node.metadata.felt === "expected", asBug.text.slice(0, 300));
    check("the value matrix still lists the acceptances only", (await repo.call("get_matrix")).json.promises.every((x) => x.node_id.startsWith("AC-")));
    const riskScored = await repo.call("assess", { subject: "STK-token", criterion: "saves-time", level: 1, confidence: 0 });
    check("a risk is refused: Kritik reads it, the pyramid never does", riskScored.isError && riskScored.json.refusals?.[0]?.reason === "unknown_subject" && /Kritik/.test(riskScored.json.refusals[0].detail), riskScored.text.slice(0, 300));
    const kritikScored = await repo.call("assess", { subject: "STK-slow", criterion: "SAF-01", level: 1, confidence: 0 });
    check("a Kritik criterion is never written as an assessment", kritikScored.isError && kritikScored.json.refusals?.[0]?.reason === "unknown_criterion", kritikScored.text.slice(0, 300));
    const stakeSummary = (await repo.call("get_node", { node_id: "STK-slow" })).json;
    check("a stake's node carries felt, matters and frequency", stakeSummary.node.metadata?.felt === "wanted" && stakeSummary.node.metadata.matters === 3, JSON.stringify(stakeSummary).slice(0, 300));
  } finally {
    repo.stop();
  }

  // --- on_behalf_of in a repo (D14): ARKAIK_ON_BEHALF_OF, then arkaik.user, then user.name; never an email -----
  const behalfOf = async (env, gitConfig) => {
    const session = startSession([], env, gitConfig);
    try {
      await session.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weighing-test", version: "0" } });
      const res = await session.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 0 });
      if (res.isError) return `ERROR ${res.text.slice(0, 200)}`;
      const scorer = res.json.assessment.scorer;
      // The record on disk is what gets committed, so read the sidecar, not just the reply.
      const onDisk = session.readJson("docs", "weighing", "assessments", "value.json").assessments[0].scorer;
      return JSON.stringify(scorer) === JSON.stringify(onDisk) ? scorer.on_behalf_of : `MISMATCH ${JSON.stringify(scorer)} vs ${JSON.stringify(onDisk)}`;
    } finally {
      session.stop();
    }
  };
  const ALL = { "arkaik.user": "Local Handle", "user.name": "Anne-Claire Dupré", "user.email": "anne@example.com" };
  check("ARKAIK_ON_BEHALF_OF wins over git config", (await behalfOf({ ARKAIK_ON_BEHALF_OF: "  u_1842  " }, ALL)) === "u_1842");
  check("with no env var, arkaik.user wins over user.name", (await behalfOf({}, ALL)) === "Local Handle");
  check("with only user.name set, the git author name is used — spaces and accents intact", (await behalfOf({}, { "user.name": "Anne-Claire Dupré", "user.email": "anne@example.com" })) === "Anne-Claire Dupré");
  check("with only arkaik.user set, that is used", (await behalfOf({}, { "arkaik.user": "alexisbohns" })) === "alexisbohns");
  check("with none set, the field is absent", (await behalfOf({}, {})) === undefined);
  check("…also in a git repo that has an email but no name: user.email is never a source", (await behalfOf({}, { "user.email": "anne@example.com" })) === undefined);
  check("a blank env var is not set: it falls through", (await behalfOf({ ARKAIK_ON_BEHALF_OF: "   " }, { "user.name": "Anne" })) === "Anne");
  check("an email in the env var is skipped, not stamped: the next source is used", (await behalfOf({ ARKAIK_ON_BEHALF_OF: "me@example.com" }, { "arkaik.user": "Local Handle", "user.name": "Anne" })) === "Local Handle");
  check("an email in arkaik.user is skipped too: user.name is used", (await behalfOf({}, { "arkaik.user": "me@example.com", "user.name": "Anne" })) === "Anne");
  check("an email-shaped user.name is skipped, and with nothing left the field is absent — scoring still works", (await behalfOf({}, { "user.name": "Anne <anne@example.com>" })) === undefined);
  // The opt-out: "-" means "record nobody" and stops the chain; an empty value still falls through.
  check("ARKAIK_ON_BEHALF_OF=- records nobody, whatever git says", (await behalfOf({ ARKAIK_ON_BEHALF_OF: "-" }, ALL)) === undefined);
  check("…also with surrounding whitespace", (await behalfOf({ ARKAIK_ON_BEHALF_OF: " - " }, ALL)) === undefined);
  check("git config arkaik.user - records nobody: user.name is not consulted", (await behalfOf({}, { "arkaik.user": "-", "user.name": "Anne-Claire Dupré" })) === undefined);
  check("git config user.name - is not a name either", (await behalfOf({}, { "user.name": "-" })) === undefined);
  check("an empty arkaik.user is not set: it falls through to user.name", (await behalfOf({}, { "arkaik.user": "", "user.name": "Anne" })) === "Anne");
  check("a value that merely contains a dash is a name like any other", (await behalfOf({ ARKAIK_ON_BEHALF_OF: "-x" }, {})) === "-x" && (await behalfOf({}, { "user.name": "Anne-Claire" })) === "Anne-Claire");
  check("an email in every source leaves the field absent and the score recorded", (await behalfOf({ ARKAIK_ON_BEHALF_OF: "a@b.co" }, { "arkaik.user": "c@d.co", "user.name": "e@f.co" })) === undefined);

  // A git that hangs costs at most one short timeout, and arkaik.user timing out ends the chain (user.name is not tried).
  const fakeBin = mkdtempSync(path.join(tmpdir(), "arkaik-fake-git-"));
  const fakeLog = path.join(fakeBin, "calls.log");
  writeFileSync(path.join(fakeBin, "git"), '#!/bin/sh\necho "$@" >> "$FAKE_GIT_LOG"\nexec sleep 20\n', { mode: 0o755 });
  const slow = startSession([], { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, FAKE_GIT_LOG: fakeLog });
  try {
    await slow.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weighing-test", version: "0" } });
    const began = Date.now();
    const res = await slow.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 0 });
    check("a git that hangs does not block scoring: the score is recorded with nobody stamped", !res.isError && !("on_behalf_of" in res.json.assessment.scorer), res.text.slice(0, 200));
    check("…within a couple of seconds", Date.now() - began < 5000, `${Date.now() - began} ms`);
    const calls = readFileSync(fakeLog, "utf8").trim().split("\n");
    check("…and a timed-out arkaik.user ends the chain: user.name was never asked", calls.length === 1 && /arkaik\.user/.test(calls[0]), calls.join(" | "));
  } finally {
    slow.stop();
    rmSync(fakeBin, { recursive: true, force: true });
  }

  // --- a claimed element scored negative: claim_contradicted, and only that flag ---------------------
  const flags = startSession();
  try {
    await flags.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weighing-test", version: "0" } });
    await flags.call("assess", { subject: "AC-invite", criterion: "connects", level: -2, confidence: 1, evidence: "the invite link exposes the inviter's number" });
    const promise = (await flags.call("get_matrix", { subject: "AC-invite" })).json.promise;
    check("a claimed element scored negative raises claim_contradicted, and nothing else", promise.flags.claim_contradicted.join() === "connects" && Object.entries(promise.flags).every(([name, ids]) => name === "claim_contradicted" || ids.length === 0), JSON.stringify(promise.flags));
    check("…it costs what it claimed to serve", promise.cost === 0.67 && promise.served === 0, JSON.stringify(promise));
    check("filter=flagged lists it", (await flags.call("get_matrix", { filter: "flagged" })).json.promises.map((x) => x.node_id).join() === "AC-invite");
  } finally {
    flags.stop();
  }

  // --- hosted: the same tools over a stub of the API --------------------------------------------------------
  const received = [];
  let refuse = false;
  const HOSTED = {
    ...BUNDLE,
    weighing: {
      sets: [],
      matrices: [{ id: "draft-m", set: "value-contribution@2", subjects: { kind: "query", species: "acceptance" }, status: "draft" }],
      assessments: [{ matrix: "value", subject: "AC-invite", criterion: "connects", level: 2, scorer: { kind: "human", id: "arkaik-app" }, confidence: 2, evidence: "a person", basis: { fingerprint: "fp1-0", set_version: "1.0.0" }, ts: "2026-11-14T10:00:00.000Z" }],
    },
  };
  const stub = http.createServer((req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/api/graph/projects/demo") return json(200, { bundle: HOSTED, version: "v1" });
    if (req.method === "GET" && req.url === "/api/graph/projects/demo/journal") return json(200, { journal: [] });
    if (req.method === "POST" && req.url === "/api/graph/projects/demo/weighing/events") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw);
        received.push(body);
        if (refuse) return json(422, { error: "refused", message: "entry 0: unknown_criterion", refusals: [{ index: 0, reason: "unknown_criterion", detail: '"teleports" is not in set "value-contribution"' }] });
        return json(200, { events: body.events.map((e, i) => ({ id: `01H${i}`, ts: "2026-11-15T10:00:00.000Z", actor: "arkaik-agent", ...e, ...(e.type === "weighing.assessment.recorded" ? { scorer: { kind: "agent", id: "arkaik-agent", ...(e.model ? { model: e.model } : {}) }, basis: { fingerprint: "fp1-server", set_version: "1.0.0" } } : {}) })) });
      });
      return;
    }
    json(404, { error: "not_found" });
  });
  await new Promise((resolve) => stub.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${stub.address().port}`;
  const hosted = startSession(["--remote", "--project", "demo"], { ARKAIK_TOKEN: "t", ARKAIK_URL: baseUrl, ARKAIK_ON_BEHALF_OF: "u_1842" }, { "arkaik.user": "Local Handle", "user.name": "Anne" });
  try {
    await hosted.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weighing-test", version: "0" } });

    const read = await hosted.call("get_matrix", { subject: "AC-invite" });
    check("hosted get_matrix reads the section the server folded", read.json.promise.cells[0].scorer.kind === "human" && read.json.promise.cells[0].level === 2, read.text.slice(0, 200));

    const res = await hosted.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: -2, confidence: 2, evidence: "a hypothetical health-data consent", model: "claude" });
    check("hosted assess posts exactly one assessment entry", !res.isError && received.length === 1 && received[0].events.length === 1, res.text.slice(0, 300));
    const sent = received[0].events[0];
    check("…of the right type and fields", sent.type === "weighing.assessment.recorded" && sent.subject === "AC-consent" && sent.criterion === "reduces-anxiety" && sent.level === -2 && sent.confidence === 2 && sent.model === "claude");
    check("…with NO scorer, basis or ts — the server stamps them", !("scorer" in sent) && !("basis" in sent) && !("ts" in sent), JSON.stringify(sent));
    check("…and no on_behalf_of either, whatever the environment or git config say: the server stamps the token's owner", !JSON.stringify(sent).includes("on_behalf_of"), JSON.stringify(sent));
    check("the reply is the server's stamped event", res.json.assessment.scorer.kind === "agent" && res.json.assessment.basis.fingerprint === "fp1-server");
    check("no human level stands for that cell, so there is no note", res.json.notes === undefined);
    check("nothing was written to disk", !existsSync(path.join(hosted.dir, "docs", "weighing")));

    const note = await hosted.call("assess", { subject: "AC-invite", criterion: "connects", level: 0, confidence: 1, evidence: "reads as touching only" });
    check("hosted assess tells an agent a human's level stands", note.json.notes?.some((n) => /human's level already stands/.test(n)), JSON.stringify(note.json.notes));

    const before = received.length;
    const drafted = await hosted.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 0, matrix: "draft-m" });
    check("assess against a draft matrix is refused in the tool, with the reason", drafted.isError && /This matrix is a draft and feeds no roll-up; activate it first\./.test(drafted.json.message), drafted.text.slice(0, 200));
    const unknownMatrix = await hosted.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 0, matrix: "nope" });
    check("…and against an unknown one", unknownMatrix.isError && /nope/.test(unknownMatrix.json.message), unknownMatrix.text.slice(0, 200));
    check("…and nothing was posted for either", received.length === before);

    const pos = await hosted.call("save_positioning", { elements: [{ id: "connects", weight: 2 }] });
    check("hosted save_positioning posts a weighing.set.saved draft", !pos.isError && received.at(-1).events[0].type === "weighing.set.saved" && received.at(-1).events[0].set.status === "draft");

    refuse = true;
    const refused = await hosted.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 0 });
    check("a server refusal surfaces with its reason", refused.isError && /unknown_criterion/.test(refused.text), refused.text.slice(0, 300));
    check("…as the same structured refusals a repo's refusal carries", refused.json.refusals?.[0]?.reason === "unknown_criterion" && refused.json.refusals[0].index === 0, JSON.stringify(refused.json.refusals));
  } finally {
    hosted.stop();
    stub.close();
  }

  if (failures > 0) {
    console.log(`\n${failures} weighing tool test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll weighing tool tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
