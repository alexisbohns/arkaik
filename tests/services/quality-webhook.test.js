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
const { scanFindings, closedIssues, parseIssueRef, isFindingId } = kritik;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const REPO = "acme/notes-app";
const ev = (title, body) => ({ title, body, repoFullName: REPO });

// --- finding ids -------------------------------------------------------------

// A CLOSING VERB CLOSES. A bare id refers. This is the whole of issue #440:
// pbbls#832 listed five findings in a follow-up table and closed all five.
const verbed = scanFindings(ev("", "Closes F-2026-08-SEC-web-01."));
check("a verb in the body closes", verbed.closed.length === 1 && verbed.closed[0] === "F-2026-08-SEC-web-01", JSON.stringify(verbed));
check("a closed id is not also reported as mentioned", verbed.mentioned.length === 0, JSON.stringify(verbed));

for (const keyword of ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved", "CLOSES", "Fixes"]) {
  const scan = scanFindings(ev("", `${keyword} F-2026-08-SEC-web-01`));
  check(`"${keyword} F-…" closes`, scan.closed.length === 1, JSON.stringify(scan));
}

const bare = scanFindings(ev("", "Adjacent to F-2026-08-PLT-ios-02, not fixed here."));
check("a bare id closes nothing", bare.closed.length === 0, JSON.stringify(bare));
check("a bare id is reported as mentioned", bare.mentioned.length === 1 && bare.mentioned[0] === "F-2026-08-PLT-ios-02", JSON.stringify(bare));

// GitHub does not honour a closing keyword in a pull request TITLE, and this
// grammar is GitHub's. A title that names one is reported, never acted on.
const inTitle = scanFindings(ev("Closes F-2026-08-SEC-web-01", ""));
check("a closing verb in the title closes nothing", inTitle.closed.length === 0, JSON.stringify(inTitle));
check("a closing verb in the title is reported as mentioned", inTitle.mentioned.length === 1 && inTitle.mentioned[0] === "F-2026-08-SEC-web-01", JSON.stringify(inTitle));

// One keyword, one id — exactly as GitHub requires a keyword before each issue
// it closes. The rest are reported so the mistake is loud at merge.
const commaList = scanFindings(ev("", "Closes F-2026-08-SEC-web-01, F-2026-08-SEC-web-02, F-2026-08-SEC-web-03"));
check("a comma list closes only the id the verb names", commaList.closed.length === 1 && commaList.closed[0] === "F-2026-08-SEC-web-01", JSON.stringify(commaList));
check("the rest of a comma list is reported as mentioned", commaList.mentioned.length === 2, JSON.stringify(commaList));

// [\s:]{1,20} is why the repo's own colon convention and a wrapped line both
// still separate a keyword from the id it closes.
const colonFinding = scanFindings(ev("", "Closes: F-2026-08-SEC-web-01"));
check("a colon between verb and id is recognised", colonFinding.closed.length === 1, JSON.stringify(colonFinding));

// SAME LINE, deliberately unlike `closedIssues`. `[\s:]{1,20}` would match a
// newline, and a heading that DECLINES a finding ends in a verb: "Findings we
// did NOT fix:" reached the id on the line below and closed it. A `Closes`
// wrapped away from its id now reports instead, which is the recoverable way
// round.
const wrappedFinding = scanFindings(ev("", "Closes\nF-2026-08-SEC-web-01"));
check("a verb cannot reach an id on the next line", wrappedFinding.closed.length === 0, JSON.stringify(wrappedFinding));
check("the id it could not reach is reported instead", wrappedFinding.mentioned.length === 1, JSON.stringify(wrappedFinding));

// The shape that made this a Critical finding: prose declining a list of
// findings, where the heading's last word is a closing keyword.
const declinedList = scanFindings(ev("", "Findings we did NOT fix:\n\nF-2026-08-SEC-web-01\nF-2026-08-SEC-web-02"));
check("a heading that declines findings closes none of them", declinedList.closed.length === 0, JSON.stringify(declinedList));
check("the declined findings are reported", declinedList.mentioned.length === 2, JSON.stringify(declinedList));

const declinedTight = scanFindings(ev("", "Findings we did NOT fix:\nF-2026-08-SEC-web-01"));
check("not even across a single newline", declinedTight.closed.length === 0, JSON.stringify(declinedTight));

// THE RESIDUAL, pinned on purpose rather than left to be discovered. A verb
// beside an id on one line closes it, negated or not — exactly what GitHub
// does with `won't fix #12`. Bounding the separator cannot see intent, and a
// list of negation words is a heuristic this grammar deliberately does not
// carry. Part B's surface check is the second opinion on this case.
const negatedSameLine = scanFindings(ev("", "Won't fix: F-2026-08-SEC-web-01"));
check("a negated verb on the SAME line still closes — known, accepted", negatedSameLine.closed.length === 1, JSON.stringify(negatedSameLine));

// The `i` flag is for the KEYWORD. `FINDING_TOKEN` has no `i`, so a lowercase
// `f-` is a token the other channel can never produce; admitting it here made
// the two channels disagree about what a finding id is.
const lowercased = scanFindings(ev("", "Closes f-2026-08-sec-web-01"));
check("a lowercase f- closes nothing", lowercased.closed.length === 0, JSON.stringify(lowercased));
check("a lowercase f- is not reported either — it is not an id", lowercased.mentioned.length === 0, JSON.stringify(lowercased));

// `splitOnFencedCode` returns RUNS rather than one joined string, and the
// closing channel depends on that as much as `closedIssues` does: a verb
// before a fence must not reach an id after it. Pinned so a future refactor
// that rejoins the runs cannot pass.
const findingFenceBleed = scanFindings(ev("", ["The crash is fixed", "```", "stack trace", "```", "F-2026-08-SEC-web-01 tracked this."].join("\n")));
check("a verb before a fence cannot reach an id after it", findingFenceBleed.closed.length === 0, JSON.stringify(findingFenceBleed));

const quotedFence = scanFindings(ev("", ["> ```", "> Closes F-2026-08-SEC-web-01", "> ```", "Closes F-2026-08-SEC-web-02"].join("\n")));
check("a blockquoted fence hides a closure the same way a bare one does", quotedFence.closed.length === 1 && quotedFence.closed[0] === "F-2026-08-SEC-web-02", JSON.stringify(quotedFence));

const unclosedFindingFence = scanFindings(ev("", ["Before the fence.", "```", "Closes F-2026-08-SEC-web-01"].join("\n")));
check("an unclosed fence swallows a closure after it", unclosedFindingFence.closed.length === 0, JSON.stringify(unclosedFindingFence));

// An id named under a verb AND bare elsewhere is closed once, not both.
const both = scanFindings(ev("F-2026-08-SEC-web-01", "Closes F-2026-08-SEC-web-01 — see F-2026-08-SEC-web-01 above."));
check("an id both closed and mentioned counts only as closed", both.closed.length === 1 && both.mentioned.length === 0, JSON.stringify(both));

const hyphenated = scanFindings(ev("", "Fixes F-2026-08-A11Y-cross-surface-03."));
check("a hyphenated surface and domain survive", hyphenated.closed[0] === "F-2026-08-A11Y-cross-surface-03", JSON.stringify(hyphenated));

const deduped = scanFindings(ev("", "Closes F-2026-08-SEC-web-01 and closes F-2026-08-SEC-web-01 again"));
check("deduped", deduped.closed.length === 1, JSON.stringify(deduped));

const nearMisses = scanFindings(ev("", "Closes F-nope, closes F-2026-08-SEC-web-, closes F-2026-08-SEC-web-1 and Format-99"));
check("near misses rejected in both channels", nearMisses.closed.length === 0 && nearMisses.mentioned.length === 0, JSON.stringify(nearMisses));

check("isFindingId accepts the minted shape", isFindingId("F-2026-08-SEC-web-01"));
check("isFindingId rejects a one-digit counter", !isFindingId("F-2026-08-SEC-web-1"));
check("isFindingId rejects too few segments", !isFindingId("F-2026-SEC-01"));
check("isFindingId rejects empty segments", !isFindingId("F-----01"));

// The {3,80} cap on the token is headroom, not a real limit — but past it a
// token is dropped whole rather than truncated and re-checked. 90 characters
// after "F-" cannot be matched at all: the `\b` the token needs can never
// land within the first 80 of them.
const overlong = scanFindings(ev("", `Closes F-${"a".repeat(90)} trailing text`));
check("a token past the 80-char cap vanishes rather than truncating", overlong.closed.length === 0 && overlong.mentioned.length === 0, JSON.stringify(overlong));

// Attacker-influenced input: a PR body is anyone-can-open-a-fork input, and
// GitHub allows up to 65,536 characters of it. Both channels must be linear.
// TWO SHAPES, because they stress different halves: a run of bare keywords
// exercises the match path, while a keyword followed by 90 id-shaped
// characters forces `[A-Za-z0-9-]{3,80}\b` to walk its whole range and fail
// at every start position — which is the claim the bound is really about.
for (const [name, hostile] of [
  ["a run of keywords", "Closes F-".repeat(100000)],
  ["a run of unterminable tokens", `Closes F-${"a".repeat(90)} `.repeat(20000)],
]) {
  const start = Date.now();
  scanFindings(ev("", hostile));
  const elapsed = Date.now() - start;
  check(`${name} parses in bounded time`, elapsed < 1000, `${elapsed}ms`);
}

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

const findingsPastFence = scanFindings(ev("", fencedBody));
check(
  "a finding id inside a fence is invisible, the one outside still resolves",
  findingsPastFence.mentioned.length === 1 && findingsPastFence.mentioned[0] === "F-2026-08-SEC-web-02",
  JSON.stringify(findingsPastFence),
);

// The same for the closing channel: a fenced example of THIS grammar is inert.
const closingFinding = scanFindings(ev("", ["```", "Closes F-2026-08-SEC-web-01", "```", "Closes F-2026-08-SEC-web-02"].join("\n")));
check(
  "a fenced `Closes F-…` closes nothing, the one outside still does",
  closingFinding.closed.length === 1 && closingFinding.closed[0] === "F-2026-08-SEC-web-02",
  JSON.stringify(closingFinding),
);

const closuresPastFence = closedIssues(ev("", fencedBody));
check(
  "a closing keyword inside a fence is invisible, the one outside still resolves",
  closuresPastFence.length === 1 && closuresPastFence[0].number === 100,
  JSON.stringify(closuresPastFence),
);

const tildeFence = scanFindings(ev("", ["Before.", "~~~", "F-2026-08-SEC-web-09 is only in the fence.", "~~~", "F-2026-08-SEC-web-10 is outside."].join("\n")));
check(
  "a ~~~ fence hides content the same way a ``` fence does",
  tildeFence.mentioned.length === 1 && tildeFence.mentioned[0] === "F-2026-08-SEC-web-10",
  JSON.stringify(tildeFence),
);

const unclosedFence = closedIssues(ev("", ["Before the fence.", "```", "Closes #7"].join("\n")));
check("an unclosed fence swallows everything after it", unclosedFence.length === 0, JSON.stringify(unclosedFence));

// Splitting into runs, not one joined string: `[\s:]{1,20}` matches a
// newline, so gluing the text on either side of a stripped fence together let
// a dangling keyword before the fence reach a bare number after it.
const crossFenceBleed = closedIssues(ev("", ["The crash is fixed", "```", "stack trace", "```", "#124 tracked this."].join("\n")));
check("a keyword before a fence cannot reach a reference after it", crossFenceBleed.length === 0, JSON.stringify(crossFenceBleed));

// A fence closes only on a marker of the SAME character, at least as long as
// the one that opened it — not on any ``` or ~~~ line. A four-backtick fence
// wrapping a three-backtick example of the closing grammar must not be
// closed by that shorter inner marker.
const nestedFence = closedIssues(
  ev(
    "",
    ["Here is how you close an issue in this repo:", "````", "```", "Closes #99", "Closes #1", "````"].join("\n"),
  ),
);
check("a fenced example of the closing grammar does not leak through its own inner marker", nestedFence.length === 0, JSON.stringify(nestedFence));

// A mismatched marker character does not close a fence either: a ``` opener
// stays open through a ~~~ line and closes only on a real ```.
const mismatchedMarker = closedIssues(ev("", ["```", "Closes #5", "~~~", "Closes #6", "```"].join("\n")));
check("a ~~~ line does not close a ``` fence", mismatchedMarker.length === 0, JSON.stringify(mismatchedMarker));

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

// The {1,100} bound is GitHub's own repository-name ceiling — a cap short of
// it would silently drop a legal reference.
const repo100 = "a".repeat(100);
const repo101 = "a".repeat(101);
check("a 100-character repo name is within GitHub's ceiling and parses", parseIssueRef(`https://github.com/acme/${repo100}/issues/1`)?.repo === `acme/${repo100}`);
check("a 101-character repo name exceeds the cap and does not parse", parseIssueRef(`https://github.com/acme/${repo101}/issues/1`) === undefined);

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
function state({ findings = [FINDING()], decidedIds = [] } = {}) {
  const appended = [];
  return {
    appended,
    readState: async () => [
      {
        projectId: "prj_1",
        findings,
        decidedFindingIds: new Set(decidedIds),
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

  const already = state({ decidedIds: ["F-2026-08-SEC-web-01"] });
  const secondMerge = await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-01." }), { readState: already.readState });
  check("a second merge appends nothing", already.appended.length === 0 && secondMerge.some((o) => o.status === "unchanged"), JSON.stringify(secondMerge));

  // A finding decided by a `quality.finding.accepted` event still looks
  // "open" in the unfolded snapshot this pass reads — `decidedFindingIds` is
  // what stops a merge from treating that as still-outstanding and silently
  // overwriting a recorded accept-risk decision with a resolve.
  const acceptedByEvent = state({ decidedIds: ["F-2026-08-SEC-web-01"] });
  const acceptedOutcomes = await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-01." }), { readState: acceptedByEvent.readState });
  check(
    "a finding decided via quality.finding.accepted reports unchanged, not resolved",
    acceptedByEvent.appended.length === 0 && acceptedOutcomes.some((o) => o.status === "unchanged" && o.findingId === "F-2026-08-SEC-web-01"),
    JSON.stringify(acceptedOutcomes),
  );

  const typo = state();
  const unknown = await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-99." }), { readState: typo.readState });
  check("an unmatched id is reported, not swallowed", typo.appended.length === 0 && unknown.some((o) => o.status === "unknown" && o.findingId === "F-2026-08-SEC-web-99"), JSON.stringify(unknown));

  // ISSUE #440. A bare id resolves nothing, and says so — the delivery
  // response is the one place anybody looks to find out what happened.
  const named = state();
  const mentions = await applyQualityResolutions(merged({ body: "Adjacent to F-2026-08-SEC-web-01; not fixed here." }), { readState: named.readState });
  check("a bare id appends nothing", named.appended.length === 0, JSON.stringify(named.appended));
  check(
    "a bare id is reported as mentioned",
    mentions.some((o) => o.status === "mentioned" && o.findingId === "F-2026-08-SEC-web-01"),
    JSON.stringify(mentions),
  );
  check(
    "the mentioned hint pins the exact wording, and stays true for a wrapped verb",
    mentions.find((o) => o.status === "mentioned")?.hint ===
      "named but not closed — write `Closes F-2026-08-SEC-web-01` in the PR body, verb and id on one line with nothing but spaces or a colon between them",
    JSON.stringify(mentions),
  );

  // Prose that happens to look id-shaped is not a report. Only a finding the
  // project actually holds earns one.
  const ghost = state();
  const ghostOutcomes = await applyQualityResolutions(merged({ body: "Unrelated to F-2026-08-SEC-web-99." }), { readState: ghost.readState });
  check("a bare id nobody holds is not reported", ghostOutcomes.every((o) => o.status !== "mentioned" && o.status !== "unknown"), JSON.stringify(ghostOutcomes));

  // An id under a verb that matches nothing IS reported — the author asserted
  // a closure and it failed, which is actionable. A bare one is just text.
  const assertedTypo = state();
  const assertedOutcomes = await applyQualityResolutions(merged({ body: "Closes F-2026-08-SEC-web-99." }), { readState: assertedTypo.readState });
  check("an id under a verb that matches nothing is still unknown", assertedOutcomes.some((o) => o.status === "unknown" && o.findingId === "F-2026-08-SEC-web-99"), JSON.stringify(assertedOutcomes));

  // A finding already decided earns no mention — it is not outstanding, so
  // there is nothing for the author to do about it. The WHOLE array is
  // asserted rather than the absence of one status: `every(o => o.status !==
  // "mentioned")` is satisfied by an empty result too, and cannot tell
  // "correctly skipped" from "the pass produced nothing at all".
  for (const status of ["resolved", "accepted-risk", "refuted"]) {
    const settled = state({ findings: [FINDING({ status })] });
    const settledOutcomes = await applyQualityResolutions(merged({ body: "See F-2026-08-SEC-web-01." }), { readState: settled.readState });
    check(
      `a bare id naming a ${status} finding falls through to nothing_to_do`,
      JSON.stringify(settledOutcomes) === JSON.stringify([{ status: "nothing_to_do" }]),
      JSON.stringify(settledOutcomes),
    );
  }

  const decidedByEvent = state({ decidedIds: ["F-2026-08-SEC-web-01"] });
  const decidedOutcomes = await applyQualityResolutions(merged({ body: "See F-2026-08-SEC-web-01." }), { readState: decidedByEvent.readState });
  check(
    "a bare id naming an event-decided finding falls through to nothing_to_do",
    JSON.stringify(decidedOutcomes) === JSON.stringify([{ status: "nothing_to_do" }]),
    JSON.stringify(decidedOutcomes),
  );

  // `no_quality_data` keeps its narrow meaning: NO linked project holds what
  // the PR named. A project that holds the finding and simply had nothing to
  // do about it is a different answer, and conflating the two told an author
  // "no quality data" about a project whose quality data we had just read.
  const heldButQuiet = state({ findings: [FINDING({ status: "refuted" })] });
  const quiet = await applyQualityResolutions(merged({ body: "See F-2026-08-SEC-web-01." }), { readState: heldButQuiet.readState });
  check("a project that holds the finding does not report no_quality_data", quiet[0]?.status !== "no_quality_data", JSON.stringify(quiet));

  const holdsNothing = state({ findings: [FINDING({ id: "F-2026-08-SEC-web-77" })] });
  const stranger = await applyQualityResolutions(merged({ body: "See F-2026-08-SEC-web-01." }), { readState: holdsNothing.readState });
  check("a project holding no named finding still reports no_quality_data", JSON.stringify(stranger) === JSON.stringify([{ status: "no_quality_data" }]), JSON.stringify(stranger));

  // A body that closes one finding and names another does both, in one pass.
  const mixed = state({ findings: [FINDING(), FINDING({ id: "F-2026-08-PLT-ios-02", surface: "ios" })] });
  const mixedOutcomes = await applyQualityResolutions(
    merged({ body: "Closes F-2026-08-SEC-web-01. Follow-up: F-2026-08-PLT-ios-02." }),
    { readState: mixed.readState },
  );
  check("one closed and one mentioned in the same body", mixed.appended.length === 1, JSON.stringify(mixed.appended));
  check(
    "the closed one resolves and the named one is only reported",
    mixedOutcomes.some((o) => o.status === "resolved" && o.findingId === "F-2026-08-SEC-web-01") &&
      mixedOutcomes.some((o) => o.status === "mentioned" && o.findingId === "F-2026-08-PLT-ios-02"),
    JSON.stringify(mixedOutcomes),
  );

  // A journal that refuses the append must not be reported as a resolution —
  // the delivery response is the one place anybody looks to see what happened.
  const refusing = {
    readState: async () => [
      { projectId: "prj_1", findings: [FINDING()], decidedFindingIds: new Set(), append: async () => [] },
    ],
  };
  const refused = await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-01." }), refusing);
  check("a refused append reports refused, not resolved", refused.length === 1 && refused[0].status === "refused" && refused[0].findingId === "F-2026-08-SEC-web-01", JSON.stringify(refused));

  // "the PR named nothing" and "no project holds what it named" are different
  // answers; the second is what a hosted project with no quality section gives.
  const noSection = { readState: async () => [] };
  const empty = await applyQualityResolutions(merged({ body: "Fixes F-2026-08-SEC-web-01." }), noSection);
  check("a PR naming a finding nobody holds is not 'no_mentions'", empty.length === 1 && empty[0].status === "no_quality_data", JSON.stringify(empty));

  const silent = state();
  const none = await applyQualityResolutions(merged({ body: "Just a refactor." }), { readState: silent.readState });
  check("a PR naming nothing reads no project at all", none.length === 1 && none[0].status === "no_mentions", JSON.stringify(none));

  // THE DEDUP GUARD, pinned. `scanFindings` already keeps a verb-closed id out
  // of `mentioned`, so the verb channel cannot collide — but a finding reached
  // through its own `issue_url` is matched by a path the parser never sees. A
  // mutation test proved this: deleting `matched.has(finding.id)` from the
  // skip left every other check green.
  const issueAndBare = state({ findings: [FINDING({ issue_url: `https://github.com/${REPO}/issues/44` })] });
  const issueAndBareOutcomes = await applyQualityResolutions(
    merged({ body: "Closes #44 — tracked as F-2026-08-SEC-web-01." }),
    { readState: issueAndBare.readState },
  );
  check(
    "a finding closed through its issue is not ALSO reported as mentioned",
    issueAndBareOutcomes.length === 1 && issueAndBareOutcomes[0].status === "resolved",
    JSON.stringify(issueAndBareOutcomes),
  );

  // Mentions must survive a refused append — which is the whole reason the
  // reporting loop sits ABOVE the `events.length === 0` bail. A refactor that
  // moved it below would pass every other check in this file.
  const refusedWithMention = {
    readState: async () => [{
      projectId: "prj_1",
      findings: [FINDING(), FINDING({ id: "F-2026-08-PLT-ios-02", surface: "ios" })],
      decidedFindingIds: new Set(),
      append: async () => [],
    }],
  };
  const refusedOutcomes = await applyQualityResolutions(
    merged({ body: "Closes F-2026-08-SEC-web-01. Follow-up: F-2026-08-PLT-ios-02." }),
    refusedWithMention,
  );
  check(
    "a mention is still reported when the append is refused",
    refusedOutcomes.some((o) => o.status === "refused") && refusedOutcomes.some((o) => o.status === "mentioned" && o.findingId === "F-2026-08-PLT-ios-02"),
    JSON.stringify(refusedOutcomes),
  );

  // The hint has to be true for every way an author can land here, not just
  // the bare-id one. Task 1's same-line rule created two more.
  const wrapped = state();
  const wrappedOut = await applyQualityResolutions(merged({ body: "Closes\nF-2026-08-SEC-web-01" }), { readState: wrapped.readState });
  check("a wrapped verb reports, and does not claim the verb was missing", wrappedOut[0]?.hint?.includes("verb and id on one line"), JSON.stringify(wrappedOut));

  const titled = state();
  const titledOut = await applyQualityResolutions(merged({ title: "Closes F-2026-08-SEC-web-01", body: "Nothing here." }), { readState: titled.readState });
  check("a title-only closure reports, and says the body is where it belongs", titledOut[0]?.hint?.includes("in the PR body"), JSON.stringify(titledOut));

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})();
