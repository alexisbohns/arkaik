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
// LINEAR BY CONSTRUCTION, because a PR body is attacker-influenced input —
// anyone can open a PR from a fork — and GitHub itself allows up to 65,536
// characters of it. (The webhook DELIVERY as a whole is capped at 2 MB by
// `MAX_BODY_BYTES` in app/api/github/webhook/route.ts — a limit on the
// payload envelope, not on this one field, so it is not the number that
// matters here.) Every quantifier below is bounded and none is followed by
// something it can backtrack against.
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
 *
 * `{3,80}` is headroom, not a real limit: a realistic id
 * (`F-2026-08-A11Y-cross-surface-03`) needs about 30 characters after `F-`, so
 * 80 covers domains and surfaces this codebase has not invented yet. A token
 * that runs past the cap is not truncated and re-checked — it is invisible to
 * this scan entirely, because the `\b` after the quantifier can never be
 * satisfied within the capped length while the run of id-shaped characters
 * keeps going past it. That is the safe direction: an absurdly long lookalike
 * is dropped, never chopped into a shorter string that might accidentally
 * validate.
 *
 * Two ids written back-to-back with nothing separating them
 * (`...-01F-2026-...`) fuse into a single token, because `\b` cannot cut
 * between two word characters (`1` and `F`). The fused token almost always
 * fails {@link isFindingId}'s shape check and is simply dropped — the same
 * "stays one unrecognised token rather than becomes a wrong confident answer"
 * trade `ACCEPTANCE_MENTION` makes for the identical adjacency case in
 * pull-request.ts.
 */
const FINDING_TOKEN = /\bF-[A-Za-z0-9-]{3,80}\b/g;

/**
 * GitHub's own closing syntax: one of its nine keywords, then `#12`,
 * `owner/repo#12`, or the full issue URL.
 *
 * THREE ALTERNATIVES, cleanly separated by their own prefixes — the URL form
 * starts with `https?://`, the cross-repo form is `owner/repo#`, the
 * same-repo form is a bare `#` — so the alternation never has to backtrack
 * across branches hunting for the one that fits.
 *
 * `[\s:]{1,20}` is what sits between the keyword and the reference. GitHub
 * itself tolerates a run of whitespace there (`Closes\n#12`, from a line
 * wrapped in a real PR body, is common), and this repo's own convention
 * writes `Closes: #12` with a colon — which is why `:` is in the class at
 * all. The `{1,20}` bound exists only to keep the quantifier bounded: no
 * legitimate text separates a keyword from its reference by more than a
 * couple of characters, so the cap is never reached honestly and costs
 * nothing when it is.
 *
 * `owner` and `repo` are each capped at `{1,100}`, which is GitHub's own
 * ceiling for a repository name (an owner name stops at 39). One bound for
 * both rather than two exact ones: the point is to bound the quantifier, and
 * a cap SHORT of what GitHub issues would silently drop a legal reference.
 *
 * `\d{1,9}` caps the issue number at nine digits (GitHub issue numbers do not
 * get remotely close). `Closes #12345678901` — eleven digits — therefore
 * matches NOTHING, not the first nine digits of it: `\d{1,9}\b` needs a word
 * boundary immediately after the ninth digit, and the tenth digit is still
 * there, so the whole match fails rather than silently taking a truncated,
 * WRONG issue number. Matching nothing is the safe direction.
 */
const CLOSING_REFERENCE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[\s:]{1,20}(?:https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})\/issues\/|([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})#|#)(\d{1,9})\b/gi;

/** A full issue URL, tolerant of scheme, `www.`, and anything after the number. */
const ISSUE_URL =
  /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})\/issues\/(\d{1,9})(?:[/?#].*)?$/i;

/**
 * A leading blockquote marker (`>`, possibly nested and indented), stripped
 * ONLY to decide whether a line opens or closes a fence — never from the
 * text a caller actually scans. A quoted fence (`> \`\`\``) must still open
 * and close like an unquoted one: hiding a QUOTED code block is the safe
 * direction, and `^\s*` alone does not see past the `>`. Bounded to 20
 * nested levels, like every other quantifier in this file — no real PR body
 * quotes twenty times over, so the cap is never reached honestly.
 */
const BLOCKQUOTE_PREFIX = /^(?:[ \t]{0,3}>){1,20}[ \t]?/;

/**
 * A fence-opening or fence-closing LINE, once any blockquote marker is gone:
 * a run of 3+ backticks or tildes, plus whatever follows on the line (the
 * marker's info string). Group 1 is the marker itself, group 2 is the info
 * string — {@link splitOnFencedCode} reads both to decide what the marker
 * means, per {@link splitOnFencedCode}'s own rules.
 */
const FENCE_MARKER = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * A cheap, non-backtracking screen for the shape `mintFindingId` writes: `F-`
 * plus an audit id, a domain code, a surface id and a zero-padded counter —
 * at least five NON-EMPTY segments even when the audit id carries no hyphen
 * of its own, and a counter of two digits or more. Deliberately not a regex:
 * this is the validation {@link FINDING_TOKEN} declined to do, and it must
 * stay linear.
 *
 * This is a SCREEN, not a promise that the token names a finding that
 * exists. A token that merely looks right is a plain lookup miss downstream —
 * reported as unknown, not treated as a mis-resolution — the same way an
 * unrecognised `AC-` id is in pull-request.ts.
 */
export function isFindingId(token: string): boolean {
  const segments = token.split("-");
  if (segments.length < 5) return false;
  if (segments.some((segment) => segment.length === 0)) return false;
  const counter = segments[segments.length - 1];
  if (counter.length < 2) return false;
  for (const character of counter) {
    if (character < "0" || character > "9") return false;
  }
  return true;
}

/**
 * Splits a text into the runs that sit OUTSIDE any fenced code block (``` or
 * ~~~) before either grammar below scans it. GitHub creates no reference for
 * text inside a fence — a bare `Closes #12` or `F-2026-08-SEC-web-01` written
 * there to document this very syntax (this repo's own task-plan PRs are
 * exactly that kind of body) is inert on GitHub's side.
 *
 * RUNS, NOT ONE JOINED STRING. An earlier version joined the kept lines back
 * together with `\n`, and `[\s:]{1,20}` matches a newline: a dangling keyword
 * right before a fence could reach across the whole fenced block to a bare
 * `#124` right after it and invent a reference GitHub never honoured —
 * exactly the over-claim this module exists to prevent. Nothing legitimate
 * spans a code block, so there is no reason to make the text on either side
 * of one adjacent at all; each returned run is scanned on its own.
 *
 * CLOSING NEEDS A MATCHING MARKER, not a bare toggle. A fence closes only on
 * a line whose marker is the SAME character and AT LEAST AS LONG as the one
 * that opened it, and carries no info string — CommonMark's own rule. A bare
 * boolean flip let a FENCED EXAMPLE OF THE CLOSING GRAMMAR ITSELF — a
 * four-backtick fence wrapping a three-backtick one, "markdown about
 * markdown" — close on its own inner marker, and let a stray `~~~` close a
 * ``` fence it was never part of. Both leaked precisely the kind of PR body
 * this function exists for: one demonstrating this repo's own syntax inside
 * an example.
 *
 * AN OPENING BACKTICK FENCE MAY NOT CARRY A BACKTICK IN ITS INFO STRING,
 * again per CommonMark. Without that check, an inline aside written as one
 * line — `` ```inline code``` and the rest of this sentence `` — reads as an
 * OPENER (it starts with three backticks) whose info string is everything
 * after, backticks included, and swallows the remainder of the body as fence
 * content. That is an under-claim rather than an over-claim, but it is a
 * genuine line-semantics bug, not a hypothetical one.
 *
 * AN UNCLOSED FENCE SWALLOWS EVERY RUN AFTER IT. That remains the safe
 * direction: a malformed body can only make MORE text invisible, never
 * invent a reference that was not there.
 *
 * One pass, no backtracking: {@link FENCE_MARKER} and
 * {@link BLOCKQUOTE_PREFIX} are each bounded or followed by nothing that
 * could make them reconsider, and this function itself does no more than one
 * comparison per line.
 */
function splitOnFencedCode(text: string): string[] {
  const runs: string[] = [];
  let current: string[] = [];
  let openChar: string | null = null;
  let openLen = 0;

  for (const line of text.split(/\r?\n/)) {
    const marker = FENCE_MARKER.exec(line.replace(BLOCKQUOTE_PREFIX, ""));

    if (openChar === null) {
      const backtickInfoHasBacktick = marker !== null && marker[1][0] === "`" && marker[2].includes("`");
      if (marker !== null && !backtickInfoHasBacktick) {
        runs.push(current.join("\n"));
        current = [];
        openChar = marker[1][0];
        openLen = marker[1].length;
      } else {
        current.push(line);
      }
      continue;
    }

    // Inside a fence: only a same-character marker at least as long as the
    // opener, with no info string, closes it. A shorter, differently
    // charactered, or info-carrying marker is fence CONTENT and is dropped
    // along with everything else in here.
    if (marker !== null && marker[1][0] === openChar && marker[1].length >= openLen && marker[2].trim() === "") {
      openChar = null;
    }
  }
  runs.push(current.join("\n"));
  return runs;
}

/**
 * Finding ids named in a PR's title or body, deduped, in the order they
 * appear.
 *
 * Scans BOTH title and body — unlike {@link closedIssues} below, which reads
 * GitHub's own grammar and is body-only for that reason. This grammar is
 * arkaik's own: `F-2026-08-SEC-web-01` means the same thing wherever an
 * author puts it, the way `AC-x` does for `mentionedAcceptances` in
 * pull-request.ts, which also reads both title and body. The two functions'
 * scopes differ because the GRAMMARS they read differ, not by oversight.
 * (One further divergence from `mentionedAcceptances`: this function strips
 * fenced code first and that one does not, because `AC-x@platform` carries no
 * "someone is quoting the syntax" failure mode the way a closing keyword or a
 * finding id does — an intentional difference, not an oversight either.)
 */
export function mentionedFindings(event: Pick<PullRequestEvent, "title" | "body">): string[] {
  const found = new Set<string>();
  for (const text of [event.title, event.body]) {
    if (!text) continue;
    for (const run of splitOnFencedCode(text)) {
      for (const match of run.matchAll(FINDING_TOKEN)) {
        if (isFindingId(match[0])) found.add(match[0]);
      }
    }
  }
  return [...found];
}

/**
 * Issues this PR claims to close, read from the PR's BODY ONLY.
 *
 * GitHub does not honour a closing keyword in a pull request's TITLE — only
 * in its description, or in a commit message the merge later carries in.
 * (See {@link mentionedFindings} above for why ITS scan still covers both —
 * a different grammar, not the same rule applied inconsistently.) Scanning
 * the title here would let arkaik mark a finding resolved while the GitHub
 * issue it names stays open, which is exactly the over-claim this loop
 * exists to avoid.
 *
 * A bare `#12` takes the PR's own repository, because that is what GitHub
 * does with it; `owner/repo#12` keeps the one it names, and so does a full
 * URL.
 *
 * The one gap this cannot close: arkaik only ever sees `PullRequestEvent`'s
 * title and body, never the commit list a merge carries in, so a PR that
 * closes its issue solely from a COMMIT MESSAGE resolves nothing here either
 * — body-based, not commit-message-aware, the same kind of stated limitation
 * `extractLabNoteYaml` carries in lab-note-parse.ts for being line-based
 * rather than fence-aware. Under-claiming again, not over.
 */
export function closedIssues(
  event: Pick<PullRequestEvent, "body" | "repoFullName">,
): IssueRef[] {
  const refs = new Map<string, IssueRef>();
  const text = event.body;
  if (text) {
    for (const run of splitOnFencedCode(text)) {
      for (const match of run.matchAll(CLOSING_REFERENCE)) {
        const owner = match[1] ?? match[3];
        const name = match[2] ?? match[4];
        const repo = (owner !== undefined && name !== undefined ? `${owner}/${name}` : event.repoFullName).toLowerCase();
        const number = Number(match[5]);
        refs.set(`${repo}#${number}`, { repo, number });
      }
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
 *
 * Takes `string | null | undefined` because its real caller reads
 * `QualityFinding.issue_url`, which is itself optional — under `strict: true`
 * a `string`-only parameter would force every caller to guard first, moving
 * the same `?? ""` here up a level for no benefit.
 */
export function parseIssueRef(url: string | null | undefined): IssueRef | undefined {
  const match = ISSUE_URL.exec(String(url ?? "").trim());
  if (!match) return undefined;
  return { repo: `${match[1]}/${match[2]}`.toLowerCase(), number: Number(match[3]) };
}
