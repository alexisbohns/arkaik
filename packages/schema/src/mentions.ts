/**
 * The `AC-id@platform` mention grammar — how a pull request names the
 * acceptances it ships, and on which platform.
 *
 * Lives here, not in the GitHub App, because three callers read it: the
 * App's webhook on merge, `arkaik live` from a deploy, and through the CLI the
 * `mark-live` reusable workflow. The grammar has been subtly wrong twice (see
 * the invariant below); one implementation is the only defence.
 *
 * Zod-free: its only import is `./ids`, itself import-free, so the grammar can
 * be bundled into the CLI or a workflow without pulling zod along.
 */
import { PLATFORM_IDS, type PlatformId } from "./ids";

/** Whether a string is one of the platforms arkaik knows, exactly. */
export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

/**
 * `AC-…` mentioned in a PR body or title, with an optional `@platform` suffix.
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────────────
 * A mention is scoped to a platform ONLY IF the suffix the author wrote is,
 * after trimming trailing prose punctuation, character-for-character equal
 * (case-insensitively) to a `PlatformId`. Anything else is UNKNOWN and is
 * reported. A suffix is NEVER shortened to a prefix of itself.
 *
 * That invariant, not a character class, is what this code encodes — because
 * the character class failed twice. It was `[a-z0-9]+`, and `@android-tv`
 * scoped to `android`. It became `[a-z0-9-]*`, and `@android_tv` scoped to
 * `android`. Still waiting behind those: `@ios.tv` `@ios/ipad` `@ios+android`
 * `@web:mobile` `@ios#2` `@ios%20` `@ios~next` `@ios&android`. Every one is a
 * CONFIDENTLY WRONG platform claim — false parity on `/acceptances` — which is
 * far worse than reporting a suffix arkaik does not understand. Widening the
 * class is an unwinnable game against every separator a keyboard has; matching
 * the WHOLE token and demanding an exact match ends the game.
 *
 * The three parts, and what each prevents:
 *   - the id part excludes `@`, so the greedy match stops cleanly at the suffix;
 *   - `\\?` before the `@` catches `AC-x\@ios` — the backslash people add to
 *     stop GitHub rendering `@ios` as a user mention. Without it the escape
 *     parsed as a BARE mention and promoted the BASE status, which is the
 *     silent over-claim the suffix exists to prevent;
 *   - the suffix is captured as one whole token, terminated only by whitespace
 *     or by the start of the NEXT acceptance mention. That second terminator is
 *     what keeps `AC-a@ios,AC-b@web` (no space, which a plain `\S+` would
 *     swallow whole) parsing as two mentions. It is safe against the invariant
 *     because `\b` only lets it cut where the preceding character is a
 *     NON-word one, and no `PlatformId` contains a non-word character — so it
 *     can never manufacture a valid platform out of an invalid suffix.
 *     `AC-x@iosAC-y` has no boundary between `s` and `A`, so it stays one
 *     unknown token rather than becoming a confident `ios`.
 *
 * Linear by construction: every quantifier consumes exactly one character per
 * step and there is no alternation, so a hostile PR body — attacker-influenced
 * input, since anyone can open a PR from a fork — cannot make it backtrack.
 */
const ACCEPTANCE_MENTION = /\b(AC-[a-z0-9][a-z0-9-]*)(?:\\?@((?:(?!\bAC-[a-z0-9])\S)+))?/gi;

/**
 * Punctuation that is prose, not part of a platform claim: `AC-x@ios.` ending a
 * sentence, `(AC-x@ios)`, `**AC-x@ios**`, `` `AC-x@ios` ``.
 *
 * Widening THIS set is safe where widening the suffix class was not, and the
 * asymmetry is the whole point: no `PlatformId` ends in punctuation, so trimming
 * can only ever turn a non-match into a match — never the reverse.
 *
 * `-` is deliberately absent. It is the one separator that appears INSIDE the
 * near-miss names people actually write (`android-tv`, `ios-ipad`), and
 * trimming it would turn `@android-` back into `android`.
 */
const TRAILING_PROSE = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", ">", "'", '"', "`", "*", "_", "~"]);

/**
 * A captured suffix with its trailing prose removed.
 *
 * A loop rather than `token.replace(/[…]+$/, "")`: that regex is QUADRATIC on a
 * long run of trimmable characters followed by one that is not (`AC-x@))))…a`
 * makes it backtrack once per position), and a PR body is attacker-influenced
 * input. This is one pass, and it obviously terminates.
 */
function trimTrailingProse(token: string): string {
  let end = token.length;
  while (end > 0 && TRAILING_PROSE.has(token[end - 1])) end -= 1;
  return token.slice(0, end);
}

/** An acceptance named by a PR, with the scope the author asked for (if any). */
export interface AcceptanceMention {
  id: string;
  /** `null` means "no scope was named" — the repo link decides. */
  platform: PlatformId | null;
}

/** A mention whose `@suffix` is not a platform arkaik knows. */
export interface UnknownPlatformMention {
  id: string;
  /** The suffix exactly as written, so a report can quote it back. */
  platform: string;
}

/**
 * The result of reading a PR's text: usable mentions, and the ones that named a
 * platform that does not exist.
 *
 * TWO CHANNELS ON PURPOSE. Folding the unknown ones back into `mentions` with
 * `platform: null` would make "I asked for `@windows` and got the repo's
 * default" structurally possible again, and that silent wrong answer is the
 * whole reason this grammar exists. A caller cannot degrade what it never
 * receives.
 */
export interface MentionScan {
  mentions: AcceptanceMention[];
  unknown: UnknownPlatformMention[];
}

/** Acceptances named in a PR's title or body, deduped by (id, platform). */
export function mentionedAcceptances(event: { title: string; body: string }): MentionScan {
  const mentions = new Map<string, AcceptanceMention>();
  const unknown = new Map<string, UnknownPlatformMention>();

  for (const text of [event.title, event.body]) {
    if (!text) continue;
    for (const match of text.matchAll(ACCEPTANCE_MENTION)) {
      // Node ids are case-sensitive; `AC-` is the canonical prefix, and the rest
      // is kebab-case by `deriveNodeId`, so normalise the prefix only.
      const id = `AC-${match[1].slice(3)}`;
      const written = match[2];

      // No suffix group at all — a plain `AC-x`, or a dangling `AC-x@` /
      // `AC-x@ ios` where nothing non-blank followed the `@`. The repo link
      // decides the scope. Deduped on id AND platform, because `AC-x` and
      // `AC-x@ios` are two different requests and collapsing them on id alone
      // would drop the explicit one.
      if (written === undefined) {
        mentions.set(`${id}@`, { id, platform: null });
        continue;
      }

      const token = trimTrailingProse(written);
      // Platforms ARE case-normalisable — a closed lowercase enum carries no
      // case information to lose — so `@iOS`, which is simply how people write
      // it, must not be reported as an unknown platform.
      const suffix = token.toLowerCase();

      // EXACT match or nothing. `@android-tv` is reported whole and never read
      // as `android`; `@ios2`, `@windows` and `@ios-related` are reported too.
      // A token that trims away to nothing (`AC-x@.`) lands here as well rather
      // than degrading to a bare mention — the author typed an `@`, so this is
      // an unusable scope request, not the absence of one.
      if (!isPlatformId(suffix)) {
        // Quoted back as written minus the prose punctuation, so the report
        // shows the claim the author made and not the full stop that ended
        // their sentence. When the whole token WAS punctuation there is nothing
        // else to quote, so it is quoted raw.
        unknown.set(`${id}@${suffix}`, { id, platform: token || written });
        continue;
      }

      mentions.set(`${id}@${suffix}`, { id, platform: suffix });
    }
  }

  return { mentions: [...mentions.values()], unknown: [...unknown.values()] };
}
