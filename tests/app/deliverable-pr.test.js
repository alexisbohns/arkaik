#!/usr/bin/env node

/**
 * Recovering a PR number from a deliverable (lib/utils/deliverable-pr.ts) — the
 * URL is authoritative, the `pr-<n>` id convention is the fallback, and neither
 * is guaranteed to be there at all.
 *
 * Transpiled the same way as load-command-palette.js: the module has no
 * imports, so this needs no bundler and no database.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-deliverable-pr");

function loadDeliverablePr() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "deliverable-pr.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "deliverable-pr.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  fs.writeFileSync(path.join(BUILD_DIR, "deliverable-pr.js"), outputText);
  return require(path.join(BUILD_DIR, "deliverable-pr.js"));
}

const { prNumberOf, repoFromUrl } = loadDeliverablePr();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// --- from the URL, which wins ------------------------------------------------
assert(
  prNumberOf({ url: "https://github.com/alexisbohns/arkaik/pull/376" }) === 376,
  "a GitHub pull URL yields its number",
);
assert(
  prNumberOf({ url: "https://gitlab.com/g/p/-/merge_requests/42" }) === 42,
  "a GitLab merge_requests URL yields its number too",
);
assert(
  prNumberOf({ url: "https://github.com/o/r/pull/376/files" }) === 376,
  "a deep link past the number still yields it",
);
assert(
  prNumberOf({ url: "https://github.com/o/r/pull/376#issuecomment-1" }) === 376,
  "…and so does a fragment",
);
assert(
  prNumberOf({ deliverable_id: "pr-1", url: "https://github.com/o/r/pull/376" }) === 376,
  "the URL beats the id when they disagree — the id is a naming habit, the URL is the destination",
);

// --- from the id, the fallback ----------------------------------------------
assert(prNumberOf({ deliverable_id: "pr-123" }) === 123, "the CLI's `pr-<n>` id convention yields its number");
assert(prNumberOf({ deliverable_id: "PR_77" }) === 77, "…case and separator insensitively");
assert(prNumberOf({ deliverable_id: "mr-9" }) === 9, "…and the merge-request spelling");
assert(
  prNumberOf({ deliverable_id: "pr-123", url: "https://example.com/notes/x" }) === 123,
  "a non-PR URL falls through to the id rather than swallowing it",
);

// --- nothing to recover ------------------------------------------------------
assert(prNumberOf({}) === null, "a deliverable with neither yields null");
assert(
  prNumberOf({ deliverable_id: "01J8XZ0000000000000000" }) === null,
  "a ULID id is not a PR number",
);
assert(
  prNumberOf({ deliverable_id: "prototype-3" }) === null,
  "an id that merely starts with 'pr' is not the convention",
);
assert(
  prNumberOf({ url: "https://github.com/o/r/pulls" }) === null,
  "a PR URL with no number yields null rather than NaN",
);

// --- repoFromUrl -------------------------------------------------------------
assert(
  repoFromUrl("https://github.com/alexisbohns/arkaik/pull/376") === "alexisbohns/arkaik",
  "a GitHub pull URL names its repository",
);
assert(
  repoFromUrl("https://github.com/o/r/pull/376/files") === "o/r",
  "…whatever follows the number",
);
assert(
  repoFromUrl("https://gitlab.com/group/project/-/merge_requests/42") === "group/project",
  "GitLab's `/-/` infix is not mistaken for the repository",
);
assert(
  repoFromUrl("https://gitlab.com/group/sub/project/-/merge_requests/42") === "group/project",
  "a nested GitLab subgroup still yields owner and repo, not the middle segment",
);
assert(
  repoFromUrl("https://git.acme.internal/team/service/pull/9") === "team/service",
  "a self-hosted forge works — the path is read, not a host allowlist",
);
assert(repoFromUrl("https://example.com/notes/x") === null, "a non-PR URL names no repository");
assert(repoFromUrl(undefined) === null, "no URL, no repository");
assert(repoFromUrl("https://github.com/pull/376") === null, "a URL too short to hold owner and repo yields null");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} deliverable PR test(s) failed`);
  process.exit(1);
}
console.log("\nAll deliverable PR tests passed");
