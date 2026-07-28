import "server-only";

import {
  applyOps,
  computeRefPromotions,
  promotionPatch,
  type MutationOp,
  type Node,
  type PlatformId,
  type Promotion,
  type Ref,
} from "@arkaik/schema";

import { PLATFORMS } from "@/lib/config/platforms";
import { query } from "@/lib/services/db";
import { applyMutation, getProject } from "@/lib/services/graph/store";

/**
 * Turning a `pull_request` webhook into acceptance status changes.
 *
 * The shape of the work, in order:
 *   1. resolve the repo to the projects that linked it (and the platform each
 *      link declares);
 *   2. find the nodes whose refs point at this PR — attaching one if the PR
 *      body names an acceptance and no ref exists yet;
 *   3. mirror the PR's state onto those refs;
 *   4. compute promotions under the project's opted-in policy and apply them.
 *
 * Every write goes through `applyMutation`, so a webhook-driven change is
 * subject to the same validator gate and lands the same journal events as a
 * human edit — with `github-app` as the actor, so the history says what acted.
 *
 * ── A REQUESTED SCOPE IS NEVER DOWNGRADED ───────────────────────────────────
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE. An unscoped ref is written only
 * when NO platform was named anywhere — not by a mention, not by the repo link.
 * A scope that WAS requested and cannot be honoured is refused and reported; it
 * is never quietly replaced by an unscoped ref.
 *
 * The reason is that "unscoped" is not the modest answer. `resolvePlatformStatus`
 * falls back to `node.status` for every platform without its own
 * `platformStatuses` entry, so moving the BASE status resolves every platform
 * WITHOUT an entry of its own to that status. When none has one — the common
 * case — that is every platform the acceptance lists, `hasParityGap` returns
 * false, and it renders as delivered everywhere (packages/schema/src/acceptance.ts).
 * With a partial `platformStatuses` the reach is smaller but the direction is
 * the same: a base move silently absorbs whichever platforms were still
 * inheriting, which is how a real parity gap gets erased rather than reported.
 * An unscoped promotion is therefore the STRONGEST claim this code can make.
 * Falling back to it when the code is least sure is exactly backwards: a WRONG
 * platform claim is far worse than a MISSING one.
 *
 * See `resolveRefScopes` for the four cases and what each one does.
 *
 * ── One ref per (PR, platform) ──────────────────────────────────────────────
 * A PR can name the same acceptance for several platforms (`AC-x@ios` and
 * `AC-x@android`), so a PR is mirrored as a SET of refs on a node, one per
 * scope, rather than a single ref carrying a single `platform`. Refs are
 * matched by (url, platform); the id is minted only when a ref is created and
 * reused verbatim on a match, because `diffRefs` matches by id — re-minting
 * would emit `ref.removed` + `ref.added` on every redelivery and break the
 * idempotence the delivery ledger's release-on-failure posture depends on.
 */

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

/**
 * The valid platform scopes, derived from the app's one list rather than
 * re-declared — a fourth copy of `web | ios | android` would be a fourth place
 * to forget when the set changes.
 */
const PLATFORM_IDS: readonly PlatformId[] = PLATFORMS.map((p) => p.id);
const IS_PLATFORM = (value: string): value is PlatformId =>
  (PLATFORM_IDS as readonly string[]).includes(value);

export interface PullRequestEvent {
  action: string;
  repoFullName: string;
  number: number;
  url: string;
  title: string;
  body: string;
  merged: boolean;
  state: string;
}

export interface LinkedRepo {
  projectId: string;
  platform: string | null;
}

/**
 * The external status a PR is in, matching what `arkaik sync` computes from the
 * REST API — so the webhook and the CLI can never disagree about what "merged"
 * means for the same PR.
 */
export function prExternalStatus(event: Pick<PullRequestEvent, "merged" | "state">): string {
  if (event.merged) return "merged";
  return event.state === "closed" ? "closed" : "open";
}

/** Projects that linked this repo. Lowercased: GitHub is case-insensitive here. */
export async function linkedProjects(repoFullName: string): Promise<LinkedRepo[]> {
  const { rows } = await query<{ project_id: string; platform: string | null }>(
    `select project_id, platform
       from project_repos
      where provider = 'github' and repo_full_name = $1`,
    [repoFullName.toLowerCase()],
  );
  return rows.map((row) => ({ projectId: row.project_id, platform: row.platform }));
}

/**
 * Record a delivery, returning false if it was already seen.
 *
 * GitHub retries failed deliveries and offers a manual redeliver button, so
 * without this a retry after a partially-successful run would re-apply
 * transitions. Insert-first (rather than check-then-insert) makes the guard
 * atomic under concurrent deliveries.
 */
export async function claimDelivery(deliveryId: string): Promise<boolean> {
  const { rows } = await query<{ delivery_id: string }>(
    `insert into github_deliveries (delivery_id) values ($1)
     on conflict (delivery_id) do nothing
     returning delivery_id`,
    [deliveryId],
  );
  if (rows.length === 0) return false;

  // Opportunistic prune — GitHub cannot replay a delivery older than a day.
  await query(`delete from github_deliveries where received_at < now() - interval '2 days'`);
  return true;
}

/**
 * Give a claimed delivery back after a failed apply, so GitHub's retry can
 * redo it. Without this, claiming before applying would turn any transient
 * failure into a permanently lost transition: the retry would arrive, see the
 * claim, and skip.
 *
 * Releasing is safe because applying twice is a no-op by construction —
 * re-writing an identical ref derives no events (`diffNodeUpdate`), and a
 * promotion to a status the node already holds is skipped as `already-there`.
 * The ledger prevents wasted work, not incorrectness.
 */
export async function releaseDelivery(deliveryId: string): Promise<void> {
  await query(`delete from github_deliveries where delivery_id = $1`, [deliveryId]);
}

/**
 * A stable, readable ref id for a PR: `gh-pr-<number>`, or
 * `gh-pr-<number>-<platform>` when the ref is scoped to one platform.
 *
 * Hyphen, not `@`: `Ref.id` is documented as kebab-case
 * (docs/spec/bundle-format.md § Identifier Conventions), and the generated JSON
 * Schema says so too.
 *
 * MUST only be called when CREATING a ref. A ref that already exists keeps the
 * id it was stored with, whatever that is — see `planForProject`.
 */
export function refIdFor(number: number, platform: PlatformId | null = null): string {
  return platform ? `gh-pr-${number}-${platform}` : `gh-pr-${number}`;
}

/**
 * A ref id that is free on this node.
 *
 * Ref ids are unique per NODE, and a node can carry refs from several
 * repositories — an iOS repo and a web repo linked to the same project is the
 * ordinary arrangement, not an exotic one. PR numbers are per-repo, so both can
 * reach `#42` and both would mint `gh-pr-42`. A ref minted by an earlier version,
 * by hand, or by `arkaik sync` can collide the same way.
 *
 * `duplicate-ref-id` is a validator ERROR (packages/schema/src/validate.ts), so a
 * collision does not degrade — it refuses the whole mutation batch, taking every
 * other acceptance in the same PR with it, on every redelivery, forever. The
 * disambiguating `-2`, `-3` suffix is cheap insurance against a permanent dead
 * end; the ref is still identified by url, so the suffix costs nothing.
 */
function freeRefId(desired: string, taken: ReadonlySet<string>): string {
  let candidate = desired;
  // Terminates: every iteration rules out one member of a finite set.
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${desired}-${n}`;
  return candidate;
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
export function mentionedAcceptances(event: Pick<PullRequestEvent, "title" | "body">): MentionScan {
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
      if (!IS_PLATFORM(suffix)) {
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

interface NodeWithRefs extends Node {
  metadata?: Node["metadata"] & { refs?: Ref[] };
}

/**
 * One place a platform scope can come from, for one node.
 *
 * `explicit` records the PROVENANCE, because the two kinds are honoured
 * differently when the node does not list the platform. An EXPLICIT platform is
 * a human statement, so it is kept on the ref and `computeRefPromotions` refuses
 * the promotion with `platform-not-applicable`, which the caller reports. An
 * INFERRED one (today: the repo link) means arkaik's own bookkeeping disagrees
 * with itself, and there is no human statement to preserve — so the scope is
 * refused outright. Neither one degrades to an unscoped ref.
 */
interface ScopeSource {
  /** How a report names this source to a human: "the repository link". */
  label: string;
  /** Empty means "this source has nothing to say about platform". */
  platforms: readonly PlatformId[];
  explicit: boolean;
}

/**
 * What resolving one node's scope decided.
 *
 * `scopes: []` is a REFUSAL, and is emphatically not the same as `[null]`:
 * `[null]` writes one unscoped ref, which promotes the base status and thereby
 * claims every platform (see this file's header). An empty list writes nothing.
 * The two must never be confused — collapsing them is precisely the bug this
 * type exists to make unspellable.
 */
interface ScopeResolution {
  scopes: (PlatformId | null)[];
  /**
   * Set when a source named platforms this node does not list.
   *
   * Carried OUT rather than logged in place so the caller can name both sides —
   * "the repository link says ios, which AC-web-only does not list (web)". A
   * refusal the user cannot see is indistinguishable from the silent wrong
   * answer it replaced, and the delivery response is the only channel they have.
   */
  dropped?: { label: string; platforms: readonly PlatformId[] };
}

/**
 * Sorted so the ref array's order does not depend on the order two suffixes
 * happen to appear in the PR body — bundles are JSON on disk and diff in git.
 */
const sortedScopes = (platforms: readonly PlatformId[]): PlatformId[] => [...platforms].sort();

/**
 * The platform scopes this delivery resolves for one node — the ordered
 * precedence rule, in one place.
 *
 * The first source that names anything decides, and it decides FINALLY: it
 * either yields scopes or refuses. An explicit `AC-x@ios` therefore ABSORBS a
 * bare `AC-x` in the same PR rather than adding an unscoped ref beside the
 * scoped one, because that unscoped ref would promote the base status and
 * subsume the platform claim on this very delivery.
 *
 * ── WHY NOTHING HERE FALLS BACK TO `[null]` ────────────────────────────────
 * Every branch below used to end at the shared `return [null]` when it could
 * not produce a platform. That made the code answer a question about ONE
 * platform with a claim about ALL of them, exactly when it was least sure —
 * see this file's header for why unscoped is the biggest claim, not the
 * smallest. Two live bugs came out of that single line:
 *
 *   - a repo linked as `ios` whose PR mentioned a web-only acceptance filtered
 *     `ios` away and wrote an unscoped ref, so a PR in the iOS repository
 *     marked the web-only acceptance shipped — silently, with no warning;
 *   - `AC-x` in the title and `AC-x@ios-tablet` in the body: the typo landed in
 *     the `unknown` channel, the bare mention survived, and the author who
 *     asked for one platform got all three marked shipped.
 *
 * The second is handled by the caller (it needs the `unknown` channel); the
 * first is handled here. If you are adding a source and it cannot produce a
 * platform, REFUSE — do not reach for `[null]`.
 *
 * A list rather than a chain of ternaries so that path-scoped links (not built)
 * slot in between mention and link as one more entry, not a rewrite.
 */
function resolveRefScopes(node: Node, sources: readonly ScopeSource[]): ScopeResolution {
  for (const source of sources) {
    // A SILENT source is skipped, not refused: having nothing to say about
    // platform is how an ordinary "All platforms" repo link behaves, and it is
    // the only way case 4 below is ever reached.
    if (source.platforms.length === 0) continue;

    // Kept verbatim even when the node does not list it — the promotion is then
    // refused downstream as `platform-not-applicable` and reported. Filtering it
    // out here instead would leave the mention looking honoured.
    if (source.explicit) return { scopes: sortedScopes(source.platforms) };

    const applicable = source.platforms.filter((p) => node.platforms.includes(p));
    if (applicable.length > 0) return { scopes: sortedScopes(applicable) };

    // This source NAMED platforms and none of them apply to this node. Refused
    // here rather than falling through to the next source: a source that named
    // a platform stated an intent, and quietly trying a different one is the
    // same downgrade wearing a different hat.
    return { scopes: [], dropped: { label: source.label, platforms: source.platforms } };
  }

  // CASE 4: nothing anywhere named a platform, so nothing is being downgraded.
  // One unscoped ref, the base status moves, and the caller warns about how
  // much that claims.
  return { scopes: [null] };
}

/**
 * What one PR event implies for one project.
 *
 * `warnings` is a second channel for the same reason `MentionScan` has one: a
 * ref that attaches but promotes nothing is indistinguishable from success in
 * the delivery response — the author sees `applied: 1` and reasonably concludes
 * the platform shipped. Folding those cases into silence would make the docs'
 * promise ("a ref naming a platform the acceptance does not list is reported,
 * not promoted") false in the only place a user can check it.
 *
 * A REFUSED scope makes this channel load-bearing rather than merely useful: it
 * plans no op at all, so `warnings` is then the ONLY evidence the delivery
 * understood the PR and deliberately declined to act on it.
 */
export interface ProjectPlan {
  ops: MutationOp[];
  warnings: string[];
}

/**
 * The ops that bring one project in line with a PR event: attach the ref where
 * a mention names an uncovered acceptance, mirror the PR's state onto matching
 * refs, then promote under the project's policy.
 *
 * Returns an empty op list when nothing applies, which is the common case — most
 * PRs in a linked repo mention no acceptance at all.
 */
export function planForProject(
  bundle: { project: { metadata?: Record<string, unknown> }; nodes: Node[]; edges: unknown[] },
  event: PullRequestEvent,
  platform: string | null,
): ProjectPlan {
  const ops: MutationOp[] = [];
  const warnings: string[] = [];
  const externalStatus = prExternalStatus(event);
  const now = new Date().toISOString();

  const nodes = bundle.nodes as NodeWithRefs[];
  const { mentions, unknown } = mentionedAcceptances(event);

  // Grouped per node id, because one PR can name one acceptance for several
  // platforms. (A `Set` of mention RECORDS would dedupe by object identity and
  // `has(node.id)` would never be true — the planner would silently do nothing.)
  const mentionedNodes = new Set<string>();
  const explicitPlatforms = new Map<string, PlatformId[]>();
  for (const mention of mentions) {
    mentionedNodes.add(mention.id);
    if (!mention.platform) continue;
    explicitPlatforms.set(mention.id, [...(explicitPlatforms.get(mention.id) ?? []), mention.platform]);
  }

  /**
   * The ids whose `@suffix` was not a platform arkaik knows.
   *
   * This channel used to be DISCARDED here — `planForProject` destructured
   * `{ mentions }` alone — and that is the whole of bug (a): a PR titled
   * "AC-x: Apple Pay" with "Fixes AC-x@ios-tablet" in the body put the typo in
   * `unknown` and the bare `AC-x` in `mentions`, so the bare one survived,
   * resolved to `[null]`, and marked all three platforms shipped. Without this
   * set the planner cannot tell that case from a plain unscoped mention,
   * because by then they are the same value.
   */
  const unknownNodes = new Set(unknown.map((u) => u.id));

  const linkPlatform = platform && IS_PLATFORM(platform) ? platform : null;

  const patched: Node[] = [];
  /**
   * The refs this delivery is responsible for, per node. Promotions are
   * filtered against this rather than against a single computed id: a matched
   * ref keeps whatever id it was stored with, so comparing to a freshly minted
   * id would drop the promotion for every ref written by an older version.
   */
  const touched = new Map<string, Set<string>>();

  /**
   * The refs this mirror owns: pointing at THIS PR and already typed `github-pr`.
   *
   * The url half is the identity of a PR here — an id probe would reintroduce
   * the assumption that one PR has one ref.
   *
   * The TYPE half is load-bearing, not tidiness. `computeRefPromotions` selects
   * the promotion policy by `ref.type` (packages/schema/src/promote.ts), so
   * folding a hand-written `{ type: "url" }` ref that happens to point at this
   * PR into the mirror would ENROL it in promotion — and, carrying no platform,
   * enrol it as an UNSCOPED one, which moves the base status and marks every
   * inheriting platform shipped. Someone who pasted a PR link as a plain url ref
   * asked for a link, not for a status claim; adopting it is the strongest claim
   * in this system made out of data written for something else.
   *
   * ONE predicate gates refreshing, minting, the mixed-scope filter and
   * `touched`, deliberately. Restricting only the refresh would leave the
   * mixed-scope filter — which matches on url alone — free to DELETE the very
   * ref it declines to adopt, which is adoption wearing a worse hat. A ref of
   * another type at this url is simply not this mirror's business, in either
   * direction.
   *
   * KNOWN LIMITATION, accepted: renaming or transferring the repo changes
   * `html_url`, so the next delivery writes a NEW ref and the old one stays
   * frozen at its last mirrored status. It is cosmetic — the stale ref has a
   * different url, so it never enters `touched` and can never be promoted, and
   * `freeRefId` keeps it from colliding. Repointing refs on a rename would
   * need the repository-rename event and a way to know which of a node's refs
   * came from that repo; nothing is built for that.
   */
  const isMirrored = (ref: Ref): boolean => ref.url === event.url && ref.type === "github-pr";

  for (const node of nodes) {
    const existing = node.metadata?.refs ?? [];
    // A node is in scope if it already carries one of this mirror's refs for
    // this PR, or if the PR names it.
    const referencesPr = existing.some(isMirrored);
    if (!referencesPr && !mentionedNodes.has(node.id)) continue;

    // ── The scope decision for this node ──────────────────────────────────
    // Scopes are resolved only from a MENTION. A node that is in scope purely
    // because it already carries a ref for this PR gets its refs refreshed and
    // nothing else — a body edit that drops a mention must not delete the ref
    // that a promotion already happened on.
    let resolution: ScopeResolution = { scopes: [] };
    /**
     * Set when this node WAS named by the PR and the scope it asked for could
     * not be honoured.
     *
     * DISTINCT FROM `scopes.length === 0`, which is also what a node reached
     * ONLY through an existing ref looks like — and that node must keep being
     * promoted, because a body edit that drops a mention may not undo a
     * promotion that already landed. Conflating the two is what made the
     * refusal fail to refuse: a refused node that already carried a ref for
     * this PR had that ref refreshed (correct) and then promoted from it
     * (wrong), so the SECOND delivery of the same PR — reopen, synchronize,
     * edit, all in the webhook's HANDLED_ACTIONS — quietly did the exact thing
     * the warning beside it said it had not done.
     */
    let refusedScope = false;
    if (mentionedNodes.has(node.id)) {
      const explicit = explicitPlatforms.get(node.id) ?? [];
      if (explicit.length === 0 && unknownNodes.has(node.id)) {
        // CASE 2: the author wrote an `@suffix` for this id that is not a
        // platform, and the only other mention of it is bare. The bare one is
        // NOT a fallback — reading it as one hands back the biggest claim in
        // the system in answer to a typo.
        //
        // No ref is attached at all, not even an unscoped one "for visibility":
        // a stray unscoped ref is a latent base-status promotion that this
        // delivery's `touched` filter cannot contain. `arkaik sync --promote`
        // applies every promotion in the plan with no such filter
        // (packages/cli/src/commands/sync.ts), so the ref would move the base
        // status later, out of band, even after the body was corrected.
        //
        // Correcting the typo is not a dead end: "edited" is in the webhook's
        // HANDLED_ACTIONS, so fixing the suffix re-delivers and works.
        refusedScope = true;
        warnings.push(
          `${node.id}: an @platform suffix written for this acceptance was not understood, so the ` +
            `bare mention of ${node.id} was NOT used as a fallback — that would have moved the base ` +
            `status, marking every platform shipped. The plan attaches no ref and promotes no ` +
            `status for it; a ref this pull request already left on ${node.id} keeps being mirrored, ` +
            `but nothing is promoted from it either. Fix the suffix; editing the pull request ` +
            `re-delivers.`,
        );
      } else {
        resolution = resolveRefScopes(node, [
          { label: "the mention", platforms: explicit, explicit: true },
          {
            label: "the repository link",
            platforms: linkPlatform ? [linkPlatform] : [],
            explicit: false,
          },
        ]);
        // CASE 3, refused half: the link names a platform this acceptance does
        // not list. Naming BOTH sides is the point — "ios" alone does not tell
        // the reader whether to fix the link or the acceptance.
        if (resolution.dropped) {
          const { label, platforms } = resolution.dropped;
          refusedScope = true;
          warnings.push(
            `${node.id}: ${label} says "${platforms.join(", ")}", which ${node.id} does not list ` +
              `(${node.platforms.join(", ")}). The plan attaches no ref and promotes no status for ` +
              `it — an unscoped ref here would move the base status, marking every platform shipped. ` +
              `A ref this pull request already left on ${node.id} keeps being mirrored, but nothing ` +
              `is promoted from it either.`,
          );
        }
      }
    }
    const scopes = resolution.scopes;

    // A node reached ONLY through a mention whose scope was refused earns no op
    // at all. Emitting an op that changes nothing would inflate `applied` in the
    // delivery response, so a refusal would read as a successful write.
    //
    // A node that already references this PR still falls through: its refs are
    // refreshed regardless of what the mentions say.
    if (!referencesPr && scopes.length === 0) continue;

    // Mirror EVERY ref pointing at this PR, whatever its scope — not just the
    // ones this delivery resolves. Otherwise a scoped ref stops being refreshed
    // the moment its `@platform` disappears from the body and sits at "open"
    // forever while the PR is merged: a mirror that has quietly stopped
    // mirroring.
    //
    // `type` is NOT rewritten here. It used to be — `type: "github-pr"` sat in
    // this spread — which silently converted a hand-written `{ type: "url" }`
    // ref at the same url into a promotable one; see `isMirrored`.
    const refs: Ref[] = existing.map((ref) =>
      isMirrored(ref)
        ? {
            ...ref,
            title: event.title,
            external_status: externalStatus,
            synced_at: now,
          }
        : ref,
    );

    for (const scope of scopes) {
      if (refs.some((r) => isMirrored(r) && (r.platform ?? null) === scope)) continue;
      refs.push({
        id: freeRefId(refIdFor(event.number, scope), new Set(refs.map((r) => r.id))),
        type: "github-pr",
        url: event.url,
        title: event.title,
        external_status: externalStatus,
        synced_at: now,
        ...(scope ? { platform: scope } : {}),
      });
    }

    // THE INVARIANT: for one PR on one node, either exactly one unscoped ref or
    // a set of platform-scoped ones — never a mix.
    //
    // Both directions are load-bearing. A leftover UNSCOPED ref beside a scoped
    // one promotes the base status on this very delivery, marking every platform
    // shipped at the moment the author asked for one. A leftover SCOPED ref when
    // an unscoped one is written is worse than redundant: refs written by the
    // previous version are stored as `gh-pr-<n>` while carrying a platform, so
    // minting the unscoped id beside one would be a `duplicate-ref-id` — a
    // validator ERROR that refuses the entire batch on every redelivery.
    const wroteScoped = scopes.some((s) => s !== null);
    const wroteUnscoped = scopes.some((s) => s === null);
    const kept = refs.filter((ref) => {
      if (!isMirrored(ref)) return true;
      const scoped = ref.platform != null;
      return scoped ? !wroteUnscoped : !wroteScoped;
    });

    const patch = { metadata: { ...node.metadata, refs: kept } };
    ops.push({ op: "update_node", node_id: node.id, patch });
    patched.push({ ...node, ...patch } as Node);
    // A REFUSED scope registers NO promotable refs. The mirror above still ran
    // — the ref stays fresh — but `touched` is what gates both the promotions
    // and the skip report below, so an empty set is how "attaches no ref and
    // promotes no status" becomes true of the redelivery as well as the first
    // delivery. Registering the refreshed ids here instead is what let the
    // refusal promote on every subsequent delivery of the same PR.
    touched.set(
      node.id,
      refusedScope ? new Set<string>() : new Set(kept.filter(isMirrored).map((r) => r.id)),
    );
  }

  if (patched.length === 0) return { ops, warnings };

  // Promotions are computed against the graph AS IT WILL BE after the ref
  // updates above — the same batch, so the mirrored status and the status it
  // implies are never briefly inconsistent.
  const withPatches = nodes.map((node) => patched.find((p) => p.id === node.id) ?? node);
  const plan = computeRefPromotions({
    ...bundle,
    nodes: withPatches,
  } as Parameters<typeof computeRefPromotions>[0]);

  // A refused promotion is only worth reporting when it belongs to a ref THIS
  // delivery wrote: another PR's stale ref, or an unrelated node's, is noise in
  // a report about this delivery — the same `touched` filter the promotions get,
  // for the same reason.
  //
  // Only `platform-not-applicable`. `already-there` is ordinary idempotence and
  // fires on every redelivery; `archived` and `no-mapping` are deliberate policy
  // outcomes. Reporting those would bury the one skip that means the author
  // asked for something arkaik could not do.
  for (const skip of plan.skipped) {
    if (skip.reason !== "platform-not-applicable") continue;
    if (!touched.get(skip.node_id)?.has(skip.ref_id)) continue;
    // Phrased as a PLAN, not as a completed write. This text is computed here,
    // before `applyMutation` runs, and that call gates on `validateBundle` over
    // the WHOLE snapshot: a pre-existing bundle-wide error refuses the entire
    // batch and nothing is written at all. "The ref was attached" would then be
    // a report of something that did not happen.
    warnings.push(
      `${skip.node_id}@${skip.detail}: "${skip.detail}" is not one of that acceptance's platforms. ` +
        `The plan attaches the ref, but promotes no status for it.`,
    );
  }

  const byNode = new Map<string, Promotion[]>();
  for (const promotion of plan.promotions) {
    // Only the refs THIS delivery touched. Without the filter a stale ref left
    // by another PR would be re-applied on every unrelated delivery.
    if (!touched.get(promotion.node_id)?.has(promotion.ref_id)) continue;
    byNode.set(promotion.node_id, [...(byNode.get(promotion.node_id) ?? []), promotion]);

    // AN UNSCOPED PROMOTION IS THE BIGGEST CLAIM THIS CODE CAN MAKE, not the
    // smallest. `resolvePlatformStatus` falls back to the base status for every
    // platform without its own `platformStatuses` entry, so moving the base
    // resolves ALL of them to the new status and `hasParityGap` then returns
    // false (packages/schema/src/acceptance.ts). A PR that forgot `@ios` does
    // not under-report per-platform detail: it reports the acceptance delivered
    // everywhere. Nothing about the write changes here — the REPORT does,
    // because silence is what makes the over-claim invisible behind a green
    // `applied: 1`.
    if (promotion.platform !== undefined) continue;
    const node = withPatches.find((n) => n.id === promotion.node_id);
    if (!node) continue;
    // Only the platforms that INHERIT the base status. One already carrying its
    // own entry is unaffected by a base move, so counting it would make this
    // line claim something the promotion does not do.
    const statuses = node.metadata?.platformStatuses;
    const inheriting = node.platforms.filter((p) => statuses?.[p] === undefined);
    // A SINGLE-PLATFORM acceptance has nothing to over-claim: its base status
    // and that platform's status are the same statement. And if nothing
    // inherits, the base move reaches no platform at all.
    //
    // THE GATE IS ON `node.platforms`, NOT ON `inheriting.length`. Those are the
    // same number only while `platformStatuses` is empty; the moment it is
    // PARTIAL — the ordinary mid-rollout state — they diverge, and gating on
    // `inheriting.length < 2` suppressed this warning exactly where it matters
    // most. AC-x lists [web, ios] with `{web: "live"}` and a base of
    // "prioritized" has a REAL parity gap (`hasParityGap` true, ios reported
    // missing). A bare mention moves the base to "live", ios inherits it,
    // delivered === resolved, and the gap DISAPPEARS — the single thing this
    // feature exists to surface, deleted. `inheriting` was `[ios]`, length 1,
    // and the delivery said nothing at all.
    if (node.platforms.length < 2 || inheriting.length === 0) continue;
    // Phrased as a PLAN, matching the `platform-not-applicable` line above and
    // for the same reason: this text is computed BEFORE `applyMutation`, which
    // gates on `validateBundle` over the whole snapshot and can refuse the
    // batch. "The base status moved" would then report a write that never
    // happened.
    //
    // Named individually rather than counted ("all N platforms"): with a
    // partial `platformStatuses` the inheriting set is a SUBSET of the
    // acceptance's platforms, so "all" would be false, and "all 1 platforms"
    // was not English either.
    // Phrased about the REF, not about what the pull request said. A node can
    // reach here through the refresh path — in scope only because it already
    // carries a ref for this PR, with no mention this delivery — and there the
    // repo link may well name a platform. "No platform was named" would then be
    // flatly false. What is true in every path is that the ref being promoted
    // from carries no platform, which is precisely why the base status moves.
    warnings.push(
      `${promotion.node_id}: the ref for this pull request carries no platform, so the plan ` +
        `moves the base status to "${promotion.to}" — which also marks ` +
        `${inheriting.join(", ")} "${promotion.to}", ` +
        `${inheriting.length > 1 ? "platforms" : "a platform"} the ref does not name. ` +
        `Write ${promotion.node_id}@${inheriting[0]} in the pull request to scope it.`,
    );
  }

  for (const [nodeId, promotions] of byNode) {
    const base = withPatches.find((n) => n.id === nodeId);
    if (!base) continue;
    // Folded into ONE patch, each step reading the node as the previous step
    // left it. `applyOps` replaces `metadata` wholesale, so two ops both built
    // from the pre-promotion node would carry `{ios: "live"}` and
    // `{android: "live"}` — and the second would silently erase the first.
    let patch: Partial<Node> = {};
    for (const promotion of promotions) {
      patch = { ...patch, ...promotionPatch({ ...base, ...patch } as Node, promotion) };
    }
    ops.push({ op: "update_node", node_id: nodeId, patch });
  }

  return { ops, warnings };
}

export interface ApplyOutcome {
  projectId: string;
  applied: number;
  skipped?: string;
  /**
   * Things the delivery could not honour — an unusable `@platform` suffix, or a
   * platform the acceptance does not list. The route serialises outcomes into
   * the response body, which is what GitHub's **Advanced → Recent Deliveries**
   * shows — the only report channel that exists today, and the one the docs
   * already tell people to read.
   */
  warnings?: string[];
}

/**
 * The report an unusable `@platform` suffix earns, one line per mention.
 *
 * Split out of `applyPullRequestEvent` and exported because it is PURE: this
 * text is the whole of the "reported, not guessed" promise, and inline in an
 * async function that opens with a database call it could only ever be verified
 * by the Postgres-gated suite. Here the DB-free suite can pin it.
 */
export function unknownPlatformWarnings(event: Pick<PullRequestEvent, "title" | "body">): string[] {
  return mentionedAcceptances(event).unknown.map(
    (m) =>
      `${m.id}@${m.platform}: "${m.platform}" is not a platform (expected ${PLATFORM_IDS.join(", ")}). ` +
      `Nothing was scoped or promoted for this mention.`,
  );
}

/** What one project's half of a delivery produced, before it becomes a report. */
export interface OutcomeInput {
  projectId: string;
  /** From the PR TEXT, so identical for every linked project. */
  textWarnings: readonly string[];
  /** From `planForProject`, so per project. */
  planWarnings: readonly string[];
  /** How many ops the plan held — `applied` when the mutation went through. */
  opCount: number;
  /**
   * Why nothing was written, or null/undefined when the write succeeded (or
   * there was nothing to write). A project that could not be loaded and a
   * mutation the validator refused are both this.
   */
  failure?: string | null;
}

/**
 * The `{ applied, skipped, warnings }` a delivery reports for one project.
 *
 * SPLIT OUT AND EXPORTED BECAUSE IT IS PURE. Inline in `applyPullRequestEvent`
 * — an async function whose first statement is a database call — this assembly
 * was reachable only by the Postgres-gated suite, and that suite did not cover
 * it. So the branch that matters most had no test in EITHER suite: a refused
 * scope produces warnings with ZERO ops, and a previous round found those
 * warnings silently dropped on the way to the response body. The DB-free suite
 * exists precisely so that class of bug cannot hide; it could not reach here.
 *
 * Three properties this owns, each of which has been wrong at least once:
 *   - warnings survive a ZERO-op outcome (the refusal's only evidence);
 *   - warnings survive a NON-ZERO `applied` too — a PR that moved one
 *     acceptance and was refused on another reports both, and the refusal is
 *     not implied by `applied: 0`;
 *   - `skipped` AGREES with the warnings: reporting "no matching acceptance"
 *     for a PR that named one and got the platform wrong is a confidently wrong
 *     answer.
 */
export function assembleOutcome(input: OutcomeInput): ApplyOutcome {
  const { projectId, textWarnings, planWarnings, opCount, failure } = input;
  const warnings = [...textWarnings, ...planWarnings];

  const skipped = failure
    ? failure
    : opCount > 0
      ? undefined
      : textWarnings.length > 0
        ? "no usable acceptance mention"
        : planWarnings.length > 0
          ? "an acceptance was named, but no platform scope could be honoured"
          : "no matching acceptance";

  return {
    projectId,
    applied: failure ? 0 : opCount,
    ...(skipped === undefined ? {} : { skipped }),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Apply a PR event to every project that linked the repo.
 *
 * EXACTLY ONE OUTCOME PER LINK, including the ones that did nothing — so an
 * EMPTY array means no project has linked this repository at all, which is a
 * different thing from "linked, and nothing matched". `route.ts` relies on that
 * to say so in the response body; keep pushing an outcome per link, or a typo'd
 * repo link starts reading as a silent success again.
 */
export async function applyPullRequestEvent(event: PullRequestEvent): Promise<ApplyOutcome[]> {
  const links = await linkedProjects(event.repoFullName);
  const outcomes: ApplyOutcome[] = [];

  // Derived from the PR TEXT, so it is the same for every linked project —
  // computed once, attached to each outcome. Per-project reports (a platform the
  // acceptance does not list) come out of `planForProject` and are appended.
  const textWarnings = unknownPlatformWarnings(event);
  // Logged as well as returned: a repo with no linked project has no outcome to
  // carry the warning, and a mention nobody ever sees is not a report.
  for (const warning of textWarnings) console.warn(`[github] ${event.repoFullName}#${event.number}: ${warning}`);

  for (const link of links) {
    // Owner scoping is by the link itself: a repo can only be linked by someone
    // who owns the project, so the webhook acts within that authority.
    const loaded = await getProject(link.projectId, await ownerIdsFor(link.projectId));
    if (!loaded) {
      outcomes.push(
        assembleOutcome({
          projectId: link.projectId,
          textWarnings,
          planWarnings: [],
          opCount: 0,
          failure: "project not found",
        }),
      );
      continue;
    }

    const { ops, warnings: planWarnings } = planForProject(
      loaded.bundle as unknown as Parameters<typeof planForProject>[0],
      event,
      link.platform,
    );
    // Logged for the same reason as above: the response body is read by whoever
    // opens Recent Deliveries, the log by whoever is watching the server.
    for (const warning of planWarnings) {
      console.warn(`[github] ${event.repoFullName}#${event.number}: ${warning}`);
    }

    // `planWarnings` MUST reach the outcome, ops or no ops. A refused scope
    // produces warnings with ZERO ops — that is the whole point of refusing —
    // so the zero-op branch inside `assembleOutcome` is the one a user actually
    // lands on when the repository link names a platform their acceptance does
    // not list. That branch once dropped them, which turned the refusal back
    // into the silence it replaced.
    if (ops.length === 0) {
      outcomes.push(
        assembleOutcome({ projectId: link.projectId, textWarnings, planWarnings, opCount: 0 }),
      );
      continue;
    }

    const result = await applyMutation({
      projectId: link.projectId,
      ownerIds: await ownerIdsFor(link.projectId),
      ops,
      actor: "github-app",
      tier: "klub", // A webhook must not fail on a tier cap it cannot act on.
    });

    outcomes.push(
      assembleOutcome({
        projectId: link.projectId,
        textWarnings,
        planWarnings,
        opCount: ops.length,
        failure: result.ok ? null : describeFailure(result),
      }),
    );
  }

  return outcomes;
}

/** The owner of a project, as a single-element list for the store's API. */
async function ownerIdsFor(projectId: string): Promise<string[]> {
  const { rows } = await query<{ owner_id: string }>(
    `select owner_id from graph_projects where id = $1`,
    [projectId],
  );
  return rows.map((row) => row.owner_id);
}

function describeFailure(result: { reason: string } & Record<string, unknown>): string {
  if (result.reason === "validation") return "refused by the validator";
  if (result.reason === "mutation") return `refused: ${String(result.code)}`;
  return result.reason;
}

export { applyOps };
