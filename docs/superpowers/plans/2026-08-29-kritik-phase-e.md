# Kritik Phase E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two loops Kritik has never had — a merged PR resolves the finding it names, and two consecutive audits are compared so drift announces itself.

**Architecture:** Three independent parts in one PR. (1) A new merged-PR half in the GitHub App webhook, beside `applyLabNote`, that appends `quality.finding.resolved`. (2) A pure read projection, `foldResolvedFindings`, applied where the app assembles a bundle — so all five existing quality consumers become correct without changing any of them. (3) `detectRegressions` in `@arkaik/schema`, reached from an `arkaik kritik regressions` verb, a `kritik_regressions` MCP tool, and a generated plugin script.

**Tech Stack:** TypeScript, Next.js App Router, Postgres (`pg`), esbuild (plugin script bundling), plain-Node test scripts driven by `npm run test:*` and mirrored as CI steps.

**Design:** [`docs/superpowers/specs/2026-08-29-kritik-phase-e-design.md`](../specs/2026-08-29-kritik-phase-e-design.md)

---

## File Structure

**New**

| Path | Responsibility |
| --- | --- |
| `lib/services/github/quality-parse.ts` | The mention grammar. Pure, DB-free, no runtime imports. Finding ids and closing issue references out of a PR's title/body. |
| `lib/services/github/quality.ts` | `applyQualityResolutions` — match mentions against a project's findings, append `quality.finding.resolved`. Server-only; its project read is an injectable seam. |
| `packages/schema/src/quality-regressions.ts` | `detectRegressions` — pure comparison of two audits. Zod-free, fs-free. |
| `packages/schema/src/cli/kritik-regressions-cli.ts` | Entry point for the bundled `detect-regressions.js` plugin script. |
| `tests/services/load-quality-parse.js` | Transpiles `quality-parse.ts` and `quality.ts` into plain Node. |
| `tests/services/quality-webhook.test.js` | The grammar and the resolution pass, DB-free. |
| `tests/schema/quality-regressions.test.js` | The three kinds, the guard, and its exemption. |

**Modified**

| Path | Change |
| --- | --- |
| `lib/utils/quality.ts` | `foldResolvedFindings`. |
| `lib/services/graph/store.ts` | `qualityResolutionEvents` — a narrow read of just the resolution events. |
| `app/api/graph/projects/[projectId]/route.ts` | Fold on GET. |
| `lib/data/local-provider.ts` | Fold in `getProject`. |
| `app/api/github/webhook/route.ts` | Call `applyQualityResolutions` beside `applyLabNote`. |
| `packages/schema/src/index.ts` | Export the regression module. |
| `packages/cli/src/commands/kritik.ts` | The `regressions` verb; a pointer from `signals`. |
| `packages/mcp/src/kritik-tools.ts` | `kritik_regressions`. |
| `scripts/generate/build-kritik-scripts.js` | The new script entry. |
| `docs/kritik-skill/skill.md` | The between-audits step. |
| `docs/rfcs/kritik.md` | Record that § 8.6's deferred half is built. |
| `package.json`, `.github/workflows/ci.yml` | Two new test scripts and their CI steps. |
| `tests/app/quality.test.js`, `tests/cli/kritik.test.js`, `tests/mcp/kritik-tools.test.js`, `tests/schema/kritik-plugin.test.js` | Coverage for the fold, the verb, the tool, the script. |

---

## Task 1: The mention grammar

**Files:**
- Create: `lib/services/github/quality-parse.ts`
- Create: `tests/services/load-quality-parse.js`
- Create: `tests/services/quality-webhook.test.js`

- [ ] **Step 1: Write the loader**

`tests/services/load-quality-parse.js` — the `load-lab-note-parse.js` idiom, built for two files from the start so Task 2 needs no rewrite. `server-only` is a Next.js build-time guard with no Node implementation, so it is stripped; `@arkaik/schema` and `@/lib/...` are rewritten to resolvable paths.

```js
/**
 * Loads lib/services/github/quality-parse.ts and quality.ts into a plain Node
 * process — the tests/services/load-lab-note-parse.js idiom.
 *
 * `quality-parse.ts` has NO value imports (its only import is a type), so it
 * transpiles straight through. `quality.ts` imports `server-only` (a Next.js
 * build-time guard with no Node implementation) and two `@/lib/...` modules it
 * only reaches through its INJECTED seam, so both are stubbed away here: the
 * suite never exercises the production reader.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-quality-parse");

function loadQualityParse() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  // The two `@/lib/...` modules quality.ts names. It only reaches them through
  // its production seam, which this suite always replaces, so a throwing stub
  // is both sufficient and a tripwire: if a test ever hits one, it says so.
  const stub = (name) => {
    const file = path.join(BUILD_DIR, `${name}.js`);
    fs.writeFileSync(
      file,
      `const boom = () => { throw new Error("${name}: the production seam ran in a DB-free suite"); };\n` +
        `module.exports = new Proxy({}, { get: () => boom });\n`,
    );
    return file;
  };
  const dbStub = stub("db-stub");
  const storeStub = stub("store-stub");
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  const compile = (relative, outName) => {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(relative),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const rewritten = outputText
      .replace(/require\((['"])server-only\1\);?/g, "")
      .replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`)
      .replace(/require\((['"])@\/lib\/services\/db\1\)/g, `require(${JSON.stringify(dbStub)})`)
      .replace(/require\((['"])@\/lib\/services\/graph\/store\1\)/g, `require(${JSON.stringify(storeStub)})`)
      .replace(/require\((['"])@\/lib\/services\/github\/quality-parse\1\)/g, `require(${JSON.stringify(path.join(BUILD_DIR, "quality-parse.js"))})`)
      .replace(/require\((['"])@\/lib\/services\/github\/pull-request\1\)/g, `require(${JSON.stringify(storeStub)})`);
    const outFile = path.join(BUILD_DIR, outName);
    fs.writeFileSync(outFile, rewritten);
    delete require.cache[outFile];
    return outFile;
  };

  const parseFile = compile("lib/services/github/quality-parse.ts", "quality-parse.js");
  // Task 2 creates quality.ts. Guarded so THIS task's suite runs on its own.
  const serviceSrc = path.join(ROOT, "lib/services/github/quality.ts");
  const serviceFile = fs.existsSync(serviceSrc)
    ? compile("lib/services/github/quality.ts", "quality.js")
    : undefined;
  return { ...require(parseFile), ...(serviceFile ? require(serviceFile) : {}) };
}

module.exports = { loadQualityParse, BUILD_DIR };
```

- [ ] **Step 2: Write the failing test**

`tests/services/quality-webhook.test.js`:

```js
#!/usr/bin/env node

/**
 * Phase E's webhook half (lib/services/github/quality-parse.ts and
 * lib/services/github/quality.ts, wired in app/api/github/webhook).
 *
 * DB-free by construction: the grammar imports nothing, and the resolution
 * pass takes its project read as an injected seam, the way
 * applyPullRequestEvent already takes `fetchFiles`. So this runs in CI's fast
 * build job rather than beside the suites that need Postgres.
 */

const fs = require("fs");
const { loadQualityParse, BUILD_DIR } = require("./load-quality-parse");

// ONE build for the whole file: loadQualityParse() wipes and rebuilds
// BUILD_DIR, so calling it twice would pull the directory out from under the
// modules the first call already required.
const kritik = loadQualityParse();
const { mentionedFindings, closedIssues, parseIssueRef, isFindingId } = kritik;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const REPO = "acme/notes-app";
const ev = (title, body) => ({ title, body, repoFullName: REPO });

// --- finding ids -------------------------------------------------------------

const found = mentionedFindings(ev("Fix F-2026-08-SEC-web-01", "Also closes F-2026-08-PRV-ios-02."));
check("ids found in title and body", found.length === 2 && found.includes("F-2026-08-SEC-web-01") && found.includes("F-2026-08-PRV-ios-02"), JSON.stringify(found));

const hyphenated = mentionedFindings(ev("", "F-2026-08-A11Y-cross-surface-03 is gone."));
check("a hyphenated surface and domain survive", hyphenated[0] === "F-2026-08-A11Y-cross-surface-03", JSON.stringify(hyphenated));

const deduped = mentionedFindings(ev("F-2026-08-SEC-web-01", "F-2026-08-SEC-web-01 again"));
check("deduped", deduped.length === 1, JSON.stringify(deduped));

const nearMisses = mentionedFindings(ev("", "F-nope, F-2026-08-SEC-web-, F-2026-08-SEC-web-1 and Format-99"));
check("near misses rejected", nearMisses.length === 0, JSON.stringify(nearMisses));

check("isFindingId accepts the minted shape", isFindingId("F-2026-08-SEC-web-01"));
check("isFindingId rejects a one-digit counter", !isFindingId("F-2026-08-SEC-web-1"));
check("isFindingId rejects too few segments", !isFindingId("F-2026-SEC-01"));

// Attacker-influenced input: a PR body is up to 2 MB and anyone can open one
// from a fork. The grammar must be linear, so a body of pathological `F-`
// repetitions has to finish in well under a second.
const hostile = "F-".repeat(200000);
const start = Date.now();
mentionedFindings(ev("", hostile));
const elapsed = Date.now() - start;
check("a pathological body parses in bounded time", elapsed < 1000, `${elapsed}ms`);

// --- closing references ------------------------------------------------------

for (const keyword of ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"]) {
  const refs = closedIssues(ev("", `${keyword} #12`));
  check(`"${keyword} #12" recognised`, refs.length === 1 && refs[0].repo === REPO && refs[0].number === 12, JSON.stringify(refs));
}

const crossRepo = closedIssues(ev("", "Fixes other/repo#7"));
check("owner/repo#N keeps its own repo", crossRepo.length === 1 && crossRepo[0].repo === "other/repo" && crossRepo[0].number === 7, JSON.stringify(crossRepo));

const urlForm = closedIssues(ev("", "Resolves https://github.com/acme/notes-app/issues/44"));
check("the full URL form is recognised", urlForm.length === 1 && urlForm[0].number === 44, JSON.stringify(urlForm));

const notClosing = closedIssues(ev("", "See #12 and related to #13"));
check("a bare # with no keyword is not a closure", notClosing.length === 0, JSON.stringify(notClosing));

// --- parseIssueRef -----------------------------------------------------------

check("parseIssueRef reads a plain URL", JSON.stringify(parseIssueRef("https://github.com/acme/notes-app/issues/44")) === JSON.stringify({ repo: "acme/notes-app", number: 44 }));
check("a trailing slash does not break the match", parseIssueRef("https://github.com/acme/notes-app/issues/44/")?.number === 44);
check("http and www are tolerated", parseIssueRef("http://www.github.com/acme/notes-app/issues/44")?.number === 44);
check("case is normalised", parseIssueRef("https://github.com/ACME/Notes-App/issues/44")?.repo === "acme/notes-app");
check("a pull URL is not an issue", parseIssueRef("https://github.com/acme/notes-app/pull/44") === undefined);
check("junk is undefined", parseIssueRef("not a url") === undefined);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node tests/services/quality-webhook.test.js`
Expected: it throws — `ENOENT ... quality-parse.ts`.

- [ ] **Step 4: Write the implementation**

`lib/services/github/quality-parse.ts`:

```ts
// The Kritik resolution grammar (issue #382 phase E, RFC § 3.4): what a merged
// pull request says about the findings it closed. Pure — parsing only, no I/O,
// and no value imports at all, which is what lets the suite load it with a
// bare transpile.
//
// TWO CHANNELS, because two kinds of author write these PRs. An agent working
// from `arkaik kritik issue` quotes the finding id, which is exactly why
// `mintFindingId` made it quotable. A person working from the filed GitHub
// issue writes `Closes #123` and never sees a finding id at all. Reading only
// one channel would leave half the loop silent.
//
// LINEAR BY CONSTRUCTION, for the reason `pull-request.ts` says: a PR body is
// attacker-influenced input (anyone can open one from a fork) and may be 2 MB.
// Every quantifier below is bounded and none is followed by something it can
// backtrack against.
import type { PullRequestEvent } from "./pull-request";

/** A GitHub issue, reduced to the pair that identifies it. */
export interface IssueRef {
  /** `owner/repo`, lowercased — GitHub treats these case-insensitively. */
  repo: string;
  number: number;
}

/**
 * A CANDIDATE finding token, not a finding id.
 *
 * A finding id is `F-<audit>-<DOMAIN>-<surface>-NN` and every part but the
 * first is variable-length and may itself contain hyphens — `2026-08` and
 * `cross-surface` both do. A regex that decomposed that would need a quantifier
 * followed by `-\d{2,}`, and a body full of `F-` prefixes would make it
 * backtrack quadratically. So the regex recognises a bounded token with nothing
 * ambiguous after it, and {@link isFindingId} — plain string work that cannot
 * backtrack — decides whether the token is really an id.
 */
const FINDING_TOKEN = /\bF-[A-Za-z0-9-]{3,80}\b/g;

/** GitHub's own closing keywords, then `#12`, `owner/repo#12`, or the full URL. */
const CLOSING_REFERENCE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[\s:]{1,20}(?:https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]{1,64})\/([A-Za-z0-9._-]{1,64})\/issues\/|([A-Za-z0-9._-]{1,64})\/([A-Za-z0-9._-]{1,64})#|#)(\d{1,9})\b/gi;

/** A full issue URL, tolerant of scheme, `www.`, and anything after the number. */
const ISSUE_URL =
  /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]{1,64})\/([A-Za-z0-9._-]{1,64})\/issues\/(\d{1,9})(?:[/?#].*)?$/i;

/**
 * Is this token a finding id in the shape `mintFindingId` writes?
 *
 * `F-` plus an audit id, a domain code, a surface id and a zero-padded counter
 * — at least five segments even when the audit id carries no hyphen of its own,
 * and a counter of two digits or more. Deliberately not a regex: this is the
 * validation the regex above declined to do, and it must stay linear.
 */
export function isFindingId(token: string): boolean {
  const segments = token.split("-");
  if (segments.length < 5) return false;
  const counter = segments[segments.length - 1];
  if (counter.length < 2) return false;
  for (const character of counter) {
    if (character < "0" || character > "9") return false;
  }
  return true;
}

/** Finding ids named in a PR's title or body, deduped, in the order they appear. */
export function mentionedFindings(event: Pick<PullRequestEvent, "title" | "body">): string[] {
  const found = new Set<string>();
  for (const text of [event.title, event.body]) {
    if (!text) continue;
    for (const match of text.matchAll(FINDING_TOKEN)) {
      if (isFindingId(match[0])) found.add(match[0]);
    }
  }
  return [...found];
}

/**
 * Issues this PR claims to close. A bare `#12` takes the PR's own repository,
 * because that is what GitHub does with it; `owner/repo#12` keeps the one it
 * names, and so does a full URL.
 */
export function closedIssues(
  event: Pick<PullRequestEvent, "title" | "body" | "repoFullName">,
): IssueRef[] {
  const refs = new Map<string, IssueRef>();
  for (const text of [event.title, event.body]) {
    if (!text) continue;
    for (const match of text.matchAll(CLOSING_REFERENCE)) {
      const owner = match[1] ?? match[3];
      const name = match[2] ?? match[4];
      const repo = (owner !== undefined && name !== undefined ? `${owner}/${name}` : event.repoFullName).toLowerCase();
      const number = Number(match[5]);
      refs.set(`${repo}#${number}`, { repo, number });
    }
  }
  return [...refs.values()];
}

/**
 * A finding's `issue_url` as the pair that identifies it, or `undefined` when
 * it is not a GitHub issue URL at all.
 *
 * Matching parsed pairs rather than strings is the point: a trailing slash, a
 * `www.`, an `http` scheme or a differently-cased owner would each make a real
 * match miss if the two URLs were compared as text.
 */
export function parseIssueRef(url: string): IssueRef | undefined {
  const match = ISSUE_URL.exec(String(url ?? "").trim());
  if (!match) return undefined;
  return { repo: `${match[1]}/${match[2]}`.toLowerCase(), number: Number(match[3]) };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/services/quality-webhook.test.js`
Expected: every line `PASS`, exit 0.

- [ ] **Step 6: Register the suite**

In `package.json` `scripts`, after `"test:quality-ops"`:

```json
    "test:quality-webhook": "node tests/services/quality-webhook.test.js",
```

In `.github/workflows/ci.yml`, in the `build` job right after the `test:quality-ops` step:

```yaml
      # The webhook half of the quality loop — the mention grammar and the
      # resolution pass. DB-free on purpose: the grammar imports nothing and
      # the project read is injected, so a Postgres-less runner still gates it.
      - name: Kritik webhook tests (finding mentions, resolution pass)
        run: npm run test:quality-webhook
```

- [ ] **Step 7: Commit**

```bash
git add lib/services/github/quality-parse.ts tests/services/load-quality-parse.js tests/services/quality-webhook.test.js package.json .github/workflows/ci.yml
git commit -m "feat(quality): read a merged PR for the findings it closed"
```

---

## Task 2: The resolution pass

**Files:**
- Create: `lib/services/github/quality.ts`
- Modify: `tests/services/quality-webhook.test.js` (append)

- [ ] **Step 1: Write the failing test**

Remove the trailing `fs.rmSync(...)` / `process.exit(...)` pair added in Task 1 — the async block below now owns the exit — and append:

```js
// --- the resolution pass -----------------------------------------------------

const { applyQualityResolutions } = kritik;

const FINDING = (over = {}) => ({
  id: "F-2026-08-SEC-web-01",
  criterion_id: "SEC-01",
  surface: "web",
  title: "Anonymous read on the profiles table",
  detail: "d",
  evidence: "e",
  impact: 5,
  likelihood: 4,
  cost: "M",
  status: "open",
  ...over,
});

/** The injected seam: one project, whatever findings and events a case needs. */
function state({ findings = [FINDING()], resolvedIds = [] } = {}) {
  const appended = [];
  return {
    appended,
    readState: async () => [
      {
        projectId: "prj_1",
        findings,
        resolvedFindingIds: new Set(resolvedIds),
        append: async (events) => { appended.push(...events); return events.map((e) => e.id); },
      },
    ],
  };
}

const merged = (over = {}) => ({
  action: "closed",
  merged: true,
  repoFullName: REPO,
  number: 7,
  url: `https://github.com/${REPO}/pull/7`,
  title: "",
  body: "",
  state: "closed",
  installationId: null,
  ...over,
});

(async () => {
  const byId = state();
  const idOutcomes = await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-01." }), { readState: byId.readState });
  check("a finding named by id resolves", idOutcomes.some((o) => o.status === "resolved" && o.findingId === "F-2026-08-SEC-web-01"), JSON.stringify(idOutcomes));
  check("exactly one event is appended", byId.appended.length === 1 && byId.appended[0].type === "quality.finding.resolved", JSON.stringify(byId.appended));
  check("resolved_by is the PR url", byId.appended[0].resolved_by === `https://github.com/${REPO}/pull/7`, JSON.stringify(byId.appended[0]));
  check("the actor is the app", byId.appended[0].actor === "github-app", JSON.stringify(byId.appended[0]));

  const withNodes = state({ findings: [FINDING({ node_ids: ["V-profile"] })] });
  await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-01." }), { readState: withNodes.readState });
  check("node_ids ride along", JSON.stringify(withNodes.appended[0].node_ids) === JSON.stringify(["V-profile"]), JSON.stringify(withNodes.appended[0]));

  const byIssue = state({ findings: [FINDING({ issue_url: `https://github.com/${REPO}/issues/44/` })] });
  await applyQualityResolutions(merged({ body: "Closes #44" }), { readState: byIssue.readState });
  check("a finding matched by its issue resolves", byIssue.appended.length === 1, JSON.stringify(byIssue.appended));

  for (const status of ["refuted", "accepted-risk", "resolved"]) {
    const guarded = state({ findings: [FINDING({ status })] });
    const outcomes = await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-01." }), { readState: guarded.readState });
    check(`a ${status} finding is not re-resolved`, guarded.appended.length === 0 && outcomes.some((o) => o.status === "unchanged"), JSON.stringify(outcomes));
  }

  const already = state({ resolvedIds: ["F-2026-08-SEC-web-01"] });
  const secondMerge = await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-01." }), { readState: already.readState });
  check("a second merge appends nothing", already.appended.length === 0 && secondMerge.some((o) => o.status === "unchanged"), JSON.stringify(secondMerge));

  const typo = state();
  const unknown = await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-99." }), { readState: typo.readState });
  check("an unmatched id is reported, not swallowed", typo.appended.length === 0 && unknown.some((o) => o.status === "unknown" && o.findingId === "F-2026-08-SEC-web-99"), JSON.stringify(unknown));

  const silent = state();
  const none = await applyQualityResolutions(merged({ body: "Just a refactor." }), { readState: silent.readState });
  check("a PR naming nothing reads no project at all", none.length === 1 && none[0].status === "no_mentions", JSON.stringify(none));

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/services/quality-webhook.test.js`
Expected: the grammar assertions PASS, then `TypeError: applyQualityResolutions is not a function`.

- [ ] **Step 3: Write the implementation**

`lib/services/github/quality.ts`:

```ts
import "server-only";

import { findingResolvedInput, isOpenFinding, makeEvent, type JournalEvent, type QualityFinding } from "@arkaik/schema";

import { query } from "@/lib/services/db";
import { appendJournalEvents } from "@/lib/services/graph/store";
import { closedIssues, mentionedFindings, parseIssueRef } from "@/lib/services/github/quality-parse";
import { linkedProjects, ownerIdsFor, type PullRequestEvent } from "@/lib/services/github/pull-request";

/**
 * The Kritik half of a merged-PR delivery (issue #382 phase E, RFC § 3.4).
 *
 * The third half beside acceptance promotion and the Lab Note, and independent
 * of both by the same design: a finding that cannot be matched never blocks a
 * status transition or a note, and vice versa. Problems are OUTCOMES; only
 * infrastructure failures throw, so the webhook's claim-release/retry covers
 * them — and the already-resolved check below makes that retry safe.
 *
 * **This appends, and appends only.** The finding's stored `status` stays as
 * the last audit left it; `foldResolvedFindings` (lib/utils/quality.ts) is what
 * makes the resolution visible on every read. RFC § 3.2 said so first: current
 * state is a projection, latest audit plus open-minus-resolved.
 */
export type QualityResolutionOutcome =
  | { projectId: string; status: "resolved"; findingId: string; eventId: string }
  | { projectId: string; status: "unchanged"; findingId: string }
  | { projectId: string; status: "unknown"; findingId: string }
  | { status: "no_mentions" };

/** One project's quality state, and the way to write back to it. */
export interface ProjectQualityState {
  projectId: string;
  findings: QualityFinding[];
  /** Findings a `quality.finding.resolved` already names. */
  resolvedFindingIds: Set<string>;
  append: (events: JournalEvent[]) => Promise<string[]>;
}

/**
 * The one seam this module has. Injected by the suite for the same reason
 * `applyPullRequestEvent` injects `fetchFiles`: the whole pass is then pinned
 * without a database, which is what keeps it in CI's fast job.
 */
export type ReadProjectQualityState = (event: PullRequestEvent) => Promise<ProjectQualityState[]>;

export async function applyQualityResolutions(
  event: PullRequestEvent,
  options: { readState?: ReadProjectQualityState } = {},
): Promise<QualityResolutionOutcome[]> {
  const mentioned = mentionedFindings(event);
  const issues = closedIssues(event);
  // Read nothing when the PR claims nothing. The overwhelming majority of
  // merges are this case, and a database round trip per project to discover it
  // would be a cost paid on every delivery for the rare one.
  if (mentioned.length === 0 && issues.length === 0) return [{ status: "no_mentions" }];

  const issueKeys = new Set(issues.map((ref) => `${ref.repo}#${ref.number}`));
  const readState = options.readState ?? loadProjectQualityState;
  const outcomes: QualityResolutionOutcome[] = [];

  for (const state of await readState(event)) {
    const byId = new Map(state.findings.map((finding) => [finding.id, finding]));
    const matched = new Map<string, QualityFinding>();

    for (const id of mentioned) {
      const finding = byId.get(id);
      if (finding === undefined) {
        outcomes.push({ projectId: state.projectId, status: "unknown", findingId: id });
        continue;
      }
      matched.set(finding.id, finding);
    }
    for (const finding of state.findings) {
      if (typeof finding.issue_url !== "string") continue;
      const ref = parseIssueRef(finding.issue_url);
      if (ref !== undefined && issueKeys.has(`${ref.repo}#${ref.number}`)) matched.set(finding.id, finding);
    }

    const events: JournalEvent[] = [];
    const resolving: string[] = [];
    for (const finding of matched.values()) {
      // `refuted` and `accepted-risk` are decisions somebody recorded, not
      // defects waiting to be closed, and `resolved` is already done. Only an
      // open finding can be closed by a merge.
      if (!isOpenFinding(finding) || state.resolvedFindingIds.has(finding.id)) {
        outcomes.push({ projectId: state.projectId, status: "unchanged", findingId: finding.id });
        continue;
      }
      const input = findingResolvedInput(finding, event.url);
      events.push(makeEvent(input.type, input.payload, { actor: "github-app" }));
      resolving.push(finding.id);
    }

    if (events.length === 0) continue;
    const eventIds = await state.append(events);
    resolving.forEach((findingId, index) => {
      outcomes.push({ projectId: state.projectId, status: "resolved", findingId, eventId: eventIds[index] });
    });
  }

  return outcomes.length > 0 ? outcomes : [{ status: "no_mentions" }];
}

/**
 * The production seam: one state per linked PROJECT, deduped the way
 * `applyLabNote` dedupes — a monorepo's several path-scoped links to one
 * repository still produce exactly one pass, because a finding is project-level
 * and path scoping gates promotions, not quality.
 *
 * The snapshot is read UNFOLDED on purpose. `store.getProject` returns what
 * Postgres holds, which is what this pass must compare against; the fold is a
 * read projection for the app and has no business in a write path.
 */
const loadProjectQualityState: ReadProjectQualityState = async (event) => {
  const projectIds = [...new Set((await linkedProjects(event.repoFullName)).map((row) => row.projectId))];
  const states: ProjectQualityState[] = [];

  for (const projectId of projectIds) {
    const { rows: snapshots } = await query<{ findings: QualityFinding[] | null }>(
      `select snapshot->'quality'->'findings' as findings from graph_projects where id = $1 and archived_at is null`,
      [projectId],
    );
    const findings = Array.isArray(snapshots[0]?.findings) ? snapshots[0].findings : [];
    if (findings.length === 0) continue;

    const { rows: resolved } = await query<{ finding_id: string }>(
      `select event->>'finding_id' as finding_id from graph_events
        where project_id = $1 and event->>'type' = 'quality.finding.resolved'`,
      [projectId],
    );

    states.push({
      projectId,
      findings,
      resolvedFindingIds: new Set(resolved.map((row) => row.finding_id).filter((id): id is string => typeof id === "string")),
      append: async (events) => {
        const ownerIds = await ownerIdsFor(projectId);
        const result = await appendJournalEvents(projectId, ownerIds, events, "github-app");
        if (!result.ok) {
          console.warn(`[quality] ${projectId}: append refused (${result.reason})`);
          return [];
        }
        return events.map((journalEvent) => journalEvent.id);
      },
    });
  }

  return states;
};
```

Note: a refused append returns `[]`, so `eventIds[index]` is `undefined` for those. That is deliberate — the outcome still reports the attempt, exactly as `applyLabNote` reports `unchanged` on a refusal.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/services/quality-webhook.test.js`
Expected: every line `PASS`, exit 0.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in the two new files.

- [ ] **Step 6: Commit**

```bash
git add lib/services/github/quality.ts tests/services/load-quality-parse.js tests/services/quality-webhook.test.js
git commit -m "feat(quality): resolve a finding when the PR that fixes it merges"
```

---

## Task 3: Wire the webhook route

**Files:**
- Modify: `app/api/github/webhook/route.ts`

- [ ] **Step 1: Add the import**

After the `applyLabNote` import:

```ts
import { applyQualityResolutions } from "@/lib/services/github/quality";
```

- [ ] **Step 2: Call it beside the Lab Note half**

Replace the `labNotes` assignment inside the `try` block:

```ts
    const outcomes = await applyPullRequestEvent(prEvent);
    // The Lab-Note and Kritik halves run only for a merge, inside the same try:
    // a transient failure releases the delivery claim and the retry redoes all
    // three — all three are idempotent (promotions by construction, notes by
    // content dedupe, resolutions by the already-resolved check). Parse
    // refusals are outcomes, never throws.
    const isMerge = prEvent.action === "closed" && prEvent.merged;
    const labNotes = isMerge ? await applyLabNote(prEvent) : [];
    const quality = isMerge ? await applyQualityResolutions(prEvent) : [];
```

Then add `quality` to both response bodies in that block:

```ts
      return Response.json(
        { status: "ok", outcomes, labNotes, quality, skipped: `no project has linked ${prEvent.repoFullName}` },
        { status: 200 },
      );
    }
    return Response.json({ status: "ok", outcomes, labNotes, quality }, { status: 200 });
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint app/api/github/webhook/route.ts lib/services/github/quality.ts lib/services/github/quality-parse.ts`
Expected: no errors. CI's build job fails on any eslint error.

- [ ] **Step 4: Commit**

```bash
git add app/api/github/webhook/route.ts
git commit -m "feat(quality): run the resolution pass on every merged PR"
```

---

## Task 4: The fold

**Files:**
- Modify: `lib/utils/quality.ts`
- Modify: `tests/app/quality.test.js`

- [ ] **Step 1: Write the failing test**

Read `tests/app/quality.test.js` first and match its `check` helper and destructuring style. Add `foldResolvedFindings` and `buildNodeFindingIndex` to the destructuring at the top if they are not already there, then append before its cleanup/exit lines:

```js
// --- the fold (phase E) ------------------------------------------------------

const RESOLVED_EVENT = (findingId, over = {}) => ({
  id: `01J${findingId}`,
  ts: "2026-09-01T00:00:00.000Z",
  type: "quality.finding.resolved",
  finding_id: findingId,
  resolved_by: "https://github.com/acme/app/pull/7",
  ...over,
});

const foldSection = (findings) => ({
  framework_version: "0.1.0",
  profile: { surfaces: [{ id: "web", title: "Web" }] },
  assessments: [{ criterion_id: "SEC-01", surface: "web", level: 3, evidence: "e", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" }],
  findings,
});

const openCritical = { id: "F-1", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 5, likelihood: 5, cost: "M", status: "open" };

const untouched = foldSection([openCritical]);
check("no matching event returns the SAME object", foldResolvedFindings(untouched, [RESOLVED_EVENT("F-other")]) === untouched);
check("an empty journal returns the same object", foldResolvedFindings(untouched, []) === untouched);
check("an undefined section stays undefined", foldResolvedFindings(undefined, [RESOLVED_EVENT("F-1")]) === undefined);

const folded = foldResolvedFindings(foldSection([openCritical]), [RESOLVED_EVENT("F-1")]);
check("a matched finding reads resolved", folded.findings[0].status === "resolved", JSON.stringify(folded.findings[0]));
check("resolved_by lands on the finding", folded.findings[0].resolved_by === "https://github.com/acme/app/pull/7");
check("the input was not mutated", openCritical.status === "open");

for (const status of ["refuted", "accepted-risk"]) {
  const decided = foldResolvedFindings(foldSection([{ ...openCritical, status }]), [RESOLVED_EVENT("F-1")]);
  check(`a ${status} finding survives the fold`, decided.findings[0].status === status);
}

const noUrl = foldResolvedFindings(foldSection([openCritical]), [RESOLVED_EVENT("F-1", { resolved_by: undefined })]);
check("no resolved_by on the event leaves none on the finding", noUrl.findings[0].resolved_by === undefined);

// The pair that makes the fold matter: a capped cell uncaps, and the node
// badge clears, once the Critical behind them is folded resolved.
const badged = { ...openCritical, node_ids: ["V-home"] };
const before = deriveQualityMatrix({ quality: foldSection([badged]) });
const after = deriveQualityMatrix({ quality: foldResolvedFindings(foldSection([badged]), [RESOLVED_EVENT("F-1")]) });
check("the cap lifts once the Critical resolves", before.matrix.SEC.web.capped === true && after.matrix.SEC.web.capped === false, `${JSON.stringify(before.matrix.SEC.web)} -> ${JSON.stringify(after.matrix.SEC.web)}`);
check("the node badge clears", buildNodeFindingIndex(foldSection([badged])).size === 1 && buildNodeFindingIndex(foldResolvedFindings(foldSection([badged]), [RESOLVED_EVENT("F-1")])).size === 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/app/quality.test.js`
Expected: `TypeError: foldResolvedFindings is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/utils/quality.ts`, adding `isOpenFinding` and the `JournalEvent` / `QualityFinding` / `QualitySection` types to its existing `@arkaik/schema` import:

```ts
/**
 * Fold `quality.finding.resolved` over a stored section (issue #382 phase E).
 *
 * The webhook appends, and appends only: a merged PR that fixes a finding
 * writes a journal fact, and the finding's stored `status` stays exactly as the
 * last audit left it. This is the projection that makes the fact visible, and
 * it is the reading RFC § 3.2 declared from the start — current state is the
 * latest audit plus open-minus-resolved.
 *
 * Returns the section BY REFERENCE when nothing matches. That is the
 * overwhelmingly common case — every project with no resolution since its last
 * audit — and returning the same object means no allocation, no changed memo
 * identity, and no re-render for the reader who gained nothing.
 *
 * `refuted` and `accepted-risk` are left alone, for the reason the webhook
 * refuses to resolve one: they are decisions somebody recorded. An event naming
 * a finding the section does not hold is ignored — `validateBundle` already
 * warns about that class, and a read projection is not the place to raise it
 * a second time.
 */
export function foldResolvedFindings(
  section: QualitySection | undefined,
  events: readonly JournalEvent[],
): QualitySection | undefined {
  if (section === undefined) return undefined;
  const findings = Array.isArray(section.findings) ? section.findings : [];
  if (findings.length === 0 || events.length === 0) return section;

  const resolvedBy = new Map<string, string | undefined>();
  for (const event of events) {
    if (event?.type !== "quality.finding.resolved") continue;
    const findingId = (event as { finding_id?: unknown }).finding_id;
    if (typeof findingId !== "string" || findingId === "") continue;
    const by = (event as { resolved_by?: unknown }).resolved_by;
    // Latest wins: a re-resolution names the PR that actually landed it.
    resolvedBy.set(findingId, typeof by === "string" && by !== "" ? by : undefined);
  }
  if (resolvedBy.size === 0) return section;

  let changed = false;
  const next = findings.map((finding) => {
    if (!isOpenFinding(finding) || !resolvedBy.has(finding.id)) return finding;
    changed = true;
    const by = resolvedBy.get(finding.id);
    return {
      ...finding,
      status: "resolved" as QualityFinding["status"],
      ...(by !== undefined ? { resolved_by: by } : {}),
    };
  });

  return changed ? { ...section, findings: next } : section;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/app/quality.test.js`
Expected: every line `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/quality.ts tests/app/quality.test.js
git commit -m "feat(quality): fold resolved findings over the stored section"
```

---

## Task 5: Apply the fold where a bundle is assembled

**Files:**
- Modify: `lib/services/graph/store.ts`
- Modify: `app/api/graph/projects/[projectId]/route.ts:35`
- Modify: `lib/data/local-provider.ts:151-158`

- [ ] **Step 1: Add the narrow store read**

In `lib/services/graph/store.ts`, beside `getJournal`. Read `getJournal` immediately above it first and match its owner-scoping clause exactly — the scoping must be identical, not merely similar:

```ts
/**
 * A project's `quality.finding.resolved` events, and nothing else.
 *
 * The Quality surfaces need these to fold resolutions over the stored findings
 * (lib/utils/quality.ts), and a project's full history is the wrong price for a
 * handful of events — the Pebbles journal alone runs to thousands of rows.
 */
export async function qualityResolutionEvents(
  projectId: string,
  ownerIds: readonly string[],
): Promise<JournalEvent[]> {
  const { rows } = await query<{ event: JournalEvent }>(
    `select e.event from graph_events e
       join graph_projects p on p.id = e.project_id
      where e.project_id = $1 and p.owner_id = any($2)
        and e.event->>'type' = 'quality.finding.resolved'
      order by e.seq asc`,
    [projectId, ownerIds as string[]],
  );
  return rows.map((row) => row.event);
}
```

- [ ] **Step 2: Fold on the hosted GET**

In `app/api/graph/projects/[projectId]/route.ts`, replace the `getProject` block. Keep whatever headers or options the existing `Response.json` call passes; only the body's `bundle` changes.

```ts
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    // The app's read, and the only one that folds. `store.getProject` returns
    // what Postgres holds because its other callers — the acceptance planner in
    // pull-request.ts, the pollen feed — must see exactly that; a derived
    // finding status inside the object a mutation is planned from is one
    // refactor away from being written back as though it had been stored.
    const quality = foldResolvedFindings(
      (found.bundle as { quality?: QualitySection }).quality,
      await qualityResolutionEvents(projectId, caller.ownerIds),
    );
    const bundle =
      quality === (found.bundle as { quality?: QualitySection }).quality
        ? found.bundle
        : { ...found.bundle, quality };
    return Response.json({ bundle, version: found.version }, ...);
```

`SnapshotShape` does not declare `quality` — phase D recorded that as deliberate — hence the cast. Import `foldResolvedFindings` from `@/lib/utils/quality`, `qualityResolutionEvents` from `@/lib/services/graph/store`, and `type QualitySection` from `@arkaik/schema`.

- [ ] **Step 3: Fold in the local provider**

In `lib/data/local-provider.ts`:

```ts
  async getProject(id: string) {
    const db = await getDb();
    if (!db) return undefined;
    const record = await db.projects.get(id);
    if (!record) return undefined;
    const journalRow = await db.journals.get(id);
    const bundle = assembleBundle(record.snapshot, journalRow?.events);
    // Same projection the hosted read applies, from the journal this provider
    // already holds. A local project receives no webhook, but it does receive
    // imported bundles whose journals carry resolutions — and the two providers
    // must not disagree about what a bundle says.
    const quality = foldResolvedFindings(bundle.quality, journalRow?.events ?? []);
    return quality === bundle.quality ? bundle : { ...bundle, quality };
  },
```

Import `foldResolvedFindings` from `@/lib/utils/quality`.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint lib/services/graph/store.ts lib/data/local-provider.ts "app/api/graph/projects/[projectId]/route.ts"`
Expected: no errors.

- [ ] **Step 5: Run the suites this could break**

Run: `node tests/app/quality.test.js && npm run test:graph-api`
Expected: PASS, or a clean skip from `test:graph-api` when Postgres is absent.

- [ ] **Step 6: Commit**

```bash
git add lib/services/graph/store.ts lib/data/local-provider.ts "app/api/graph/projects/[projectId]/route.ts"
git commit -m "feat(quality): serve findings with their resolutions folded in"
```

---

## Task 6: `detectRegressions`

**Files:**
- Create: `packages/schema/src/quality-regressions.ts`
- Create: `tests/schema/quality-regressions.test.js`
- Modify: `packages/schema/src/index.ts:22`

- [ ] **Step 1: Write the failing test**

`tests/schema/quality-regressions.test.js`:

```js
#!/usr/bin/env node

/**
 * Regression detection between two Kritik audits (issue #382 phase E).
 *
 * Pure and DB-free — the module imports nothing at runtime but ./quality — so
 * this runs in CI's fast build job beside the other quality suites.
 *
 * THE PACK BELOW IS NOT THE DEFAULT ONE, and that is the point. The shipped
 * pack's severity buckets are byte-identical to DEFAULT_SEVERITY_BUCKETS, so a
 * suite that scored against it could not tell "reads the pack's scales" from
 * "hardcodes the schema defaults" — a hole that survived from phase A to phase
 * D unnoticed. Scoring against retuned buckets is what makes the provenance
 * assertion real.
 */

const { loadSchema } = require("./load-schema");
const { detectRegressions, REGRESSION_SIGNALS } = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Critical starts at 9 here, not 20: `impact 3 x likelihood 3` is Critical
// under this pack and Medium under the schema defaults.
const RETUNED = {
  version: "test-1.0",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [{ id: "SEC-01", domain: "SEC", weight: 1 }],
  scales: { severity_buckets: { critical: [9, 25], high: [6, 8], medium: [3, 5], low: [2, 2], info: [1, 1] } },
};
const DEFAULTS = {
  version: "test-defaults",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [{ id: "SEC-01", domain: "SEC", weight: 1 }],
};

const assess = (criterion, surface, level, audit) => ({
  criterion_id: criterion, surface, level, evidence: "e", audit_id: audit, ts: `${audit}-01T00:00:00.000Z`,
});
const find = (id, over = {}) => ({
  id, criterion_id: "SEC-01", surface: "web", title: `t ${id}`, detail: "d", evidence: "e",
  impact: 3, likelihood: 3, cost: "M", status: "open", ...over,
});

// --- level-drop --------------------------------------------------------------

const dropped = detectRegressions(
  { assessments: [assess("SEC-01", "web", 3, "2026-08")], findings: [] },
  { assessments: [assess("SEC-01", "web", 2, "2026-09")], findings: [] },
  RETUNED,
);
check("a level drop is a regression", dropped.length === 1 && dropped[0].kind === "level-drop", JSON.stringify(dropped));
check("the detail names both levels and both audits", dropped[0]?.detail === "level 3 → 2 (2026-08 → 2026-09)", dropped[0]?.detail);
check("the signal is the statement that no longer holds", dropped[0]?.signal === REGRESSION_SIGNALS["level-drop"]);

const climbed = detectRegressions(
  { assessments: [assess("SEC-01", "web", 2, "2026-08")], findings: [] },
  { assessments: [assess("SEC-01", "web", 3, "2026-09")], findings: [] },
  RETUNED,
);
check("an improvement is not a regression", climbed.length === 0, JSON.stringify(climbed));

// --- the guard, and its exemption -------------------------------------------

const unscored = detectRegressions(
  { assessments: [], findings: [] },
  { assessments: [assess("SEC-01", "web", 1, "2026-09")], findings: [find("F-1")] },
  RETUNED,
);
check("a cell scored in only one audit fires nothing", unscored.length === 0, JSON.stringify(unscored));

const reopened = detectRegressions(
  { assessments: [], findings: [find("F-1", { status: "resolved" })] },
  { assessments: [], findings: [find("F-1", { status: "open" })] },
  RETUNED,
);
check("a reopen fires with no cell reading at all", reopened.length === 1 && reopened[0].kind === "reopened-finding", JSON.stringify(reopened));
check("the reopen detail quotes the title", reopened[0]?.detail.includes("t F-1"), reopened[0]?.detail);

// --- new-severe-finding, scored against the RETUNED pack ---------------------

const both = [assess("SEC-01", "web", 3, "2026-08")];
const bothNext = [assess("SEC-01", "web", 3, "2026-09")];

const severe = detectRegressions(
  { assessments: both, findings: [] },
  { assessments: bothNext, findings: [find("F-2")] },
  RETUNED,
);
check("a new Critical on a comparable cell is a regression", severe.length === 1 && severe[0].kind === "new-severe-finding", JSON.stringify(severe));
check("the detail carries the pack's severity", severe[0]?.detail.includes("critical"), severe[0]?.detail);

// The provenance assertion: impact 3 x likelihood 3 is 9 — Critical under
// RETUNED, Medium under the schema defaults. A mutant that hardcodes the
// defaults reports nothing here.
const defaults = detectRegressions(
  { assessments: both, findings: [] },
  { assessments: bothNext, findings: [find("F-2")] },
  DEFAULTS,
);
check("the same finding is NOT severe under the default buckets", defaults.length === 0, JSON.stringify(defaults));

const carried = detectRegressions(
  { assessments: both, findings: [find("F-2")] },
  { assessments: bothNext, findings: [find("F-2")] },
  RETUNED,
);
check("a Critical carried forward is not re-reported", carried.length === 0, JSON.stringify(carried));

// --- every kind together -----------------------------------------------------

const all = detectRegressions(
  { assessments: both, findings: [find("F-3", { status: "resolved" })] },
  { assessments: [assess("SEC-01", "web", 1, "2026-09")], findings: [find("F-3"), find("F-4")] },
  RETUNED,
);
check("every kind fires together", new Set(all.map((r) => r.kind)).size === 3, JSON.stringify(all.map((r) => r.kind)));
check("every regression carries a cell", all.every((r) => r.criterion_id === "SEC-01" && r.surface === "web"), JSON.stringify(all));

process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/schema/quality-regressions.test.js`
Expected: `TypeError: detectRegressions is not a function`.

- [ ] **Step 3: Write the implementation**

`packages/schema/src/quality-regressions.ts`:

```ts
/**
 * Regression detection between two Kritik audits (issue #382 phase E, RFC
 * § 8.6's deferred half).
 *
 * `signals` prints a run sheet and does not execute one — that decision stands.
 * This is the other half it deferred: two audits' stored state compared, so
 * drift between them announces itself instead of waiting to be noticed on the
 * third look. Each regression becomes one `quality.signal.tripped`, which is
 * why every kind here is criterion-scoped: that event's payload requires a
 * `criterion_id` and a `surface`, and a domain-level drop has neither.
 *
 * Same two disciplines as `quality.ts` and `quality-ops.ts`: zod-free and
 * fs-free (the only imports are types and pure functions from `./quality`), and
 * nothing mutates its input.
 *
 * A tripped signal is not a finding. It is the prompt to go look — cheap,
 * frequent, allowed to be wrong — where a finding is expensive, rare, and has
 * survived an adversarial pass. Nothing here opens anything.
 */

import {
  isOpenFinding,
  severityOf,
  type KritikLibrary,
  type QualityAssessment,
  type QualityFinding,
  type QualitySection,
} from "./quality";

export type RegressionKind = "level-drop" | "new-severe-finding" | "reopened-finding";

/**
 * The statement that no longer holds, per kind — what the trip event carries in
 * its `signal` field. A pack's own `signals[]` are statements to check; these
 * are the three the framework itself asserts across audits.
 */
export const REGRESSION_SIGNALS: Readonly<Record<RegressionKind, string>> = {
  "level-drop": "maturity on this cell does not regress",
  "new-severe-finding": "no open Critical or High finding on this cell",
  "reopened-finding": "a resolved finding stays resolved",
};

export interface Regression {
  kind: RegressionKind;
  criterion_id: string;
  surface: string;
  signal: string;
  detail: string;
}

/** The half of an audit this compares — what `loadQualitySection` returns. */
export type AuditState = Pick<QualitySection, "assessments" | "findings">;

/** `::` cannot appear in a criterion id or a surface id, so it cannot collide. */
const cellKey = (criterionId: string, surface: string): string => `${criterionId}::${surface}`;

const rowsOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

function assessmentsByCell(state: AuditState): Map<string, QualityAssessment> {
  const cells = new Map<string, QualityAssessment>();
  for (const assessment of rowsOf<QualityAssessment>(state?.assessments)) {
    if (typeof assessment?.criterion_id !== "string" || typeof assessment?.surface !== "string") continue;
    cells.set(cellKey(assessment.criterion_id, assessment.surface), assessment);
  }
  return cells;
}

/** Open Critical/High findings per cell, ranked by the pack in force. */
function severeByCell(state: AuditState, library?: KritikLibrary): Map<string, QualityFinding[]> {
  const cells = new Map<string, QualityFinding[]>();
  for (const finding of rowsOf<QualityFinding>(state?.findings)) {
    if (typeof finding?.criterion_id !== "string" || typeof finding?.surface !== "string") continue;
    if (!isOpenFinding(finding)) continue;
    const severity = severityOf(finding, library);
    if (severity !== "critical" && severity !== "high") continue;
    const key = cellKey(finding.criterion_id, finding.surface);
    const existing = cells.get(key);
    if (existing === undefined) cells.set(key, [finding]);
    else existing.push(finding);
  }
  return cells;
}

/**
 * What got worse between two audits.
 *
 * `previous` and `next` are two audits' stored state, oldest first. The order
 * matters and is not inferred: an audit id is a convention, not a guarantee,
 * and guessing which reading came first would silently invert every verdict.
 *
 * **The guard.** `level-drop` and `new-severe-finding` each compare a cell to
 * itself, so both require the cell to be scored in BOTH audits. Without it a
 * half-finished audit fires a trip for every cell it has not reached yet —
 * hundreds of them, all meaning "not scored yet", which is the fastest way to
 * teach a reader to ignore the runner. `reopened-finding` compares a finding to
 * itself and needs no cell reading at all, so the guard does not apply to it: a
 * finding that came back matters whether or not its cell was re-scored.
 *
 * `cross-surface` needs no special case. Findings legitimately carry it, so a
 * contract finding that reopens is reported like any other; assessments on it
 * are already refused upstream, so a level drop there cannot arise.
 */
export function detectRegressions(
  previous: AuditState,
  next: AuditState,
  library?: KritikLibrary,
): Regression[] {
  const before = assessmentsByCell(previous);
  const after = assessmentsByCell(next);
  const comparable = (key: string): boolean => before.has(key) && after.has(key);
  const regressions: Regression[] = [];

  for (const [key, current] of after) {
    const earlier = before.get(key);
    if (earlier === undefined) continue;
    if (!(Number(current.level) < Number(earlier.level))) continue;
    regressions.push({
      kind: "level-drop",
      criterion_id: current.criterion_id,
      surface: current.surface,
      signal: REGRESSION_SIGNALS["level-drop"],
      detail: `level ${earlier.level} → ${current.level} (${earlier.audit_id} → ${current.audit_id})`,
    });
  }

  const severeBefore = severeByCell(previous, library);
  for (const [key, findings] of severeByCell(next, library)) {
    if (!comparable(key)) continue;
    if ((severeBefore.get(key) ?? []).length > 0) continue;
    for (const finding of findings) {
      regressions.push({
        kind: "new-severe-finding",
        criterion_id: finding.criterion_id,
        surface: finding.surface,
        signal: REGRESSION_SIGNALS["new-severe-finding"],
        detail: `${finding.id} — ${severityOf(finding, library)} (impact ${finding.impact} × likelihood ${finding.likelihood})`,
      });
    }
  }

  const resolvedBefore = new Set(
    rowsOf<QualityFinding>(previous?.findings)
      .filter((finding) => finding?.status === "resolved")
      .map((finding) => finding.id),
  );
  for (const finding of rowsOf<QualityFinding>(next?.findings)) {
    if (!isOpenFinding(finding) || !resolvedBefore.has(finding.id)) continue;
    regressions.push({
      kind: "reopened-finding",
      criterion_id: finding.criterion_id,
      surface: finding.surface,
      signal: REGRESSION_SIGNALS["reopened-finding"],
      detail: `${finding.id} — "${finding.title}"`,
    });
  }

  return regressions;
}
```

- [ ] **Step 4: Export it**

In `packages/schema/src/index.ts`, after `export * from "./quality-ops";`:

```ts
export * from "./quality-regressions";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/schema/quality-regressions.test.js`
Expected: every line `PASS`, exit 0.

- [ ] **Step 6: Register the suite**

`package.json`, after `"test:quality-ops"`:

```json
    "test:quality-regressions": "node tests/schema/quality-regressions.test.js",
```

`.github/workflows/ci.yml`, after the `test:quality-ops` step:

```yaml
      # Two audits compared. Scored against a pack whose severity buckets are
      # deliberately NOT the schema defaults, so the suite can tell "reads the
      # pack" from "hardcodes 20..25" — the hole that survived phases A to D.
      - name: Kritik regression tests (level drops, new severity, reopens)
        run: npm run test:quality-regressions
```

- [ ] **Step 7: Commit**

```bash
git add packages/schema/src/quality-regressions.ts packages/schema/src/index.ts tests/schema/quality-regressions.test.js package.json .github/workflows/ci.yml
git commit -m "feat(quality): compare two audits and name what got worse"
```

---

## Task 7: The `regressions` verb

**Files:**
- Modify: `packages/cli/src/commands/kritik.ts`
- Modify: `tests/cli/kritik.test.js`

- [ ] **Step 1: Write the failing test**

Read `tests/cli/kritik.test.js` first: it uses `run`, `check`, `journal()` and a `currentAudit` constant, and it has already scored `SEC-01 x web` by the point you are appending to. Append:

```js
// --- regressions (phase E) ---------------------------------------------------

// The suite's existing audit is `currentAudit`. Score the same cell lower in a
// second, later audit so there is something to regress.
const laterAudit = "2099-12";
run(["score", "SEC-01", "web", "1", "--evidence", "src/a.ts:1", "--audit", laterAudit]);

const unknownAudit = run(["regressions", "--from", "nope", "--to", laterAudit]);
check("an unknown audit is refused by name", unknownAudit.status === 1 && unknownAudit.stderr.includes("nope"), unknownAudit.stderr);

const compared = run(["regressions", "--from", currentAudit, "--to", laterAudit, "--json"]);
check("regressions exits 1 when something regressed", compared.status === 1, `status ${compared.status}`);
const parsed = JSON.parse(compared.stdout);
check("the level drop is reported", parsed.regressions.some((r) => r.kind === "level-drop" && r.criterion_id === "SEC-01"), compared.stdout);
check("the json names both audits", parsed.from === currentAudit && parsed.to === laterAudit, compared.stdout);

const recorded = run(["regressions", "--from", currentAudit, "--to", laterAudit, "--record"]);
check("--record exits 1 too", recorded.status === 1, `status ${recorded.status}`);
const trips = journal().filter((e) => e.type === "quality.signal.tripped");
check("one trip per regression", trips.length === parsed.regressions.length, JSON.stringify(trips.map((t) => t.criterion_id)));
check("the trip carries the cell and the statement", trips[0]?.surface === "web" && typeof trips[0]?.signal === "string" && trips[0].signal.length > 0, JSON.stringify(trips[0]));
check("the trip carries a detail", typeof trips[0]?.detail === "string" && trips[0].detail.includes("level"), JSON.stringify(trips[0]));

const sameTwice = run(["regressions", "--from", laterAudit, "--to", laterAudit]);
check("the same audit twice is refused", sameTwice.status === 1 && sameTwice.stderr.includes("two readings"), sameTwice.stderr);
```

If the suite has already recorded trips before this point, subtract that count rather than asserting on the total.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build -w arkaik && node tests/cli/kritik.test.js`
Expected: FAIL — `unknown subcommand "regressions"`.

- [ ] **Step 3: Add the usage block**

In `packages/cli/src/commands/kritik.ts`, after `SIGNALS_USAGE`:

```ts
const REGRESSIONS_USAGE = `arkaik kritik regressions [--from <audit>] [--to <audit>] [--record] [--json]

What got worse between two audits: a cell whose maturity dropped, a cell that
gained an open Critical or High finding, a finding that was resolved and is open
again. Cells scored in only one of the two audits are not compared — a
half-finished audit is not a regression.

Exits 1 when anything regressed, which is what makes it usable as a CI step or a
scheduled routine.

  --from <audit>    The older reading (default: the audit before --to).
  --to <audit>      The newer reading (default: the newest on disk).
  --record          Append one quality.signal.tripped per regression.
  --json            The full list as JSON.`;
```

- [ ] **Step 4: Add the imports**

Add `detectRegressions` and `type Regression` to the `@arkaik/schema` import, and `loadQualitySection` to the `@arkaik/schema/src/cli/kritik-audit` import.

- [ ] **Step 5: Write the verb**

After `runSignals`:

```ts
// --- regressions --------------------------------------------------------------

/** The two audits to compare, or a refusal saying why there is no pair. */
function auditPair(root: string, from?: string, to?: string): { from: string; to: string } {
  const audits = listAuditIds(root);
  if (audits.length < 2) {
    fail(
      `kritik: regressions needs two audits to compare — ` +
        `${audits.length === 0 ? "docs/quality/audits/ holds none" : `only "${audits[0]}" exists`}.\n` +
        `A regression is the difference between two readings; one reading is a baseline.`,
    );
  }
  const known = (id: string): string => {
    if (!audits.includes(id)) fail(`kritik: no audit "${id}" under docs/quality/audits/ (have: ${audits.join(", ")})`);
    return id;
  };
  const newer = to === undefined ? audits[audits.length - 1] : known(to);
  const older = from === undefined ? audits[audits.indexOf(newer) - 1] : known(from);
  if (older === undefined) {
    fail(`kritik: "${newer}" is the oldest audit — there is nothing before it to compare against.`);
  }
  if (older === newer) {
    fail(`kritik: --from and --to name the same audit ("${newer}") — a regression needs two readings.`);
  }
  return { from: older, to: newer };
}

function runRegressions(args: string[], common: CommonOptions): void {
  const { single, flags } = collect(args, [], ["json", "record"]);
  if (flags.has("help")) {
    console.log(REGRESSIONS_USAGE);
    process.exit(0);
  }

  const library = loadLibraryOrFail(common.root);
  profileOrFail(common.root);
  const { from, to } = auditPair(common.root, single.from, single.to);

  let regressions: Regression[];
  try {
    regressions = detectRegressions(
      loadQualitySection(common.root, from, library),
      loadQualitySection(common.root, to, library),
      library,
    );
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}`);
  }

  if (flags.has("json")) {
    console.log(JSON.stringify({ from, to, total: regressions.length, regressions }, null, 2));
  } else if (regressions.length === 0) {
    console.log(`\n  nothing regressed between ${from} and ${to}.\n`);
  } else {
    console.log("");
    for (const regression of regressions) {
      console.log(`  [${regression.kind}] ${regression.criterion_id} x ${regression.surface}`);
      console.log(`    ${regression.detail}`);
    }
    console.log(`\n  ${regressions.length} regression${regressions.length === 1 ? "" : "s"} between ${from} and ${to}.`);
  }

  if (flags.has("record") && regressions.length > 0) {
    reportJournal(
      common.root,
      regressions.map((regression) =>
        signalTrippedInput({
          criterion_id: regression.criterion_id,
          surface: regression.surface,
          signal: regression.signal,
          detail: regression.detail,
        }),
      ),
      common,
    );
    console.log(`  a tripped signal is not a finding — it is the prompt to go look.\n`);
  }

  // Exit 1 on regressions, the same CI contract `signals` already offers.
  process.exit(regressions.length > 0 ? 1 : 0);
}
```

- [ ] **Step 6: Dispatch it, and list it**

In `runKritik`'s switch, after the `signals` case:

```ts
    case "regressions":
      return runRegressions(subArgs, common);
```

In `USAGE`, after the `signals` line:

```
  regressions           What got worse between two audits.
```

And in `runSignals`' unfiltered summary — the `else` branch that prints "Narrow it (--surface, --criterion, --domain)…" — append a pointer to the same `console.log` expression:

```ts
        (listAuditIds(common.root).length > 1
          ? `\n  Comparing two audits is \`arkaik kritik regressions\`.`
          : ""),
```

Read the existing concatenation first and match its shape rather than pasting blindly.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/kritik.test.js`
Expected: every line `PASS`, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/kritik.ts tests/cli/kritik.test.js
git commit -m "feat(quality): arkaik kritik regressions"
```

---

## Task 8: The MCP tool

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts`
- Modify: `tests/mcp/kritik-tools.test.js`

- [ ] **Step 1: Write the failing test**

Read `tests/mcp/kritik-tools.test.js` first and match its tool-call helper and fixture repo. The fixture needs a second audit with a lower score for the list to be non-empty — write one the same way the suite writes its first (through `kritik_score` with an `audit_id`, if the tool takes one; otherwise by writing `scores.json` directly, as the fixture setup does). Then append:

```js
// --- kritik_regressions (phase E) --------------------------------------------

const regressions = await callTool("kritik_regressions", {});
check("kritik_regressions names both audits", typeof regressions.from === "string" && typeof regressions.to === "string", JSON.stringify(regressions));
check("kritik_regressions reports the level drop", regressions.regressions.some((r) => r.kind === "level-drop"), JSON.stringify(regressions.regressions));

const recorded = await callTool("kritik_regressions", { record: true });
check("record=true returns the events it appended", Array.isArray(recorded.events) && recorded.events.length === recorded.regressions.length, JSON.stringify(recorded.events));
check("every appended event is a trip", recorded.events.every((e) => e.type === "quality.signal.tripped"), JSON.stringify(recorded.events));

const refused = await callToolExpectingError("kritik_regressions", { from: "nope" });
check("an unknown audit is refused", refused.includes("nope"), refused);
```

Use whatever error-asserting helper the suite already has instead of `callToolExpectingError` if it is named differently.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build -w arkaik && npm run build -w arkaik-mcp && node tests/mcp/kritik-tools.test.js`
Expected: FAIL — unknown tool `kritik_regressions`.

- [ ] **Step 3: Write the tool**

Add `detectRegressions` and `type Regression` to the `@arkaik/schema` import, and `loadQualitySection` to the `kritik-audit` import. Then, after the `kritik_signals` tool:

```ts
  tool(
    {
      name: "kritik_regressions",
      description:
        "What got worse between two audits: a cell whose maturity level dropped, a cell that gained an open Critical or High finding, and a finding that was resolved and is open again. Cells scored in only one of the two audits are not compared — a half-finished audit is not a regression. With record=true, appends one quality.signal.tripped per regression. A tripped signal is NOT a finding; it is the prompt to go look.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "The older audit. Default: the audit before `to`." },
          to: { type: "string", description: "The newer audit. Default: the newest on disk." },
          record: { type: "boolean", description: "Append one quality.signal.tripped per regression." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const root = rootOf(ctx);
      const library = libraryOf(root);
      const audits = listAuditIds(root);
      if (audits.length < 2) {
        throw new ToolError(
          `regressions needs two audits to compare — ${audits.length === 0 ? "docs/quality/audits/ holds none" : `only "${audits[0]}" exists`}. ` +
            `A regression is the difference between two readings; one reading is a baseline.`,
        );
      }
      const known = (id: string): string => {
        if (!audits.includes(id)) throw new ToolError(`no audit "${id}" under docs/quality/audits/ (have: ${audits.join(", ")})`);
        return id;
      };
      const to = typeof args.to === "string" && args.to !== "" ? known(args.to) : audits[audits.length - 1];
      const from = typeof args.from === "string" && args.from !== "" ? known(args.from) : audits[audits.indexOf(to) - 1];
      if (from === undefined) throw new ToolError(`"${to}" is the oldest audit — there is nothing before it to compare against.`);
      if (from === to) throw new ToolError(`from and to name the same audit ("${to}") — a regression needs two readings.`);

      let regressions: Regression[];
      try {
        regressions = detectRegressions(
          loadQualitySection(root, from, library),
          loadQualitySection(root, to, library),
          library,
        );
      } catch (error) {
        throw new ToolError((error as Error).message);
      }

      let events: JournalEvent[] = [];
      if (args.record === true && regressions.length > 0) {
        const graph = await load();
        events = await record(
          graph,
          regressions.map((regression) =>
            signalTrippedInput({
              criterion_id: regression.criterion_id,
              surface: regression.surface,
              signal: regression.signal,
              detail: regression.detail,
            }),
          ),
        );
      }

      return { from, to, total: regressions.length, regressions, events };
    },
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build -w arkaik && npm run build -w arkaik-mcp && node tests/mcp/kritik-tools.test.js`
Expected: every line `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/kritik-tools.ts tests/mcp/kritik-tools.test.js
git commit -m "feat(quality): kritik_regressions, the tool half of the runner"
```

---

## Task 9: The plugin script

**Files:**
- Create: `packages/schema/src/cli/kritik-regressions-cli.ts`
- Modify: `scripts/generate/build-kritik-scripts.js:31-48`
- Modify: `tests/schema/kritik-plugin.test.js`

- [ ] **Step 1: Write the entry point**

`packages/schema/src/cli/kritik-regressions-cli.ts`, modelled exactly on `kritik-matrix-cli.ts`:

```ts
/**
 * Entry point for the standalone `detect-regressions.js` build artifact — what
 * got worse between two Kritik audits, bundled zero-dependency so a repo
 * running Kritik from the plugin alone can gate on it with nothing but Node.
 *
 * The comparison itself lives in `../quality-regressions`, shared verbatim with
 * `arkaik kritik regressions` and the `kritik_regressions` MCP tool: three ways
 * in, one verdict out. What stays here is only what "being a script" means —
 * argument parsing, printing, and an exit code.
 *
 * Usage: node detect-regressions.js [--from <audit>] [--to <audit>] [--root <dir>] [--json]
 */

import { dirname, resolve } from "node:path";
import { detectRegressions, type Regression } from "../quality-regressions";
import { listAuditIds, loadQualitySection } from "./kritik-audit";
import { die, loadEffectiveLibrary } from "./kritik-paths";

const USAGE = `detect-regressions.js — what got worse between two Kritik audits

Usage: node detect-regressions.js [--from <audit>] [--to <audit>] [--root <dir>] [--json]

  --from       the older reading (default: the audit before --to)
  --to         the newer reading (default: the newest on disk)
  --root       repo root holding docs/quality/ (default: the current directory)
  --json       print the full list as JSON

Reads docs/quality/audits/<id>/{scores,findings}.json for both audits.
Exits 1 when anything regressed. Writes nothing — recording the trips is
\`arkaik kritik regressions --record\`.`;

function parseArgs(argv: string[]) {
  let root = process.cwd();
  let from: string | undefined;
  let to: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg === "--json") json = true;
    else if (arg === "--root") root = argv[++i] ?? root;
    else if (arg === "--from") from = argv[++i];
    else if (arg === "--to") to = argv[++i];
    else die(`detect-regressions: unknown option ${arg}\n\n${USAGE}`);
  }
  return { root, from, to, json };
}

function main(): void {
  const { root, from: requestedFrom, to: requestedTo, json } = parseArgs(process.argv.slice(2));
  // argv[1], not import.meta.url or __dirname: this file is bundled to CJS and
  // dropped into a repo that may run it from anywhere.
  const scriptDir = dirname(resolve(process.argv[1] ?? "."));

  const audits = listAuditIds(root);
  if (audits.length < 2) {
    return die(
      `detect-regressions: needs two audits to compare — ` +
        `${audits.length === 0 ? "docs/quality/audits/ holds none" : `only "${audits[0]}" exists`}.`,
    );
  }
  const known = (id: string): string | undefined => (audits.includes(id) ? id : undefined);
  const to = requestedTo === undefined ? audits[audits.length - 1] : known(requestedTo);
  if (to === undefined) return die(`detect-regressions: no audit "${requestedTo}" (have: ${audits.join(", ")})`);
  const from = requestedFrom === undefined ? audits[audits.indexOf(to) - 1] : known(requestedFrom);
  if (from === undefined) return die(`detect-regressions: no older audit to compare "${to}" against`);
  if (from === to) return die(`detect-regressions: --from and --to name the same audit ("${to}")`);

  const library = loadEffectiveLibrary(scriptDir, root);
  let regressions: Regression[];
  try {
    regressions = detectRegressions(
      loadQualitySection(root, from, library),
      loadQualitySection(root, to, library),
      library,
    );
  } catch (error) {
    return die(`detect-regressions: ${(error as Error).message}`);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ from, to, total: regressions.length, regressions }, null, 2)}\n`);
  } else if (regressions.length === 0) {
    process.stdout.write(`nothing regressed between ${from} and ${to}\n`);
  } else {
    for (const regression of regressions) {
      process.stdout.write(`[${regression.kind}] ${regression.criterion_id} x ${regression.surface}\n  ${regression.detail}\n`);
    }
    process.stdout.write(`\n${regressions.length} regression(s) between ${from} and ${to}\n`);
  }
  process.exit(regressions.length > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 2: Register it with the generator**

In `scripts/generate/build-kritik-scripts.js`, add to `SCRIPTS`:

```js
  {
    entry: "kritik-regressions-cli.ts",
    out: "detect-regressions.js",
    summary: "Kritik regression runner — what got worse between two audits.",
  },
```

- [ ] **Step 3: Regenerate**

Run: `npm run generate && git status --short`
Expected: `plugin-kritik/skills/kritik/scripts/detect-regressions.js` appears. CI diffs generated artifacts, so it must be committed.

- [ ] **Step 4: Cover it end to end**

`tests/schema/kritik-plugin.test.js` already drives the three generated scripts as separate Node processes in a temp repo — the only way to check the zero-dependency claim still holds. Read its `compute-matrix.js` block and mirror it exactly, including how it locates the script and builds the temp root. Add a second audit to that temp repo scoring the same cell lower, then:

```js
const regressed = runScript("detect-regressions.js", ["--root", repo, "--json"]);
check("detect-regressions exits 1 on a regression", regressed.status === 1, `status ${regressed.status}`);
check("detect-regressions reports the level drop", JSON.parse(regressed.stdout).regressions.some((r) => r.kind === "level-drop"), regressed.stdout);
check("detect-regressions runs with zero dependencies", !regressed.stderr.includes("Cannot find module"), regressed.stderr);
```

Use whatever the suite's own script-running helper is called instead of `runScript`.

- [ ] **Step 5: Run it**

Run: `npm run test:kritik-plugin`
Expected: every line `PASS`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/cli/kritik-regressions-cli.ts scripts/generate/build-kritik-scripts.js plugin-kritik tests/schema/kritik-plugin.test.js
git commit -m "feat(quality): ship the regression runner as a plugin script"
```

---

## Task 10: The skill prose

**Files:**
- Modify: `docs/kritik-skill/skill.md`

The skill is the untested surface of this program — code that is green says nothing about instructions an agent will follow. Read this one adversarially.

- [ ] **Step 1: Find the monitoring section**

Run: `grep -n "signal\|between audits\|monitor" docs/kritik-skill/skill.md`

The step that tells an agent what to do between audits currently ends at the run sheet.

- [ ] **Step 2: Extend it**

Add, in the skill's own voice and matching its existing numbering and heading style:

```markdown
**Between audits, in order.** Two different checks, and confusing them wastes a
run:

1. `arkaik kritik signals --surface <s>` prints the run sheet — statements to
   CHECK, not commands to run. Nothing executes them for you. Check what you
   can, and record each failure with
   `arkaik kritik signals --trip <criterion> --surface <s> --signal <index>`,
   where `<index>` is the row's `[n]` in the run sheet (the statement's own text
   works too).
2. `arkaik kritik regressions` compares the last two audits and tells you what
   got worse without anyone checking anything: a cell whose maturity dropped, a
   cell that gained an open Critical or High, a finding that was resolved and is
   open again. `--record` appends the trips. It exits 1 when anything regressed,
   so it is the one to put in CI.

A tripped signal is not a finding. It is the prompt to go look — cheap,
frequent, and allowed to be wrong. Opening a finding is the expensive, rare act
that has to survive the adversarial pass.

**When a fix merges.** Two cases, and you can tell them apart by whether
`arkaik link` has bound this repo to a hosted project:

- **Hosted:** the Arkaik GitHub App resolves the finding itself. Name it in the
  PR body (`Fixes F-2026-08-SEC-web-01`) or close the issue it was filed as, and
  `quality.finding.resolved` is appended for you on merge.
- **Repo only:** run `arkaik kritik finding resolve <id> --by <pr-url>` yourself.

Either way the audit's `findings.json` is only true again once the repo side has
run, so do that too even on a hosted project.
```

- [ ] **Step 3: Adversarial read**

Re-read the whole section as an agent with no context would, and check specifically:
- Does anything imply `signals` executes checks? It must not.
- Is `--signal <index>` explained where an agent would look for it?
- Does the hosted-vs-repo split leave an agent guessing which case it is in?
- Does the step numbering still read correctly against the steps around it?

Fix what you find inline.

- [ ] **Step 4: Regenerate**

Run: `npm run generate && git status --short`
Expected: `plugin-kritik/skills/kritik/SKILL.md` updated.

- [ ] **Step 5: Commit**

```bash
git add docs/kritik-skill/skill.md plugin-kritik/skills/kritik/SKILL.md
git commit -m "docs(quality): tell the skill what happens between audits"
```

---

## Task 11: Record the decision, verify, and open the PR

**Files:**
- Modify: `docs/rfcs/kritik.md`

- [ ] **Step 1: Update § 8.6**

The decision currently ends "Regression detection *between* two audits' matrices stays with the phase-E runner." Append to that paragraph:

```markdown
  **Built in phase E** as `arkaik kritik regressions` / `kritik_regressions` /
  `detect-regressions.js`, over `detectRegressions` in
  `packages/schema/src/quality-regressions.ts`. Three kinds, all criterion-scoped
  because `quality.signal.tripped` requires a `criterion_id`: a maturity level
  that dropped, a cell that gained an open Critical or High, and a finding that
  was resolved and is open again. Cells scored in only one of the two audits are
  not compared. `signals` is unchanged and still prints a run sheet.
```

Row 6 of § 7 already reads "webhook grows `quality.finding.resolved`; the signal-pack runner" — leave the text; it is now true.

- [ ] **Step 2: Full verification**

Run each and read the output before claiming anything:

```bash
npm run generate && git status --short
npx tsc --noEmit -p tsconfig.json
npx eslint .
npm run test:quality && npm run test:quality-ops && npm run test:quality-regressions
npm run test:quality-webhook && npm run test:quality-page && npm run test:kritik-plugin
npm run build -w arkaik && node tests/cli/kritik.test.js
npm run build -w arkaik-mcp && node tests/mcp/kritik-tools.test.js
```

Expected: `git status --short` clean after `generate` (CI diffs generated artifacts), zero tsc errors, zero eslint **errors** (four warnings exist on main and are fine), every suite exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/rfcs/kritik.md
git commit -m "docs(quality): record that § 8.6's deferred half is built"
```

- [ ] **Step 4: Open the PR**

This ships something a user would notice — a merged PR now closes its quality finding, and the app shows it. **A Lab Note is required.**

```bash
git push -u origin feat/kritik-phase-e
gh pr create --title "feat(quality): the loop — resolution on merge, regressions between audits (#382 phase E)" --body "$(cat <<'BODY'
Closes the last phase of #382.

- The GitHub App webhook reads a merged PR for the findings it closed — by
  finding id, or by the issue it closes — and appends `quality.finding.resolved`.
- `foldResolvedFindings` folds those events over the stored section where the
  app assembles a bundle, so the matrix uncaps and the node badge clears
  without an audit re-run.
- `arkaik kritik regressions` (plus `kritik_regressions` and
  `detect-regressions.js`) compares two audits and names what got worse.

`signals` is unchanged: it still prints a run sheet, per RFC § 8.6.

## Lab Note

```yaml
en:
  title: "Fixes close their own quality findings now"
  summary: "Mention a finding in your pull request, or just close the issue it came from, and Arkaik marks it fixed the moment you merge. The quality matrix updates itself, and a new check tells you what slipped since your last audit."
fr:
  title: "Tes correctifs ferment eux-mêmes leurs constats qualité"
  summary: "Mentionne un constat dans ta pull request, ou ferme simplement l'issue d'origine : Arkaik le marque comme réglé dès la fusion. La matrice qualité se met à jour toute seule, et un nouveau contrôle te dit ce qui a glissé depuis ton dernier audit."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```
BODY
)"
```

- [ ] **Step 5: Read the PR's comments**

Run: `gh pr view --comments`

The advisory reminder comments at PR-open time if the note is malformed, and clears its own comment once the body is fixed. Do not assume the note is fine — read them.
