# Finding-closure grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merged pull request resolves a Kritik finding only when it says so with a closing verb, and says out loud when the fix does not appear to live where the finding does.

**Architecture:** Two parts, two branches, chained with `gh stack`. Part A changes the parse grammar in `lib/services/github/quality-parse.ts` and adds a `mentioned` outcome to `lib/services/github/quality.ts`. Part B gives the quality pass the pull request's changed files through a memoized fetcher shared with the delivery half, and warns when a resolved finding's surface owns a repository path the pull request never touched. Every new unit is pure and lands in the existing database-free suite.

**Tech Stack:** TypeScript, Next.js route handlers, plain-Node test scripts (`node tests/…`), the `tests/services/load-quality-parse.js` transpile-and-inject loader.

**Spec:** `docs/superpowers/specs/2026-09-17-finding-closure-grammar-design.md`

---

## File structure

| file | part | responsibility |
|---|---|---|
| `lib/services/github/quality-parse.ts` | A | **Modify.** `mentionedFindings` → `scanFindings`, returning `{ closed, mentioned }`. New `CLOSING_FINDING` pattern. |
| `lib/services/github/quality.ts` | A, B | **Modify.** A: read `scan.closed`, report `scan.mentioned`. B: read `profile`, fetch files lazily, attach `warning`. |
| `lib/services/github/quality-surface.ts` | B | **Create.** One pure function: does a resolved finding's surface path appear in the changed files? |
| `lib/services/github/pull-request.ts` | B | **Modify.** Add `onceChangedFiles`, a per-delivery memo around `FetchChangedFiles`. |
| `app/api/github/webhook/route.ts` | B | **Modify.** Build the memo once, hand it to both halves. |
| `tests/services/load-quality-parse.js` | B | **Modify.** Also compile `paths.ts` and `quality-surface.ts`. |
| `tests/services/quality-webhook.test.js` | A, B | **Modify.** All new cases. |
| `plugin-kritik/skills/kritik/SKILL.md` | A, B | **Modify.** The two-channel section; delete the warning callout. |
| `docs/hosted-projects.md` | A, B | **Modify.** The `mentioned` outcome and the `warning` field. |
| `docs/rfcs/kritik.md` | A | **Modify.** § 3.4 item 3 gets the verb. |

Both branches exist off `main`:

```
main → finding-closure-1-closing-verb → finding-closure-2-surface-warning
```

Part A's branch already exists and holds the spec commit.

---

# PART A — `finding-closure-1-closing-verb`

## Task 1: `scanFindings` — a verb closes, a bare id refers

**Files:**
- Modify: `lib/services/github/quality-parse.ts`
- Test: `tests/services/quality-webhook.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/services/quality-webhook.test.js`, change the destructure on line 20 from `mentionedFindings` to `scanFindings`:

```js
const { scanFindings, closedIssues, parseIssueRef, isFindingId } = kritik;
```

Then replace the whole `// --- finding ids ---` block (from `const found = mentionedFindings(...)` down to and including the `check("a pathological body parses in bounded time", ...)` line) with:

```js
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

const wrappedFinding = scanFindings(ev("", "Closes\nF-2026-08-SEC-web-01"));
check("a line-wrapped verb and id are recognised", wrappedFinding.closed.length === 1, JSON.stringify(wrappedFinding));

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
// GitHub allows up to 65,536 characters of it. Both channels must be linear,
// so a body of pathological repetitions has to finish well under a second.
const hostile = "Closes F-".repeat(100000);
const start = Date.now();
scanFindings(ev("", hostile));
const elapsed = Date.now() - start;
check("a pathological body parses in bounded time", elapsed < 1000, `${elapsed}ms`);
```

Also update the two fenced-code cases further down. Replace the `findingsPastFence` block with:

```js
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
```

and replace the `tildeFence` block with:

```js
const tildeFence = scanFindings(ev("", ["Before.", "~~~", "F-2026-08-SEC-web-09 is only in the fence.", "~~~", "F-2026-08-SEC-web-10 is outside."].join("\n")));
check(
  "a ~~~ fence hides content the same way a ``` fence does",
  tildeFence.mentioned.length === 1 && tildeFence.mentioned[0] === "F-2026-08-SEC-web-10",
  JSON.stringify(tildeFence),
);
```

- [ ] **Step 2: Run the suite to verify it fails**

```bash
npm run test:quality-webhook
```

Expected: FAIL — `TypeError: scanFindings is not a function`.

- [ ] **Step 3: Write the implementation**

In `lib/services/github/quality-parse.ts`, add the new pattern immediately after the `CLOSING_REFERENCE` constant:

```ts
/**
 * arkaik's own closing grammar: one of GitHub's nine keywords, then a finding
 * id. `Closes F-2026-08-SEC-web-01` closes; a bare id does not.
 *
 * ISSUE #440 IS WHY THIS EXISTS. A bare id used to close, so pbbls#832 —
 * which shipped one finding and named five more in a "Follow-ups" table —
 * resolved all six, and the matrix went on to answer "done" for a pillar
 * whose clients shipped none of it. A reference and a closure are different
 * acts, GitHub already distinguishes them with exactly these keywords, and
 * requiring the verb is the smallest thing that makes the distinction real.
 *
 * The keyword prefix and the `[\s:]{1,20}` separator are
 * {@link CLOSING_REFERENCE}'s, character for character — the two grammars
 * differ in what follows the verb, never in what counts as one, so an author
 * who knows `Closes: #12` already knows `Closes: F-…`. The colon is in the
 * class because this repo's own convention writes one.
 *
 * ONE VERB, ONE ID, like GitHub's own rule that a keyword closes the single
 * reference after it. `Closes F-a-01, F-b-02` closes the first and reports
 * the rest through {@link FindingScan.mentioned}, which is the loud failure
 * mode: the author is told at merge, in the delivery response, rather than
 * discovering it in the matrix months later.
 *
 * Linear like everything else here: the alternation's branches are
 * prefix-distinct, `[\s:]{1,20}` and `[A-Za-z0-9-]{3,80}` are both bounded,
 * and the trailing `\b` is the same non-backtracking terminator
 * {@link FINDING_TOKEN} uses.
 */
const CLOSING_FINDING =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[\s:]{1,20}(F-[A-Za-z0-9-]{3,80})\b/gi;
```

Then replace the whole `mentionedFindings` function (its JSDoc included) with:

```ts
/**
 * What a pull request says about findings: the ones it CLOSES, and the ones it
 * merely names.
 *
 * TWO SETS, NOT ONE LIST, because they are two different speech acts and the
 * App must not confuse them (issue #440). `closed` is acted on; `mentioned` is
 * reported and nothing more — `applyQualityResolutions` turns it into a
 * `mentioned` outcome so an author who expected the old behaviour is told, at
 * merge, in the one diagnostic surface the docs point them at.
 *
 * `closed` IS BODY-ONLY, matching {@link closedIssues} and GitHub itself,
 * which honours a closing keyword in a description and never in a title.
 * `mentioned` still reads BOTH, because naming a finding is arkaik's own
 * grammar and means the same thing wherever an author puts it — the same
 * split, for the same reason, that `mentionedAcceptances` and `closedIssues`
 * already have between them.
 *
 * An id under a verb AND named bare elsewhere is CLOSED, once. Reporting it in
 * both would tell an author their own closure was also a loose reference.
 *
 * Both channels strip fenced code first: a fence creates no reference on
 * GitHub's side, and this repo's own task-plan PRs quote this very syntax.
 */
export interface FindingScan {
  /** Ids a closing keyword names in the BODY. These resolve. */
  closed: string[];
  /** Ids named with no closing keyword, title or body. Reported, never acted on. */
  mentioned: string[];
}

export function scanFindings(event: Pick<PullRequestEvent, "title" | "body">): FindingScan {
  const closed = new Set<string>();
  if (event.body) {
    for (const run of splitOnFencedCode(event.body)) {
      for (const match of run.matchAll(CLOSING_FINDING)) {
        if (isFindingId(match[1])) closed.add(match[1]);
      }
    }
  }

  const mentioned = new Set<string>();
  for (const text of [event.title, event.body]) {
    if (!text) continue;
    for (const run of splitOnFencedCode(text)) {
      for (const match of run.matchAll(FINDING_TOKEN)) {
        if (isFindingId(match[0]) && !closed.has(match[0])) mentioned.add(match[0]);
      }
    }
  }

  return { closed: [...closed], mentioned: [...mentioned] };
}
```

Finally, update this file's header comment. Replace the paragraph beginning `// TWO CHANNELS, because two kinds of author write these PRs.` through the end of that paragraph with:

```ts
// TWO CHANNELS, because two kinds of author write these PRs. An agent working
// from `arkaik kritik issue` writes `Closes F-2026-08-SEC-web-01`, which is
// exactly why `mintFindingId` made the id quotable. A person working from the
// filed GitHub issue writes `Closes #123` and never sees a finding id at all.
// Reading only one channel would leave half the loop silent.
//
// BOTH CHANNELS NEED A VERB (issue #440). A bare id used to close the finding
// it named, so a PR that listed five findings in a "Follow-ups" table closed
// all five. Naming a finding and closing one are different acts; the verb is
// what tells them apart, and it is GitHub's own convention rather than a new
// one to learn.
```

- [ ] **Step 4: Run the suite to verify it passes**

```bash
npm run test:quality-webhook
```

Expected: every grammar line prints `PASS:`, then the process throws `TypeError: mentionedFindings is not a function` and exits non-zero. That throw is correct at this point — `quality.ts` still calls the old name, and Task 2 fixes it. Read the `PASS:` lines above the throw; if any of them says `FAIL:`, stop and fix the grammar before moving on.

- [ ] **Step 5: Commit**

```bash
git add lib/services/github/quality-parse.ts tests/services/quality-webhook.test.js
git commit -m "$(cat <<'EOF'
feat(github): a finding closes on a verb, not on being named (#440)

`Closes F-…` closes. A bare id is a reference and is returned
separately, for the resolution pass to report rather than act on.
The keyword and separator are `CLOSING_REFERENCE`'s exactly, so
`Closes: #12` and `Closes: F-…` are one convention, not two.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Fix the cross-reference the rename orphaned**

`closedIssues`'s JSDoc points at `mentionedFindings`, which no longer exists — and the sentence it makes is now half wrong, because `scanFindings`'s `closed` channel is body-only exactly like `closedIssues`. In `lib/services/github/quality-parse.ts`, replace this paragraph:

```ts
 * GitHub does not honour a closing keyword in a pull request's TITLE — only
 * in its description, or in a commit message the merge later carries in.
 * (See {@link mentionedFindings} above for why ITS scan still covers both —
 * a different grammar, not the same rule applied inconsistently.) Scanning
 * the title here would let arkaik mark a finding resolved while the GitHub
 * issue it names stays open, which is exactly the over-claim this loop
 * exists to avoid.
```

with:

```ts
 * GitHub does not honour a closing keyword in a pull request's TITLE — only
 * in its description, or in a commit message the merge later carries in.
 * {@link scanFindings} draws the same line for the same reason: its `closed`
 * channel is body-only too, and only its `mentioned` one — which closes
 * nothing — reads a title at all. Scanning the title here would let arkaik
 * mark a finding resolved while the GitHub issue it names stays open, which
 * is exactly the over-claim this loop exists to avoid.
```

Then check nothing else in the file still names the old symbol:

```bash
grep -n "mentionedFindings" lib/services/github/quality-parse.ts
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/services/github/quality-parse.ts
git commit -m "$(cat <<'EOF'
docs(github): closedIssues no longer points at a function that is gone

The rename orphaned the cross-reference, and made its sentence half
wrong besides: `scanFindings` closes from the body only, exactly like
`closedIssues`. It is the `mentioned` channel, which closes nothing,
that reads a title.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: the `mentioned` outcome

**Files:**
- Modify: `lib/services/github/quality.ts`
- Test: `tests/services/quality-webhook.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/services/quality-webhook.test.js`, inside the async IIFE at the bottom, add these cases immediately after the existing `const typo = state(); … check("an unmatched id is reported, not swallowed", …)` block:

```js
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
    "the mentioned hint names the verb to write",
    mentions.find((o) => o.status === "mentioned")?.hint === "named without a closing verb — write `Closes F-2026-08-SEC-web-01` to resolve it",
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

  // A finding already decided earns no mention either — it is not outstanding,
  // so there is nothing for the author to do about it.
  for (const status of ["resolved", "accepted-risk", "refuted"]) {
    const settled = state({ findings: [FINDING({ status })] });
    const settledOutcomes = await applyQualityResolutions(merged({ body: "See F-2026-08-SEC-web-01." }), { readState: settled.readState });
    check(`a bare id naming a ${status} finding is not reported`, settledOutcomes.every((o) => o.status !== "mentioned"), JSON.stringify(settledOutcomes));
  }

  const decidedByEvent = state({ decidedIds: ["F-2026-08-SEC-web-01"] });
  const decidedOutcomes = await applyQualityResolutions(merged({ body: "See F-2026-08-SEC-web-01." }), { readState: decidedByEvent.readState });
  check("a bare id naming an event-decided finding is not reported", decidedOutcomes.every((o) => o.status !== "mentioned"), JSON.stringify(decidedOutcomes));

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
```

- [ ] **Step 2: Run the suite to verify it fails**

```bash
npm run test:quality-webhook
```

Expected: FAIL — `mentionedFindings is not a function` (thrown from the compiled `quality.js`), so the resolution-pass section does not run at all.

- [ ] **Step 3: Write the implementation**

In `lib/services/github/quality.ts`:

(a) Change the import on line 7:

```ts
import { closedIssues, parseIssueRef, scanFindings } from "@/lib/services/github/quality-parse";
```

(b) Add the `mentioned` variant to `QualityResolutionOutcome`:

```ts
export type QualityResolutionOutcome =
  | { projectId: string; status: "resolved"; findingId: string; eventId: string }
  | { projectId: string; status: "unchanged"; findingId: string }
  | { projectId: string; status: "unknown"; findingId: string }
  | { projectId: string; status: "refused"; findingId: string }
  /**
   * The finding was NAMED, with no closing verb, and is still open (issue
   * #440). Nothing was written. Reported rather than swallowed because the
   * delivery response is the one diagnostic surface docs/hosted-projects.md
   * points people at, and a grammar change that produced a new silence would
   * be this round's defect at one remove.
   */
  | { projectId: string; status: "mentioned"; findingId: string; hint: string }
  | { status: "no_quality_data" }
  | { status: "no_mentions" };
```

(c) Add the hint builder just above `applyQualityResolutions`:

```ts
/** What a `mentioned` outcome tells the author to write instead. */
const mentionHint = (findingId: string) =>
  `named without a closing verb — write \`Closes ${findingId}\` to resolve it`;
```

(d) Replace the opening of `applyQualityResolutions`'s body — everything from `const mentioned = mentionedFindings(event);` down to and including the line `if (mentioned.length === 0 && issues.length === 0) return [{ status: "no_mentions" }];`, the four-line `// Read nothing when the PR claims nothing.` comment between them included — with:

```ts
  const scan = scanFindings(event);
  const issues = closedIssues(event);
  // Read nothing when the PR claims nothing. The overwhelming majority of
  // merges are this case, and a database round trip per project to discover it
  // would be a cost paid on every delivery for the rare one.
  //
  // A BARE MENTION COUNTS AS A CLAIM here, even though it resolves nothing:
  // deciding whether to report it needs the finding — does this project hold
  // it, and is it still open — and only the read has that. Paying for the
  // report is the point of issue #440; a mention nobody ever sees is not one.
  if (scan.closed.length === 0 && scan.mentioned.length === 0 && issues.length === 0) {
    return [{ status: "no_mentions" }];
  }
```

(e) Replace `for (const id of mentioned) {` with `for (const id of scan.closed) {`. The body of that loop is unchanged.

(f) Immediately after the `for (const finding of matched.values()) { … }` loop and **before** `if (events.length === 0) continue;`, insert:

```ts
    // Reported after the closures are decided, so `matched` is complete: an id
    // both closed by a verb and named bare elsewhere, or reached through its
    // own issue, is a closure and must not also be reported as a loose end.
    for (const id of scan.mentioned) {
      const finding = byId.get(id);
      // Unlike the `closed` channel above, an id nothing answers to is NOT
      // reported. There the author asserted a closure and it failed, which is
      // actionable; here it is prose that happened to look id-shaped, and
      // reporting it would make every PR discussing findings noisy.
      if (finding === undefined || matched.has(finding.id)) continue;
      // Nor is a finding somebody already decided: it is not outstanding, so
      // there is nothing the author could do about it.
      if (!isOpenFinding(finding) || state.decidedFindingIds.has(finding.id)) continue;
      outcomes.push({
        projectId: state.projectId,
        status: "mentioned",
        findingId: finding.id,
        hint: mentionHint(finding.id),
      });
    }
```

- [ ] **Step 4: Run the suite to verify it passes**

```bash
npm run test:quality-webhook
```

Expected: every line `PASS:`, exit code 0.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: no errors. (`main` lints clean, so any error is yours.)

- [ ] **Step 6: Commit**

```bash
git add lib/services/github/quality.ts tests/services/quality-webhook.test.js
git commit -m "$(cat <<'EOF'
feat(github): a named-but-not-closed finding is reported, not resolved (#440)

The resolution pass reads `scan.closed`, and turns `scan.mentioned`
into a `mentioned` outcome carrying the verb to write instead. Only
for a finding the project holds and that is still open — prose that
looks id-shaped, and findings somebody already decided, stay silent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: the pbbls#832 regression

**Files:**
- Test: `tests/services/quality-webhook.test.js`

- [ ] **Step 1: Write the test**

Add at the end of the async IIFE, immediately before the `fs.rmSync(BUILD_DIR, …)` line:

```js
  // --- issue #440, as it actually happened -----------------------------------
  //
  // pbbls#832 shipped the `content_reports` database primitive. Its diff
  // touched packages/supabase, docs and .github — no client file — and its
  // body carried a "Follow-ups — mostly already-filed findings" table naming
  // the five client-side findings still to do. All six were resolved. Five
  // launch-gating findings were marked fixed against a PR that could not have
  // fixed them, and criterion PLT-04 began answering "done" on every surface.
  const SURFACES = ["ios", "android", "web", "admin"];
  const pbblsFindings = [
    FINDING({ id: "F-2026-08-PLT-supabase-01", surface: "supabase", criterion_id: "PLT-04" }),
    FINDING({ id: "F-2026-08-PLT-ios-02", surface: "ios", criterion_id: "PLT-04" }),
    FINDING({ id: "F-2026-08-PLT-android-01", surface: "android", criterion_id: "PLT-04" }),
    FINDING({ id: "F-2026-08-PLT-web-01", surface: "web", criterion_id: "PLT-04" }),
    FINDING({ id: "F-2026-08-PLT-admin-01", surface: "admin", criterion_id: "PLT-04" }),
    FINDING({ id: "F-2026-08-PLT-cross-surface-01", surface: "cross-surface", criterion_id: "PLT-04" }),
  ];
  const pbblsBody = [
    "Ships the `content_reports` primitive.",
    "",
    "Closes F-2026-08-PLT-supabase-01",
    "",
    "## Follow-ups — mostly already-filed findings",
    "",
    "| Finding | Surface | What it needs |",
    "|---|---|---|",
    ...SURFACES.map((s, i) => `| F-2026-08-PLT-${s}-0${i === 0 ? 2 : 1} | ${s} | report affordance |`),
    "| F-2026-08-PLT-cross-surface-01 | all | payload symmetry |",
  ].join("\n");

  const pbbls = state({ findings: pbblsFindings });
  const pbblsOutcomes = await applyQualityResolutions(merged({ body: pbblsBody }), { readState: pbbls.readState });
  check(
    "pbbls#832: exactly one event is appended, for the finding the PR actually shipped",
    pbbls.appended.length === 1 && pbbls.appended[0].finding_id === "F-2026-08-PLT-supabase-01",
    JSON.stringify(pbbls.appended.map((e) => e.finding_id)),
  );
  check(
    "pbbls#832: the five follow-ups are reported, not resolved",
    pbblsOutcomes.filter((o) => o.status === "mentioned").length === 5 &&
      pbblsOutcomes.every((o) => o.status !== "resolved" || o.findingId === "F-2026-08-PLT-supabase-01"),
    JSON.stringify(pbblsOutcomes),
  );
```

- [ ] **Step 2: Run the suite**

```bash
npm run test:quality-webhook
```

Expected: both new lines `PASS:`, exit code 0. This test passes on the first run — Tasks 1 and 2 are what make it pass, and it exists to keep it that way.

- [ ] **Step 3: Commit**

```bash
git add tests/services/quality-webhook.test.js
git commit -m "$(cat <<'EOF'
test(github): pin issue #440 against the body that caused it

pbbls#832's real shape — one `Closes F-…` and a five-row follow-up
table — asserting one append and five reports.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Part A documentation

**Files:**
- Modify: `plugin-kritik/skills/kritik/SKILL.md`
- Modify: `docs/hosted-projects.md`
- Modify: `docs/rfcs/kritik.md:96`

- [ ] **Step 1: Rewrite the two-channel section in SKILL.md**

In `plugin-kritik/skills/kritik/SKILL.md`, replace everything from `The App reads two channels:` down to and including the closing `> block` (the callout beginning `> **Name a finding id in a PR only when that PR fixes it.**` and ending `> exactly what makes a PR *about* this syntax safe.`) with:

```markdown
The App reads two channels, and **both need a closing verb**:

- **`Closes F-2026-08-SEC-web-01`** — one of GitHub's nine closing keywords
  (`close`/`closes`/`closed`, `fix`/`fixes`/`fixed`,
  `resolve`/`resolves`/`resolved`), then the finding id, in the PR's **body**.
  This is the channel an agent working from `arkaik kritik issue` uses. Body
  only, because GitHub does not honour a closing keyword in a title either —
  and one keyword per id, exactly as GitHub requires one before each issue it
  closes. `Closes: F-…` with a colon works; so does a line-wrapped one.
- **`Closes #123`** — the same keywords against the filed GitHub issue, also
  body only. It reaches a finding through that finding's own `issue_url`, so it
  does nothing unless the issue you filed in step 8 is recorded there
  (`--issue-url` on `finding open`).

Both scans skip fenced code blocks, and only an **open** finding is closed this
way: `refuted` and `accepted-risk` are decisions somebody recorded, and a merge
does not overturn them.

**A finding id with no keyword is a reference, not a closure.** Write one freely
— in a follow-up table, in a "related work" note, in the sentence explaining
what this PR is *not* — and the App will leave it open. It does not stay silent
about it: the delivery response reports each one it recognised as

```json
{ "status": "mentioned", "findingId": "F-2026-08-PLT-ios-02",
  "hint": "named without a closing verb — write `Closes F-2026-08-PLT-ios-02` to resolve it" }
```

so a PR that meant to close one and forgot the verb says so at merge, in
**Advanced → Recent Deliveries**, rather than months later in the matrix.
```

- [ ] **Step 2: Add the outcome to `docs/hosted-projects.md`**

Find the paragraph at line 366 beginning `If nothing happens, **Advanced → Recent Deliveries** shows the response body,`. Immediately **after** that paragraph (before `A refusal plans no **promotion**…`), insert:

```markdown
The same response carries a `quality` array, one entry per finding the pull
request said something about. `resolved` means an event was appended;
`unchanged` means the finding was already decided; `unknown` means a
`Closes F-…` named an id no linked project holds; and `mentioned` means the
body named a still-open finding **without** a closing verb, so nothing was
written:

```json
{ "status": "mentioned", "findingId": "F-2026-08-PLT-ios-02",
  "hint": "named without a closing verb — write `Closes F-2026-08-PLT-ios-02` to resolve it" }
```

A finding closes only on `Closes`/`Fixes`/`Resolves` before its id, in the body.
That is deliberate: naming a finding in a follow-up table used to close it, and
a PR that shipped one of six closed all six.
```

- [ ] **Step 3: Update the RFC**

In `docs/rfcs/kritik.md`, replace line 96's trailing clause `(lane 1: a small workflow step greps the PR body for `finding_id`; lane 2: the webhook grows native support).` with:

```markdown
(lane 1: a small workflow step greps the PR body for `finding_id`; lane 2: the webhook grows native support). Lane 2 requires a closing verb — `Closes F-…` in the body, GitHub's own keywords — because a bare id read as a closure resolved findings a PR merely referred to (issue #440).
```

- [ ] **Step 4: Check nothing else documents the old grammar**

```bash
grep -rn "anywhere in the PR\|with no keyword needed\|title \*or\*" plugin-kritik/ docs/ README.md
```

Expected: no hits. If there are, update them the same way.

- [ ] **Step 5: Regenerate and verify**

```bash
npm run generate && npm run lint && git status --short
```

Expected: lint clean. `git status` should show only files you edited — if `npm run generate` dirtied a generated artifact, include it in the commit (CI diffs them).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs: a finding closes on a verb (#440)

SKILL.md's two-channel section, and the warning callout it no longer
needs — the callout existed to tell authors not to name a finding they
were not closing, which is now simply how the grammar reads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: verify and open Part A's PR

- [ ] **Step 1: Run every suite the change can reach**

```bash
npm run test:quality-webhook && npm run test:github && npm run test:github-app && npm run test:quality-events && npm run lint && npx tsc --noEmit -p tsconfig.json
```

Expected: all pass, exit code 0, lint clean. Paste the real output into the PR body — do not claim a pass you did not read.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin finding-closure-1-closing-verb
gh pr create --base main --title "A finding closes on a verb, not on being named" --body-file /tmp/part-a-body.md
```

Write that body file first, from this (a user-facing change, so it **needs** a Lab Note — see CLAUDE.md) (a user-facing change, so it **needs** a Lab Note — see CLAUDE.md):

````markdown
Part 1 of 2 for #440.

A merged pull request used to close any Kritik finding whose id appeared
anywhere in its title or body. pbbls#832 shipped one finding and named five
more in a "Follow-ups" table; all six were resolved, and criterion PLT-04
began answering "done" on four surfaces that ship none of it.

Now a finding closes only on `Closes`/`Fixes`/`Resolves` before its id, in the
body — GitHub's own convention, and the same keywords `Closes #123` already
uses. A bare id is a reference: nothing is written, and the delivery response
reports it as `mentioned` with the verb to write instead, so a forgotten
keyword surfaces at merge rather than in the matrix.

Closes #440 is **not** written here — #440 also asks for the surface sanity
check, which is part 2.

## Lab Note

```yaml
en:
  title: "Mentioning a finding no longer closes it"
  summary: "A pull request now closes a quality finding only when it says so — `Closes F-…` — so you can list the ones you did not get to without marking them fixed. Name one without the keyword and the merge tells you, instead of quietly closing it."
fr:
  title: "Citer un constat ne le clôt plus"
  summary: "Une pull request ne clôt un constat qualité que si elle l'annonce — `Closes F-…`. Tu peux donc lister ce qu'il reste à faire sans que ce soit marqué comme réglé. Si le mot-clé manque, la fusion te le dit au lieu de clore en silence."
suggested:
  molecule: arkaik
  type: fix
  tags: [kritik, github-app]
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

- [ ] **Step 3: Read the PR's comments**

```bash
gh pr view --json number,url && gh pr view --comments
```

The advisory Lab Note reminder comments at PR-open time. If it reports a problem, fix the PR **body** (posting is idempotent; the reminder clears its own comment) and re-read.

---

# PART B — `finding-closure-2-surface-warning`

- [ ] **Step 0: Branch on top of Part A**

```bash
git checkout -b finding-closure-2-surface-warning
gh stack
```

## Task 6: `onceChangedFiles` — one delivery, one request

**Files:**
- Modify: `lib/services/github/pull-request.ts` (after `FetchChangedFiles`, line ~952)
- Test: `tests/services/quality-webhook.test.js`

Part B gives the quality pass the pull request's changed files. Two halves now want that list, and the standing rule is that one delivery makes at most one changed-files request.

- [ ] **Step 1: Write the failing test**

`onceChangedFiles` lives in `pull-request.ts`, which the quality suite stubs out with a throwing proxy. So test it directly, in its own tiny suite that needs no loader. Create `tests/services/once-changed-files.test.js`:

```js
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
```

Add the script to `package.json`, beside `test:quality-webhook`:

```json
"test:once-changed-files": "node tests/services/once-changed-files.test.js",
```

And add the scratch directory it builds to `.gitignore`, beside the other
`tests/services/.test-build-*` entries (around line 33):

```
/tests/services/.test-build-once-changed-files/
```

Every other suite's scratch directory is listed there; a new one that is not
shows up as an untracked entry in `git status` forever after.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test:once-changed-files
```

Expected: FAIL — `onceChangedFiles not found in pull-request.ts`, exit 1.

- [ ] **Step 3: Write the implementation**

In `lib/services/github/pull-request.ts`, immediately after the `FetchChangedFiles` type alias, add:

```ts
/**
 * One delivery asks for a pull request's changed files ONCE, however many
 * halves want them.
 *
 * The delivery half has always made at most one call (`resolveDeliveryScopes`
 * fetches before any project is loaded, and hands one evidence value to all of
 * them). Issue #440's surface check gives the Kritik half a reason to want the
 * same list, and two halves sharing a rule that neither of them owns is how a
 * delivery quietly starts making two requests. So the rule gets an object: the
 * route builds one of these per delivery and hands it to both.
 *
 * THE PROMISE IS MEMOIZED, NOT THE RESOLVED VALUE. A fetch that rejects
 * rejects once, for everyone. `listPullRequestFiles` throws a
 * `GithubTransientError` on a 5xx, a rate limit or a socket error precisely so
 * the route can release the delivery claim and let GitHub redeliver the whole
 * thing; a memo that re-fetched after a rejection would have one delivery
 * issue the request this function exists to issue once.
 *
 * Keyed by the pull request even though a delivery concerns exactly one: the
 * key is what makes the memo a statement about a question rather than about a
 * call count, and it costs a template literal.
 */
export function onceChangedFiles(fetch: FetchChangedFiles): FetchChangedFiles {
  const asked = new Map<string, Promise<ChangedFilesResult>>();
  return (pr) => {
    const key = `${pr.repoFullName}#${pr.number}`;
    const pending = asked.get(key);
    if (pending !== undefined) return pending;
    const promise = fetch(pr);
    asked.set(key, promise);
    return promise;
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npm run test:once-changed-files
```

Expected: every line `PASS:`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/services/github/pull-request.ts tests/services/once-changed-files.test.js package.json .gitignore
git commit -m "$(cat <<'EOF'
feat(github): one delivery asks for changed files once, whoever asks (#440)

`onceChangedFiles` memoizes the promise per pull request, so the
Kritik half can want the same list the delivery half wants without a
second request — and a rejection is shared rather than retried, which
is what keeps the claim-release-and-redeliver path honest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `quality-surface.ts` — the check itself

**Files:**
- Create: `lib/services/github/quality-surface.ts`
- Modify: `tests/services/load-quality-parse.js`
- Test: `tests/services/quality-webhook.test.js`

- [ ] **Step 1: Teach the loader about the two new modules**

In `tests/services/load-quality-parse.js`, inside `loadQualityParse`, add `paths.js` and `quality-surface.js` to the compile list. After the line `const parseFile = compile("lib/services/github/quality-parse.ts", "quality-parse.js");` insert:

```js
  // paths.ts has no imports at all and quality-surface.ts imports only it and
  // types, so both transpile straight through — the same reason quality-parse.ts
  // does. Compiled BEFORE quality.ts so the rewrite below can point at them.
  compile("lib/services/github/paths.ts", "paths.js");
  const surfaceFile = compile("lib/services/github/quality-surface.ts", "quality-surface.js");
```

and add two rewrites to the `.replace(...)` chain inside `compile`, immediately after the `quality-parse` rewrite:

```js
      .replace(/require\((['"])@\/lib\/services\/github\/paths\1\)/g, `require(${JSON.stringify(path.join(BUILD_DIR, "paths.js"))})`)
      .replace(/require\((['"])@\/lib\/services\/github\/quality-surface\1\)/g, `require(${JSON.stringify(path.join(BUILD_DIR, "quality-surface.js"))})`)
```

and add the surface module's exports to the returned object:

```js
  return { ...require(parseFile), ...require(surfaceFile), ...(serviceFile ? require(serviceFile) : {}) };
```

Finally update the file's header comment — it currently claims `quality-parse.ts` is the only module with no value imports. Replace its second paragraph with:

```js
/**
 * `quality-parse.ts` has NO value imports (its only import is a type) and
 * `paths.ts` has no imports at all, so both transpile straight through;
 * `quality-surface.ts` imports only `paths.ts` and types, and is rewritten to
 * the compiled copy. `quality.ts` imports `server-only` (a Next.js build-time
 * guard with no Node implementation) and two `@/lib/...` modules it only
 * reaches through its INJECTED seam, so both are stubbed away here: the suite
 * never exercises the production reader.
 */
```

- [ ] **Step 2: Write the failing tests**

In `tests/services/quality-webhook.test.js`, add `surfaceMismatchWarning` to the destructure on line 20:

```js
const { scanFindings, closedIssues, parseIssueRef, isFindingId, surfaceMismatchWarning } = kritik;
```

Then add a new section immediately before `// --- the resolution pass ---`:

```js
// --- the surface sanity check ------------------------------------------------

// The pbbls profile, as docs/quality/library/framework.json actually writes it.
const PROFILE = {
  surfaces: [
    { id: "web", title: "Web app", platform: "web", path: "apps/web" },
    { id: "ios", title: "iOS", platform: "ios", path: "apps/ios" },
    { id: "supabase", title: "Database contract", path: "packages/supabase" },
    { id: "docs", title: "Docs" },
  ],
};
const files = (...paths) => ({ kind: "files", paths, incomplete: [] });
const warn = (surface, evidence, profile = PROFILE) =>
  surfaceMismatchWarning({ findingId: "F-2026-08-PLT-ios-02", surface, profile, evidence });

check(
  "a resolution touching nothing under the surface's path warns",
  warn("ios", files("packages/supabase/schema.sql", "docs/x.md")) ===
    "resolved F-2026-08-PLT-ios-02, but this pull request changed no file under `apps/ios` (surface `ios`)",
  JSON.stringify(warn("ios", files("packages/supabase/schema.sql"))),
);

check("a resolution touching the surface's path is silent", warn("ios", files("apps/ios/Report.swift")) === undefined);
check("one file among many is enough", warn("ios", files("docs/x.md", "apps/ios/Report.swift", ".github/w.yml")) === undefined);

// Containment is on SEGMENT boundaries, by the same `pathMatchesPrefix` that
// decides it for path-scoped repository links.
check("a sibling directory sharing a prefix does not count", typeof warn("ios", files("apps/ios-shared/x.swift")) === "string");

// A MISSING FILE CAN INVENT A MISMATCH. `RepoScope` already states the mirror
// rule — a missing file cannot invent a match — and both point the same way:
// under-claim, never over-claim. Warning off a partial list would be a false
// accusation printed against a correct resolution.
check("an incomplete list warns about nothing", warn("ios", { kind: "files", paths: ["docs/x.md"], incomplete: ["github-file-cap"] }) === undefined);
check("an unavailable list warns about nothing", warn("ios", { kind: "unavailable", reason: "no installation id" }) === undefined);
check("a list nobody fetched warns about nothing", warn("ios", { kind: "not-needed" }) === undefined);

// Nothing to compare against is not evidence of a mismatch.
check("a surface the profile does not declare is silent", warn("android", files("docs/x.md")) === undefined);
check("a surface declaring no path is silent", warn("docs", files("apps/ios/x.swift")) === undefined);
check("no profile at all is silent", warn("ios", files("docs/x.md"), undefined) === undefined);
check("a profile with no surfaces array is silent", warn("ios", files("docs/x.md"), {}) === undefined);

// `cross-surface` is a findings-only lens the profile never declares, so it
// falls out of the rule above rather than needing one of its own.
check("cross-surface is silent", warn("cross-surface", files("docs/x.md")) === undefined);

// A path written with stray separators still normalises to the same prefix.
check("a path with leading and trailing slashes still matches", surfaceMismatchWarning({
  findingId: "F-1", surface: "ios", evidence: files("apps/ios/x.swift"),
  profile: { surfaces: [{ id: "ios", title: "iOS", path: "/apps/ios/" }] },
}) === undefined);

// A path that normalises to the whole repository says nothing about where a
// fix belongs, so it cannot support a warning.
check("a path that normalises to the repository root is silent", surfaceMismatchWarning({
  findingId: "F-1", surface: "ios", evidence: files("docs/x.md"),
  profile: { surfaces: [{ id: "ios", title: "iOS", path: "/" }] },
}) === undefined);
```

- [ ] **Step 3: Run the suite to verify it fails**

```bash
npm run test:quality-webhook
```

Expected: FAIL — the loader throws `ENOENT … lib/services/github/quality-surface.ts`.

- [ ] **Step 4: Write the implementation**

Create `lib/services/github/quality-surface.ts`:

```ts
// Does a resolved finding's fix appear to live where the finding does?
//
// ISSUE #440's SECOND HALF. pbbls#832 resolved five findings describing missing
// UI on iOS, Android, web and admin, with a diff that touched `packages/supabase`,
// `docs` and `.github`. The profile already said where each of those surfaces
// lives — `SurfaceDef.path`, `apps/ios` and the rest — so the delivery held both
// halves of the contradiction and said nothing.
//
// A SECOND OPINION, NOT A GATE. `path` is optional, and a real fix can
// legitimately live in a shared package or a monorepo-wide config, so refusing
// on this would fail in the opposite dangerous direction: silently not closing
// findings that genuinely were fixed. The resolution is appended either way and
// the warning rides along on the outcome.
//
// Pure, and outside quality-parse.ts on purpose: that module is about parsing a
// pull request's text and states that it has no value imports at all, which is
// what lets the suite load it with a bare transpile. A path check is not parsing.
import type { QualityProfile, SurfaceDef } from "@arkaik/schema";
import { normalizePathPrefix, pathMatchesPrefix } from "@/lib/services/github/paths";
import type { ChangedFilesEvidence } from "@/lib/services/github/pull-request";

/**
 * The sentence a resolution earns when the pull request changed no file under
 * its finding's surface — or `undefined`, which is every other case.
 *
 * SILENCE IS THE DEFAULT, and every guard below returns it rather than guessing.
 * The rule that matters most is the INCOMPLETE one: a missing file can invent a
 * MISMATCH, which would be a false accusation printed against a correct
 * resolution. `ChangedFiles` already states the mirror of this — a missing file
 * cannot invent a match, so what matched is real — and both point the same way.
 *
 * Containment is `pathMatchesPrefix`, so it is decided on segment boundaries by
 * the same code that decides it for path-scoped repository links:
 * `apps/ios-shared/x.swift` is not a file under `apps/ios`.
 *
 * Surface paths are repository-relative, as `SurfaceDef.path` documents and as
 * `docs/quality/library/framework.json` writes them. They are compared against
 * the pull request's changed paths directly, with no reference to any project's
 * link prefixes: a surface path describes where the code lives, a link prefix
 * describes what a project claims, and conflating them would make this warning
 * depend on configuration it has no business reading.
 */
export function surfaceMismatchWarning(input: {
  findingId: string;
  surface: string;
  profile: QualityProfile | undefined;
  evidence: ChangedFilesEvidence;
}): string | undefined {
  const { findingId, surface, profile, evidence } = input;

  if (evidence.kind !== "files") return undefined;
  if (evidence.incomplete.length > 0) return undefined;

  // Read defensively: this is section content nobody has re-validated since it
  // left storage, the idiom lib/utils/quality.ts uses for the same reason.
  const surfaces: readonly unknown[] = Array.isArray(profile?.surfaces) ? profile.surfaces : [];
  const declared = surfaces.find(
    (entry): entry is SurfaceDef => (entry as SurfaceDef | null)?.id === surface,
  );
  if (declared === undefined || typeof declared.path !== "string") return undefined;

  const prefix = normalizePathPrefix(declared.path);
  // `null` is a `..` the normaliser refuses; `""` is the whole repository, which
  // says nothing about where a fix belongs and so can support no warning.
  if (prefix === null || prefix === "") return undefined;

  if (evidence.paths.some((filePath) => pathMatchesPrefix(filePath, prefix))) return undefined;

  return `resolved ${findingId}, but this pull request changed no file under \`${prefix}\` (surface \`${surface}\`)`;
}
```

- [ ] **Step 5: Run the suite to verify it passes**

```bash
npm run test:quality-webhook
```

Expected: every line `PASS:`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add lib/services/github/quality-surface.ts tests/services/load-quality-parse.js tests/services/quality-webhook.test.js
git commit -m "$(cat <<'EOF'
feat(github): the sentence a resolution earns when the fix is elsewhere (#440)

The profile already says where each surface lives. A resolution whose
pull request touched no file under that path gets told so — and every
case where the evidence cannot support the claim, an incomplete list
above all, stays silent instead of accusing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: wire the check into the resolution pass

**Files:**
- Modify: `lib/services/github/quality.ts`
- Test: `tests/services/quality-webhook.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/services/quality-webhook.test.js`, extend the `state()` helper to carry a profile and record fetches. Replace it with:

```js
/** The injected seam: one project, whatever findings, events and profile a case needs. */
function state({ findings = [FINDING()], decidedIds = [], profile = undefined } = {}) {
  const appended = [];
  return {
    appended,
    readState: async () => [
      {
        projectId: "prj_1",
        findings,
        profile,
        decidedFindingIds: new Set(decidedIds),
        append: async (events) => { appended.push(...events); return events.map((e) => e.id); },
      },
    ],
  };
}

/** A `fetchFiles` seam that counts its calls, so "at most one" is testable. */
function fetcher(result) {
  const calls = [];
  return { calls, fetchFiles: async (pr) => { calls.push(pr); return result; } };
}
const OK_FILES = (...paths) => ({ ok: true, changed: { paths, incomplete: [] } });
```

Then add these cases at the end of the async IIFE, before the pbbls#832 block:

```js
  // --- the surface warning, end to end --------------------------------------

  const IOS_PROFILE = { surfaces: [{ id: "ios", title: "iOS", platform: "ios", path: "apps/ios" }] };
  const iosFinding = () => FINDING({ id: "F-2026-08-PLT-ios-02", surface: "ios" });

  const mismatch = state({ findings: [iosFinding()], profile: IOS_PROFILE });
  const mismatchFetch = fetcher(OK_FILES("packages/supabase/schema.sql"));
  const mismatchOutcomes = await applyQualityResolutions(
    merged({ body: "Closes F-2026-08-PLT-ios-02" }),
    { readState: mismatch.readState, fetchFiles: mismatchFetch.fetchFiles },
  );
  check("the resolution is still appended", mismatch.appended.length === 1, JSON.stringify(mismatch.appended));
  check(
    "the resolved outcome carries the surface warning",
    mismatchOutcomes.find((o) => o.status === "resolved")?.warning ===
      "resolved F-2026-08-PLT-ios-02, but this pull request changed no file under `apps/ios` (surface `ios`)",
    JSON.stringify(mismatchOutcomes),
  );

  const onTarget = state({ findings: [iosFinding()], profile: IOS_PROFILE });
  const onTargetFetch = fetcher(OK_FILES("apps/ios/Report.swift"));
  const onTargetOutcomes = await applyQualityResolutions(
    merged({ body: "Closes F-2026-08-PLT-ios-02" }),
    { readState: onTarget.readState, fetchFiles: onTargetFetch.fetchFiles },
  );
  check("a resolution landing in its surface carries no warning", onTargetOutcomes.find((o) => o.status === "resolved")?.warning === undefined, JSON.stringify(onTargetOutcomes));
  check("the file list is fetched exactly once", onTargetFetch.calls.length === 1, JSON.stringify(onTargetFetch.calls));
  check("the fetch names the pull request", onTargetFetch.calls[0]?.repoFullName === REPO && onTargetFetch.calls[0]?.number === 7, JSON.stringify(onTargetFetch.calls));

  // No `fetchFiles` is the explicit under-claiming default, the same posture
  // `ChangedFilesEvidence` demands of every caller that has not fetched.
  const noFetcher = state({ findings: [iosFinding()], profile: IOS_PROFILE });
  const noFetchOutcomes = await applyQualityResolutions(merged({ body: "Closes F-2026-08-PLT-ios-02" }), { readState: noFetcher.readState });
  check("without a fetcher there is no warning", noFetchOutcomes.find((o) => o.status === "resolved")?.warning === undefined, JSON.stringify(noFetchOutcomes));
  check("without a fetcher the resolution still happens", noFetcher.appended.length === 1, JSON.stringify(noFetcher.appended));

  // NO FETCH AT ALL when nothing resolvable declares a path: a delivery must
  // not buy a GitHub request for a question it cannot ask.
  const pathless = state({ findings: [iosFinding()], profile: { surfaces: [{ id: "ios", title: "iOS" }] } });
  const pathlessFetch = fetcher(OK_FILES("docs/x.md"));
  await applyQualityResolutions(merged({ body: "Closes F-2026-08-PLT-ios-02" }), { readState: pathless.readState, fetchFiles: pathlessFetch.fetchFiles });
  check("a surface with no path costs no fetch", pathlessFetch.calls.length === 0, JSON.stringify(pathlessFetch.calls));

  const unknownSurface = state({ findings: [FINDING({ surface: "web" })], profile: IOS_PROFILE });
  const unknownFetch = fetcher(OK_FILES("docs/x.md"));
  await applyQualityResolutions(merged({ body: "Closes F-2026-08-SEC-web-01" }), { readState: unknownSurface.readState, fetchFiles: unknownFetch.fetchFiles });
  check("a surface the profile does not declare costs no fetch", unknownFetch.calls.length === 0, JSON.stringify(unknownFetch.calls));

  // A merge that resolves nothing never asks either.
  const mentionOnly = state({ findings: [iosFinding()], profile: IOS_PROFILE });
  const mentionFetch = fetcher(OK_FILES("docs/x.md"));
  await applyQualityResolutions(merged({ body: "Adjacent to F-2026-08-PLT-ios-02." }), { readState: mentionOnly.readState, fetchFiles: mentionFetch.fetchFiles });
  check("a merge that resolves nothing costs no fetch", mentionFetch.calls.length === 0, JSON.stringify(mentionFetch.calls));

  // An unreadable list is not a mismatch.
  const unavailable = state({ findings: [iosFinding()], profile: IOS_PROFILE });
  const unavailableOutcomes = await applyQualityResolutions(
    merged({ body: "Closes F-2026-08-PLT-ios-02" }),
    { readState: unavailable.readState, fetchFiles: async () => ({ ok: false, reason: "no installation id" }) },
  );
  check("an unreadable file list produces no warning", unavailableOutcomes.find((o) => o.status === "resolved")?.warning === undefined, JSON.stringify(unavailableOutcomes));
```

- [ ] **Step 2: Run the suite to verify it fails**

```bash
npm run test:quality-webhook
```

Expected: FAIL on `the resolved outcome carries the surface warning` (the outcome has no `warning`), and on the three fetch-count checks that expect `1` (nothing calls `fetchFiles` yet, so they see `0`).

- [ ] **Step 3: Write the implementation**

In `lib/services/github/quality.ts`:

(a) Extend the imports:

```ts
import { findingResolvedInput, isOpenFinding, makeEvent, type JournalEvent, type QualityFinding, type QualityProfile, type SurfaceDef } from "@arkaik/schema";

import { query } from "@/lib/services/db";
import { appendJournalEvents } from "@/lib/services/graph/store";
import { closedIssues, parseIssueRef, scanFindings } from "@/lib/services/github/quality-parse";
import { surfaceMismatchWarning } from "@/lib/services/github/quality-surface";
import {
  linkedProjects,
  ownerIdsFor,
  type ChangedFilesEvidence,
  type FetchChangedFiles,
  type PullRequestEvent,
} from "@/lib/services/github/pull-request";
```

(b) Add `warning` to the `resolved` variant:

```ts
  | {
      projectId: string;
      status: "resolved";
      findingId: string;
      eventId: string;
      /**
       * The resolution happened, and something about it does not add up —
       * today, only that the pull request changed no file under the finding's
       * surface (issue #440). Never a refusal: see `quality-surface.ts`.
       */
      warning?: string;
    }
```

(c) Add `profile` to `ProjectQualityState`, after `findings`:

```ts
  /**
   * The project's surface profile, for the surface sanity check. Optional
   * because it is read defensively from stored section content — a project
   * whose snapshot carries none simply earns no warnings.
   */
  profile?: QualityProfile;
```

(d) Add `fetchFiles` to the options of `applyQualityResolutions`:

```ts
export async function applyQualityResolutions(
  event: PullRequestEvent,
  options: {
    readState?: ReadProjectQualityState;
    /**
     * The pull request's changed files, for the surface sanity check. The
     * route passes the SAME memoized fetcher it gives the delivery half
     * (`onceChangedFiles`), so a delivery that needs the list in both places
     * still makes one request.
     *
     * OPTIONAL, AND ABSENT MEANS `not-needed`, never a silent fetch: it is the
     * explicit under-claiming default `ChangedFilesEvidence` demands of every
     * caller that has not fetched. A caller that forgets gets no warnings, not
     * a wrong one.
     */
    fetchFiles?: FetchChangedFiles;
  } = {},
): Promise<QualityResolutionOutcome[]> {
```

(e) Immediately after `const readState = options.readState ?? loadProjectQualityState;`, add the lazy evidence:

```ts
  // Fetched at most once, and only if some finding this delivery is about to
  // resolve has a surface that declares a path — the question cannot be asked
  // otherwise, and a delivery must not buy a GitHub request for a question it
  // cannot ask. The route's fetcher is itself memoized across both halves, so
  // this is the second of at most two asks and at most one call.
  let evidence: ChangedFilesEvidence | undefined;
  const changedFiles = async (): Promise<ChangedFilesEvidence> => {
    if (evidence !== undefined) return evidence;
    if (options.fetchFiles === undefined) {
      evidence = { kind: "not-needed" };
      return evidence;
    }
    // `event.installationId` rather than the stored fallback the delivery half
    // resolves: reading that costs a query, and the route runs this half
    // SECOND, so the memo is normally already warm with the good answer. When
    // it is not and the payload carried no installation, the fetch fails and
    // the evidence is `unavailable` — silence, which is the safe direction.
    const result = await options.fetchFiles({
      repoFullName: event.repoFullName,
      number: event.number,
      installationId: event.installationId,
    });
    evidence = result.ok
      ? { kind: "files", paths: result.changed.paths, incomplete: result.changed.incomplete }
      : { kind: "unavailable", reason: result.reason };
    return evidence;
  };
```

(f) Inside the per-project loop, change `resolving` to carry findings rather than ids. Replace:

```ts
    const events: JournalEvent[] = [];
    const resolving: string[] = [];
```

with:

```ts
    const events: JournalEvent[] = [];
    // The FINDINGS, not their ids: the surface check below needs `surface`,
    // and re-looking each one up from `byId` would be the same map twice.
    const resolving: QualityFinding[] = [];
```

and inside that loop replace `resolving.push(finding.id);` with `resolving.push(finding);`.

(g) Replace the refusal loop's body to read the id off the finding:

```ts
    if (eventIds.length === 0) {
      for (const finding of resolving) {
        outcomes.push({ projectId: state.projectId, status: "refused", findingId: finding.id });
      }
      continue;
    }
```

(h) Replace the final `resolving.forEach(...)` with:

```ts
    // Asked only now, and only when a resolved finding's surface declares a
    // path: `surfaceMismatchWarning` would return `undefined` for every other
    // case anyway, and a GitHub request to learn that is a request wasted.
    const surfaces: readonly unknown[] = Array.isArray(state.profile?.surfaces) ? state.profile.surfaces : [];
    const declaresPath = (finding: QualityFinding) =>
      typeof surfaces.find((entry): entry is SurfaceDef => (entry as SurfaceDef | null)?.id === finding.surface)?.path === "string";
    const files = resolving.some(declaresPath) ? await changedFiles() : ({ kind: "not-needed" } as const);

    resolving.forEach((finding, index) => {
      const warning = surfaceMismatchWarning({
        findingId: finding.id,
        surface: finding.surface,
        profile: state.profile,
        evidence: files,
      });
      outcomes.push({
        projectId: state.projectId,
        status: "resolved",
        findingId: finding.id,
        eventId: eventIds[index],
        ...(warning !== undefined ? { warning } : {}),
      });
    });
```

(i) In `loadProjectQualityState`, read the profile in the same query. Replace the snapshot query and the `findings` line with:

```ts
    const { rows: snapshots } = await query<{ findings: QualityFinding[] | null; profile: QualityProfile | null }>(
      `select snapshot->'quality'->'findings' as findings,
              snapshot->'quality'->'profile'  as profile
         from graph_projects where id = $1 and archived_at is null`,
      [projectId],
    );
    const findings = Array.isArray(snapshots[0]?.findings) ? snapshots[0].findings : [];
    if (findings.length === 0) continue;
    // Read beside the findings rather than in a second query: the surface check
    // needs both halves of the same section, and `profile` is required by
    // `QualitySection` — a null here means storage holds something older than
    // the schema, which earns no warnings and no error.
    const profile = snapshots[0]?.profile ?? undefined;
```

and add `profile,` to the `states.push({ … })` object, right after `findings,`.

- [ ] **Step 4: Run the suite to verify it passes**

```bash
npm run test:quality-webhook
```

Expected: every line `PASS:`, exit code 0.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/services/github/quality.ts tests/services/quality-webhook.test.js
git commit -m "$(cat <<'EOF'
feat(github): a resolution says when the fix is not where the finding is (#440)

The resolution pass reads the project's surface profile beside its
findings, and asks for the pull request's changed files only when a
finding it is about to resolve has a surface with a path to check.
The event is appended either way; the warning rides on the outcome.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: wire the route

**Files:**
- Modify: `app/api/github/webhook/route.ts`

- [ ] **Step 1: Make the change**

(a) Add `githubApp` to the imports and `onceChangedFiles` to the pull-request import:

```ts
import { githubApp } from "@/lib/services/github/app";
import {
  applyPullRequestEvent,
  claimDelivery,
  onceChangedFiles,
  releaseDelivery,
  type PullRequestEvent,
} from "@/lib/services/github/pull-request";
```

(b) Inside the `try` block, immediately before `const outcomes = await applyPullRequestEvent(...)`, insert:

```ts
    // ONE fetcher for the whole delivery. Both halves below can want the
    // pull request's changed files — the delivery half to resolve a
    // path-scoped platform, the Kritik half to check a resolved finding
    // against its surface (issue #440) — and the standing rule is that one
    // delivery makes at most one changed-files request. The memo is what
    // keeps that true now that the rule has two owners instead of one.
    const fetchFiles = onceChangedFiles((pr) => githubApp().listPullRequestFiles(pr));
```

(c) Pass it to both halves:

```ts
    const outcomes = await applyPullRequestEvent(prEvent, { scopesADeliverable, declaredNodes, fetchFiles });
```

and

```ts
    // A merged PR that CLOSES a finding — by `Closes F-…`, or by the issue it
    // closes. A finding merely named is reported, never resolved (issue #440).
    const quality = isMerge ? await applyQualityResolutions(prEvent, { fetchFiles }) : [];
```

- [ ] **Step 2: Typecheck, lint, and run the webhook suites**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint && npm run test:github && npm run test:quality-webhook && npm run test:once-changed-files
```

Expected: all pass, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/github/webhook/route.ts
git commit -m "$(cat <<'EOF'
feat(github): both halves of a delivery share one changed-files fetcher (#440)

The route builds the memo and hands it to the delivery half and the
Kritik half, so the surface check costs no second request.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Part B documentation

**Files:**
- Modify: `docs/hosted-projects.md`
- Modify: `plugin-kritik/skills/kritik/SKILL.md`

- [ ] **Step 1: Document the `warning` field**

In `docs/hosted-projects.md`, in the `quality` paragraph Task 4 added, append after the `mentioned` JSON block:

```markdown
A `resolved` entry may also carry a `warning`. The App knows where each surface
lives — the profile's `path`, `apps/ios` and the like — so a resolution whose
pull request changed no file there says so:

```json
{ "status": "resolved", "findingId": "F-2026-08-PLT-ios-02", "eventId": "ev_…",
  "warning": "resolved F-2026-08-PLT-ios-02, but this pull request changed no file under `apps/ios` (surface `ios`)" }
```

It is a second opinion, never a refusal: the event is appended either way,
because a real fix can live in a shared package. And it is only ever raised
against a **complete** file list — an unreadable or truncated one produces no
warning at all, since a missing file could invent the mismatch.
```

- [ ] **Step 2: Add a sentence to SKILL.md**

In `plugin-kritik/skills/kritik/SKILL.md`, immediately after the `mentioned` JSON block Task 4 added, insert:

```markdown
The App also checks a closure against the map you gave it. Each surface in your
profile may declare a `path` (`apps/ios`, `packages/supabase`), and a PR that
closes a finding on a surface whose path it never touched gets a `warning` on
that outcome. It still closes the finding — a fix can legitimately live in a
shared package — but the delivery says out loud that the diff and the finding
do not obviously belong to each other.
```

- [ ] **Step 3: Regenerate and verify**

```bash
npm run generate && npm run lint && git status --short
```

Expected: lint clean; include any regenerated artifact in the commit.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs: the surface warning on a resolved finding (#440)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: verify and open Part B's PR

- [ ] **Step 1: Run every suite the change can reach**

```bash
npm run test:quality-webhook && npm run test:once-changed-files && npm run test:github && npm run test:github-app && npm run test:quality-events && npm run test:quality-fold && npm run lint && npx tsc --noEmit -p tsconfig.json
```

Expected: all pass, exit code 0, lint clean. Read the output; paste the real result into the PR body.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin finding-closure-2-surface-warning
gh stack
gh pr create --base finding-closure-1-closing-verb --title "A closed finding gets a second look" --body-file /tmp/part-b-body.md
```

The base is Part A's branch, **not** `main`: that is what makes this PR's diff show only its own layer. Write the body file from this, replacing `#<part 1's number>` with the number `gh pr view` printed in Task 5:

````markdown
Part 2 of 2 for #440. Stacked on #<part 1's number>.

The profile already says where each surface lives — `apps/ios`,
`packages/supabase`. A pull request that closes a finding on a surface whose
path it never touched now says so in the delivery response, beside the
resolution it still performs.

Never a refusal: `path` is optional and a real fix can live in a shared
package, so gating on this would fail in the opposite direction — silently
leaving genuinely-fixed findings open. And never raised off a partial file
list, because a missing file can invent the mismatch.

Both halves of a delivery now share one memoized changed-files fetcher, so the
check costs no extra GitHub request.

Closes #440.

## Lab Note

```yaml
en:
  title: "A closed finding now gets a second look"
  summary: "When a pull request closes a quality finding, Arkaik checks the diff against where that finding lives. Close an iOS finding without touching the iOS app and the merge tells you — it still closes it, it just refuses to do so quietly."
fr:
  title: "Un constat clôturé a droit à un second avis"
  summary: "Quand une pull request clôt un constat qualité, Arkaik compare le diff à l'endroit où ce constat vit. Tu clos un constat iOS sans toucher à l'app iOS ? La fusion te le signale — elle clôt quand même, mais plus en silence."
suggested:
  molecule: arkaik
  type: improvement
  tags: [kritik, github-app]
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

- [ ] **Step 3: Read the PR's comments**

```bash
gh pr view --comments
```

Fix the PR body if the Lab Note reminder reports a problem, and re-read.

---

## Notes for the implementer

- **Never claim a pass you did not read.** Every verification step names a command and its expected output. Run it and look.
- **`main` lints clean** (0 errors), so any lint error the build reports is from this work.
- **Regenerate before every PR.** CI diffs generated artifacts; `npm run generate` is cheap and a stale artifact fails the build.
- **Fix a lower layer in the layer that owns it.** If Part B reveals something wrong in Part A, `gh stack down`, commit there, then `gh stack rebase --upstack`. Do not patch around it at the top.
- **This repo pins Node 20 in CI, local is Node 26.** The new test file uses only `require`, `typescript`'s `transpileModule` and `fs` — the same idiom every other suite in `tests/services/` uses — so it runs on both.
