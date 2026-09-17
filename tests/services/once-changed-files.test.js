#!/usr/bin/env node

/**
 * `onceChangedFiles` (lib/services/github/pull-request.ts) — the per-delivery
 * memo that keeps "one delivery makes at most one changed-files request" true
 * now that two halves want the list (issue #440, part 2).
 *
 * Its own file rather than a case in quality-webhook.test.js: that suite
 * stubs `pull-request.ts` out entirely, which is exactly the module this
 * function lives in.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-once-changed-files");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

// pull-request.ts is large and imports plenty; the function under test is pure
// and self-contained, so it is extracted by name rather than by loading the
// whole module and its database seams.
fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

const source = fs.readFileSync(path.join(ROOT, "lib/services/github/pull-request.ts"), "utf8");
const marker = "export function onceChangedFiles";
const startIndex = source.indexOf(marker);
if (startIndex === -1) { console.log("FAIL: onceChangedFiles not found in pull-request.ts"); process.exit(1); }
// From the declaration to the blank line that follows its closing brace.
const endIndex = source.indexOf("\n}\n", startIndex) + 3;
const { outputText } = ts.transpileModule(source.slice(startIndex, endIndex), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const outFile = path.join(BUILD_DIR, "once.js");
fs.writeFileSync(outFile, outputText);
const { onceChangedFiles } = require(outFile);

const PR = { repoFullName: "acme/notes-app", number: 7, installationId: null };
const RESULT = { ok: true, changed: { paths: ["apps/web/page.tsx"], incomplete: [] } };

(async () => {
  let calls = 0;
  const once = onceChangedFiles(async () => { calls++; return RESULT; });

  const [a, b] = await Promise.all([once(PR), once(PR)]);
  check("two concurrent asks make one call", calls === 1, `${calls} calls`);
  check("both asks get the same result", a === RESULT && b === RESULT);

  const c = await once(PR);
  check("a later ask still makes no new call", calls === 1, `${calls} calls`);
  check("the later ask gets the same result", c === RESULT);

  // Keyed by the pull request, so a different one is a different question.
  await once({ ...PR, number: 8 });
  check("a different pull request is fetched on its own", calls === 2, `${calls} calls`);

  // THE PROMISE IS MEMOIZED, NOT THE VALUE. `applyPullRequestEvent` throws a
  // GithubTransientError on a 5xx precisely so the route can release the
  // delivery claim and let GitHub redeliver; a memo that re-fetched after a
  // rejection would make one delivery issue the request twice.
  let boomCalls = 0;
  const failing = onceChangedFiles(async () => { boomCalls++; throw new Error("503"); });
  const first = await failing(PR).then(() => "resolved", (e) => e.message);
  const second = await failing(PR).then(() => "resolved", (e) => e.message);
  check("a rejection is shared, not retried", boomCalls === 1 && first === "503" && second === "503", `${boomCalls} calls, ${first}/${second}`);

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})();
