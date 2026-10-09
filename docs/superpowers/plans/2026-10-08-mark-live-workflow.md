# `arkaik live` and the `mark-live` workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a production deploy mark the acceptances it shipped `live`, by deriving them from merged PR mentions with the one real grammar and posting to the #424 door.

**Architecture:** Three stacked PRs. Part 1 moves the `AC-id@platform` mention grammar from the webhook into `@arkaik/schema` (pure move, re-exported). Part 2 adds `arkaik live`: a CLI verb that derives ids from a mentions file (plus positional ids), applies the path rule for bare mentions, and posts to `POST …/live`. Part 3 adds a reusable GitHub workflow in arkaik that finds the previous successful deploy, collects the PRs in between with `gh`, builds the CLI from `arkaik@main`, and runs the verb; plus docs. A pbbls caller follows as a separate PR.

**Tech Stack:** TypeScript (schema package, CLI with esbuild), plain-Node test scripts (`check()` harness, esbuild-bundled command modules, mock `httpClient`), GitHub Actions (`workflow_call`, `gh` CLI, `jq`).

**Spec:** `docs/superpowers/specs/2026-10-08-mark-live-workflow-design.md`. Read it first.

**Branching:** Part 1 is `mentions-1-schema` (exists, from main, carries the spec and this plan). Part 2 `live-2-cli` stacks on it; part 3 `live-3-workflow` on that. Drive the stack with the `gh-stack` skill (`gh stack init mentions-1-schema`, `gh stack add …`, `gh stack submit --auto --open`, then `gh pr edit` bodies). Part 1 is a chore: no Lab Note, add the `no-lab-note` label. Parts 2 and 3 carry Lab Notes (CLAUDE.md).

**Conventions (verified):** `npm run lint` must show 0 errors; `npx tsc --noEmit -p .` must be clean (`rm -rf .next` first if a stale `.next/types` references a route from another branch); `npm run generate && git diff --exit-code` must be clean after any `packages/schema/src` change; assert by identity, never `length === n`; a new `@/…` import in a module a test loader compiles needs a rewrite in that loader's table. Postgres suites run with `DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test` (a scratchpad cluster is up).

---

# Part 1 — `mentions-1-schema`

## Task 1: Move the mention grammar into `@arkaik/schema`

**Files:**
- Create: `packages/schema/src/mentions.ts`
- Modify: `packages/schema/src/index.ts` (add `export * from "./mentions";` after `./promote`)
- Modify: `lib/services/github/pull-request.ts` (delete the moved block; import and re-export)
- Create: `tests/schema/mentions.test.js`
- Modify: `package.json` (`"test:mentions": "node tests/schema/mentions.test.js"` after `test:promote`), `.github/workflows/ci.yml` (a step after `Ref promotion policy tests`)

- [ ] **Step 1: Write the failing schema suite**

`tests/schema/mentions.test.js`:

```js
#!/usr/bin/env node

/**
 * The `AC-id@platform` mention grammar (packages/schema/src/mentions.ts),
 * moved out of the GitHub App's webhook so the CLI and the mark-live
 * workflow read pull requests with the same rules the webhook does.
 *
 * The invariant under test: a mention is scoped to a platform ONLY IF the
 * suffix, after trimming trailing prose punctuation, equals a PlatformId
 * exactly (case-insensitively). Anything else is reported, never shortened.
 */

const { loadSchema } = require("./load-schema");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { mentionedAcceptances, isPlatformId } = loadSchema();

const scan = (title, body) => mentionedAcceptances({ title, body });
const has = (list, id, platform) => list.find((m) => m.id === id && m.platform === platform) !== undefined;

{
  const s = scan("x", "closes AC-guest-checkout");
  check("a bare mention has no platform", has(s.mentions, "AC-guest-checkout", null), JSON.stringify(s));
  check("and reports nothing unknown", s.unknown[0] === undefined, JSON.stringify(s));
}
{
  const s = scan("AC-a11y-labels: fix", "");
  check("the title is scanned too", has(s.mentions, "AC-a11y-labels", null), JSON.stringify(s));
}
{
  const s = scan("t", "fixes AC-guest-checkout@ios");
  check("an explicit suffix scopes the mention", has(s.mentions, "AC-guest-checkout", "ios"), JSON.stringify(s));
}
for (const platform of ["web", "ios", "android"]) {
  const s = scan("t", `AC-x@${platform}`);
  check(`@${platform} is a platform`, has(s.mentions, "AC-x", platform), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@iOS");
  check("a platform suffix is case-folded", has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x\\@ios");
  check("a backslash-escaped @ still scopes", has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
for (const written of ["AC-x@ios.", "(AC-x@ios)", "**AC-x@ios**", "`AC-x@ios`", "AC-x@ios,"]) {
  const s = scan("t", written);
  check(`trailing prose is trimmed: ${written}`, has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@android-tv");
  check("a near-miss suffix is NOT shortened to a platform", !has(s.mentions, "AC-x", "android"), JSON.stringify(s));
  check("it is reported whole", s.unknown.find((u) => u.id === "AC-x" && u.platform === "android-tv") !== undefined, JSON.stringify(s));
}
for (const written of ["@android_tv", "@ios.tv", "@ios/ipad", "@ios2", "@windows"]) {
  const s = scan("t", `AC-x${written}`);
  check(`unknown suffix ${written} is reported, not guessed`, s.mentions.find((m) => m.id === "AC-x") === undefined && s.unknown[0]?.id === "AC-x", JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@.");
  check("a suffix that trims to nothing is unknown, not bare", !has(s.mentions, "AC-x", null) && s.unknown[0]?.id === "AC-x", JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@ios and AC-x@android");
  check("one id can be scoped to two platforms", has(s.mentions, "AC-x", "ios") && has(s.mentions, "AC-x", "android"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x and AC-x@ios");
  check("a bare and a scoped mention of one id are both kept", has(s.mentions, "AC-x", null) && has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
{
  const s = scan("AC-x@ios", "AC-x@ios again");
  check("duplicates collapse on (id, platform)", s.mentions.filter((m) => m.id === "AC-x").length === 1 && has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-a@ios,AC-b@web");
  check("two mentions with no space between parse as two", has(s.mentions, "AC-a", "ios") && has(s.mentions, "AC-b", "web"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@iosAC-y");
  check("no word boundary means one unknown token, not a confident ios", !has(s.mentions, "AC-x", "ios") && s.unknown[0]?.id === "AC-x", JSON.stringify(s));
}
{
  const s = scan("t", "ac-Lower-CASE");
  check("the AC- prefix is normalised, the rest kept as written", has(s.mentions, "AC-Lower-CASE", null), JSON.stringify(s));
}
check("isPlatformId accepts the three platforms", isPlatformId("web") && isPlatformId("ios") && isPlatformId("android"));
check("isPlatformId rejects anything else", !isPlatformId("windows") && !isPlatformId("") && !isPlatformId("IOS"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll mentions checks passed.");
```

Add to `package.json` scripts after `"test:promote"`: `"test:mentions": "node tests/schema/mentions.test.js",`.

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:mentions`
Expected: a `TypeError: mentionedAcceptances is not a function` (nothing exported yet). Exit 1.

- [ ] **Step 3: Create the schema module**

`packages/schema/src/mentions.ts` — move the code from `lib/services/github/pull-request.ts` **verbatim**, including every comment, with these substitutions only:

```ts
/**
 * The `AC-id@platform` mention grammar — how a pull request names the
 * acceptances it ships, and on which platform.
 *
 * Lives here, not in the GitHub App, because three callers read it: the
 * App's webhook on merge, `arkaik live` from a deploy, and through the CLI the
 * `mark-live` reusable workflow. The grammar has been subtly wrong twice (see
 * the invariant below); one implementation is the only defence.
 *
 * Zod-free (type-only imports), like promote.ts.
 */

import { PLATFORM_IDS, type PlatformId } from "./ids";

/** Whether a string is one of the platforms arkaik knows, exactly. */
export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

// … then, verbatim from pull-request.ts:
//   the big `ACCEPTANCE_MENTION` doc comment and `const ACCEPTANCE_MENTION = /…/gi;`
//   the `TRAILING_PROSE` doc comment and set
//   the `trimTrailingProse` doc comment and function
//   `export interface AcceptanceMention`, `export interface UnknownPlatformMention`,
//   `export interface MentionScan` with their doc comments
//   `export function mentionedAcceptances(event: Pick<{ title: string; body: string }, "title" | "body">): MentionScan`
//     — the parameter type was `Pick<PullRequestEvent, "title" | "body">`; write it as
//       `{ title: string; body: string }` here (the webhook's `PullRequestEvent` has both as strings)
//     — replace the one `IS_PLATFORM(suffix)` call with `isPlatformId(suffix)`
```

Add `export * from "./mentions";` to `packages/schema/src/index.ts` after the `./promote` line.

- [ ] **Step 4: Point the webhook at it**

In `lib/services/github/pull-request.ts`:
- Delete the moved block: the `ACCEPTANCE_MENTION` comment+const, `TRAILING_PROSE` comment+set, `trimTrailingProse`, the three interfaces, and `mentionedAcceptances`. **Keep** the local `PLATFORM_IDS` and `IS_PLATFORM` (used at ~lines 1122, 1414, 2000) and the doc comment above them.
- Add to the `@arkaik/schema` import block: `mentionedAcceptances`, and `type AcceptanceMention`, `type MentionScan`, `type UnknownPlatformMention` (alphabetical among the existing names).
- Add near the top, after the imports, so existing readers of this module (the planner suite, `lib/services/github/*.ts`) keep working:

```ts
// The mention grammar moved to @arkaik/schema (packages/schema/src/mentions.ts)
// so the CLI and the mark-live workflow read pull requests with the webhook's
// rules. Re-exported here for the callers that always found it on this module.
export { mentionedAcceptances };
export type { AcceptanceMention, MentionScan, UnknownPlatformMention };
```

Then grep: `grep -rn 'mentionedAcceptances\|AcceptanceMention\|MentionScan' lib app --include=*.ts --include=*.tsx | grep import` and point any importer at `@arkaik/schema` directly if it is cleaner; the re-export keeps them compiling either way.

- [ ] **Step 5: Run the suites**

Run: `npm run test:mentions` → all PASS.
Run: `npm run test:pr-plan` → all PASS (it destructures `mentionedAcceptances` off the loaded planner module; the re-export is what makes this hold).
Run: `node -e "require('./tests/services/load-graph-api.js').loadGraphApi()"` and `node -e "require('./tests/services/load-pr-plan.js')"` → no output (loaders still resolve).
Run: `DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:github` → all PASS.
Run: `npm run generate && git diff --exit-code --stat` → clean (if `build-types-block.js` lists exported types by name and the doc gains nothing, that is fine; if generate changes files, commit them).

- [ ] **Step 6: Wire CI, lint, typecheck, commit**

`.github/workflows/ci.yml`, after the `Ref promotion policy tests` step:

```yaml
      # The AC-id@platform mention grammar, moved to the schema so the CLI and
      # the mark-live workflow read pull requests with the webhook's rules.
      - name: Mention grammar tests (scoping invariant, unknown suffixes)
        run: npm run test:mentions
```

```bash
npm run lint && rm -rf .next && npx tsc --noEmit -p . && \
git add packages/schema/src/mentions.ts packages/schema/src/index.ts lib/services/github/pull-request.ts tests/schema/mentions.test.js package.json .github/workflows/ci.yml && git add -A lib/prompts/generated public/schema docs/arkaik-skill plugin 2>/dev/null; \
git commit -m "refactor(schema): the AC-id@platform mention grammar moves to @arkaik/schema (#424 follow-up)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 2: Part 1 PR

- [ ] **Step 1:** `gh stack init mentions-1-schema && gh stack submit --auto --open`, then `gh pr edit <n> --add-label no-lab-note --title "The mention grammar moves to @arkaik/schema (#424 follow-up, part 1)" --body-file -` with a body explaining the move (pure, re-exported, direct suite added) and ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 2:** `gh stack add live-2-cli` to start part 2.

---

# Part 2 — `live-2-cli`

## Task 3: `arkaik live` — the pure derivation and the command

**Files:**
- Create: `packages/cli/src/commands/live.ts`
- Modify: `packages/cli/src/index.ts` (import, USAGE line, `case "live"`)
- Create: `tests/cli/live.test.js`
- Modify: `package.json` (`test:cli` gains `&& node tests/cli/live.test.js` after `push.test.js`)

- [ ] **Step 1: Write the failing test suite**

`tests/cli/live.test.js` (the push test's idiom: esbuild-bundle the command to ESM, inject a mock `httpClient`, spawn the built CLI only for argv errors):

```js
#!/usr/bin/env node

/**
 * `arkaik live` (packages/cli/src/commands/live.ts): derive the acceptances a
 * deploy carried from merged PR mentions, and post them to the #424 door.
 *
 *  - `deriveLiveIds` is pure and exercised directly: explicit `@platform`
 *    counts, other platforms never do, unknown suffixes are reported, and a
 *    bare mention counts only when the PR touched one of `--paths`.
 *  - `runLive` is exercised in-process with a mock httpClient recording every
 *    call, so the request body, chunking and exit outcomes are asserted
 *    without a network.
 *  - argv errors go through the built CLI (spawn), as the other suites do.
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const LIVE_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "live.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build-live");
const LIVE_BUNDLE = path.join(TEST_BUILD_DIR, "live.mjs");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${typeof detail === "function" ? detail() : detail}` : ""}`); }
}

function makeMockHttpClient(responder) {
  const calls = [];
  const client = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init, calls.length);
  };
  client.calls = calls;
  return client;
}

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

/** A linked repo: docs/arkaik/arkaik.json pointing at a project. */
function linkedDir(remote = "https://arkaik.test") {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-live-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_test", remote }));
  return dir;
}

const pr = (number, body, files = [], title = `PR ${number}`) => ({ number, title, body, files });

async function main() {
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await build({ entryPoints: [LIVE_ENTRY], outfile: LIVE_BUNDLE, bundle: true, platform: "node", target: "node18", format: "esm", legalComments: "none" });
  const { deriveLiveIds, runLive } = await import(pathToFileURL(LIVE_BUNDLE).href);

  // --- deriveLiveIds -----------------------------------------------------------
  {
    const r = deriveLiveIds([pr(1, "ships AC-a@web and AC-b@ios")], "web", []);
    check("an explicit @web mention counts on a web deploy", r.ids.includes("AC-a"), JSON.stringify(r));
    check("a mention of another platform never does", !r.ids.includes("AC-b"), JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(2, "closes AC-c")], "web", []);
    check("with no --paths, a bare mention counts", r.ids.includes("AC-c"), JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(3, "closes AC-d", ["apps/web/page.tsx"]), pr(4, "closes AC-e", ["apps/ios/App.swift"])], "web", ["apps/web"]);
    check("with --paths, a bare mention counts when the PR touched the prefix", r.ids.includes("AC-d"), JSON.stringify(r));
    check("and not when it did not", !r.ids.includes("AC-e"), JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(5, "closes AC-f", ["apps/webb/x.ts"])], "web", ["apps/web"]);
    check("a prefix matches a path segment, not a string prefix (apps/webb is not apps/web)", !r.ids.includes("AC-f"), JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(6, "AC-g@web", ["apps/ios/x.swift"])], "web", ["apps/web"]);
    check("an explicit @web counts even when the PR touched no web path", r.ids.includes("AC-g"), JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(7, "AC-h@android-tv")], "android", []);
    check("an unknown suffix marks nothing", r.ids[0] === undefined, JSON.stringify(r));
    check("and is reported with its PR number", r.warnings.find((w) => /#7/.test(w) && /android-tv/.test(w)) !== undefined, JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(8, "AC-i@web"), pr(9, "AC-i@web and AC-j@web")], "web", []);
    check("ids are deduplicated across PRs, in first-seen order", JSON.stringify(r.ids) === JSON.stringify(["AC-i", "AC-j"]), JSON.stringify(r));
  }
  {
    const r = deriveLiveIds([pr(10, "nothing here")], "web", []);
    check("a PR without mentions contributes nothing", r.ids[0] === undefined && r.warnings[0] === undefined, JSON.stringify(r));
  }

  // --- runLive -------------------------------------------------------------------
  const env = { ARKAIK_TOKEN: "ark_test_token" };
  const logs = () => { const out = []; return { out, log: (m) => out.push(m), errorLog: (m) => out.push(`ERR ${m}`) }; };

  {
    const cwd = linkedDir();
    const mentions = path.join(cwd, "mentions.json");
    writeFileSync(mentions, JSON.stringify([pr(1, "AC-a@web", ["apps/web/x.ts"]), pr(2, "AC-b", ["apps/web/y.ts"])]));
    const http = makeMockHttpClient(() => jsonResponse(200, {
      version: "3",
      applied: [{ node_id: "AC-a", platform: "web", from: "releasing", to: "live" }],
      skipped: [{ index: 1, node_id: "AC-b", platform: "web", reason: "already_live" }],
      events: [],
    }));
    const l = logs();
    const result = await runLive(["--platform", "web", "--mentions", mentions, "--paths", "apps/web", "--detail", "https://pbbls.app"], { cwd, env, httpClient: http, ...l });
    check("a derived batch posts and succeeds", result.ok === true, () => l.out.join("\n"));
    const call = http.calls[0];
    check("to the project's live route with the bearer token", call && /\/api\/graph\/projects\/prj_test\/live$/.test(call.url) && call.init.headers.authorization === "Bearer ark_test_token", JSON.stringify(call?.url));
    const sent = call ? JSON.parse(call.init.body) : null;
    check("the body carries one entry per id with the platform and detail", sent?.entries?.find((e) => e.node_id === "AC-a" && e.platform === "web" && e.detail === "https://pbbls.app") !== undefined && sent?.entries?.find((e) => e.node_id === "AC-b") !== undefined, JSON.stringify(sent));
    check("applied and skipped are printed", l.out.find((m) => /AC-a.*releasing.*live/.test(m)) !== undefined && l.out.find((m) => /AC-b.*already live/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(200, { version: "3", applied: [{ node_id: "AC-z", platform: "ios", from: "releasing", to: "live" }], skipped: [], events: [] }));
    const l = logs();
    const result = await runLive(["--platform", "ios", "AC-z"], { cwd, env, httpClient: http, ...l });
    check("positional ids post without a mentions file", result.ok === true && JSON.parse(http.calls[0].init.body).entries[0].node_id === "AC-z", () => l.out.join("\n"));
    check("and no detail key is sent when none was given", !("detail" in JSON.parse(http.calls[0].init.body).entries[0]), http.calls[0].init.body);
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(200, {}));
    const l = logs();
    const result = await runLive(["--platform", "web", "--dry-run", "AC-q"], { cwd, env, httpClient: http, ...l });
    check("--dry-run prints the entries and sends nothing", result.ok === true && http.calls[0] === undefined && l.out.find((m) => /AC-q/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const mentions = path.join(cwd, "mentions.json");
    writeFileSync(mentions, JSON.stringify([pr(1, "no acceptances")]));
    const http = makeMockHttpClient(() => jsonResponse(200, {}));
    const l = logs();
    const result = await runLive(["--platform", "web", "--mentions", mentions], { cwd, env, httpClient: http, ...l });
    check("nothing to mark is a success that sends nothing", result.ok === true && http.calls[0] === undefined && l.out.find((m) => /[Nn]othing to mark/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(422, { error: "refused", refusals: [{ index: 0, node_id: "AC-r", platform: "web", reason: "platform_not_applicable", detail: "AC-r lists: ios" }] }));
    const l = logs();
    const result = await runLive(["--platform", "web", "AC-r"], { cwd, env, httpClient: http, ...l });
    check("a refusal fails the command", result.ok === false, () => l.out.join("\n"));
    check("and prints each refusal with its reason and detail", l.out.find((m) => /AC-r.*platform_not_applicable.*lists: ios/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const http = makeMockHttpClient(() => jsonResponse(403, { error: "insufficient_scope", required: "graph:write" }));
    const l = logs();
    const result = await runLive(["--platform", "web", "AC-s"], { cwd, env, httpClient: http, ...l });
    check("a 403 fails and names release:append", result.ok === false && l.out.find((m) => /release:append/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const ids = Array.from({ length: 51 }, (_, i) => `AC-n${i}`);
    const http = makeMockHttpClient((url, init) => jsonResponse(200, { version: "9", applied: JSON.parse(init.body).entries.map((e) => ({ ...e, from: "releasing", to: "live" })), skipped: [], events: [] }));
    const l = logs();
    const result = await runLive(["--platform", "web", ...ids], { cwd, env, httpClient: http, ...l });
    check("51 ids go in two requests of at most 50", result.ok === true && http.calls[1] !== undefined && http.calls[2] === undefined && JSON.parse(http.calls[0].init.body).entries.length === 50, () => `${http.calls.length} calls`);
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = mkdtempSync(path.join(tmpdir(), "arkaik-live-unlinked-"));
    const l = logs();
    const result = await runLive(["--platform", "web", "AC-a"], { cwd, env, httpClient: makeMockHttpClient(() => jsonResponse(200, {})), ...l });
    check("an unlinked repo fails and says to run arkaik link", result.ok === false && l.out.find((m) => /arkaik link/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }
  {
    const cwd = linkedDir();
    const l = logs();
    const result = await runLive(["--platform", "web", "AC-a"], { cwd, env: {}, httpClient: makeMockHttpClient(() => jsonResponse(200, {})), ...l });
    check("a missing token fails and names ARKAIK_TOKEN", result.ok === false && l.out.find((m) => /ARKAIK_TOKEN/.test(m)) !== undefined, () => l.out.join("\n"));
    rmSync(cwd, { recursive: true, force: true });
  }

  // --- argv through the built CLI --------------------------------------------------
  {
    const r = spawnSync(process.execPath, [CLI, "live", "--help"], { encoding: "utf8" });
    check("live --help prints usage and exits 0", r.status === 0 && /arkaik live/.test(r.stdout), r.stderr);
  }
  {
    const r = spawnSync(process.execPath, [CLI, "live", "AC-a"], { encoding: "utf8", env: { ...process.env, ARKAIK_TOKEN: "x" } });
    check("live without --platform exits 1 and says so", r.status === 1 && /--platform/.test(r.stderr), r.stderr);
  }
  {
    const r = spawnSync(process.execPath, [CLI, "live", "--platform", "windows", "AC-a"], { encoding: "utf8", env: { ...process.env, ARKAIK_TOKEN: "x" } });
    check("an unknown platform exits 1 naming the valid ones", r.status === 1 && /web, ios, android/.test(r.stderr), r.stderr);
  }

  rmSync(TEST_BUILD_DIR, { recursive: true, force: true });
  if (failures > 0) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log("\nAll live CLI checks passed.");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Add `/packages/cli/.test-build-live/` to `.gitignore` (after `/packages/cli/.test-build-restore/`). In `package.json`'s `test:cli` script, insert `&& node tests/cli/live.test.js` right after `node tests/cli/push.test.js`.

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build -w arkaik && node tests/cli/live.test.js`
Expected: esbuild fails to resolve `packages/cli/src/commands/live.ts` (`Could not resolve`). Exit 1.

- [ ] **Step 3: Write the command**

`packages/cli/src/commands/live.ts`:

```ts
/**
 * `arkaik live --platform <p> [--detail <text>] [--mentions <file>] [--paths <prefixes>] [--dry-run] [AC-id …]`
 *
 * Mark the acceptances a deploy carried `live` on one platform, through the
 * #424 door (`POST /api/graph/projects/{id}/live`, scope `release:append`).
 *
 * Ids come from the positional arguments and from `--mentions <file>`: a JSON
 * array with one `{ number, title, body, files }` per merged pull request,
 * which the mark-live workflow assembles with `gh`. Each PR is read with the
 * same `AC-id@platform` grammar the GitHub App applies on merge
 * (`mentionedAcceptances`, @arkaik/schema):
 *   - an explicit `@<platform>` mention counts;
 *   - a mention of another platform never does;
 *   - an unknown suffix (`@android-tv`) is reported, never guessed;
 *   - a BARE mention (`AC-x`) counts only when there is no `--paths`, or when
 *     one of that PR's changed files sits under a given prefix — the webhook's
 *     path-scoped-link rule, applied from the deploy side. In a monorepo an
 *     iOS-only PR that forgot `@ios` must not mark web live.
 *
 * A deploy that carried no acceptance is normal: "nothing to mark", exit 0.
 * A refusal or any non-2xx from the door is a failure, exit 1 — the workflow
 * step goes red instead of reporting green while nothing went live.
 *
 * The project id and remote come from docs/arkaik/arkaik.json (`arkaik link`);
 * the token from $ARKAIK_TOKEN, never from a file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PLATFORM_IDS, isPlatformId, mentionedAcceptances, type PlatformId } from "@arkaik/schema";

const LINK_FILE = "docs/arkaik/arkaik.json";
const DEFAULT_BASE_URL = "https://arkaik.app";
/** The door's per-request cap (lib/services/graph/live.ts MAX_ENTRIES). */
const MAX_ENTRIES_PER_REQUEST = 50;

const USAGE = `arkaik live — mark the acceptances a deploy carried live on one platform

Usage:
  arkaik live --platform <web|ios|android> [options] [AC-id ...]

Options:
  --platform <id>     Required. The platform that went live.
  --detail <text>     Evidence to record on the status change: a deploy URL, a build number.
  --mentions <file>   JSON array of merged pull requests: [{ number, title, body, files }].
                      Acceptances mentioned as AC-id@<platform> count; bare AC-id mentions
                      count only when the PR touched one of --paths (or --paths is absent).
  --paths <prefixes>  Comma-separated path prefixes that make a bare mention count (apps/web).
  --dry-run           Print the entries and send nothing.
  --remote <url>      Instance origin. Default: the link file's remote, else ${DEFAULT_BASE_URL}
  -h, --help          Show this help.

Environment:
  ARKAIK_TOKEN        Required. A release:append token from <origin>/settings/tokens.

Reads ${LINK_FILE} for the project id. Exit 0 when nothing needs marking; exit 1 on a refusal.`;

export interface RunLiveOptions {
  /** Injectable for tests; defaults to the global fetch. */
  httpClient?: typeof fetch;
  cwd?: string;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
  errorLog?: (message: string) => void;
}

export interface LiveResult {
  ok: boolean;
  /** The ids the command resolved to mark, after derivation and dedupe. */
  ids?: string[];
}

/** One merged pull request, as the mark-live workflow writes it. */
export interface MentionedPullRequest {
  number: number;
  title: string;
  body: string;
  files: string[];
}

export interface DerivedLiveIds {
  ids: string[];
  /** Unknown platform suffixes, one line each, naming the PR. */
  warnings: string[];
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index !== -1 ? argv[index + 1] : undefined;
}

/** `apps/web` and `apps/web/` both mean the directory; a prefix matches whole path segments. */
function normalisePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "" : `${trimmed}/`;
}

function touchesAny(files: readonly string[], prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) return true;
  return files.some((file) => prefixes.some((prefix) => prefix === "" || file.startsWith(prefix)));
}

/**
 * The ids a deploy of `platform` carried, read from merged pull requests with
 * the webhook's grammar. Pure; exported for tests and for anything else that
 * wants the rule without the request.
 */
export function deriveLiveIds(
  prs: readonly MentionedPullRequest[],
  platform: PlatformId,
  paths: readonly string[],
): DerivedLiveIds {
  const prefixes = paths.map(normalisePrefix);
  const ids: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const pr of prs) {
    const scan = mentionedAcceptances({ title: pr.title ?? "", body: pr.body ?? "" });
    for (const unknown of scan.unknown) {
      warnings.push(`#${pr.number}: ${unknown.id}@${unknown.platform} names no platform arkaik knows — ignored`);
    }
    for (const mention of scan.mentions) {
      const counts =
        mention.platform === platform ||
        (mention.platform === null && touchesAny(pr.files ?? [], prefixes));
      if (!counts || seen.has(mention.id)) continue;
      seen.add(mention.id);
      ids.push(mention.id);
    }
  }
  return { ids, warnings };
}

function readMentions(file: string): MentionedPullRequest[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { error: `Could not read ${file}: ${(e as Error).message}` };
  }
  if (!Array.isArray(parsed)) return { error: `${file} must be a JSON array of pull requests` };
  const prs: MentionedPullRequest[] = [];
  for (const [i, raw] of parsed.entries()) {
    if (typeof raw !== "object" || raw === null) return { error: `${file}[${i}] must be an object` };
    const r = raw as Record<string, unknown>;
    prs.push({
      number: typeof r.number === "number" ? r.number : Number(r.number ?? 0),
      title: typeof r.title === "string" ? r.title : "",
      body: typeof r.body === "string" ? r.body : "",
      files: Array.isArray(r.files) ? r.files.filter((f): f is string => typeof f === "string") : [],
    });
  }
  return prs;
}

function describeFailure(status: number, baseUrl: string): string {
  if (status === 401) return `Unauthorized — check ARKAIK_TOKEN (create one at ${baseUrl}/settings/tokens).`;
  if (status === 403) return "Forbidden — this token lacks the release:append scope (or graph:write).";
  if (status === 404) return `No linked project in this account — check ${LINK_FILE}.`;
  if (status === 409) return "The project changed under every retry — run again.";
  return `Request failed (${status}).`;
}

interface LiveResponse {
  version?: string;
  applied?: Array<{ node_id: string; platform: string; from: string; to: string }>;
  skipped?: Array<{ index: number; node_id: string; platform: string; reason: string }>;
  refusals?: Array<{ index: number; node_id: string; platform: string; reason: string; detail?: string }>;
  error?: string;
}

export async function runLive(argv: string[], options: RunLiveOptions = {}): Promise<LiveResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const errorLog = options.errorLog ?? ((m: string) => console.error(m));
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const doFetch = options.httpClient ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  if (argv.includes("--help") || argv.includes("-h")) {
    log(USAGE);
    return { ok: true };
  }

  const platformArg = flagValue(argv, "--platform");
  if (!platformArg) {
    errorLog(`--platform is required: arkaik live --platform <${PLATFORM_IDS.join("|")}> …`);
    return { ok: false };
  }
  if (!isPlatformId(platformArg)) {
    errorLog(`"${platformArg}" is not a platform. Expected one of: ${PLATFORM_IDS.join(", ")}.`);
    return { ok: false };
  }
  const platform: PlatformId = platformArg;
  const detail = flagValue(argv, "--detail");
  const mentionsFile = flagValue(argv, "--mentions");
  const paths = (flagValue(argv, "--paths") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const dryRun = argv.includes("--dry-run");

  // Positional ids: anything that is not a flag or a flag's value.
  const valued = new Set(["--platform", "--detail", "--mentions", "--paths", "--remote"]);
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (valued.has(arg)) { i++; continue; }
    if (arg.startsWith("--")) continue;
    positional.push(arg);
  }

  const linkPath = join(cwd, LINK_FILE);
  let link: { project_id?: string; remote?: string };
  try {
    link = JSON.parse(readFileSync(linkPath, "utf8")) as { project_id?: string; remote?: string };
  } catch {
    errorLog(`No ${LINK_FILE}. Run \`arkaik link --project <id>\` first — live only targets hosted projects.`);
    return { ok: false };
  }
  const projectId = link.project_id;
  if (!projectId) {
    errorLog(`${LINK_FILE} has no project_id. Run \`arkaik link --project <id>\`.`);
    return { ok: false };
  }
  const baseUrl = (flagValue(argv, "--remote") ?? env.ARKAIK_URL ?? link.remote ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => { if (!seen.has(id)) { seen.add(id); ids.push(id); } };
  for (const id of positional) add(id);
  if (mentionsFile) {
    const prs = readMentions(join(cwd, mentionsFile));
    if (!Array.isArray(prs)) {
      errorLog(prs.error);
      return { ok: false };
    }
    const derived = deriveLiveIds(prs, platform, paths);
    for (const warning of derived.warnings) errorLog(`warning: ${warning}`);
    for (const id of derived.ids) add(id);
  }

  if (ids.length === 0) {
    log(`Nothing to mark live on ${platform}.`);
    return { ok: true, ids };
  }

  const entries = ids.map((node_id) => ({ node_id, platform, ...(detail !== undefined ? { detail } : {}) }));
  if (dryRun) {
    log(`Would mark ${platform} live for ${ids.length} acceptance(s) on ${projectId} (${baseUrl}):`);
    for (const entry of entries) log(`  ${entry.node_id}@${platform}${detail ? ` — ${detail}` : ""}`);
    return { ok: true, ids };
  }

  const token = env.ARKAIK_TOKEN;
  if (!token) {
    errorLog(`ARKAIK_TOKEN is not set. Create a release:append token at ${baseUrl}/settings/tokens and export it.`);
    return { ok: false };
  }

  for (let start = 0; start < entries.length; start += MAX_ENTRIES_PER_REQUEST) {
    const chunk = entries.slice(start, start + MAX_ENTRIES_PER_REQUEST);
    const res = await doFetch(`${baseUrl}/api/graph/projects/${encodeURIComponent(projectId)}/live`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ entries: chunk }),
    });
    let body: LiveResponse = {};
    try { body = (await res.json()) as LiveResponse; } catch { /* a non-JSON error body */ }
    if (res.status === 422 && body.refusals) {
      errorLog(`Refused — nothing was written:`);
      for (const r of body.refusals) {
        errorLog(`  entries[${r.index}] ${r.node_id}@${r.platform}: ${r.reason}${r.detail ? ` — ${r.detail}` : ""}`);
      }
      return { ok: false, ids };
    }
    if (!res.ok) {
      errorLog(describeFailure(res.status, baseUrl));
      return { ok: false, ids };
    }
    for (const a of body.applied ?? []) log(`${a.node_id}: ${a.from} → ${a.to} [${a.platform}]`);
    for (const s of body.skipped ?? []) log(`${s.node_id}: already live [${s.platform}]`);
  }
  return { ok: true, ids };
}

export function runLiveCli(argv: string[]): void {
  void runLive(argv).then((result) => {
    if (!result.ok) process.exit(1);
  });
}
```

Register it in `packages/cli/src/index.ts`: import `runLiveCli` from `./commands/live`; add to USAGE after the `link` lines:
```
  live --platform <p> [ids]   Mark acceptances live on one platform from a deploy (release:append token).
                               --mentions <file> derives them from merged pull requests.
```
and a `case "live": runLiveCli(rest); return;` after `link`.

- [ ] **Step 4: Run the suite**

Run: `npm run build -w arkaik && node tests/cli/live.test.js`
Expected: all PASS, `All live CLI checks passed.`

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit -p . && \
git add packages/cli/src/commands/live.ts packages/cli/src/index.ts tests/cli/live.test.js package.json .gitignore && \
git commit -m "feat(cli): arkaik live — derive a deploy's acceptances from PR mentions and mark them live (#424 follow-up)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 4: Toolchain row, version bump, part 2 PR

**Files:** `docs/spec/toolchain.md` (command table), `packages/cli/package.json` (0.10.0), `package-lock.json` (the `packages/cli` workspace entry's version — edit the two lines by hand; `npm install --package-lock-only` adds unrelated entries on this machine).

- [ ] **Step 1:** Add to the toolchain command table after the `arkaik push` row:
```markdown
| `arkaik live --platform <p> [--mentions <file>] [--paths <prefixes>] [--detail <text>] [ids…]` | From a deploy: mark the acceptances it carried `live` on one platform through `POST …/live` (scope `release:append`, issue #424). Ids come from the arguments and from a JSON file of merged pull requests read with the webhook's `AC-id@platform` grammar — explicit `@platform` counts, other platforms never do, a bare mention counts only when the PR touched one of `--paths`. Nothing to mark is exit 0; a refusal is exit 1. The `mark-live` reusable workflow is its caller | 4 |
```
- [ ] **Step 2:** Bump `packages/cli/package.json` to `0.10.0` and the matching `"version"` under `"packages/cli"` in `package-lock.json` (grep `"version": "0.9.0"` near `node_modules/arkaik` / `packages/cli`). `npm run test:cli 2>&1 | tail -2` → exit 0.
- [ ] **Step 3:** Commit `chore(release): arkaik 0.10.0 — arkaik live (#424 follow-up)`; `gh stack submit --auto --open`; `gh pr edit` with a body describing the verb and this Lab Note:

```yaml
en:
  title: "One command marks a deploy's acceptances live"
  summary: "`arkaik live` reads the pull requests a deploy shipped, finds the acceptances they name, and tells arkaik they're live on that platform — with the deploy URL as evidence. It uses the same mention rules your pull requests already follow."
fr:
  title: "Une commande marque les critères d'un déploiement comme live"
  summary: "`arkaik live` lit les pull requests qu'un déploiement a embarquées, repère les critères qu'elles nomment et dit à arkaik qu'ils sont live sur cette plateforme — avec l'URL du déploiement en preuve. Les mêmes règles de mention que tes pull requests suivent déjà."
suggested:
  molecule: arkaik
  type: feature
  tags: [cli, lifecycle, ci]
```
- [ ] **Step 4:** `gh stack add live-3-workflow`.

---

# Part 3 — `live-3-workflow`

## Task 5: The reusable workflow

**Files:** Create `.github/workflows/mark-live.yml`.

- [ ] **Step 1: Write it**

```yaml
# Reusable: mark the acceptances a production deploy carried `live` in a
# hosted arkaik project (issue #424 follow-up). Callers run it on
# `deployment_status` (state success, their production environment) and pass
# the platform. It finds the previous successful deploy of the same
# environment, collects the pull requests merged in between with `gh`, and
# runs `arkaik live`, which reads them with the same AC-id@platform grammar the
# GitHub App applies on merge. The CLI is built from arkaik@main so a caller
# never waits on an npm publish. The step fails when the door refuses, so a
# deploy that could not mark itself live is a red job, not a silent one.
#
# The caller's repo must be linked (docs/arkaik/arkaik.json, `arkaik link`) and
# hold a release:append token as the ARKAIK_RELEASE_TOKEN secret.
name: mark-live

on:
  workflow_call:
    inputs:
      platform:
        description: "web | ios | android"
        required: true
        type: string
      sha:
        description: "The deployed commit. Default: the triggering commit."
        required: false
        type: string
        default: ${{ github.sha }}
      environment:
        description: "Deployment environment name, to find the previous successful deploy (e.g. 'Production – pbbls')."
        required: false
        type: string
        default: ""
      deployment_id:
        description: "The current deployment's id, excluded when looking for the previous one."
        required: false
        type: string
        default: ""
      paths:
        description: "Comma-separated path prefixes; a bare AC-id mention counts only when the PR touched one (e.g. apps/web)."
        required: false
        type: string
        default: ""
      detail:
        description: "Evidence recorded on the status change. Default: this run's URL."
        required: false
        type: string
        default: ""
      ids:
        description: "Space-separated acceptance ids. When given, derivation is skipped."
        required: false
        type: string
        default: ""
    secrets:
      ARKAIK_RELEASE_TOKEN:
        required: true
  workflow_dispatch:
    inputs:
      platform:
        description: "web | ios | android"
        required: true
        type: string
      sha:
        description: "The deployed commit"
        required: false
        type: string
        default: ""
      environment:
        description: "Deployment environment name"
        required: false
        type: string
        default: ""
      deployment_id:
        description: "Current deployment id to exclude"
        required: false
        type: string
        default: ""
      paths:
        description: "Comma-separated path prefixes for bare mentions"
        required: false
        type: string
        default: ""
      detail:
        description: "Evidence"
        required: false
        type: string
        default: ""
      ids:
        description: "Space-separated ids (skips derivation)"
        required: false
        type: string
        default: ""

permissions:
  contents: read
  pull-requests: read
  deployments: read

jobs:
  mark-live:
    runs-on: ubuntu-latest
    env:
      PLATFORM: ${{ inputs.platform }}
      SHA: ${{ inputs.sha != '' && inputs.sha || github.sha }}
      ENVIRONMENT: ${{ inputs.environment }}
      DEPLOYMENT_ID: ${{ inputs.deployment_id }}
      PATHS: ${{ inputs.paths }}
      DETAIL: ${{ inputs.detail != '' && inputs.detail || format('{0}/{1}/actions/runs/{2}', github.server_url, github.repository, github.run_id) }}
      IDS: ${{ inputs.ids }}
      GH_TOKEN: ${{ github.token }}
    steps:
      - name: Check out the deployed repository
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.sha != '' && inputs.sha || github.sha }}
          fetch-depth: 0
          path: repo

      - name: Check out arkaik (the CLI is built from main)
        uses: actions/checkout@v4
        with:
          repository: alexisbohns/arkaik
          ref: main
          path: tool

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: tool/package-lock.json

      - name: Build the arkaik CLI
        working-directory: tool
        run: |
          npm ci --no-audit --no-fund
          npm run build -w arkaik

      - name: Find the previous successful deploy and the pull requests since
        id: range
        if: env.IDS == ''
        working-directory: repo
        run: |
          set -euo pipefail
          if [ -z "$ENVIRONMENT" ]; then
            echo "No environment given and no ids: nothing to derive the range from." >&2
            echo "prev=" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          # Deployments of this environment, newest first; the first one that is
          # not the current deployment and has a `success` status bounds the range.
          prev=""
          for id in $(gh api --paginate -X GET "repos/${GITHUB_REPOSITORY}/deployments" \
              -f environment="$ENVIRONMENT" -f per_page=50 --jq '.[].id'); do
            if [ -n "$DEPLOYMENT_ID" ] && [ "$id" = "$DEPLOYMENT_ID" ]; then continue; fi
            dsha=$(gh api "repos/${GITHUB_REPOSITORY}/deployments/$id" --jq .sha)
            if [ "$dsha" = "$SHA" ]; then continue; fi
            if gh api "repos/${GITHUB_REPOSITORY}/deployments/$id/statuses" --jq '[.[].state] | index("success") != null' | grep -q true; then
              prev="$dsha"; break
            fi
          done
          if [ -z "$prev" ]; then
            echo "No previous successful deploy of '$ENVIRONMENT' — marking nothing rather than guessing a range." >&2
            echo "prev=" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          echo "prev=$prev" >> "$GITHUB_OUTPUT"
          echo "Range: $prev..$SHA" >&2
          # Pull request numbers from the squash subjects "(#N)" and merge commits.
          git log --format=%s "$prev..$SHA" \
            | grep -oE '\(#[0-9]+\)$|Merge pull request #[0-9]+' \
            | grep -oE '[0-9]+' | sort -un > prs.txt || true
          echo "Pull requests: $(tr '\n' ' ' < prs.txt)" >&2
          : > mentions.jsonl
          while read -r n; do
            [ -z "$n" ] && continue
            gh pr view "$n" --json number,title,body,files \
              --jq '{number, title, body, files: [.files[].path]}' >> mentions.jsonl
          done < prs.txt
          jq -s '.' mentions.jsonl > mentions.json

      - name: Mark live
        if: env.IDS != '' || steps.range.outputs.prev != ''
        working-directory: repo
        env:
          ARKAIK_TOKEN: ${{ secrets.ARKAIK_RELEASE_TOKEN }}
        run: |
          set -euo pipefail
          args=(--platform "$PLATFORM" --detail "$DETAIL")
          if [ -n "$PATHS" ]; then args+=(--paths "$PATHS"); fi
          if [ -n "$IDS" ]; then
            # shellcheck disable=SC2206
            args+=($IDS)
          else
            args+=(--mentions mentions.json)
          fi
          node ../tool/packages/cli/dist/index.js live "${args[@]}"
```

- [ ] **Step 2: Validate the YAML**

Run: `node -e "const y=require('yaml');y.parse(require('fs').readFileSync('.github/workflows/mark-live.yml','utf8'));console.log('YAML_OK')"` (if the `yaml` package is not in node_modules, use `npx -y yaml@2 …` or `python3 -c 'import yaml,sys;yaml.safe_load(open(sys.argv[1]))' .github/workflows/mark-live.yml`). If `actionlint` is installed (`which actionlint`), run it too.

Also sanity-check the range shell on this machine against pbbls, without the arkaik call: copy the body of the "Find the previous…" step into a scratch script, set `GITHUB_REPOSITORY=alexisbohns/pbbls`, `ENVIRONMENT='Production – pbbls'`, `SHA=<newest Production – pbbls deployment sha>`, `DEPLOYMENT_ID=<its id>`, `GITHUB_OUTPUT=/dev/null`, run it inside `~/code/pbbls` and confirm it prints a `Range:` line and a non-empty `Pull requests:` list and writes a `mentions.json` array (delete the files after).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/mark-live.yml && \
git commit -m "ci: mark-live — a reusable workflow that marks a deploy's acceptances live (#424 follow-up)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Task 6: Docs and the part 3 PR

**Files:** `docs/hosted-projects.md` ("A token for deployments" section).

- [ ] **Step 1:** After the curl block and its `--fail-with-body` sentence, add:

````markdown
You rarely need the curl. The CLI wraps it — `arkaik live --platform web
--detail "$URL" AC-guest-checkout` — and derives the ids for you from the pull
requests a deploy shipped when you hand it a `--mentions` file (see `arkaik
live --help`). And the **`mark-live` reusable workflow** does all of it from a
`deployment_status` event: it finds the previous successful deploy of the same
environment, collects the pull requests merged in between, reads them with the
same `AC-id@platform` rules the GitHub App applies on merge, and calls the
door. One file in your repository:

```yaml
name: mark-live
on: deployment_status
jobs:
  web:
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production – my-app'
    uses: alexisbohns/arkaik/.github/workflows/mark-live.yml@main
    with:
      platform: web
      paths: apps/web
      sha: ${{ github.event.deployment.sha }}
      environment: ${{ github.event.deployment.environment }}
      deployment_id: ${{ github.event.deployment.id }}
      detail: ${{ github.event.deployment_status.environment_url }}
    secrets:
      ARKAIK_RELEASE_TOKEN: ${{ secrets.ARKAIK_RELEASE_TOKEN }}
```

`paths` is for monorepos: a bare `AC-x` mention counts only when that pull
request touched a file under one of the prefixes, so an iOS-only pull request
that forgot `@ios` does not mark web live. Leave it out in a single-platform
repository. On the first run there is no previous deploy to measure from, and
the workflow marks nothing rather than guessing — pass explicit `ids` once, or
let the next deploy be the first real one.
````

Then replace the per-platform table's third column so web reads "the `mark-live` workflow on `deployment_status`", android reads "the same workflow with explicit `ids` from the step that promotes to production — or a scheduled poll of the Play Developer API track status that computes them", ios reads "a **scheduled** workflow that asks App Store Connect for the version's state and, when it reads as released, calls the same workflow with explicit `ids` (`READY_FOR_SALE` in the classic API; newer API versions name the state differently, so check yours) — approval is asynchronous, and no repository event marks it".

- [ ] **Step 2:** Commit `docs(hosted): the mark-live workflow is the way in (#424 follow-up)`; `gh stack submit --auto --open`; `gh pr edit` with a body and this Lab Note:

```yaml
en:
  title: "Your production deploys can mark themselves live"
  summary: "Add one workflow file and every production deploy tells arkaik which acceptances just went live on that platform — read from the pull requests it shipped, with the deploy URL as evidence. No scripts to write, no ids to remember."
fr:
  title: "Tes déploiements en production se marquent live tout seuls"
  summary: "Ajoute un fichier de workflow et chaque déploiement en production dit à arkaik quels critères viennent de passer live sur cette plateforme — lus dans les pull requests qu'il a embarquées, avec l'URL du déploiement en preuve. Rien à scripter, aucun id à retenir."
suggested:
  molecule: arkaik
  type: feature
  tags: [ci, lifecycle, github-app]
```

- [ ] **Step 3:** Read all three PRs' comments for the Lab Note reminder; fix bodies if needed. Run the full verification: `npm run test:mentions && npm run test:pr-plan && npm run test:cli && npm run lint && rm -rf .next && npx tsc --noEmit -p . && npm run generate && git diff --exit-code --stat && DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:github && npm run build`.

---

# After the stack lands — the pbbls caller (separate repo, one PR)

## Task 7: pbbls `.github/workflows/mark-live.yml`

- [ ] **Step 1:** In `~/code/pbbls`, on a branch from main, create:

```yaml
# Marks the acceptances a production web deploy carried `live` in the hosted
# arkaik project (docs/arkaik/arkaik.json), via arkaik's reusable workflow.
# Vercel emits a deployment_status for every deploy; only a successful
# production one for the web app counts. apps/web scopes bare AC-x mentions.
name: mark-live

on: deployment_status

jobs:
  web:
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production – pbbls'
    uses: alexisbohns/arkaik/.github/workflows/mark-live.yml@main
    with:
      platform: web
      paths: apps/web
      sha: ${{ github.event.deployment.sha }}
      environment: ${{ github.event.deployment.environment }}
      deployment_id: ${{ github.event.deployment.id }}
      detail: ${{ github.event.deployment_status.environment_url }}
    secrets:
      ARKAIK_RELEASE_TOKEN: ${{ secrets.ARKAIK_RELEASE_TOKEN }}
```

- [ ] **Step 2:** Open the PR with a Lab Note (pbbls has its own pipeline; `suggested.molecule` is pbbls's slug — read pbbls's CLAUDE.md for it). Tell the user: mint a `release:append` token in arkaik settings and add it as the `ARKAIK_RELEASE_TOKEN` repository secret before merging; the first deploy after merge marks nothing (no previous successful deploy recorded under this workflow is fine — the previous-deploy lookup uses Vercel's deployments, which already exist, so the first run should already find a range).
