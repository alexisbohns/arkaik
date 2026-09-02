/**
 * Kritik quality-layer tests (docs/rfcs/kritik.md, issue #382 phase A).
 *
 * The centrepiece is a golden replay: `tests/fixtures/quality/pilot-2026-08.json`
 * carries every one of the Pebbles pilot audit's 338 assessments and 246
 * findings (real rows, prose truncated) plus that audit's committed
 * `matrix.json`. Scoring the fixture against the pack this repo ships
 * (`packages/kritik-library/framework.json`) must reproduce that matrix
 * exactly — every cell, every grade, every cap, every roll-up. That pins two
 * things at once: the port of `compute-matrix.mjs` into `deriveQualityMatrix`,
 * and the shipped pack itself, since a changed weight or band would move a cell.
 *
 * The second golden replays severity and priority: the pilot stored both, the
 * model derives both, and 246 real findings agree or the port is wrong.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/quality/pilot-2026-08.json"), "utf8"));
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/kritik-library/framework.json"), "utf8"));

const {
  deriveQualityMatrix,
  severityOf,
  priorityOf,
  gradeOf,
  capGrade,
  isOpenFinding,
  resolveKritikLibrary,
  validateBundle,
  parseBundle,
  JOURNAL_EVENT_SCHEMAS,
  KnownJournalEventSchema,
  QualitySectionSchema,
  QualityFindingSchema,
  DEFAULT_CAPS,
  findingAcceptedInput,
  makeEvent,
} = loadSchema();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const library = { version: pack.version, domains: pack.domains, criteria: pack.criteria, scales: pack.scales };
const section = fixture.section;
const bundle = { quality: section };

// --- Golden: the pilot audit's matrix, cell for cell ------------------------

const derived = deriveQualityMatrix(bundle, library);
const expected = fixture.expected;

check("surfaces come from the profile, in profile order", eq(derived.surfaces, ["web", "ios", "android", "admin", "supabase"]), derived.surfaces.join());
check("domains come from the pack, in pack order", eq(derived.domains, pack.domains.map((d) => d.code)), derived.domains.join());
check("framework_version is carried through", derived.framework_version === "0.1.0", derived.framework_version);

let cellMismatches = [];
for (const domain of Object.keys(expected.matrix)) {
  for (const surface of Object.keys(expected.matrix[domain])) {
    const want = expected.matrix[domain][surface];
    const got = derived.matrix[domain]?.[surface];
    if (!eq(want, got)) cellMismatches.push(`${domain}x${surface}: want ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
  }
}
check(
  `all ${Object.keys(expected.matrix).length * derived.surfaces.length} (domain x surface) cells match the pilot matrix`,
  cellMismatches.length === 0,
  cellMismatches.slice(0, 3).join(" | "),
);
check("no extra cells beyond the pilot matrix", eq(Object.keys(derived.matrix).sort(), Object.keys(expected.matrix).sort()));
check("surface roll-ups match", eq(derived.overall, expected.overall), `${JSON.stringify(derived.overall)} vs ${JSON.stringify(expected.overall)}`);
check("open-finding counts match", eq(derived.finding_counts, expected.finding_counts), JSON.stringify(derived.finding_counts));

// The caps are the whole point of the roll-up rules; assert the pilot actually
// exercises them rather than trusting a matrix that might never cap anything.
const cappedCells = [];
for (const domain of Object.keys(derived.matrix)) {
  for (const surface of Object.keys(derived.matrix[domain])) {
    const cell = derived.matrix[domain][surface];
    if (cell?.capped) cappedCells.push(`${domain}x${surface}`);
  }
}
check("the pilot exercises the anti-averaging caps", cappedCells.length > 0, `capped: ${cappedCells.join()}`);

// --- Golden: severity and priority over 246 real findings -------------------

const derivedMismatches = fixture.expected_derived.filter((want) => {
  const finding = section.findings.find((f) => f.id === want.id);
  return severityOf(finding, library) !== want.severity || priorityOf(finding, library) !== want.priority;
});
check(
  `severity + priority derive to the pilot's stored values for all ${fixture.expected_derived.length} findings`,
  derivedMismatches.length === 0,
  derivedMismatches.slice(0, 3).map((m) => m.id).join(),
);

// --- Scale rules (packages/kritik-library/SPEC.md § 4) ----------------------

check("severity buckets on impact x likelihood", eq(
  [[5, 5], [4, 5], [4, 3], [2, 3], [1, 2], [1, 1]].map(([i, l]) => severityOf({ impact: i, likelihood: l })),
  ["critical", "critical", "high", "medium", "low", "info"],
));
check("a score above the top band still reads critical, never info", severityOf({ impact: 9, likelihood: 9 }) === "critical");
check("non-numeric risk inputs land in info rather than throwing", severityOf({ impact: undefined, likelihood: "4" }) === "info");

check("critical is never demoted by cost", eq(
  ["S", "M", "L", "XL"].map((cost) => priorityOf({ impact: 5, likelihood: 5, cost })),
  ["P0", "P0", "P0", "P0"],
));
check("a cheap High is P0, an expensive High is P1", priorityOf({ impact: 4, likelihood: 4, cost: "S" }) === "P0" && priorityOf({ impact: 4, likelihood: 4, cost: "XL" }) === "P1");
check("a cheap Medium is P1, an expensive Medium is P2", priorityOf({ impact: 3, likelihood: 3, cost: "S" }) === "P1" && priorityOf({ impact: 3, likelihood: 3, cost: "L" }) === "P2");
check("a cheap Low is P2, an expensive Low is P3", priorityOf({ impact: 1, likelihood: 3, cost: "S" }) === "P2" && priorityOf({ impact: 1, likelihood: 3, cost: "M" }) === "P3");

check("grade bands A-E", eq([100, 85, 84, 70, 55, 40, 39, 0].map((s) => gradeOf(s)), ["A", "A", "B", "B", "C", "D", "E", "E"]));
check("capGrade takes the harsher of two", capGrade("A", "D") === "D" && capGrade("E", "B") === "E" && capGrade("C", "C") === "C");
check("an absent status reads as open", isOpenFinding({}) === true && isOpenFinding({ status: "resolved" }) === false && isOpenFinding({ status: "accepted-risk" }) === false);

// --- Cap behaviour in isolation ---------------------------------------------

const capLibrary = {
  version: "t",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [{ id: "SEC-01", domain: "SEC", weight: 1 }],
  scales: { caps: DEFAULT_CAPS },
};
const capBundle = (findings) => ({
  quality: {
    framework_version: "t",
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [{ criterion_id: "SEC-01", surface: "web", level: 4, evidence: "e", audit_id: "a", ts: "t" }],
    findings,
  },
});
const finding = (over) => ({ id: "F", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", cost: "M", status: "open", ...over });

const clean = deriveQualityMatrix(capBundle([]), capLibrary).matrix.SEC.web;
check("a fully-mature cell grades A uncapped", clean.score === 100 && clean.grade === "A" && clean.capped === false);
const withCritical = deriveQualityMatrix(capBundle([finding({ impact: 5, likelihood: 5 })]), capLibrary).matrix.SEC.web;
check("an open Critical caps a 100 at D", withCritical.score === 100 && withCritical.grade === "D" && withCritical.capped === true);
const withHigh = deriveQualityMatrix(capBundle([finding({ impact: 4, likelihood: 4 })]), capLibrary).matrix.SEC.web;
check("an open High caps a 100 at B", withHigh.grade === "B" && withHigh.capped === true);
const resolvedCritical = deriveQualityMatrix(capBundle([finding({ impact: 5, likelihood: 5, status: "resolved" })]), capLibrary).matrix.SEC.web;
check("a resolved Critical stops capping", resolvedCritical.grade === "A" && resolvedCritical.capped === false);
const acceptedCritical = deriveQualityMatrix(capBundle([finding({ impact: 5, likelihood: 5, status: "accepted-risk" })]), capLibrary).matrix.SEC.web;
check("an accepted-risk Critical stops capping", acceptedCritical.grade === "A");
const lowOnly = deriveQualityMatrix(capBundle([finding({ impact: 1, likelihood: 2 })]), capLibrary).matrix.SEC.web;
check("a Low finding never caps", lowOnly.grade === "A" && lowOnly.capped === false);
check("a cap never raises a grade", deriveQualityMatrix({
  quality: { ...capBundle([finding({ impact: 4, likelihood: 4 })]).quality, assessments: [{ criterion_id: "SEC-01", surface: "web", level: 0, evidence: "e", audit_id: "a", ts: "t" }] },
}, capLibrary).matrix.SEC.web.grade === "E");

// --- Weighting --------------------------------------------------------------

const weighted = deriveQualityMatrix({
  quality: {
    framework_version: "t",
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [
      { criterion_id: "SEC-01", surface: "web", level: 4, evidence: "e", audit_id: "a", ts: "t" },
      { criterion_id: "SEC-02", surface: "web", level: 0, evidence: "e", audit_id: "a", ts: "t" },
    ],
    findings: [],
  },
}, {
  version: "t",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [{ id: "SEC-01", domain: "SEC", weight: 3 }, { id: "SEC-02", domain: "SEC", weight: 1 }],
});
check("criterion weight drives the domain score", weighted.matrix.SEC.web.score === 75, String(weighted.matrix.SEC.web.score));
check("cell reports how many criteria it averages", weighted.matrix.SEC.web.criteria === 2);

const domainWeighted = deriveQualityMatrix({
  quality: {
    framework_version: "t",
    profile: { surfaces: [{ id: "web", title: "Web" }], domain_weights: { SEC: 3, ARC: 1 } },
    assessments: [
      { criterion_id: "SEC-01", surface: "web", level: 4, evidence: "e", audit_id: "a", ts: "t" },
      { criterion_id: "ARC-01", surface: "web", level: 0, evidence: "e", audit_id: "a", ts: "t" },
    ],
    findings: [],
  },
}, {
  version: "t",
  domains: [{ code: "SEC", name: "Security" }, { code: "ARC", name: "Architecture" }],
  criteria: [{ id: "SEC-01", domain: "SEC", weight: 1 }, { id: "ARC-01", domain: "ARC", weight: 1 }],
});
check("profile domain weights drive the surface roll-up", domainWeighted.overall.web === 75, String(domainWeighted.overall.web));

// --- Leniency: nothing here may throw ---------------------------------------

check("a bundle with no quality section yields the empty matrix", eq(deriveQualityMatrix({}), {
  framework_version: undefined, surfaces: [], domains: [], matrix: {}, overall: {}, finding_counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
}));

const naBundle = {
  quality: {
    framework_version: "t",
    profile: { surfaces: [{ id: "web", title: "Web" }, { id: "ios", title: "iOS" }] },
    assessments: [{ criterion_id: "SEC-01", surface: "web", level: 2, evidence: "e", audit_id: "a", ts: "t" }],
    findings: [],
  },
};
const na = deriveQualityMatrix(naBundle, capLibrary);
check("an unscored (domain x surface) cell is null, not zero", na.matrix.SEC.ios === null && na.matrix.SEC.web.score === 50);
check("a surface with no scored cell rolls up to null", na.overall.ios === null && na.overall.web === 50);

const unknownCriterion = deriveQualityMatrix({
  quality: { ...naBundle.quality, assessments: [...naBundle.quality.assessments, { criterion_id: "ZZZ-99", surface: "web", level: 4, evidence: "e", audit_id: "a", ts: "t" }] },
}, capLibrary);
check("an unresolvable criterion lands in no cell rather than throwing", unknownCriterion.matrix.SEC.web.criteria === 1);

const sidecar = deriveQualityMatrix(naBundle);
check("with no pack at all, domains are synthesized from criterion ids", eq(sidecar.domains, ["SEC"]) && sidecar.matrix.SEC.web.score === 50);
check("resolveKritikLibrary returns undefined for an empty section", resolveKritikLibrary({ assessments: [], findings: [] }) === undefined);
check("resolveKritikLibrary prefers an explicit pack over the embedded one", resolveKritikLibrary({ library: { version: "embedded", domains: [], criteria: [] } }, library).version === "0.1.0");
check("a hyphenated domain code survives id splitting", resolveKritikLibrary({ assessments: [{ criterion_id: "A11Y-01" }], findings: [] }).domains[0].code === "A11Y");

const source = JSON.parse(JSON.stringify(naBundle));
deriveQualityMatrix(source, capLibrary);
check("the projection never mutates its input", eq(source, naBundle));

// --- Shapes -----------------------------------------------------------------

check("the pilot section parses against QualitySectionSchema", QualitySectionSchema.safeParse(section).success);
check("the shipped pack parses as a KritikLibrary", QualitySectionSchema.safeParse({ ...section, library }).success);

const asBundle = {
  schema_version: 3,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [],
  edges: [],
  quality: section,
};
const parsed = parseBundle(asBundle);
check("a bundle carrying a quality section parses", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues?.slice(0, 2)));
check("the quality section round-trips through parse", parsed.success && eq(parsed.data.quality, section));
check("an unknown key inside the section round-trips", (() => {
  const withExtra = { ...asBundle, quality: { ...section, future_key: { any: "thing" } } };
  const r = parseBundle(withExtra);
  return r.success && eq(r.data.quality.future_key, { any: "thing" });
})());

for (const type of ["quality.audit.completed", "quality.finding.opened", "quality.finding.resolved", "quality.finding.accepted", "quality.signal.tripped"]) {
  check(`${type} is in the known event vocabulary`, Boolean(JOURNAL_EVENT_SCHEMAS[type]));
}
const auditEvent = { id: "01J", ts: "2026-08-26T00:00:00.000Z", actor: "claude-code", type: "quality.audit.completed", audit_id: "2026-08", framework_version: "0.1.0", commit: "abc", scores: { web: { SEC: 44 } }, counts: { critical: 0, high: 21 } };
check("a quality.audit.completed event validates strictly", KnownJournalEventSchema.safeParse(auditEvent).success);
const openedEvent = { id: "01K", ts: "2026-08-26T00:00:00.000Z", actor: "ci", type: "quality.finding.opened", finding_id: "F-1", criterion_id: "SEC-03", surface: "supabase", severity: "critical", priority: "P0", title: "t", node_ids: ["V-x"] };
check("a quality.finding.opened event validates strictly", KnownJournalEventSchema.safeParse(openedEvent).success);

// quality.finding.accepted — the event that records an accepted risk written
// away from the checkout (hosted mode has no findings file to hold the state).
{
  const input = findingAcceptedInput({ id: "F-2026-08-SEC-web-01", node_ids: ["V-home"] }, "Cost outweighs exposure");
  check("findingAcceptedInput carries finding_id + reason + node_ids",
    input.type === "quality.finding.accepted" &&
    input.payload.finding_id === "F-2026-08-SEC-web-01" &&
    input.payload.reason === "Cost outweighs exposure" &&
    Array.isArray(input.payload.node_ids));

  const event = makeEvent(input.type, input.payload, { actor: "arkaik-agent" });
  const parsed = JOURNAL_EVENT_SCHEMAS["quality.finding.accepted"].safeParse(event);
  check("quality.finding.accepted event validates", parsed.success, JSON.stringify(parsed.error?.issues ?? []));

  const noNodes = findingAcceptedInput({ id: "F-1" }, "why");
  check("node_ids omitted when absent", !("node_ids" in noNodes.payload));
}

// --- validateBundle warnings (RFC § 4.5) ------------------------------------

const rules = (result) => result.findings.map((f) => f.rule);
const base = { schema_version: 3, project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }, nodes: [], edges: [] };

const pilotResult = validateBundle({ ...base, quality: { ...section, library } });
check("the pilot section raises no quality warnings", !rules(pilotResult).some((r) => r.startsWith("quality-")), rules(pilotResult).filter((r) => r.startsWith("quality-")).slice(0, 5).join());
check("the pilot section is still a valid bundle", pilotResult.valid);
check("the pilot's cross-surface findings are real, not an accident", section.findings.filter((f) => f.surface === "cross-surface").length === 4);
check("a cross-surface finding never becomes a matrix column", !derived.surfaces.includes("cross-surface"));
check("cross-surface findings still count in the global tally", derived.finding_counts.medium >= 4);
check("but a cross-surface *assessment* warns — the lens has no cell to render into", rules(validateBundle({
  ...base,
  quality: { framework_version: "0.1.0", library, profile: { surfaces: [{ id: "web", title: "Web" }] }, assessments: [{ criterion_id: "SEC-01", surface: "cross-surface", level: 2, evidence: "e", audit_id: "a", ts: "t" }], findings: [] },
})).includes("quality-cross-surface-assessment"));

const dirty = validateBundle({
  ...base,
  quality: {
    framework_version: "",
    library: { version: "t", domains: [{ code: "SEC", name: "S" }], criteria: [{ id: "SEC-01", domain: "SEC", weight: 1 }, { id: "SEC-02", domain: "SEC", weight: 1, superseded_by: "SEC-09" }] },
    profile: { surfaces: [{ id: "web", title: "Web" }, { id: "web", title: "Dup" }] },
    assessments: [
      { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "e", audit_id: "a", ts: "t" },
      { criterion_id: "SEC-01", surface: "web", level: 3, evidence: "e", audit_id: "a", ts: "t" },
      { criterion_id: "ZZZ-01", surface: "mobile", level: 7, evidence: "  ", audit_id: "a", ts: "t" },
      { criterion_id: "SEC-02", surface: "web", level: 1, evidence: "e", audit_id: "a", ts: "t" },
    ],
    findings: [
      { id: "F-1", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 9, likelihood: 0, cost: "S", status: "open", severity: "critical", priority: "P0" },
      { id: "F-1", criterion_id: "SEC-01", surface: "web", title: "t", detail: "", evidence: "e", impact: 3, likelihood: 3, cost: "S", status: "accepted-risk" },
    ],
  },
  journal: [
    { id: "01A", ts: "2026-08-26T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-ghost" },
  ],
});
const dirtyRules = rules(dirty);
for (const rule of [
  "quality-framework-version-missing",
  "quality-duplicate-surface",
  "quality-duplicate-assessment",
  "quality-unknown-criterion",
  "quality-retired-criterion",
  "quality-unknown-surface",
  "quality-level-range",
  "quality-assessment-no-evidence",
  "quality-duplicate-finding-id",
  "quality-risk-range",
  "quality-derived-field-stored",
  "quality-accepted-risk-no-note",
  "quality-event-no-actor",
  "quality-resolved-never-opened",
]) {
  check(`warns: ${rule}`, dirtyRules.includes(rule), dirtyRules.filter((r) => r.startsWith("quality-")).join());
}
check("every quality rule is a warning — none can fail an import", dirty.errors.every((f) => !f.rule.startsWith("quality-")) && dirty.valid);

const sidecarWarn = validateBundle({ ...base, quality: { framework_version: "0.1.0", profile: { surfaces: [{ id: "web", title: "Web" }] }, assessments: [{ criterion_id: "SEC-01", surface: "web", level: 2, evidence: "e", audit_id: "a", ts: "t" }], findings: [] } });
check("warns once when the pack is a sidecar rather than embedded", rules(sidecarWarn).filter((r) => r === "quality-library-missing").length === 1);

const noSurfaces = validateBundle({ ...base, quality: { framework_version: "0.1.0", library, profile: { surfaces: [] }, assessments: [{ criterion_id: "SEC-01", surface: "web", level: 2, evidence: "e", audit_id: "a", ts: "t" }], findings: [] } });
check("warns when quality data is stored but no surface was picked", rules(noSurfaces).includes("quality-no-surfaces"));

check("a bundle with no quality section raises no quality warnings", !rules(validateBundle(base)).some((r) => r.startsWith("quality-")));
check("a non-object quality value is ignored rather than throwing", validateBundle({ ...base, quality: [] }).valid);

{
  const finding = {
    id: "F-2026-08-SEC-web-01", criterion_id: "SEC-01", surface: "web",
    title: "t", detail: "d", evidence: "file.ts:1", impact: 4, likelihood: 4,
    cost: "M", status: "open", commit: "0123abc",
  };
  const parsed = QualityFindingSchema.safeParse(finding);
  check("finding accepts optional commit anchor", parsed.success, JSON.stringify(parsed.error?.issues ?? []));
}

console.log(failures === 0 ? "\nAll quality tests passed" : `\n${failures} quality test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
