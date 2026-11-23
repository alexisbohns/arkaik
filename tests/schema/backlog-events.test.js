/**
 * The hosted backlog write path (POST .../journal): the parser that turns a
 * body into idea.proposed / request.filed entries, and the planner that stamps
 * and checks them against the project's nodes. Pure and DB-free — the route's
 * SQL is in tests/services/graph-api.test.js.
 *
 * Run: npm run test:backlog-events
 */

const fs = require("fs");
const { loadSchema, BUILD_DIR } = require("./load-schema");

const { parseBacklogEventInputs, planBacklogEvents, BACKLOG_WRITE_LIMITS, validateBundle } = loadSchema();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NODES = [
  { id: "V-home", species: "view" },
  { id: "STK-fast", species: "stake" },
];
const OPTS = { actor: "arkaik-agent", ts: "2026-11-24T00:00:00.000Z" };

try {
  // --- parse ---------------------------------------------------------------
  check("a non-object body is a shape error", "error" in parseBacklogEventInputs([]));
  check("events must be an array", /array/.test(parseBacklogEventInputs({ events: {} }).error ?? ""));
  check("an empty batch is a shape error", /at least one/.test(parseBacklogEventInputs({ events: [] }).error ?? ""));
  check(
    "a batch over the cap is a shape error",
    /at most/.test(parseBacklogEventInputs({ events: Array.from({ length: BACKLOG_WRITE_LIMITS.maxEvents + 1 }, () => ({ type: "idea.proposed", title: "x" })) }).error ?? ""),
  );
  for (const type of ["node.created", "weighing.set.saved", "quality.finding.resolved", undefined]) {
    const out = parseBacklogEventInputs({ events: [{ type, title: "x" }] });
    check(`type ${type} is refused — only the two backlog types pass`, /must be idea\.proposed or request\.filed/.test(out.error ?? ""), JSON.stringify(out));
  }
  for (const field of ["id", "ts", "actor"]) {
    const out = parseBacklogEventInputs({ events: [{ type: "request.filed", title: "x", [field]: "forged" }] });
    check(`a body that claims ${field} is refused — the server stamps it`, /stamped by the server/.test(out.error ?? ""), JSON.stringify(out));
  }
  const parsed = parseBacklogEventInputs({
    events: [
      { type: "request.filed", title: "Slow sync", source_kind: "feedback", verbatim: "it hangs", stake_ids: ["STK-fast"] },
      { type: "idea.proposed", title: "Dark mode", node_id: "V-home" },
    ],
  });
  check(
    "a good batch parses into type + envelope-free payload",
    Array.isArray(parsed) && parsed[0].type === "request.filed" && parsed[0].payload.verbatim === "it hangs" && !("type" in parsed[0].payload),
    JSON.stringify(parsed),
  );

  // --- plan ----------------------------------------------------------------
  const plan = planBacklogEvents(NODES, parsed, OPTS);
  check("a good batch plans", plan.ok && plan.events.length === 2, JSON.stringify(plan));
  check(
    "each event is stamped: a ULID id, the server ts and actor",
    plan.ok && plan.events.every((e) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(e.id) && e.ts === OPTS.ts && e.actor === "arkaik-agent"),
    JSON.stringify(plan.ok && plan.events),
  );
  check("ids are distinct within a batch", plan.ok && plan.events[0].id !== plan.events[1].id);
  check("the payload survives", plan.ok && plan.events[0].source_kind === "feedback" && plan.events[1].node_id === "V-home");
  check("a known stake id warns nothing", plan.ok && plan.warnings.length === 0, JSON.stringify(plan.ok && plan.warnings));

  {
    const bad = planBacklogEvents(
      NODES,
      [
        { type: "request.filed", payload: { title: "ok" } },
        { type: "request.filed", payload: { title: "x", source_kind: "gossip" } },
        { type: "idea.proposed", payload: {} },
        { type: "idea.proposed", payload: { title: "x", node_id: "V-gone" } },
      ],
      OPTS,
    );
    check(
      "a batch with bad entries refuses, naming each index and reason",
      !bad.ok && bad.refusals.map((r) => `${r.index}:${r.reason}`).join() === "1:invalid_entry,2:invalid_entry,3:unknown_node",
      JSON.stringify(bad),
    );
    check("the zod detail names the field", !bad.ok && /source_kind/.test(bad.refusals[0].detail), JSON.stringify(!bad.ok && bad.refusals[0]));
  }
  {
    const warned = planBacklogEvents(NODES, [{ type: "request.filed", payload: { title: "x", stake_ids: ["STK-nope"] } }], OPTS);
    check(
      "an unknown stake id is a warning, as in the validator, not a refusal",
      warned.ok && warned.warnings[0]?.rule === "journal-dangling-stake-ref" && warned.warnings[0].severity === "warning",
      JSON.stringify(warned),
    );
  }

  // Parity: what the planner accepts, the whole-bundle validator accepts too.
  {
    const bundle = {
      schema_version: 2,
      project: { id: "p", title: "P", created_at: OPTS.ts, updated_at: OPTS.ts },
      nodes: [{ id: "V-home", project_id: "p", species: "view", title: "Home", status: "idea", platforms: ["web"] }],
      edges: [],
      journal: [{ id: "01KN44ARM0JH4YFMX52BGKN000", ts: OPTS.ts, type: "journal.baseline", node_ids: ["V-home"] }],
    };
    const planned = planBacklogEvents(bundle.nodes, [{ type: "idea.proposed", payload: { title: "x", node_id: "V-home" } }], OPTS);
    const result = validateBundle({ ...bundle, journal: [...bundle.journal, ...(planned.ok ? planned.events : [])] });
    check("a planned event leaves the bundle valid", planned.ok && result.errors.length === 0, JSON.stringify(result.errors));
  }
} finally {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll backlog event tests passed.");
