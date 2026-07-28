/**
 * Path-scoped repository links: the normal form a stored prefix takes, and what
 * it means for a prefix to MATCH a file a pull request changed.
 *
 * A monorepo holds several apps in one repository, so one repository link
 * cannot declare one platform for all of it. A path-scoped link says
 * "`apps/ios` in this repository is the iOS app", and the webhook reads the
 * pull request's changed files to decide which of a project's links a delivery
 * belongs to (docs/hosted-projects.md § Monorepos).
 *
 * ── PURE, AND DELIBERATELY DEPENDENCY-FREE ─────────────────────────────────
 * No `server-only`, no database, no GitHub. Both sides of the feature import
 * this one module — `lib/services/graph/repos.ts` normalises with it before it
 * writes a row, and `lib/services/github/pull-request.ts` matches with it when
 * a delivery arrives — so the sentence "a prefix denotes whole path segments"
 * is written down exactly once. Two copies of that rule would drift, and the
 * drift is invisible: a link that exists, looks right in the dialog, and never
 * matches a single pull request.
 *
 * ── THE INVARIANT, NOT A LIST OF CASES ─────────────────────────────────────
 * `apps/ios` must not match `apps/ios-legacy/main.swift`. It is the same shape
 * as the `@platform` suffix bug that was fixed twice by widening a character
 * class — `@android-tv` scoping to `android`, then `@android_tv` doing it
 * again. Enumerating separators is an unwinnable game. What is encoded here is
 * the property itself: a prefix names whole path SEGMENTS, so a file is inside
 * it only when the file IS the prefix or continues it after a `/`. `-`, `.`,
 * `2`, `_` and every separator nobody has thought of yet fall out for free,
 * because none of them is a `/`.
 */

/**
 * The canonical stored form of a path prefix, or `null` when the input cannot
 * be made into one.
 *
 * `""` is legal and means THE WHOLE REPOSITORY — the shape every link written
 * before path scoping existed already has, and the fallback a project uses to
 * say "anything I did not scope belongs to this link".
 *
 * WHAT IS REPAIRED, and why each repair is safe:
 *   - outer whitespace, from pasting out of a terminal or a file browser;
 *   - a leading `/` (`/apps/ios`): GitHub's changed-file paths are
 *     repository-root-relative and never carry one, so a stored leading slash
 *     matches nothing at all;
 *   - a trailing `/` (`apps/ios/`), and empty segments (`apps//ios`): both are
 *     the same directory written differently, and leaving them distinct would
 *     store `apps/ios` and `apps/ios/` as two rows under the primary key that
 *     is supposed to make a prefix unique per repository;
 *   - `.` segments (`./apps/ios`), which name the directory they sit in.
 *
 * WHAT IS REFUSED: any `..` segment. Neither dropping it nor resolving it
 * yields what the author meant, and both readings are traversal-shaped
 * surprises. Refusing at write time means the matcher can never be handed one.
 *
 * WHITESPACE IS TRIMMED PER SEGMENT, NOT ONLY AT THE ENDS OF THE WHOLE VALUE.
 * The end-trimming version was storable-form-unsafe, and the two inputs that
 * proved it are pinned in tests/services/github-app.test.js: `"/ apps/ios"`
 * normalised to `" apps/ios"` and `"apps/ios /"` to `"apps/ios "`. Both are
 * non-null, so `linkRepo` skipped its `invalid_path` branch and handed them to
 * the INSERT, where `project_repos_path_prefix_check` rejected them — a 500 on
 * an endpoint that promises a 400. Per-segment trimming closes that by making
 * the return value's storability a PROPERTY rather than a hope: every segment
 * that survives is non-empty and has no leading or trailing whitespace, and
 * they are joined with single `/`s, so none of the constraint's five negative
 * rules (`^/`, `/$`, `//`, `^\s`, `\s$`) can hold of the result. Anything this
 * function returns is storable, and that sentence is what the caller relies on.
 *
 * "WHITESPACE" IS THE CONSTRAINT'S DEFINITION, NOT JAVASCRIPT'S — see
 * `EDGE_WHITESPACE`. Trimming on `String.prototype.trim` alone left that
 * sentence one code point short of true.
 *
 * A segment that is nothing BUT whitespace is dropped, exactly as an empty one
 * is: `apps/ /ios` is the same paste artefact as `apps//ios`, and a directory
 * genuinely named " " is not a thing this feature is willing to trade the
 * invariant above for.
 *
 * INTERIOR WHITESPACE SURVIVES — inside a segment. `My App/ios` is a legal git
 * path, and folding it away would trade a working prefix for a tidier rule.
 *
 * NOT LOWERCASED — the single most likely bug in this file, because
 * `repos.ts` lowercases `repoFullName` two lines away and for a good reason.
 * GitHub treats repository NAMES case-insensitively; git treats paths INSIDE a
 * repository as case-sensitive, and tracks `Apps/iOS` and `apps/ios` as
 * different paths. Folding the case here would make a link match files it does
 * not cover, which is a confidently wrong platform claim. A case mismatch
 * instead matches nothing, which is refused and reported — recoverable.
 */
/**
 * The characters trimmed off each segment: JavaScript's whitespace UNION the
 * five code points Postgres calls whitespace and JavaScript does not.
 *
 * WHY A UNION RATHER THAN `String.prototype.trim()`. The storability sentence
 * above ("anything this function returns satisfies
 * `project_repos_path_prefix_check`") is a claim about POSTGRES's idea of
 * whitespace, since the constraint's `^\s` / `\s$` rules are evaluated by
 * Postgres. The two definitions are not the same set, and the disagreement runs
 * in the direction that breaks the claim: every code point Postgres calls
 * whitespace but JavaScript does not is one `trim()` leaves in place and the
 * CHECK then rejects — the 500-on-a-documented-400 this function exists to make
 * impossible, still reachable through a paste.
 *
 * The five, pinned individually here and in tests/services/github-app.test.js
 * because "at least five" is not a specification:
 *
 *   U+001C FILE SEPARATOR, U+001D GROUP SEPARATOR, U+001E RECORD SEPARATOR,
 *   U+001F UNIT SEPARATOR, U+0085 NEXT LINE (NEL)
 *
 * They are members of glibc's `space` class — which is what `[[:space:]]`, and
 * therefore `\s`, resolves to in a Postgres database running a UTF-8 locale —
 * and none of them is trimmed by `String.prototype.trim`, whose set is
 * ECMA-262's WhiteSpace ∪ LineTerminator.
 *
 * THE OTHER DIRECTION IS DELIBERATELY LEFT ALONE. JavaScript trims several
 * characters Postgres does not (U+00A0 NBSP, U+2007 FIGURE SPACE, U+202F,
 * U+FEFF). Trimming those is harmless here: a stricter trim can only produce a
 * value the constraint accepts, never one it rejects, so the union is trimmed
 * rather than the intersection.
 *
 * AND IT IS A TRIM, NOT A REJECTION. These arrive by paste, exactly as an
 * ordinary space does; refusing the link outright would turn a paste artefact
 * into an error message about a character the author cannot see. Refusal is
 * reserved for `..`, where no repair yields what the author meant.
 */
const EDGE_WHITESPACE = /^[\s\u001C-\u001F\u0085]+|[\s\u001C-\u001F\u0085]+$/gu;

export function normalizePathPrefix(raw: string): string | null {
  const segments: string[] = [];
  // No `raw.trim()` before the split: trimming each SEGMENT subsumes it (the
  // first and last segments are the ends of the whole value), and one rule that
  // covers every position is the reason `"/ apps/ios"` cannot come back out of
  // here in a shape the database refuses.
  for (const segment of raw.split("/")) {
    const trimmed = segment.replace(EDGE_WHITESPACE, "");
    if (trimmed === "" || trimmed === ".") continue;
    if (trimmed === "..") return null;
    segments.push(trimmed);
  }
  return segments.join("/");
}

/**
 * Whether a changed file is inside a prefix, on SEGMENT boundaries.
 *
 * `prefix` must already be normalised — `pathMatchesPrefix("apps/ios/x", "apps/ios/")`
 * is false, deliberately, because a caller that skipped normalisation is a bug
 * worth seeing rather than papering over here.
 *
 * `file === prefix` is a real case, not an edge one: a prefix may name a single
 * FILE (`Podfile.lock`, `apps/ios/Info.plist`), and requiring a trailing `/`
 * would make every single-file link silently dead. It is unambiguous — one path
 * in one tree cannot be both a file and a directory — so equality can only fire
 * where the prefix names the file itself.
 *
 * `startsWith(prefix + "/")` rather than `startsWith(prefix)` plus an index
 * check: the same semantics, but the concatenated form IS the statement "the
 * next thing after the prefix is a separator", which is the whole invariant.
 *
 * The empty prefix is the whole repository, so every file is inside it. That is
 * the honest answer for a predicate about containment — and it is exactly why
 * `matchChangedPaths` below excludes empty-prefix links from matching rather
 * than trusting that nobody passes one.
 */
export function pathMatchesPrefix(filePath: string, prefix: string): boolean {
  if (prefix === "") return true;
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

/** One of a project's links to a repository, as the matcher needs to see it. */
export interface PathScopedLink {
  /** Normalised (`normalizePathPrefix`). `""` is the whole-repository link. */
  prefix: string;
  /** The platform the link declares, or null for "all platforms". */
  platform: string | null;
}

/** Which links a pull request's changed files landed in, and what they declare. */
export interface PathMatch {
  /** Deduped and sorted, so a ref array's order never depends on link order. */
  platforms: string[];
  /** The prefixes that matched, for naming the source in a report. */
  prefixes: string[];
}

/**
 * The links a set of changed files belongs to, by LONGEST MATCHING PREFIX per
 * file.
 *
 * ── WHY LONGEST MATCH, NOT "every link that matches" ───────────────────────
 * Given links `apps` → web and `apps/ios` → ios, a pull request touching only
 * `apps/ios/main.swift` matches both as string containment. Attributing the
 * file to both would claim `[ios, web]` for an iOS-only change. The decisive
 * argument is not the example but its direction: under longest-match, adding a
 * MORE SPECIFIC link can only ever narrow the claim, which is what refining a
 * configuration should do. Under "every match", refining the configuration
 * ENLARGES the claim — the wrong direction, and the wrong direction here is
 * the one that marks platforms shipped that nobody shipped.
 *
 * Ties are impossible: two DIFFERENT normalised prefixes that both match one
 * file at segment boundaries would have to be the same string.
 *
 * The union is taken across FILES, so a pull request touching `apps/ios` and
 * `apps/webapp` legitimately contributes both platforms.
 *
 * ── THE EMPTY PREFIX IS EXCLUDED HERE, ON PURPOSE ──────────────────────────
 * `pathMatchesPrefix(f, "")` is true for every file, so a whole-repository link
 * fed into this loop would win nothing (it is the shortest) but would still
 * mark every file as "matched", which would suppress the caller's
 * nothing-matched branch entirely. The whole-repository link is the FALLBACK
 * the caller reaches for when nothing matched; it is not a participant. Doing
 * that filtering here rather than at the call site means it holds for every
 * caller, including the next one.
 */
export function matchChangedPaths(
  filePaths: readonly string[],
  links: readonly PathScopedLink[],
): PathMatch {
  const scoped = links.filter((link) => link.prefix !== "");
  const platforms = new Set<string>();
  const prefixes = new Set<string>();

  for (const filePath of filePaths) {
    let winner: PathScopedLink | null = null;
    for (const link of scoped) {
      if (!pathMatchesPrefix(filePath, link.prefix)) continue;
      if (winner === null || link.prefix.length > winner.prefix.length) winner = link;
    }
    if (winner === null) continue;
    prefixes.add(winner.prefix);
    // A link with no platform (`apps/shared` → All platforms) still MATCHES —
    // it is how someone says "changes here ship everywhere, changes under
    // `docs/` ship nowhere" — but it contributes no platform, so the source
    // stays silent and precedence falls through to the whole-repository link.
    if (winner.platform !== null) platforms.add(winner.platform);
  }

  return { platforms: [...platforms].sort(), prefixes: [...prefixes].sort() };
}
