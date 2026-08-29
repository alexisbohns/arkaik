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
