# Kritik Phase D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Kritik quality layer in the app — a `/quality` route with the comparative matrix and a findings board, a criterion detail panel in the shared stack, severity badges on nodes, and a quality card on the Overview.

**Architecture:** Pure projections in `lib/utils/quality.ts` over `bundle.quality`, consumed by a single `/project/[id]/quality` route. All scoring comes from `@arkaik/schema` (`deriveQualityMatrix`, `severityOf`, `priorityOf`, `gradeOf`, `resolveKritikLibrary`) — nothing here reimplements a scale. The panel stack gains an addressless `criterion` kind; the Quality page owns `?criterion=` so `?node=` is untouched.

**Tech Stack:** Next.js App Router (client components), React 19, Tailwind, lucide-react, `@arkaik/schema`. Tests are plain `node` scripts under `tests/app/` using a TypeScript transpile loader — no test framework, no jsdom.

**Spec:** [`docs/superpowers/specs/2026-08-29-kritik-phase-d-design.md`](../specs/2026-08-29-kritik-phase-d-design.md)

---

## Ground rules for every task

- **Branch:** `feat/kritik-phase-d` (already created, spec already committed).
- **Never reimplement a scale.** `severityOf`, `priorityOf`, `gradeOf`, `capGrade`, `isOpenFinding`, `resolveKritikLibrary`, `deriveQualityMatrix` are all imported from `@arkaik/schema`.
- **Lint is a CI gate.** `npm run lint` must report 0 errors. Warnings are tolerated (main sits at 4).
- **Comments explain *why*.** This codebase writes long "why it is built this way" comments. Match that density — see `lib/utils/project-panels.ts` for the house voice. Do not write comments that restate the code.
- **No `any`.** `tsconfig` has `strict`. `noUncheckedIndexedAccess` is OFF, so indexed reads are typed as present — guard them anyway where a miss is real.

### The fixture

`tests/fixtures/quality/pilot-2026-08.json` is the golden. Its shape:

```js
{
  _source: { repo, pull_request, audit_id, commit, framework_version, note },
  section: { framework_version, profile: { surfaces: [...] }, assessments: [338], findings: [246] },
  expected: { audit_id, commit, framework_version, matrix, overall, finding_counts },
  expected_derived: [ { id: "F-2026-08-SEC-supabase-01", severity: "critical", priority: "P0" }, ... 246 ]
}
```

**`section` carries no `library`.** The pack is loaded separately from `packages/kritik-library/framework.json` and passed explicitly. Every test below does this.

Surfaces are `web`, `ios`, `android`, `admin`, `supabase`. 29 findings carry `node_ids`.

---

## Task 1: The test loader and `buildFindingRows`

**Files:**
- Create: `lib/utils/quality.ts`
- Create: `tests/app/load-quality.js`
- Create: `tests/app/quality.test.js`

- [ ] **Step 1: Write the loader**

`lib/utils/quality.ts` imports only from `@arkaik/schema` (values) and `@/lib/data/types` (types, elided at transpile). So the loader is the simple end of the `load-coverage.js` pattern.

Create `tests/app/load-quality.js`:

```js
/**
 * Loads lib/utils/quality.ts into Node without a bundler.
 *
 * Simpler than load-coverage.js because quality.ts has exactly one runtime
 * dependency — @arkaik/schema, for the scales it must never reimplement. Its
 * only other import is `@/lib/data/types`, which is type-only and vanishes at
 * transpile, so there is no local module graph to rebuild here.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-quality");

function loadQuality() {
  // Build the schema package so the rewritten require resolves at runtime.
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  const source = fs.readFileSync(path.join(ROOT, "lib/utils/quality.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "quality.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const rewritten = outputText.replace(
    /require\((['"])@arkaik\/schema\1\)/g,
    `require(${JSON.stringify(schemaIndex)})`,
  );
  fs.writeFileSync(path.join(BUILD_DIR, "quality.js"), rewritten);
  delete require.cache[path.join(BUILD_DIR, "quality.js")];

  // The schema's own exports ride along: a suite that checked buildFindingRows
  // against a restatement of severityOf would be checking nothing.
  return {
    ...require(path.join(BUILD_DIR, "quality.js")),
    severityOf: require(schemaIndex).severityOf,
    priorityOf: require(schemaIndex).priorityOf,
    deriveQualityMatrix: require(schemaIndex).deriveQualityMatrix,
    resolveKritikLibrary: require(schemaIndex).resolveKritikLibrary,
  };
}

module.exports = { loadQuality, BUILD_DIR, SCHEMA_BUILD_DIR };
```

- [ ] **Step 2: Write the failing test**

Create `tests/app/quality.test.js`:

```js
#!/usr/bin/env node

/**
 * Quality page projections (lib/utils/quality.ts), replayed against the Pebbles
 * pilot — the same golden that guards deriveQualityMatrix in tests/schema.
 *
 * The fixture's section carries no library on purpose: the pack is loaded from
 * packages/kritik-library/framework.json and passed explicitly, exactly as the
 * app does when a bundle keeps its pack as a sidecar.
 */

const fs = require("fs");
const path = require("path");
const { loadQuality } = require("./load-quality");

const ROOT = path.join(__dirname, "..", "..");
const fixture = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tests/fixtures/quality/pilot-2026-08.json"), "utf8"),
);
const pack = JSON.parse(
  fs.readFileSync(path.join(ROOT, "packages/kritik-library/framework.json"), "utf8"),
);
const section = fixture.section;

const { buildFindingRows, severityOf, priorityOf } = loadQuality();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// =========================== buildFindingRows ================================

const rows = buildFindingRows(section, pack);

assert(rows.length === 246, "every finding produces a row (246)");

const derivedMismatches = fixture.expected_derived.filter((want) => {
  const row = rows.find((candidate) => candidate.id === want.id);
  return !row || row.severity !== want.severity || row.priority !== want.priority;
});
assert(
  derivedMismatches.length === 0,
  `severity + priority match the pilot's stored values for all ${fixture.expected_derived.length} findings`,
);

const first = rows.find((row) => row.id === "F-2026-08-SEC-supabase-01");
assert(first.domain === "SEC", "a row carries its criterion's domain code");
assert(first.risk === first.impact * first.likelihood, "risk is impact x likelihood");
assert(first.open === true, "an open finding reads as open");
assert(Array.isArray(first.nodeIds), "nodeIds is always an array, never undefined");

const linked = rows.filter((row) => row.nodeIds.length > 0);
assert(linked.length === 29, "29 rows carry linked node ids");

// A criterion id the pack does not define resolves to no domain, and the row
// still exists — the matrix cannot place it, the board must still list it.
const orphanRows = buildFindingRows(
  { findings: [{ id: "F-x", criterion_id: "ZZZ-99", surface: "web", title: "t", detail: "d", evidence: "e", impact: 3, likelihood: 3, cost: "M", status: "open" }] },
  pack,
);
assert(orphanRows.length === 1, "a finding whose criterion is unknown still produces a row");
assert(orphanRows[0].domain === "", "an unresolvable criterion yields an empty domain code");
assert(orphanRows[0].severity === severityOf(orphanRows[0], pack), "an orphan row is still scored");

// Degradation: no library at all.
const bare = buildFindingRows(section, undefined);
assert(bare.length === 246, "rows build with no library at all");
assert(bare[0].criterionName !== undefined, "criterionName is defined even with no library");

// Absent section.
assert(buildFindingRows(undefined, pack).length === 0, "an absent section yields no rows");

console.log(failures === 0 ? "\nAll quality projections OK" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 3: Run it to verify it fails**

```bash
node tests/app/quality.test.js
```

Expected: FAIL — `Cannot find module` / `lib/utils/quality.ts` does not exist.

- [ ] **Step 4: Write `lib/utils/quality.ts`**

```ts
/**
 * The Quality page's projections.
 *
 * Everything here reads `bundle.quality` and a resolved Kritik library and
 * returns plain data. Not one scale is reimplemented: severity, priority,
 * grades and the comparative matrix all come from `@arkaik/schema`, which is
 * where the CLI and MCP read them too. A second implementation of `severityOf`
 * living in the app would be a second answer to "how bad is this", and the two
 * would drift the first time a pack moved a bucket.
 *
 * These live app-side rather than in the schema package for the reason
 * `coverage.ts`, `delivery.ts` and `pyramid.ts` do: they are page shapes with
 * one consumer. `deriveQualityMatrix` is in the schema package because
 * `arkaik kritik matrix` and `kritik_matrix` both call it.
 */

import {
  isOpenFinding,
  priorityOf,
  severityOf,
  type FindingPriority,
  type FindingSeverity,
  type FindingStatus,
  type KritikCriterion,
  type KritikDomain,
  type KritikLibrary,
  type QualityFinding,
  type QualitySection,
  type RemediationCost,
} from "@arkaik/schema";

/** A finding with everything the board renders, resolved once. */
export interface FindingRow {
  id: string;
  criterionId: string;
  /** The criterion's name from the pack, falling back to its id. */
  criterionName: string;
  /** Owning domain code, `""` when the pack does not define the criterion. */
  domain: string;
  domainName: string;
  surface: string;
  title: string;
  detail: string;
  evidence: string;
  impact: number;
  likelihood: number;
  /** `impact x likelihood` — the number the severity bucket is read from. */
  risk: number;
  cost: RemediationCost;
  severity: FindingSeverity;
  priority: FindingPriority;
  status: FindingStatus;
  open: boolean;
  /** Always an array; a finding with no links is `[]`, never `undefined`. */
  nodeIds: string[];
  issueUrl?: string;
  verification?: { verdict: string; note: string };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** `criterion id -> criterion`, built once per projection pass. */
function criteriaById(library?: KritikLibrary): Map<string, KritikCriterion> {
  const index = new Map<string, KritikCriterion>();
  for (const criterion of asArray<KritikCriterion>(library?.criteria)) {
    if (typeof criterion?.id === "string") index.set(criterion.id, criterion);
  }
  return index;
}

/** `domain code -> display name`, falling back to the code itself. */
function domainNames(library?: KritikLibrary): Map<string, string> {
  const index = new Map<string, string>();
  for (const domain of asArray<KritikDomain>(library?.domains)) {
    if (typeof domain?.code === "string") index.set(domain.code, domain.name ?? domain.code);
  }
  return index;
}

/**
 * Every finding, denormalized.
 *
 * The single place a finding is flattened. The board, the node index and the
 * criterion panel all consume this rather than walking `section.findings`
 * again, so severity is computed once per finding and the three surfaces
 * cannot disagree about what a finding is.
 *
 * A finding whose `criterion_id` the pack does not define gets `domain: ""`.
 * That is deliberate and matches `deriveQualityMatrix`, which drops it from
 * every cell: nobody wrote a weight for it, so it cannot be scored into a
 * domain. It is still a row, because a finding the UI cannot place is still a
 * finding somebody has to act on — dropping it here would make it invisible.
 */
export function buildFindingRows(
  section: Pick<QualitySection, "findings"> | undefined,
  library?: KritikLibrary,
): FindingRow[] {
  const criteria = criteriaById(library);
  const names = domainNames(library);

  return asArray<QualityFinding>(section?.findings).map((finding) => {
    const criterion = criteria.get(finding.criterion_id);
    const domain = typeof criterion?.domain === "string" ? criterion.domain : "";
    const impact = typeof finding.impact === "number" ? finding.impact : 0;
    const likelihood = typeof finding.likelihood === "number" ? finding.likelihood : 0;

    return {
      id: finding.id,
      criterionId: finding.criterion_id,
      criterionName: (criterion?.name as string | undefined) ?? finding.criterion_id,
      domain,
      domainName: names.get(domain) ?? domain,
      surface: finding.surface,
      title: finding.title,
      detail: finding.detail,
      evidence: finding.evidence,
      impact,
      likelihood,
      risk: impact * likelihood,
      cost: finding.cost,
      severity: severityOf(finding, library),
      priority: priorityOf(finding, library),
      status: finding.status ?? "open",
      open: isOpenFinding(finding),
      nodeIds: asArray<string>(finding.node_ids),
      issueUrl: finding.issue_url,
      verification: finding.verification,
    };
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node tests/app/quality.test.js
```

Expected: every line `PASS`, exit 0. If `severity + priority match` fails, the bug is in `buildFindingRows` passing the wrong object to `severityOf` — it must receive the raw finding (with `impact`/`likelihood`/`cost`), not the row.

- [ ] **Step 6: Commit**

```bash
git add lib/utils/quality.ts tests/app/load-quality.js tests/app/quality.test.js
git commit -m "feat(quality): denormalize findings for the board"
```

---

## Task 2: `filterFindings` and `groupByPriority`

**Files:**
- Modify: `lib/utils/quality.ts` (append)
- Modify: `tests/app/quality.test.js` (append)

- [ ] **Step 1: Append the failing tests**

Append to `tests/app/quality.test.js`, *before* the final `console.log`/`process.exit` block (move those to the end of the file as you go):

```js
// =========================== filterFindings ==================================

const { filterFindings, groupByPriority, EMPTY_QUALITY_FILTERS, deriveQualityMatrix } = loadQuality();

assert(
  filterFindings(rows, EMPTY_QUALITY_FILTERS).length === 246,
  "the empty filter set narrows nothing",
);

const critical = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, severity: "critical" });
assert(
  critical.every((row) => row.severity === "critical") && critical.length > 0,
  "severity narrows to that severity",
);

const web = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, surface: "web" });
assert(web.every((row) => row.surface === "web") && web.length > 0, "surface narrows to that surface");

const both = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, severity: "critical", surface: "web" });
assert(
  both.every((row) => row.severity === "critical" && row.surface === "web"),
  "severity and surface compose",
);
assert(both.length <= Math.min(critical.length, web.length), "composing filters never widens");

// Search reaches title, criterion id and evidence.
const searched = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, search: "SEC-03" });
assert(searched.length > 0, "search finds by criterion id");
assert(
  filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, search: "zzzznotpresent" }).length === 0,
  "a search matching nothing yields nothing",
);
assert(
  filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, search: "sec-03" }).length === searched.length,
  "search is case-insensitive",
);

// The cell filter must agree with the matrix that drew the cell.
const matrix = deriveQualityMatrix({ quality: section }, pack);
const cellRows = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, cell: "SEC|web" });
const cellCounts = matrix.matrix.SEC.web.findings;
const openCellRows = cellRows.filter((row) => row.open);
assert(
  openCellRows.filter((row) => row.severity === "high").length === cellCounts.high &&
    openCellRows.filter((row) => row.severity === "medium").length === cellCounts.medium,
  "the cell filter selects exactly the open findings deriveQualityMatrix counted in that cell",
);

// Status: the board can show resolved work, the matrix never counts it.
const resolved = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, status: "resolved" });
assert(resolved.every((row) => row.status === "resolved"), "status narrows to that status");

// =========================== groupByPriority =================================

const groups = groupByPriority(rows);
assert(groups.length === 4, "there are always four priority groups");
assert(
  groups.map((group) => group.priority).join(",") === "P0,P1,P2,P3",
  "groups are ordered P0 first",
);
assert(
  groups.reduce((total, group) => total + group.rows.length, 0) === rows.length,
  "every row lands in exactly one group",
);

const emptyGroups = groupByPriority([]);
assert(
  emptyGroups.length === 4 && emptyGroups.every((group) => group.rows.length === 0),
  "empty groups are retained so the board can say 'none at this priority'",
);
```

- [ ] **Step 2: Run to verify it fails**

```bash
node tests/app/quality.test.js
```

Expected: FAIL — `filterFindings is not a function`.

- [ ] **Step 3: Append the implementation to `lib/utils/quality.ts`**

```ts
/**
 * The board's filter set. `cell` is encoded `"<domain>|<surface>"` because it
 * travels in the URL and a matrix cell is exactly a domain and a surface.
 */
export interface QualityFilters {
  search: string;
  severity: FindingSeverity | "all";
  surface: string;
  priority: FindingPriority | "all";
  domain: string;
  status: FindingStatus | "all";
  /** `"SEC|web"`, or `null` for no active cell. */
  cell: string | null;
  sort: QualitySort;
}

export type QualitySort = "severity" | "priority" | "surface" | "domain";

export const EMPTY_QUALITY_FILTERS: QualityFilters = {
  search: "",
  severity: "all",
  surface: "all",
  priority: "all",
  domain: "all",
  status: "all",
  cell: null,
  sort: "severity",
};

/** Encode a matrix cell for the URL and the filter set. */
export function cellKey(domain: string, surface: string): string {
  return `${domain}|${surface}`;
}

/** Decode a cell key; `null` for anything that is not one. */
export function parseCellKey(key: string | null): { domain: string; surface: string } | null {
  if (!key) return null;
  const separator = key.indexOf("|");
  if (separator <= 0 || separator === key.length - 1) return null;
  return { domain: key.slice(0, separator), surface: key.slice(separator + 1) };
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Narrow the rows. Every filter is a conjunction, `"all"` and `""` meaning
 * "do not narrow on this" — the same convention `filterAcceptances` uses, so a
 * reader who knows one bar knows this one.
 *
 * Search reaches title, detail, evidence, criterion id and criterion name,
 * because the pilot's own console searched file paths and the evidence field is
 * where a `file:line` citation lives.
 */
export function filterFindings(rows: FindingRow[], filters: QualityFilters): FindingRow[] {
  const cell = parseCellKey(filters.cell);
  const needle = filters.search.trim().toLowerCase();

  const matched = rows.filter((row) => {
    if (filters.severity !== "all" && row.severity !== filters.severity) return false;
    if (filters.priority !== "all" && row.priority !== filters.priority) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.surface !== "all" && row.surface !== filters.surface) return false;
    if (filters.domain !== "all" && row.domain !== filters.domain) return false;
    if (cell && (row.domain !== cell.domain || row.surface !== cell.surface)) return false;
    if (needle === "") return true;

    return [row.title, row.detail, row.evidence, row.criterionId, row.criterionName]
      .join("\n")
      .toLowerCase()
      .includes(needle);
  });

  return sortFindings(matched, filters.sort);
}

/** Worst first on every axis; the id breaks ties so the order is stable. */
function sortFindings(rows: FindingRow[], sort: QualitySort): FindingRow[] {
  const bySeverity = (a: FindingRow, b: FindingRow) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.risk - a.risk;

  return [...rows].sort((a, b) => {
    if (sort === "priority") return a.priority.localeCompare(b.priority) || bySeverity(a, b) || a.id.localeCompare(b.id);
    if (sort === "surface") return a.surface.localeCompare(b.surface) || bySeverity(a, b) || a.id.localeCompare(b.id);
    if (sort === "domain") return a.domain.localeCompare(b.domain) || bySeverity(a, b) || a.id.localeCompare(b.id);
    return bySeverity(a, b) || a.id.localeCompare(b.id);
  });
}

export interface PriorityGroup {
  priority: FindingPriority;
  rows: FindingRow[];
}

const PRIORITY_ORDER: readonly FindingPriority[] = ["P0", "P1", "P2", "P3"];

/**
 * Findings by priority, worst lane first.
 *
 * Empty groups are retained rather than dropped: a board that silently omits P0
 * when there is no P0 reads as a board that has not loaded. "None at this
 * priority" is information, and it is the good news.
 */
export function groupByPriority(rows: FindingRow[]): PriorityGroup[] {
  return PRIORITY_ORDER.map((priority) => ({
    priority,
    rows: rows.filter((row) => row.priority === priority),
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node tests/app/quality.test.js
```

Expected: all `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/quality.ts tests/app/quality.test.js
git commit -m "feat(quality): filter and group findings for the board"
```

---

## Task 3: Cell criteria, the node index, and surface gauges

**Files:**
- Modify: `lib/utils/quality.ts` (append)
- Modify: `tests/app/quality.test.js` (append)

- [ ] **Step 1: Append the failing tests**

These reuse `matrix`, `section`, `pack`, `rows` and `assert` from the blocks Tasks 1 and 2 appended to the same file. Append below them; do not redeclare them.

```js
// =========================== buildCellCriteria ===============================

const { buildCellCriteria, buildNodeFindingIndex, buildSurfaceGauges } = loadQuality();

const secWeb = buildCellCriteria(section, pack, "SEC", "web");
assert(
  secWeb.length === matrix.matrix.SEC.web.criteria,
  "the cell's criterion rows match the count deriveQualityMatrix reported",
);
assert(
  secWeb.every((row) => row.level >= 0 && row.level <= 4),
  "every criterion row carries a maturity level in range",
);
assert(secWeb.every((row) => typeof row.criterionId === "string"), "every row names its criterion");
assert(
  buildCellCriteria(section, pack, "SEC", "nonexistent-surface").length === 0,
  "a surface nothing was scored on yields no criterion rows",
);

// =========================== buildNodeFindingIndex ===========================

const nodeIndex = buildNodeFindingIndex(section, pack);
assert(nodeIndex.size > 0, "the node index is not empty for the pilot");

const profiles = nodeIndex.get("DM-profiles");
assert(profiles !== undefined, "a node named by a finding is in the index");
assert(profiles.total > 0, "an indexed node has at least one open finding");
assert(
  profiles.counts[profiles.worst] > 0,
  "worst names a severity the node actually has",
);
assert(
  ["critical", "high", "medium", "low", "info"].indexOf(profiles.worst) ===
    Math.min(
      ...["critical", "high", "medium", "low", "info"]
        .map((severity, index) => (profiles.counts[severity] > 0 ? index : 99)),
    ),
  "worst is the most severe severity present",
);

// Only open findings decorate a node — a resolved finding is history.
const resolvedOnly = buildNodeFindingIndex(
  {
    findings: [
      { id: "F-r", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 5, likelihood: 5, cost: "M", status: "resolved", node_ids: ["V-x"] },
    ],
  },
  pack,
);
assert(resolvedOnly.size === 0, "a resolved finding never decorates a node");

// =========================== buildSurfaceGauges ==============================

const gauges = buildSurfaceGauges(matrix, section, pack);
assert(gauges.length === 5, "one gauge per profile surface");
assert(
  gauges.map((gauge) => gauge.surface).join(",") === "web,ios,android,admin,supabase",
  "gauges keep the profile's surface order",
);
assert(
  gauges.every((gauge) => gauge.score === matrix.overall[gauge.surface]),
  "a gauge's score is the matrix's own roll-up, not a second computation",
);
assert(gauges[0].title === "Web app", "a gauge takes its title from the profile");
assert(
  gauges.every((gauge) => gauge.score === null || gauge.grade !== null),
  "a gauge with a score always has a grade",
);
```

- [ ] **Step 2: Run to verify it fails**

```bash
node tests/app/quality.test.js
```

Expected: FAIL — `buildCellCriteria is not a function`.

- [ ] **Step 3: Append the implementation**

Add these imports to the existing import block in `lib/utils/quality.ts`:

```ts
  gradeOf,
  type MaturityLevel,
  type QualityAssessment,
  type QualityGrade,
  type QualityMatrix,
  type SurfaceDef,
```

Then append:

```ts
/** One criterion inside an open matrix cell. */
export interface CriterionRow {
  criterionId: string;
  name: string;
  question?: string;
  level: MaturityLevel;
  evidence: string;
  auditId: string;
  ts: string;
  /** Open findings filed against this criterion on this surface. */
  openFindings: number;
}

/**
 * The criteria behind one matrix cell, with the level each was scored at.
 *
 * Scored criteria only. A criterion the audit skipped has no assessment and is
 * absent here for the same reason it is absent from the cell's score: a narrow
 * audit must read as narrow, not as bad.
 */
export function buildCellCriteria(
  section: Pick<QualitySection, "assessments" | "findings"> | undefined,
  library: KritikLibrary | undefined,
  domain: string,
  surface: string,
): CriterionRow[] {
  const criteria = criteriaById(library);
  const openPerCriterion = new Map<string, number>();
  for (const finding of asArray<QualityFinding>(section?.findings)) {
    if (!isOpenFinding(finding) || finding.surface !== surface) continue;
    openPerCriterion.set(finding.criterion_id, (openPerCriterion.get(finding.criterion_id) ?? 0) + 1);
  }

  return asArray<QualityAssessment>(section?.assessments)
    .filter((assessment) => {
      if (assessment.surface !== surface) return false;
      return criteria.get(assessment.criterion_id)?.domain === domain;
    })
    .map((assessment) => {
      const criterion = criteria.get(assessment.criterion_id);
      return {
        criterionId: assessment.criterion_id,
        name: (criterion?.name as string | undefined) ?? assessment.criterion_id,
        question: criterion?.question as string | undefined,
        level: assessment.level,
        evidence: assessment.evidence,
        auditId: assessment.audit_id,
        ts: assessment.ts,
        openFindings: openPerCriterion.get(assessment.criterion_id) ?? 0,
      };
    })
    .sort((a, b) => a.criterionId.localeCompare(b.criterionId));
}

export interface NodeFindingSummary {
  counts: Record<FindingSeverity, number>;
  /** The most severe severity present on this node. */
  worst: FindingSeverity;
  total: number;
}

const SEVERITY_WORST_FIRST: readonly FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

/**
 * `node id -> its open findings`, built once per page.
 *
 * A map rather than a per-node scan: the canvas asks this question once per
 * node, and a filter over 246 findings per node is 246 x n comparisons for a
 * badge most nodes do not draw. Resolved, refuted and accepted-risk findings
 * are excluded — a badge is a call to act, and those are not.
 */
export function buildNodeFindingIndex(
  section: Pick<QualitySection, "findings"> | undefined,
  library?: KritikLibrary,
): Map<string, NodeFindingSummary> {
  const index = new Map<string, NodeFindingSummary>();

  for (const finding of asArray<QualityFinding>(section?.findings)) {
    if (!isOpenFinding(finding)) continue;
    const severity = severityOf(finding, library);

    for (const nodeId of asArray<string>(finding.node_ids)) {
      let summary = index.get(nodeId);
      if (!summary) {
        summary = {
          counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          worst: "info",
          total: 0,
        };
        index.set(nodeId, summary);
      }
      summary.counts[severity]++;
      summary.total++;
    }
  }

  for (const summary of index.values()) {
    summary.worst = SEVERITY_WORST_FIRST.find((severity) => summary.counts[severity] > 0) ?? "info";
  }

  return index;
}

export interface SurfaceGauge {
  surface: string;
  title: string;
  /** The matrix's own roll-up; `null` when nothing was scored on this surface. */
  score: number | null;
  grade: QualityGrade | null;
  openFindings: number;
}

/**
 * One gauge per profile surface for the Overview.
 *
 * The score is read straight off `matrix.overall` rather than recomputed, so
 * the card and the page can never disagree. The grade is banded from that
 * score *without* re-applying caps: caps shape the cell a reader acts on, and
 * `deriveQualityMatrix` already declined to fold them into the roll-up.
 */
export function buildSurfaceGauges(
  matrix: QualityMatrix,
  section: Pick<QualitySection, "profile" | "findings"> | undefined,
  library?: KritikLibrary,
): SurfaceGauge[] {
  const titles = new Map<string, string>();
  for (const surface of asArray<SurfaceDef>(section?.profile?.surfaces)) {
    if (typeof surface?.id === "string") titles.set(surface.id, surface.title ?? surface.id);
  }

  const openPerSurface = new Map<string, number>();
  for (const finding of asArray<QualityFinding>(section?.findings)) {
    if (!isOpenFinding(finding)) continue;
    openPerSurface.set(finding.surface, (openPerSurface.get(finding.surface) ?? 0) + 1);
  }

  return matrix.surfaces.map((surface) => {
    const score = matrix.overall[surface] ?? null;
    return {
      surface,
      title: titles.get(surface) ?? surface,
      score,
      grade: score === null ? null : gradeOf(score, library),
      openFindings: openPerSurface.get(surface) ?? 0,
    };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node tests/app/quality.test.js
```

Expected: all `PASS`, exit 0.

- [ ] **Step 5: Wire the script and CI**

In `package.json` `scripts`, after `"test:acceptance-intake"`:

```json
"test:quality-page": "node tests/app/quality.test.js",
```

`test:quality` and `test:quality-ops` are already taken by the schema suites. Reusing either name would silently replace a suite CI runs.

In `.github/workflows/ci.yml`, after the `test:acceptance-intake` step, add a step in the same shape as its neighbours:

```yaml
      - name: Quality page projections
        run: npm run test:quality-page
```

- [ ] **Step 6: Verify and commit**

```bash
npm run test:quality-page
git add lib/utils/quality.ts tests/app/quality.test.js package.json .github/workflows/ci.yml
git commit -m "feat(quality): cell criteria, node finding index, surface gauges"
```

---

## Task 4: The criterion panel kind

**Files:**
- Modify: `lib/utils/project-panels.ts`
- Modify: `tests/app/project-panels.test.js`

Read `lib/utils/project-panels.ts` in full before editing. Its header comment states the stack's invariants and you are adding to them.

- [ ] **Step 1: Append failing tests to `tests/app/project-panels.test.js`**

Match the existing suite's assert helper and loader (read the file first — it has its own `load-*` module).

```js
// =========================== criterion entries ===============================

const criterionEntry = {
  key: criterionPanelKey("SEC-03", "web"),
  instanceId: "i-c",
  payload: { kind: "criterion", criterionId: "SEC-03", surface: "web" },
};
const nodeEntry = { key: "V-home", instanceId: "i-n", payload: { kind: "node", nodeId: "V-home" } };

assert(
  criterionPanelKey("SEC-03", "web") === "criterion:SEC-03@web",
  "a criterion key is namespaced so it can never collide with a node id",
);
assert(
  criterionPanelKey("SEC-03") === "criterion:SEC-03@",
  "a criterion key without a surface is still namespaced",
);
assert(isCriterionEntry(criterionEntry) === true, "a criterion entry is recognised");
assert(isCriterionEntry(nodeEntry) === false, "a node entry is not a criterion entry");
assert(isNodeEntry(criterionEntry) === false, "a criterion entry is not a node entry");

assert(
  topNodeKey([nodeEntry, criterionEntry]) === "V-home",
  "a criterion panel above a node does not displace what ?node= names",
);
assert(
  topNodeKey([criterionEntry]) === null,
  "a stack of only criterion panels addresses no node",
);

const pruned = pruneNodeEntries([nodeEntry, criterionEntry], new Set());
assert(
  pruned.length === 1 && isCriterionEntry(pruned[0]),
  "a node prune never evicts a criterion panel",
);

const crumbs = buildPanelCrumbs([criterionEntry], "Quality", () => undefined);
assert(
  crumbs[crumbs.length - 1].label === "SEC-03",
  "a criterion crumb reads as its criterion id, not its namespaced key",
);
```

Add `criterionPanelKey`, `isCriterionEntry` to that file's destructured import from the panels loader.

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:project-panels
```

Expected: FAIL — `criterionPanelKey is not defined`.

- [ ] **Step 3: Edit `lib/utils/project-panels.ts`**

Extend the header comment's second paragraph to name the new kind, then:

```ts
/**
 * A criterion panel's key.
 *
 * Namespaced rather than bare, unlike `RAW_PANEL_KEY`, which can afford to be a
 * bare word only because node ids always carry a species prefix. Criterion ids
 * carry a *domain* prefix — `SEC-01`, `A11Y-03`, and a project's own `X-01` —
 * and nothing stops a future pack from choosing a domain code that collides
 * with a species. The namespace removes the question instead of relying on the
 * answer staying true.
 *
 * The surface rides in the key so the same criterion opens as two panels on two
 * surfaces, while re-opening it on the same surface refreshes in place.
 */
export function criterionPanelKey(criterionId: string, surface?: string): string {
  return `criterion:${criterionId}@${surface ?? ""}`;
}

/**
 * A criterion detail panel. Like Raw and unlike a node, it has no address in
 * the stack: a criterion is library content, identical in every project that
 * pins the same pack, so it is not a location in *this* graph. The Quality page
 * owns `?criterion=` and syncs it to this panel — see the phase D design.
 */
export interface CriterionPanelDescriptor {
  kind: "criterion";
  criterionId: string;
  /** The surface whose assessment and findings the panel shows, when opened from a cell. */
  surface?: string;
}

export type PanelDescriptor =
  | NodePanelDescriptor
  | CriterionPanelDescriptor
  | { kind: "raw" };

export function isCriterionEntry(
  entry: ProjectPanelEntry,
): entry is PanelEntry<CriterionPanelDescriptor> {
  return entry.payload.kind === "criterion";
}
```

In `buildPanelCrumbs`, replace the label expression so a criterion reads as its id:

```ts
      label:
        entry.key === RAW_PANEL_KEY
          ? "Raw bundle"
          : entry.payload.kind === "criterion"
            ? entry.payload.criterionId
            : titleOf(entry.key) ?? entry.key,
```

`topNodeKey` and `pruneNodeEntries` need **no change** — both already branch on `isNodeEntry`, so the new kind is correctly handled by construction.

- [ ] **Step 4: Run to verify it passes**

```bash
npm run test:project-panels && npm run test:panel-stack
```

Expected: all `PASS` in both.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/project-panels.ts tests/app/project-panels.test.js
git commit -m "feat(panels): a criterion panel kind, addressless like Raw"
```

---

## Task 5: `openCriterion` and the criterion detail panel

**Files:**
- Modify: `lib/hooks/useProjectPanels.tsx`
- Modify: `components/panels/ProjectPanels.tsx`
- Create: `components/panels/CriterionDetailPanel.tsx`

- [ ] **Step 1: Add `openCriterion` to `lib/hooks/useProjectPanels.tsx`**

Import `criterionPanelKey` and `isCriterionEntry` from `@/lib/utils/project-panels`. Add to `ProjectPanelsValue`:

```ts
  /**
   * Open a criterion's detail from a depth, or refresh the one already in that
   * slot. Publishes nothing: a criterion panel is not an address, so the stack
   * has nothing to tell the URL. The Quality page writes `?criterion=` itself.
   */
  openCriterion: (criterionId: string, surface?: string, fromDepth?: number) => void;
```

Implement it beside `openRaw`:

```ts
  const openCriterion = useCallback(
    (criterionId: string, surface?: string, fromDepth?: number) => {
      setEntries((previous) =>
        openFrom<PanelDescriptor>(
          previous,
          fromDepth ?? previous.length,
          criterionPanelKey(criterionId, surface),
          { kind: "criterion", criterionId, surface },
        ),
      );
    },
    [],
  );
```

Add `openCriterion` to the `useMemo` value object and to its dependency array.

**Do not** touch `publishTop`, `commitEntries`, `topNodeKey` or `reconcileArrival`. The whole point of the addressless design is that they stay as they are.

- [ ] **Step 2: Build the panel**

Create `components/panels/CriterionDetailPanel.tsx`, exporting `CriterionDetailPanel` and `CriterionDetailPanelHeader`. Mirror `components/panels/NodeDetailPanel.tsx`'s structure and section chrome — read it first.

Props:

```ts
interface CriterionDetailPanelProps {
  criterionId: string;
  surface?: string;
  library?: KritikLibrary;
  section?: QualitySection;
  onOpenNode: (nodeId: string) => void;
}
```

Sections, **each rendered only when its data exists** (this is the degradation contract — `resolveKritikLibrary` synthesizes a library with none of this when no pack is embedded):

- Header: criterion id, name, domain, and the surface when one is given.
- Question, then Definition.
- Maturity anchors `l0`–`l4` from `level_anchors`, the scored level marked when an assessment exists for this `(criterion, surface)`.
- Evidence from that assessment, plus its `audit_id` and `ts`.
- Checklist, References (links), Signals, Remediation.
- Findings on this criterion (and surface, when given), each opening its linked nodes through `onOpenNode`.

When the library is synthesized — detect it as "the criterion resolves to no `question` and no `level_anchors`" — render a single line saying the criteria pack is not embedded in this bundle, and show only the assessment and findings. **Do not render empty headings.**

- [ ] **Step 3: Wire it in `components/panels/ProjectPanels.tsx`**

Add optional props so pages that have quality data can pass it:

```ts
  /** Kritik state, for criterion panels. Absent on every page but Quality. */
  qualitySection?: QualitySection;
  qualityLibrary?: KritikLibrary;
```

In `labelOf`, return `entry.payload.criterionId` for a criterion entry. In `renderHeader`, return `<CriterionDetailPanelHeader …/>`. In `renderBody`, branch to `<CriterionDetailPanel …/>`, passing `onOpenNode={(nodeId) => openNode({ nodeId })}`.

Add matching pass-through props to `components/layout/PageShell.tsx` (they land in its `...panelProps` spread, so only the interface needs the two new optional fields).

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: no type errors; 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/useProjectPanels.tsx components/panels/ProjectPanels.tsx components/panels/CriterionDetailPanel.tsx components/layout/PageShell.tsx
git commit -m "feat(panels): criterion detail panel"
```

---

## Task 6: The filter bar

**Files:**
- Create: `components/quality/quality-filters.ts`
- Create: `components/quality/QualityFilterBar.tsx`

- [ ] **Step 1: Write `quality-filters.ts`**

Mirror `components/acceptances/acceptance-filters.ts` exactly — read it first. It re-exports the filter type and empty value from the utils module, reads from `useSearchParams`, and writes through `useQueryWriter`.

```ts
const KEYS = ["search", "severity", "surface", "priority", "domain", "status", "cell", "sort"] as const;
```

**`criterion` and `csurface` are deliberately absent from `KEYS`**, exactly as `product` is absent from the acceptance bar's. They are owned by the Quality page's criterion panel, and "Clear filters" — which deletes every key in `KEYS` — must not close a panel the reader opened. Copy that reasoning into the file's comment; it is the same decision and a future reader should find it stated in both places.

Export `useQualityFilters(): { filters, setFilters, reset }`.

- [ ] **Step 2: Write `QualityFilterBar.tsx`**

Mirror `components/acceptances/AcceptanceFilterBar.tsx` — the compact square icon-button menus from #374. Controls: search input; severity, priority, surface, domain, status menus; sort menu; and a "clear filters" affordance that appears only when something is set.

Surface and domain options come from props (`surfaces: SurfaceDef[]`, `domains: KritikDomain[]`) — the profile and the pack decide them, not a constant.

Show the active cell as a dismissible chip reading `SEC × Web app`, whose dismiss clears `cell` only.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
git add components/quality/
git commit -m "feat(quality): the findings filter bar"
```

---

## Task 7: The matrix

**Files:**
- Create: `components/quality/QualityMatrix.tsx`

- [ ] **Step 1: Build it**

```ts
interface QualityMatrixProps {
  matrix: QualityMatrix;
  section?: QualitySection;
  library?: KritikLibrary;
  activeCell: string | null;
  onSelectCell: (key: string | null) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}
```

Rows are `matrix.domains`, columns `matrix.surfaces` (titled from `section.profile.surfaces`). Each cell:

- `score` large, `grade` beneath, a `*` when `cell.capped`.
- Dots counting `cell.findings` by severity, capped at four per severity as the pilot does.
- Background tinted by grade band.
- A `null` cell renders `N/A`, is not a button, and has no hover.

A final `OVERALL` row renders `matrix.overall`, banded with `gradeOf`.

Clicking a cell calls `onSelectCell(cellKey(domain, surface))`; clicking the active cell again calls `onSelectCell(null)`. The active cell draws an inset ring.

When a cell is active, render the criteria strip below the table: `buildCellCriteria(section, library, domain, surface)`, each row showing the criterion id, a 0–4 level indicator, the name, and its open-finding count. A row click calls `onOpenCriterion`.

A legend below states the grade bands and that `*` means a grade capped by an open finding — a letter worse than its number is otherwise unexplainable.

**The table must scroll inside its own `overflow-x-auto` container.** Eleven domains by five surfaces overflows a narrow viewport, and the page must never scroll horizontally as a whole.

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
git add components/quality/QualityMatrix.tsx
git commit -m "feat(quality): the comparative matrix"
```

---

## Task 8: The findings board

**Files:**
- Create: `components/quality/FindingCard.tsx`
- Create: `components/quality/FindingsBoard.tsx`

- [ ] **Step 1: `FindingCard.tsx`**

```ts
interface FindingCardProps {
  row: FindingRow;
  nodesById: Map<string, Node>;
  onOpenNode: (nodeId: string) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}
```

Collapsed: severity chip, `impact × likelihood = risk`, title, criterion id + name, surface, cost, priority, and the verification verdict when present. Expanded (local `useState`): detail, evidence in a monospace block, linked nodes as buttons calling `onOpenNode`, and the issue link when `issueUrl` is set.

A row with `status: "accepted-risk"` renders its note in the decision-log style — read `components/decisions/` for that treatment. An accepted risk is a decision and should read as one.

Severity colors must derive from `row.severity`, never from `row.risk` — the buckets are the pack's to move.

- [ ] **Step 2: `FindingsBoard.tsx`**

```ts
interface FindingsBoardProps {
  groups: PriorityGroup[];
  nodesById: Map<string, Node>;
  onOpenNode: (nodeId: string) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}
```

One section per group, `P0` first, stacked vertically with sticky headings pinned using the `--surface-sticky-top` variable `PageSurface` publishes (see its comment). Follow `components/acceptances/AcceptanceMatrix.tsx`'s anchor-group treatment.

An empty group renders its heading and a one-line "None at this priority" — the good news, stated.

All four groups empty (everything filtered out) renders a single `EmptyState` reading "No findings match these filters" instead of four headings.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
git add components/quality/FindingCard.tsx components/quality/FindingsBoard.tsx
git commit -m "feat(quality): the findings board"
```

---

## Task 9: The route

**Files:**
- Create: `app/project/[id]/quality/page.tsx`

- [ ] **Step 1: Build the page**

Model it on `app/project/[id]/acceptances/page.tsx`. Hooks: `useProjectId`, `useProject`, `useNodes`, `useEdges`, `useProjectPanels`, `useQualityFilters`, `useEffectiveProduct`.

Memoize:

```ts
const section = projectBundle?.quality;
const library = useMemo(() => resolveKritikLibrary(section), [section]);
const matrix = useMemo(() => deriveQualityMatrix({ quality: section }, library), [section, library]);
const rows = useMemo(() => buildFindingRows(section, library), [section, library]);
const filtered = useMemo(() => filterFindings(rows, filters), [rows, filters]);
const groups = useMemo(() => groupByPriority(filtered), [filtered]);
```

**Order of screens, and this order exactly:**

1. `nodesLoading || edgesLoading` → `PageLoading label="quality"`.
2. Any of `nodesError / edgesError / projectError` → `PageError` with a retry that reloads all three. **Before** the empty state — a project that failed to read must not render as a project with no audit (#362, audit `quality-frontend-2`).
3. No `section` → `EmptyState`: this project has no quality audit yet, with the three steps (install `kritik@arkaik`, run an audit, import the bundle).
4. Otherwise the matrix and board.

`PageShell` gets `title="Quality"`, `meta` reading `${matrix.surfaces.length} surfaces · ${rows.length} findings · ${filtered.length} shown`, and **`allNodes={dataNodes}` `allEdges={dataEdges}`** — the page renders no nodes itself, but `ProjectPanels` resolves node entries against that data, and without it following a finding into its linked node opens a panel that cannot find its node. Also pass `qualitySection={section}` and `qualityLibrary={library}`.

`PageSurface` gets `fill`, `contentClassName="overflow-y-auto"`, and the filter bar in `toolbar`.

- [ ] **Step 2: Sync `?criterion=`**

The page owns two params outside the filter hook's `KEYS`:

- On mount and whenever `?criterion=` changes to something not already open, call `openCriterion(criterion, csurface)`.
- When a cell or a finding opens a criterion, write both params through `useQueryWriter`.
- When the criterion panel closes, delete both.

Read `lib/hooks/useQueryWriter.ts` before writing this — it reads the live query at call time, which is what keeps two writers on the same URL from clobbering each other.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
git add "app/project/[id]/quality/page.tsx"
git commit -m "feat(quality): the Quality route"
```

---

## Task 10: Navigation

**Files:**
- Modify: `components/layout/ProjectSwitcher.tsx`
- Modify: `components/layout/ProjectSidebar.tsx`
- Modify: `lib/utils/command-palette.ts`
- Modify: `tests/app/command-palette.test.js`

- [ ] **Step 1: Register the view**

In `ProjectSwitcher.tsx`, add `"quality"` to the `ProjectView` union and to `PROJECT_VIEW_SEGMENTS`. Place it after `"changelog"` in both.

- [ ] **Step 2: Sidebar entry**

In `ProjectSidebar.tsx`, add a `qualityHref` and a `SidebarMenuItem` in the **Project** group, immediately after Changelog. Use `GemIcon` from lucide-react — `lib/config/values.ts` already maps the `quality` value to the `Gem` icon, so the app already says quality looks like a gem.

- [ ] **Step 3: Command palette**

Add `| "quality"` to the command-id union at `lib/utils/command-palette.ts:20-40` (the one listing `"acceptances"`, `"delivery"`, `"changelog"`), placing it after `"changelog"`. Then add a command entry beside the `changelog` one (around line 419), `target: { kind: "href", href: `${base}/quality` }`, with keywords `["audit", "findings", "matrix", "kritik", "severity"]`.

`tests/app/command-palette.test.js` asserts the command list — update its expected set. Run `npm run test:command-palette` and fix what it reports rather than guessing at the assertion's shape.

- [ ] **Step 4: Verify and commit**

```bash
npm run test:command-palette && npx tsc --noEmit -p tsconfig.json && npm run lint
git add components/layout/ProjectSwitcher.tsx components/layout/ProjectSidebar.tsx lib/utils/command-palette.ts tests/app/command-palette.test.js
git commit -m "feat(quality): Quality in the sidebar and the palette"
```

---

## Task 11: Node decoration

**Files:**
- Create: `components/graph/nodes/FindingBadge.tsx`
- Modify: `components/graph/nodes/ViewNode.tsx`, `FlowNode.tsx`, `SystemLayerNode.tsx`
- Modify: `components/panels/NodeDetailPanel.tsx`

- [ ] **Step 1: `FindingBadge.tsx`**

```ts
interface FindingBadgeProps {
  summary: NodeFindingSummary | undefined;
  className?: string;
}
```

Returns `null` when `summary` is undefined or `summary.total === 0` — a node with no findings draws nothing, and that is most nodes. Otherwise a small badge colored by `summary.worst` with `summary.total` as its label and an accessible name reading e.g. `"3 open findings, worst: critical"`.

Colors come from the same severity token set the board uses. Extract them into a shared `SEVERITY_STYLES` map in `components/quality/severity-styles.ts` if Task 8 defined them inline, and have both import it — one definition of what critical looks like.

- [ ] **Step 2: Thread the summary to the canvas**

**Read this before writing any of it.** Node components do not take props — they are React Flow nodes and read everything from `data` (`ViewNodeComponent({ data }: NodeProps)`, which derives its blocked state with `blockedByOf(data.metadata)`). Findings are *not* node metadata: they live in `bundle.quality.findings`. So the summary has to be stamped into `data` by the graph builder.

Three edits, in this order:

1. `lib/utils/journey-graph.ts` — add to `JourneyGraphParams`:

```ts
  /**
   * Open findings per node id (`buildNodeFindingIndex`). Optional: every map
   * but a Kritik-audited one passes nothing, and a node with no entry draws no
   * badge — which is the common case even on an audited project.
   */
  nodeFindings?: ReadonlyMap<string, NodeFindingSummary>;
```

   Then, at the node-data assembly site, stamp `findingSummary: nodeFindings?.get(node.id)` into the `data` object alongside `status` and `platforms`. Synthetic branch nodes have no underlying node id and get nothing.

2. `components/maps/JourneyMap.tsx:674` — pass `nodeFindings` into the `buildJourneyGraph({ … })` call. Build the index from `useProject`'s bundle, memoized on `project?.quality` alone so a graph rebuild is not triggered by unrelated bundle churn.

3. The three node components — render `<FindingBadge summary={data.findingSummary as NodeFindingSummary | undefined} />` beside the existing status badges.

**If the assembly site turns out to be shared with a path that has no node id**, stop and report it rather than restructuring the builder. The fallback — badge in `NodeDetailPanel` and the library list only, canvas deferred — is a scope call for Alexis, not one to make silently.

- [ ] **Step 3: `NodeDetailPanel` findings section**

A section listing that node's open findings, each row opening its criterion panel. Rendered only when the node has findings, following the panel's existing conditional-section pattern.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
git add components/graph/nodes/ components/panels/NodeDetailPanel.tsx components/quality/
git commit -m "feat(quality): severity badges on nodes with open findings"
```

---

## Task 12: The Overview card

**Files:**
- Create: `components/overview/QualityCard.tsx`
- Modify: `app/project/[id]/overview/page.tsx`

- [ ] **Step 1: Build the card**

Model it on `components/overview/PlatformGaugesCard.tsx`, which already reads `OverviewLayoutContext` to pick a body for the rows and grid displays. One gauge per `SurfaceGauge`: the surface title, its score, its grade, and its open-finding count.

- [ ] **Step 2: Register it**

Add it to the overview page's section list beside `PlatformGaugesCard`, in **both** layouts.

**Absent when the project has no `quality` section** — a silenced section is absent, not a row spent explaining its own absence. `ParityCard`'s single-platform branch is the precedent; follow it.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint && npm run test:coverage
git add components/overview/QualityCard.tsx "app/project/[id]/overview/page.tsx"
git commit -m "feat(quality): a quality gauge on the Overview"
```

---

## Task 13: Full verification

- [ ] **Step 1: Regenerate**

```bash
npm run generate
git status --short
```

Nothing in this phase changes the schema, so `npm run generate` should produce **no diff**. If it does, commit it — CI diffs generated artifacts and fails the build otherwise.

- [ ] **Step 2: Build and lint**

```bash
npm run lint && npm run build
```

Expected: 0 lint errors; the build succeeds. `main` lints clean, so any error is from this branch.

- [ ] **Step 3: Run every suite this branch touches**

```bash
npm run test:quality-page && \
npm run test:quality && \
npm run test:quality-ops && \
npm run test:project-panels && \
npm run test:panel-stack && \
npm run test:command-palette && \
npm run test:coverage && \
npm run validate:seeds
```

Expected: all pass. `test:quality` and `test:quality-ops` are the phase A/C suites — they must still pass untouched, which is the check that nothing here reimplemented a scale.

- [ ] **Step 4: Confirm the address contract held**

```bash
git diff main -- lib/hooks/useProjectPanels.tsx | grep -E "publishTop|topNodeKey|reconcileArrival|NODE_PANEL_PARAM"
```

Expected: **no output**. Any hit means the criterion panel reached into the `?node=` machinery, which the design forbids.

- [ ] **Step 5: Document the snapshot gap**

`SnapshotShape` in `lib/services/graph/store.ts:111` declares `project`, `nodes` and `edges` but not `quality`. Storage works anyway — `createProject` does `const { journal = [], ...snapshot } = bundle`, so the section rides along, and `readProjectBundle` spreads it back out. Add a line to that interface's neighbourhood saying so, so the next reader does not "fix" the type by narrowing the write:

```ts
interface SnapshotShape {
  schema_version?: number;
  project: Project;
  nodes: Node[];
  edges: Edge[];
  // Not exhaustive. `createProject` stores `{ journal, ...snapshot }`, so every
  // other bundle section — `quality` since #383 — rides along untyped and
  // survives the round trip. Listing only what this module reads is deliberate:
  // narrowing the *write* to these keys would silently drop the rest.
}
```

- [ ] **Step 6: Commit anything outstanding**

```bash
git add -A && git status --short
```

---

## Visual verification checklist (for Alexis — cannot be automated here)

No browser driver is available in this environment. After the branch is up:

1. `/project/<id>/quality` on a project **with** a quality section — matrix renders, grades colored, caps show `*`.
2. Same route on a project **without** one — empty state, not a grid of `N/A`.
3. Click a cell — it rings, the criteria strip appears, the board narrows, and the URL gains `?cell=`.
4. Click a criterion — the detail panel opens and the URL gains `?criterion=`.
5. Reload that URL — the panel comes back.
6. Open a node panel, then a criterion panel — `?node=` still names the node.
7. "Clear filters" — the criterion panel stays open.
8. A finding with linked nodes — clicking one opens the node panel and it resolves its node.
9. Canvas — a node with open findings shows the badge; one without shows nothing.
10. Overview — the quality card appears, and is absent on a project with no audit.
11. Narrow the window — the matrix scrolls inside itself; the page does not scroll sideways.
12. Dark mode on every screen above.
