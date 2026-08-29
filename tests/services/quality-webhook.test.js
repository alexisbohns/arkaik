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
check("isFindingId rejects empty segments", !isFindingId("F-----01"));

// The {3,80} cap on FINDING_TOKEN is headroom, not a real limit — but past it
// a token is dropped whole rather than truncated and re-checked. 90
// characters after "F-" cannot be matched at all: the `\b` the token needs
// can never land within the first 80 of them.
const overlong = mentionedFindings(ev("", `F-${"a".repeat(90)} trailing text`));
check("a token past the 80-char cap vanishes rather than truncating", overlong.length === 0, JSON.stringify(overlong));

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

// The dedupe key is `${repo}#${number}`, not the bare number — a same-numbered
// issue in two different repos must survive as two refs.
const twoRepos = closedIssues(ev("", "Closes #12 and closes other/repo#12"));
check(
  "the dedupe key includes the repo, so the same number in two repos survives",
  twoRepos.length === 2 && twoRepos.some((r) => r.repo === REPO && r.number === 12) && twoRepos.some((r) => r.repo === "other/repo" && r.number === 12),
  JSON.stringify(twoRepos),
);

const severalRefs = closedIssues(ev("", "Closes #1, fixes #2, resolves #3"));
check(
  "several distinct references in one body are all kept",
  severalRefs.length === 3 && [1, 2, 3].every((n) => severalRefs.some((r) => r.number === n)),
  JSON.stringify(severalRefs),
);

// [\s:]{1,20} is why a colon and a wrapped line both still separate a keyword
// from its reference.
const colonForm = closedIssues(ev("", "Closes: #12"));
check("a colon between keyword and reference is recognised", colonForm.length === 1 && colonForm[0].number === 12, JSON.stringify(colonForm));

const wrappedForm = closedIssues(ev("", "Closes\n#12"));
check("a line-wrapped keyword and reference are recognised", wrappedForm.length === 1 && wrappedForm[0].number === 12, JSON.stringify(wrappedForm));

// GitHub does not honour a closing keyword in a PR's TITLE — only its body (or
// a commit message, which this module never sees at all).
const titleOnly = closedIssues(ev("Closes #12", ""));
check("a closing keyword in the title alone closes nothing", titleOnly.length === 0, JSON.stringify(titleOnly));

// --- fenced code is not GitHub syntax ----------------------------------------

const fencedBody = [
  "Regular text before the fence.",
  "```",
  "Mentioning F-2026-08-SEC-web-01 and Closes #99 inside a fence does nothing.",
  "```",
  "But F-2026-08-SEC-web-02 and Closes #100 outside the fence still works.",
].join("\n");

const findingsPastFence = mentionedFindings(ev("", fencedBody));
check(
  "a finding id inside a fence is invisible, the one outside still resolves",
  findingsPastFence.length === 1 && findingsPastFence[0] === "F-2026-08-SEC-web-02",
  JSON.stringify(findingsPastFence),
);

const closuresPastFence = closedIssues(ev("", fencedBody));
check(
  "a closing keyword inside a fence is invisible, the one outside still resolves",
  closuresPastFence.length === 1 && closuresPastFence[0].number === 100,
  JSON.stringify(closuresPastFence),
);

// --- parseIssueRef -----------------------------------------------------------

check("parseIssueRef reads a plain URL", JSON.stringify(parseIssueRef("https://github.com/acme/notes-app/issues/44")) === JSON.stringify({ repo: "acme/notes-app", number: 44 }));
check("a trailing slash does not break the match", parseIssueRef("https://github.com/acme/notes-app/issues/44/")?.number === 44);
check("http and www are tolerated", parseIssueRef("http://www.github.com/acme/notes-app/issues/44")?.number === 44);
check("case is normalised", parseIssueRef("https://github.com/ACME/Notes-App/issues/44")?.repo === "acme/notes-app");
check("a pull URL is not an issue", parseIssueRef("https://github.com/acme/notes-app/pull/44") === undefined);
check("junk is undefined", parseIssueRef("not a url") === undefined);
check("a copied comment-fragment link still reads the issue number", parseIssueRef("https://github.com/acme/notes-app/issues/44#issuecomment-9")?.number === 44);
check("undefined is undefined", parseIssueRef(undefined) === undefined);
check("null is undefined", parseIssueRef(null) === undefined);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
