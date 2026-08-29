# Kritik lane-2 bundle writer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project this repo's `docs/quality/` audit sidecars into a bundle's `quality` section at interchange-assembly time, so the Quality page and the resolution webhook finally have a producer.

**Architecture:** One projection function in `@arkaik/schema` (`loadCurrentQualitySection`) merges every audit into current state — assessments latest-wins per `(criterion × surface)`, findings pooled, `severity`/`priority` stripped, the effective library embedded. One CLI wrapper (`foldQualitySection`) calls it. Two verbs use the wrapper: `arkaik pack` (default on) and `arkaik restore` (default on). `arkaik push` strips it by default. **`docs/arkaik/bundle.json` is never written** — this is the journal's sidecar/interchange doctrine applied unchanged.

**Tech Stack:** TypeScript, Node ≥20 (CI pins 20, local is 26), esbuild-built CLI, hand-rolled `check()` test suites spawning the built binary. No test framework, no Postgres.

**Spec:** [`docs/superpowers/specs/2026-08-29-kritik-lane2-bundle-writer-design.md`](../specs/2026-08-29-kritik-lane2-bundle-writer-design.md)
**Issue:** [#389](https://github.com/alexisbohns/arkaik/issues/389)

---

## Read this before Task 1

**Everything under `packages/schema/src/cli/` is tested through the built CLI, never in-process.** `tests/schema/load-schema.js` transpiles only the files directly in `packages/schema/src/` and returns `index.ts`'s exports; `src/cli/*` is not in that set and is not re-exported from `index.ts`. So there is no way to unit-test `loadCurrentQualitySection` in isolation without adding a loader, and the established pattern (`tests/cli/kritik.test.js`) is to drive `packages/cli/dist/index.js` in a `mkdtemp` repo instead. That is why Task 1 is a vertical slice — schema function plus CLI wrapper plus `pack` wiring — rather than three tasks. It is the smallest change that has a runnable test.

**The test builds its fixture repo in-process** from constants in the test file, rather than committing a `tests/cli/fixtures/quality-two-audits/` tree as the spec's Files section listed. Same coverage, one file instead of nine, and it matches how `tests/cli/kritik.test.js` already works. This is a deliberate refinement of the spec.

**The vendored pack in the fixture uses deliberately non-default scales and weights.** Phase D found that the golden fixture could not tell "reads the pack" from "hardcodes the schema defaults", because the shipped pack's scales are byte-identical to `DEFAULT_SEVERITY_BUCKETS`/`DEFAULT_GRADE_BANDS`. Every fixture here avoids that: grades `A:97 B:88 C:71 D:52` (defaults are `85/70/55/40`) and `critical: [21,25]` (default `[20,25]`). Do not "simplify" these numbers to the defaults — that silently removes the only thing proving the embedded library came from the project's pack.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/schema/src/cli/kritik-audit.ts` | **Modify.** Add `stripDerived` and `loadCurrentQualitySection` beside `loadQualitySection`. No new module: this file already owns "what is in the audit files and how does a run become a projection". |
| `packages/cli/src/lib/kritik-io.ts` | **Modify.** Add `foldQualitySection` — the CLI's environment seam, which already owns "where is the pack" and "does this repo journal". |
| `packages/cli/src/commands/pack.ts` | **Modify.** `--no-quality`, `--audit`, `--root`; fold in `runPack`; notice in `runPackCli`. |
| `packages/cli/src/commands/push.ts` | **Modify.** `--include-quality`; `noQuality: true` by default; `?include_quality=true`. |
| `packages/cli/src/commands/restore.ts` | **Modify.** `--no-quality`, `--audit`, `--root`, `--allow-quality-loss`; fold into the outbound bundle; the loss guard. |
| `packages/cli/src/index.ts` | **Modify.** Two usage lines. |
| `tests/cli/quality-section-fold.test.js` | **Create.** The whole suite: merge semantics, strip, flags, notices, validator parity, library provenance. |
| `tests/cli/push.test.js` | **Modify.** Two cases for `--include-quality`. |
| `tests/cli/bootstrap-restore.test.js` | **Modify.** Two cases for the fold and two for the loss guard. |
| `package.json` | **Modify.** Append to `test:cli`; add `test:quality-section-fold`. |
| `docs/spec/bundle-format.md`, `docs/spec/toolchain.md`, `docs/kritik-skill/skill.md`, `docs/rfcs/kritik.md` | **Modify.** Document the projection and the deliberate matrix divergence. |

---

## Task 1: The merge projection, folded by `arkaik pack`

**Files:**
- Modify: `packages/schema/src/cli/kritik-audit.ts` (append after `loadQualitySection`, currently ending line 170)
- Modify: `packages/cli/src/lib/kritik-io.ts` (append at end of file)
- Modify: `packages/cli/src/commands/pack.ts`
- Test: `tests/cli/quality-section-fold.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/quality-section-fold.test.js`:

```javascript
#!/usr/bin/env node

/**
 * Exercises the lane-2 bundle writer (issue #389): `docs/quality/` sidecars
 * folded into a bundle's `quality` section at assembly time.
 *
 * Drives the BUILT CLI in mkdtemp repos, never the repo itself — the same
 * reasoning as tests/cli/kritik.test.js, and the only option available:
 * packages/schema/src/cli/* is not reachable from tests/schema/load-schema.js
 * (which transpiles only src/*.ts and returns index.ts's exports).
 *
 * THE POINT OF THE TWO-AUDIT FIXTURE. With a single audit, a "merge"
 * implemented as plain concatenation and one implemented as "newest audit
 * only" both pass every assertion. So 2026-09 re-scores a cell 2026-08
 * already scored (newer must win, and the row must not be duplicated), adds
 * a cell 2026-08 never had, and leaves 2026-08's finding untouched (it must
 * still be present). Each of the three plausible wrong implementations fails
 * at least one assertion below.
 *
 * THE POINT OF THE VENDORED PACK. Its grade bands and severity buckets are
 * deliberately NOT the schema defaults (A:97 not 85; critical [21,25] not
 * [20,25]) and its weights are 3/1/2, so an assertion on the embedded
 * library can tell "embedded the project's effective pack" from "embedded
 * whatever the CLI shipped with". Phase D lost this distinction for two
 * phases; do not normalize these numbers.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
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

// --- the fixture repo ------------------------------------------------------

const BUNDLE = {
  schema_version: 3,
  project: {
    id: "demo",
    title: "Demo",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  nodes: [
    { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] },
  ],
  edges: [],
};

/** Non-default scales and weights on purpose — see the header. */
const PACK = {
  name: "test-pack",
  version: "9.9.9",
  domains: [
    { code: "SEC", name: "Security" },
    { code: "TST", name: "Testing" },
  ],
  criteria: [
    { id: "SEC-01", domain: "SEC", name: "Secrets", weight: 3, question: "Are secrets kept out of the repo?" },
    { id: "SEC-02", domain: "SEC", name: "Authorization", weight: 1 },
    { id: "TST-01", domain: "TST", name: "Unit tests", weight: 2 },
  ],
  scales: {
    grades: { A: 97, B: 88, C: 71, D: 52, E: 0 },
    severity_buckets: { critical: [21, 25], high: [13, 20], medium: [7, 12], low: [3, 6], info: [1, 2] },
    caps: { critical_open: "D", high_open: "C" },
  },
};

const OVERLAY = {
  extends: "9.9.9",
  criteria: [{ id: "SEC-99", domain: "SEC", name: "Project-specific control", weight: 2 }],
};

const PROFILE = {
  surfaces: [
    { id: "web", title: "Web app", platform: "web" },
    { id: "admin", title: "Admin console" },
  ],
  domain_weights: { SEC: 2, TST: 1 },
};

const SCORES_08 = {
  audit_id: "2026-08",
  commit: "aaaaaaa",
  framework_version: "9.9.9",
  assessments: [
    { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "app/a.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
    { criterion_id: "SEC-02", surface: "web", level: 4, evidence: "app/b.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
    { criterion_id: "TST-01", surface: "web", level: 1, evidence: "app/c.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
    { criterion_id: "SEC-01", surface: "admin", level: 3, evidence: "app/d.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
  ],
};

// severity/priority are STORED here on purpose: the real sidecars carry them
// and the fold must drop them.
const FINDINGS_08 = {
  audit_id: "2026-08",
  framework_version: "9.9.9",
  findings: [
    {
      id: "F-2026-08-SEC-web-01",
      criterion_id: "SEC-01",
      surface: "web",
      title: "Token in the repo",
      detail: "A live token is committed.",
      evidence: "app/a.ts:1",
      impact: 5,
      likelihood: 4,
      cost: "M",
      status: "open",
      severity: "critical",
      priority: "P0",
      source_cell: "SEC-01/web",
    },
  ],
};

const SCORES_09 = {
  audit_id: "2026-09",
  commit: "bbbbbbb",
  framework_version: "9.9.9",
  assessments: [
    // Re-scores a 2026-08 cell: 2 -> 4. Newer must win, and the row must not double.
    { criterion_id: "SEC-01", surface: "web", level: 4, evidence: "app/a.ts:9", audit_id: "2026-09", ts: "2026-09-01T00:00:00.000Z" },
    // A cell 2026-08 never scored.
    { criterion_id: "TST-01", surface: "admin", level: 2, evidence: "app/e.ts:1", audit_id: "2026-09", ts: "2026-09-01T00:00:00.000Z" },
  ],
};

const FINDINGS_09 = {
  audit_id: "2026-09",
  framework_version: "9.9.9",
  findings: [
    {
      id: "F-2026-09-TST-admin-01",
      criterion_id: "TST-01",
      surface: "admin",
      title: "No tests on the admin console",
      detail: "Nothing covers it.",
      evidence: "app/e.ts:1",
      impact: 2,
      likelihood: 2,
      cost: "S",
      status: "open",
      severity: "low",
      priority: "P3",
    },
  ],
};

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/**
 * A repo with a bundle and, unless told otherwise, a vendored pack, an
 * overlay, a profile and two audits.
 */
function makeRepo(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-qfold-"));
  writeJson(path.join(dir, "docs", "arkaik", "bundle.json"), BUNDLE);
  if (options.profile !== false) writeJson(path.join(dir, "docs", "quality", "profile.json"), PROFILE);
  if (options.audits !== false) {
    writeJson(path.join(dir, "docs", "quality", "library.json"), PACK);
    writeJson(path.join(dir, "docs", "quality", "criteria.custom.json"), OVERLAY);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-08", "scores.json"), SCORES_08);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-08", "findings.json"), FINDINGS_08);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-09", "scores.json"), SCORES_09);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-09", "findings.json"), FINDINGS_09);
  }
  return dir;
}

const runIn = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: dir });

/** `arkaik pack` writes the bundle to stdout and its notices to stderr. */
function packIn(dir, args = []) {
  const result = runIn(dir, ["pack", ...args]);
  let bundle;
  try {
    bundle = JSON.parse(result.stdout);
  } catch {
    bundle = undefined;
  }
  return { result, bundle };
}

// --- 1. the merge ----------------------------------------------------------

{
  const dir = makeRepo();
  const { result, bundle } = packIn(dir);

  check("pack exits 0 on a repo with audits", result.status === 0, `${result.stdout.slice(0, 200)}\n${result.stderr}`);
  check("pack emits a quality section", bundle !== undefined && bundle.quality !== undefined, result.stderr);

  const section = (bundle && bundle.quality) || {};
  const assessments = section.assessments || [];
  const findings = section.findings || [];

  // 5 distinct cells across the two audits. Concatenation gives 6; newest-only gives 2.
  check("merge keeps one row per (criterion x surface)", assessments.length === 5, `got ${assessments.length}`);

  const cell = (criterionId, surface) =>
    assessments.filter((a) => a.criterion_id === criterionId && a.surface === surface);

  check("the re-scored cell appears exactly once", cell("SEC-01", "web").length === 1, JSON.stringify(cell("SEC-01", "web")));
  check(
    "the newer audit wins on the overlap (level 4, not 2)",
    cell("SEC-01", "web")[0] && cell("SEC-01", "web")[0].level === 4,
    JSON.stringify(cell("SEC-01", "web")),
  );
  check(
    "the newer audit's row carries its own audit_id",
    cell("SEC-01", "web")[0] && cell("SEC-01", "web")[0].audit_id === "2026-09",
    JSON.stringify(cell("SEC-01", "web")),
  );
  check(
    "a cell only the older audit scored survives",
    cell("SEC-02", "web")[0] && cell("SEC-02", "web")[0].level === 4,
    JSON.stringify(cell("SEC-02", "web")),
  );
  check(
    "a cell only the newer audit scored is present",
    cell("TST-01", "admin")[0] && cell("TST-01", "admin")[0].level === 2,
    JSON.stringify(cell("TST-01", "admin")),
  );

  // Findings pool across audits — newest-only would drop the 2026-08 one.
  check("findings pool across every audit", findings.length === 2, `got ${findings.length}`);
  check(
    "a finding from the older audit is still present",
    findings.some((f) => f.id === "F-2026-08-SEC-web-01"),
    JSON.stringify(findings.map((f) => f.id)),
  );

  // --- 2. derived fields stripped, everything else kept ---
  check(
    "no folded finding stores a derived severity",
    findings.every((f) => !("severity" in f)),
    JSON.stringify(findings.map((f) => Object.keys(f))),
  );
  check(
    "no folded finding stores a derived priority",
    findings.every((f) => !("priority" in f)),
    JSON.stringify(findings.map((f) => Object.keys(f))),
  );
  const stripped = findings.find((f) => f.id === "F-2026-08-SEC-web-01");
  check("the numbers severity is derived FROM survive", stripped && stripped.impact === 5 && stripped.likelihood === 4);
  check("an unknown finding key survives the strip", stripped && stripped.source_cell === "SEC-01/web");

  // --- 3. the rest of the section ---
  check("framework_version comes from the newest audit", section.framework_version === "9.9.9", section.framework_version);
  check(
    "the profile is carried verbatim",
    section.profile && Array.isArray(section.profile.surfaces) && section.profile.surfaces.length === 2,
    JSON.stringify(section.profile),
  );
  check("the notice names what was folded", /Quality: folded 5 assessment\(s\), 2 finding\(s\) from 2 audit\(s\)/.test(result.stderr), result.stderr);

  // --- 4. the bundle file on disk is NEVER rewritten ---
  const onDisk = require(path.join(dir, "docs", "arkaik", "bundle.json"));
  check("pack does not write quality into the source bundle", onDisk.quality === undefined);
}

console.log(`\n${failures === 0 ? "OK" : "FAILURES"}: quality-section-fold`);
process.exit(failures > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build -w arkaik && node tests/cli/quality-section-fold.test.js`
Expected: build succeeds, then `FAIL: pack emits a quality section` and most assertions after it, exit 1.

- [ ] **Step 3: Add `stripDerived` and `loadCurrentQualitySection` to the schema**

In `packages/schema/src/cli/kritik-audit.ts`, insert immediately after `loadQualitySection` (after the closing brace on line 170, before the `computeAuditMatrix` doc comment):

```typescript
/**
 * A finding as the interchange projection carries it: without `severity` and
 * without `priority`.
 *
 * Both are derived from `impact × likelihood` (and, for priority, `cost`) by
 * `severityOf`/`priorityOf`, which never read a stored value — so dropping
 * them loses nothing a reader can observe. `validateBundle` warns
 * `quality-derived-field-stored` on either, and a projection that emits a
 * bundle its own validator objects to is a broken projection. The sidecar
 * keeps whatever it keeps; this is a read.
 */
export function stripDerived(finding: QualityFinding): QualityFinding {
  const { severity: _severity, priority: _priority, ...rest } = finding as QualityFinding &
    Record<"severity" | "priority", unknown>;
  return rest as QualityFinding;
}

/**
 * The project's **current** quality state, assembled from every audit on disk
 * — the interchange projection `bundle.quality` carries.
 *
 * This is not `loadQualitySection` over the newest audit, and the difference
 * is the point. `arkaik kritik score` writes into the newest audit directory,
 * so a partial re-audit leaves a sparse newest `scores.json`; taking it whole
 * would render a mostly-empty matrix and drop every still-open finding from
 * earlier runs. So assessments are **latest-wins per (criterion × surface)**
 * across every audit — which is what `QualitySection.assessments` is
 * documented as, and what `validateBundle`'s `quality-duplicate-assessment`
 * insists on — and findings are pooled, the way `locateFinding` and
 * `allFindings` already read the tree.
 *
 * The consequence is deliberate: this answers "where does the product stand",
 * while `matrix.json` and `arkaik kritik matrix` answer "how did this audit
 * go". They are different questions, and a cap can fire here that did not
 * fire in a single audit's roll-up — an open Critical from two audits ago
 * still caps its cell, which is true. Pass `auditId` to ask the other
 * question instead.
 *
 * `undefined` — never a throw — when there is nothing to project: no audits,
 * or no profile. Both are ordinary states in a repo that has not finished
 * installing Kritik, and neither is a reason to fail a bundle assembly. A
 * *named* `auditId` that does not exist IS a throw: the user typed it.
 */
export function loadCurrentQualitySection(
  root: string,
  library: KritikLibrary,
  auditId?: string,
): QualitySection | undefined {
  const available = listAuditIds(root);
  if (auditId !== undefined && !available.includes(auditId)) {
    throw new Error(`no audit "${auditId}" under ${join(root, QUALITY_DIR, AUDITS_DIR)}`);
  }
  const auditIds = auditId !== undefined ? [auditId] : available;
  if (auditIds.length === 0) return undefined;

  const profile = loadProfile(root);
  if (!profile) return undefined;

  // Insertion-ordered: re-setting a key keeps the cell's original position and
  // replaces its value, so the output is stable for a given tree.
  const cells = new Map<string, QualityAssessment>();
  const findings: QualityFinding[] = [];
  let frameworkVersion: string | undefined;

  for (const id of auditIds) {
    const scores = loadScoresOrEmpty(root, id);
    if (typeof scores.framework_version === "string") frameworkVersion = scores.framework_version;
    for (const assessment of scores.assessments) {
      cells.set(`${assessment.criterion_id}\u0000${assessment.surface}`, assessment);
    }
    for (const finding of loadFindings(root, id).findings) findings.push(stripDerived(finding));
  }

  return {
    framework_version: frameworkVersion ?? library.version,
    library,
    profile,
    assessments: [...cells.values()],
    findings,
  };
}
```

The `\u0000` separator is a NUL, which cannot occur in a criterion id or a surface id, so no pair of values can forge a collision with another pair.

- [ ] **Step 4: Add the `AUDITS_DIR` import if it is missing**

`packages/schema/src/cli/kritik-audit.ts` already imports `AUDITS_DIR`, `QUALITY_DIR`, `auditDir`, `loadProfile`, `readJson`, `writeJson` from `./kritik-paths` and `join` from `node:path` (lines 18–31). Confirm both `AUDITS_DIR` and `QUALITY_DIR` are in that import list — they are, used by `listAuditIds`/`newestAuditId`. No import change is needed. If TypeScript reports `QualityAssessment` unused-before-this, note it is already imported on line 24.

- [ ] **Step 5: Add `foldQualitySection` to the CLI seam**

Append to `packages/cli/src/lib/kritik-io.ts`:

```typescript
/**
 * Fold the repo's quality sidecars into a bundle's `quality` section.
 *
 * The projection is `@arkaik/schema`'s; what lives here is only what "being
 * the CLI's environment" means — resolving the effective pack, and turning
 * "there is nothing to fold" into a line a human can act on.
 *
 * Never throws for a *data* state. A repo with no audits, or with audits but
 * no profile, is a repo mid-installation, and neither is a reason for
 * `arkaik pack` to fail: quality is additive to a bundle. A named `auditId`
 * that does not exist is different — the user typed it — and propagates.
 */
export function foldQualitySection(
  bundle: Record<string, unknown>,
  root: string,
  auditId?: string,
): { folded: boolean; notice: string } {
  const auditIds = listAuditIds(root);
  if (auditIds.length === 0) {
    return { folded: false, notice: `Quality: none to fold (no audits under ${root})` };
  }
  if (loadProfile(root) === null) {
    return {
      folded: false,
      notice: `Quality: skipped — no profile at ${profilePath(root)} (run \`arkaik kritik profile\`)`,
    };
  }

  const { library } = loadKritikLibrary(root);
  const section = loadCurrentQualitySection(root, library, auditId);
  if (section === undefined) {
    return { folded: false, notice: `Quality: none to fold (no audits under ${root})` };
  }

  bundle.quality = section;
  const count = auditId === undefined ? auditIds.length : 1;
  return {
    folded: true,
    notice: `Quality: folded ${section.assessments.length} assessment(s), ${section.findings.length} finding(s) from ${count} audit(s)`,
  };
}
```

Extend the two import blocks at the top of the same file:

```typescript
import { listAuditIds, loadCurrentQualitySection } from "@arkaik/schema/src/cli/kritik-audit";
import { PACK_FILE, QUALITY_DIR, loadOverlay, loadProfile, profilePath, readJson } from "@arkaik/schema/src/cli/kritik-paths";
```

(The existing `kritik-paths` import already brings in `PACK_FILE`, `QUALITY_DIR`, `loadOverlay` and `readJson` — add `loadProfile` and `profilePath` to it. The `kritik-audit` import is new to this file.)

- [ ] **Step 6: Wire the fold into `runPack`**

In `packages/cli/src/commands/pack.ts`:

Add the import beside the existing ones:

```typescript
import { foldQualitySection } from "../lib/kritik-io";
```

Add three fields to `RunPackOptions`, after `inlineAssets`:

```typescript
  /** Skip folding docs/quality/ into bundle.quality. The Publik-safe posture, as --no-journal is for history. */
  noQuality?: boolean;
  /** Pin one audit's snapshot instead of merging every audit into current state. */
  audit?: string;
  /** Repo root holding docs/quality/, resolved against `cwd` (default: `cwd`). */
  root?: string;
```

Add one field to `RunPackResult`, after `assetWarnings`:

```typescript
  /** What the quality fold did — folded, skipped, or nothing to fold. Absent with --no-quality. */
  qualityNotice?: string;
```

In `runPack`, immediately after the journal block (after the closing brace of the `if (noJournal) { ... } else { ... }`) and before `const inlinedAssets`:

```typescript
  let qualityNotice: string | undefined;
  if (!(options.noQuality ?? false)) {
    const root = resolve(cwd, options.root ?? ".");
    try {
      qualityNotice = foldQualitySection(bundle, root, options.audit).notice;
    } catch (e) {
      return fatalResult(filePath, (e as Error).message);
    }
  }
```

Add `qualityNotice` to the success return, after `assetWarnings`:

```typescript
  return { ok: true, bundlePath: filePath, outPath, journalIncluded, journalEventCount, inlinedAssets, assetWarnings, qualityNotice, output };
```

- [ ] **Step 7: Print the notice in `runPackCli`**

In `packages/cli/src/commands/pack.ts`, in `runPackCli`, immediately after the journal reporting block (after the `if (result.journalIncluded) { ... } else { ... }` chain) and before the `for (const asset of result.inlinedAssets)` loop:

```typescript
  if (result.qualityNotice !== undefined) {
    console.error(result.qualityNotice);
  }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/quality-section-fold.test.js`
Expected: every assertion `PASS`, final line `OK: quality-section-fold`, exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/schema/src/cli/kritik-audit.ts packages/cli/src/lib/kritik-io.ts packages/cli/src/commands/pack.ts tests/cli/quality-section-fold.test.js
git commit -m "feat(kritik): fold docs/quality/ sidecars into bundle.quality on pack (#389)"
```

---

> **Revised during execution — Tasks 2 and 3 were merged.** Task 1's review
> rounds pulled a great deal forward: the two skip notices, the corrupt-sidecar
> error, `--root`'s derivation from the bundle path (which replaced this task's
> cwd default entirely), and an in-process `runPack` layer in the suite that
> already pins `--audit`'s semantics — snapshot shape, the pinned audit's own
> `framework_version`, and a ghost id refused even in a repo with no audits.
> What survives of both tasks is the argv contract: parsing the three flags,
> the usage text, and five CLI-level cases proving the spellings reach the
> options `runPack` already honours. They ship as one commit.

## Task 2: `--no-quality`, `--root`, and the two skip notices

**Files:**
- Modify: `packages/cli/src/commands/pack.ts`
- Test: `tests/cli/quality-section-fold.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/cli/quality-section-fold.test.js`, insert before the final `console.log(...)` / `process.exit(...)` lines:

```javascript
// --- 5. --no-quality -------------------------------------------------------

{
  const dir = makeRepo();
  const withQuality = packIn(dir);
  const without = packIn(dir, ["--no-quality"]);

  check("--no-quality exits 0", without.result.status === 0, without.result.stderr);
  check("--no-quality emits no quality key", without.bundle !== undefined && without.bundle.quality === undefined);
  check("--no-quality prints no quality notice", !/^Quality:/m.test(without.result.stderr), without.result.stderr);

  // Everything else must be untouched — the flag removes a section, not more.
  const strip = (b) => {
    const copy = { ...b };
    delete copy.quality;
    return JSON.stringify(copy);
  };
  check(
    "--no-quality changes nothing but the quality section",
    withQuality.bundle !== undefined && strip(withQuality.bundle) === strip(without.bundle),
  );
}

// --- 6. nothing to fold ----------------------------------------------------

{
  const dir = makeRepo({ audits: false, profile: false });
  const { result, bundle } = packIn(dir);
  check("a repo with no audits still packs (exit 0)", result.status === 0, result.stderr);
  check("a repo with no audits gets no quality key", bundle !== undefined && bundle.quality === undefined);
  check("the no-audits notice names the root it looked in", result.stderr.includes("none to fold") && result.stderr.includes(dir), result.stderr);
}

// --- 7. audits but no profile ---------------------------------------------

{
  const dir = makeRepo({ profile: false });
  const { result, bundle } = packIn(dir);
  check("audits without a profile still pack (exit 0)", result.status === 0, result.stderr);
  check("audits without a profile get no quality key", bundle !== undefined && bundle.quality === undefined);
  check(
    "the no-profile notice points at the fix",
    result.stderr.includes("arkaik kritik profile") && result.stderr.includes("profile.json"),
    result.stderr,
  );
}

// --- 8. --root -------------------------------------------------------------

{
  const dir = makeRepo();
  const elsewhere = mkdtempSync(path.join(tmpdir(), "arkaik-qfold-cwd-"));
  const result = spawnSync(
    process.execPath,
    [CLI, "pack", "--root", dir, path.join(dir, "docs", "arkaik", "bundle.json")],
    { encoding: "utf8", cwd: elsewhere },
  );
  let bundle;
  try {
    bundle = JSON.parse(result.stdout);
  } catch {
    bundle = undefined;
  }
  check("--root finds docs/quality/ outside the cwd", result.status === 0 && bundle !== undefined && bundle.quality !== undefined, result.stderr);
  check(
    "--root folds the same 5 cells",
    bundle && bundle.quality && bundle.quality.assessments.length === 5,
    bundle && bundle.quality ? String(bundle.quality.assessments.length) : "no section",
  );
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/cli/quality-section-fold.test.js`
Expected: `FAIL: --no-quality emits no quality key` (the flag is not parsed yet, so it is rejected as an unknown option and the CLI exits 1), plus the `--root` failures. Exit 1.

- [ ] **Step 3: Parse the three new flags**

In `packages/cli/src/commands/pack.ts`, in `runPackCli`, replace the flag-parsing declarations and loop body. The declarations become:

```typescript
  let noJournal = false;
  let inlineAssets = false;
  let noQuality = false;
  let audit: string | undefined;
  let root: string | undefined;
  let out: string | undefined;
  const positionals: string[] = [];
```

and add three branches to the `for` loop, between the `--inline-assets` branch and the `--out` branch:

```typescript
    } else if (arg === "--no-quality") {
      noQuality = true;
    } else if (arg === "--audit") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --audit\n\n${USAGE}`);
      audit = value;
    } else if (arg === "--root") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --root\n\n${USAGE}`);
      root = value;
```

and pass them through:

```typescript
  const result = runPack({ path: filePath, out, noJournal, inlineAssets, noQuality, audit, root });
```

- [ ] **Step 4: Update the usage text**

In `packages/cli/src/commands/pack.ts`, change the `USAGE` first line to:

```
arkaik pack [--no-journal] [--no-quality] [--inline-assets] [--audit <id>] [--root <dir>] [--out <path>] [path]
```

and add these entries to its `Options:` block, after `--inline-assets`:

```
  --no-quality      Omit the quality section. docs/quality/ sidecars are
                     otherwise folded into bundle.quality at pack time, the
                     same way the journal sidecar is folded into journal[] —
                     the sidecars stay canonical and this file is never
                     rewritten. Use this for a bundle that must not carry open
                     findings.
  --audit <id>      Fold one audit's snapshot instead of every audit merged
                     into current state. The merge (default) is latest-wins
                     per criterion x surface and pools findings, so it answers
                     "where does the product stand"; a pinned audit answers
                     "how did that audit go", the same question matrix.json
                     answers.
  --root <dir>      Repo root holding docs/quality/ (default: the current
                     directory). Same flag, same default, as every
                     "arkaik kritik" verb.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/quality-section-fold.test.js`
Expected: every assertion `PASS`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/pack.ts tests/cli/quality-section-fold.test.js
git commit -m "feat(kritik): pack --no-quality, --audit and --root (#389)"
```

---

## Task 3: `--audit <id>` pins one audit

**Files:**
- Test: `tests/cli/quality-section-fold.test.js`

The flag was parsed and threaded in Task 2 and the schema function already honours it. This task proves it, including the refusal on a typo.

- [ ] **Step 1: Write the failing test**

In `tests/cli/quality-section-fold.test.js`, insert before the final `console.log(...)`:

```javascript
// --- 9. --audit pins one audit --------------------------------------------

{
  const dir = makeRepo();
  const { result, bundle } = packIn(dir, ["--audit", "2026-08"]);
  const section = (bundle && bundle.quality) || {};

  check("--audit exits 0", result.status === 0, result.stderr);
  check("--audit 2026-08 carries only that audit's 4 cells", (section.assessments || []).length === 4, JSON.stringify((section.assessments || []).length));
  check(
    "--audit 2026-08 keeps the pre-rescore level (2, not 4)",
    (section.assessments || []).some((a) => a.criterion_id === "SEC-01" && a.surface === "web" && a.level === 2),
    JSON.stringify(section.assessments),
  );
  check("--audit 2026-08 carries only that audit's finding", (section.findings || []).length === 1, JSON.stringify((section.findings || []).map((f) => f.id)));
  check("--audit still strips derived fields", (section.findings || []).every((f) => !("severity" in f) && !("priority" in f)));
  check("--audit still embeds the library", section.library !== undefined && section.library.version === "9.9.9");
  // The PINNED audit's own framework_version, not the newest one. SCORES_08 is
  // "9.9.8" and SCORES_09 is "9.9.9" precisely so this can tell them apart —
  // see the m4 fix in Task 1. `library.version` above stays "9.9.9" because
  // that is the vendored pack's version, which no audit changes.
  check("--audit reports the pinned audit's framework_version", section.framework_version === "9.9.8", section.framework_version);
  check("--audit reports one audit", /from 1 audit\(s\)/.test(result.stderr), result.stderr);
}

// --- 10. --audit with a typo is a hard error ------------------------------

{
  const dir = makeRepo();
  const { result } = packIn(dir, ["--audit", "2026-99"]);
  check("a named audit that does not exist fails", result.status === 1, `exit=${result.status}`);
  check("the failure names the audit and the directory", /2026-99/.test(result.stderr) && /audits/.test(result.stderr), result.stderr);
}
```

- [ ] **Step 2: Run the test**

Run: `node tests/cli/quality-section-fold.test.js`
Expected: PASS on every new assertion. If `--audit 2026-99` does not exit 1, the throw in `loadCurrentQualitySection` is not reaching `runPack`'s `try`/`catch` — re-check Task 1 Step 6.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/quality-section-fold.test.js
git commit -m "test(kritik): pin --audit to one audit's snapshot (#389)"
```

---

## Task 4: `arkaik push --include-quality`

**Files:**
- Modify: `packages/cli/src/commands/push.ts`
- Test: `tests/cli/push.test.js`

- [ ] **Step 1: Write the failing test**

`tests/cli/push.test.js` already esbuild-bundles `push.ts` and injects a mock `httpClient`. Find the existing `--include-journal` case and add these two cases in the same style, immediately after it. Adapt the local helper names to the ones already in the file (`runPush`, `makeMockHttpClient`, the temp bundle path) — the assertions are what matter:

```javascript
// A repo with quality sidecars: push must NOT send them unless asked.
{
  const dir = makeQualityRepo();
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const httpClient = makeMockHttpClient(() => jsonResponse(201, { id: "abc", owner_key: "k", url: "https://arkaik.app/p/abc" }));

  const result = await runPush({ path: bundlePath, apiBase: "http://example.invalid", cwd: dir, httpClient });
  const sent = JSON.parse(httpClient.calls[0].init.body);

  check("push succeeds", result.ok !== false, JSON.stringify(result));
  check("push sends no quality section by default", sent.quality === undefined);
  check("push sends no include_quality parameter by default", !httpClient.calls[0].url.includes("include_quality"), httpClient.calls[0].url);
}

// --include-quality opts in, and forwards the parameter the server honours.
{
  const dir = makeQualityRepo();
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const httpClient = makeMockHttpClient(() => jsonResponse(201, { id: "abc", owner_key: "k", url: "https://arkaik.app/p/abc" }));

  const result = await runPush({
    path: bundlePath,
    includeQuality: true,
    apiBase: "http://example.invalid",
    cwd: dir,
    httpClient,
  });
  const sent = JSON.parse(httpClient.calls[0].init.body);

  check("push --include-quality succeeds", result.ok !== false, JSON.stringify(result));
  check("push --include-quality sends the section", sent.quality !== undefined && sent.quality.assessments.length === 5);
  check("push --include-quality forwards include_quality=true", httpClient.calls[0].url.includes("include_quality=true"), httpClient.calls[0].url);
}

// THE NON-VACUOUS CASE. Both assertions above start from a bundle with no
// `quality` key, so `sent.quality === undefined` would pass even if push did
// nothing at all — which is exactly how a real leak survived two reviews of
// Task 1. Here the SOURCE bundle already carries a section and there are no
// sidecars, so the default posture has something it must actively remove.
{
  const dir = makeQualityRepo();
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const preloaded = JSON.parse(readFileSync(bundlePath, "utf8"));
  preloaded.quality = {
    framework_version: "9.9.9",
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [],
    findings: [{ id: "F-LEAK", criterion_id: "SEC-01", surface: "web", title: "Live token at app/secret.ts:4", impact: 5, likelihood: 5, cost: "S", status: "open" }],
  };
  writeFileSync(bundlePath, JSON.stringify(preloaded, null, 2) + "\n");

  const httpClient = makeMockHttpClient(() => jsonResponse(201, { id: "abc", owner_key: "k", url: "https://arkaik.app/p/abc" }));
  await runPush({ path: bundlePath, apiBase: "http://example.invalid", cwd: dir, httpClient });
  const sent = JSON.parse(httpClient.calls[0].init.body);

  check("push strips a quality section the source bundle already carried", sent.quality === undefined, JSON.stringify(sent.quality));
  check("no finding text reaches the request body", !httpClient.calls[0].init.body.includes("F-LEAK"));
}
```

Add a `makeQualityRepo()` helper to `tests/cli/push.test.js` that writes the same tree Task 1's `makeRepo()` writes — a valid bundle at `docs/arkaik/bundle.json`, `docs/quality/{library.json,profile.json}` and the two audit directories. Copy the constants from `tests/cli/quality-section-fold.test.js`; they are small and duplicating them keeps each suite runnable on its own, which is how every other suite in `tests/cli/` is written.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/cli/push.test.js`
Expected: `FAIL: push --include-quality sends the section` — `includeQuality` is not a recognised option yet, so the section is never packed.

- [ ] **Step 3: Add the option and strip by default**

In `packages/cli/src/commands/push.ts`, add to `RunPushOptions`, after `includeJournal`:

```typescript
  /** Embed the quality section (forwarding ?include_quality=true) instead of stripping it. */
  includeQuality?: boolean;
```

In `runPush`, after `const includeJournal = options.includeJournal ?? false;`:

```typescript
  const includeQuality = options.includeQuality ?? false;
```

Change the `runPack` call to strip quality by default:

```typescript
  const packed = runPack({ path: filePath, noJournal: !includeJournal, noQuality: !includeQuality, cwd });
```

Replace the single-parameter URL construction with a two-parameter one:

```typescript
  const params: string[] = [];
  if (includeJournal) params.push("include_journal=true");
  if (includeQuality) params.push("include_quality=true");
  const url = `${apiBase}/api/publik${params.length > 0 ? `?${params.join("&")}` : ""}`;
```

- [ ] **Step 4: Parse the flag**

In `runPushCli`, add `let includeQuality = false;` beside `let includeJournal = false;`, add the branch after the `--include-journal` branch:

```typescript
    } else if (arg === "--include-quality") {
      includeQuality = true;
```

and pass it: `runPush({ path: filePath, includeJournal, includeQuality, apiBase })`.

- [ ] **Step 5: Update the usage text**

In `packages/cli/src/commands/push.ts`, change the `USAGE` first line to:

```
arkaik push [--include-journal] [--include-quality] [--api <base-url>] [path]
```

and add to its `Options:` block after `--include-journal`:

```
  --include-quality   Embed the quality section and forward
                       ?include_quality=true. Default: stripped, omitted
                       entirely from the request body. Publishing your open
                       findings and publishing your history are separate
                       decisions and both default to no.
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/push.test.js`
Expected: every assertion `PASS`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/push.ts tests/cli/push.test.js
git commit -m "feat(kritik): push --include-quality, stripped by default (#389)"
```

---

## Task 5: `arkaik restore` folds the section

**Files:**
- Modify: `packages/cli/src/commands/restore.ts`
- Test: `tests/cli/bootstrap-restore.test.js`

`restore` does not call `runPack` — it assembles `{ ...local, journal }` itself at line 474 — so it needs the fold wired separately. This is the verb that actually lands a bundle on a hosted project, and therefore the one #389's acceptance criteria depend on.

- [ ] **Step 1: Write the failing test**

In `tests/cli/bootstrap-restore.test.js`, add a case in the file's existing style (it already has `makeMockHttpClient`, `runRestore`, and temp-dir helpers):

```javascript
// Quality sidecars ride out with the restore — this is the verb that lands a
// bundle on a hosted project, and it does not go through runPack.
{
  const dir = makeRepoWithQuality();
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const httpClient = makeMockHttpClient((url, init) => {
    if (url.endsWith("/export")) return jsonResponse(200, { bundle: { nodes: [], edges: [], journal: [] } });
    if (url.endsWith("/bundle")) return jsonResponse(200, { version: "v2", delta: {} });
    return jsonResponse(200, { version: "v1" });
  });

  const result = await runRestore({
    path: bundlePath,
    apiBase: "http://example.invalid",
    env: { ARKAIK_TOKEN: "tok" },
    cwd: dir,
    httpClient,
  });

  const put = httpClient.calls.find((c) => c.url.endsWith("/bundle"));
  const sent = JSON.parse(put.init.body).bundle;

  check("restore succeeds with quality sidecars present", result.ok !== false, JSON.stringify(result));
  check("restore sends the quality section", sent.quality !== undefined, JSON.stringify(Object.keys(sent)));
  check("restore sends the merged 5 cells", sent.quality && sent.quality.assessments.length === 5);
  check("restore sends both pooled findings", sent.quality && sent.quality.findings.length === 2);
  check("restore strips derived fields too", sent.quality && sent.quality.findings.every((f) => !("severity" in f)));
}

// --no-quality opts out.
{
  const dir = makeRepoWithQuality();
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const httpClient = makeMockHttpClient((url) => {
    if (url.endsWith("/export")) return jsonResponse(200, { bundle: { nodes: [], edges: [], journal: [] } });
    if (url.endsWith("/bundle")) return jsonResponse(200, { version: "v2", delta: {} });
    return jsonResponse(200, { version: "v1" });
  });

  await runRestore({
    path: bundlePath,
    noQuality: true,
    apiBase: "http://example.invalid",
    env: { ARKAIK_TOKEN: "tok" },
    cwd: dir,
    httpClient,
  });

  const put = httpClient.calls.find((c) => c.url.endsWith("/bundle"));
  check("restore --no-quality sends no section", JSON.parse(put.init.body).bundle.quality === undefined);
}
```

Add a `makeRepoWithQuality()` helper writing the same tree as Task 1's `makeRepo()`, plus a `journal.jsonl` sidecar if the file's existing helpers require one for a successful restore (check how the neighbouring success cases build their repos and match them).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/cli/bootstrap-restore.test.js`
Expected: `FAIL: restore sends the quality section`.

- [ ] **Step 3: Add the options**

In `packages/cli/src/commands/restore.ts`, add to `RunRestoreOptions`, after `allowDeletions`:

```typescript
  /** Skip folding docs/quality/ into the outbound bundle's quality section. Default: false. */
  noQuality?: boolean;
  /** Pin one audit's snapshot instead of merging every audit into current state. */
  audit?: string;
  /** Repo root holding docs/quality/, resolved against `cwd` (default: `cwd`). */
  root?: string;
```

- [ ] **Step 4: Fold into the outbound bundle**

In `packages/cli/src/commands/restore.ts`, add the import beside the existing `../lib/journal-io` import:

```typescript
import { foldQualitySection } from "../lib/kritik-io";
```

Replace line 475 (`const outboundBundle = { ...local, journal: journalEvents };`) with:

```typescript
  const outboundBundle: Record<string, unknown> = { ...local, journal: journalEvents };
  if (!(options.noQuality ?? false)) {
    const qualityRoot = resolve(cwd, options.root ?? ".");
    try {
      foldQualitySection(outboundBundle, qualityRoot, options.audit);
    } catch (e) {
      return fatalResult(dryRun, (e as Error).message);
    }
  }
```

- [ ] **Step 5: Parse the flags**

In `runRestoreCli`, add `let noQuality = false;`, `let audit: string | undefined;` and `let root: string | undefined;` beside the existing flag declarations, add the branches:

```typescript
    } else if (arg === "--no-quality") {
      noQuality = true;
    } else if (arg === "--audit") {
      const value = argv[++i];
      if (value === undefined) fail(`Missing value for --audit\n\n${USAGE}`);
      audit = value;
    } else if (arg === "--root") {
      const value = argv[++i];
      if (value === undefined) fail(`Missing value for --root\n\n${USAGE}`);
      root = value;
```

and pass them: `runRestore({ path: positionals[0], dryRun, allowHistoryLoss, allowDeletions, noQuality, audit, root, apiBase })`.

- [ ] **Step 6: Update the usage text**

In `packages/cli/src/commands/restore.ts`, add to the `USAGE` `Options:` block:

```
  --no-quality          Do not send a quality section. By default the repo's
                         docs/quality/ sidecars are folded into the outbound
                         bundle, which is what makes the hosted Quality page
                         and the resolution webhook work.
  --audit <id>          Send one audit's snapshot rather than every audit
                         merged into current state.
  --root <dir>          Repo root holding docs/quality/ (default: the current
                         directory).
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-restore.test.js`
Expected: every assertion `PASS`, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/restore.ts tests/cli/bootstrap-restore.test.js
git commit -m "feat(kritik): restore folds the quality section into the outbound bundle (#389)"
```

---

## Task 6: `restore --allow-quality-loss`

**Files:**
- Modify: `packages/cli/src/commands/restore.ts`
- Test: `tests/cli/bootstrap-restore.test.js`

`restore` replaces the hosted snapshot wholesale. A repo with no sidecars restoring over a project that has a quality section destroys it silently — the same shape `--allow-history-loss` already guards. The export needed to detect it is already fetched for the mandatory backup, so this costs no extra round-trip.

- [ ] **Step 1: Write the failing test**

Add to `tests/cli/bootstrap-restore.test.js`:

```javascript
// A repo with NO sidecars must not silently wipe a hosted quality section.
{
  const dir = makeRepoWithoutQuality();
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const httpClient = makeMockHttpClient((url) => {
    if (url.endsWith("/export")) {
      return jsonResponse(200, {
        bundle: { nodes: [], edges: [], journal: [], quality: { framework_version: "9.9.9", profile: { surfaces: [] }, assessments: [], findings: [{ id: "F-1" }, { id: "F-2" }] } },
      });
    }
    if (url.endsWith("/bundle")) return jsonResponse(200, { version: "v2", delta: {} });
    return jsonResponse(200, { version: "v1" });
  });

  const result = await runRestore({
    path: bundlePath,
    apiBase: "http://example.invalid",
    env: { ARKAIK_TOKEN: "tok" },
    cwd: dir,
    httpClient,
  });

  check("a would-be quality wipe is refused", result.ok === false, JSON.stringify(result));
  check("no PUT was sent", httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 0);
  check("the refusal names the hosted finding count", /2 finding/.test(result.fatal || ""), result.fatal);
  check("the refusal names the escape hatch", /--allow-quality-loss/.test(result.fatal || ""), result.fatal);
  check("the refusal points at --root", /--root/.test(result.fatal || ""), result.fatal);
}

// --allow-quality-loss proceeds.
{
  const dir = makeRepoWithoutQuality();
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const httpClient = makeMockHttpClient((url) => {
    if (url.endsWith("/export")) {
      return jsonResponse(200, { bundle: { nodes: [], edges: [], journal: [], quality: { framework_version: "9.9.9", profile: { surfaces: [] }, assessments: [], findings: [] } } });
    }
    if (url.endsWith("/bundle")) return jsonResponse(200, { version: "v2", delta: {} });
    return jsonResponse(200, { version: "v1" });
  });

  const result = await runRestore({
    path: bundlePath,
    allowQualityLoss: true,
    apiBase: "http://example.invalid",
    env: { ARKAIK_TOKEN: "tok" },
    cwd: dir,
    httpClient,
  });

  check("--allow-quality-loss proceeds", result.ok !== false, JSON.stringify(result));
  check("--allow-quality-loss sends the PUT", httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 1);
}

// A hosted project with NO quality section is not a loss — no guard fires.
{
  const dir = makeRepoWithoutQuality();
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const httpClient = makeMockHttpClient((url) => {
    if (url.endsWith("/export")) return jsonResponse(200, { bundle: { nodes: [], edges: [], journal: [] } });
    if (url.endsWith("/bundle")) return jsonResponse(200, { version: "v2", delta: {} });
    return jsonResponse(200, { version: "v1" });
  });

  const result = await runRestore({
    path: bundlePath,
    apiBase: "http://example.invalid",
    env: { ARKAIK_TOKEN: "tok" },
    cwd: dir,
    httpClient,
  });

  check("no hosted quality means no guard", result.ok !== false && httpClient.calls.filter((c) => c.url.endsWith("/bundle")).length === 1, JSON.stringify(result));
}
```

Add `makeRepoWithoutQuality()` — the same repo as `makeRepoWithQuality()` minus the whole `docs/quality/` tree.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/cli/bootstrap-restore.test.js`
Expected: `FAIL: a would-be quality wipe is refused` — the PUT goes out.

- [ ] **Step 3: Add the option**

In `packages/cli/src/commands/restore.ts`, add to `RunRestoreOptions` after `noQuality`:

```typescript
  /** Proceed even when the outbound bundle has no quality section and the hosted one does. Default: false. */
  allowQualityLoss?: boolean;
```

and read it in `runRestore` beside the other allow-flags:

```typescript
  const allowQualityLoss = options.allowQualityLoss ?? false;
```

- [ ] **Step 4: Widen the exported-bundle type and add the guard**

In `packages/cli/src/commands/restore.ts`, extend the `exportedBundle` cast (currently `{ nodes?: unknown; edges?: unknown; journal?: unknown }`):

```typescript
  const exportedBundle = exported as { nodes?: unknown; edges?: unknown; journal?: unknown; quality?: unknown };
```

Insert the guard immediately after the history-loss guard's closing brace and before the `// ── Deletion guard ──` comment:

```typescript
  // ── Quality-loss guard ───────────────────────────────────────────────────
  // Same shape as the history guard above, for the section this change
  // introduced. A repo whose docs/quality/ is absent, gitignored, or simply
  // out of reach of --root produces an outbound bundle with no quality
  // section — and a restore would replace a hosted one with nothing, reading
  // as an ordinary success everywhere else. The export is already in hand for
  // the backup, so this costs no extra round-trip.
  const hostedQuality = exportedBundle.quality;
  if (
    hostedQuality !== undefined &&
    hostedQuality !== null &&
    outboundBundle.quality === undefined &&
    !allowQualityLoss
  ) {
    const hostedFindings = (hostedQuality as { findings?: unknown }).findings;
    const hostedFindingCount = Array.isArray(hostedFindings) ? hostedFindings.length : 0;
    return fatalResult(
      dryRun,
      `This restore would erase the hosted quality section (${hostedFindingCount} finding(s)) — the outbound bundle carries none. ` +
        `Nothing was sent. If that is intended, re-run with --allow-quality-loss; ` +
        `otherwise check that docs/quality/ exists under the repo root (--root <dir> if it is not the current directory).`,
    );
  }
```

- [ ] **Step 5: Parse the flag**

In `runRestoreCli`, add `let allowQualityLoss = false;`, the branch:

```typescript
    } else if (arg === "--allow-quality-loss") {
      allowQualityLoss = true;
```

and pass it in the `runRestore({ ... })` call.

- [ ] **Step 6: Update the usage text**

In `packages/cli/src/commands/restore.ts`, change the `USAGE` first line to include the flag, and add to `Options:`:

```
  --allow-quality-loss  Proceed even though the outbound bundle has no quality
                         section while the hosted project does. Without this,
                         such a restore is refused before anything is sent.
```

Also update the module doc comment's first line (line 2) to list the new flags.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/bootstrap-restore.test.js`
Expected: every assertion `PASS`, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/restore.ts tests/cli/bootstrap-restore.test.js
git commit -m "feat(kritik): refuse a restore that erases the hosted quality section (#389)"
```

---

## Task 7: Validator parity and library provenance

**Files:**
- Test: `tests/cli/quality-section-fold.test.js`

The acceptance criterion is that a folded bundle validates with **no new warnings**. This task proves it end to end, and proves the embedded library is the project's effective pack rather than whatever the CLI shipped with.

- [ ] **Step 1: Write the failing test**

In `tests/cli/quality-section-fold.test.js`, add before the final `console.log(...)`:

```javascript
// --- 11. the folded bundle validates clean --------------------------------

{
  const dir = makeRepo();
  const { result } = packIn(dir, ["--out", path.join(dir, "packed.json")]);
  check("pack --out exits 0", result.status === 0, result.stderr);

  const validated = runIn(dir, ["validate", path.join(dir, "packed.json")]);
  const output = `${validated.stdout}\n${validated.stderr}`;

  check("the folded bundle is VALID", validated.status === 0, output);
  check("no duplicate-assessment warning", !output.includes("quality-duplicate-assessment"), output);
  check("no derived-field warning", !output.includes("quality-derived-field-stored"), output);
  check("no library-missing warning", !output.includes("quality-library-missing"), output);
  check("no unknown-criterion warning", !output.includes("quality-unknown-criterion"), output);
  check("no unknown-surface warning", !output.includes("quality-unknown-surface"), output);
  check("no no-surfaces warning", !output.includes("quality-no-surfaces"), output);
}

// --- 12. the embedded library is the project's EFFECTIVE pack --------------

{
  const dir = makeRepo();
  const { bundle } = packIn(dir);
  const library = (bundle && bundle.quality && bundle.quality.library) || {};

  check("the vendored pack's version is embedded, not the shipped one", library.version === "9.9.9", library.version);

  // Non-default scales: proves the pack was read rather than the schema
  // defaults being assumed. Defaults are A:85 and critical [20,25].
  check("the pack's grade bands ride along", library.scales && library.scales.grades && library.scales.grades.A === 97, JSON.stringify(library.scales));
  check(
    "the pack's severity buckets ride along",
    library.scales && library.scales.severity_buckets && library.scales.severity_buckets.critical[0] === 21,
    JSON.stringify(library.scales),
  );

  // Real weights: without these the app scores every criterion at weight 1.
  const weightOf = (id) => (library.criteria || []).find((c) => c.id === id);
  check("SEC-01 keeps weight 3", weightOf("SEC-01") && weightOf("SEC-01").weight === 3);
  check("SEC-02 keeps weight 1", weightOf("SEC-02") && weightOf("SEC-02").weight === 1);
  check("TST-01 keeps weight 2", weightOf("TST-01") && weightOf("TST-01").weight === 2);

  // Pack (+) overlay, not the bare pack — a custom criterion must survive.
  check("the project's overlay criterion is in the embedded library", weightOf("SEC-99") !== undefined, JSON.stringify((library.criteria || []).map((c) => c.id)));

  // Domain names, which the fallback library cannot recover.
  check("domain names survive", (library.domains || []).some((d) => d.code === "SEC" && d.name === "Security"), JSON.stringify(library.domains));
}
```

- [ ] **Step 2: Run the test**

Run: `npm run build -w arkaik && node tests/cli/quality-section-fold.test.js`
Expected: every assertion `PASS`, exit 0. If `quality-unknown-criterion` fires, the overlay is not being merged — re-check that `foldQualitySection` uses `loadKritikLibrary(root)` (pack ⊕ overlay) and not `resolvePack(root).library`.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/quality-section-fold.test.js
git commit -m "test(kritik): folded bundle validates clean and embeds the effective pack (#389)"
```

---

## Task 8: Wire the suite into CI, and document the projection

**Files:**
- Modify: `package.json`
- Modify: `packages/cli/src/index.ts`
- Modify: `docs/spec/bundle-format.md`, `docs/spec/toolchain.md`, `docs/kritik-skill/skill.md`, `docs/rfcs/kritik.md`

- [ ] **Step 1: Add the npm scripts**

In `package.json`, add a standalone script beside the other `test:*` entries:

```json
"test:quality-section-fold": "npm run build -w arkaik && node tests/cli/quality-section-fold.test.js",
```

and append the suite to the `test:cli` chain, which CI already runs (`.github/workflows/ci.yml:237`), so no workflow change is needed:

```
... && node tests/cli/kritik.test.js && node tests/cli/quality-section-fold.test.js
```

Note the name: `test:quality-fold` is already taken by `tests/data/quality-fold.test.js`, which covers phase E's `foldResolvedFindings` — a different fold entirely. Do not reuse it.

- [ ] **Step 2: Update the CLI's top-level usage**

In `packages/cli/src/index.ts`, change the two affected lines in the `Commands:` block:

```
  pack [options] [path]       Produce a single self-contained interchange bundle (embeds journal + quality).
  push [options] [path]       Validate, pack (journal + quality stripped), and publish to Publik.
```

- [ ] **Step 3: Document the projection in the specs**

In `docs/spec/bundle-format.md`, in the section describing the `quality` key, add:

```markdown
`quality` is an **interchange projection**, exactly as `journal[]` is. The
sidecars under `docs/quality/` are canonical in a repository; `arkaik pack` and
`arkaik restore` fold them into this key at assembly time, and
`docs/arkaik/bundle.json` is never rewritten to carry it. `--no-quality` opts
out; `arkaik push` opts out by default.

The folded section is **current state**, not one audit: assessments are
latest-wins per (criterion × surface) across every audit, and findings are
pooled. This deliberately answers a different question from
`docs/quality/audits/<id>/matrix.json`, which is one audit's roll-up — an open
Critical from an earlier audit still caps its cell here even if the newest
audit never re-scored it. `arkaik pack --audit <id>` pins one audit's snapshot
when the roll-up's question is the one you want.
```

In `docs/spec/toolchain.md`, add the four flags (`pack --no-quality/--audit/--root`, `push --include-quality`, `restore --no-quality/--audit/--root/--allow-quality-loss`) to the CLI verb tables in the style already used there.

- [ ] **Step 4: Update the agent skill**

In `docs/kritik-skill/skill.md`, in the "When a fix merges" section, replace the hedge that the App "may" fire with the concrete requirement. Add, in the section that describes finishing an audit:

```markdown
### Getting your audit into the app

The audit files are canonical, but the app reads a bundle. Fold them in when
you publish:

    arkaik pack --out packed.json      # includes the quality section by default
    arkaik restore                     # lands it on the linked hosted project

`arkaik push` publishes to Publik and **strips** the section by default —
open findings are a roadmap for whoever reads them first. `--include-quality`
opts in deliberately.

Nothing writes `docs/arkaik/bundle.json`. If the Quality page is empty after a
restore, check the stderr line: `Quality: none to fold` names the root it
looked in, and `Quality: skipped` means there is no `docs/quality/profile.json`
yet.
```

Keep `arkaik kritik finding resolve` documented as mandatory — the webhook now has data to work with, but the skill's existing guidance is unchanged by this task.

- [ ] **Step 5: Close the RFC's open question**

In `docs/rfcs/kritik.md` § 4.1, after the `QualitySection` type block, add:

```markdown
**Lane 2's writer (#389) is assembly-time.** `loadCurrentQualitySection`
(`packages/schema/src/cli/kritik-audit.ts`) merges every audit into current
state and embeds the effective library; `arkaik pack` and `arkaik restore`
call it. The sidecars stay canonical and no verb writes `bundle.quality` to
disk — the same split as `journal.jsonl` and `journal[]`.
```

- [ ] **Step 6: Run the full affected suite**

Run: `npm run test:cli && npm run lint`
Expected: every suite passes; eslint reports 0 errors (warnings are pre-existing — `main` lints at 0 errors / 4 warnings, so any error is from this change).

- [ ] **Step 7: Commit**

```bash
git add package.json packages/cli/src/index.ts docs/spec/bundle-format.md docs/spec/toolchain.md docs/kritik-skill/skill.md docs/rfcs/kritik.md
git commit -m "docs(kritik): document the lane-2 projection; wire its suite into test:cli (#389)"
```

---

## Before opening the PR

- [ ] **Regenerate the generated artifacts.** CI diffs them and fails on drift, and `kritik-audit.ts` is an input to `scripts/generate/build-kritik-scripts.js`. Run the repo's generate script and commit any diff.
- [ ] **Run the gates that this change can plausibly break:** `npm run test:cli`, `npm run test:quality`, `npm run test:quality-ops`, `npm run test:kritik-plugin`, `npm run test:publik-strip`, `npm run lint`.
- [ ] **Write the Lab Note.** This is user-facing — audits become visible in the app — so the PR body needs a `## Lab Note` section with a single ```yaml fence, `en.title` and `en.summary` required, every title and summary double-quoted, `suggested.molecule: arkaik`. See `CLAUDE.md`.
- [ ] **Amend #389's acceptance list.** Its first bullet says `docs/arkaik/bundle.json` gains a `quality` section. By decision 1 it deliberately does not. Say so in the PR body rather than leaving the issue reading as partly unmet.
- [ ] **Read the PR's comments after opening.** The advisory Lab Note reminder posts there and clears its own comment once the body is fixed.

---

## Self-review

**Spec coverage.** Design § 1 (the seam) → Task 1. § 2 (the wrapper) → Task 1. § 3 (the four verbs and their flags) → Tasks 2, 3, 4, 5. § 4 (failure modes and notices) → Task 2. § 5 (the restore guard) → Task 6. § Testing cases 1–10 → Tasks 1, 2, 3, 4, 5, 6, 7 (case 1 → Task 1; case 2 → Task 3; case 3 → Task 1; case 4 → Task 7; case 5 → Task 7; case 6 → Task 2; cases 7–8 → Task 2; case 9 → Task 4; case 10 → Task 6). § Files → Tasks 1–8, with the one documented deviation below. § Non-goals → nothing in any task writes `docs/arkaik/bundle.json`, and Task 1 Step 1 asserts it.

**Deviations from the spec, both deliberate and stated inline:**
1. The two-audit fixture is written by the test at runtime rather than committed under `tests/cli/fixtures/quality-two-audits/`. Same coverage, matches `tests/cli/kritik.test.js`.
2. `--audit <id>` is an optional third parameter of `loadCurrentQualitySection` rather than a route to the untouched `loadQualitySection`. This means a pinned audit also gets the library embedded and its derived fields stripped — which is what a bundle needs, and what the spec's own § 3 flag table implies. `loadQualitySection` and its four existing callers are still untouched, which is the property that mattered.

**Type consistency.** `foldQualitySection(bundle, root, auditId?)` returns `{ folded: boolean; notice: string }` and is called that way in Task 1 Step 6 (`pack`) and Task 5 Step 4 (`restore`). `loadCurrentQualitySection(root, library, auditId?)` returns `QualitySection | undefined` and is called that way in Task 1 Step 5. `RunPackOptions.noQuality/audit/root` and `RunPackResult.qualityNotice` are declared in Task 1 Step 6 and consumed in Task 1 Step 7 and Task 2 Step 3. `RunRestoreOptions.noQuality/audit/root` (Task 5 Step 3) and `.allowQualityLoss` (Task 6 Step 3) match their `runRestoreCli` call sites. `RunPushOptions.includeQuality` (Task 4 Step 3) matches Task 4 Step 4.

**One thing the executor must not "fix".** The fixture's grade bands and severity buckets differ from the schema defaults on purpose (Task 7's provenance assertions depend on it). Normalizing them to `A:85` / `critical:[20,25]` would leave every assertion passing while proving nothing.
