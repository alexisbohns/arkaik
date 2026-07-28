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
import {
  githubApp,
  type ChangedFilesResult,
  type IncompleteCause,
  type PullRequestRef,
} from "@/lib/services/github/app";
import { matchChangedPaths, normalizePathPrefix } from "@/lib/services/github/paths";
import { applyMutation, getProject } from "@/lib/services/graph/store";

/**
 * Turning a `pull_request` webhook into acceptance status changes.
 *
 * The shape of the work, in order:
 *   1. resolve the repo to the projects that linked it, and to the platform
 *      each project's links declare — reading the PR's changed files first when
 *      any of those links is scoped to a subtree (see `resolveRepoScope`);
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
 * See `resolveRefScopes` for the four cases and what each one does, and
 * `resolveRepoScope` for the one level above it, where a path-scoped link that
 * could not be resolved refuses rather than borrowing the whole-repository
 * link's platform.
 *
 * ── One ref per (PR, platform) ──────────────────────────────────────────────
 * A PR can name the same acceptance for several platforms (`AC-x@ios` and
 * `AC-x@android`), so a PR is mirrored as a SET of refs on a node, one per
 * scope, rather than a single ref carrying a single `platform`. Refs are
 * matched by (url, platform); the id is minted only when a ref is created and
 * reused verbatim on a match, because `diffRefs` matches by id — re-minting
 * would emit `ref.removed` + `ref.added` on every redelivery and break the
 * idempotence the delivery ledger's release-on-failure posture depends on.
 *
 * ── WHICH OF A PULL REQUEST'S REFS A DELIVERY STILL MOVES ───────────────────
 * Not keyed to WHICH SOURCE DECIDED. A `Ref` records no provenance — it is a
 * portable bundle type with a spec behind it, not a place to keep this file's
 * bookkeeping — so "the author's mention wrote this one" is a question this
 * code cannot ask, and any rule phrased in terms of it is about something the
 * data does not say.
 *
 * THE RULE, in full, and nothing stronger:
 *
 *   For a node this delivery RESOLVED A SCOPE FOR — the pull request's current
 *   title or body names it, and the scope was not refused — a ref for this pull
 *   request is MIRRORED (`title`, `external_status`, `synced_at` refreshed) and
 *   PROMOTABLE only while some source speaking on this delivery justifies its
 *   platform: the `@platform` suffixes in the CURRENT title and body, the
 *   path-scoped links the CURRENT changed files land in, and — only where no
 *   path-scoped link matched, the one place `resolveRepoScope` reaches for it —
 *   the repository link; unioned, plus what this delivery just wrote.
 *
 *   A ref no current source justifies is FROZEN: left EXACTLY as it is. Not
 *   refreshed, not promoted, NOT REMOVED. It keeps its last truthful state.
 *
 * Precedence (mention > path > link) still decides which scopes are WRITTEN;
 * the union decides only which already-written ones this delivery still moves.
 * Answering the second question with the first is the bug this replaces: a
 * delivery decided by a MENTION left everything else alone, so a `web` ref
 * minted from path evidence earlier was refreshed to "merged" and promoted web
 * for a pull request that no longer touched the web app.
 *
 * FREEZING RATHER THAN REMOVING, because removal forces the question "can a
 * partial file list prove a platform ABSENT?", whose answer is no; freezing
 * needs no answer, since nothing is taken away on any evidence. It also loses
 * no history, and it keeps this delivery — and every later webhook delivery —
 * from writing "merged" onto a ref its own evidence no longer covers.
 *
 * What it does NOT buy is containment against `arkaik sync`, which re-fetches
 * every ref from the GitHub API on its own schedule and will mirror a frozen
 * ref to "merged" itself; `--promote` then promotes it, because sync computes
 * over the whole bundle and has no notion of a delivery. Freezing narrows what
 * THIS code claims. It cannot bind another tool that reads the same bundle —
 * see the second bullet below, which is the same fact stated as a limit.
 *
 * ── WHAT THIS RULE DOES NOT GUARANTEE ───────────────────────────────────────
 *
 *   - A FROZEN REF IS NOT DELETED. An acceptance can still show a ref for a
 *     platform the pull request no longer touches; it simply stops moving. If a
 *     truthful EARLIER delivery had already mirrored it to a promotable state
 *     it stays one, because `arkaik sync --promote` computes promotions over
 *     the whole bundle with no notion of a delivery.
 *   - A `@platform` AN AUTHOR WROTE BY HAND IS NOT SPECIAL. With no provenance,
 *     `AC-x@web` written earlier is indistinguishable from a `web` ref inferred
 *     from a path match, so once `@web` leaves the body and nothing else names
 *     web it freezes like any other. Editing the pull request is how a scope is
 *     withdrawn from this delivery's reach as well as how it is added.
 *   - INCOMPLETE EVIDENCE NARROWS NOTHING (`IncompleteCause` in
 *     lib/services/github/app.ts): truncated, out of time budget, an unreadable
 *     page, an unconfigured App. The delivery cannot then tell justified from
 *     unjustified, so it freezes nothing and mirrors and promotes exactly as it
 *     did before this slice.
 *   - A NODE THE PULL REQUEST NO LONGER NAMES freezes nothing; its refs keep
 *     being mirrored and promoted from, because a body edit must not undo a
 *     promotion that already landed. A REFUSED scope freezes nothing either —
 *     see `refusalTail`.
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
  /**
   * `installation.id` from the delivery payload, as a string (the payload
   * carries a number; `project_repos.installation_id` is text, so the
   * conversion happens once, at the route boundary).
   *
   * Null when the delivery did not come from a GitHub App installation — a
   * plain repository webhook. That is not an error for anything else this file
   * does; it only means the changed-files API is unreachable, which matters
   * exclusively to path-scoped links.
   */
  installationId: string | null;
}

/** One row of `project_repos`: ONE link, not one project. */
export interface LinkedRepo {
  projectId: string;
  platform: string | null;
  /** `""` is the whole repository (db/migrations/010_repo_path_prefix.sql). */
  pathPrefix: string;
  installationId: string | null;
}

/** The half of a link the scope resolver needs. One project may have several. */
export interface RepoLinkRow {
  platform: string | null;
  pathPrefix: string;
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

/**
 * The LINKS pointing at this repo — one row per link, so a project that scoped
 * two subtrees of a monorepo appears twice. Lowercased: GitHub is
 * case-insensitive about repository names.
 *
 * THE `order by` IS NOT COSMETIC. `groupLinksByProject` folds this list, and
 * `resolveRepoScope` reads "the whole-repository link" out of a project's
 * group. Unordered rows would make the delivery's resolved scope depend on
 * whatever order Postgres happened to return — the same pull request producing
 * `["ios"]` on one run and `[null]`, the strongest claim in the system, on the
 * next.
 */
export async function linkedProjects(repoFullName: string): Promise<LinkedRepo[]> {
  const { rows } = await query<{
    project_id: string;
    platform: string | null;
    path_prefix: string;
    installation_id: string | null;
  }>(
    `select project_id, platform, path_prefix, installation_id
       from project_repos
      where provider = 'github' and repo_full_name = $1
      order by project_id, path_prefix`,
    [repoFullName.toLowerCase()],
  );
  return rows.map((row) => ({
    projectId: row.project_id,
    platform: row.platform,
    pathPrefix: row.path_prefix,
    installationId: row.installation_id,
  }));
}

/**
 * Remember which App installation delivers this repository's webhooks.
 *
 * Written from the delivery because nothing else can know it: the id is a
 * property of (repository, App installation), identical for every project that
 * linked the repo, and it appears in the payload rather than anywhere a user
 * could type it.
 *
 * It is a REAL read, not bookkeeping: `applyPullRequestEvent` prefers the
 * payload's id and falls back to this stored one, which is what lets a delivery
 * that arrives without an `installation` object — a repository webhook
 * configured alongside the App — still reach the changed-files API. A stale
 * stored id (the App was reinstalled) fails the token exchange deterministically
 * and is reported, so it can only help.
 */
export async function recordInstallation(repoFullName: string, installationId: string): Promise<void> {
  await query(
    `update project_repos
        set installation_id = $2
      where provider = 'github' and repo_full_name = $1
        and installation_id is distinct from $2`,
    [repoFullName.toLowerCase(), installationId],
  );
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

/* ── Repository scope: which platform a delivery is about, per project ────────
 *
 * Slice 1 put this in one column: the repo link's `platform`. A monorepo cannot
 * say it that way — `apps/ios` and `apps/webapp` live in one repository — so a
 * project may now hold SEVERAL links to one repository, each scoping a platform
 * to one subtree, and the delivery decides between them by reading the pull
 * request's changed files.
 *
 * Everything in this section is pure or takes its network call as a parameter,
 * so all of it is pinned by the database-free suite.
 */

/** One project's links to the repository this delivery is about. */
export interface ProjectLinks {
  projectId: string;
  links: RepoLinkRow[];
}

/**
 * One entry per PROJECT, carrying its links — the shape the delivery loop runs
 * on.
 *
 * The loop used to run per LINK, which was indistinguishable from per project
 * while a project could only link a repository once. With several links it is
 * three separate failures: N transactions and therefore N version bumps for one
 * pull request, N journal batches for one merge, and N outcomes carrying the
 * same `projectId` — one of them reporting "no matching acceptance" for a pull
 * request a sibling link matched and applied. The fourth is the worst: two
 * links resolving separately can write an unscoped ref and a scoped one in
 * either order, and each pass freezes whichever the other just wrote, so the
 * same delivery makes opposite claims depending on row order.
 *
 * A stable input order (see `linkedProjects`) makes this a fold whose output can
 * be asserted by identity.
 */
export function groupLinksByProject(rows: readonly LinkedRepo[]): ProjectLinks[] {
  const groups = new Map<string, ProjectLinks>();
  for (const row of rows) {
    const group = groups.get(row.projectId) ?? { projectId: row.projectId, links: [] };
    group.links.push({ platform: row.platform, pathPrefix: row.pathPrefix });
    groups.set(row.projectId, group);
  }
  return [...groups.values()];
}

/**
 * Whether this delivery has to read the pull request's changed files.
 *
 * TWO conditions, and the second is what keeps the feature quiet:
 *
 *   1. some link is path-scoped. A deployment whose links are all whole-repo —
 *      which is every deployment that existed before this slice — must never
 *      need a private key and must never touch the network, so this is checked
 *      first and short-circuits.
 *
 *      "PATH-SCOPED" IS DECIDED AFTER NORMALISATION, and the two values that
 *      make that matter are `"."` and a `..` path. `"."` names the directory it
 *      sits in, so it normalises to `""` and IS the whole repository — migration
 *      010's CHECK stores it happily, and the tempting `link.pathPrefix !== ""`
 *      would make such a link demand a private key and an API call to answer a
 *      question with no path in it. A prefix that normalises to `null` goes the
 *      other way and counts as scoped: it is not the whole repository, and
 *      fetching costs one request while `resolveRepoScope` refuses it properly
 *      (rule 0) — whereas treating it as whole-repository here is the coercion
 *      that rule exists to stop.
 *   2. this delivery RESOLVES A SCOPE for some mentioned acceptance. That is a
 *      wider condition than "the path source would decide", and the widening
 *      is deliberate — see below. The only mention it excludes is the one that
 *      is refused before any source is consulted: an id whose sole `@suffix`
 *      was not a platform arkaik knows (`planForProject` CASE 2). Everything
 *      else — a bare `AC-x`, an explicit `AC-x@ios` — resolves a scope, and a
 *      resolved scope can freeze.
 *
 * ── WHY AN EXPLICIT `AC-x@ios` NOW COSTS A REQUEST, WHEN IT USED NOT TO ─────
 * This condition read "some mention would actually CONSULT the path source",
 * which is narrower: precedence means an explicit `@platform` decides before
 * the path source is reached, so such a delivery fetched nothing. That was
 * correct for DECIDING and wrong for FREEZING. The path matches are one of the
 * sources whose union says which of this pull request's refs this delivery
 * still moves (see this file's header), and a delivery that did not fetch has
 * INCOMPLETE evidence — so it freezes nothing, and a `web` ref inferred from a
 * path match in an earlier delivery was refreshed to "merged" by every
 * subsequent `AC-x@ios` delivery and stood there as a promotion `arkaik sync
 * --promote` fires out of band.
 *
 * THE COST, plainly: one extra `GET .../pulls/{n}/files` call — subject to the
 * same rate limit as any other — on each delivery of a pull request that
 * mentions an acceptance in a repository some project linked BY PATH, where
 * every mention carries an explicit `@platform`. Nothing else changes: a
 * repository with no path-scoped link still never calls GitHub back (condition
 * 1 short-circuits first), and a pull request mentioning no acceptance still
 * costs nothing.
 *
 * WORTH IT, because the alternative is not "one fewer request" but "a wrong
 * platform claim nobody sees". The request is bounded (RESOLUTION_BUDGET_MS),
 * its failure is a value rather than a throw, and a delivery that mentions an
 * acceptance is already the rare one. The fetch decision is also taken per
 * DELIVERY, before any project is loaded, so it cannot be narrowed further by
 * "only if some node actually carries a stale ref" — nothing knows that yet.
 *
 * Being over-eager here costs one API request. Being under-eager costs nothing
 * either, because a scope that was not consulted refuses (`not-consulted`)
 * rather than falling back — see `resolveRepoScope`.
 */
export function needsChangedFiles(
  event: Pick<PullRequestEvent, "title" | "body">,
  links: readonly RepoLinkRow[],
): boolean {
  if (!links.some((link) => normalizePathPrefix(link.pathPrefix) !== "")) return false;

  const { mentions, unknown } = mentionedAcceptances(event);
  const explicit = new Set(mentions.filter((m) => m.platform !== null).map((m) => m.id));
  const unusable = new Set(unknown.map((u) => u.id));
  // The refused-before-any-source case, spelled exactly as `planForProject`
  // spells it (`explicit.length === 0 && unknownNodes.has(node.id)`), so the
  // two cannot drift into fetching for a delivery that consults nothing — or,
  // far worse, not fetching for one that can freeze.
  return mentions.some((m) => explicit.has(m.id) || !unusable.has(m.id));
}

/**
 * What the delivery knows about the pull request's changed files.
 *
 * NO `null` AND NO DEFAULT, deliberately. A caller that has not fetched must
 * spell `{ kind: "not-needed" }` beside the `needsChangedFiles` call that
 * justifies it, and `not-needed` refuses rather than falling back — so a future
 * caller that forgets can only ever under-claim.
 */
export type ChangedFilesEvidence =
  | { kind: "not-needed" }
  /** `incomplete` empty means the list is WHOLE (`ChangedFiles.incomplete`). */
  | { kind: "files"; paths: readonly string[]; incomplete: readonly IncompleteCause[] }
  /** Deterministically unreadable. `reason` is shown to the user verbatim. */
  | { kind: "unavailable"; reason: string };

/**
 * The half-sentence a report uses for one reason a file list came up short.
 *
 * SEPARATE STRINGS BECAUSE THEY ARE SEPARATE FACTS. One sentence covered all
 * three and asserted GitHub's 3000-file cap as the cause of every one of them,
 * so a pull request whose second page timed out was told it "changes more files
 * than GitHub will list" — a claim about a pull request that does not exist,
 * pointing its author at nothing they can act on.
 */
const INCOMPLETE_CAUSE_TEXT: Record<IncompleteCause, string> = {
  "github-file-cap": "this pull request changes more files than GitHub will list",
  "time-budget": "reading the list of changed files ran out of the time budget arkaik gives one delivery",
  "unreadable-entry": "GitHub returned changed-file entries arkaik could not read",
};

/**
 * Every observed cause, joined — never a chosen one. Two causes can hold at
 * once (the cap and a dropped entry), and reporting one of them would be this
 * round's defect at one remove.
 */
export function describeIncomplete(causes: readonly IncompleteCause[]): string {
  const parts = causes.map((cause) => INCOMPLETE_CAUSE_TEXT[cause]);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The platform scope one project's links resolve to for this delivery.
 *
 * THREE STATES, and the middle one is why this is not just a list of platforms:
 *
 *   - `links` with platforms — the links contribute a scope;
 *   - `links` with none — the links are SILENT ("All platforms"), which is the
 *     ordinary whole-repository arrangement and still writes one unscoped ref;
 *   - `no-platform` — the links ASKED to be scoped by path and the question
 *     could not be answered. That is not the same as silent, and collapsing the
 *     two would answer "I do not know which platform" with a claim about all of
 *     them (see this file's header).
 */
export type RepoScope =
  | {
      kind: "links";
      /** From the path-scoped links this PR's files landed in. */
      pathPlatforms: string[];
      /** Those links' prefixes, so a report can name which row to edit. */
      pathPrefixes: string[];
      /** From the whole-repository link, the lowest-precedence source. */
      linkPlatform: string | null;
      /**
       * Empty means the changed-file list was WHOLE.
       *
       * Non-empty says two things at once, and both are load-bearing: what
       * matched is still real (a missing file cannot invent a match), and no
       * ref may be FROZEN on this delivery (a missing file can hide the
       * evidence that justifies one). Each cause is carried, not collapsed, so
       * a report names the one it observed.
       */
      incomplete: readonly IncompleteCause[];
    }
  | {
      kind: "no-platform";
      /**
       * Which of the six ways it failed, for tests to assert by identity.
       *
       * `outside-every-prefix` is the only one of the six that rests on a
       * COMPLETE reading: the files were all read and none of them is inside
       * any prefix, so the path source genuinely names nothing. The other five
       * are all "arkaik could not see", and `planForProject` treats them as
       * incomplete evidence and freezes no ref under them.
       */
      reason:
        | "outside-every-prefix"
        | "truncated-no-match"
        | "truncated-platformless-match"
        | "not-consulted"
        | "unavailable"
        | "unusable-prefix";
      /**
       * The clause a warning splices after "and". Starts lower-case and carries
       * NO terminal full stop — the warning supplies that. It may contain
       * further complete sentences after the first (`unusable-prefix` ends with
       * an instruction), but it must not end on punctuation.
       */
      detail: string;
      /**
       * An operator-facing explanation, in complete sentences, appended at the
       * END of the warning rather than spliced into it.
       *
       * This exists because `unavailable`'s explanation comes from
       * `ChangedFilesResult.reason`, which is written as one-or-more finished
       * sentences for GitHub's Recent Deliveries. Splicing it after "and" and
       * then adding the warning's own full stop produced a double period and a
       * paragraph-long run-on clause. `detail` stays a clause; this stays
       * sentences; nothing has to be reworded twice.
       */
      cause?: string;
      /**
       * Every configured path-scoped prefix, so a typo'd one is visible in the
       * report. Normalised, except under `unusable-prefix` — where the whole
       * point is that they could not be normalised, so they are quoted as
       * STORED and the report names the row a human has to go and edit.
       */
      prefixes: string[];
    };

/**
 * One project's links plus what is known about the changed files, resolved to a
 * scope.
 *
 * The rules, in order:
 *   (0) a stored prefix that cannot be normalised at all -> refuse, naming the
 *       row. FIRST, before even rule (a) — see below;
 *   (a) no path-scoped link at all -> behave exactly as before this slice, and
 *       do not look at the evidence. This is what keeps a non-monorepo
 *       deployment unaffected even when a SIBLING project on the same
 *       repository forced a fetch that failed;
 *   (b) the files could not be read -> refuse;
 *   (c) a path-scoped link matched -> its platforms, plus the whole-repository
 *       link behind it as the lower-precedence source. EXCEPT when the only
 *       links it matched name NO platform and the list was partial: an unread
 *       page could have landed in one that does, so that refuses too — see
 *       below;
 *   (d) nothing matched and a whole-repository link exists -> that link. It is
 *       the user's stated fallback: "anything I did not scope is this";
 *   (e) nothing matched and there is no fallback -> refuse.
 *
 * ── WHY (b) DOES NOT FALL BACK TO THE WHOLE-REPOSITORY LINK ────────────────
 * Its platform is known without any API call, so the temptation is real. But
 * `''` means "no path-scoped link matched", and that is a fact the delivery did
 * not establish — the pull request may well have touched only `apps/ios`. Worse,
 * a whole-repository link with no platform resolves to one UNSCOPED ref, which
 * moves the base status and marks every platform shipped. Reaching for the
 * biggest claim in the system at the moment of least knowledge is the exact
 * failure this file exists to prevent.
 *
 * An INCOMPLETE list is asymmetric for the same reason: a missing file can only
 * REMOVE a match, never invent one, so platforms found in a partial list are
 * real (rule c stands) but "nothing matched" in a partial list is not evidence
 * (rule d does not apply, and it refuses instead). The same asymmetry is why
 * `planForProject` freezes no ref when `incomplete` is non-empty.
 *
 * ── WHY (c) HAS AN EXCEPTION, AND WHY IT IS THE SAME RULE ──────────────────
 * A path-scoped link set to "All platforms" MATCHES WITHOUT NAMING ANYTHING.
 * With a whole list that is an honest answer — every file was read, the ones
 * that landed anywhere landed in platform-less links — so precedence falls
 * through to the whole-repository link, or to one unscoped ref. With a PARTIAL
 * list it is not an answer at all: the pages arkaik never read are exactly
 * where a file inside `apps/ios` would be, and "the platform-scoped links
 * matched nothing" is the claim a partial list cannot make. Falling through
 * there hands back the largest claim in the system (an unscoped ref moves the
 * BASE status) on the strength of a page nobody read. It refuses instead, for
 * the same reason rule (d) does.
 *
 * ── WHY (0) EXISTS, AND WHY IT COMES FIRST ─────────────────────────────────
 * `normalizePathPrefix` returns null for a prefix it cannot make sense of —
 * today a `..` segment. `linkRepo` refuses those, but the database is not the
 * only writer: a restore, a hand-edited row, or the next caller can put one
 * there, and migration 010's CHECK does not forbid `..` (it forbids leading and
 * trailing slashes, empty segments and edge whitespace — `apps/../ios` passes
 * all five).
 *
 * This used to read `normalizePathPrefix(link.pathPrefix) ?? ""`, and `""` is
 * not a neutral default here: it is the value that MEANS THE WHOLE REPOSITORY.
 * So the least trustworthy row in the table was silently promoted from "one
 * subtree" to "all of it", where it both stopped counting as path-scoped (rule
 * (a) then behaved as if the project had no monorepo links at all) and became
 * the FALLBACK rule (d) reaches for — claiming its platform for every pull
 * request in the repository. Two failures, one `??`.
 *
 * Refusing first is what makes that unspellable: a link nobody can interpret
 * cannot be interpreted as the biggest claim in the system, and the report
 * names the stored value so the row can be fixed.
 */
export function resolveRepoScope(
  links: readonly RepoLinkRow[],
  evidence: ChangedFilesEvidence,
): RepoScope {
  // Normalised on read as well as on write: a row that predates the check
  // constraint, or one restored from elsewhere, must not become an
  // unmatchable link (see lib/services/github/paths.ts).
  const normalized: { prefix: string; platform: string | null }[] = [];
  const unusable: string[] = [];
  for (const link of links) {
    const prefix = normalizePathPrefix(link.pathPrefix);
    if (prefix === null) {
      unusable.push(link.pathPrefix);
      continue;
    }
    normalized.push({ prefix, platform: link.platform });
  }

  // (0) — before rule (a), so an uninterpretable row can never be read as the
  // absence of path scoping. The refusal covers the WHOLE project group, not
  // just the bad row: the pull request may well belong to the subtree that row
  // was meant to name, so honouring the siblings would answer a question this
  // delivery cannot answer.
  if (unusable.length > 0) {
    return {
      kind: "no-platform",
      reason: "unusable-prefix",
      detail:
        `arkaik cannot read the path ${unusable.map((p) => `"${p}"`).join(" or ")} stored on one of ` +
        `them — a ".." segment names no directory — so which subtree of the repository these links ` +
        `cover is not knowable. Edit the link (or remove and re-add it) with a plain path such as ` +
        `"apps/ios"`,
      // As STORED, and including the unusable ones: this is the one report
      // whose whole job is to point at a row nobody can otherwise see.
      prefixes: links.map((link) => link.pathPrefix).filter((p) => p !== ""),
    };
  }

  const scoped = normalized.filter((link) => link.prefix !== "");
  const fallback = normalized.find((link) => link.prefix === "") ?? null;
  const prefixes = scoped.map((link) => link.prefix).sort();

  // (a) The pre-slice-2 world, untouched — and the evidence is never read, so
  // this cannot be affected by another project's failed fetch.
  if (scoped.length === 0) {
    return {
      kind: "links",
      pathPlatforms: [],
      pathPrefixes: [],
      linkPlatform: fallback?.platform ?? null,
      // COMPLETE, and not by accident: with no path-scoped link there is no
      // path source, so there is nothing a longer file list could have added.
      // This is what lets a plain whole-repository project freeze a stale ref
      // normally while never making an API call.
      incomplete: [],
    };
  }

  if (evidence.kind === "unavailable") {
    return {
      kind: "no-platform",
      reason: "unavailable",
      detail: "arkaik could not read which files it changes",
      // The client's own sentences, kept whole and moved to the end of the
      // warning rather than spliced mid-clause — see `RepoScope.cause`.
      cause: evidence.reason,
      prefixes,
    };
  }
  if (evidence.kind === "not-needed") {
    // Unreachable while `needsChangedFiles` gates the fetch: it returns true for
    // exactly the mentions that reach the path source. Kept as a REFUSAL rather
    // than an assertion so that if the gate ever grows a hole, the hole
    // under-claims instead of over-claiming.
    return {
      kind: "no-platform",
      reason: "not-consulted",
      detail: "arkaik did not read its changed files",
      prefixes,
    };
  }

  const match = matchChangedPaths(evidence.paths, scoped);

  if (match.prefixes.length > 0) {
    // (c) EXCEPT: matched, but every matching link is "All platforms", so the
    // path source names nothing — AND the list was partial. Falling through
    // here would answer with the whole-repository link or, with none, with one
    // unscoped ref, on the strength of pages nobody read. Refuse instead; see
    // the header above this function.
    if (match.platforms.length === 0 && evidence.incomplete.length > 0) {
      return {
        kind: "no-platform",
        reason: "truncated-platformless-match",
        detail:
          `${describeIncomplete(evidence.incomplete)}, so the only links the files arkaik could ` +
          `read landed in are ones that name no platform — and a file it could not read might ` +
          `land in one that does`,
        prefixes,
      };
    }
    // Note `pathPlatforms` may still be empty on a WHOLE list — a matched link
    // with no platform ("All platforms" on a shared directory) matches without
    // contributing, which suppresses (e) and lets precedence fall through.
    return {
      kind: "links",
      pathPlatforms: match.platforms,
      pathPrefixes: match.prefixes,
      linkPlatform: fallback?.platform ?? null,
      incomplete: evidence.incomplete,
    };
  }

  if (evidence.incomplete.length > 0) {
    return {
      kind: "no-platform",
      reason: "truncated-no-match",
      // Names the cause it OBSERVED. This sentence used to assert GitHub's
      // 3000-file cap whatever had actually happened, so a pull request of
      // eleven files whose page read timed out was told it was too large.
      detail:
        `${describeIncomplete(evidence.incomplete)}, so none of the files arkaik could read are ` +
        `inside any of them and the ones it could not read might be`,
      prefixes,
    };
  }

  // (d)
  if (fallback) {
    return {
      kind: "links",
      pathPlatforms: [],
      pathPrefixes: [],
      linkPlatform: fallback.platform,
      // Reached only when `evidence.incomplete` is empty (the branch above
      // returns otherwise), so this is the file list as GitHub has it.
      incomplete: [],
    };
  }

  // (e)
  return {
    kind: "no-platform",
    reason: "outside-every-prefix",
    detail: "none of this pull request's changed files are inside any of them",
    prefixes,
  };
}

/**
 * The network call this delivery needs, if any — injected, with no default.
 *
 * A test that forgets to supply one is a type error rather than a suite that
 * quietly reaches api.github.com.
 */
export type FetchChangedFiles = (pr: PullRequestRef) => Promise<ChangedFilesResult>;

/**
 * Every project's scope for one delivery, with AT MOST ONE fetch.
 *
 * The fetch decision is per DELIVERY (the file list is a property of the pull
 * request, not of a project), while rule (a) inside `resolveRepoScope` is per
 * PROJECT. That split is the load-bearing part: a project whose links are all
 * whole-repository must be unaffected either way, and a project that needs the
 * files must not make a second identical request because a sibling already
 * asked.
 *
 * The fetch happens HERE, before any project is loaded and long before any
 * mutation, so a transient failure throws with zero writes performed. The route
 * then releases the delivery claim and GitHub's redelivery redoes the whole
 * thing from a clean slate — rather than merely relying on re-application being
 * a no-op, which it is, but which is a worse thing to depend on.
 */
export async function resolveDeliveryScopes(input: {
  groups: readonly ProjectLinks[];
  event: PullRequestEvent;
  installationId: string | null;
  fetchFiles: FetchChangedFiles;
}): Promise<Map<string, RepoScope>> {
  const { groups, event, installationId, fetchFiles } = input;

  let evidence: ChangedFilesEvidence = { kind: "not-needed" };
  if (groups.some((group) => needsChangedFiles(event, group.links))) {
    const result = await fetchFiles({
      repoFullName: event.repoFullName,
      number: event.number,
      installationId,
    });
    evidence = result.ok
      ? { kind: "files", paths: result.changed.paths, incomplete: result.changed.incomplete }
      : { kind: "unavailable", reason: result.reason };
  }

  return new Map(groups.map((group) => [group.projectId, resolveRepoScope(group.links, evidence)]));
}

interface NodeWithRefs extends Node {
  metadata?: Node["metadata"] & { refs?: Ref[] };
}

/**
 * One place a platform scope can come from, for one node.
 *
 * `explicit` records the PROVENANCE OF THE SOURCE — not of a ref — and it
 * decides exactly one thing: what happens when the node does not list the
 * platform the source named.
 *
 * An EXPLICIT platform is a human statement, so it is kept on the ref and
 * `computeRefPromotions` refuses the promotion with `platform-not-applicable`,
 * which the caller reports. An INFERRED one (the path match, the repo link)
 * means arkaik's own bookkeeping disagrees with itself, and there is no human
 * statement to preserve — so the scope is refused outright. Neither one
 * degrades to an unscoped ref.
 *
 * IT USED TO DECIDE A SECOND THING, AND THAT WAS THE BUG. The reasoning was:
 * an inferred source is recomputed from current facts, so when an inferred
 * source DECIDES, its platform set is everything this delivery has evidence
 * for, and any other ref for this pull request may be dropped — while a
 * mention, being a human statement rather than an enumeration, drops nothing.
 * Both halves were wrong in the same way. It made the fate of a ref depend on
 * WHICH SOURCE DECIDED, and a ref carries no record of which source created it,
 * so the rule quietly meant "act on refs whose provenance we are guessing at":
 * an `AC-x@ios` delivery left a stale path-derived `web` ref in place (and
 * promoted from it), while a path-decided delivery deleted a `web` ref an author
 * had written by hand. Whether a ref is FROZEN is now a property of the UNION
 * of the live sources and of the completeness of the evidence — see this file's
 * header — and needs no provenance at all.
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
 * A list rather than a chain of ternaries: the path source slotted in between
 * mention and link as one more entry rather than a rewrite, and the next source
 * will too.
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

    // An INFERRED source decided, filtered to what this acceptance lists: the
    // platforms it does not list were never claimable here, so writing a ref
    // for one would be a claim with nowhere to land. (What is WRITTEN is all
    // this decides. Which already-written refs this delivery still moves is a
    // separate question answered by the union of the live sources — see this
    // file's header.)
    const applicable = source.platforms.filter((p) => node.platforms.includes(p));
    if (applicable.length > 0) return { scopes: sortedScopes(applicable) };

    // This source NAMED platforms and none of them apply to this node. Refused
    // here rather than falling through to the next source: a source that named
    // a platform stated an intent, and quietly trying a different one is the
    // same downgrade wearing a different hat.
    //
    // An empty `scopes` is what makes the caller mark this node REFUSED, and a
    // refused node freezes nothing — a refusal is the statement "this delivery
    // could not decide", and freezing on it would stop mirroring every ref this
    // pull request ever left at exactly the moment arkaik admitted it did not
    // know. Same reasoning as "a refusal promotes nothing", pointed the other
    // way.
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
 * The sentence every refusal ends with — one place, because it is the same fact
 * three times and it was subtly false in all three.
 *
 * WHAT IT USED TO SAY: "A ref this pull request already left on X keeps being
 * mirrored, but nothing is promoted from it either." The second clause reads as
 * containment, and it is not. A refused node's refs are still refreshed by the
 * mirror above — `external_status` moves to "merged" on the merge delivery —
 * and they are still ATTACHED. `arkaik sync --promote` runs
 * `computeRefPromotions` over the whole bundle with no per-delivery filter, so
 * a merged, attached, promotable ref is a promotion waiting to happen. The
 * refusal scopes THIS delivery's plan and nothing else.
 *
 * WHY THE REFRESH IS KEPT RATHER THAN SKIPPED FOR A REFUSED NODE — the other
 * way to close the gap, and it closes nothing. `arkaik sync` fetches each ref's
 * CURRENT status from GitHub and writes it before it promotes
 * (packages/cli/src/commands/sync.ts, steps 2 and 4), so a ref this delivery
 * left stale at "open" is refreshed to "merged" by sync itself and then
 * promoted exactly as before. Skipping the refresh would buy no containment and
 * cost the thing the mirror is for: a ref frozen at "open" on a merged pull
 * request, which docs/hosted-projects.md promises will not happen. So the code
 * keeps mirroring and the sentence stops over-promising.
 */
const refusalTail = (nodeId: string): string =>
  `A ref this pull request already left on ${nodeId} keeps being mirrored — including to this ` +
  `pull request's current state — and THIS plan promotes nothing from it. It is not removed ` +
  `either, so anything that later computes promotions over the whole bundle (arkaik sync ` +
  `--promote) can still promote from it.`;

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
  scope: RepoScope,
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

  // A stored value that is not a platform is degraded to "this source names
  // nothing" rather than trusted. `project_repos.platform` and `path_prefix` are
  // both written only through the repos API and both have a database check
  // constraint behind them, so this is a floor, not a live case.
  const pathPlatforms = scope.kind === "links" ? scope.pathPlatforms.filter(IS_PLATFORM) : [];
  const linkPlatform =
    scope.kind === "links" && scope.linkPlatform && IS_PLATFORM(scope.linkPlatform)
      ? scope.linkPlatform
      : null;
  /**
   * WHETHER A PATH-SCOPED LINK MATCHED — which is exactly when the
   * whole-repository link STOPS SPEAKING on this delivery.
   *
   * `resolveRepoScope` reaches for the whole-repository link in rule (d), i.e.
   * when NO path-scoped link matched; rule (c) carries it along only as the
   * lower-precedence source for what to WRITE when the matched links named no
   * platform. So it is not a live source once a path link matched — and letting
   * it into the justification union there let a whole-repository `ios` fallback
   * keep a stale `ios` ref moving for a pull request whose files this delivery
   * had positively read as landing under `apps/webapp` alone. Positive evidence
   * of where the files ARE was overruled by a fallback that means "anything I
   * did not scope", about files that WERE scoped.
   */
  const pathMatched = scope.kind === "links" && scope.pathPrefixes.length > 0;
  /**
   * How a report names the path source.
   *
   * The prefixes are the load-bearing half. `ScopeSource.label` is read into
   * "…the repository link says "ios", which AC-x does not list…", and with
   * several links on one repository "the repository link" no longer identifies
   * which row to edit — which is the whole reason that message names both sides.
   */
  const pathLabel =
    scope.kind === "links" && scope.pathPrefixes.length > 0
      ? `the path-scoped repository link (${scope.pathPrefixes.join(", ")})`
      : "the path-scoped repository link";

  /**
   * WHETHER THIS DELIVERY SAW ENOUGH TO TELL JUSTIFIED FROM UNJUSTIFIED — the
   * gate on every FREEZE below, and on nothing else.
   *
   * Presence and absence are not symmetric here (see `resolveRepoScope`): a
   * file arkaik never read can only hide a match, so a partial list proves
   * platforms PRESENT and can never prove one ABSENT. Freezing a ref rests on
   * "no live source names this platform", which is a claim of absence, so it is
   * made only from a whole list. When this is false the delivery mirrors and
   * promotes exactly as it did before path-scoped links existed: incomplete
   * evidence must never narrow anything.
   *
   * `outside-every-prefix` is the one refusal reached from a WHOLE list: every
   * changed file was read and none of them is inside any configured prefix, so
   * the path source names nothing and that is a fact rather than a blind spot.
   * (`pathPlatforms` and `linkPlatform` are empty there by construction — the
   * rule is reached only with no match and no fallback link — so the union
   * below is correct without them.) The other five refusals are all "arkaik
   * could not see", and they freeze nothing.
   */
  const evidenceComplete =
    scope.kind === "links" ? scope.incomplete.length === 0 : scope.reason === "outside-every-prefix";

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
   * ONE predicate gates refreshing, minting, the freeze filter and `touched`,
   * deliberately. Restricting only the refresh would leave the freeze filter —
   * which would then match on url alone — free to act on the very ref it
   * declines to adopt, which is adoption wearing a worse hat. A ref of another
   * type at this url is simply not this mirror's business, in either direction.
   *
   * KNOWN LIMITATION, accepted: renaming or transferring the repo changes
   * `html_url`, so the next delivery writes a NEW ref and the old one stays at
   * its last mirrored status. It is cosmetic — the stale ref has a different
   * url, so it never enters `touched` and can never be promoted BY THIS
   * DELIVERY, and `freeRefId` keeps it from colliding. Repointing refs on a
   * rename would need the repository-rename event and a way to know which of a
   * node's refs came from that repo; nothing is built for that.
   */
  const isMirrored = (ref: Ref): boolean => ref.url === event.url && ref.type === "github-pr";

  /**
   * EVERY ID THIS PULL REQUEST NAMES, usably or not.
   *
   * `mentionedNodes` alone is not that set, and the difference is a live bug
   * rather than a nicety. A pull request whose ONLY reference to an acceptance
   * is `AC-x@ios-tablet` puts the id in the `unknown` channel and nowhere else,
   * so `mentionedNodes` does not hold it — and the CASE 2 refusal below, gated
   * on `mentionedNodes.has`, was never reached. The node then took the
   * "referenced but not named" path: every ref this pull request had already
   * left on it was mirrored to the merge and promoted from, UNREFUSED. The
   * typo'd suffix, whose entire purpose is to stop a guess, silently permitted
   * the strongest form of one.
   *
   * The refusal is a property of the ID BEING NAMED, not of a usable mention
   * happening to sit beside the typo, so this is the set the loop runs on.
   */
  const namedNodes = new Set<string>([...mentionedNodes, ...unknownNodes]);

  for (const node of nodes) {
    const existing = node.metadata?.refs ?? [];
    // A node is in scope if it already carries one of this mirror's refs for
    // this PR, or if the PR names it — usably or not.
    const referencesPr = existing.some(isMirrored);
    if (!referencesPr && !namedNodes.has(node.id)) continue;

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
    if (namedNodes.has(node.id)) {
      const explicit = explicitPlatforms.get(node.id) ?? [];
      if (explicit.length === 0 && unknownNodes.has(node.id)) {
        // CASE 2: the author wrote an `@suffix` for this id that is not a
        // platform, and nothing else this pull request says about the id gives
        // a usable scope. A bare mention beside it is NOT a fallback — reading
        // it as one hands back the biggest claim in the system in answer to a
        // typo — and neither is the id merely being named: this branch is
        // reached whether or not a bare mention exists, because the refusal
        // belongs to the ID, not to the company it keeps.
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
          `${node.id}: an @platform suffix written for this acceptance was not understood, so ` +
            (mentionedNodes.has(node.id)
              ? `the bare mention of ${node.id} was NOT used as a fallback — that would have moved ` +
                `the base status, marking every platform shipped. `
              : `nothing was inferred from naming ${node.id} at all — the repository link would ` +
                `have been the fallback, and answering a typo with it is the same guess. `) +
            `The plan attaches no ref and promotes no status for it. ${refusalTail(node.id)} ` +
            `Fix the suffix; editing the pull request re-delivers.`,
        );
      } else if (explicit.length === 0 && scope.kind === "no-platform") {
        // CASE 2b: this repository is linked BY PATH — a standing request to
        // scope every pull request — and that request could not be answered.
        //
        // Decided here rather than inside `resolveRefScopes` because no source
        // NAMES anything in this situation: an empty `platforms` list means
        // "silent", which is how an ordinary All-platforms link must keep
        // behaving, and case 4's `[null]` would follow — "nothing anywhere named
        // a platform, so nothing is being downgraded" is simply false when the
        // configuration is a standing request to scope.
        //
        // Every configured prefix is quoted, not just the ones that failed, so a
        // typo (`apps/i0s`) is visible in the one channel the user reads.
        refusedScope = true;
        warnings.push(
          `${node.id}: ${event.repoFullName} is linked by path (${scope.prefixes.join(", ")}), and ` +
            `${scope.detail}. The plan attaches no ref and promotes no status for it — an unscoped ` +
            `ref here would move the base status, marking every platform shipped. ` +
            `${refusalTail(node.id)}` +
            // `cause` is the GitHub client's own finished sentences (a missing
            // env var, a revoked installation). Appended whole at the end
            // rather than spliced after "and", which produced a double period
            // and a paragraph-long clause — see `RepoScope.cause`.
            //
            // BEHIND A LEAD-IN, because those sentences are written to follow
            // "and" and so begin lower-case ("this delivery carries no…").
            // Dropped in after a full stop they would read as a typo; after a
            // colon they read as what they are.
            `${scope.cause ? ` Why arkaik could not read them: ${scope.cause}` : ""}`,
        );
      } else {
        resolution = resolveRefScopes(node, [
          { label: "the mention", platforms: explicit, explicit: true },
          // BETWEEN mention and link, and `explicit: false` — which is not a
          // stylistic choice. A path match is inference by construction: the
          // author wrote Swift under `apps/ios`, they did not write the sentence
          // "this ships on iOS". So when the acceptance does not list a
          // path-derived platform, that is arkaik's own bookkeeping disagreeing
          // with itself and there is no human statement to preserve on the ref.
          // The mechanical consequence is also the one that is wanted: an
          // inferred source is FILTERED to the platforms the node lists first,
          // so a pull request touching `apps/ios` and `apps/webapp` that names a
          // web-only acceptance is honoured as web rather than refused.
          { label: pathLabel, platforms: pathPlatforms, explicit: false },
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
              `${refusalTail(node.id)}`,
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

    /**
     * ── WHICH OF THIS PULL REQUEST'S REFS THIS DELIVERY STILL MOVES ────────
     *
     * THE FAILURE THIS ADDRESSES. Links `apps/ios` -> ios and `apps/webapp` ->
     * web. Pull request #42 opens touching both trees, so an early delivery
     * writes `gh-pr-42-ios` AND `gh-pr-42-web`. The author drops the webapp
     * commits and merges. Nothing about the pull request says "web" any more,
     * yet `gh-pr-42-web` is refreshed to "merged" and promoted — so web goes
     * live for a pull request that does not touch the web app.
     *
     * THE RULE. Provenance is not available and is not needed. A ref for this
     * pull request is mirrored and promotable while ANY source SPEAKING ON THIS
     * DELIVERY justifies its platform — the `@platform` suffixes in the current
     * title and body, the path-scoped links the current changed files land in,
     * and (only where no path-scoped link matched) the repository link,
     * unioned, plus whatever this delivery just wrote. One that no source
     * justifies is FROZEN: not refreshed, not promoted, NOT REMOVED.
     *
     * Precedence still decides what is WRITTEN; this decides only which
     * already-written refs move, and the two questions have different answers
     * on purpose: an `AC-x@ios` mention outranks a `web` path match for
     * writing, while the path match is still perfectly good evidence that a
     * `web` ref belongs.
     *
     * ── WHY FROZEN AND NOT REMOVED ─────────────────────────────────────────
     * Removal is a claim of ABSENCE, and the file list this rule reads can be
     * partial — the page arkaik never read is exactly where the contrary
     * evidence would be. Freezing never makes that claim. It still buys the
     * containment removal was reached for: a frozen ref is not carried forward
     * to "merged", so a pull request that stopped touching `apps/webapp` cannot
     * turn its stale `web` ref into a standing `live` promotion that `arkaik
     * sync --promote` — which runs `computeRefPromotions` over the whole bundle
     * with NO per-delivery filter, unlike the `touched` gate below — fires out
     * of band. It does NOT undo a promotable state an earlier truthful delivery
     * already wrote; only removal would, and that is what this refuses to do.
     *
     * ── WHAT IT DOES NOT COVER ─────────────────────────────────────────────
     * Only nodes this delivery RESOLVED a scope for, on COMPLETE evidence. A
     * node reached purely through an existing ref (`referencesPr`, no mention)
     * has no source speaking about it, so its refs are mirrored and left alone
     * — a body edit that drops a mention must not undo a promotion that already
     * landed. A REFUSED node is left alone because a refusal establishes
     * nothing at all, and an incomplete list freezes nothing whatsoever: see
     * `evidenceComplete`.
     */
    const freezes = mentionedNodes.has(node.id) && !refusedScope && evidenceComplete;
    const justified = new Set<PlatformId | null>([
      // What this delivery WROTE is justified by construction — precedence
      // chose it. Listing it explicitly is what keeps case 4 (nothing named a
      // platform anywhere, so one unscoped ref) from freezing its own ref.
      ...scopes,
      ...(explicitPlatforms.get(node.id) ?? []),
      // The raw source platforms, NOT filtered to `node.platforms`. The filter
      // exists to stop a ref being WRITTEN with nowhere to land; a ref that
      // already exists for such a platform promotes nothing anyway
      // (`platform-not-applicable`), and freezing it would be a claim this
      // rule's sentence does not license.
      ...pathPlatforms,
      // ONLY WHEN THE PATH SOURCE NAMED NOTHING — the same condition under which
      // `resolveRefScopes` skips a silent source and lets the link decide what
      // gets WRITTEN. Keyed on `pathPlatforms`, not on `pathMatched`: a matched
      // link carrying `platform: null` matches without naming anything, and
      // keying on the match would then let the link decide the write while being
      // refused a say in what stays justified — two answers to one question.
      // Unconditionally, meanwhile, this fallback justified a stale ref for its
      // own platform even on a delivery whose changed files were positively read
      // as landing inside a DIFFERENT path-scoped link.
      ...(pathPlatforms.length === 0 && linkPlatform ? [linkPlatform] : []),
    ]);
    /**
     * A ref this delivery must leave exactly as it is.
     *
     * Gated on `isMirrored` like everything else in this loop: a hand-written
     * `{ type: "url" }` ref at this url is not this mirror's business, and
     * "frozen" is as much an act on a ref as refreshing it.
     */
    const isFrozen = (ref: Ref): boolean =>
      isMirrored(ref) && freezes && !justified.has((ref.platform ?? null) as PlatformId | null);

    // Mirror EVERY ref pointing at this PR that is not frozen, whatever its
    // scope — not just the ones this delivery resolves. Otherwise a scoped ref
    // stops being refreshed the moment its `@platform` disappears from the body
    // while some other source still names it, and sits at "open" forever while
    // the PR is merged: a mirror that has quietly stopped mirroring.
    //
    // `type` is NOT rewritten here. It used to be — `type: "github-pr"` sat in
    // this spread — which silently converted a hand-written `{ type: "url" }`
    // ref at the same url into a promotable one; see `isMirrored`.
    const refs: Ref[] = existing.map((ref) =>
      isMirrored(ref) && !isFrozen(ref)
        ? {
            ...ref,
            title: event.title,
            external_status: externalStatus,
            synced_at: now,
          }
        : ref,
    );

    const frozen = existing.filter(isFrozen).map((ref) => ref.platform ?? "no platform");
    if (frozen.length > 0) {
      // The sources are listed from what this delivery ACTUALLY consulted, not
      // from the full set the rule can consult. Naming "the path-scoped links"
      // to someone who has none, or telling them the whole-repository link
      // "does not speak here" on a delivery where it is the only thing that
      // decided the scope, is a report that sends the reader to look at the
      // wrong thing — worse than a shorter one.
      const consulted = ["an @platform in the pull request's current title or body"];
      if (pathMatched) consulted.push("the path-scoped repository links its changed files land in");
      if (pathPlatforms.length === 0 && linkPlatform) consulted.push("the repository link");
      // Why a source the reader can SEE configured was not consulted. Gated on
      // the condition that actually excludes it — a path link that matched AND
      // named a platform — rather than on a bare match: a matched link carrying
      // no platform leaves the fallback live, and saying otherwise would send
      // someone to change a link that is working correctly.
      const fallbackSilent =
        pathPlatforms.length > 0 && linkPlatform
          ? ` (the whole-repository link names ${linkPlatform}, but it does not speak here: a ` +
            `path-scoped link matched and named a platform, which is what that fallback is the ` +
            `fallback FOR)`
          : "";
      warnings.push(
        `${node.id}: nothing this delivery consulted justifies the ref this pull request left for ` +
          `${frozen.join(", ")} — not ${consulted.join(", nor ")}${fallbackSilent}. So this plan FREEZES it: it is ` +
          `not refreshed to this pull request's current state, and this plan promotes nothing ` +
          `from it. It is NOT removed — ${node.id} still carries a ref for a platform this pull ` +
          `request no longer touches; it simply stops moving. Note that arkaik sync re-reads refs ` +
          `from the GitHub API on its own schedule, so with --promote it can still mirror and ` +
          `promote from a frozen ref; freezing narrows what this webhook claims, not what every ` +
          `tool reading the bundle claims.`,
      );
    }

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

    const patch = { metadata: { ...node.metadata, refs } };
    ops.push({ op: "update_node", node_id: node.id, patch });
    patched.push({ ...node, ...patch } as Node);
    // WHAT THIS DELIVERY MAY PROMOTE FROM. Two exclusions, and both have been
    // wrong at least once:
    //
    //   - a REFUSED scope registers nothing. The mirror above still ran — the
    //     ref stays fresh — but an empty set is how "attaches no ref and
    //     promotes no status" becomes true of the redelivery as well as the
    //     first delivery. Registering the refreshed ids here is what once let a
    //     refusal promote on every subsequent delivery of the same PR;
    //   - a FROZEN ref does not promote. Its whole definition is that no live
    //     source justifies its platform, and promoting from what this delivery
    //     declined to even refresh would be the contradiction in one step.
    touched.set(
      node.id,
      refusedScope
        ? new Set<string>()
        : new Set(refs.filter((ref) => isMirrored(ref) && !isFrozen(ref)).map((r) => r.id)),
    );
  }

  // An incomplete list is reported only when something was actually planned
  // from it. Incompleteness with NO match never reaches here — it refuses in
  // `resolveRepoScope` — and a warning beside zero ops would make
  // `assembleOutcome` report "no platform scope could be honoured" for a
  // delivery whose scope was honoured fine.
  if (scope.kind === "links" && scope.incomplete.length > 0 && ops.length > 0) {
    warnings.push(
      `${event.repoFullName}#${event.number}: ${describeIncomplete(scope.incomplete)}, so arkaik ` +
        `matched the path-scoped repository links against a partial list. A platform it found is ` +
        `real; one it missed is simply not claimed. Nothing is frozen from a partial list either — ` +
        `every ref this pull request left is mirrored and promoted from exactly as it would have ` +
        `been before path-scoped links existed.`,
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

/**
 * The App installation id this delivery will authenticate as.
 *
 * THE PAYLOAD'S FIRST, THE STORED ONE AS A FALLBACK, and the fallback is the
 * whole reason this exists. A repository can be wired to arkaik as a plain
 * repository webhook ALONGSIDE the App: those deliveries carry no `installation`
 * object at all, so `event.installationId` is null and the changed-files API —
 * which is authenticated as the installation — would be unreachable. Every
 * path-scoped link on that repository would then refuse, on every such delivery,
 * with "this delivery carries no GitHub App installation id". The id is a
 * property of (repository, installation) and identical for every project that
 * linked the repo, so the one `recordInstallation` stored from an earlier
 * App delivery is exactly the right value.
 *
 * The payload wins when both exist: a reinstall mints a new id, and the stored
 * one is then stale. A stale FALLBACK is harmless in the other direction too —
 * it fails the token exchange deterministically (404, "the installation no
 * longer exists") and is reported, so it can only ever help.
 *
 * SPLIT OUT AND EXPORTED BECAUSE IT IS PURE. Inline in `applyPullRequestEvent`
 * — an async function whose first statement is a database call — this was
 * reachable only by the Postgres-gated suite, and no test in either suite
 * exercised the fallback: deleting it left every suite green.
 *
 * Rows are scanned in the order `linkedProjects` returns them, which is ordered
 * (`order by project_id, path_prefix`), so the chosen id does not depend on
 * whatever order Postgres felt like. Rows with no stored id are skipped rather
 * than ending the scan — a repository linked by two projects where only one has
 * seen an App delivery is ordinary.
 */
export function resolveInstallationId(
  event: Pick<PullRequestEvent, "installationId">,
  rows: readonly Pick<LinkedRepo, "installationId">[],
): string | null {
  return event.installationId ?? rows.find((row) => row.installationId)?.installationId ?? null;
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
 * EXACTLY ONE OUTCOME PER LINKED PROJECT, including the ones that did nothing —
 * so an EMPTY array means no project has linked this repository at all, which is
 * a different thing from "linked, and nothing matched". `route.ts` relies on
 * that to say so in the response body; keep pushing an outcome per project, or a
 * typo'd repo link starts reading as a silent success again.
 *
 * PER PROJECT, NOT PER LINK — a monorepo yields several rows for one project,
 * and one pass per row would be one version bump, one journal batch and one
 * outcome per row for a single pull request. See `groupLinksByProject`.
 */
export async function applyPullRequestEvent(
  event: PullRequestEvent,
  options: { fetchFiles?: FetchChangedFiles } = {},
): Promise<ApplyOutcome[]> {
  const rows = await linkedProjects(event.repoFullName);
  const groups = groupLinksByProject(rows);
  const outcomes: ApplyOutcome[] = [];

  // Derived from the PR TEXT, so it is the same for every linked project —
  // computed once, attached to each outcome. Per-project reports (a platform the
  // acceptance does not list) come out of `planForProject` and are appended.
  const textWarnings = unknownPlatformWarnings(event);
  // Logged as well as returned: a repo with no linked project has no outcome to
  // carry the warning, and a mention nobody ever sees is not a report.
  for (const warning of textWarnings) console.warn(`[github] ${event.repoFullName}#${event.number}: ${warning}`);

  // The payload's id first, so the very first delivery after installing works
  // with nothing stored; the stored one as a fallback for a delivery that
  // carries none. See `resolveInstallationId`.
  const installationId = resolveInstallationId(event, rows);
  if (event.installationId && rows.some((row) => row.installationId !== event.installationId)) {
    // Best effort, and deliberately not awaited into the delivery's success: a
    // failed write here costs a fallback nothing has needed yet, while letting
    // it throw would lose a real transition to a bookkeeping error. The JS-side
    // check keeps the ordinary delivery, where it already matches, from issuing
    // any query at all.
    await recordInstallation(event.repoFullName, event.installationId).catch((err) => {
      console.warn(`[github] could not record installation id: ${err instanceof Error ? err.message : "unknown"}`);
    });
  }

  const scopes = await resolveDeliveryScopes({
    groups,
    event,
    installationId,
    fetchFiles: options.fetchFiles ?? ((pr) => githubApp().listPullRequestFiles(pr)),
  });

  for (const group of groups) {
    // Owner scoping is by the link itself: a repo can only be linked by someone
    // who owns the project, so the webhook acts within that authority.
    const loaded = await getProject(group.projectId, await ownerIdsFor(group.projectId));
    if (!loaded) {
      outcomes.push(
        assembleOutcome({
          projectId: group.projectId,
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
      // Present for every group by construction — `scopes` is built from the
      // same list. The fallback refuses rather than defaulting to a platform,
      // because a missing entry would mean the two lists disagree and guessing
      // then is exactly the direction this file forbids.
      scopes.get(group.projectId) ?? {
        kind: "no-platform",
        reason: "not-consulted",
        detail: "arkaik could not resolve which of its repository links this pull request belongs to",
        prefixes: group.links.map((link) => link.pathPrefix),
      },
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
        assembleOutcome({ projectId: group.projectId, textWarnings, planWarnings, opCount: 0 }),
      );
      continue;
    }

    const result = await applyMutation({
      projectId: group.projectId,
      ownerIds: await ownerIdsFor(group.projectId),
      ops,
      actor: "github-app",
      tier: "klub", // A webhook must not fail on a tier cap it cannot act on.
    });

    outcomes.push(
      assembleOutcome({
        projectId: group.projectId,
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
