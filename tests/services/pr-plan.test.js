#!/usr/bin/env node

/**
 * The pure half of the GitHub PR planner (lib/services/github/pull-request.ts):
 * the mention grammar, ref-id minting, scope precedence, and planForProject.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM github-webhook.test.js: that suite needs
 * a migrated Postgres and exits 1 without one, so it runs only in CI's
 * `services` job. Every planning bug in this area so far surfaced only after a
 * push. Everything asserted here is database-free and runs in the `build` job,
 * on a laptop, in under a second.
 *
 * The failures these assertions are here to prevent, in order of damage:
 *
 *   - a PR naming `AC-x@ios` moving the acceptance's BASE status, which claims
 *     parity on web and android that the product does not have;
 *   - `AC-x@ios` and `AC-x@android` in one PR, where the second platform's
 *     promotion silently erases the first (applyOps replaces metadata wholesale);
 *   - `AC-x@windows` degrading into a bare mention — asking for a platform and
 *     getting the repo default is the silent wrong answer this grammar exists
 *     to remove;
 *   - a ref id being re-minted rather than reused, which emits
 *     ref.removed/ref.added on every redelivery, or colliding with a stored id,
 *     which is a `duplicate-ref-id` validator ERROR that refuses the whole batch
 *     for every acceptance in the PR, forever.
 *
 * mentionedAcceptances returns TWO channels — `{ mentions, unknown }` — so a
 * caller cannot degrade an unknown platform into a bare mention by forgetting
 * to check.
 *
 * Three further classes of failure this suite could not see, and now does:
 *
 *   - a base-status promotion ERASING a parity gap rather than creating one,
 *     which is what happens whenever `platformStatuses` is partial — the
 *     ordinary mid-rollout state. Asserted with the real `hasParityGap`;
 *   - a refusal that refuses ATTACHMENT but not PROMOTION, so the second
 *     delivery of the same PR does the thing the warning beside it denies;
 *   - a per-node lookup that ignores its key. Four of them existed and every
 *     fixture was a one-node bundle, where a dropped key is indistinguishable
 *     from a kept one.
 *
 * Assertion discipline (learned here, the hard way): never assert on counts,
 * never assert a field before asserting the thing carrying it exists, always
 * print the offending value, and a test whose NAME claims a general property
 * must exercise the case that breaks it — two of the bugs above were pinned by
 * fixtures that only ever hit the harmless variant of their own shape.
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadPrPlan, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-pr-plan");

let failures = 0;

/**
 * One assertion. `detail` prints the offending value on failure, and may be
 * either a value or a THUNK — a thunk is evaluated only when the check fails.
 *
 * THE TRY/CATCH IS NOT DEFENSIVE PROGRAMMING, IT IS THE POINT. Several detail
 * expressions here read into the very structure the assertion suspects is wrong
 * (`refsOf(state)` where a regression leaves `refs` undefined). Evaluated
 * eagerly at the call site, one of those throws a TypeError the moment the
 * assertion fails — and the run DIES there, at the first failure, truncating the
 * suite at precisely the most dangerous regression and hiding every check after
 * it. A suite that reports one TypeError instead of the twelve failures it found
 * is worse than no suite: it looks like a broken test rather than a broken
 * planner. So a detail that cannot be produced is reported AS the failure it is.
 *
 * (The eager form is defused as well — see `refsOf` — but this is the backstop
 * for the next one somebody writes.)
 */
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
    return;
  }
  failures++;
  let text = "";
  try {
    const value = typeof detail === "function" ? detail() : detail;
    text = value === undefined || value === "" ? "" : String(value);
  } catch (err) {
    text = `<the detail expression itself threw: ${err && err.message}>`;
  }
  console.log(`FAIL: ${name}${text ? ` — ${text}` : ""}`);
}

const PR_URL = "https://github.com/acme/monorepo/pull/42";

function acceptance(id, platforms, extra = {}) {
  return {
    id,
    project_id: "gp",
    species: "acceptance",
    title: id,
    status: "backlog",
    platforms,
    ...extra,
  };
}

function bundle(nodes, policy) {
  return {
    project: {
      id: "gp",
      title: "T",
      ...(policy === undefined ? {} : { metadata: { ref_policy: policy } }),
    },
    nodes,
    edges: [],
  };
}

function event(overrides = {}) {
  return {
    action: "closed",
    repoFullName: "acme/monorepo",
    number: 42,
    url: PR_URL,
    title: "t",
    body: "",
    merged: true,
    state: "closed",
    ...overrides,
  };
}

function ghRef(overrides = {}) {
  return {
    id: "gh-pr-42",
    type: "github-pr",
    url: PR_URL,
    external_status: "open",
    ...overrides,
  };
}

/**
 * The node a batch of ops leaves behind, merged exactly the way applyOps merges
 * (`{ ...current, ...patch }` — metadata replaced WHOLESALE, see
 * packages/schema/src/mutate.ts).
 *
 * Asserting on the END state is what catches "the second platform overwrote the
 * first": two ops that each look right in isolation can still cancel out, and an
 * assertion on ops[0] alone would never see it.
 */
function settle(node, ops) {
  let out = node;
  for (const op of ops) {
    if (op.op === "update_node" && op.node_id === node.id) out = { ...out, ...op.patch };
  }
  return out;
}

/**
 * A settled node's refs, or an empty list.
 *
 * Written `refsOf(state)` throughout, which reads fine and throws a
 * TypeError the instant a regression stops emitting a metadata patch — inside a
 * `check(...)` argument, so it killed the run rather than failing the check. The
 * failure it hid is exactly the failure worth seeing.
 */
const refsOf = (state) => state.metadata?.refs ?? [];

/** The ref this PR left on a node for a given scope (`null` = unscoped). */
const refFor = (state, platform) =>
  refsOf(state).find((r) => r.url === PR_URL && (r.platform ?? null) === platform);

const mentionFor = (scan, id, platform) =>
  scan.mentions.filter((m) => m.id === id && m.platform === platform);

async function main() {
  const {
    mentionedAcceptances,
    refIdFor,
    prExternalStatus,
    planForProject,
    unknownPlatformWarnings,
    assembleOutcome,
    groupLinksByProject,
    needsChangedFiles,
    resolveRepoScope,
    resolveDeliveryScopes,
    resolveInstallationId,
  } = loadPrPlan();

  /**
   * The repository scope a single whole-repository link resolves to — what
   * every link in the world looked like before path scoping existed.
   *
   * Built by calling the REAL `resolveRepoScope` rather than by writing the
   * object out, so all ~50 slice-1 assertions below become a regression net
   * proving that a `''`-prefix link still resolves exactly as it used to. A
   * hand-written literal here would only prove this file agrees with itself.
   */
  const wholeRepo = (platform = null) =>
    resolveRepoScope([{ platform, pathPrefix: "" }], { kind: "not-needed" });

  /**
   * A path-scoped link set, resolved against a list of changed files.
   *
   * `incomplete` is the list of REASONS the file list came up short (empty is a
   * whole list) — see `IncompleteCause` in lib/services/github/app.ts. It is a
   * list rather than a boolean because three unrelated things produce it and
   * every report has to name the one it observed.
   */
  const pathScope = (links, filePaths, incomplete = []) =>
    resolveRepoScope(links, { kind: "files", paths: filePaths, incomplete });

  /**
   * The REAL parity projections, not a re-implementation.
   *
   * `hasParityGap` and `resolvePlatformStatus` are what `/acceptances` renders,
   * and they are the reason an unscoped promotion is the largest claim this
   * planner can make: the base status is the fallback for every platform with no
   * entry of its own, so moving it can DELETE a parity gap rather than reveal
   * one. Asserting that with a local copy of the rule would only prove this file
   * agrees with itself. `loadPrPlan()` has already built the schema package.
   */
  const { hasParityGap, resolvePlatformStatus, computeRefPromotions } = require(
    path.join(SCHEMA_BUILD_DIR, "index.js"),
  );

  /**
   * planForProject returns TWO channels — `{ ops, warnings }` — for the same
   * reason mentionedAcceptances does: a ref that attaches and promotes nothing
   * must not be reported as plain success. Most assertions below are about the
   * ops, so they go through this; the report has its own section.
   */
  const planOps = (...args) => planForProject(...args).ops;

  // --- The mention grammar --------------------------------------------------
  {
    const scan = mentionedAcceptances({ title: "x", body: "closes AC-guest-checkout" });
    check("the scan has both channels", Array.isArray(scan.mentions) && Array.isArray(scan.unknown), JSON.stringify(scan));
    const m = mentionFor(scan, "AC-guest-checkout", null)[0];
    check("an acceptance id in the body is found, unscoped", m !== undefined, JSON.stringify(scan));
  }
  {
    const scan = mentionedAcceptances({ title: "AC-a11y-labels: fix", body: "" });
    check(
      "an acceptance id in the title is found",
      mentionFor(scan, "AC-a11y-labels", null)[0] !== undefined,
      JSON.stringify(scan),
    );
  }
  {
    const scan = mentionedAcceptances({ title: "t", body: "fixes AC-guest-checkout@ios" });
    const m = mentionFor(scan, "AC-guest-checkout", "ios")[0];
    check("an @platform suffix is parsed", m !== undefined, JSON.stringify(scan));
    check(
      "and the id does NOT swallow the suffix",
      m?.id === "AC-guest-checkout",
      JSON.stringify(scan.mentions),
    );
  }
  for (const platform of ["web", "ios", "android"]) {
    const scan = mentionedAcceptances({ title: "t", body: `AC-x@${platform}` });
    check(
      `@${platform} is a recognised scope`,
      mentionFor(scan, "AC-x", platform)[0] !== undefined,
      JSON.stringify(scan),
    );
  }
  {
    // THE case the one-ref-per-PR model could not express.
    const scan = mentionedAcceptances({ title: "t", body: "AC-x@ios and AC-x@android" });
    check("two platforms for one id are two mentions", mentionFor(scan, "AC-x", "ios")[0] !== undefined && mentionFor(scan, "AC-x", "android")[0] !== undefined, JSON.stringify(scan.mentions));
  }
  {
    const scan = mentionedAcceptances({ title: "t", body: "AC-x and AC-x@ios" });
    check(
      "a bare and a scoped mention of one id are distinct records",
      mentionFor(scan, "AC-x", null)[0] !== undefined && mentionFor(scan, "AC-x", "ios")[0] !== undefined,
      JSON.stringify(scan.mentions),
    );
  }
  {
    const scan = mentionedAcceptances({ title: "AC-x@ios", body: "AC-x@ios again" });
    const same = mentionFor(scan, "AC-x", "ios");
    check("an identical mention is deduped: the first exists", same[0] !== undefined, JSON.stringify(scan));
    check("and there is no second copy", same[1] === undefined, JSON.stringify(same));
  }
  {
    const scan = mentionedAcceptances({ title: "t", body: "ac-guest-checkout@IOS" });
    const m = mentionFor(scan, "AC-guest-checkout", "ios")[0];
    check(
      "the AC- prefix is normalised and the platform suffix is lower-cased",
      m !== undefined,
      JSON.stringify(scan),
    );
    check("@IOS is not reported as unknown", scan.unknown.length === 0, JSON.stringify(scan.unknown));
  }
  {
    // The load-bearing one: an unknown platform is REPORTED, never degraded.
    const scan = mentionedAcceptances({ title: "t", body: "AC-x@windows" });
    check("the scan has both channels", Array.isArray(scan.mentions) && Array.isArray(scan.unknown), JSON.stringify(scan));
    check(
      "an unknown platform is reported, carrying the offending suffix",
      scan.unknown.some((u) => u.id === "AC-x" && u.platform === "windows"),
      JSON.stringify(scan.unknown),
    );
    check(
      "and it does NOT degrade into a bare mention",
      scan.mentions.find((m) => m.id === "AC-x") === undefined,
      JSON.stringify(scan.mentions),
    );
  }
  {
    // `web2` must not capture as `web` with a stray digit left as prose.
    const scan = mentionedAcceptances({ title: "t", body: "AC-x@web2" });
    check(
      "a near-miss platform is unknown, not truncated to a valid one",
      scan.unknown.some((u) => u.id === "AC-x" && u.platform === "web2") &&
        scan.mentions.find((m) => m.id === "AC-x") === undefined,
      JSON.stringify(scan),
    );
  }
  // THE SUFFIX-TRUNCATION BUG CLASS, pinned by the separator rather than one
  // instance at a time. The suffix used to be a character class: `[a-z0-9]+`
  // stopped at the hyphen, so `@android-tv` yielded a confident, silent
  // `android`; widening it to `[a-z0-9-]*` fixed that one and left `@android_tv`
  // doing the same thing. Every row below is a separator that defeated some
  // version of the class, and every one of them is a WRONG platform claim —
  // false parity on /acceptances — which is far worse than a missing one.
  //
  // The property under test is the invariant, not the list: the suffix must
  // equal a platform id exactly (after trailing prose is trimmed) or land in the
  // `unknown` channel WHOLE. A list can only ever be one separator behind; the
  // invariant cannot. The rows are here so a regression names itself.
  for (const [suffix, truncatesTo] of [
    ["android-tv", "android"],
    ["android_tv", "android"],
    ["ios-ipad", "ios"],
    ["web-mobile", "web"],
    ["Android-TV", "android"],
    ["ios.tv", "ios"],
    ["ios/ipad", "ios"],
    ["ios+android", "ios"],
    ["web:mobile", "web"],
    ["ios#2", "ios"],
    ["ios%20", "ios"],
    ["ios~next", "ios"],
    ["ios&android", "ios"],
    ["ios-related", "ios"],
    ["ios2", "ios"],
    ["iosAC-y", "ios"],
    // THE TRAILING HYPHEN, which is the one row that pins TRAILING_PROSE's
    // deliberate omission rather than the suffix class. `-` is excluded from the
    // trim set precisely because it is the separator inside the near-miss names
    // people write (`android-tv`, `ios-ipad`), so trimming it would turn
    // `@android-` back into a confident `android` — and, one step further, would
    // re-truncate `@android-tv` the moment anything trimmed right-to-left past
    // the `tv`. Nothing tested it, so adding `-` to TRAILING_PROSE would have
    // silently resurrected the original truncation bug with the suite green.
    ["android-", "android"],
    ["ios-", "ios"],
    ["web-", "web"],
  ]) {
    const scan = mentionedAcceptances({ title: "t", body: `AC-x@${suffix}` });
    check(
      `@${suffix} is reported as unknown, whole`,
      scan.unknown.some((u) => u.id === "AC-x" && u.platform === suffix),
      JSON.stringify(scan),
    );
    check(
      `and is NOT truncated to @${truncatesTo}`,
      mentionFor(scan, "AC-x", truncatesTo)[0] === undefined,
      JSON.stringify(scan.mentions),
    );
    check(
      `@${suffix} is not degraded to a bare mention either`,
      mentionFor(scan, "AC-x", null)[0] === undefined,
      JSON.stringify(scan.mentions),
    );
  }
  // The other half of the same fix, and the reason the token cannot simply be
  // "everything up to whitespace": people write mentions inside sentences and
  // inside markdown. Every one of these has to still yield `ios`, or the
  // exact-match rule would have traded a wrong claim for a missing one — which
  // is better, but still a feature that does not work.
  //
  // Trimming is safe by construction, which is why the trim set may be wide
  // where the suffix class could not be: no platform id ends in punctuation, so
  // trimming can only ever turn a non-match into a match.
  for (const [body, label] of [
    ["Fixes AC-x@ios.", "a full stop"],
    ["Fixes AC-x@ios, plus more", "a comma"],
    ["Fixes AC-x@ios; then ship", "a semicolon"],
    ["Fixes AC-x@ios: see below", "a colon"],
    ["Fixes AC-x@ios!", "an exclamation mark"],
    ["Fixes AC-x@ios?", "a question mark"],
    ["Fixes (AC-x@ios)", "a closing paren"],
    ["Fixes [AC-x@ios]", "a closing bracket"],
    ["Fixes {AC-x@ios}", "a closing brace"],
    ["Fixes <AC-x@ios>", "a closing angle bracket"],
    ['Fixes "AC-x@ios"', "a double quote"],
    ["Fixes 'AC-x@ios'", "a single quote"],
    ["Fixes `AC-x@ios`", "a backtick"],
    ["Fixes *AC-x@ios*", "markdown emphasis"],
    ["Fixes AC-x@ios_", "a trailing underscore"],
    ["Fixes ~AC-x@ios~", "a tilde"],
    ["Fixes AC-x@ios and more", "a following word"],
    ["Fixes AC-x@ios and...", "an ellipsis further along"],
    ["Fixes AC-x@ios).", "two punctuation marks at once"],
  ]) {
    const scan = mentionedAcceptances({ title: "t", body });
    check(
      `${label} still terminates the suffix`,
      mentionFor(scan, "AC-x", "ios")[0] !== undefined,
      JSON.stringify(scan),
    );
    check(
      `${label}: nothing is reported as unknown`,
      scan.unknown.find((u) => u.id === "AC-x") === undefined,
      JSON.stringify(scan.unknown),
    );
  }
  {
    // The id part is greedy over the same `[a-z0-9-]` class the suffix now uses.
    // If widening the suffix had changed how the id is cut, this is where it
    // would show: the id must still stop dead at the `@`.
    const scan = mentionedAcceptances({ title: "t", body: "AC-guest-checkout-v2@android-tv" });
    check(
      "a hyphenated id keeps its whole id when the suffix is unknown",
      scan.unknown.some((u) => u.id === "AC-guest-checkout-v2" && u.platform === "android-tv"),
      JSON.stringify(scan),
    );
  }
  {
    // The word-boundary guard. `TRAC-457` in a commit trailer and `MAC-address`
    // in prose are ordinary English in a PR body; parsing either as an
    // acceptance would attach a ref to a node that has nothing to do with it.
    const scan = mentionedAcceptances({ title: "TRAC-457: fix MAC-address parsing", body: "see TRAC-457" });
    const parsed = [...scan.mentions, ...scan.unknown];
    check(
      "TRAC-457 does not parse as AC-457",
      parsed.find((m) => m.id === "AC-457") === undefined,
      JSON.stringify(scan),
    );
    check(
      "MAC-address does not parse as AC-address",
      parsed.find((m) => m.id === "AC-address") === undefined,
      JSON.stringify(scan),
    );
    check("and nothing else is picked up either", parsed[0] === undefined, JSON.stringify(scan));
  }
  {
    // UnknownPlatformMention.platform is documented as "the suffix exactly as
    // written, so a report can quote it back" — lowercasing it here would make
    // the delivery response quote something the author never typed.
    const scan = mentionedAcceptances({ title: "t", body: "AC-x@Windows" });
    const u = scan.unknown.find((x) => x.id === "AC-x");
    check("an unknown suffix is reported at all", u !== undefined, JSON.stringify(scan));
    check("carrying the suffix EXACTLY as written, not lowercased", u?.platform === "Windows", JSON.stringify(u));
  }
  {
    // The unknown map is keyed by the LOWERCASED suffix, so `@Windows` and
    // `@windows` are one report rather than two lines saying the same thing.
    const scan = mentionedAcceptances({ title: "t", body: "AC-x@Windows and AC-x@windows" });
    const same = scan.unknown.filter((u) => u.id === "AC-x" && u.platform.toLowerCase() === "windows");
    check("a case-variant repeat is reported once: it exists", same[0] !== undefined, JSON.stringify(scan.unknown));
    check("and there is no second copy", same[1] === undefined, JSON.stringify(same));
  }
  {
    // Two DIFFERENT unknown suffixes are two reports — a map keyed on the id
    // alone would silently drop one, and the author would fix half the PR.
    const scan = mentionedAcceptances({ title: "t", body: "AC-x@windows and AC-x@tvos" });
    check(
      "two different unknown suffixes are both reported: windows",
      scan.unknown.some((u) => u.id === "AC-x" && u.platform === "windows"),
      JSON.stringify(scan.unknown),
    );
    check(
      "…and tvos",
      scan.unknown.some((u) => u.id === "AC-x" && u.platform === "tvos"),
      JSON.stringify(scan.unknown),
    );
  }
  {
    // A KNOWN, DELIBERATE MISS, pinned so it stays deliberate. `_` is a word
    // character, so `_AC-x@ios_` has no word boundary before the id and the
    // mention is not seen at all — underscore-italicising a mention makes it
    // invisible, where asterisks (`*AC-x@ios*`) work fine.
    //
    // It stays that way because the SAME `\b` is what stops `MAC-address`,
    // `TRAC-457` and `MY_AC-123` from parsing as acceptance ids. Relaxing it to
    // admit a leading `_` would attach refs to nodes named in build identifiers.
    // Losing a mention is a MISSING claim; parsing `MY_AC-123` is a wrong one,
    // and wrong is the direction that matters here.
    const scan = mentionedAcceptances({ title: "t", body: "Fixes _AC-x@ios_" });
    check(
      "an underscore-italicised mention is missed, not mis-scoped",
      mentionFor(scan, "AC-x", "ios")[0] === undefined && mentionFor(scan, "AC-x", null)[0] === undefined,
      JSON.stringify(scan),
    );
    check("and nothing is reported as unknown either", scan.unknown[0] === undefined, JSON.stringify(scan.unknown));
    const asterisks = mentionedAcceptances({ title: "t", body: "Fixes *AC-x@ios*" });
    check(
      "while the asterisk form (the one GitHub's toolbar inserts) works",
      mentionFor(asterisks, "AC-x", "ios")[0] !== undefined,
      JSON.stringify(asterisks),
    );
  }
  {
    // The same guard, stated directly: an id glued to a word character on the
    // LEFT is not an acceptance mention.
    const scan = mentionedAcceptances({ title: "t", body: "build MY_AC-123 and xAC-456" });
    const parsed = [...scan.mentions, ...scan.unknown];
    check(
      "an id glued to a word character on the left is not parsed: MY_AC-123",
      parsed.find((m) => m.id === "AC-123") === undefined,
      JSON.stringify(scan),
    );
    check(
      "…nor xAC-456",
      parsed.find((m) => m.id === "AC-456") === undefined,
      JSON.stringify(scan),
    );
  }
  for (const written of ["IOS", "Ios", "iOS", "iOs"]) {
    // A closed lowercase enum carries no case information to lose, so case is
    // the ONE normalisation that cannot invent a claim the author did not make.
    // `@iOS` is simply how people write it.
    const scan = mentionedAcceptances({ title: "t", body: `AC-x@${written}` });
    check(
      `@${written} resolves to ios`,
      mentionFor(scan, "AC-x", "ios")[0] !== undefined,
      JSON.stringify(scan),
    );
    check(`@${written} is not reported as unknown`, scan.unknown[0] === undefined, JSON.stringify(scan.unknown));
  }
  {
    // `\@` is how people stop GitHub rendering `@ios` as a user mention. It used
    // to parse as a BARE mention — the author asked for one platform and the
    // delivery moved the BASE status, marking every platform shipped. That is
    // the exact over-claim the suffix exists to prevent, reached by escaping it.
    const scan = mentionedAcceptances({ title: "t", body: "Fixes AC-x\\@ios" });
    check("an escaped \\@ still scopes to the platform", mentionFor(scan, "AC-x", "ios")[0] !== undefined, JSON.stringify(scan));
    check(
      "and does NOT degrade into a bare mention",
      mentionFor(scan, "AC-x", null)[0] === undefined,
      JSON.stringify(scan.mentions),
    );
    check("nor into an unknown suffix", scan.unknown[0] === undefined, JSON.stringify(scan.unknown));
  }
  {
    const scan = mentionedAcceptances({ title: "t", body: "AC-x@" });
    check(
      "a dangling @ leaves a bare mention (the optional group simply does not match)",
      mentionFor(scan, "AC-x", null)[0] !== undefined && scan.unknown.length === 0,
      JSON.stringify(scan),
    );
  }
  {
    // The same, but with the platform pushed away by a space: nothing non-blank
    // follows the `@`, so there is no suffix to read. `ios` is prose.
    const scan = mentionedAcceptances({ title: "t", body: "AC-x@ ios" });
    check(
      "a space after the @ leaves a bare mention",
      mentionFor(scan, "AC-x", null)[0] !== undefined,
      JSON.stringify(scan),
    );
    check("and nothing is reported as unknown", scan.unknown[0] === undefined, JSON.stringify(scan.unknown));
  }
  {
    // A suffix that is ENTIRELY punctuation trims away to nothing. That is an
    // unusable scope request, not the absence of one: the author typed an `@`,
    // and reading it as a bare mention would move the base status — the silent
    // over-claim again, reached by a typo this time.
    const scan = mentionedAcceptances({ title: "t", body: "AC-x@." });
    const u = scan.unknown.find((x) => x.id === "AC-x");
    check("a suffix that is only punctuation is unknown", u !== undefined, JSON.stringify(scan));
    check(
      "and is NOT read as a bare mention",
      mentionFor(scan, "AC-x", null)[0] === undefined,
      JSON.stringify(scan.mentions),
    );
    // Trimming leaves nothing, so the code falls back to quoting the suffix RAW
    // (`platform: token || written`) — the author has to be able to see WHICH
    // character broke it. An empty string here would render as `AC-x@: "" is not
    // a platform`, which names nothing and reads like a bug in arkaik.
    check(
      "and the report quotes the raw suffix rather than the empty trimmed one",
      u?.platform === ".",
      JSON.stringify(u),
    );
  }
  {
    // Two mentions glued by punctuation with no space. A token defined purely as
    // "up to whitespace" would swallow `,AC-b@web` into AC-a's suffix and lose
    // AC-b entirely — safe (it is a MISSING claim, not a wrong one), but the
    // feature would silently half-work.
    const scan = mentionedAcceptances({ title: "t", body: "Fixes AC-a@ios,AC-b@web" });
    check("the first of two glued mentions parses", mentionFor(scan, "AC-a", "ios")[0] !== undefined, JSON.stringify(scan));
    check("and so does the second", mentionFor(scan, "AC-b", "web")[0] !== undefined, JSON.stringify(scan));
    check("with nothing reported as unknown", scan.unknown[0] === undefined, JSON.stringify(scan.unknown));
  }
  {
    // A PR body is attacker-influenced input: anyone can open a PR from a fork,
    // and the grammar runs on the title and body before anything else. Both the
    // regex and the punctuation trimming must be LINEAR — the trimming is a loop
    // rather than `/[…]+$/` precisely because that regex is quadratic on a long
    // run of trimmable characters followed by one that is not.
    const hostile =
      `AC-x@${"ios-".repeat(20000)} ` + // a huge unknown suffix
      `AC-y@${")".repeat(40000)}a ` + // the quadratic-trim shape
      `AC-z@${"ios,AC-q@".repeat(5000)} ` + // repeated boundary lookaheads
      "AC-w@ios";
    const started = process.hrtime.bigint();
    const scan = mentionedAcceptances({ title: "t", body: hostile });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`      (adversarial body: ${hostile.length} chars parsed in ${ms.toFixed(1)}ms)`);
    // Assert it did the WORK before asserting it was fast: a grammar that
    // matched nothing would be instantaneous and prove nothing at all.
    check(
      "the adversarial body still parses its last, valid mention",
      mentionFor(scan, "AC-w", "ios")[0] !== undefined,
      JSON.stringify(scan.mentions),
    );
    check(
      "and reports the hostile suffixes rather than truncating them",
      scan.unknown.some((u) => u.id === "AC-x" && u.platform.startsWith("ios-ios-")),
      JSON.stringify(scan.unknown.map((u) => `${u.id}@${u.platform.slice(0, 12)}…`)),
    );
    check(
      `${hostile.length} chars parse in linear time, not exponentially (${ms.toFixed(1)}ms)`,
      ms < 2000,
      `${ms.toFixed(1)}ms`,
    );
  }
  {
    const scan = mentionedAcceptances({ title: "t", body: "Implements AC-guest-checkout@ios. (AC-y@web)" });
    check(
      "trailing punctuation is not swallowed by the suffix",
      mentionFor(scan, "AC-guest-checkout", "ios")[0] !== undefined,
      JSON.stringify(scan.mentions),
    );
    check(
      "and a parenthesised mention still parses",
      mentionFor(scan, "AC-y", "web")[0] !== undefined,
      JSON.stringify(scan.mentions),
    );
  }
  {
    const scan = mentionedAcceptances({ title: "chore: bump deps", body: "no ids here" });
    check("the scan has both channels", Array.isArray(scan.mentions) && Array.isArray(scan.unknown));
    check(
      "unrelated text yields nothing",
      scan.mentions.find((m) => m.id === "AC-x") === undefined && scan.unknown.length === 0,
      JSON.stringify(scan),
    );
  }

  // --- Ref ids --------------------------------------------------------------
  check("an unscoped ref id is unchanged (the compatibility anchor)", refIdFor(42, null) === "gh-pr-42", refIdFor(42, null));
  check("a scoped ref id names the platform", refIdFor(42, "ios") === "gh-pr-42-ios", refIdFor(42, "ios"));
  check("scoped ids stay kebab-case (no @)", !refIdFor(42, "ios").includes("@"), refIdFor(42, "ios"));
  check(
    "the platform actually participates in the id",
    refIdFor(42, "web") !== refIdFor(42, "ios"),
    `${refIdFor(42, "web")} / ${refIdFor(42, "ios")}`,
  );

  // --- External status (moved off the Postgres-gated suite) -----------------
  check("merged wins over state", prExternalStatus({ merged: true, state: "closed" }) === "merged");
  check("closed without merge is closed", prExternalStatus({ merged: false, state: "closed" }) === "closed");
  check("otherwise open", prExternalStatus({ merged: false, state: "open" }) === "open");

  // --- Precedence: an explicit mention beats the repo link ------------------
  {
    const node = acceptance("AC-x", ["web", "ios", "android"]);
    const ops = planOps(bundle([node], true), event({ body: "AC-x@android" }), wholeRepo("ios"));
    const state = settle(node, ops);
    check("an explicit mention wins over the link platform", refFor(state, "android") !== undefined, JSON.stringify(state.metadata));
    check(
      "and the link platform does NOT also fire",
      refFor(state, "ios") === undefined,
      JSON.stringify(state.metadata?.refs),
    );
    check(
      "so only the mentioned platform is promoted",
      state.metadata?.platformStatuses?.android === "live" &&
        state.metadata?.platformStatuses?.ios === undefined,
      JSON.stringify(state.metadata?.platformStatuses),
    );
  }
  {
    const node = acceptance("AC-x", ["web", "ios"]);
    const ops = planOps(bundle([node], true), event({ body: "AC-x" }), wholeRepo("ios"));
    const state = settle(node, ops);
    const ref = refFor(state, "ios");
    check("a bare mention inherits the link's platform", ref !== undefined, JSON.stringify(state.metadata));
    check("and mints the scoped id", ref?.id === "gh-pr-42-ios", JSON.stringify(ref));
    check("mirroring the PR state", ref?.external_status === "merged", JSON.stringify(ref));
    check(
      "promoting that platform only",
      state.metadata?.platformStatuses?.ios === "live" && state.metadata?.platformStatuses?.web === undefined,
      JSON.stringify(state.metadata?.platformStatuses),
    );
  }
  {
    const node = acceptance("AC-x", ["web", "ios"]);
    const ops = planOps(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    const state = settle(node, ops);
    check("an explicit mention scopes even an unscoped link", refFor(state, "ios") !== undefined, JSON.stringify(state.metadata));
  }
  {
    const node = acceptance("AC-x", ["web", "ios"]);
    const ops = planOps(bundle([node], true), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, ops);
    const ref = refFor(state, null);
    check("a bare mention in an unscoped repo stays unscoped", ref !== undefined, JSON.stringify(state.metadata));
    check("keeping the legacy id shape", ref?.id === "gh-pr-42", JSON.stringify(ref));
    check(
      "with no platform key at all (an explicit undefined would round-trip into the bundle)",
      ref !== undefined && !("platform" in ref),
      JSON.stringify(ref),
    );
    check("and moving the base status", state.status === "live", JSON.stringify(state.status));
  }
  {
    // THE LEGACY-POLICY CONTRACT (schema_version 3). A hand-written ref_policy
    // may still speak the pre-v3 vocabulary — `computeRefPromotions` honours
    // "prioritized" at its current-status meaning (packages/schema/src/promote.ts),
    // so the node is written "backlog"; the dead id itself must never land in a
    // status position. An unknown target, by contrast, is a policy typo:
    // skipped, never guessed at.
    const node = acceptance("AC-x", ["web"], { status: "development" });
    const legacyPolicy = { "github-pr": { open: null, merged: "prioritized", closed: null } };
    const ops = planOps(bundle([node], legacyPolicy), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, ops);
    check(
      "a policy target in the legacy vocabulary is normalized before it is written",
      state.status === "backlog",
      JSON.stringify(state.status),
    );
    check(
      "and the dead id never lands in a status position",
      state.status !== "prioritized",
      JSON.stringify(state.status),
    );

    const typoPolicy = { "github-pr": { open: null, merged: "shipped", closed: null } };
    const typoOps = planOps(bundle([node], typoPolicy), event({ body: "AC-x" }), wholeRepo());
    const typoState = settle(node, typoOps);
    check(
      "an unknown policy target moves nothing — a typo is skipped, never guessed at",
      typoState.status === "development",
      JSON.stringify(typoState.status),
    );
    check("…while the ref still attaches", refFor(typoState, null) !== undefined, JSON.stringify(typoState.metadata));
  }
  {
    // An explicit scope ABSORBS the bare mention of the same id — otherwise the
    // unscoped ref beside it would promote the base status on this very
    // delivery and claim parity everywhere.
    const node = acceptance("AC-x", ["web", "ios"]);
    const ops = planOps(bundle([node], true), event({ title: "AC-x: guest checkout", body: "fixes AC-x@ios" }), wholeRepo());
    const state = settle(node, ops);
    check("the explicit scope is written", refFor(state, "ios") !== undefined, JSON.stringify(state.metadata));
    check(
      "and the bare mention does NOT add an unscoped ref beside it",
      refFor(state, null) === undefined,
      JSON.stringify(state.metadata?.refs),
    );
    check(
      "so the base status is untouched",
      state.status === "backlog",
      JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
  }

  // --- One ref per (PR, platform) ------------------------------------------
  {
    // THE headline case. Fails three ways against the old model: one minted id,
    // id-or-url matching, and the single-refId promotion filter.
    const node = acceptance("AC-x", ["web", "ios", "android"]);
    const ops = planOps(bundle([node], true), event({ body: "AC-x@ios and AC-x@android" }), wholeRepo());
    const state = settle(node, ops);
    const ios = refFor(state, "ios");
    const android = refFor(state, "android");
    check("one PR mints a ref for each named platform: ios", ios !== undefined, JSON.stringify(state.metadata));
    check("…and android", android !== undefined, JSON.stringify(state.metadata));
    check("with per-platform ids", ios?.id === "gh-pr-42-ios" && android?.id === "gh-pr-42-android", JSON.stringify([ios?.id, android?.id]));
    check(
      "both mirroring the same PR",
      ios?.url === PR_URL && android?.url === PR_URL && ios?.external_status === "merged" && android?.external_status === "merged",
      JSON.stringify([ios, android]),
    );
    check(
      "BOTH promotions survive the batch (the second must not erase the first)",
      state.metadata?.platformStatuses?.ios === "live" && state.metadata?.platformStatuses?.android === "live",
      JSON.stringify(state.metadata?.platformStatuses),
    );
    check(
      "and the platform nobody mentioned is left alone",
      state.metadata?.platformStatuses?.web === undefined,
      JSON.stringify(state.metadata?.platformStatuses),
    );
    check("no two refs share an id", new Set(refsOf(state).map((r) => r.id)).size === refsOf(state).length, JSON.stringify(refsOf(state).map((r) => r.id)));
  }

  {
    // Bundles are JSON on disk and diff in git, so the ref array's order must
    // not depend on which suffix the author happened to type first — otherwise
    // re-saving the same PR from a reworded body produces a spurious diff and,
    // worse, a `ref.removed`/`ref.added` churn in the journal.
    //
    // `resolveRefScopes` sorts for exactly this reason and nothing asserted it:
    // replacing that `.sort()` with `.reverse()` kept the whole suite green.
    const node = acceptance("AC-x", ["web", "ios", "android"]);
    const scopeOrder = (body) => {
      const state = settle(node, planOps(bundle([node], true), event({ body }), wholeRepo()));
      return refsOf(state).filter((r) => r.url === PR_URL).map((r) => r.platform ?? null);
    };
    const androidFirst = scopeOrder("AC-x@android and AC-x@ios");
    const iosFirst = scopeOrder("AC-x@ios and AC-x@android");
    // Assert BOTH scopes were actually written before comparing the orders: two
    // empty lists are equal, and would "prove" determinism by planning nothing.
    check(
      "both orderings write both scopes: android-first",
      androidFirst.includes("ios") && androidFirst.includes("android"),
      JSON.stringify(androidFirst),
    );
    check(
      "…and ios-first",
      iosFirst.includes("ios") && iosFirst.includes("android"),
      JSON.stringify(iosFirst),
    );
    check(
      "and the ref order does not depend on PR-body word order",
      JSON.stringify(androidFirst) === JSON.stringify(iosFirst),
      `${JSON.stringify(androidFirst)} vs ${JSON.stringify(iosFirst)}`,
    );
  }

  {
    // ITEM 7(a) — A NEWLY MINTED REF'S `title` AND `synced_at`.
    //
    // The REFRESH path grew assertions for both of these; the CREATE path never
    // had them, which is the wrong way round — every ref starts here. A mint
    // that forgot `title` leaves the ref badge blank or falls back to the url;
    // one that forgot `synced_at` leaves the mirror with no idea how fresh it
    // is, and `arkaik sync` sorts on it. Both are silent: the status still
    // moves, so every other assertion in this file stays green.
    const node = acceptance("AC-x", ["web", "ios"]);
    const before = new Date().toISOString();
    const ops = planOps(
      bundle([node], true),
      event({ body: "AC-x@ios", title: "Guest checkout, at last" }),
      wholeRepo(),
    );
    const state = settle(node, ops);
    const ref = refFor(state, "ios");
    check("a minted ref exists", ref !== undefined, () => JSON.stringify(refsOf(state)));
    check(
      "carrying the PR title it was minted from",
      ref?.title === "Guest checkout, at last",
      () => JSON.stringify(ref),
    );
    check(
      "and a synced_at stamped at mint time, not left undefined",
      typeof ref?.synced_at === "string" && ref.synced_at >= before,
      () => JSON.stringify({ synced_at: ref?.synced_at, before }),
    );
    check("and the url and type that make it this PR's", ref?.url === PR_URL && ref?.type === "github-pr", () =>
      JSON.stringify(ref),
    );
  }
  {
    // ITEM 7(b) — A HAND-WRITTEN REF OF ANOTHER TYPE AT THE SAME URL.
    //
    // The refresh path used to rewrite `type` to "github-pr" for every ref
    // matching the url. That silently ADOPTED a `{ type: "url" }` ref someone
    // pasted in by hand — and adoption is not cosmetic: `computeRefPromotions`
    // selects the policy by `ref.type` (packages/schema/src/promote.ts), so the
    // rewrite enrolled that ref in promotion. Carrying no platform, it enrolled
    // as an UNSCOPED one, which moves the base status — the largest claim in the
    // system, made out of data written to be a link.
    //
    // DECIDED: NOT INTENDED. The mirror now matches on (url AND type), so a ref
    // of another type is left completely alone. The alternative — pinning the
    // adoption as deliberate — fails the governing rule of this file, because it
    // manufactures a status claim nobody made, from a ref the author never
    // opted into promotion. And the restriction has to cover the whole loop, not
    // just the refresh: the reconciliation filter would then match on url
    // alone, so a refresh-only restriction would have left it free to DELETE
    // the ref it declines to adopt, which is a worse outcome than adopting it.
    const hand = { id: "hand-1", type: "url", url: PR_URL, title: "the PR", external_status: "merged" };
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [hand] } });

    // NON-VACUITY: the SAME ref typed `github-pr` promotes. So if the rewrite
    // came back, the assertions below would fail rather than pass by inertia.
    const adopted = {
      ...node,
      metadata: { refs: [{ ...hand, type: "github-pr" }] },
    };
    check(
      "precondition: typed github-pr, that very ref moves the BASE status",
      computeRefPromotions(bundle([adopted], true)).promotions.some(
        (p) => p.node_id === "AC-x" && p.ref_id === "hand-1" && p.platform === undefined && p.to === "live",
      ),
      () => JSON.stringify(computeRefPromotions(bundle([adopted], true)).promotions),
    );

    // With no mention, a url-typed ref does not even put the node in scope.
    const quiet = planForProject(bundle([node], true), event({ body: "no ids here" }), wholeRepo());
    check(
      "a ref of another type does not make the node this mirror's business",
      quiet.ops.find((o) => o.node_id === "AC-x") === undefined,
      () => JSON.stringify(quiet.ops),
    );

    // With a mention, the delivery does its own work beside it.
    const plan = planForProject(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    const state = settle(node, plan.ops);
    const kept = refsOf(state).find((r) => r.id === "hand-1");
    check("the hand-written ref survives", kept !== undefined, () => JSON.stringify(refsOf(state)));
    check("keeping its own type", kept?.type === "url", () => JSON.stringify(kept));
    check(
      "and its own title, un-mirrored",
      kept?.title === "the PR",
      () => JSON.stringify(kept),
    );
    check(
      "the delivery mints its OWN github-pr ref beside it",
      refFor(state, "ios")?.type === "github-pr" && refFor(state, "ios")?.id === "gh-pr-42-ios",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "and promotes only the platform it was asked for — the base status stays put",
      state.status === "backlog" && state.metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
  }

  // --- Several acceptances in one PR ---------------------------------------
  // Every case above this line uses a ONE-NODE bundle, which cannot see a scope
  // leaking from one acceptance to another: `explicitPlatforms`, `touched`,
  // `byNode` and `withPatches` are all keyed by node id, and a bug that ignored
  // the key would look identical to correct behaviour with a single node.
  // Cross-contamination here is the parity lie in its worst form — an acceptance
  // marked shipped on a platform no PR ever claimed for it.
  {
    const a = acceptance("AC-a", ["web", "ios"]);
    const b = acceptance("AC-b", ["web", "ios"]);
    const ops = planOps(bundle([a, b], true), event({ body: "AC-a@ios and AC-b@web" }), wholeRepo());
    const stateA = settle(a, ops);
    const stateB = settle(b, ops);

    check("AC-a got its own ios ref", refFor(stateA, "ios") !== undefined, JSON.stringify(stateA.metadata));
    check("AC-b got its own web ref", refFor(stateB, "web") !== undefined, JSON.stringify(stateB.metadata));
    check(
      "AC-a did NOT pick up AC-b's web scope",
      refFor(stateA, "web") === undefined && refFor(stateA, null) === undefined,
      JSON.stringify(stateA.metadata?.refs),
    );
    check(
      "AC-b did NOT pick up AC-a's ios scope",
      refFor(stateB, "ios") === undefined && refFor(stateB, null) === undefined,
      JSON.stringify(stateB.metadata?.refs),
    );
    check(
      "AC-a is promoted on ios only",
      stateA.metadata?.platformStatuses?.ios === "live" &&
        stateA.metadata?.platformStatuses?.web === undefined,
      JSON.stringify(stateA.metadata?.platformStatuses),
    );
    check(
      "AC-b is promoted on web only",
      stateB.metadata?.platformStatuses?.web === "live" &&
        stateB.metadata?.platformStatuses?.ios === undefined,
      JSON.stringify(stateB.metadata?.platformStatuses),
    );
    check(
      "and neither base status moves",
      stateA.status === "backlog" && stateB.status === "backlog",
      JSON.stringify([stateA.status, stateB.status]),
    );
  }
  {
    // The same separation when one node is only in scope through the LINK: a
    // bare `AC-b` must take the link's platform without inheriting the explicit
    // `@ios` its neighbour asked for.
    const a = acceptance("AC-a", ["web", "ios"]);
    const b = acceptance("AC-b", ["web", "ios"]);
    const ops = planOps(bundle([a, b], true), event({ body: "AC-a@ios and AC-b" }), wholeRepo("web"));
    const stateA = settle(a, ops);
    const stateB = settle(b, ops);
    check("the explicit scope lands on AC-a", refFor(stateA, "ios") !== undefined, JSON.stringify(stateA.metadata));
    check("the link scope lands on AC-b", refFor(stateB, "web") !== undefined, JSON.stringify(stateB.metadata));
    check(
      "AC-b is not scoped to ios by its neighbour's mention",
      refFor(stateB, "ios") === undefined,
      JSON.stringify(stateB.metadata?.refs),
    );
    check(
      "and the promotions stay on their own node",
      stateA.metadata?.platformStatuses?.ios === "live" &&
        stateA.metadata?.platformStatuses?.web === undefined &&
        stateB.metadata?.platformStatuses?.web === "live" &&
        stateB.metadata?.platformStatuses?.ios === undefined,
      JSON.stringify([stateA.metadata?.platformStatuses, stateB.metadata?.platformStatuses]),
    );
  }

  // --- The per-node lookups, each with a NEIGHBOUR to cross to ---------------
  // Four separate lookups key on a node id — the promotion `touched` filter, the
  // over-claim warning's node probe, the unknown-suffix set, and the skip
  // report's `node_id` half — and every one of them had only ever been exercised
  // with a SINGLE-NODE bundle. A version that dropped the key entirely would
  // behave identically on one node and pass the whole suite. Each block below
  // gives the lookup somewhere wrong to land, and asserts BOTH halves: that the
  // intended node really was affected (or the isolation proves nothing) and that
  // the other one was not.
  {
    // (a) THE PROMOTION `touched` FILTER. AC-a carries a stale ref from a
    // DIFFERENT repository's PR #42 — so its id is `gh-pr-42-ios`, character for
    // character the id this delivery mints on AC-b. Two repos on one project is
    // the ordinary arrangement, and PR numbers are per-repo, so this collision
    // is routine rather than contrived.
    //
    // A `touched` kept as a flat `Set<refId>` — which is what it was before the
    // one-ref-per-(PR, platform) model — would match AC-a's stale ref by id and
    // promote it: an acceptance moved by a pull request in a repository that
    // never mentioned it.
    const OTHER_URL = "https://github.com/acme/ios-app/pull/42";
    const stale = ghRef({ id: "gh-pr-42-ios", url: OTHER_URL, platform: "ios", external_status: "open" });
    const a = acceptance("AC-a", ["web", "ios"], { metadata: { refs: [stale] } });
    const b = acceptance("AC-b", ["web", "ios"]);
    // NON-VACUITY: the stale ref is genuinely promotable on its own. If it were
    // not, "AC-a did not move" would be true for the wrong reason.
    check(
      "precondition: AC-a's stale ref WOULD promote if anything let it",
      computeRefPromotions(bundle([a, b], true)).promotions.some(
        (p) => p.node_id === "AC-a" && p.ref_id === "gh-pr-42-ios" && p.platform === "ios",
      ),
      () => JSON.stringify(computeRefPromotions(bundle([a, b], true)).promotions),
    );
    const plan = planForProject(bundle([a, b], true), event({ body: "AC-b@ios" }), wholeRepo());
    const stateA = settle(a, plan.ops);
    const stateB = settle(b, plan.ops);
    check(
      "precondition: this delivery mints the colliding id on AC-b",
      refFor(stateB, "ios")?.id === "gh-pr-42-ios",
      () => JSON.stringify(refsOf(stateB)),
    );
    check(
      "AC-b, which the PR named, is promoted",
      stateB.metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify(stateB.metadata?.platformStatuses),
    );
    check(
      "and AC-a, whose ref belongs to another repository's PR, is NOT",
      stateA.metadata?.platformStatuses === undefined && stateA.status === "backlog",
      () => JSON.stringify({ status: stateA.status, platformStatuses: stateA.metadata?.platformStatuses }),
    );
    check(
      "AC-a earns no op at all, so it cannot inflate `applied` either",
      plan.ops.find((o) => o.node_id === "AC-a") === undefined,
      () => JSON.stringify(plan.ops),
    );
    check(
      "and its stale ref is left exactly as it was, not re-mirrored",
      refsOf(stateA).find((r) => r.id === "gh-pr-42-ios")?.external_status === "open",
      () => JSON.stringify(refsOf(stateA)),
    );
  }
  {
    // (b) THE OVER-CLAIM WARNING'S PER-NODE PROBE
    // (`withPatches.find(n => n.id === promotion.node_id)`). The two nodes list
    // DIFFERENT platforms on purpose: if the probe landed on the wrong node the
    // line would still look plausible — it would simply name the wrong set — and
    // a report that names the wrong platforms is worse than no report, because
    // it will be believed.
    const a = acceptance("AC-a", ["web", "ios"]);
    const b = acceptance("AC-b", ["web", "ios", "android"]);
    const plan = planForProject(bundle([a, b], true), event({ body: "AC-a@ios and AC-b" }), wholeRepo());
    const stateA = settle(a, plan.ops);
    const stateB = settle(b, plan.ops);
    check(
      "precondition: AC-b's base status really moved (the warning is about that)",
      stateB.status === "live",
      () => JSON.stringify(stateB.status),
    );
    check(
      "precondition: AC-a was scoped instead, so its base did not move",
      stateA.status === "backlog" && stateA.metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify({ status: stateA.status, platformStatuses: stateA.metadata?.platformStatuses }),
    );
    const lineB = plan.warnings.find((w) => w.startsWith("AC-b:"));
    check("the over-claim line is attributed to AC-b", lineB !== undefined, () => JSON.stringify(plan.warnings));
    check(
      "and names AC-b's OWN platforms, including the one AC-a does not list",
      lineB !== undefined && ["web", "ios", "android"].every((p) => lineB.includes(p)),
      () => JSON.stringify(lineB),
    );
    check(
      "while no line is attributed to AC-a, which claimed exactly what it asked for",
      plan.warnings.find((w) => w.startsWith("AC-a:")) === undefined,
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // (c) THE UNKNOWN-SUFFIX REFUSAL IS PER NODE. One mistyped suffix must not
    // disable the rest of the pull request: a check written as
    // `unknown.length > 0` rather than `unknownNodes.has(node.id)` would refuse
    // every acceptance the PR named, and the author would fix the typo to
    // discover a second acceptance had silently gone missing for a release.
    const a = acceptance("AC-a", ["web", "ios", "android"]);
    const b = acceptance("AC-b", ["web", "ios"]);
    const plan = planForProject(
      bundle([a, b], true),
      event({ title: "AC-a: Apple Pay", body: "Fixes AC-a@ios-tablet and AC-b" }),
      wholeRepo(),
    );
    const stateA = settle(a, plan.ops);
    const stateB = settle(b, plan.ops);
    const scan = mentionedAcceptances({ title: "AC-a: Apple Pay", body: "Fixes AC-a@ios-tablet and AC-b" });
    check(
      "precondition: AC-a's typo is in the unknown channel, with a bare mention beside it",
      scan.unknown.some((u) => u.id === "AC-a" && u.platform === "ios-tablet") &&
        mentionFor(scan, "AC-a", null)[0] !== undefined,
      () => JSON.stringify(scan),
    );
    check(
      "precondition: and AC-b is an ordinary bare mention",
      mentionFor(scan, "AC-b", null)[0] !== undefined,
      () => JSON.stringify(scan.mentions),
    );
    check(
      "AC-a is refused: no ref, no status",
      refsOf(stateA).find((r) => r.url === PR_URL) === undefined &&
        stateA.status === "backlog" &&
        stateA.metadata?.platformStatuses === undefined,
      () => JSON.stringify({ refs: refsOf(stateA), status: stateA.status }),
    );
    check(
      "and reported by name",
      plan.warnings.find((w) => w.startsWith("AC-a:") && w.includes("fallback")) !== undefined,
      () => JSON.stringify(plan.warnings),
    );
    check(
      "while AC-b is still planned — one typo does not disable the whole PR",
      refFor(stateB, null) !== undefined,
      () => JSON.stringify(refsOf(stateB)),
    );
    check(
      "and still promoted",
      stateB.status === "live",
      () => JSON.stringify(stateB.status),
    );
    check(
      "with no refusal line attributed to AC-b",
      plan.warnings.find((w) => w.startsWith("AC-b:") && w.includes("fallback")) === undefined,
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // (d) THE SKIP REPORT'S `node_id` HALF. The report is filtered by
    // `touched.get(skip.node_id)?.has(skip.ref_id)`. Drop the `node_id` half —
    // ask only whether ANY touched set holds that ref id — and a stale,
    // inapplicable ref sitting on an unrelated acceptance gets reported as this
    // delivery's news, forever, on every redelivery.
    //
    // The collision is the same routine one as (a): AC-a's stale ref comes from
    // another repository's PR #42 and is therefore called `gh-pr-42-ios`, which
    // is exactly what this delivery mints on AC-b.
    const OTHER_URL = "https://github.com/acme/ios-app/pull/42";
    const stale = ghRef({ id: "gh-pr-42-ios", url: OTHER_URL, platform: "ios", external_status: "merged" });
    const a = acceptance("AC-a", ["web"], { metadata: { refs: [stale] } });
    const b = acceptance("AC-b", ["web", "ios"]);
    check(
      "precondition: AC-a's stale ref IS a platform-not-applicable skip, ready to be misattributed",
      computeRefPromotions(bundle([a, b], true)).skipped.some(
        (s) => s.node_id === "AC-a" && s.ref_id === "gh-pr-42-ios" && s.reason === "platform-not-applicable",
      ),
      () => JSON.stringify(computeRefPromotions(bundle([a, b], true)).skipped),
    );
    const plan = planForProject(bundle([a, b], true), event({ body: "AC-b@ios" }), wholeRepo());
    const stateB = settle(b, plan.ops);
    check(
      "precondition: this delivery mints the colliding id on AC-b",
      refFor(stateB, "ios")?.id === "gh-pr-42-ios",
      () => JSON.stringify(refsOf(stateB)),
    );
    check(
      "AC-b is planned and promoted, so the delivery did real work",
      stateB.metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify(stateB.metadata?.platformStatuses),
    );
    check(
      "and nothing is reported about AC-a, whose ref this delivery never touched",
      plan.warnings.find((w) => w.startsWith("AC-a")) === undefined,
      () => JSON.stringify(plan.warnings),
    );
  }

  {
    // Opt-in is the format's default: refs are mirrored, nothing moves.
    const node = acceptance("AC-x", ["web", "ios", "android"]);
    const ops = planOps(bundle([node]), event({ body: "AC-x@ios and AC-x@android" }), wholeRepo());
    const state = settle(node, ops);
    check("without ref_policy the refs still attach", refFor(state, "ios") !== undefined && refFor(state, "android") !== undefined, JSON.stringify(state.metadata));
    check("but the base status does not move", state.status === "backlog", JSON.stringify(state.status));
    check(
      "and no platformStatuses are invented",
      state.metadata?.platformStatuses === undefined,
      JSON.stringify(state.metadata?.platformStatuses),
    );
  }

  // --- Backwards compatibility: ids are minted only on create ---------------
  {
    // A ref written by the previous version: scoped id-less, `gh-pr-42` with a
    // platform. Rewriting it would emit ref.removed + ref.added on every
    // redelivery forever.
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [ghRef({ platform: "ios" })] } });
    const before = new Date().toISOString();
    const ops = planOps(bundle([node], true), event({ body: "AC-x", title: "Guest checkout, at last" }), wholeRepo("ios"));
    const state = settle(node, ops);
    const ref = refFor(state, "ios");
    check("a legacy scoped ref is matched", ref !== undefined, JSON.stringify(state.metadata));
    check("and keeps its stored id verbatim", ref?.id === "gh-pr-42", JSON.stringify(ref));
    check(
      "no freshly-minted duplicate is added beside it",
      refsOf(state).find((r) => r.id === "gh-pr-42-ios") === undefined,
      JSON.stringify(refsOf(state)),
    );
    check("it is still being mirrored", ref?.external_status === "merged", JSON.stringify(ref));
    // The refresh path rewrites `title` and `synced_at` too, and neither was
    // pinned anywhere. A regression that dropped them from the mapped ref would
    // freeze a ref badge at whatever the PR was first called — "WIP: …" forever,
    // on a PR that shipped — and freeze `synced_at` at a date that then lies
    // about how fresh the mirror is. Both are silent: the status still moves, so
    // every other assertion here would stay green.
    check(
      "the refresh mirrors the CURRENT PR title, not the one stored earlier",
      ref?.title === "Guest checkout, at last",
      JSON.stringify(ref),
    );
    check(
      "and stamps synced_at at refresh time",
      typeof ref?.synced_at === "string" && ref.synced_at >= before,
      JSON.stringify({ synced_at: ref?.synced_at, before }),
    );
    check(
      "and its promotion is still applied (the filter must not compare to a minted id)",
      state.metadata?.platformStatuses?.ios === "live",
      JSON.stringify(state.metadata?.platformStatuses),
    );
  }
  {
    // Redelivery: GitHub retries, and the ledger is released on failure, so the
    // second run over the settled node must add nothing.
    //
    // EVERY ASSERTION HERE IS OVER `.every(...)` OR AN EQUALITY OF TWO DERIVED
    // LISTS, and both are trivially true of an EMPTY plan. This block used to
    // pass while `planForProject` emitted no ops at all — it proved that a
    // redelivery changes nothing by proving the planner did nothing, which is
    // the same green tick for the opposite reason. So the preconditions below
    // assert the redelivery actually PLANNED the ref refresh first; without
    // them, the idempotence claim is unfalsifiable.
    const node = acceptance("AC-x", ["web", "ios"]);
    const first = planOps(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    const once = settle(node, first);
    check("the first run wrote the scoped ref", refFor(once, "ios")?.id === "gh-pr-42-ios", JSON.stringify(once.metadata));
    check("the first run promoted", once.metadata?.platformStatuses?.ios === "live", JSON.stringify(once.metadata));

    const second = planOps(bundle([once], true), event({ body: "AC-x@ios" }), wholeRepo());
    check("the redelivery returns an op list", Array.isArray(second), JSON.stringify(second));
    const refresh = second.find((o) => o.op === "update_node" && o.node_id === "AC-x");
    check(
      "the redelivery still PLANS the ref refresh (without this the checks below are vacuous)",
      refresh !== undefined,
      JSON.stringify(second),
    );
    check(
      "and that op carries the ref it is refreshing",
      (refresh?.patch?.metadata?.refs ?? []).some((r) => r.id === "gh-pr-42-ios" && r.url === PR_URL),
      JSON.stringify(refresh),
    );
    check(
      "and promotes nothing the second time (already-there)",
      second.every((o) => o.patch.status === undefined && o.patch.metadata?.platformStatuses?.ios === "live"),
      JSON.stringify(second),
    );
    const twice = settle(once, second);
    const refShape = (state) =>
      JSON.stringify(refsOf(state).map((r) => ({ id: r.id, platform: r.platform ?? null })));
    check(
      "the settled node still carries the ref after the redelivery",
      refFor(twice, "ios")?.id === "gh-pr-42-ios",
      JSON.stringify(twice.metadata?.refs),
    );
    check("leaving exactly the same refs", refShape(twice) === refShape(once), `${refShape(twice)} vs ${refShape(once)}`);
  }

  // --- The mixed-scope hazards ---------------------------------------------
  //
  // A node CAN end up carrying both an unscoped and a scoped ref for one pull
  // request, and pretending otherwise was what removal bought. Freezing does
  // not buy it: nothing is taken away, so a stale ref of the other shape stays
  // on the node. What must hold instead — and what these blocks pin — is that
  // the stale one STOPS MOVING, so this delivery makes exactly one claim.
  {
    // A stale UNSCOPED ref left by the previous version, now that the PR says
    // @ios. Refreshed to "merged" it promotes the BASE status on this very
    // delivery, which resolves every platform with no entry of its own.
    const figma = { id: "fig-1", type: "figma", url: "https://figma.com/x" };
    const stale = ghRef({ synced_at: "2026-01-01T00:00:00.000Z" });
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [stale, figma] } });
    const ops = planOps(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    const state = settle(node, ops);
    check("the node was planned", state.metadata?.refs?.some((r) => r.url === PR_URL) === true, JSON.stringify(state.metadata));
    check("the scoped ref is written", refFor(state, "ios")?.id === "gh-pr-42-ios", JSON.stringify(refsOf(state)));
    check(
      "and the stale unscoped ref is FROZEN — still there, but byte-identical, so it never reaches merged",
      JSON.stringify(refFor(state, null)) === JSON.stringify(stale),
      () => `${JSON.stringify(refFor(state, null))} vs ${JSON.stringify(stale)}`,
    );
    check(
      "so the base status is not promoted",
      state.status === "backlog",
      JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    check("only ios moved", state.metadata?.platformStatuses?.ios === "live", JSON.stringify(state.metadata?.platformStatuses));
    check(
      "and an unrelated ref of another type is untouched (the freeze is targeted, not a stall)",
      JSON.stringify(refsOf(state).find((r) => r.id === "fig-1")) === JSON.stringify(figma),
      JSON.stringify(refsOf(state)),
    );
  }
  {
    // The reverse, which the previous version's data makes routine: every ref it
    // ever wrote is `gh-pr-<n>` even when scoped, so minting the unscoped id
    // beside one would be a duplicate-ref-id — a validator ERROR that refuses
    // the whole batch. `freeRefId` is what stops that, and it matters MORE under
    // freezing than it did under removal, because both refs now coexist.
    const stale = ghRef({ platform: "ios", synced_at: "2026-01-01T00:00:00.000Z" });
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [stale] } });
    const ops = planOps(bundle([node], true), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, ops);
    check("the node was planned", Array.isArray(state.metadata?.refs), JSON.stringify(state.metadata));
    check("the unscoped ref is present", refFor(state, null) !== undefined, JSON.stringify(refsOf(state)));
    check(
      "the scoped one is still there and FROZEN — freezing keeps history, it does not delete",
      JSON.stringify(refFor(state, "ios")) === JSON.stringify(stale),
      () => `${JSON.stringify(refFor(state, "ios"))} vs ${JSON.stringify(stale)}`,
    );
    check(
      "…so this delivery promotes the base status and claims ios by inheritance, not from the frozen ref",
      state.status === "live" && state.metadata?.platformStatuses === undefined,
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    const ids = refsOf(state).map((r) => r.id);
    check("and no two refs share an id", new Set(ids).size === ids.length, JSON.stringify(ids));
  }
  {
    // Two repos linked to ONE project is the ordinary arrangement — an iOS repo
    // and a web repo. PR numbers are per-repo, so both reach #42, and both would
    // mint `gh-pr-42` on the same acceptance. `duplicate-ref-id` is a validator
    // ERROR, so the collision would not degrade: it would refuse the whole batch
    // on every redelivery, forever.
    const other = ghRef({ url: "https://github.com/acme/ios-app/pull/42", external_status: "merged" });
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [other] } });
    const ops = planOps(bundle([node], true), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, ops);

    const mine = refFor(state, null);
    check("a ref was minted for this PR", mine !== undefined, JSON.stringify(state.metadata?.refs));
    check(
      "it did not take the id the other repo's PR #42 already holds",
      mine !== undefined && mine.id !== "gh-pr-42",
      JSON.stringify(state.metadata?.refs?.map((r) => [r.id, r.url])),
    );
    check(
      "and the other repo's ref keeps its own id and url",
      refsOf(state).find((r) => r.id === "gh-pr-42")?.url === other.url,
      JSON.stringify(state.metadata?.refs?.map((r) => [r.id, r.url])),
    );
    const bothIds = refsOf(state).map((r) => r.id);
    check(
      "so no two refs share an id (a duplicate would refuse the batch)",
      new Set(bothIds).size === bothIds.length,
      JSON.stringify(bothIds),
    );
  }
  {
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [ghRef()] } });
    const ops = planOps(bundle([node], true), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, ops);
    const ref = refFor(state, null);
    check("an existing unscoped ref is updated in place", ref?.id === "gh-pr-42", JSON.stringify(refsOf(state)));
    check("and refreshed", ref?.external_status === "merged", JSON.stringify(ref));
    check(
      "not duplicated",
      refsOf(state).filter((r) => r.url === PR_URL)[1] === undefined,
      JSON.stringify(refsOf(state)),
    );
  }
  {
    // A ref for a DIFFERENT PR must survive whatever this delivery does.
    const other = { id: "gh-pr-7", type: "github-pr", url: "https://github.com/acme/monorepo/pull/7", external_status: "merged" };
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [other] } });
    const ops = planOps(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    const state = settle(node, ops);
    check("the scoped ref for this PR is written", refFor(state, "ios") !== undefined, JSON.stringify(refsOf(state)));
    check(
      "and another PR's unscoped ref is untouched",
      refsOf(state).find((r) => r.id === "gh-pr-7")?.external_status === "merged",
      JSON.stringify(refsOf(state)),
    );
    check(
      "its promotion is NOT applied by this delivery",
      state.status === "backlog",
      JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
  }
  {
    // A body edit that drops a mention must not destroy the ref a promotion
    // already landed on — and the ref must keep being mirrored.
    const node = acceptance("AC-x", ["web", "ios"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42-ios", platform: "ios" })] },
    });
    const ops = planOps(bundle([node], true), event({ body: "no ids here" }), wholeRepo());
    const state = settle(node, ops);
    const ref = refFor(state, "ios");
    check("a ref whose mention disappeared survives", ref !== undefined, JSON.stringify(state.metadata));
    check("and is still mirrored", ref?.external_status === "merged", JSON.stringify(ref));
    check("its promotion still lands", state.metadata?.platformStatuses?.ios === "live", JSON.stringify(state.metadata?.platformStatuses));
  }

  // --- A REFUSAL REFUSES PROMOTION, NOT JUST ATTACHMENT ---------------------
  // The refusal used to prevent ATTACHING a ref and nothing else. A node that
  // ALREADY carried a ref for this PR still had it refreshed — correct, a body
  // edit must not stop the mirror — but the refreshed ref stayed in `touched`,
  // so it was still PROMOTED. The delivery response then carried two lines that
  // contradicted each other: a warning saying "attaches no ref and promotes no
  // status", beside a status that had just moved.
  //
  // "reopened", "synchronize" and "edited" are all in the webhook's
  // HANDLED_ACTIONS, so this is not an exotic path: it is the second delivery of
  // every pull request. The blocks below are two-delivery sequences for that
  // reason — a single-delivery fixture cannot reach the bug at all, which is how
  // it survived.
  {
    // Kind 1 — an unknown `@suffix`. Delivery 1 scopes @ios correctly while the
    // PR is open; the author then edits the body and mistypes the suffix.
    const node = acceptance("AC-x", ["web", "ios", "android"]);
    const opened = event({ action: "opened", body: "AC-x@ios", merged: false, state: "open" });
    const afterOpen = settle(node, planOps(bundle([node], true), opened, wholeRepo()));
    check(
      "precondition: the first delivery attached the scoped ref",
      refFor(afterOpen, "ios")?.id === "gh-pr-42-ios",
      () => JSON.stringify(refsOf(afterOpen)),
    );
    check(
      "precondition: and promoted ios to development",
      afterOpen.metadata?.platformStatuses?.ios === "development",
      () => JSON.stringify(afterOpen.metadata?.platformStatuses),
    );

    // Delivery 2: merged, and the suffix is now a typo — beside a BARE mention
    // of the same id, which is what makes this a refusal rather than silence.
    // (An `@suffix` typo with no bare mention leaves the id out of `mentions`
    // entirely, and the node is then reached only through its existing ref; that
    // boundary is pinned in its own block below.)
    const plan = planForProject(
      bundle([afterOpen], true),
      event({ title: "AC-x: Apple Pay", body: "Fixes AC-x@ios-tablet" }),
      wholeRepo(),
    );
    const state = settle(afterOpen, plan.ops);

    // NON-VACUITY: the refreshed ref really is promotable. If `touched` did not
    // exclude it, `computeRefPromotions` would move ios to "live" — asserted
    // against the real schema function on the mirrored node, so this cannot
    // "pass" because the fixture quietly stopped being promotable.
    const mirrored = {
      ...afterOpen,
      metadata: {
        ...afterOpen.metadata,
        refs: refsOf(afterOpen).map((r) => (r.url === PR_URL ? { ...r, external_status: "merged" } : r)),
      },
    };
    const promotable = computeRefPromotions(bundle([mirrored], true)).promotions;
    check(
      "precondition: the refreshed ref IS promotable — only the refusal may stop it",
      promotable.some((p) => p.node_id === "AC-x" && p.ref_id === "gh-pr-42-ios" && p.to === "live"),
      () => JSON.stringify({ promotable, refs: refsOf(mirrored) }),
    );

    check(
      "the mirror keeps running through a refused scope",
      refFor(state, "ios")?.external_status === "merged",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "but the refused delivery promotes NOTHING from it",
      state.metadata?.platformStatuses?.ios === "development",
      () => JSON.stringify(state.metadata?.platformStatuses),
    );
    check(
      "and does not move the base status either",
      state.status === "backlog",
      () => JSON.stringify(state.status),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-x:"));
    check("the refusal is still reported", line !== undefined, () => JSON.stringify(plan.warnings));
    check(
      "and the warning's claim is TRUE of this delivery: no status promoted",
      line?.includes("promotes no status") === true,
      () => JSON.stringify(line),
    );
    check(
      "while saying what DOES still happen, so the text is not a second lie",
      line?.includes("mirrored") === true,
      () => JSON.stringify(line),
    );
  }
  {
    // THE CASE THAT USED TO BE A BOUNDARY AND IS NOW THE SAME RULE.
    //
    // `AC-x@ios-tablet` ALONE puts the id in `unknown` and nowhere else, so it
    // never reached `mentions` — and the refusal above was gated on the node
    // being MENTIONED, so it never fired. The node fell into the ordinary
    // refresh-and-promote path instead, exactly as if the body had said "no ids
    // here", and every ref this pull request had left on it was mirrored to the
    // merge and promoted from.
    //
    // The comment that stood here defended that as scoped: the ref names `ios`,
    // so promoting ios claims nothing extra. That is true of THAT fixture and
    // false in general — an UNSCOPED ref left by an earlier delivery is the
    // routine shape, and promoting from it moves the BASE status, which resolves
    // every platform with no entry of its own. So this fixture uses the unscoped
    // ref: the maximal-damage case, which is the one a rule has to be tested on.
    //
    // The refusal now belongs to the ID BEING NAMED, so it fires here.
    const node = acceptance("AC-x", ["web", "ios", "android"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42", external_status: "open" })] },
    });
    const mirrored = {
      ...node,
      metadata: { refs: [ghRef({ id: "gh-pr-42", external_status: "merged" })] },
    };
    check(
      "precondition: the typo really did leave no usable mention",
      mentionFor(mentionedAcceptances({ title: "t", body: "AC-x@ios-tablet" }), "AC-x", null)[0] === undefined,
      () => JSON.stringify(mentionedAcceptances({ title: "t", body: "AC-x@ios-tablet" })),
    );
    check(
      "precondition: mirrored to merged, that unscoped ref WOULD move the base status",
      computeRefPromotions(bundle([mirrored], true)).promotions.some(
        (p) => p.node_id === "AC-x" && p.ref_id === "gh-pr-42" && p.platform === undefined && p.to === "live",
      ),
      () => JSON.stringify(computeRefPromotions(bundle([mirrored], true))),
    );
    const plan = planForProject(bundle([node], true), event({ body: "AC-x@ios-tablet" }), wholeRepo());
    const state = settle(node, plan.ops);
    check(
      "an id named ONLY by an unusable suffix promotes nothing at all",
      state.status === "backlog" && state.metadata?.platformStatuses === undefined,
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    check(
      "…and the ref it already carried is still mirrored, which is what refusalTail promises",
      refFor(state, null)?.external_status === "merged",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "the typo is reported by the text channel",
      unknownPlatformWarnings({ title: "t", body: "AC-x@ios-tablet" }).some((w) => w.includes("ios-tablet")),
      () => JSON.stringify(unknownPlatformWarnings({ title: "t", body: "AC-x@ios-tablet" })),
    );
    check(
      "…and by the planner, which is the only channel that can say a promotion was refused",
      plan.warnings.find((w) => w.startsWith("AC-x:"))?.includes("was not understood") === true,
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // Kind 2 — a repository link naming a platform the acceptance does not
    // list. Same shape: the ref exists from an earlier delivery (or from the
    // link being edited to the wrong platform afterwards), so the refusal has
    // something to refresh and therefore something it could wrongly promote.
    const node = acceptance("AC-x", ["web"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42-web", platform: "web" })] },
    });
    const mirrored = {
      ...node,
      metadata: { ...node.metadata, refs: [ghRef({ id: "gh-pr-42-web", platform: "web", external_status: "merged" })] },
    };
    check(
      "precondition: the ref is promotable once mirrored to merged",
      computeRefPromotions(bundle([mirrored], true)).promotions.some(
        (p) => p.node_id === "AC-x" && p.ref_id === "gh-pr-42-web" && p.platform === "web" && p.to === "live",
      ),
      () => JSON.stringify(computeRefPromotions(bundle([mirrored], true))),
    );

    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo("ios"));
    const state = settle(node, plan.ops);
    check("the pre-existing ref is still mirrored", refFor(state, "web")?.external_status === "merged", () =>
      JSON.stringify(refsOf(state)),
    );
    check(
      "and keeps its stored id verbatim (the id-reuse rule survives the refusal)",
      refFor(state, "web")?.id === "gh-pr-42-web",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "but nothing is promoted from it",
      state.metadata?.platformStatuses === undefined && state.status === "backlog",
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-x:"));
    check("the refusal is reported", line !== undefined, () => JSON.stringify(plan.warnings));
    check(
      "and its 'promotes no status' claim is true of this delivery too",
      line?.includes("promotes no status") === true,
      () => JSON.stringify(line),
    );
  }
  {
    // The mixed-scope invariant must not be broken BY the refusal. A refusal
    // writes no scope at all, so it has nothing to reconcile: it must add no
    // ref, remove no ref, and leave every id exactly where it was. (Removing one
    // would be the opposite failure — a link edited to the wrong platform
    // deleting the history it refuses to act on.)
    const node = acceptance("AC-x", ["web"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42-web", platform: "web" }), ghRef({ id: "gh-pr-42" })] },
    });
    const idsBefore = JSON.stringify(refsOf(node).map((r) => [r.id, r.platform ?? null]));
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo("ios"));
    const state = settle(node, plan.ops);
    check(
      "precondition: the refusal fired",
      plan.warnings.some((w) => w.startsWith("AC-x:")),
      () => JSON.stringify(plan.warnings),
    );
    check(
      "a refused delivery adds and removes no refs",
      JSON.stringify(refsOf(state).map((r) => [r.id, r.platform ?? null])) === idsBefore,
      () => `${JSON.stringify(refsOf(state).map((r) => [r.id, r.platform ?? null]))} vs ${idsBefore}`,
    );
    check(
      "and promotes from neither of them, mixed as they are",
      state.status === "backlog" && state.metadata?.platformStatuses === undefined,
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
  }

  // --- Guards ---------------------------------------------------------------
  {
    // ITEM 1(b) — THE REFUSAL THAT REPLACED A SILENT WRONG ANSWER.
    //
    // Repo acme/ios-app is linked as `ios`; AC-x lists only `web`. This USED TO
    // filter `ios` away and fall back to an unscoped ref, so a PR merged in the
    // iOS repository marked the web-only acceptance shipped ON WEB — verified
    // end to end before the fix: warnings [], status live, hasParityGap false.
    // Completely silent, and the strongest claim the system can make, produced
    // at the moment the code was least sure.
    //
    // The direction of the trade is the whole point: a MISSING claim (nothing
    // happens, and a warning says why) beats a WRONG one every time.
    const node = acceptance("AC-x", ["web"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo("ios"));
    const state = settle(node, plan.ops);
    check(
      "an INFERRED platform the node lacks attaches NO ref at all",
      refFor(state, null) === undefined && refFor(state, "ios") === undefined,
      JSON.stringify(state.metadata?.refs),
    );
    check(
      "and above all does not degrade to an unscoped one (which would claim every platform)",
      refsOf(state).find((r) => r.url === PR_URL) === undefined,
      JSON.stringify(state.metadata?.refs),
    );
    check(
      "so nothing is promoted: the base status is untouched",
      state.status === "backlog" && state.metadata?.platformStatuses === undefined,
      JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    check(
      "and no op is emitted for the node at all (an empty op would inflate `applied`)",
      plan.ops.find((o) => o.node_id === "AC-x") === undefined,
      JSON.stringify(plan.ops),
    );
    // The refusal is only honest if the user can see it — with zero ops, this
    // warning is the ONLY evidence the delivery understood the PR.
    const line = plan.warnings.find((w) => w.startsWith("AC-x:"));
    check("the refusal is reported", line !== undefined, JSON.stringify(plan.warnings));
    check(
      "naming the source that was dropped, and its platform",
      line !== undefined && line.includes("repository link") && line.includes("ios"),
      JSON.stringify(line),
    );
    check(
      "and the acceptance's ACTUAL platforms, so the reader knows which side to fix",
      line?.includes("web") === true,
      JSON.stringify(line),
    );
  }
  {
    // The ordinary case-3 path, asserted beside the refusal so the fix cannot be
    // "refuse everything": when the node DOES list the link's platform, the link
    // still scopes the ref exactly as before.
    const node = acceptance("AC-x", ["web", "ios"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo("ios"));
    const state = settle(node, plan.ops);
    check("a link platform the node lists still scopes the ref", refFor(state, "ios") !== undefined, JSON.stringify(state.metadata));
    check("promoting that platform", state.metadata?.platformStatuses?.ios === "live", JSON.stringify(state.metadata?.platformStatuses));
    check("and reporting nothing", plan.warnings[0] === undefined, JSON.stringify(plan.warnings));
  }
  {
    // The refusal must not destroy history. A node that ALREADY carries a ref
    // for this PR keeps being mirrored even while its scope is refused —
    // otherwise a link edited to the wrong platform would freeze every ref it
    // ever wrote at its last mirrored status.
    const node = acceptance("AC-x", ["web"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42-web", platform: "web" })] },
    });
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo("ios"));
    const state = settle(node, plan.ops);
    const ref = refFor(state, "web");
    check("a pre-existing ref survives a refused scope", ref !== undefined, JSON.stringify(state.metadata?.refs));
    check("and is still mirrored", ref?.external_status === "merged", JSON.stringify(ref));
    check(
      "while the refused link platform adds nothing beside it",
      refFor(state, "ios") === undefined && refFor(state, null) === undefined,
      JSON.stringify(state.metadata?.refs),
    );
  }
  {
    // ITEM 1(a) — AN UNKNOWN SUFFIX MUST NOT LEAVE A BARE MENTION AS ITS
    // FALLBACK. The author asked for one platform, mistyped it, and USED TO get
    // all three marked shipped: the suffixed mention landed in `unknown`, the
    // bare one survived in `mentions`, resolved to `[null]`, attached an
    // unscoped ref and moved the BASE status. `planForProject` destructured
    // `{ mentions }` and discarded `unknown` entirely, so it could not tell.
    const node = acceptance("AC-guest-checkout", ["web", "ios", "android"]);
    const plan = planForProject(
      bundle([node], true),
      event({ title: "AC-guest-checkout: Apple Pay", body: "Fixes AC-guest-checkout@ios-tablet" }),
      wholeRepo(),
    );
    const state = settle(node, plan.ops);
    // Assert the PRECONDITION first: if the grammar ever stopped producing a
    // bare mention here, every check below would pass for the wrong reason.
    const scan = mentionedAcceptances({
      title: "AC-guest-checkout: Apple Pay",
      body: "Fixes AC-guest-checkout@ios-tablet",
    });
    check(
      "precondition: the typo IS reported as unknown",
      scan.unknown.some((u) => u.id === "AC-guest-checkout" && u.platform === "ios-tablet"),
      JSON.stringify(scan.unknown),
    );
    check(
      "precondition: and a BARE mention of the same id really is present (the fallback that used to fire)",
      mentionFor(scan, "AC-guest-checkout", null)[0] !== undefined,
      JSON.stringify(scan.mentions),
    );
    check(
      "the bare mention is NOT used as the typo's fallback: no ref is attached",
      refsOf(state).find((r) => r.url === PR_URL) === undefined,
      JSON.stringify(state.metadata?.refs),
    );
    check(
      "and the base status does not move (which would mark web, ios AND android shipped)",
      state.status === "backlog" && state.metadata?.platformStatuses === undefined,
      JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    check(
      "no op is emitted for the node",
      plan.ops.find((o) => o.node_id === "AC-guest-checkout") === undefined,
      JSON.stringify(plan.ops),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-guest-checkout:"));
    check("the refusal is reported", line !== undefined, JSON.stringify(plan.warnings));
    check(
      "and says the bare mention was not used as a fallback",
      line?.includes("fallback") === true,
      JSON.stringify(line),
    );
  }
  {
    // The same shape, but the author ALSO wrote a valid suffix. The explicit
    // scope is honoured — refusing here would punish a correct mention because a
    // typo sat next to it, turning a working feature off.
    const node = acceptance("AC-x", ["web", "ios", "android"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x@ios and AC-x@ios-tablet" }), wholeRepo());
    const state = settle(node, plan.ops);
    check("a valid suffix beside an unusable one is still honoured", refFor(state, "ios") !== undefined, JSON.stringify(state.metadata?.refs));
    check("promoting only that platform", state.metadata?.platformStatuses?.ios === "live", JSON.stringify(state.metadata?.platformStatuses));
    check(
      "and the base status still does not move",
      state.status === "backlog",
      JSON.stringify(state.status),
    );
  }
  {
    // The repo-link platform passes through `IS_PLATFORM` before it is used.
    // That guard is defence-in-depth — `project_repos.platform` is written only
    // through the repos API, which validates against the same PLATFORMS list,
    // and the Select in RepoLinksDialog offers no other value — so it is
    // unreachable through normal writes. Pinned anyway, cheaply: a stored value
    // from an older schema, a hand-edited row, or a future platform removed from
    // the list must degrade to "no platform named", never be written onto a ref.
    const node = acceptance("AC-x", ["web", "ios"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo("windows"));
    const state = settle(node, plan.ops);
    const ref = refFor(state, null);
    check("an unrecognised link platform falls back to an unscoped ref", ref !== undefined, JSON.stringify(state.metadata?.refs));
    check(
      "carrying no platform key at all",
      ref !== undefined && !("platform" in ref),
      JSON.stringify(ref),
    );
    check(
      "and no ref claims the bogus platform",
      refsOf(state).every((r) => r.platform !== "windows"),
      JSON.stringify(state.metadata?.refs),
    );
  }
  {
    // An EXPLICIT one does not degrade: an unscoped ref here would promote the
    // base status, which is the parity lie the suffix exists to prevent.
    const node = acceptance("AC-x", ["web"]);
    const ops = planOps(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    const state = settle(node, ops);
    check("an EXPLICIT platform the node lacks is kept on the ref", refFor(state, "ios")?.platform === "ios", JSON.stringify(refsOf(state)));
    check(
      "it never silently becomes an unscoped ref",
      refFor(state, null) === undefined,
      JSON.stringify(refsOf(state)),
    );
    check(
      "and NOTHING is promoted (platform-not-applicable)",
      state.status === "backlog" && state.metadata?.platformStatuses === undefined,
      JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
  }
  {
    const node = acceptance("AC-x", ["web", "ios"], { status: "archived" });
    const ops = planOps(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    const state = settle(node, ops);
    check("an archived node still mirrors the ref", refFor(state, "ios")?.external_status === "merged", JSON.stringify(state.metadata));
    check("but is never resurrected", state.status === "archived", JSON.stringify(state.status));
    check(
      "and gains no platform status",
      state.metadata?.platformStatuses === undefined,
      JSON.stringify(state.metadata?.platformStatuses),
    );
  }
  {
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { platformStatuses: { ios: "live" } } });
    const ops = planOps(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    const state = settle(node, ops);
    check("a node already at the target still gets its ref", refFor(state, "ios") !== undefined, JSON.stringify(state.metadata));
    check(
      "and no promotion op is emitted for it",
      ops.every((o) => o.patch.status === undefined),
      JSON.stringify(ops),
    );
    check("leaving the status where it was", state.metadata?.platformStatuses?.ios === "live", JSON.stringify(state.metadata?.platformStatuses));
  }
  {
    const node = acceptance("AC-x", ["web", "ios"]);
    const ops = planOps(bundle([node], true), event({ number: 7, url: "https://github.com/acme/monorepo/pull/7", body: "nothing here" }), wholeRepo("ios"));
    check("the planner returns an op list", Array.isArray(ops), JSON.stringify(ops));
    check("a PR mentioning no acceptance touches nothing", ops.find((o) => o.node_id === "AC-x") === undefined, JSON.stringify(ops));
  }
  {
    // An unknown suffix must leave the acceptance alone entirely — not fall back
    // to the repo's link platform.
    const node = acceptance("AC-x", ["web", "ios"]);
    const ops = planOps(bundle([node], true), event({ body: "AC-x@windows" }), wholeRepo("ios"));
    check("the planner returns an op list", Array.isArray(ops), JSON.stringify(ops));
    check("an unknown platform produces no op at all", ops.find((o) => o.node_id === "AC-x") === undefined, JSON.stringify(ops));
  }
  {
    // Promotion is not acceptance-only; the mention grammar is an id grammar.
    const view = {
      id: "AC-x",
      project_id: "gp",
      species: "view",
      title: "A view that happens to carry an AC- id",
      status: "backlog",
      platforms: ["ios"],
    };
    const ops = planOps(bundle([view], true), event({ body: "AC-x@ios" }), wholeRepo());
    const state = settle(view, ops);
    check("a mention matches by id, not by species", refFor(state, "ios") !== undefined, JSON.stringify(state.metadata));
  }

  // --- The report channel ---------------------------------------------------
  // `ApplyOutcome.warnings` is the ONLY place a user learns that a delivery
  // understood their PR and deliberately did nothing. The route serialises it
  // into the response body that Recent Deliveries shows. Nothing asserted a
  // character of it before, which made "reported, not guessed" a claim in the
  // docs rather than a property of the code.
  {
    const warnings = unknownPlatformWarnings({ title: "t", body: "Fixes AC-x@windows" });
    const line = warnings.find((w) => w.includes("AC-x"));
    check("an unknown suffix produces a warning line", line !== undefined, JSON.stringify(warnings));
    check("quoting the suffix back as written", line?.includes("windows") === true, JSON.stringify(line));
    check(
      "and naming the platforms that would have worked",
      line !== undefined && ["web", "ios", "android"].every((p) => line.includes(p)),
      JSON.stringify(line),
    );
  }
  {
    const warnings = unknownPlatformWarnings({ title: "t", body: "AC-a@windows and AC-b@tvos" });
    check(
      "each unusable mention gets its own line: AC-a",
      warnings.find((w) => w.startsWith("AC-a@windows")) !== undefined,
      JSON.stringify(warnings),
    );
    check(
      "…and AC-b",
      warnings.find((w) => w.startsWith("AC-b@tvos")) !== undefined,
      JSON.stringify(warnings),
    );
  }
  {
    const warnings = unknownPlatformWarnings({ title: "t", body: "Fixes AC-x@ios" });
    check("a usable mention warns about nothing", warnings[0] === undefined, JSON.stringify(warnings));
  }
  {
    // docs/hosted-projects.md: "a ref naming a platform the acceptance does not
    // list is reported, not promoted". The ref attaches and nothing moves, so
    // `applied: 1` on its own reads as success — this line is the whole
    // difference between an honest no-op and a silent one.
    const node = acceptance("AC-x", ["web"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    check("the plan attaches the ref", plan.ops.find((o) => o.node_id === "AC-x") !== undefined, JSON.stringify(plan.ops));
    const line = plan.warnings.find((w) => w.includes("AC-x"));
    check("and reports the refusal", line !== undefined, JSON.stringify(plan.warnings));
    check("naming the platform that does not apply", line?.includes("ios") === true, JSON.stringify(line));
    const state = settle(node, plan.ops);
    check(
      "while promoting nothing at all",
      state.status === "backlog" && state.metadata?.platformStatuses === undefined,
      JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
  }
  // --- The over-claim report ------------------------------------------------
  // MOVING THE BASE STATUS IS THE BIGGEST CLAIM THIS CODE CAN MAKE, not the
  // smallest, and the docs said the opposite for a release.
  // `resolvePlatformStatus` falls back to `node.status` for every platform with
  // no entry of its own, so a base move resolves ALL of them to the new status
  // and `hasParityGap` returns false — the acceptance renders as delivered on
  // web AND ios AND android (packages/schema/src/acceptance.ts, verified).
  //
  // Behaviour does not change here; the REPORT does. Silence is what makes the
  // over-claim invisible: the author sees `applied: 1`, a green delivery, and a
  // /acceptances page with no parity gap, and reasonably concludes it worked.
  {
    const node = acceptance("AC-x", ["web", "ios", "android"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, plan.ops);
    // The promotion has to have HAPPENED for the warning to be about anything.
    check("the base status actually moved", state.status === "live", JSON.stringify(state.status));
    const line = plan.warnings.find((w) => w.startsWith("AC-x:"));
    check("an unscoped promotion is reported", line !== undefined, JSON.stringify(plan.warnings));
    check(
      "naming every platform it just marked shipped",
      line !== undefined && ["web", "ios", "android"].every((p) => line.includes(p)),
      JSON.stringify(line),
    );
    check("and the status it moved them to", line?.includes("live") === true, JSON.stringify(line));
    check(
      "and how to scope it next time",
      line?.includes("AC-x@") === true,
      JSON.stringify(line),
    );
  }
  {
    // Nothing to over-claim: the base status and that one platform's status are
    // the same statement, so a warning here would be noise on every single PR
    // in an ordinary single-platform project.
    const node = acceptance("AC-x", ["web"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, plan.ops);
    check("the base status moved", state.status === "live", JSON.stringify(state.status));
    check("a single-platform acceptance is not warned about", plan.warnings[0] === undefined, JSON.stringify(plan.warnings));
  }
  {
    // A scoped promotion claims exactly what the author asked for. Warning here
    // would train people to ignore the channel.
    const node = acceptance("AC-x", ["web", "ios", "android"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    const state = settle(node, plan.ops);
    check("the scoped promotion landed", state.metadata?.platformStatuses?.ios === "live", JSON.stringify(state.metadata));
    check("and a scoped promotion is not warned about", plan.warnings[0] === undefined, JSON.stringify(plan.warnings));
  }
  {
    // THE ERASING CASE — the one the warning's gate used to suppress, and the
    // worst outcome anywhere in this file.
    //
    // AC-x lists [web, ios] with `platformStatuses {web: "live"}` over a base of
    // "backlog": an ordinary mid-rollout acceptance. Web shipped, iOS did
    // not, and `hasParityGap` says exactly that. A bare mention moves the BASE
    // to "live"; iOS has no entry of its own, so `resolvePlatformStatus`
    // resolves it to "live" too, delivered === resolved, and the parity gap
    // DISAPPEARS. The one thing this feature exists to surface, deleted by a PR
    // that forgot a suffix.
    //
    // `inheriting` here is `[ios]` — length 1 — so the old gate of
    // `inheriting.length < 2` said nothing at all. It was justified by reasoning
    // about a SINGLE-PLATFORM acceptance, where the base status and that
    // platform's status are the same statement; but `inheriting.length` stops
    // being that number the moment `platformStatuses` is partial, which is the
    // ordinary state of a rollout. The gate is on `node.platforms.length`.
    //
    // The previous fixture here pinned ios AND android to "development", where a
    // base move CREATES a gap instead of erasing one — the harmless variant of
    // the same shape. It carried a name claiming the general property and never
    // exercised the case that breaks it, which is how the bug survived.
    const node = acceptance("AC-x", ["web", "ios"], {
      metadata: { platformStatuses: { web: "live" } },
    });
    check(
      "precondition: the acceptance really has a parity gap before the merge",
      hasParityGap(node) === true,
      () => JSON.stringify({ status: node.status, platformStatuses: node.metadata?.platformStatuses }),
    );
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, plan.ops);
    check("the base status moved", state.status === "live", () => JSON.stringify(state.status));
    check(
      "so ios — which nobody named — now resolves to live by inheritance",
      resolvePlatformStatus(state, "ios") === "live",
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    check(
      "and the parity gap is GONE, by the real @arkaik/schema projection",
      hasParityGap(state) === false,
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-x:"));
    check("which is reported rather than silent", line !== undefined, () => JSON.stringify(plan.warnings));
    check(
      "naming the platform the pull request did not name",
      line?.includes("ios") === true,
      () => JSON.stringify(line),
    );
    check(
      "in the SINGULAR, since exactly one platform inherits (\"all 1 platforms\" is wrong twice over)",
      line !== undefined && line.includes("a platform the ref does not name"),
      () => JSON.stringify(line),
    );
    check(
      "and telling the author how to scope it",
      line?.includes("AC-x@ios") === true,
      () => JSON.stringify(line),
    );
    check(
      "while not naming web, which was already live and is not a new claim",
      line !== undefined && !line.includes("web"),
      () => JSON.stringify(line),
    );
  }
  {
    // The precision the warning still has to have, in the direction that stayed
    // correct: a platform carrying its own `platformStatuses` entry does NOT
    // follow the base status, so naming it would report something that did not
    // happen. Here ios and android are pinned to "development" and only web
    // inherits — the base move CREATES a gap rather than erasing one, and the
    // line must name web and only web.
    const node = acceptance("AC-x", ["web", "ios", "android"], {
      metadata: { platformStatuses: { ios: "development", android: "development" } },
    });
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, plan.ops);
    check("the base status moved", state.status === "live", () => JSON.stringify(state.status));
    check(
      "and the pinned platforms did not follow it",
      state.metadata?.platformStatuses?.ios === "development" &&
        state.metadata?.platformStatuses?.android === "development",
      () => JSON.stringify(state.metadata?.platformStatuses),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-x:"));
    check("the unnamed platform it DOES reach is still reported", line !== undefined, () =>
      JSON.stringify(plan.warnings),
    );
    check("naming web", line?.includes("web") === true, () => JSON.stringify(line));
    check(
      "and NOT the pinned ones, which the base move does not touch",
      line !== undefined && !line.includes("ios") && !line.includes("android"),
      () => JSON.stringify(line),
    );
  }
  {
    // The other edge of the same gate: when EVERY platform carries its own
    // entry, the base move reaches none of them. Nothing is over-claimed, so
    // warning would be noise — and, unlike the case above, that is true however
    // many platforms the acceptance lists.
    const node = acceptance("AC-x", ["web", "ios"], {
      metadata: { platformStatuses: { web: "development", ios: "development" } },
    });
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), wholeRepo());
    const state = settle(node, plan.ops);
    check("the base status still moved", state.status === "live", () => JSON.stringify(state.status));
    check(
      "but no platform resolves to it",
      resolvePlatformStatus(state, "web") === "development" &&
        resolvePlatformStatus(state, "ios") === "development",
      () => JSON.stringify(state.metadata?.platformStatuses),
    );
    check(
      "so nothing is warned about",
      plan.warnings[0] === undefined,
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // `already-there` is ordinary idempotence and fires on every redelivery
    // forever; reporting it would bury the one line that means something.
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { platformStatuses: { ios: "live" } } });
    const plan = planForProject(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    check("the node was planned", plan.ops.find((o) => o.node_id === "AC-x") !== undefined, JSON.stringify(plan.ops));
    check("a no-op redelivery reports nothing", plan.warnings[0] === undefined, JSON.stringify(plan.warnings));
  }
  {
    // An inapplicable ref left by ANOTHER PR is not this delivery's news. The
    // report is filtered by the same `touched` set as the promotions, or every
    // unrelated delivery would repeat someone else's warning forever.
    const stale = ghRef({
      id: "gh-pr-7-android",
      url: "https://github.com/acme/monorepo/pull/7",
      platform: "android",
      external_status: "merged",
    });
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [stale] } });
    const plan = planForProject(bundle([node], true), event({ body: "AC-x@ios" }), wholeRepo());
    check(
      "this delivery's ref is written",
      refFor(settle(node, plan.ops), "ios") !== undefined,
      JSON.stringify(plan.ops),
    );
    check(
      "and another PR's inapplicable ref is not reported here",
      plan.warnings.find((w) => w.includes("android")) === undefined,
      JSON.stringify(plan.warnings),
    );
  }
  {
    // Two acceptances, one bad scope each: both must be reported, and each line
    // must name its own node — a report that says "something went wrong" without
    // saying where is not a report.
    const a = acceptance("AC-a", ["web"]);
    const b = acceptance("AC-b", ["ios"]);
    const plan = planForProject(bundle([a, b], true), event({ body: "AC-a@ios and AC-b@web" }), wholeRepo());
    check("both nodes were planned", plan.ops.find((o) => o.node_id === "AC-a") !== undefined && plan.ops.find((o) => o.node_id === "AC-b") !== undefined, JSON.stringify(plan.ops));
    check(
      "AC-a's refusal names ios",
      plan.warnings.find((w) => w.startsWith("AC-a@ios")) !== undefined,
      JSON.stringify(plan.warnings),
    );
    check(
      "AC-b's refusal names web",
      plan.warnings.find((w) => w.startsWith("AC-b@web")) !== undefined,
      JSON.stringify(plan.warnings),
    );
  }

  // --- The outcome the user actually reads ----------------------------------
  // `{ applied, skipped, warnings }` is what `route.ts` serialises into the
  // response body — the thing GitHub's Recent Deliveries shows, and the only
  // report channel this feature has. It was assembled INLINE in
  // `applyPullRequestEvent`, an async function whose first statement is a
  // database call, so this suite could not reach it and the Postgres-gated one
  // did not cover it: the branch that mattered most had no test in EITHER suite.
  // A previous round found exactly that branch — warnings with zero ops —
  // silently dropping them. `assembleOutcome` is pure and exported so that can
  // never be true again.
  {
    // THE BRANCH THAT WAS BROKEN. A refusal plans no ops at all, so the warning
    // is the ONLY evidence the delivery understood the PR and declined to act.
    const outcome = assembleOutcome({
      projectId: "gp",
      textWarnings: [],
      planWarnings: ["AC-x: the repository link says \"ios\", which AC-x does not list (web)."],
      opCount: 0,
    });
    check("a zero-op outcome still applies nothing", outcome.applied === 0, () => JSON.stringify(outcome));
    check(
      "and KEEPS the plan's warnings — dropping them deletes the whole report",
      (outcome.warnings ?? []).some((w) => w.startsWith("AC-x:")),
      () => JSON.stringify(outcome),
    );
    check(
      "with a `skipped` that agrees with them rather than saying nothing matched",
      outcome.skipped === "an acceptance was named, but no platform scope could be honoured",
      () => JSON.stringify(outcome),
    );
  }
  {
    // The three zero-op reasons are three DIFFERENT statements, and reporting
    // "no matching acceptance" for a PR that named one and got the platform
    // wrong is a confidently wrong answer.
    const nothing = assembleOutcome({ projectId: "gp", textWarnings: [], planWarnings: [], opCount: 0 });
    check("a PR that named nothing says so", nothing.skipped === "no matching acceptance", () =>
      JSON.stringify(nothing),
    );
    check("and carries no warnings key at all", nothing.warnings === undefined, () => JSON.stringify(nothing));

    const typo = assembleOutcome({
      projectId: "gp",
      textWarnings: ['AC-x@windows: "windows" is not a platform.'],
      planWarnings: [],
      opCount: 0,
    });
    check(
      "an unusable suffix is distinguished from both",
      typo.skipped === "no usable acceptance mention",
      () => JSON.stringify(typo),
    );
    check("and its text warning survives", (typo.warnings ?? [])[0]?.includes("windows") === true, () =>
      JSON.stringify(typo),
    );
    check(
      "so the three zero-op reasons are genuinely distinct strings",
      new Set([nothing.skipped, typo.skipped, "an acceptance was named, but no platform scope could be honoured"])
        .size === 3,
      () => JSON.stringify([nothing.skipped, typo.skipped]),
    );
  }
  {
    // THE OTHER HALF, and the one the docs used to get wrong: a refusal is NOT
    // implied by `applied: 0`. When the same PR moved another acceptance, the
    // outcome is a plain-looking success and the refusal shows up only here.
    const outcome = assembleOutcome({
      projectId: "gp",
      textWarnings: ['AC-a@windows: "windows" is not a platform.'],
      planWarnings: ["AC-b: the ref for this pull request carries no platform, so the plan moves the base status to \"live\"."],
      opCount: 3,
    });
    check("a successful delivery reports what it applied", outcome.applied === 3, () => JSON.stringify(outcome));
    check("with no `skipped`", outcome.skipped === undefined, () => JSON.stringify(outcome));
    check(
      "and warnings survive beside a NON-ZERO applied",
      (outcome.warnings ?? []).length === 2,
      () => JSON.stringify(outcome),
    );
    check(
      "text warnings first, then the plan's — the order the reader is told to read",
      (outcome.warnings ?? [])[0]?.startsWith("AC-a@windows") === true &&
        (outcome.warnings ?? [])[1]?.startsWith("AC-b:") === true,
      () => JSON.stringify(outcome.warnings),
    );
  }
  {
    // A failure zeroes `applied` whatever the plan held: a validator refusal
    // writes nothing, and reporting the op count would claim writes that were
    // rolled back with the batch.
    const outcome = assembleOutcome({
      projectId: "gp",
      textWarnings: [],
      planWarnings: ["AC-x: something to say"],
      opCount: 4,
      failure: "refused by the validator",
    });
    check("a refused mutation applies nothing", outcome.applied === 0, () => JSON.stringify(outcome));
    check("and says why", outcome.skipped === "refused by the validator", () => JSON.stringify(outcome));
    check(
      "while still carrying the warnings the plan produced",
      (outcome.warnings ?? [])[0]?.startsWith("AC-x:") === true,
      () => JSON.stringify(outcome),
    );
  }
  {
    // `projectId` is what `route.ts` matches an outcome back to a link, and the
    // route relies on exactly one outcome per link. A dropped id would make the
    // whole response unattributable.
    const outcome = assembleOutcome({ projectId: "gp-7", textWarnings: [], planWarnings: [], opCount: 1 });
    check("the outcome names its project", outcome.projectId === "gp-7", () => JSON.stringify(outcome));
    check("and a plain success is a plain success", outcome.applied === 1 && outcome.skipped === undefined, () =>
      JSON.stringify(outcome),
    );
  }
  {
    // END TO END through the pure half: what `planForProject` says and what the
    // outcome reports must be the same story. This is the composition the DB
    // suite exercises with Postgres attached; here it costs nothing.
    const a = acceptance("AC-a", ["web"]);
    const b = acceptance("AC-b", ["web", "ios"]);
    const ev = event({ body: "AC-a and AC-b@ios" });
    const plan = planForProject(bundle([a, b], true), ev, wholeRepo("ios"));
    const outcome = assembleOutcome({
      projectId: "gp",
      textWarnings: unknownPlatformWarnings(ev),
      planWarnings: plan.warnings,
      opCount: plan.ops.length,
    });
    check(
      "precondition: AC-a's link scope was refused and AC-b was promoted",
      plan.warnings.some((w) => w.startsWith("AC-a:")) &&
        settle(b, plan.ops).metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify({ warnings: plan.warnings, ops: plan.ops }),
    );
    check(
      "the outcome applies the ops that were planned",
      outcome.applied === plan.ops.length && outcome.applied > 0,
      () => JSON.stringify(outcome),
    );
    check(
      "reports no `skipped`, because something really did happen",
      outcome.skipped === undefined,
      () => JSON.stringify(outcome),
    );
    check(
      "and the refusal reaches the reader anyway, through `warnings` alone",
      (outcome.warnings ?? []).some((w) => w.startsWith("AC-a:")),
      () => JSON.stringify(outcome),
    );
  }

  // ── Path-scoped repository links ─────────────────────────────────────────
  //
  // A monorepo holds several apps in one repository, so one project may link it
  // several times, each link scoping a platform to one subtree. The delivery
  // decides between them by reading the pull request's changed files.
  //
  // The failure this whole section guards is the one the file header names: a
  // scope that was REQUESTED and could not be honoured must be refused and
  // reported, never replaced by the whole-repository link's platform — and
  // least of all by an unscoped ref, which moves the base status and marks
  // every platform shipped.

  const IOS_LINK = { platform: "ios", pathPrefix: "apps/ios" };
  const WEB_LINK = { platform: "web", pathPrefix: "apps/webapp" };
  const ANDROID_LINK = { platform: "android", pathPrefix: "apps/android" };
  const ALL_LINK = { platform: null, pathPrefix: "" };

  // ── groupLinksByProject: one pass per PROJECT, not per link ──────────────
  {
    const rows = [
      { projectId: "p1", platform: "ios", pathPrefix: "apps/ios", installationId: "9" },
      { projectId: "p1", platform: "web", pathPrefix: "apps/webapp", installationId: "9" },
      { projectId: "p2", platform: null, pathPrefix: "", installationId: null },
    ];
    const groups = groupLinksByProject(rows);
    check(
      "several links to one repository become ONE entry for that project",
      JSON.stringify(groups.map((g) => g.projectId)) === '["p1","p2"]',
      () => JSON.stringify(groups),
    );
    check(
      "…carrying both of its links, in the order they arrived",
      JSON.stringify(groups[0]?.links) ===
        JSON.stringify([
          { platform: "ios", pathPrefix: "apps/ios" },
          { platform: "web", pathPrefix: "apps/webapp" },
        ]),
      () => JSON.stringify(groups[0]),
    );
    check("and no link is lost", JSON.stringify(groups[1]?.links) === JSON.stringify([{ platform: null, pathPrefix: "" }]), () =>
      JSON.stringify(groups[1]),
    );
  }
  check("a repository nobody linked groups to nothing", JSON.stringify(groupLinksByProject([])) === "[]");

  // ── ITEM 7a: resolveInstallationId — the STORED id as a fallback ─────────
  //
  // No test in either suite exercised the fallback. Deleting the
  // `rows.find(...)` clause left everything green, and the failure it hides is
  // the whole reason it exists: a repository wired to arkaik as a plain
  // repository webhook ALONGSIDE the App delivers payloads with no
  // `installation` object, so every path-scoped link on it would refuse — on
  // every one of those deliveries — with "this delivery carries no GitHub App
  // installation id".
  {
    const row = (installationId) => ({ installationId });
    check(
      "precondition: with an id in the payload, that is the one used",
      resolveInstallationId({ installationId: "111" }, [row("999")]) === "111",
      () => JSON.stringify(resolveInstallationId({ installationId: "111" }, [row("999")])),
    );
    check(
      "a delivery carrying NO installation id falls back to the one stored on the link",
      resolveInstallationId({ installationId: null }, [row("999")]) === "999",
      () => JSON.stringify(resolveInstallationId({ installationId: null }, [row("999")])),
    );
    check(
      "…scanning past links that have none, because only one project may have seen an App delivery",
      resolveInstallationId({ installationId: null }, [row(null), row(null), row("777")]) === "777",
      () =>
        JSON.stringify(resolveInstallationId({ installationId: null }, [row(null), row(null), row("777")])),
    );
    check(
      "…and answering null when neither the payload nor any link has one",
      resolveInstallationId({ installationId: null }, [row(null)]) === null,
      () => JSON.stringify(resolveInstallationId({ installationId: null }, [row(null)])),
    );
    check(
      "…and null when there are no links at all, rather than undefined",
      resolveInstallationId({ installationId: null }, []) === null,
      () => JSON.stringify(resolveInstallationId({ installationId: null }, [])),
    );
  }

  // ── needsChangedFiles: when the network is touched at all ────────────────
  {
    const bare = { title: "t", body: "Fixes AC-x" };
    check(
      "a deployment with only whole-repository links NEVER needs the changed files",
      needsChangedFiles(bare, [ALL_LINK]) === false,
      () => "an all-'' link set asked for a fetch",
    );
    check(
      "precondition: the same mention DOES need them once a link is path-scoped",
      needsChangedFiles(bare, [IOS_LINK, ALL_LINK]) === true,
    );
    check(
      "a pull request mentioning no acceptance needs nothing, monorepo or not",
      needsChangedFiles({ title: "chore: bump deps", body: "" }, [IOS_LINK, WEB_LINK]) === false,
    );
    // AN EXPLICIT `@platform` STILL NEEDS THE CHANGED FILES, even though it
    // decides the scope on its own. Not for DECIDING — precedence settles that
    // without the path source — but for RECONCILING: the path matches are one
    // of the three sources whose union says which of this pull request's refs
    // are still justified, and a delivery that fetched nothing has an
    // incomplete view and so may remove nothing. That is exactly how a `web`
    // ref inferred from a path match in an earlier delivery survived every
    // later `AC-x@ios` delivery and stood there as a promotion `arkaik sync
    // --promote` fires out of band.
    check(
      "an explicit @platform still needs the changed files — the union that keeps refs justified needs them",
      needsChangedFiles({ title: "t", body: "Fixes AC-x@ios" }, [IOS_LINK, WEB_LINK]) === true,
      () => "an explicit mention skipped the fetch, so this delivery could reconcile nothing",
    );
    check(
      "an @suffix that is not a platform takes the unknown-suffix refusal, not the path source",
      needsChangedFiles({ title: "t", body: "Fixes AC-x@ios-tablet" }, [IOS_LINK, WEB_LINK]) === false,
    );
    check(
      "…and that refusal is what makes it need nothing: it resolves no scope, so it reconciles nothing",
      needsChangedFiles({ title: "t", body: "Fixes AC-x@ios-tablet" }, [IOS_LINK, ALL_LINK]) === false,
      () => "an id whose only suffix was unusable asked for a fetch",
    );
    check(
      "an explicit mention ABSORBS the bare one of the same id — one fetch, for the union, either way",
      needsChangedFiles({ title: "AC-x: checkout", body: "Fixes AC-x@ios" }, [IOS_LINK, WEB_LINK]) === true,
      "AC-x appears bare in the title and explicit in the body",
    );
    check(
      "the whole-repository short-circuit still comes FIRST: an explicit mention there fetches nothing",
      needsChangedFiles({ title: "t", body: "Fixes AC-x@ios" }, [ALL_LINK]) === false,
      () => "a deployment with no path-scoped link at all was made to call GitHub back",
    );
    check(
      "but ONE bare id beside an explicit OTHER id does need them — the case a naive rule misses",
      needsChangedFiles({ title: "t", body: "Fixes AC-a@ios and AC-b" }, [IOS_LINK, WEB_LINK]) === true,
      "AC-b is bare and nothing else decides it",
    );
  }
  {
    // "PATH-SCOPED" IS DECIDED AFTER NORMALISATION, and `"."` is the value that
    // makes the difference visible. It names the directory it sits in, so it IS
    // the whole repository — and migration 010's CHECK stores it happily (no
    // leading or trailing slash, no empty segment, no edge whitespace), so it is
    // a reachable row rather than a hypothetical one. The tempting
    // `link.pathPrefix !== ""` would make such a link demand a GitHub App
    // private key and an API call on every delivery, on a deployment whose
    // configuration contains no path at all — and then refuse, because the
    // resolver normalises and finds nothing scoped.
    const bare = { title: "t", body: "Fixes AC-x" };
    const DOT_LINK = { platform: "ios", pathPrefix: "." };
    check(
      "precondition: this exact mention DOES need the changed files when a link is really scoped",
      needsChangedFiles(bare, [IOS_LINK]) === true,
      "otherwise the assertion below passes for the wrong reason",
    );
    const asWhole = resolveRepoScope([DOT_LINK], {
      kind: "files",
      paths: ["apps/ios/A.swift"],
      incomplete: [],
    });
    check(
      "precondition: a '.' prefix normalises to the WHOLE repository, not to a subtree",
      asWhole.kind === "links" &&
        JSON.stringify(asWhole.pathPrefixes) === "[]" &&
        asWhole.linkPlatform === "ios",
      () => JSON.stringify(asWhole),
    );
    check(
      "…so a '.'-prefixed link never asks for the changed files either",
      needsChangedFiles(bare, [DOT_LINK]) === false,
      () => "a '.' prefix was read as path-scoped and forced a fetch",
    );
  }

  // ── resolveRepoScope: rules (0) and (a)–(e), and (c)'s exception ─────────
  {
    const scope = resolveRepoScope([ALL_LINK], { kind: "files", paths: ["x.ts"], incomplete: [] });
    check(
      "(a) with no path-scoped link, the evidence is not consulted at all",
      scope.kind === "links" && scope.linkPlatform === null && scope.pathPrefixes.length === 0,
      () => JSON.stringify(scope),
    );
  }
  {
    // The sibling-project case: one project on a repository being unresolvable
    // must not disturb another whose links are all whole-repository.
    const unaffected = resolveRepoScope([{ platform: "ios", pathPrefix: "" }], {
      kind: "unavailable",
      reason: "GITHUB_APP_PRIVATE_KEY is not set",
    });
    check(
      "(a) …not even when the delivery's fetch failed for a SIBLING project",
      unaffected.kind === "links" && unaffected.linkPlatform === "ios",
      () => JSON.stringify(unaffected),
    );
  }
  {
    const scope = pathScope([IOS_LINK, WEB_LINK, ALL_LINK], ["apps/ios/Checkout.swift"]);
    check(
      "(c) a match contributes its platform",
      scope.kind === "links" && JSON.stringify(scope.pathPlatforms) === '["ios"]',
      () => JSON.stringify(scope),
    );
    check(
      "…and names the prefix, so a report can say which link to edit",
      scope.kind === "links" && JSON.stringify(scope.pathPrefixes) === '["apps/ios"]',
      () => JSON.stringify(scope),
    );
  }
  {
    const scope = pathScope([IOS_LINK, WEB_LINK, ANDROID_LINK], [
      "apps/ios/A.swift",
      "apps/webapp/b.tsx",
    ]);
    check(
      "(c) a pull request across two subtrees contributes both platforms",
      scope.kind === "links" && JSON.stringify(scope.pathPlatforms) === '["ios","web"]',
      () => JSON.stringify(scope),
    );
  }
  {
    // THE SEGMENT-BOUNDARY CASE, at the level that decides a delivery. The
    // fixture holds both halves so a matcher that matches nothing cannot pass.
    const inside = pathScope([IOS_LINK], ["apps/ios/main.swift"]);
    const nearMiss = pathScope([IOS_LINK], ["apps/ios-legacy/main.swift"]);
    check(
      "precondition: a file genuinely under apps/ios resolves to ios",
      inside.kind === "links" && JSON.stringify(inside.pathPlatforms) === '["ios"]',
      () => JSON.stringify(inside),
    );
    check(
      "a link for apps/ios does NOT claim ios for apps/ios-legacy",
      nearMiss.kind === "no-platform" && nearMiss.reason === "outside-every-prefix",
      () => JSON.stringify(nearMiss),
    );
  }
  {
    const scope = pathScope([IOS_LINK, { platform: "web", pathPrefix: "" }], ["docs/readme.md"]);
    check(
      "(d) nothing matched, so the whole-repository link decides",
      scope.kind === "links" && scope.linkPlatform === "web" && scope.pathPlatforms.length === 0,
      () => JSON.stringify(scope),
    );
  }
  {
    const scope = pathScope([IOS_LINK, WEB_LINK], ["docs/readme.md"]);
    check(
      "(e) nothing matched and no fallback link exists, so the scope is REFUSED",
      scope.kind === "no-platform" && scope.reason === "outside-every-prefix",
      () => JSON.stringify(scope),
    );
    check(
      "…quoting every configured prefix, so a typo'd one is visible",
      scope.kind === "no-platform" && JSON.stringify(scope.prefixes) === '["apps/ios","apps/webapp"]',
      () => JSON.stringify(scope),
    );
  }
  {
    const scope = resolveRepoScope([IOS_LINK, { platform: null, pathPrefix: "" }], {
      kind: "unavailable",
      reason: "GITHUB_APP_PRIVATE_KEY is not set on this deployment",
    });
    check(
      "(b) unreadable changed files REFUSE — they do not borrow the whole-repository link",
      scope.kind === "no-platform" && scope.reason === "unavailable",
      () => JSON.stringify(scope),
    );
    check(
      "…carrying the reason verbatim, because it is the only channel the user reads",
      scope.kind === "no-platform" && (scope.cause ?? "").includes("GITHUB_APP_PRIVATE_KEY"),
      () => JSON.stringify(scope),
    );
    // ITEM 5: `detail` is spliced after "and", so it must be a CLAUSE — no
    // terminal full stop, or the consumer produces "…repository.. The plan".
    // The client's finished sentences travel in `cause` instead and are
    // appended whole. Asserted on the CONTRACT rather than on one rendering,
    // because every branch of `resolveRepoScope` shares the same consumer.
    check(
      "…while `detail` stays a clause: no terminal full stop for the warning to double up on",
      scope.kind === "no-platform" && /[^.]$/.test(scope.detail),
      () => JSON.stringify(scope.detail),
    );
    check(
      "…and the fallback link's platform is nowhere in the result",
      scope.kind === "no-platform",
      () => JSON.stringify(scope),
    );
  }
  {
    // AN INCOMPLETE LIST IS SAFE IN EXACTLY ONE DIRECTION. A missing file can
    // only remove a match, never invent one.
    const matched = pathScope([IOS_LINK, ALL_LINK], ["apps/ios/A.swift"], ["github-file-cap"]);
    check(
      "incomplete WITH a match proceeds — the platform found is real",
      matched.kind === "links" &&
        JSON.stringify(matched.pathPlatforms) === '["ios"]' &&
        JSON.stringify(matched.incomplete) === '["github-file-cap"]',
      () => JSON.stringify(matched),
    );
    const nothing = pathScope([IOS_LINK, { platform: "web", pathPrefix: "" }], ["docs/a.md"], ["github-file-cap"]);
    check(
      "incomplete WITHOUT a match refuses, and does NOT take rule (d)'s fallback",
      nothing.kind === "no-platform" && nothing.reason === "truncated-no-match",
      () => JSON.stringify(nothing),
    );
    check(
      "precondition: the very same links and files DO fall back when the list was complete",
      pathScope([IOS_LINK, { platform: "web", pathPrefix: "" }], ["docs/a.md"], []).linkPlatform === "web",
      () => JSON.stringify(pathScope([IOS_LINK, { platform: "web", pathPrefix: "" }], ["docs/a.md"], [])),
    );
  }
  {
    // ── ITEM 7c: RULE (c) WHEN THE ONLY MATCHING LINK NAMES NO PLATFORM ────
    //
    // "All platforms" on a shared directory MATCHES without contributing, which
    // suppresses rule (e) and lets precedence fall through. On a WHOLE list
    // that is honest — every file was read, and the ones that landed anywhere
    // landed in platform-less links. On a PARTIAL one it is not an answer at
    // all: the page arkaik never read is exactly where a file under `apps/ios`
    // would be, so falling through hands back the whole-repository link, or one
    // UNSCOPED ref, on the strength of pages nobody read.
    const SHARED_LINK = { platform: null, pathPrefix: "packages/shared" };
    const ANDROID_FALLBACK = { platform: "android", pathPrefix: "" };
    const files = ["packages/shared/util.ts"];

    const whole = pathScope([SHARED_LINK, IOS_LINK, ANDROID_FALLBACK], files, []);
    check(
      "(c) on a WHOLE list, a platform-less match still MATCHES and falls through to the link",
      whole.kind === "links" &&
        JSON.stringify(whole.pathPrefixes) === '["packages/shared"]' &&
        JSON.stringify(whole.pathPlatforms) === "[]" &&
        whole.linkPlatform === "android",
      () => JSON.stringify(whole),
    );
    const partial = pathScope([SHARED_LINK, IOS_LINK, ANDROID_FALLBACK], files, ["github-file-cap"]);
    check(
      "…and on a PARTIAL one it REFUSES instead, by its own reason",
      partial.kind === "no-platform" && partial.reason === "truncated-platformless-match",
      () => JSON.stringify(partial),
    );
    check(
      "…rather than borrowing the whole-repository link the complete case legitimately reaches",
      partial.kind === "no-platform" && !JSON.stringify(partial).includes("android"),
      () => JSON.stringify(partial),
    );
    check(
      "…naming the cause it observed and every configured prefix",
      partial.kind === "no-platform" &&
        partial.detail.includes("more files than GitHub will list") &&
        JSON.stringify(partial.prefixes) === '["apps/ios","packages/shared"]',
      () => JSON.stringify(partial),
    );
    check(
      "…while keeping `detail` a clause with no terminal full stop, like every other refusal",
      partial.kind === "no-platform" && /[^.]$/.test(partial.detail),
      () => JSON.stringify(partial.detail),
    );
    // AND IT IS NOT A BLANKET "PARTIAL LISTS REFUSE": a partial list in which a
    // platform-NAMING link matched still proceeds, because that match is real.
    const partialNamed = pathScope([SHARED_LINK, IOS_LINK], ["packages/shared/u.ts", "apps/ios/A.swift"], ["github-file-cap"]);
    check(
      "…and a partial list where a platform-NAMING link also matched still proceeds",
      partialNamed.kind === "links" && JSON.stringify(partialNamed.pathPlatforms) === '["ios"]',
      () => JSON.stringify(partialNamed),
    );
    // THE CONSUMER, so the refusal is not merely a shape: with no explicit
    // `@platform` this reaches CASE 2b and attaches nothing at all — instead of
    // the unscoped ref the fall-through would have written.
    const node = acceptance("AC-x", ["web", "ios"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), partial);
    check(
      "…and the planner attaches no ref for it, rather than an unscoped one",
      plan.ops.length === 0,
      () => JSON.stringify(plan.ops),
    );
    check(
      "…reporting why, since zero ops is otherwise indistinguishable from nothing matching",
      plan.warnings.find((w) => w.startsWith("AC-x:"))?.includes("name no platform") === true,
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    const matched = pathScope([IOS_LINK, ALL_LINK], ["apps/ios/A.swift"], ["github-file-cap"]);

    // ITEM 2: THE CAUSE TRAVELS WITH THE FLAG. Three unrelated things make a
    // list short, and this sentence used to assert GitHub's 3000-file cap for
    // all three — so a pull request of eleven files whose page read timed out
    // was told it "changes more files than GitHub will list". Asserted by
    // IDENTITY on each cause's own wording, and on the ABSENCE of the other
    // two, because "mentions the cap" would pass for a message that mentions
    // all three.
    const budget = pathScope([IOS_LINK], ["docs/a.md"], ["time-budget"]);
    check(
      "precondition: a time-budget list with no match refuses the same way a capped one does",
      budget.kind === "no-platform" && budget.reason === "truncated-no-match",
      () => JSON.stringify(budget),
    );
    check(
      "a time-budget refusal names the TIME BUDGET and does not claim GitHub's file cap",
      budget.kind === "no-platform" &&
        budget.detail.includes("ran out of the time budget") &&
        !budget.detail.includes("more files than GitHub will list"),
      () => JSON.stringify(budget.detail),
    );
    const unreadable = pathScope([IOS_LINK], ["docs/a.md"], ["unreadable-entry"]);
    check(
      "an unreadable-entry refusal names THAT, and does not claim GitHub's file cap either",
      unreadable.kind === "no-platform" &&
        unreadable.detail.includes("entries arkaik could not read") &&
        !unreadable.detail.includes("more files than GitHub will list"),
      () => JSON.stringify(unreadable.detail),
    );
    const capped = pathScope([IOS_LINK], ["docs/a.md"], ["github-file-cap"]);
    check(
      "…and the one that really IS the cap still says so",
      capped.kind === "no-platform" &&
        capped.detail.includes("more files than GitHub will list") &&
        !capped.detail.includes("time budget"),
      () => JSON.stringify(capped.detail),
    );
    // TWO CAUSES AT ONCE IS A REAL RUN, not a hypothetical: stopping at the cap
    // and dropping a malformed entry on an earlier page both hold. Reporting
    // one of them would be this round's defect one level down.
    const both = pathScope([IOS_LINK], ["docs/a.md"], ["github-file-cap", "unreadable-entry"]);
    check(
      "two observed causes are BOTH reported, not one chosen",
      both.kind === "no-platform" &&
        both.detail.includes("more files than GitHub will list") &&
        both.detail.includes("entries arkaik could not read"),
      () => JSON.stringify(both.detail),
    );
  }
  {
    // Nested links: adding a MORE SPECIFIC one must narrow the claim, never
    // widen it. Under "every link that matches" this would be ["ios","web"].
    const nested = [
      { platform: "web", pathPrefix: "apps" },
      { platform: "ios", pathPrefix: "apps/ios" },
    ];
    const scope = pathScope(nested, ["apps/ios/A.swift"]);
    check(
      "precondition: the outer link does contain the file as a string prefix",
      "apps/ios/A.swift".startsWith("apps"),
    );
    check(
      "nested links: the longest matching prefix wins",
      scope.kind === "links" && JSON.stringify(scope.pathPlatforms) === '["ios"]',
      () => JSON.stringify(scope),
    );
  }
  {
    const scope = resolveRepoScope([IOS_LINK, ALL_LINK], { kind: "not-needed" });
    check(
      "a path-scoped link set that was never consulted REFUSES rather than falling back",
      scope.kind === "no-platform" && scope.reason === "not-consulted",
      () => JSON.stringify(scope),
    );
  }
  {
    // A stored prefix that skipped normalisation — hand-edited, or restored from
    // elsewhere — must still match, not become a link with no symptom.
    const scope = pathScope([{ platform: "ios", pathPrefix: "/apps/ios/" }], ["apps/ios/A.swift"]);
    check(
      "a denormalised stored prefix is normalised on read too",
      scope.kind === "links" && JSON.stringify(scope.pathPlatforms) === '["ios"]',
      () => JSON.stringify(scope),
    );
  }

  // ── (0) A STORED PREFIX THAT CANNOT BE NORMALISED AT ALL ─────────────────
  //
  // `linkRepo` refuses a `..` path, but it is not the only writer: a restore, a
  // hand-edited row or the next caller can put one there, and migration 010's
  // CHECK does not forbid `..` — `apps/../ios` satisfies all five of its
  // negative rules. This used to read `normalizePathPrefix(p) ?? ""`, and `""`
  // is not a neutral default: it is the value that MEANS the whole repository.
  // So the least trustworthy row in the table was silently promoted to the
  // strongest claim the configuration can make.
  const BAD_LINK = { platform: "ios", pathPrefix: "apps/../ios" };
  {
    const files = { kind: "files", paths: ["docs/readme.md"], incomplete: [] };
    // PRECONDITION, and the whole point of the fixture: with a WELL-FORMED
    // path-scoped link in its place, this same input resolves happily to the
    // whole-repository link's platform. So the refusal below is caused by the
    // bad prefix and by nothing else about the shape of the case.
    const healthy = resolveRepoScope([IOS_LINK, { platform: "web", pathPrefix: "" }], files);
    check(
      "precondition: with a well-formed prefix the same links resolve to the fallback's platform",
      healthy.kind === "links" && healthy.linkPlatform === "web",
      () => JSON.stringify(healthy),
    );

    const scope = resolveRepoScope([BAD_LINK, { platform: "web", pathPrefix: "" }], files);
    check(
      "an unnormalisable stored prefix REFUSES rather than becoming a whole-repository link",
      scope.kind === "no-platform" && scope.reason === "unusable-prefix",
      () => JSON.stringify(scope),
    );
    check(
      "…quoting the stored value, which is the only way the row can be found and fixed",
      scope.kind === "no-platform" && scope.detail.includes("apps/../ios"),
      () => JSON.stringify(scope),
    );
    check(
      "…and it does not borrow the sibling whole-repository link's platform",
      scope.kind === "no-platform",
      () => JSON.stringify(scope),
    );
  }
  {
    // ── ITEM 7d: THE RENDERED `prefixes` FOR A MIXED LINK SET ──────────────
    // `unusable-prefix` is the one refusal whose report exists to point at a
    // ROW, so its `prefixes` is built from the STORED values (including the
    // unreadable one) rather than from the normalised list — and the empty
    // whole-repository prefix is filtered out, because "" is not a path anyone
    // can go and look at.
    //
    // No test covered that array. Dropping `.filter((p) => p !== "")` left
    // every suite green while the delivery said `is linked by path
    // (apps/../ios, apps/ios, )` — a trailing empty entry in the one message
    // whose job is to name a row. Building it from `unusable` alone left the
    // suites green too, while hiding the sibling prefixes a typo lives in.
    const mixed = [
      { platform: "web", pathPrefix: "" },
      BAD_LINK,
      IOS_LINK,
    ];
    const scope = resolveRepoScope(mixed, { kind: "files", paths: ["docs/readme.md"], incomplete: [] });
    check(
      "precondition: this mixed link set really takes the unusable-prefix branch",
      scope.kind === "no-platform" && scope.reason === "unusable-prefix",
      () => JSON.stringify(scope),
    );
    check(
      "the reported prefixes are the STORED paths, unusable one included, whole-repository one excluded",
      scope.kind === "no-platform" && JSON.stringify(scope.prefixes) === '["apps/../ios","apps/ios"]',
      () => JSON.stringify(scope.prefixes),
    );
    // And through the consumer, because the array only matters as rendered
    // text: an empty entry shows up as a dangling ", )" nobody can act on.
    const node = acceptance("AC-x", ["web", "ios"]);
    const line = planForProject(bundle([node], true), event({ body: "AC-x" }), scope).warnings.find((w) =>
      w.startsWith("AC-x:"),
    );
    check(
      "…and the rendered warning lists both real paths",
      line?.includes("(apps/../ios, apps/ios)") === true,
      () => JSON.stringify(line),
    );
    check(
      "…with no empty entry left where the whole-repository link was",
      line?.includes(", )") !== true && line?.includes("(, ") !== true,
      () => JSON.stringify(line),
    );
  }
  {
    // THE WORSE HALF OF THE SAME `??`. With no sibling link at all, coercing to
    // `""` made `scoped` empty, so rule (a) fired — "this project has no
    // path-scoped links, behave as before slice 2" — and a bare mention then
    // resolved to case 4's UNSCOPED ref, moving the base status and marking
    // every platform of the acceptance shipped, from a row nobody can read.
    const scope = resolveRepoScope([BAD_LINK], {
      kind: "files",
      paths: ["apps/ios/A.swift"],
      incomplete: [],
    });
    check(
      "a link whose ONLY prefix is unnormalisable does not fall through to rule (a)",
      scope.kind === "no-platform" && scope.reason === "unusable-prefix",
      () => JSON.stringify(scope),
    );

    const node = acceptance("AC-x", ["web", "ios"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), scope);
    const state = settle(node, plan.ops);
    check(
      "so the planner attaches no ref for it at all",
      plan.ops.find((o) => o.node_id === "AC-x") === undefined,
      () => JSON.stringify(plan.ops),
    );
    check(
      "…and above all no UNSCOPED one, which would move the base status and claim every platform",
      refsOf(state).find((r) => r.url === PR_URL) === undefined && state.status === "backlog",
      () => JSON.stringify({ refs: refsOf(state), status: state.status }),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-x:"));
    check("the refusal is reported", line !== undefined, () => JSON.stringify(plan.warnings));
    check(
      "…naming the unusable path, so the report points at the row rather than at the pull request",
      line?.includes("apps/../ios") === true,
      () => JSON.stringify(line),
    );
  }

  // ── planForProject with a path-derived scope ─────────────────────────────
  {
    const node = acceptance("AC-x", ["web", "ios"]);
    const scope = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/Checkout.swift"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), scope);
    const state = settle(node, plan.ops);
    check(
      "precondition: the scope really did resolve to ios",
      scope.kind === "links" && JSON.stringify(scope.pathPlatforms) === '["ios"]',
      () => JSON.stringify(scope),
    );
    check(
      "a bare mention takes the PATH-derived platform",
      refFor(state, "ios") !== undefined,
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…with the per-platform ref id, and no unscoped ref beside it",
      refFor(state, "ios")?.id === "gh-pr-42-ios" && refFor(state, null) === undefined,
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "and ONLY that platform is promoted — the base status does not move",
      state.metadata?.platformStatuses?.ios === "live" &&
        state.metadata?.platformStatuses?.web === undefined &&
        state.status === "backlog",
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
  }

  // ── FREEZING: A PATH-INFERRED REF MUST NOT OUTLIVE ITS FILES ─────────────
  //
  // Path evidence is a property of the DELIVERY, not of the pull request: the
  // files a pull request changes are edited by the author between deliveries.
  // A ref written because delivery 1 saw `apps/webapp/pay.tsx` is justified by
  // nothing once those commits are dropped — but it is still on the node, and
  // under a "mirror everything for this url" rule it is still refreshed to
  // "merged" and still promoted. Web goes live for a pull request that does not
  // touch the web app.
  //
  // The answer is FREEZING, not removal: such a ref is left exactly as it is —
  // not refreshed, not promoted, not deleted. So these assertions are about
  // what did NOT change on the ref, which is a stronger and narrower claim than
  // "it is gone".
  //
  // These are TWO-DELIVERY sequences because a single delivery cannot reach the
  // bug at all, which is exactly how it survived the first round.
  {
    const node = acceptance("AC-pay", ["web", "ios"]);
    const opened = event({ action: "opened", body: "AC-pay", merged: false, state: "open" });
    const both = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/Pay.swift", "apps/webapp/pay.tsx"]);
    check(
      "precondition: delivery 1's scope really is both platforms",
      both.kind === "links" && JSON.stringify(both.pathPlatforms) === '["ios","web"]',
      () => JSON.stringify(both),
    );
    const afterOpen = settle(node, planForProject(bundle([node], true), opened, both).ops);
    check(
      "precondition: delivery 1 wrote a ref for EACH matched platform",
      refFor(afterOpen, "ios") !== undefined && refFor(afterOpen, "web") !== undefined,
      () => JSON.stringify(refsOf(afterOpen)),
    );
    // ITEM 7f's fixture: the exact bytes delivery 1 left on the web ref, so the
    // freeze can be asserted as "these two fields did not move" rather than as
    // "it was not promoted", which a dozen other bugs also satisfy.
    const webBefore = refFor(afterOpen, "web");
    check(
      "precondition: that ref carries a mirrored status and a synced_at to freeze",
      webBefore?.external_status === "open" && typeof webBefore?.synced_at === "string",
      () => JSON.stringify(webBefore),
    );

    // THE NON-VACUITY GUARD, and the reason this block is not asserting that
    // nothing ever happens: mirrored to "merged" and left attached, the web ref
    // IS promotable by the real `computeRefPromotions`. A stale one would really
    // move web to live — and `arkaik sync --promote` would fire it later even if
    // this delivery's `touched` filter held it back, because that command runs
    // the same plan with no per-delivery filter at all. Freezing is what keeps
    // the ref from ever REACHING "merged" in the first place.
    const mirroredBoth = {
      ...afterOpen,
      metadata: {
        ...afterOpen.metadata,
        refs: refsOf(afterOpen).map((r) => (r.url === PR_URL ? { ...r, external_status: "merged" } : r)),
      },
    };
    check(
      "precondition: refreshed to merged, the web ref IS promotable — a thawed one would show",
      computeRefPromotions(bundle([mirroredBoth], true)).promotions.some(
        (p) => p.node_id === "AC-pay" && p.platform === "web" && p.to === "live",
      ),
      () => JSON.stringify(computeRefPromotions(bundle([mirroredBoth], true))),
    );

    // Delivery 2: the author dropped the webapp commits, and the PR merged.
    const iosOnly = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/Pay.swift"]);
    check(
      "precondition: delivery 2's scope really is ios alone",
      iosOnly.kind === "links" && JSON.stringify(iosOnly.pathPlatforms) === '["ios"]',
      () => JSON.stringify(iosOnly),
    );
    const plan = planForProject(bundle([afterOpen], true), event({ body: "AC-pay" }), iosOnly);
    const state = settle(afterOpen, plan.ops);

    // ── ITEM 7f: THE FREEZE ITSELF, FIELD BY FIELD ─────────────────────────
    check(
      "the ref whose files are gone is still attached — freezing is not deletion",
      refFor(state, "web")?.id === "gh-pr-42-web",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…and its external_status did NOT move to merged, which is what stops it going live",
      refFor(state, "web")?.external_status === "open",
      () => JSON.stringify(refFor(state, "web")),
    );
    check(
      "…and its synced_at is byte-identical to what the last honest delivery wrote",
      refFor(state, "web")?.synced_at === webBefore?.synced_at,
      () => `${JSON.stringify(refFor(state, "web")?.synced_at)} vs ${JSON.stringify(webBefore?.synced_at)}`,
    );
    check(
      "…while the one the files still justify IS refreshed and keeps its id",
      refFor(state, "ios")?.external_status === "merged" && refFor(state, "ios")?.id === "gh-pr-42-ios",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "precondition: delivery 1 (the PR was OPEN) had already moved web to development",
      afterOpen.metadata?.platformStatuses?.web === "development",
      () => JSON.stringify(afterOpen.metadata?.platformStatuses),
    );
    check(
      "…so the merge promotes ios to live and leaves web exactly where it was",
      state.metadata?.platformStatuses?.ios === "live" &&
        state.metadata?.platformStatuses?.web === "development",
      () => JSON.stringify(state.metadata?.platformStatuses),
    );
    check(
      "…and the base status still does not move",
      state.status === "backlog",
      () => JSON.stringify({ status: state.status }),
    );
    // THE PROJECTION THE WHOLE FEATURE EXISTS FOR, asserted with the real
    // `hasParityGap` rather than a re-implementation of it: iOS shipped, web did
    // not, and `/acceptances` says so. Promoting from the stale ref would make
    // both platforms delivered, delivered === resolved, and the gap DISAPPEAR —
    // deleting the one thing this feature is for, silently.
    check(
      "…so the parity gap this pull request actually left is still reported",
      hasParityGap(state) === true &&
        resolvePlatformStatus(state, "ios") === "live" &&
        resolvePlatformStatus(state, "web") !== "live",
      () =>
        JSON.stringify({
          gap: hasParityGap(state),
          ios: resolvePlatformStatus(state, "ios"),
          web: resolvePlatformStatus(state, "web"),
        }),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-pay:"));
    check("the freeze is reported, not silent", line !== undefined, () => JSON.stringify(plan.warnings));
    check(
      "…naming the scope that stopped moving, and saying FREEZES rather than removes",
      line?.includes("web") === true && line?.includes("FREEZES it") === true,
      () => JSON.stringify(line),
    );
    check(
      "…and saying plainly that the ref is NOT removed, so nobody reads this as a deletion",
      line?.includes("NOT removed") === true && line?.includes("REMOVES it") !== true,
      () => JSON.stringify(line),
    );
    check(
      "…and naming the sources it checked, since the rule is their UNION",
      line?.includes("@platform") === true &&
        line?.includes("path-scoped repository links") === true &&
        line?.includes("repository link") === true,
      () => JSON.stringify(line),
    );

    // IDEMPOTENCE, and it is a DIFFERENT property from removal's. "synchronize",
    // "reopened" and "edited" are all in the webhook's HANDLED_ACTIONS, so a
    // third delivery of this pull request is routine. A frozen ref stays
    // unjustified, so the report repeats — that is honest, and costs nothing.
    //
    // ASSERTED AS TWO PROPERTIES, because "byte-identical" is one property too
    // strong and the strong half is false BY DESIGN. `diffRefs`
    // (packages/schema/src/derive.ts) keys on ref ID ALONE — it emits
    // `ref.added`/`ref.removed` and nothing whatever for a changed field — so
    // the churn this block exists to prevent is a change to the ID SET. A
    // MIRRORED ref's `synced_at` advances on every delivery; that is the mirror
    // doing its job, and it derives no event. Asserting byte-identity across the
    // whole set made this test depend on two `new Date()` calls landing in the
    // same millisecond: green on a laptop, red in CI the moment they straddle a
    // tick.
    const third = planForProject(bundle([state], true), event({ body: "AC-pay" }), iosOnly);
    const settled = settle(state, third.ops);
    check(
      "a redelivery leaves the ref ID SET unchanged, so it derives no ref.added/ref.removed",
      JSON.stringify(refsOf(settled).map((r) => r.id).sort()) ===
        JSON.stringify(refsOf(state).map((r) => r.id).sort()),
      () =>
        `${JSON.stringify(refsOf(settled).map((r) => r.id))} vs ${JSON.stringify(refsOf(state).map((r) => r.id))}`,
    );
    {
      // The freeze itself, where byte-identity IS the property: a frozen ref is
      // not written at all, so even its timestamp must be untouched.
      const before = refsOf(state).find((r) => r.platform === "web");
      const after = refsOf(settled).find((r) => r.platform === "web");
      check(
        "precondition: the frozen web ref is present on both sides",
        before !== undefined && after !== undefined,
        () => `${JSON.stringify(before)} vs ${JSON.stringify(after)}`,
      );
      check(
        "…and the FROZEN ref is byte-identical, synced_at included — it is not written at all",
        JSON.stringify(after) === JSON.stringify(before),
        () => `${JSON.stringify(after)} vs ${JSON.stringify(before)}`,
      );
      const mirroredBefore = refsOf(state).find((r) => r.platform === "ios");
      const mirroredAfter = refsOf(settled).find((r) => r.platform === "ios");
      check(
        "…while the mirrored ref keeps its external_status, which is what a redelivery must not disturb",
        mirroredBefore !== undefined &&
          mirroredAfter?.external_status === mirroredBefore.external_status,
        () => `${JSON.stringify(mirroredAfter)} vs ${JSON.stringify(mirroredBefore)}`,
      );
    }
    check(
      "…and still says so, because a frozen ref is still frozen on the next delivery",
      third.warnings.find((w) => w.startsWith("AC-pay:"))?.includes("FREEZES it") === true,
      () => JSON.stringify(third.warnings),
    );
  }
  {
    // ── AN EXPLICIT NARROWING FREEZES A STALE INFERRED REF ─────────────────
    //
    // The bug this pins: the rule used to key off WHICH SOURCE DECIDED, and a
    // mention decided alone. So path evidence minted `gh-pr-42-web`, the author
    // later wrote `AC-x@ios`, the MENTION then decided, nothing else was
    // considered — and the web ref was refreshed to "merged", stayed in
    // `touched`, and PROMOTED web for a pull request that no longer touches the
    // web app.
    //
    // Under the union rule the deciding source is irrelevant: web keeps moving
    // only if some source still names it, and here none does.
    const before = ghRef({ id: "gh-pr-42-web", platform: "web", synced_at: "2026-01-01T00:00:00.000Z" });
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [before] } });
    const iosOnly = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift"]);
    check(
      "precondition: the path evidence resolves to ios alone and names web nowhere",
      iosOnly.kind === "links" &&
        JSON.stringify(iosOnly.pathPlatforms) === '["ios"]' &&
        iosOnly.linkPlatform === null &&
        JSON.stringify(iosOnly.incomplete) === "[]",
      () => JSON.stringify(iosOnly),
    );
    const plan = planForProject(bundle([node], true), event({ body: "AC-x@ios" }), iosOnly);
    const state = settle(node, plan.ops);
    check(
      "precondition: the mention's own scope really was written (so the checks below are not vacuous)",
      refFor(state, "ios") !== undefined,
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "an explicit narrowing FREEZES the stale inferred ref no source justifies any more",
      JSON.stringify(refFor(state, "web")) === JSON.stringify(before),
      () => `${JSON.stringify(refFor(state, "web"))} vs ${JSON.stringify(before)}`,
    );
    check(
      "…so nothing promotes web, which is the claim the refreshed ref used to make",
      state.metadata?.platformStatuses?.web === undefined &&
        state.metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify(state.metadata?.platformStatuses),
    );
    check(
      "…and the parity gap the pull request actually left is reported rather than erased",
      hasParityGap(state) === true && resolvePlatformStatus(state, "web") !== "live",
      () => JSON.stringify({ gap: hasParityGap(state), web: resolvePlatformStatus(state, "web") }),
    );
    check(
      "…and the freeze is reported, because a ref that silently stops updating is a lie",
      plan.warnings.find((w) => w.startsWith("AC-x:"))?.includes("web") === true,
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // ── THE HALF THAT MUST NOT FREEZE ──────────────────────────────────────
    // The same explicit narrowing, but the path evidence STILL names web. The
    // rule is a union, not "the mention wins and everything else stops": a
    // source that still speaks still justifies. Without this, the assertion
    // above would also pass for a rule that freezes every ref the mention does
    // not name, which is a different and much more destructive rule.
    const node = acceptance("AC-x", ["web", "ios"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42-web", platform: "web" })] },
    });
    const both = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift", "apps/webapp/a.ts"]);
    check(
      "precondition: the path source names BOTH platforms on this delivery",
      both.kind === "links" && JSON.stringify(both.pathPlatforms) === '["ios","web"]',
      () => JSON.stringify(both),
    );
    const plan = planForProject(bundle([node], true), event({ body: "AC-x@ios" }), both);
    const state = settle(node, plan.ops);
    check(
      "a ref the path evidence still covers KEEPS MOVING under a mention that names something else",
      refFor(state, "web")?.id === "gh-pr-42-web" && refFor(state, "web")?.external_status === "merged",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…and nothing is reported, because nothing stopped",
      plan.warnings.find((w) => w.startsWith("AC-x:")) === undefined,
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // ── A REF AN AUTHOR NAMED BY HAND IS NOT SPECIAL, AND THE CODE SAYS SO ─
    //
    // An older comment promised the opposite ("a ref the AUTHOR named is never
    // reconciled away") and the code deleted such refs anyway — the claim and
    // the behaviour disagreed. A `Ref` records no provenance, so the promise was
    // never keepable: `gh-pr-42-web` written from `AC-x@web` in an earlier
    // delivery is byte-identical to one inferred from a path match.
    //
    // The rule chosen instead is honest about it: editing the pull request is
    // how a scope is WITHDRAWN from this delivery's reach as well as how it is
    // added. This test pins the withdrawal, so nobody can restore the
    // comforting sentence without a red suite.
    const before = ghRef({ id: "gh-pr-42-web", platform: "web", synced_at: "2026-01-01T00:00:00.000Z" });
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [before] } });
    const iosOnly = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift"]);
    // The body no longer says `@web`. It says nothing about platform at all, so
    // the path source decides.
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), iosOnly);
    const state = settle(node, plan.ops);
    check(
      "a hand-written @platform edited out of the body FREEZES once nothing else justifies it",
      JSON.stringify(refFor(state, "web")) === JSON.stringify(before) && refFor(state, "ios") !== undefined,
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…and the report does not claim it was an inference — it names the sources, not a provenance",
      plan.warnings.find((w) => w.startsWith("AC-x:"))?.includes("current title or body") === true,
      () => JSON.stringify(plan.warnings),
    );
    // AND IT THAWS, which is what makes the rule liveable: "edited" is in the
    // webhook's HANDLED_ACTIONS, so putting `@web` back re-delivers, and the
    // very next delivery mirrors the ref again rather than leaving it stuck.
    const restored = settle(state, planForProject(bundle([state], true), event({ body: "AC-x@web" }), iosOnly).ops);
    check(
      "…and writing @web back into the body starts it moving again on the next delivery",
      refFor(restored, "web")?.external_status === "merged" &&
        refFor(restored, "web")?.synced_at !== before.synced_at,
      () => JSON.stringify(refsOf(restored)),
    );
  }
  {
    // ── ITEM 7b: THE INCOMPLETE-EVIDENCE BRANCH, BOTH DIRECTIONS ───────────
    //
    // An explicit `@platform` mention and a pre-existing ref for a DIFFERENT
    // platform, run twice: once where the delivery read the whole file list,
    // once where it could not read it at all. The first freezes; the second
    // must change nothing whatsoever, because a delivery that could not see
    // cannot tell a withdrawn scope from an unread page — and narrowing on
    // non-evidence is the failure this branch exists to prevent.
    const before = ghRef({ id: "gh-pr-42-web", platform: "web", synced_at: "2026-01-01T00:00:00.000Z" });
    const withWebRef = () =>
      acceptance("AC-x", ["web", "ios"], { metadata: { refs: [{ ...before }] } });
    const body = event({ body: "AC-x@ios" });

    // DIRECTION 1 — a whole list.
    const whole = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift"]);
    check(
      "precondition: direction 1's evidence really is complete",
      whole.kind === "links" && JSON.stringify(whole.incomplete) === "[]",
      () => JSON.stringify(whole),
    );
    const frozen = settle(withWebRef(), planForProject(bundle([withWebRef()], true), body, whole).ops);
    check(
      "with a WHOLE list, the ref for the unnamed platform freezes",
      JSON.stringify(refFor(frozen, "web")) === JSON.stringify(before),
      () => JSON.stringify(refsOf(frozen)),
    );
    check(
      "…and web is not promoted",
      frozen.metadata?.platformStatuses?.web === undefined &&
        frozen.metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify(frozen.metadata?.platformStatuses),
    );

    // DIRECTION 2 — the file list could not be read AT ALL. `unavailable`, not
    // a truncated one: the App is unconfigured, which is the commonest way this
    // happens and the one that reaches `planForProject` as a REFUSED scope
    // rather than as a `links` scope with a non-empty `incomplete`.
    const blind = resolveRepoScope([IOS_LINK, WEB_LINK], {
      kind: "unavailable",
      reason: "GITHUB_APP_PRIVATE_KEY is not set",
    });
    check(
      "precondition: direction 2's evidence really is unreadable",
      blind.kind === "no-platform" && blind.reason === "unavailable",
      () => JSON.stringify(blind),
    );
    const plan = planForProject(bundle([withWebRef()], true), body, blind);
    const kept = settle(withWebRef(), plan.ops);
    check(
      "precondition: the explicit mention is still honoured, so this is not a vacuous no-op",
      refFor(kept, "ios") !== undefined && kept.metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify(kept.metadata),
    );
    check(
      "with an UNREADABLE list, nothing freezes — the ref is mirrored exactly as before this slice",
      refFor(kept, "web")?.external_status === "merged" &&
        refFor(kept, "web")?.synced_at !== before.synced_at,
      () => JSON.stringify(refsOf(kept)),
    );
    check(
      "…and it is promoted from, exactly as it would have been before path-scoped links existed",
      kept.metadata?.platformStatuses?.web === "live",
      () => JSON.stringify(kept.metadata?.platformStatuses),
    );
    check(
      "…and nothing is reported about a freeze that did not happen",
      plan.warnings.find((w) => w.includes("FREEZES")) === undefined,
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // The truncated variant of the same rule: a PARTIAL list (`incomplete`
    // non-empty on a `links` scope) narrows nothing either. A partial list can
    // prove a platform PRESENT and never ABSENT, so freezing on one would be
    // narrowing on non-evidence.
    const before = ghRef({ id: "gh-pr-42-web", platform: "web", synced_at: "2026-01-01T00:00:00.000Z" });
    const node = () => acceptance("AC-x", ["web", "ios"], { metadata: { refs: [{ ...before }] } });
    const partial = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift"], ["time-budget"]);
    check(
      "precondition: the very same links and files DO freeze the web ref when the list is whole",
      refFor(
        settle(
          node(),
          planForProject(bundle([node()], true), event({ body: "AC-x" }), pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift"])).ops,
        ),
        "web",
      )?.external_status === "open",
      () => "the complete-list case did not freeze, so the assertion below proves nothing",
    );
    const plan = planForProject(bundle([node()], true), event({ body: "AC-x" }), partial);
    const state = settle(node(), plan.ops);
    check(
      "a partial file list freezes NOTHING — 'absent' is not something a partial list can show",
      refFor(state, "web")?.external_status === "merged",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…and the ref keeps promoting too: incomplete evidence must not narrow anything",
      state.metadata?.platformStatuses?.web === "live" &&
        state.metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify(state.metadata?.platformStatuses),
    );
    check(
      "…and the delivery says its match was made against a partial list",
      plan.warnings.some(
        (w) => w.includes("ran out of the time budget") && w.includes("Nothing is frozen from a partial list"),
      ),
      () => JSON.stringify(plan.warnings),
    );
    check(
      "…naming the cause it observed, not GitHub's 3000-file cap",
      plan.warnings.every((w) => !w.includes("more files than GitHub will list")),
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // AN UNSCOPED REF BESIDE A SCOPED ANSWER. It moves the BASE status, which
    // resolves every platform without an entry of its own — the largest claim
    // in the system, sitting next to the narrow one the delivery just made. It
    // is FROZEN like any other unjustified ref: not refreshed to "merged", so
    // this delivery cannot turn it into a standing base-status promotion.
    //
    // The honest limit, which this also pins: it is NOT removed, so it is still
    // on the node afterwards.
    const before = ghRef({ id: "gh-pr-42", synced_at: "2026-01-01T00:00:00.000Z" });
    const node = acceptance("AC-x", ["web", "ios"], { metadata: { refs: [before] } });
    const iosOnly = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), iosOnly);
    const state = settle(node, plan.ops);
    check(
      "precondition: this delivery really did answer with a scoped ref",
      refFor(state, "ios") !== undefined,
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "an unscoped ref beside a scoped answer freezes rather than being refreshed",
      JSON.stringify(refFor(state, null)) === JSON.stringify(before),
      () => `${JSON.stringify(refFor(state, null))} vs ${JSON.stringify(before)}`,
    );
    check(
      "…so the base status does not move and no platform is claimed by inheritance",
      state.status === "backlog" && state.metadata?.platformStatuses?.web === undefined,
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    check(
      "…and the report names it as 'no platform' and says it was not removed",
      plan.warnings.find((w) => w.startsWith("AC-x:"))?.includes("no platform") === true &&
        plan.warnings.find((w) => w.startsWith("AC-x:"))?.includes("NOT removed") === true,
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // ── ITEM 7a: THE PER-NODE KEY OF THE JUSTIFICATION LOGIC ───────────────
    //
    // TWO nodes, each carrying an identical unjustified ref for this pull
    // request, and the body mentions only ONE of them. `freezes` and
    // `justified` are computed per node, so only the mentioned one may freeze;
    // the other has no source speaking about it at all and must keep being
    // mirrored and promoted from. A lookup that ignored its key — four of those
    // have existed in this file — would freeze both, and every single-node
    // fixture in this suite would stay green.
    const before = ghRef({ id: "gh-pr-42-web", platform: "web", synced_at: "2026-01-01T00:00:00.000Z" });
    const nodeA = acceptance("AC-a", ["web", "ios"], { metadata: { refs: [{ ...before }] } });
    const nodeB = acceptance("AC-b", ["web", "ios"], { metadata: { refs: [{ ...before }] } });
    check(
      "precondition: the two nodes start with byte-identical refs",
      JSON.stringify(refsOf(nodeA)) === JSON.stringify(refsOf(nodeB)),
      () => `${JSON.stringify(refsOf(nodeA))} vs ${JSON.stringify(refsOf(nodeB))}`,
    );
    const iosOnly = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift"]);
    const plan = planForProject(bundle([nodeA, nodeB], true), event({ body: "Fixes AC-a" }), iosOnly);
    const stateA = settle(nodeA, plan.ops);
    const stateB = settle(nodeB, plan.ops);
    check(
      "precondition: the mentioned node really was planned for",
      refFor(stateA, "ios") !== undefined,
      () => JSON.stringify(refsOf(stateA)),
    );
    check(
      "only the MENTIONED node's unjustified ref freezes",
      JSON.stringify(refFor(stateA, "web")) === JSON.stringify(before),
      () => JSON.stringify(refsOf(stateA)),
    );
    check(
      "…while the unmentioned node's identical ref keeps being mirrored",
      refFor(stateB, "web")?.external_status === "merged" &&
        refFor(stateB, "web")?.synced_at !== before.synced_at,
      () => JSON.stringify(refsOf(stateB)),
    );
    check(
      "…and keeps promoting, because a body edit must not undo a promotion that landed",
      stateB.metadata?.platformStatuses?.web === "live" &&
        stateA.metadata?.platformStatuses?.web === undefined,
      () => JSON.stringify([stateA.metadata?.platformStatuses, stateB.metadata?.platformStatuses]),
    );
    check(
      "…and only the mentioned node is reported about",
      plan.warnings.some((w) => w.startsWith("AC-a:")) &&
        plan.warnings.every((w) => !w.startsWith("AC-b:")),
      () => JSON.stringify(plan.warnings),
    );
  }
  {
    // ── ITEM 7d: THE REPOSITORY-LINK MEMBER OF THE UNION ───────────────────
    //
    // The whole-repository link means "anything I did not scope is this". Once
    // a path-scoped link has MATCHED, the files were scoped — so the fallback
    // says nothing about them, and `resolveRepoScope` does not reach for it
    // (rule (d) only fires when nothing matched). It was nonetheless in the
    // justification union unconditionally, which let it keep a stale `android`
    // ref moving on a delivery whose files this code had positively read as
    // landing under `apps/webapp`. Positive evidence overruled by a fallback
    // about files that were not fallen back on.
    const before = ghRef({ id: "gh-pr-42-android", platform: "android", synced_at: "2026-01-01T00:00:00.000Z" });
    const node = () =>
      acceptance("AC-x", ["web", "ios", "android"], { metadata: { refs: [{ ...before }] } });
    const ANDROID_FALLBACK = { platform: "android", pathPrefix: "" };

    const matched = pathScope([IOS_LINK, WEB_LINK, ANDROID_FALLBACK], ["apps/webapp/a.ts"]);
    check(
      "precondition: a path link matched, and the fallback link still declares android",
      matched.kind === "links" &&
        JSON.stringify(matched.pathPrefixes) === '["apps/webapp"]' &&
        JSON.stringify(matched.pathPlatforms) === '["web"]' &&
        matched.linkPlatform === "android",
      () => JSON.stringify(matched),
    );
    const plan = planForProject(bundle([node()], true), event({ body: "AC-x" }), matched);
    const state = settle(node(), plan.ops);
    check(
      "precondition: the path source decided, so the delivery answered with a web ref",
      refFor(state, "web") !== undefined,
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "the whole-repository link does NOT justify a stale ref once a path link matched",
      JSON.stringify(refFor(state, "android")) === JSON.stringify(before),
      () => `${JSON.stringify(refFor(state, "android"))} vs ${JSON.stringify(before)}`,
    );
    check(
      "…so android is not promoted for a pull request whose files landed under apps/webapp",
      state.metadata?.platformStatuses?.android === undefined &&
        state.metadata?.platformStatuses?.web === "live",
      () => JSON.stringify(state.metadata?.platformStatuses),
    );
    check(
      "…and the report says why the fallback is silent instead of listing it as a source consulted",
      plan.warnings.find((w) => w.startsWith("AC-x:"))?.includes("a path-scoped link matched") === true,
      () => JSON.stringify(plan.warnings),
    );

    // THE OTHER DIRECTION, which is what stops the rule from becoming "the
    // repository link never justifies anything". With NO path link matching,
    // rule (d) really does reach for the fallback — so it is a live source, and
    // the very same ref keeps moving.
    const unmatched = pathScope([IOS_LINK, WEB_LINK, ANDROID_FALLBACK], ["README.md"]);
    check(
      "precondition: nothing matched, so rule (d) reaches for the whole-repository link",
      unmatched.kind === "links" &&
        JSON.stringify(unmatched.pathPrefixes) === "[]" &&
        unmatched.linkPlatform === "android",
      () => JSON.stringify(unmatched),
    );
    const fellBack = settle(node(), planForProject(bundle([node()], true), event({ body: "AC-x" }), unmatched).ops);
    check(
      "…and there the repository link DOES justify the ref, which keeps being mirrored",
      refFor(fellBack, "android")?.external_status === "merged" &&
        refFor(fellBack, "android")?.synced_at !== before.synced_at,
      () => JSON.stringify(refsOf(fellBack)),
    );
    check(
      "…and promoted from",
      fellBack.metadata?.platformStatuses?.android === "live",
      () => JSON.stringify(fellBack.metadata?.platformStatuses),
    );
  }
  {
    // ── ITEM 3: AN ID NAMED ONLY BY AN UNUSABLE SUFFIX ─────────────────────
    //
    // `AC-x@ios-tablet` and nothing else. The id never reaches `mentions`, so a
    // refusal gated on "this node was mentioned" never fired: the node was
    // reached only through the ref it already carried, and every ref this pull
    // request had left on it was mirrored to the merge and PROMOTED — the
    // repository link's platform claimed in answer to a typo. The refusal is a
    // property of the ID BEING NAMED, so it fires here exactly as it does when
    // a bare mention sits beside the typo.
    const node = acceptance("AC-x", ["web", "ios"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42-ios", platform: "ios" })] },
    });
    const mirrored = {
      ...node,
      metadata: { refs: [ghRef({ id: "gh-pr-42-ios", platform: "ios", external_status: "merged" })] },
    };
    check(
      "precondition: that ref IS promotable once mirrored, so a silent promotion would show",
      computeRefPromotions(bundle([mirrored], true)).promotions.some(
        (p) => p.node_id === "AC-x" && p.ref_id === "gh-pr-42-ios" && p.to === "live",
      ),
      () => JSON.stringify(computeRefPromotions(bundle([mirrored], true))),
    );
    const scope = wholeRepo("ios");
    check(
      "precondition: the repository link would otherwise have answered with ios",
      scope.kind === "links" && scope.linkPlatform === "ios",
      () => JSON.stringify(scope),
    );
    const plan = planForProject(bundle([node], true), event({ body: "Fixes AC-x@ios-tablet" }), scope);
    const state = settle(node, plan.ops);
    check(
      "an id named ONLY by an unusable suffix promotes nothing, on this delivery or any redelivery",
      state.metadata?.platformStatuses === undefined && state.status === "backlog",
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    check(
      "…and no ref is attached for it either",
      refFor(state, null) === undefined && refFor(state, "web") === undefined,
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…while the ref it already carried keeps being mirrored, as a refusal promises",
      refFor(state, "ios")?.external_status === "merged",
      () => JSON.stringify(refsOf(state)),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-x:"));
    check("…and the refusal is reported by the planner, not only by the text scan", line !== undefined, () =>
      JSON.stringify(plan.warnings),
    );
    check(
      "…without claiming a bare mention was refused when there was none",
      line?.includes("bare mention") !== true,
      () => JSON.stringify(line),
    );
    check(
      "…and naming the repository link as the fallback it declined to use",
      line?.includes("repository link") === true,
      () => JSON.stringify(line),
    );
    // THE CASE THAT MUST STILL REFUSE THE OTHER WAY: a bare mention beside the
    // typo. Both spellings reach the same branch, which is the point of keying
    // it on the id.
    const beside = planForProject(
      bundle([node], true),
      event({ title: "AC-x: tablet support", body: "Fixes AC-x@ios-tablet" }),
      scope,
    );
    check(
      "a bare mention beside the typo still refuses, and says the bare one was not a fallback",
      beside.warnings.find((w) => w.startsWith("AC-x:"))?.includes("bare mention") === true,
      () => JSON.stringify(beside.warnings),
    );
  }
  {
    // A REFUSED SCOPE FREEZES NOTHING. A refusal is the statement "this delivery
    // could not decide", so it has no justified set to freeze against — and
    // freezing against an empty one would stop mirroring every ref the pull
    // request ever left, at precisely the moment arkaik admitted it did not
    // know. Same direction as "a refusal promotes nothing", pointed backwards.
    const node = acceptance("AC-x", ["web", "ios"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42-web", platform: "web" })] },
    });
    const idsBefore = JSON.stringify(refsOf(node).map((r) => [r.id, r.platform ?? null]));
    const refused = resolveRepoScope([IOS_LINK, WEB_LINK], {
      kind: "unavailable",
      reason: "GITHUB_APP_PRIVATE_KEY is not set",
    });
    check(
      "precondition: the scope really is a refusal",
      refused.kind === "no-platform" && refused.reason === "unavailable",
      () => JSON.stringify(refused),
    );
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), refused);
    const state = settle(node, plan.ops);
    check(
      "a refused delivery removes no ref",
      JSON.stringify(refsOf(state).map((r) => [r.id, r.platform ?? null])) === idsBefore,
      () => `${JSON.stringify(refsOf(state).map((r) => [r.id, r.platform ?? null]))} vs ${idsBefore}`,
    );
    check(
      "…and freezes none either: the mirror keeps running, which is what refusalTail promises",
      refFor(state, "web")?.external_status === "merged",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…while still promoting nothing from what it mirrored",
      state.status === "backlog" && state.metadata?.platformStatuses === undefined,
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
  }
  {
    // A node reached ONLY through an existing ref — no mention this delivery —
    // has no source deciding for it, so nothing freezes and the mirror keeps
    // running. A body edit that drops a mention must not stop a ref a promotion
    // already landed on; that rule predates freezing and survives it.
    const node = acceptance("AC-x", ["web", "ios"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42-web", platform: "web" })] },
    });
    const iosOnly = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift"]);
    const plan = planForProject(bundle([node], true), event({ body: "no ids here" }), iosOnly);
    const state = settle(node, plan.ops);
    check(
      "an unmentioned node's ref is not frozen by this delivery's path evidence",
      refFor(state, "web") !== undefined,
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…and is still mirrored",
      refFor(state, "web")?.external_status === "merged",
      () => JSON.stringify(refFor(state, "web")),
    );
  }
  {
    // THE PRECEDENCE, all three sources present and disagreeing.
    const node = acceptance("AC-x", ["web", "ios", "android"]);
    const scope = pathScope([IOS_LINK, { platform: "android", pathPrefix: "" }], ["apps/ios/A.swift"]);
    check(
      "precondition: the path source says ios and the whole-repository link says android",
      scope.kind === "links" && JSON.stringify(scope.pathPlatforms) === '["ios"]' && scope.linkPlatform === "android",
      () => JSON.stringify(scope),
    );
    const fromPath = settle(node, planForProject(bundle([node], true), event({ body: "AC-x" }), scope).ops);
    check(
      "the PATH beats the whole-repository link",
      fromPath.metadata?.platformStatuses?.ios === "live" &&
        fromPath.metadata?.platformStatuses?.android === undefined,
      () => JSON.stringify(fromPath.metadata?.platformStatuses),
    );
    const fromMention = settle(
      node,
      planForProject(bundle([node], true), event({ body: "AC-x@web" }), scope).ops,
    );
    check(
      "…and an explicit @platform beats the path",
      fromMention.metadata?.platformStatuses?.web === "live" &&
        fromMention.metadata?.platformStatuses?.ios === undefined,
      () => JSON.stringify(fromMention.metadata?.platformStatuses),
    );
  }
  {
    // The path source is INFERRED, not explicit, so it is FILTERED to the
    // platforms the acceptance lists before it decides. This is the whole value
    // of path scoping on a mixed pull request — and the reason it must not be
    // marked `explicit`, which would attach a ref claiming iOS on a web-only
    // acceptance instead.
    const node = acceptance("AC-web-only", ["web"]);
    const scope = pathScope([IOS_LINK, WEB_LINK], ["apps/ios/A.swift", "apps/webapp/b.tsx"]);
    check(
      "precondition: the path source named BOTH platforms",
      scope.kind === "links" && JSON.stringify(scope.pathPlatforms) === '["ios","web"]',
      () => JSON.stringify(scope),
    );
    const plan = planForProject(bundle([node], true), event({ body: "AC-web-only" }), scope);
    const state = settle(node, plan.ops);
    check(
      "a mixed pull request is honoured as the subset the acceptance lists",
      refFor(state, "web") !== undefined && refFor(state, "ios") === undefined,
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…promoting web and claiming nothing else",
      state.metadata?.platformStatuses?.web === "live" && state.status === "backlog",
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
  }
  {
    // …and when NONE of the path platforms apply, it refuses rather than
    // falling through to the whole-repository link.
    const node = acceptance("AC-android-only", ["android"]);
    const scope = pathScope([IOS_LINK, { platform: null, pathPrefix: "" }], ["apps/ios/A.swift"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-android-only" }), scope);
    check("a path platform the acceptance does not list attaches no ref", plan.ops.length === 0, () =>
      JSON.stringify(plan.ops),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-android-only:"));
    check("the refusal is reported", line !== undefined, () => JSON.stringify(plan.warnings));
    check(
      "…naming WHICH link to edit, which 'the repository link' could not with several of them",
      line?.includes("apps/ios") === true,
      () => JSON.stringify(line),
    );
    check(
      "…and both sides of the disagreement",
      line?.includes("ios") === true && line?.includes("android") === true,
      () => JSON.stringify(line),
    );
  }

  // ── planForProject with a REFUSED scope ─────────────────────────────────
  {
    // The refusal must refuse ATTACHMENT and PROMOTION, on the first delivery
    // and on every redelivery — the exact bug slice 1 shipped and fixed. So the
    // fixture already carries a promotable ref for this PR.
    const node = acceptance("AC-x", ["web", "ios"], {
      metadata: { refs: [ghRef({ id: "gh-pr-42-ios", platform: "ios" })] },
    });
    const mirrored = {
      ...node,
      metadata: { refs: [ghRef({ id: "gh-pr-42-ios", platform: "ios", external_status: "merged" })] },
    };
    check(
      "precondition: that ref IS promotable once mirrored, so a silent promotion would show",
      computeRefPromotions(bundle([mirrored], true)).promotions.some(
        (p) => p.node_id === "AC-x" && p.ref_id === "gh-pr-42-ios" && p.to === "live",
      ),
      () => JSON.stringify(computeRefPromotions(bundle([mirrored], true))),
    );

    const scope = resolveRepoScope([IOS_LINK, WEB_LINK], {
      kind: "unavailable",
      reason: "GITHUB_APP_PRIVATE_KEY is not set on this deployment",
    });
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), scope);
    const state = settle(node, plan.ops);
    check("precondition: the scope really was refused", scope.kind === "no-platform", () => JSON.stringify(scope));
    check(
      "the ref this PR already left keeps being MIRRORED — the mirror must not freeze",
      refFor(state, "ios")?.external_status === "merged",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "…keeping its stored id verbatim",
      refFor(state, "ios")?.id === "gh-pr-42-ios",
      () => JSON.stringify(refsOf(state)),
    );
    check(
      "but NOTHING is promoted from it, on this delivery or any redelivery",
      state.metadata?.platformStatuses === undefined && state.status === "backlog",
      () => JSON.stringify({ status: state.status, platformStatuses: state.metadata?.platformStatuses }),
    );
    check(
      "and NO unscoped ref is written — that would move the base status",
      refFor(state, null) === undefined,
      () => JSON.stringify(refsOf(state)),
    );
    const line = plan.warnings.find((w) => w.startsWith("AC-x:"));
    check("the refusal is reported", line !== undefined, () => JSON.stringify(plan.warnings));
    check(
      "…quoting the deterministic reason, which is the only channel that names the fix",
      line?.includes("GITHUB_APP_PRIVATE_KEY") === true,
      () => JSON.stringify(line),
    );
    check(
      "…listing the configured prefixes, so a typo'd one is visible",
      line?.includes("apps/ios") === true && line?.includes("apps/webapp") === true,
      () => JSON.stringify(line),
    );
    check(
      "…and saying what DOES still happen, so the text is not a second lie",
      line?.includes("mirrored") === true,
      () => JSON.stringify(line),
    );
    // ── ITEM 5: THE RENDERED SENTENCE, NOT JUST ITS PARTS ──────────────────
    // `detail` was documented as a half-sentence and the `unavailable` branch
    // assigned FULL sentences to it, which the consumer then spliced after
    // "and" before adding its own full stop: "…on the repository.. The plan
    // attaches…". The client's sentences now travel in `cause` and are
    // appended behind a lead-in instead.
    check(
      "…with no double period anywhere in the rendered warning",
      line?.includes("..") !== true,
      () => JSON.stringify(line),
    );
    check(
      "…and the client's own sentences appear behind a lead-in, not as a lower-case sentence start",
      line?.includes("Why arkaik could not read them: GITHUB_APP_PRIVATE_KEY") === true,
      () => JSON.stringify(line),
    );
    check(
      "…so every sentence in it starts with a capital or with arkaik's own lower-case name",
      line
        ?.split(". ")
        .every((s) => /^[A-Z(“"']/.test(s) || s.startsWith("arkaik") || s.startsWith("acme")) === true,
      () => JSON.stringify(line?.split(". ").filter((s) => !/^[A-Z(“"']/.test(s) && !s.startsWith("arkaik") && !s.startsWith("acme"))),
    );
  }
  {
    // An EXPLICIT @platform still wins when the files could not be read: the
    // author stated the scope, so nothing had to be inferred.
    const node = acceptance("AC-x", ["web", "ios"]);
    const scope = resolveRepoScope([IOS_LINK], { kind: "unavailable", reason: "no key" });
    const state = settle(node, planForProject(bundle([node], true), event({ body: "AC-x@ios" }), scope).ops);
    check(
      "an explicit mention survives an unreadable file list",
      refFor(state, "ios") !== undefined && state.metadata?.platformStatuses?.ios === "live",
      () => JSON.stringify(state.metadata),
    );
    check(
      "…and still claims nothing else",
      state.status === "backlog" && state.metadata?.platformStatuses?.web === undefined,
      () => JSON.stringify(state.metadata),
    );
  }
  {
    const node = acceptance("AC-x", ["web", "ios"]);
    const scope = pathScope([IOS_LINK, ALL_LINK], ["apps/ios/A.swift"], ["github-file-cap"]);
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), scope);
    check(
      "precondition: the incomplete-but-matched scope planned something",
      plan.ops.length > 0,
      () => JSON.stringify(plan),
    );
    check(
      "a partial file list is reported alongside the platforms it did find",
      plan.warnings.some((w) => w.includes("more files than GitHub will list")),
      () => JSON.stringify(plan.warnings),
    );
    // ITEM 2 AGAIN, one level up: the PLAN's own partial-list warning named the
    // 3000-file cap whatever had happened. Same assertion shape as the scope
    // one — the observed cause present, the two it did not observe absent.
    const budgetScope = pathScope([IOS_LINK, ALL_LINK], ["apps/ios/A.swift"], ["time-budget"]);
    const budgetPlan = planForProject(bundle([node], true), event({ body: "AC-x" }), budgetScope);
    check(
      "precondition: the time-budget scope also planned something (so the warning is not vacuous)",
      budgetPlan.ops.length > 0,
      () => JSON.stringify(budgetPlan),
    );
    const budgetLine = budgetPlan.warnings.find((w) => w.startsWith("acme/monorepo#42"));
    check(
      "…and the plan's partial-list warning names the TIME BUDGET, not GitHub's file cap",
      budgetLine !== undefined &&
        budgetLine.includes("ran out of the time budget") &&
        !budgetLine.includes("more files than GitHub will list"),
      () => JSON.stringify(budgetPlan.warnings),
    );
    check(
      "…and says a partial list freezes nothing, which is the rule the code follows",
      budgetLine?.includes("Nothing is frozen from a partial list") === true,
      () => JSON.stringify(budgetLine),
    );
    const outcome = assembleOutcome({
      projectId: "gp",
      textWarnings: [],
      planWarnings: plan.warnings,
      opCount: plan.ops.length,
    });
    check(
      "…without `skipped` contradicting it, because something really was applied",
      outcome.skipped === undefined && outcome.applied > 0,
      () => JSON.stringify(outcome),
    );
  }
  {
    // The refusal's ONLY evidence is the warning channel, so it has to survive
    // the trip through `assembleOutcome` with zero ops.
    const node = acceptance("AC-x", ["web", "ios"]);
    const scope = resolveRepoScope([IOS_LINK], { kind: "unavailable", reason: "GITHUB_APP_ID is not set" });
    const plan = planForProject(bundle([node], true), event({ body: "AC-x" }), scope);
    const outcome = assembleOutcome({
      projectId: "gp",
      textWarnings: [],
      planWarnings: plan.warnings,
      opCount: plan.ops.length,
    });
    check("precondition: the plan really is empty", plan.ops.length === 0, () => JSON.stringify(plan.ops));
    check(
      "a refused delivery reports applied: 0",
      outcome.applied === 0,
      () => JSON.stringify(outcome),
    );
    check(
      "…with a `skipped` that AGREES with the warnings rather than saying 'no matching acceptance'",
      outcome.skipped === "an acceptance was named, but no platform scope could be honoured",
      () => JSON.stringify(outcome),
    );
    check(
      "…and the reason survives into the response body",
      (outcome.warnings ?? []).some((w) => w.includes("GITHUB_APP_ID")),
      () => JSON.stringify(outcome),
    );
  }

  // ── resolveDeliveryScopes: the fetch/no-fetch decision ───────────────────
  //
  // The load-bearing property of the whole slice: a deployment that is not a
  // monorepo must never need a private key and must never touch the network.

  /** A `fetchFiles` that records every call — and would record a stray one. */
  const spyFetch = (result) => {
    const calls = [];
    const fn = async (pr) => {
      calls.push(pr);
      if (result instanceof Error) throw result;
      return result;
    };
    fn.calls = calls;
    return fn;
  };
  const ev = event({ body: "Fixes AC-x" });

  {
    const fetchFiles = spyFetch({ ok: true, changed: { paths: [], incomplete: [] } });
    const groups = groupLinksByProject([
      { projectId: "p1", platform: "ios", pathPrefix: "", installationId: null },
      { projectId: "p2", platform: null, pathPrefix: "", installationId: null },
    ]);
    check(
      "precondition: the pull request really does mention an acceptance",
      mentionedAcceptances(ev).mentions.some((m) => m.id === "AC-x"),
      () => JSON.stringify(mentionedAcceptances(ev)),
    );
    const scopes = await resolveDeliveryScopes({ groups, event: ev, installationId: "9", fetchFiles });
    check(
      "ZERO fetches when every link is whole-repository",
      JSON.stringify(fetchFiles.calls) === "[]",
      () => JSON.stringify(fetchFiles.calls),
    );
    check(
      "…and each project resolves exactly as it did before path scoping",
      scopes.get("p1")?.linkPlatform === "ios" && scopes.get("p2")?.linkPlatform === null,
      () => JSON.stringify([...scopes]),
    );
  }
  {
    // ONE fetch per delivery, however many projects need it.
    const fetchFiles = spyFetch({
      ok: true,
      changed: { paths: ["apps/ios/A.swift"], incomplete: [] },
    });
    const groups = groupLinksByProject([
      { projectId: "p1", platform: "ios", pathPrefix: "apps/ios", installationId: "9" },
      { projectId: "p1", platform: "web", pathPrefix: "apps/webapp", installationId: "9" },
      { projectId: "p2", platform: "android", pathPrefix: "apps/android", installationId: "9" },
    ]);
    const scopes = await resolveDeliveryScopes({ groups, event: ev, installationId: "9", fetchFiles });
    check(
      "the changed files are fetched once for the whole delivery, for the right pull request",
      JSON.stringify(fetchFiles.calls) ===
        JSON.stringify([{ repoFullName: "acme/monorepo", number: 42, installationId: "9" }]),
      () => JSON.stringify(fetchFiles.calls),
    );
    check(
      "the project whose subtree was touched resolves to that platform",
      JSON.stringify(scopes.get("p1")?.pathPlatforms) === '["ios"]',
      () => JSON.stringify([...scopes]),
    );
    check(
      "and the project whose subtree was not is refused, not given someone else's platform",
      scopes.get("p2")?.kind === "no-platform" && scopes.get("p2")?.reason === "outside-every-prefix",
      () => JSON.stringify([...scopes]),
    );
  }
  {
    // THE MIXED CASE, which a fixture with one project cannot see: one
    // misconfigured monorepo must not break every other project on the repo.
    const fetchFiles = spyFetch({ ok: false, reason: "GITHUB_APP_PRIVATE_KEY is not set" });
    const groups = groupLinksByProject([
      { projectId: "monorepo-project", platform: "ios", pathPrefix: "apps/ios", installationId: null },
      { projectId: "plain-project", platform: "web", pathPrefix: "", installationId: null },
    ]);
    const scopes = await resolveDeliveryScopes({ groups, event: ev, installationId: null, fetchFiles });
    check(
      "precondition: the delivery really did attempt a fetch",
      fetchFiles.calls.length === 1,
      () => JSON.stringify(fetchFiles.calls),
    );
    check(
      "the path-scoped project refuses, carrying the reason",
      scopes.get("monorepo-project")?.kind === "no-platform" &&
        (scopes.get("monorepo-project")?.cause ?? "").includes("GITHUB_APP_PRIVATE_KEY"),
      () => JSON.stringify([...scopes]),
    );
    check(
      "…while the whole-repository project on the SAME repository is untouched by the failure",
      scopes.get("plain-project")?.kind === "links" && scopes.get("plain-project")?.linkPlatform === "web",
      () => JSON.stringify([...scopes]),
    );
  }
  {
    // A transient failure must propagate, so the route releases the delivery
    // claim and GitHub redelivers. Swallowing it would lose the transition.
    const boom = new Error("GitHub returned 503");
    boom.name = "GithubTransientError";
    const fetchFiles = spyFetch(boom);
    const groups = groupLinksByProject([
      { projectId: "p1", platform: "ios", pathPrefix: "apps/ios", installationId: "9" },
    ]);
    let thrown = null;
    try {
      await resolveDeliveryScopes({ groups, event: ev, installationId: "9", fetchFiles });
    } catch (err) {
      thrown = err;
    }
    check(
      "a transient fetch failure propagates instead of resolving to some scope",
      thrown === boom,
      () => String(thrown),
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll pr-plan checks passed.");
}

// `main` is async only because `resolveDeliveryScopes` is — the fetch it takes
// is a parameter, and this suite passes one that never touches the network.
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  });
