/**
 * Kritik operation tests (docs/rfcs/kritik.md § 4.4, issue #382 phase C).
 *
 * `quality-ops.ts` is the write half of the quality layer, and the three entry
 * points that call it — the `arkaik kritik` verbs, the `kritik_*` MCP tools,
 * and the plugin's standalone scripts — must all mean the same thing by "record
 * a score" or "open a finding". These are the unit tests for that shared
 * meaning: latest-per-cell replacement, id minting that survives a refuted
 * finding, the event payloads' derived-at-write-time severity, and the run
 * sheet's cell set.
 *
 * Pure and DB-free by construction — the module imports nothing at runtime but
 * `./quality` and `./ids` — so this runs in CI's fast build job.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/kritik-library/framework.json"), "utf8"));

const {
  CROSS_SURFACE_ID,
  DEFAULT_TARGET_LEVEL,
  acceptFinding,
  auditCompletedInput,
  deriveQualityMatrix,
  domainCodeOf,
  findingOpenedInput,
  findingResolvedInput,
  mintFindingId,
  parseSurfaceSpec,
  patchFinding,
  renderIssue,
  resolveFinding,
  signalRunSheet,
  signalTrippedInput,
  upsertAssessment,
  upsertFinding,
  makeEvent,
} = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const finding = (over = {}) => ({
  id: "F-2026-08-SEC-web-01",
  criterion_id: "SEC-01",
  surface: "web",
  title: "Sign-out leaves the refresh token live",
  detail: "A signed-out device can refresh back in.",
  evidence: "auth/signout.ts:12",
  impact: 4,
  likelihood: 4,
  cost: "S",
  status: "open",
  ...over,
});

// --- assessments -------------------------------------------------------------

{
  const a = { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "x", audit_id: "2026-08", ts: "t1" };
  const b = { ...a, level: 3, evidence: "y", ts: "t2" };
  const other = { ...a, surface: "ios" };

  const first = upsertAssessment([], a);
  check("a first score is appended", first.assessments.length === 1 && first.replaced === undefined);

  const second = upsertAssessment([a, other], b);
  check("re-scoring a cell replaces it", second.assessments.length === 2);
  check("re-scoring keeps the row's position", second.assessments[0].level === 3 && second.assessments[1].surface === "ios");
  check("the replaced row comes back so the move can be reported", second.replaced?.level === 2);

  const untouched = upsertAssessment([a], other);
  check("a different surface is a different cell", untouched.assessments.length === 2);
  check("upsertAssessment never mutates its input", eq([a], [{ ...a }]) && a.level === 2);
}

// --- finding ids -------------------------------------------------------------

{
  check("a domain code comes from the library", domainCodeOf("SEC-01", pack) === "SEC");
  check("an unknown criterion falls back to its id prefix", domainCodeOf("X-07") === "X");

  const first = mintFindingId("2026-08", "SEC-01", "web", [], pack);
  check("the minted id follows the pilot convention", first === "F-2026-08-SEC-web-01", first);

  // A refuted finding is disclosed, never deleted — so ...-01 stays taken even
  // though nothing about it is open, and reusing the number would collide.
  const taken = ["F-2026-08-SEC-web-01", "F-2026-08-SEC-web-02"];
  check("minting skips ids already taken", mintFindingId("2026-08", "SEC-01", "web", taken, pack) === "F-2026-08-SEC-web-03");
  check("a different surface numbers independently", mintFindingId("2026-08", "SEC-01", "ios", taken, pack) === "F-2026-08-SEC-ios-01");
}

// --- findings ----------------------------------------------------------------

{
  const open = finding();
  const added = upsertFinding([], open);
  check("a finding is appended", added.findings.length === 1);
  check("the same id replaces rather than duplicating", upsertFinding([open], finding({ title: "edited" })).findings.length === 1);

  const missing = patchFinding([open], "F-nope", { status: "resolved" });
  check("patching an absent id reports nothing rather than silently no-opping", missing.finding === undefined);
  check("patching an absent id leaves the list intact", missing.findings.length === 1 && missing.findings[0].status === "open");

  const resolved = resolveFinding([open], open.id, "https://github.com/x/y/pull/9");
  check("resolve sets the status", resolved.finding.status === "resolved");
  check("resolve records what closed it", resolved.finding.resolved_by === "https://github.com/x/y/pull/9");
  check("resolve does not mutate the original", open.status === "open");

  const accepted = acceptFinding([open], open.id, "Staging only.");
  check("accept sets accepted-risk", accepted.finding.status === "accepted-risk");
  check("the note lands in detail, where the validator looks for it", accepted.finding.detail.includes("Accepted risk: Staging only."));
  check("accepting keeps what the finding actually said", accepted.finding.detail.includes("A signed-out device can refresh back in."));
}

// --- event inputs ------------------------------------------------------------

{
  const opened = findingOpenedInput(finding(), pack);
  check("finding.opened carries the identity", opened.payload.finding_id === "F-2026-08-SEC-web-01");
  // Severity is forbidden ON a finding and required ON the event: state must stay
  // derivable, history must stay true to the scales in force when it happened.
  check("finding.opened stamps the derived severity", opened.payload.severity === "high", JSON.stringify(opened.payload));
  check("finding.opened stamps the derived priority", opened.payload.priority === "P0");
  check("finding.opened is a valid event once stamped", makeEvent(opened.type, opened.payload, { actor: "t" }).type === "quality.finding.opened");

  const withNodes = findingOpenedInput(finding({ node_ids: ["V-home"], issue_url: "https://x/1" }), pack);
  check("finding.opened carries the graph tie", eq(withNodes.payload.node_ids, ["V-home"]));

  const resolved = findingResolvedInput(finding(), "https://x/pull/9");
  check("finding.resolved carries resolved_by", resolved.payload.resolved_by === "https://x/pull/9");
  check("finding.resolved omits resolved_by when there is none", findingResolvedInput(finding()).payload.resolved_by === undefined);

  const tripped = signalTrippedInput({ criterion_id: "SEC-02", surface: "supabase", signal: "grep returned 3 hits" });
  check("signal.tripped is a valid event", makeEvent(tripped.type, tripped.payload, { actor: "t" }).type === "quality.signal.tripped");
}

{
  const section = {
    framework_version: pack.version,
    profile: { surfaces: [{ id: "web", title: "Web" }, { id: "ios", title: "iOS" }] },
    assessments: [
      { criterion_id: "SEC-01", surface: "web", level: 3, evidence: "e", audit_id: "2026-08", ts: "t" },
      { criterion_id: "SEC-02", surface: "web", level: 2, evidence: "e", audit_id: "2026-08", ts: "t" },
    ],
    findings: [finding()],
  };
  const matrix = deriveQualityMatrix({ quality: section }, pack);
  const event = auditCompletedInput(matrix, { audit_id: "2026-08", framework_version: pack.version, commit: "abc" });

  check("audit.completed is the roll-up, not a hand-assembled claim", event.payload.scores.web.SEC === matrix.matrix.SEC.web.score);
  check("audit.completed carries the finding counts", eq(event.payload.counts, matrix.finding_counts));
  // "Not assessed" and "assessed at nothing" are different claims; only one of
  // them is a regression, so an unscored cell is absent rather than zero.
  check("an unscored domain is absent, never a zero", event.payload.scores.web.PRV === undefined);
  check("an unscored surface still gets its (empty) entry", eq(event.payload.scores.ios, {}));
  check("audit.completed is a valid event", makeEvent(event.type, event.payload, { actor: "t" }).type === "quality.audit.completed");
}

// --- issue skeletons ---------------------------------------------------------

{
  const criterion = pack.criteria.find((c) => c.id === "SEC-01");
  const bare = renderIssue(criterion, { surface: "web" });
  check("an unknown placeholder is left standing for the author", bare.body.includes("{evidence_bullets_with_file_paths}"));
  check("the surface is filled", bare.body.includes("**Surface:** web"));
  check("the surface becomes a label", bare.labels.includes("web"));

  const levelled = renderIssue(criterion, { surface: "web", level: 2 });
  check("a level fills its own anchor", levelled.body.includes(criterion.level_anchors.l2));
  check("the target defaults to one level up", levelled.title.includes("target 3"));

  // SEC-02 already carries `supabase` as a domain label; appending the surface
  // blindly would file the issue with the same label twice.
  const dupey = renderIssue(pack.criteria.find((c) => c.id === "SEC-02"), { surface: "supabase" });
  check("labels are deduped", dupey.labels.filter((l) => l === "supabase").length === 1, dupey.labels.join(", "));

  const withFinding = renderIssue(criterion, { surface: "web", level: 1, finding: finding(), library: pack });
  check("a finding's evidence always lands, whatever the template calls its placeholder", withFinding.body.includes("auth/signout.ts:12"));
  check("the footer names the finding", withFinding.body.includes("F-2026-08-SEC-web-01"));
  check("the footer ranks it", withFinding.body.includes("high / P0"), withFinding.body.slice(-260));
  check("no footer without a finding", !bare.body.includes("Kritik finding"));
}

// --- signals -----------------------------------------------------------------

{
  const surfaces = [{ id: "web", title: "Web" }, { id: "supabase", title: "DB" }];
  const all = signalRunSheet(pack, surfaces);
  check("the run sheet expands criteria across their surfaces", all.length > 0);
  check("every row names the cell it belongs to", all.every((row) => row.criterion_id && row.surface && typeof row.index === "number"));
  check(
    "a criterion is only listed on the surfaces it applies to",
    all.every((row) => {
      const criterion = pack.criteria.find((c) => c.id === row.criterion_id);
      return !Array.isArray(criterion.applies_to) || criterion.applies_to.includes(row.surface);
    }),
  );

  const one = signalRunSheet(pack, surfaces, { criterion: "SEC-02", surface: "supabase" });
  const sec02 = pack.criteria.find((c) => c.id === "SEC-02");
  check("filtering narrows to one cell", one.length === sec02.signals.length && one.every((r) => r.surface === "supabase"));
  check("the index addresses the criterion's own signals[]", one[1].signal === sec02.signals[1]);

  const domain = signalRunSheet(pack, surfaces, { domain: "SEC" });
  check("filtering by domain works", domain.length > 0 && domain.every((row) => row.criterion_id.startsWith("SEC-")));

  // cross-surface is the contract BETWEEN surfaces — there is nothing to run a
  // grep against, which is the same reason it holds no assessments.
  const withCross = signalRunSheet(pack, [...surfaces, { id: CROSS_SURFACE_ID, title: "Contract" }]);
  check("cross-surface never appears in the run sheet", !withCross.some((row) => row.surface === CROSS_SURFACE_ID));
}

// --- surfaces ----------------------------------------------------------------

{
  check("a bare id becomes a surface titled after itself", eq(parseSurfaceSpec("web"), { id: "web", title: "web" }));
  check("id:title parses", eq(parseSurfaceSpec("admin:Back office"), { id: "admin", title: "Back office" }));
  check("id:title:platform parses", eq(parseSurfaceSpec("web:Web app:web"), { id: "web", title: "Web app", platform: "web" }));

  const rejects = (spec) => {
    try {
      parseSurfaceSpec(spec);
      return false;
    } catch {
      return true;
    }
  };
  check("a non-kebab id is refused", rejects("Web App"));
  check("a non-Arkaik platform is refused", rejects("cli:CLI:desktop"));
  check("cross-surface cannot be declared as a surface", rejects(CROSS_SURFACE_ID));
  check("an empty spec is refused", rejects(""));
}

check("the default target level is Managed", DEFAULT_TARGET_LEVEL === 3);

if (failures > 0) {
  console.error(`\n${failures} Kritik operation test(s) failed.`);
  process.exit(1);
}
console.log("\nAll Kritik operation tests passed");
