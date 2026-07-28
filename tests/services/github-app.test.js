#!/usr/bin/env node

/**
 * The two modules path-scoped repository links add below the planner:
 *
 *   - lib/services/github/paths.ts — what a stored prefix normalises to, and
 *     what it means for a prefix to MATCH a changed file;
 *   - lib/services/github/app.ts — App JWT, installation token, and the
 *     pull-request files API.
 *
 * NO DATABASE AND NO NETWORK. Everything here is pure or takes its `fetch` as a
 * parameter, so this suite runs in CI's `build` job and on a laptop, beside
 * pr-plan.test.js and for the same reason: every bug in this area so far
 * surfaced only after a push.
 *
 * The failures these assertions exist to prevent, in order of damage:
 *
 *   - `apps/ios` matching `apps/ios-legacy/main.swift`, which claims iOS for a
 *     pull request that never touched the iOS app. This is the same shape as
 *     the `@platform` suffix bug that was fixed twice by widening a character
 *     class, so the property under test is the INVARIANT — a prefix denotes
 *     whole path segments — and the fixture is the case that breaks a string
 *     prefix, never the harmless one;
 *   - a prefix lowercased on write, which would make a link match files it does
 *     not cover on a repository that legitimately holds both spellings;
 *   - a `..` segment reaching the matcher;
 *   - a truncated file list read as "nothing matched", which is the one
 *     direction truncation is NOT safe in;
 *   - a transient GitHub failure reported as a permanent no-op (the delivery is
 *     lost) or a missing env var retried forever (the delivery is lost anyway,
 *     three times more slowly);
 *   - a private key mangled by a single-line secret store failing with
 *     `ERR_OSSL_UNSUPPORTED: DECODER routines::unsupported`, which names
 *     nothing anyone can act on.
 *
 * Assertion discipline, inherited from pr-plan.test.js: never assert on counts
 * (assert by identity — for pagination that means "page=30 was requested and
 * page=31 was not", not "30 requests happened"), never let an assertion pass
 * vacuously (assert the precondition first), always print the offending value,
 * and a test whose NAME claims a general property must exercise the case that
 * breaks it.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const { loadGithubAppSeam, BUILD_DIR } = require("./load-github-app");

let failures = 0;

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

/**
 * POSTGRES's `\s`, not JavaScript's — the character class migration 010's
 * `^\s` / `\s$` rules are actually evaluated against.
 *
 * `\s` in a Postgres ARE is `[[:space:]]`, whose membership comes from the
 * database's ctype; for the UTF-8 locales these deployments run, that is
 * glibc's `space` class, transcribed here. The two definitions are NOT the same
 * set, and this file used to spell the constraint with JavaScript's `\s` — so
 * the block below, whose whole job is to pair the normaliser against the
 * DATABASE, was pairing it against the normaliser's own idea of whitespace and
 * could not see the disagreement.
 *
 * The five members that matter are the ones glibc calls space and
 * `String.prototype.trim` does not: U+001C-U+001F and U+0085. Those are the
 * code points a `trim()`-based normaliser leaves at the edge of a segment and
 * the CHECK then rejects.
 */
const PG_SPACE = /[\u0009-\u000D\u001C-\u001F\u0020\u0085\u1680\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]/u;

/**
 * The normal form db/migrations/010_repo_path_prefix.sql refuses to store,
 * transcribed from the constraint rather than derived from the normaliser.
 *
 * Written out here on purpose: asserting the normaliser against a predicate
 * exported from the same file would only prove that file agrees with itself.
 * The pairing that matters is normaliser <-> DATABASE, and these five negative
 * rules are the database half, character for character.
 */
function satisfiesStoredForm(prefix) {
  if (prefix === "") return true;
  return (
    !/^\//.test(prefix) &&
    !/\/$/.test(prefix) &&
    !/\/\//.test(prefix) &&
    !PG_SPACE.test(prefix[0]) &&
    !PG_SPACE.test(prefix[prefix.length - 1])
  );
}

const REPO = "acme/monorepo";
const TOKEN_URL_PART = "/app/installations/";
const isTokenExchange = (url) => url.includes(TOKEN_URL_PART);
const isFilesRequest = (url) => url.includes("/pulls/");
/** The page a files request asked for. `includes("page=1")` also matches page 10. */
const pageOf = (url) => Number(new URL(url).searchParams.get("page"));
/** Whether a page was requested, by IDENTITY of the number rather than substring. */
const askedForPage = (calls, n) => calls.filter(isFilesRequest).some((u) => pageOf(u) === n);

/** A JSON `Response`, with whatever headers a case needs to be distinguishable. */
const jsonRes = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** A fetch that records every call, so assertions can be made about the LOG. */
function recordingFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(String(url));
    const result = await handler(String(url), init, calls);
    if (result instanceof Error) throw result;
    return result;
  };
  impl.calls = calls;
  return impl;
}

function filesPage(entries, { next = false } = {}) {
  return jsonRes(200, entries, next ? { link: `<https://api.github.com/next>; rel="next"` } : {});
}

function main() {
  const { paths, app } = loadGithubAppSeam();
  const { normalizePathPrefix, pathMatchesPrefix, matchChangedPaths } = paths;
  const { appReadiness, buildAppJwt, normalizePrivateKeyPem, parseFilesPage } = app;

  // ══ paths.ts — normalisation ═════════════════════════════════════════════
  for (const [raw, expected, why] of [
    ["apps/ios", "apps/ios", "already canonical"],
    ["apps/ios/", "apps/ios", "trailing slash"],
    ["/apps/ios", "apps/ios", "leading slash (GitHub never sends one)"],
    ["./apps/ios", "apps/ios", "a leading . segment"],
    ["apps//ios", "apps/ios", "an empty segment"],
    ["  apps/ios  ", "apps/ios", "pasted with surrounding whitespace"],
    ["apps/./ios/", "apps/ios", "several at once"],
    ["", "", "the whole repository"],
    ["   ", "", "whitespace only is the whole repository"],
    ["/", "", "a lone slash is the whole repository"],
    ["Podfile.lock", "Podfile.lock", "a single file is a legal prefix"],
    ["My App/ios", "My App/ios", "INTERIOR whitespace is a legal git path and survives"],
    ["Apps/iOS", "Apps/iOS", "NOT lowercased — git paths are case-sensitive"],
    // THE TWO INPUTS THAT MADE THE NORMALISER EMIT AN UNSTORABLE VALUE. Trimming
    // only the ends of the WHOLE value left the space attached to a segment:
    // "/ apps/ios" came back as " apps/ios" and "apps/ios /" as "apps/ios ".
    // Both are non-null, so `linkRepo` skipped its invalid_path branch and the
    // INSERT hit project_repos_path_prefix_check — a 500 where the API promises
    // a 400. Pinned by value, because the general corpus check below cannot say
    // WHICH input broke.
    ["/ apps/ios", "apps/ios", "a leading slash AND a space after it"],
    ["apps/ios /", "apps/ios", "a space before the trailing slash"],
    ["apps/ /ios", "apps/ios", "a whitespace-only segment is an empty segment"],
    ["  My App / ios  ", "My App/ios", "segment edges are trimmed, the interior space is not"],
  ]) {
    check(
      `normalizePathPrefix(${JSON.stringify(raw)}) === ${JSON.stringify(expected)} — ${why}`,
      normalizePathPrefix(raw) === expected,
      () => JSON.stringify(normalizePathPrefix(raw)),
    );
  }
  for (const raw of ["apps/../secret", "..", "../x", "apps/ios/..", "a/../../b"]) {
    check(
      `a ".." segment is refused, not resolved or dropped: ${JSON.stringify(raw)}`,
      normalizePathPrefix(raw) === null,
      () => JSON.stringify(normalizePathPrefix(raw)),
    );
  }
  {
    // The normaliser and the database's check constraint must not drift: a
    // prefix that normalises to something 010 refuses is a 500 on save, and one
    // 010 accepts but the matcher never matches is a link with no symptom.
    const corpus = [
      "apps/ios",
      "apps/ios/",
      "/apps/ios",
      "./apps/ios",
      "apps//ios",
      "  apps/ios  ",
      "",
      "   ",
      "/",
      "My App/ios",
      "Apps/iOS",
      "Podfile.lock",
      "a/b/c/d/e",
      // The two that used to come out of the normaliser in a shape the INSERT
      // rejects. In the corpus as well as in the table above, so the general
      // claim this block makes ("every normalised prefix is storable") is
      // actually exercised by the case that falsified it.
      "/ apps/ios",
      "apps/ios /",
      "apps/ /ios",
      "  My App / ios  ",
      // ── ITEM 4: THE FIVE CODE POINTS THE TWO DEFINITIONS DISAGREED ON ────
      // `segment.trim()` trims ECMA-262's WhiteSpace ∪ LineTerminator. The
      // CHECK's `^\s` / `\s$` are evaluated by Postgres, whose `[[:space:]]`
      // (glibc's `space` class in a UTF-8 locale) ALSO contains U+001C-U+001F
      // and U+0085. Each of those five survived `trim()`, came back non-null,
      // and was handed to the INSERT — the same 500-on-a-documented-400 the
      // block above exists to prevent, reachable through a paste.
      //
      // Pinned individually rather than as "some control characters", because
      // a widened-but-still-short trim set would pass a sampled check.
      ...["\u001C", "\u001D", "\u001E", "\u001F", "\u0085"].flatMap((ws) => [
        `${ws}apps/ios`,
        `apps/ios${ws}`,
        `apps/${ws}ios`,
      ]),
    ];
    const offenders = corpus
      .map((raw) => [raw, normalizePathPrefix(raw)])
      .filter(([, out]) => out !== null && !satisfiesStoredForm(out));
    check(
      "precondition: the corpus really does contain values needing repair",
      corpus.some((raw) => !satisfiesStoredForm(raw)),
      () => JSON.stringify(corpus.filter((raw) => !satisfiesStoredForm(raw))),
    );
    check(
      "every normalised prefix satisfies migration 010's check constraint",
      offenders.length === 0,
      () => JSON.stringify(offenders),
    );
  }
  {
    // ── ITEM 4, NAMED ONE CODE POINT AT A TIME ────────────────────────────
    // The corpus check above says "one of these broke"; this says WHICH. Each
    // of the five is asserted by IDENTITY of the normalised value, in all three
    // positions a segment edge can be, so a trim set widened by four out of
    // five fails here with the missing one named in the test name.
    //
    // The pairing that matters is normaliser <-> DATABASE, so each case also
    // asserts the storable-form predicate transcribed from the constraint:
    // `PG_SPACE` is glibc's `space` class, and these five are exactly its
    // members that `String.prototype.trim` leaves behind.
    for (const [cp, name] of [
      ["\u001C", "U+001C FILE SEPARATOR"],
      ["\u001D", "U+001D GROUP SEPARATOR"],
      ["\u001E", "U+001E RECORD SEPARATOR"],
      ["\u001F", "U+001F UNIT SEPARATOR"],
      ["\u0085", "U+0085 NEXT LINE"],
    ]) {
      check(
        `precondition: ${name} is whitespace to POSTGRES, which is whose \\s the CHECK uses`,
        PG_SPACE.test(cp) === true,
        () => `PG_SPACE does not contain ${name}, so the assertions below prove nothing`,
      );
      check(
        `precondition: ${name} is NOT whitespace to String.prototype.trim — the whole disagreement`,
        `${cp}x${cp}`.trim() === `${cp}x${cp}`,
        () => `trim() already handles ${name}; this code point is not part of the gap`,
      );
      check(
        `${name} is stripped from the START of a segment, so the CHECK cannot reject the result`,
        normalizePathPrefix(`${cp}apps/ios`) === "apps/ios" &&
          satisfiesStoredForm(normalizePathPrefix(`${cp}apps/ios`)),
        () => JSON.stringify(normalizePathPrefix(`${cp}apps/ios`)),
      );
      check(
        `${name} is stripped from the END of a segment too`,
        normalizePathPrefix(`apps/ios${cp}`) === "apps/ios" &&
          satisfiesStoredForm(normalizePathPrefix(`apps/ios${cp}`)),
        () => JSON.stringify(normalizePathPrefix(`apps/ios${cp}`)),
      );
      check(
        `${name} at an INTERIOR segment edge is stripped as well — that edge is a segment's end`,
        normalizePathPrefix(`apps/${cp}ios`) === "apps/ios",
        () => JSON.stringify(normalizePathPrefix(`apps/${cp}ios`)),
      );
      check(
        `a segment that is nothing but ${name} is dropped, exactly as an empty one is`,
        normalizePathPrefix(`apps/${cp}/ios`) === "apps/ios",
        () => JSON.stringify(normalizePathPrefix(`apps/${cp}/ios`)),
      );
    }
    // THE OTHER DIRECTION IS DELIBERATELY LEFT WIDE. JavaScript trims several
    // code points Postgres does not (U+00A0 NBSP is the one people paste), and
    // trimming more than the constraint demands can only ever produce a value
    // it accepts. Pinned so nobody "fixes" the trim set down to the
    // intersection and reintroduces a storable-but-unmatchable prefix.
    check(
      "U+00A0 NBSP is still trimmed, even though Postgres would not call it whitespace",
      PG_SPACE.test("\u00A0") === false && normalizePathPrefix("\u00A0apps/ios") === "apps/ios",
      () => JSON.stringify(normalizePathPrefix("\u00A0apps/ios")),
    );
    // AND INTERIOR WHITESPACE STILL SURVIVES. The constraint forbids only edge
    // whitespace, `My App/ios` is a legal git path, and a widened trim that
    // folded it away would trade a working prefix for a tidier rule.
    check(
      "interior whitespace inside a segment is untouched by the widened trim",
      normalizePathPrefix("  My App/ios  ") === "My App/ios",
      () => JSON.stringify(normalizePathPrefix("  My App/ios  ")),
    );
  }

  // ══ paths.ts — SEGMENT BOUNDARIES, not string prefixes ═══════════════════
  {
    // The name of this block claims a general property, so the fixture holds
    // both halves: the file that MUST match and the near-miss that must not. A
    // matcher that matches nothing at all would pass the second half alone.
    check(
      "precondition: a file genuinely inside the prefix matches",
      pathMatchesPrefix("apps/ios/Sources/Checkout.swift", "apps/ios") === true,
      "apps/ios/Sources/Checkout.swift vs apps/ios",
    );
    for (const near of [
      "apps/ios-legacy/main.swift",
      "apps/ios2/main.swift",
      "apps/ios.old/main.swift",
      "apps/ios_legacy/main.swift",
      "apps/iosX",
      "apps/iosnext/a.ts",
    ]) {
      check(
        `a prefix matches whole SEGMENTS only: "apps/ios" does not match ${JSON.stringify(near)}`,
        pathMatchesPrefix(near, "apps/ios") === false,
        () => `${near} matched apps/ios`,
      );
    }
  }
  check(
    "a file EQUAL to the prefix matches, so a single-file link is not silently dead",
    pathMatchesPrefix("Podfile.lock", "Podfile.lock") === true,
  );
  check(
    "a prefix does not match its own parent directory",
    pathMatchesPrefix("apps", "apps/ios") === false,
  );
  {
    check(
      "precondition: the same-case pair matches",
      pathMatchesPrefix("apps/ios/x.swift", "apps/ios") === true,
    );
    check(
      "matching is CASE-SENSITIVE, unlike repository names",
      pathMatchesPrefix("apps/ios/x.swift", "Apps/iOS") === false,
      "git tracks Apps/iOS and apps/ios as different paths",
    );
  }
  check(
    "the empty prefix is the whole repository, so every file is inside it",
    pathMatchesPrefix("anything/at/all.txt", "") === true,
  );

  // ══ paths.ts — matching a changed-file list against links ════════════════
  const LINKS = [
    { prefix: "apps/ios", platform: "ios" },
    { prefix: "apps/webapp", platform: "web" },
    { prefix: "apps/android", platform: "android" },
  ];
  {
    const m = matchChangedPaths(["apps/ios/Sources/Checkout.swift"], LINKS);
    check("one subtree yields that link's platform", JSON.stringify(m.platforms) === '["ios"]', () => JSON.stringify(m));
    check("and names the prefix that matched", JSON.stringify(m.prefixes) === '["apps/ios"]', () => JSON.stringify(m));
  }
  {
    const m = matchChangedPaths(
      ["apps/ios/A.swift", "apps/webapp/b.tsx", "apps/android/C.kt", "README.md"],
      LINKS,
    );
    check(
      "a pull request across three subtrees yields all three platforms, sorted",
      JSON.stringify(m.platforms) === '["android","ios","web"]',
      () => JSON.stringify(m),
    );
  }
  {
    const m = matchChangedPaths(["apps/ios-legacy/main.swift", "docs/readme.md"], LINKS);
    check(
      "a pull request outside every prefix matches nothing (not the near-miss link)",
      JSON.stringify(m.platforms) === "[]" && JSON.stringify(m.prefixes) === "[]",
      () => JSON.stringify(m),
    );
  }
  {
    // NESTED PREFIXES. `apps` and `apps/ios` both contain the file as strings;
    // attributing it to both would make an iOS-only pull request claim web too,
    // so refining the configuration would ENLARGE the claim.
    const nested = [
      { prefix: "apps", platform: "web" },
      { prefix: "apps/ios", platform: "ios" },
    ];
    const only = matchChangedPaths(["apps/ios/A.swift"], nested);
    check(
      "precondition: the outer link really does contain the file as a string prefix",
      "apps/ios/A.swift".startsWith("apps"),
    );
    check(
      "nested prefixes: the LONGEST match wins per file, so a more specific link narrows",
      JSON.stringify(only.platforms) === '["ios"]',
      () => JSON.stringify(only),
    );
    const both = matchChangedPaths(["apps/ios/A.swift", "apps/site/index.ts"], nested);
    check(
      "…and a file only the outer link covers still contributes the outer platform",
      JSON.stringify(both.platforms) === '["ios","web"]',
      () => JSON.stringify(both),
    );
  }
  {
    // The whole-repository link is the FALLBACK, not a match participant: it
    // contains every file, so feeding it to the matcher would mark every pull
    // request as matched and suppress the caller's nothing-matched branch.
    const withFallback = [{ prefix: "", platform: "web" }, { prefix: "apps/ios", platform: "ios" }];
    const outside = matchChangedPaths(["docs/readme.md"], withFallback);
    check(
      "the empty prefix is excluded from matching",
      JSON.stringify(outside.prefixes) === "[]" && JSON.stringify(outside.platforms) === "[]",
      () => JSON.stringify(outside),
    );
    const inside = matchChangedPaths(["apps/ios/A.swift"], withFallback);
    check(
      "…and does not add its platform to a scoped match either",
      JSON.stringify(inside.platforms) === '["ios"]',
      () => JSON.stringify(inside),
    );
  }
  {
    // A path link with no platform ("All platforms" on a shared directory)
    // MATCHES — which suppresses the nothing-matched refusal — while
    // contributing no platform, so precedence falls through to the
    // whole-repository link.
    const shared = [{ prefix: "packages/shared", platform: null }, { prefix: "apps/ios", platform: "ios" }];
    const m = matchChangedPaths(["packages/shared/util.ts"], shared);
    check(
      "a path link with no platform matches without contributing a platform",
      JSON.stringify(m.prefixes) === '["packages/shared"]' && JSON.stringify(m.platforms) === "[]",
      () => JSON.stringify(m),
    );
  }
  {
    const m = matchChangedPaths(["apps/ios/A.swift", "apps/ios/B.swift", "apps/ios/C.swift"], LINKS);
    check(
      "a platform is contributed once however many files matched",
      JSON.stringify(m.platforms) === '["ios"]',
      () => JSON.stringify(m),
    );
  }

  // ══ app.ts — the private key, as the environment mangles it ══════════════
  const pkcs8 = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const pkcs1Pem = crypto
    .createPrivateKey(pkcs8.privateKey)
    .export({ type: "pkcs1", format: "pem" })
    .toString();
  const publicKey = pkcs8.publicKey;
  const PEM = pkcs8.privateKey;

  check(
    "precondition: the fixture key really is PKCS#8 and its PKCS#1 twin really is PKCS#1",
    PEM.includes("-----BEGIN PRIVATE KEY-----") && pkcs1Pem.includes("-----BEGIN RSA PRIVATE KEY-----"),
    () => `${PEM.slice(0, 32)} / ${pkcs1Pem.slice(0, 40)}`,
  );

  for (const [label, mangled] of [
    ["untouched", PEM],
    ["PKCS#1, the format GitHub's download button produces", pkcs1Pem],
    ["CRLF line endings", PEM.replace(/\n/g, "\r\n")],
    ["no trailing newline", PEM.trimEnd()],
    ["surrounding whitespace", `\n  ${PEM}  \n`],
    ['wrapped in " quotes', `"${PEM}"`],
    ["wrapped in ' quotes", `'${PEM}'`],
    ["literal \\n escapes (a single-line secret store)", PEM.replace(/\n/g, "\\n")],
    ['quotes AND literal \\n escapes', `"${PEM.replace(/\n/g, "\\n")}"`],
    ["literal \\r\\n escapes", PEM.replace(/\n/g, "\\r\\n")],
  ]) {
    const readiness = appReadiness({ appId: "123", privateKey: mangled });
    check(
      `a private key survives being ${label}`,
      readiness.ok === true,
      () => JSON.stringify(readiness),
    );
  }
  for (const [label, broken] of [
    ["base64 of the whole PEM", Buffer.from(PEM, "utf8").toString("base64")],
    ["every newline stripped", PEM.replace(/\n/g, "")],
    ["not a key at all", "hello"],
  ]) {
    const readiness = appReadiness({ appId: "123", privateKey: broken });
    check(`a key that is ${label} is refused, not accepted`, readiness.ok === false, () => JSON.stringify(readiness));
    check(
      `…with a message naming GITHUB_APP_PRIVATE_KEY rather than an OpenSSL error`,
      readiness.ok === false &&
        readiness.message.includes("GITHUB_APP_PRIVATE_KEY") &&
        !readiness.message.includes("ERR_OSSL"),
      () => (readiness.ok === false ? readiness.message : "<readiness said ok>"),
    );
  }
  // ── A KEY THAT PARSES AND CANNOT PRODUCE RS256 ───────────────────────────
  // `createPrivateKey` accepts any PEM, so readiness used to pass a TLS or SSH
  // key pasted into GITHUB_APP_PRIVATE_KEY. What happens next depends on the
  // key type, and node's two behaviours are asserted rather than assumed —
  // because the review that found this assumed both threw, and only one does:
  //
  //   - ed25519 THROWS at signing time, inside a claimed delivery. route.ts
  //     cannot tell that throw from a transient one, releases the claim, and
  //     GitHub redelivers into the identical deterministic failure, forever;
  //   - EC signs happily (ECDSA, ~70 bytes) and GitHub answers 401, which is
  //     reported — correctly, but as "check three things" rather than "this key
  //     is not RSA".
  //
  // Both are refused by key type now, which is why they are one loop.
  const ed25519Pem = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  const ecPem = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;

  /** What node does when asked to sign RS256 with this key: "throws" or "signs". */
  const rs256Behaviour = (keyPem) => {
    try {
      const s = crypto.createSign("RSA-SHA256");
      s.update("x");
      s.end();
      s.sign(crypto.createPrivateKey(keyPem));
      return "signs";
    } catch {
      return "throws";
    }
  };

  for (const [label, keyPem, behaviour] of [
    ["ed25519", ed25519Pem, "throws"],
    ["EC P-256", ecPem, "signs"],
  ]) {
    // PRECONDITIONS, so nothing below can pass because the fixture was simply a
    // malformed file: the key must really parse, must really not be RSA, and
    // must really behave the way this block claims node behaves.
    check(
      `precondition: the ${label} fixture parses as a PEM private key that is not RSA`,
      (() => {
        try {
          return crypto.createPrivateKey(keyPem).asymmetricKeyType === (label === "ed25519" ? "ed25519" : "ec");
        } catch {
          return false;
        }
      })(),
      () => `${label} fixture did not parse as expected`,
    );
    check(
      `precondition: node ${behaviour} when asked to sign RSA-SHA256 with the ${label} key`,
      rs256Behaviour(keyPem) === behaviour,
      () => `node actually ${rs256Behaviour(keyPem)} — the comment above this block is now wrong`,
    );
    const readiness = appReadiness({ appId: "123", privateKey: keyPem });
    check(
      `a ${label} key is a REPORTED skip, decided before anything is signed or sent`,
      readiness.ok === false,
      () => JSON.stringify(readiness),
    );
    check(
      `…with a message that names the key type and what to paste instead`,
      readiness.ok === false &&
        readiness.message.includes("GITHUB_APP_PRIVATE_KEY") &&
        readiness.message.includes("RSA"),
      () => (readiness.ok === false ? readiness.message : "<readiness said ok>"),
    );
  }
  check(
    "and an RSA key is still accepted, so the check is not 'refuse everything'",
    appReadiness({ appId: "123", privateKey: PEM }).ok === true,
    () => JSON.stringify(appReadiness({ appId: "123", privateKey: PEM })),
  );

  check(
    "the refusal message does not promise base64 handling the code does not do",
    (() => {
      const r = appReadiness({ appId: "1", privateKey: "hello" });
      return r.ok === false && /base64-encoded copy of the file is not/.test(r.message);
    })(),
    () => JSON.stringify(appReadiness({ appId: "1", privateKey: "hello" })),
  );
  check(
    "normalizePrivateKeyPem leaves a well-formed PEM byte-identical",
    normalizePrivateKeyPem(PEM) === PEM.trim(),
    () => JSON.stringify(normalizePrivateKeyPem(PEM).slice(0, 40)),
  );
  for (const [label, env, named] of [
    ["neither variable", { appId: "", privateKey: "" }, ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"]],
    ["only the id", { appId: "", privateKey: PEM }, ["GITHUB_APP_ID"]],
    ["only the key", { appId: "1", privateKey: "" }, ["GITHUB_APP_PRIVATE_KEY"]],
  ]) {
    const readiness = appReadiness(env);
    check(
      `with ${label} set, readiness fails and names exactly what is missing`,
      readiness.ok === false && named.every((n) => readiness.message.includes(n)),
      () => JSON.stringify(readiness),
    );
  }

  // ══ app.ts — the App JWT ═════════════════════════════════════════════════
  for (const [label, keyPem] of [
    ["PKCS#8", PEM],
    ["PKCS#1", pkcs1Pem],
  ]) {
    const nowMs = 1_700_000_000_000;
    const jwt = buildAppJwt({ appId: "424242", privateKeyPem: keyPem, nowMs });
    const [h, p, s] = jwt.split(".");
    check(`the JWT has three segments (${label})`, h && p && s ? true : false, () => jwt);
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    check(`alg is RS256, typ is JWT (${label})`, header.alg === "RS256" && header.typ === "JWT", () => JSON.stringify(header));
    check(`iss is the App id (${label})`, payload.iss === "424242", () => JSON.stringify(payload));
    check(
      `iat is backdated 60s, so a fast clock cannot make it future-dated (${label})`,
      payload.iat === Math.floor(nowMs / 1000) - 60,
      () => JSON.stringify(payload),
    );
    check(
      `exp is under both GitHub's 10-minute rule and the stricter exp-iat reading (${label})`,
      payload.exp - Math.floor(nowMs / 1000) <= 600 && payload.exp - payload.iat <= 600 && payload.exp > payload.iat,
      () => JSON.stringify(payload),
    );
    check(
      `the signature VERIFIES against the public key with RSA-SHA256 (${label})`,
      crypto
        .createVerify("RSA-SHA256")
        .update(`${h}.${p}`)
        .verify(publicKey, Buffer.from(s, "base64url")),
      () => `${label} signature did not verify`,
    );
    check(
      `base64url, with no padding and no + or / (${label})`,
      !/[+/=]/.test(jwt),
      () => jwt,
    );
  }

  // ══ app.ts — reading one page of the files endpoint ══════════════════════
  {
    const page = parseFilesPage([
      { filename: "apps/ios/A.swift", status: "modified" },
      { filename: "apps/ios/B.swift", status: "removed" },
      { filename: "apps/webapp/new.tsx", status: "renamed", previous_filename: "apps/ios/old.tsx" },
    ]);
    check(
      "a REMOVED file still counts — deleting iOS code is an iOS change",
      page.paths.includes("apps/ios/B.swift"),
      () => JSON.stringify(page),
    );
    check(
      "a RENAME contributes BOTH paths — a file moved OUT of a subtree changed it",
      page.paths.includes("apps/webapp/new.tsx") && page.paths.includes("apps/ios/old.tsx"),
      () => JSON.stringify(page),
    );
    check("and nothing is dropped from a well-formed page", page.dropped === 0, () => JSON.stringify(page));
  }
  {
    const page = parseFilesPage([{ filename: 42 }, { filename: "ok.ts" }, null, {}]);
    check(
      "a malformed item is counted as dropped, not thrown on",
      page.dropped === 3 && JSON.stringify(page.paths) === '["ok.ts"]',
      () => JSON.stringify(page),
    );
  }
  check(
    "a body that is not an array is dropped rather than crashing the delivery",
    parseFilesPage({ message: "Not Found" }).dropped === 1,
    () => JSON.stringify(parseFilesPage({ message: "Not Found" })),
  );

  return { paths, app, PEM, publicKey };
}

/** The async half: everything that goes through `createGithubApp`. */
async function asyncMain(ctx) {
  const { app, PEM } = ctx;
  const { createGithubApp, GithubTransientError } = app;

  const BASE_MS = 1_700_000_000_000;
  let clock = BASE_MS;
  const tokenBody = (expiresInMs = 3_600_000) => ({
    token: "ghs_fixture",
    expires_at: new Date(clock + expiresInMs).toISOString(),
    permissions: { pull_requests: "read" },
  });

  const make = (handler, over = {}) => {
    const fetchImpl = recordingFetch(handler);
    return {
      fetchImpl,
      client: createGithubApp({
        fetchImpl,
        nowMs: () => clock,
        appId: "424242",
        privateKey: PEM,
        ...over,
      }),
    };
  };
  const PR = { repoFullName: REPO, number: 42, installationId: "9001" };

  // ── Not configured: a value, never a throw ────────────────────────────────
  {
    const { fetchImpl, client } = make(() => jsonRes(200, []), { privateKey: "" });
    const result = await client.listPullRequestFiles(PR);
    check(
      "a missing private key is a REPORT, not a throw — no retry can set an env var",
      result.ok === false && result.reason.includes("GITHUB_APP_PRIVATE_KEY"),
      () => JSON.stringify(result),
    );
    check(
      "…and it makes no request at all",
      JSON.stringify(fetchImpl.calls) === "[]",
      () => JSON.stringify(fetchImpl.calls),
    );
  }
  {
    const { fetchImpl, client } = make(() => jsonRes(200, []));
    const result = await client.listPullRequestFiles({ ...PR, installationId: null });
    check(
      "a delivery with no installation id is reported, naming what to install",
      result.ok === false && result.reason.includes("GitHub App"),
      () => JSON.stringify(result),
    );
    check("…and makes no request either", JSON.stringify(fetchImpl.calls) === "[]", () => JSON.stringify(fetchImpl.calls));
  }

  // ── The happy path, and pagination ────────────────────────────────────────
  {
    const { fetchImpl, client } = make((url) => {
      if (isTokenExchange(url)) return jsonRes(201, tokenBody());
      // `pageOf`, not `url.includes("page=1")` — which is also true of page 10.
      return pageOf(url) === 1
        ? filesPage([{ filename: "apps/ios/A.swift" }], { next: true })
        : filesPage([{ filename: "apps/webapp/b.tsx", previous_filename: "old/b.tsx" }]);
    });
    const result = await client.listPullRequestFiles(PR);
    check("precondition: the fetch succeeded", result.ok === true, () => JSON.stringify(result));
    check(
      "every page's files are collected, deduped and sorted",
      result.ok && JSON.stringify(result.changed.paths) === '["apps/ios/A.swift","apps/webapp/b.tsx","old/b.tsx"]',
      () => JSON.stringify(result),
    );
    check(
      "a complete list carries NO incompleteness cause at all",
      result.ok && JSON.stringify(result.changed.incomplete) === "[]",
      () => JSON.stringify(result),
    );
    check(
      "pagination asks for the maximum page size, so a big PR costs a third of the requests",
      fetchImpl.calls.filter(isFilesRequest).every((u) => u.includes("per_page=100")),
      () => JSON.stringify(fetchImpl.calls),
    );
    check(
      "it stops when the Link header says there is no next page",
      askedForPage(fetchImpl.calls, 2) && !askedForPage(fetchImpl.calls, 3),
      () => JSON.stringify(fetchImpl.calls),
    );
  }
  {
    // No Link header at all (some proxies strip it): a FULL page is then the
    // only evidence another one follows, and a short page ends it.
    const { fetchImpl, client } = make((url) => {
      if (isTokenExchange(url)) return jsonRes(201, tokenBody());
      const page = pageOf(url);
      const entries = Array.from({ length: page === 1 ? 100 : 3 }, (_, i) => ({
        filename: `p${page}/f${i}.ts`,
      }));
      return jsonRes(200, entries);
    });
    const result = await client.listPullRequestFiles(PR);
    check("precondition: the short-page fallback fetch succeeded", result.ok === true, () => JSON.stringify(result));
    check(
      "with no Link header, a FULL page means another follows and a short page ends it",
      askedForPage(fetchImpl.calls, 2) && !askedForPage(fetchImpl.calls, 3),
      () => JSON.stringify(fetchImpl.calls),
    );
    check(
      "and the result carries both pages",
      result.ok && result.changed.paths.includes("p1/f0.ts") && result.changed.paths.includes("p2/f0.ts"),
      () => JSON.stringify(result.ok && result.changed.paths.length),
    );
  }
  {
    // GitHub caps this endpoint at 3000 files and there is no truncation flag
    // in the body, so having stopped while more pages existed IS the flag.
    const { fetchImpl, client } = make((url) => {
      if (isTokenExchange(url)) return jsonRes(201, tokenBody());
      const page = pageOf(url);
      return filesPage(
        Array.from({ length: 100 }, (_, i) => ({ filename: `p${page}/f${i}.ts` })),
        { next: true },
      );
    });
    const result = await client.listPullRequestFiles(PR);
    check("precondition: the capped fetch still succeeded", result.ok === true, () => JSON.stringify(result));
    check(
      "a pull request past GitHub's 3000-file cap is reported incomplete, BY THAT CAUSE",
      result.ok && JSON.stringify(result.changed.incomplete) === '["github-file-cap"]',
      () => JSON.stringify(result.ok && result.changed.incomplete),
    );
    check(
      "…having asked for page 30 and never page 31",
      askedForPage(fetchImpl.calls, 30) && !askedForPage(fetchImpl.calls, 31),
      () => JSON.stringify(fetchImpl.calls.filter(isFilesRequest).slice(-3)),
    );
  }
  {
    // ── THE CAP IS IN FILES, AND A RENAME IS ONE FILE WITH TWO PATHS ────────
    // Compared against a PATH count, 15 pages of 100 renames reach 3000 and
    // pagination stops at HALF of GitHub's real cap. The pages never read are
    // exactly where the only files inside a linked prefix may live — here, page
    // 16 — and the delivery reports truncation of a pull request GitHub never
    // truncated, which `resolveRepoScope` then turns into a refusal.
    //
    // The fixture is renames for that reason: with plain edits the two counts
    // are equal and the distinction this block is named for is not exercised.
    const LAST = 16;
    const { fetchImpl, client } = make((url) => {
      if (isTokenExchange(url)) return jsonRes(201, tokenBody());
      const page = pageOf(url);
      // The last page is SHORT as well as Link-less. A full final page is
      // indistinguishable from "another follows" under the no-Link fallback, so
      // a fixture that only dropped `rel="next"` would keep paginating to 30 and
      // this block would be asserting the cap, not the rename rule.
      const size = page < LAST ? 100 : 3;
      return filesPage(
        Array.from({ length: size }, (_, i) => ({
          filename: `p${page}/new-${i}.ts`,
          previous_filename: `p${page}/old-${i}.ts`,
        })),
        { next: page < LAST },
      );
    });
    const result = await client.listPullRequestFiles(PR);
    check("precondition: the rename fetch succeeded", result.ok === true, () => JSON.stringify(result));
    check(
      "precondition: the fixture really is renames — one entry yields BOTH of its paths",
      result.ok &&
        result.changed.paths.includes("p1/new-0.ts") &&
        result.changed.paths.includes("p1/old-0.ts"),
      () => JSON.stringify(result.ok && result.changed.paths.slice(0, 4)),
    );
    check(
      "precondition: this fixture crosses MAX_FILES under a PATH count (15 pages x 100 renames = 3000 paths)",
      15 * 100 * 2 >= 3000 && LAST > 15,
      `LAST=${LAST}`,
    );
    check(
      "the cap counts FILES, so pagination reaches the last page instead of stopping at 15",
      askedForPage(fetchImpl.calls, LAST),
      () => JSON.stringify(fetchImpl.calls.filter(isFilesRequest).map(pageOf)),
    );
    check(
      "…so the last page's files — which a path count never reached — are in the result",
      result.ok && result.changed.paths.includes(`p${LAST}/new-0.ts`),
      () => JSON.stringify(result.ok && result.changed.paths.filter((p) => p.startsWith(`p${LAST}/`))),
    );
    check(
      "…and a pull request GitHub did NOT truncate carries no cause at all",
      result.ok && JSON.stringify(result.changed.incomplete) === "[]",
      () => JSON.stringify(result.ok && result.changed.incomplete),
    );
    check(
      "…while the Link header still ends it: page 17 is never asked for",
      !askedForPage(fetchImpl.calls, LAST + 1),
      () => JSON.stringify(fetchImpl.calls.filter(isFilesRequest).map(pageOf)),
    );
  }
  {
    // ── THE AGGREGATE BUDGET ───────────────────────────────────────────────
    // Up to 31 sequential 5-second requests fit inside the per-request timeouts
    // and nothing else bounds them. The failure is not a slow GitHub: it is the
    // serverless host killing the function at its own 10-15s limit, mid-loop.
    // The delivery is claimed by then, the process dies before releaseDelivery
    // can run, and the redelivery sees the claim and skips — the transition is
    // lost permanently, which is the exact failure release-on-failure exists to
    // prevent.
    //
    // The clock is injected and each request costs 2 seconds of it, so this is
    // deterministic rather than timing-dependent.
    const before = clock;
    const slow = (url) => {
      clock += 2_000;
      if (isTokenExchange(url)) return jsonRes(201, tokenBody());
      return filesPage([{ filename: `p${pageOf(url)}/a.ts` }], { next: true });
    };
    const fast = (url) => {
      if (isTokenExchange(url)) return jsonRes(201, tokenBody());
      return filesPage([{ filename: `p${pageOf(url)}/a.ts` }], { next: true });
    };

    // PRECONDITION: the identical fixture, with no time passing, paginates well
    // past where the budget stops it. Without this the assertion below could
    // pass because the fixture simply had two pages.
    const quick = make(fast);
    const quickResult = await quick.client.listPullRequestFiles(PR);
    check("precondition: the quick fetch succeeded", quickResult.ok === true, () => JSON.stringify(quickResult));
    check(
      "precondition: with no time passing the same fixture reaches page 3 and beyond",
      askedForPage(quick.fetchImpl.calls, 3) && askedForPage(quick.fetchImpl.calls, 30),
      () => JSON.stringify(quick.fetchImpl.calls.filter(isFilesRequest).map(pageOf)),
    );

    const { fetchImpl, client } = make(slow);
    let threw = null;
    let result = null;
    try {
      result = await client.listPullRequestFiles(PR);
    } catch (err) {
      threw = err;
    }
    check(
      "an exhausted budget does NOT throw — a throw releases the claim and redelivers the same overrun forever",
      threw === null,
      () => `threw ${threw && threw.name}: ${threw && threw.message}`,
    );
    check(
      "…it returns a value, so the delivery is reported rather than retried",
      result !== null && result.ok === true,
      () => JSON.stringify(result),
    );
    check(
      // ITEM 2: the CAUSE, not just the fact. This case and the 3000-file cap
      // used to set one boolean, and the warning built on it asserted the cap —
      // so a pull request of eleven files whose second page timed out was told
      // it "changes more files than GitHub will list". Asserted by identity on
      // the whole array, so a value that ALSO claims the cap fails here.
      "…marked incomplete by the TIME BUDGET, and by nothing else",
      result !== null && result.ok && JSON.stringify(result.changed.incomplete) === '["time-budget"]',
      () => JSON.stringify(result),
    );
    check(
      "…having read the pages it could afford (page 2) and not started one it could not (page 3)",
      askedForPage(fetchImpl.calls, 2) && !askedForPage(fetchImpl.calls, 3),
      () => JSON.stringify(fetchImpl.calls.filter(isFilesRequest).map(pageOf)),
    );
    check(
      "…and what it did read is kept: a partial list is still real evidence",
      result !== null && result.ok && result.changed.paths.includes("p1/a.ts"),
      () => JSON.stringify(result !== null && result.ok && result.changed.paths),
    );
    clock = before;
  }
  {
    const { client } = make((url) => {
      if (isTokenExchange(url)) return jsonRes(201, tokenBody());
      return filesPage([{ filename: "apps/ios/A.swift" }, { filename: 42 }]);
    });
    const result = await client.listPullRequestFiles(PR);
    check("precondition: the malformed-item fetch succeeded", result.ok === true, () => JSON.stringify(result));
    check(
      "an unreadable item marks the list incomplete — by ITS cause, not by GitHub's cap",
      result.ok &&
        JSON.stringify(result.changed.incomplete) === '["unreadable-entry"]' &&
        result.changed.paths.includes("apps/ios/A.swift"),
      () => JSON.stringify(result),
    );
  }

  // ── Headers ──────────────────────────────────────────────────────────────
  {
    const seen = [];
    const bodies = [];
    const fetchImpl = async (url, init) => {
      seen.push(init.headers);
      if (isTokenExchange(String(url))) {
        bodies.push(init.body);
        return jsonRes(201, tokenBody());
      }
      return filesPage([{ filename: "a.ts" }]);
    };
    const client = createGithubApp({ fetchImpl, nowMs: () => clock, appId: "1", privateKey: PEM });
    const result = await client.listPullRequestFiles(PR);
    check("precondition: the header fetch succeeded", result.ok === true, () => JSON.stringify(result));
    check(
      "every request sends a User-Agent — GitHub refuses requests without one",
      seen.length > 0 && seen.every((h) => h["user-agent"] === "arkaik"),
      () => JSON.stringify(seen),
    );
    const exchangeBody = JSON.parse(bodies[0] ?? "{}");
    check(
      "the token exchange asks for the ONE repository and the ONE permission it needs",
      exchangeBody.permissions?.pull_requests === "read" &&
        JSON.stringify(exchangeBody.repositories) === '["monorepo"]',
      () => JSON.stringify(exchangeBody),
    );
  }

  // ── Transient vs deterministic ───────────────────────────────────────────
  const transientCase = async (label, responder) => {
    const { client } = make((url) => (isTokenExchange(url) ? jsonRes(201, tokenBody()) : responder(url)));
    let thrown = null;
    let returned = null;
    try {
      returned = await client.listPullRequestFiles(PR);
    } catch (err) {
      thrown = err;
    }
    check(
      `${label} is TRANSIENT: thrown, so the route releases the delivery and GitHub retries`,
      thrown instanceof GithubTransientError,
      () => `returned ${JSON.stringify(returned)}; threw ${thrown && thrown.name}: ${thrown && thrown.message}`,
    );
  };
  await transientCase("a 500 from the files API", () => jsonRes(500, { message: "oops" }));
  await transientCase("a 502 from the files API", () => jsonRes(502, {}));
  await transientCase("a 429", () => jsonRes(429, {}));
  await transientCase("a network failure", () => new Error("ECONNRESET"));
  await transientCase("a 403 with x-ratelimit-remaining: 0", () =>
    jsonRes(403, { message: "rate limited" }, { "x-ratelimit-remaining": "0" }),
  );
  await transientCase("a 403 with retry-after", () =>
    jsonRes(403, { message: "secondary limit" }, { "retry-after": "60" }),
  );
  {
    const { client } = make((url) => (isTokenExchange(url) ? jsonRes(500, {}) : filesPage([])));
    let thrown = null;
    try {
      await client.listPullRequestFiles(PR);
    } catch (err) {
      thrown = err;
    }
    check(
      "a 5xx on the TOKEN EXCHANGE is transient too, not only on the files call",
      thrown instanceof GithubTransientError,
      () => String(thrown),
    );
  }

  const deterministicCase = async (label, responder, expect) => {
    const { client } = make((url) => (isTokenExchange(url) ? jsonRes(201, tokenBody()) : responder(url)));
    let result = null;
    let thrown = null;
    try {
      result = await client.listPullRequestFiles(PR);
    } catch (err) {
      thrown = err;
    }
    check(
      `${label} is DETERMINISTIC: reported, not retried forever`,
      thrown === null && result !== null && result.ok === false,
      () => `threw ${thrown && thrown.message}; returned ${JSON.stringify(result)}`,
    );
    check(
      `…and its message names ${JSON.stringify(expect)}`,
      result !== null && result.ok === false && result.reason.includes(expect),
      () => JSON.stringify(result),
    );
  };
  // 403 WITHOUT rate-limit headers is a permission problem, and the split is on
  // the headers rather than on the status because GitHub reports both
  // "forbidden" and "rate limited" as 403.
  await deterministicCase(
    "a plain 403 on the files API",
    () => jsonRes(403, { message: "Resource not accessible by integration" }),
    "Pull requests: Read",
  );
  await deterministicCase("a 404 on the files API", () => jsonRes(404, { message: "Not Found" }), REPO);
  {
    const { client } = make((url) => (isTokenExchange(url) ? jsonRes(401, {}) : filesPage([])));
    const result = await client.listPullRequestFiles(PR);
    check(
      "a 401 on the token exchange is reported, naming the credentials to check",
      result.ok === false && result.reason.includes("GITHUB_APP_ID"),
      () => JSON.stringify(result),
    );
  }
  {
    const { client } = make((url) => (isTokenExchange(url) ? jsonRes(404, {}) : filesPage([])));
    const result = await client.listPullRequestFiles(PR);
    check(
      "a 404 on the token exchange means the installation is gone, and says so",
      result.ok === false && result.reason.includes("9001"),
      () => JSON.stringify(result),
    );
  }
  {
    // The runtime half of this module's permission claim: the exchange asks for
    // `pull_requests: read` and CHECKS it was granted, so the docs sentence is
    // verified by the running system rather than asserted.
    const { client } = make((url) =>
      isTokenExchange(url)
        ? jsonRes(201, { token: "ghs_x", expires_at: new Date(clock + 3_600_000).toISOString(), permissions: {} })
        : filesPage([{ filename: "a.ts" }]),
    );
    const result = await client.listPullRequestFiles(PR);
    check(
      "a token granted without Pull requests: Read is refused before the files call, naming the permission",
      result.ok === false && result.reason.includes("Pull requests: Read"),
      () => JSON.stringify(result),
    );
  }

  // ── A stale cached token: exactly one refresh ────────────────────────────
  {
    let filesSeen = 0;
    const { fetchImpl, client } = make((url) => {
      if (isTokenExchange(url)) return jsonRes(201, tokenBody());
      filesSeen += 1;
      return filesSeen === 1 ? jsonRes(401, { message: "Bad credentials" }) : filesPage([{ filename: "apps/ios/A.swift" }]);
    });
    const result = await client.listPullRequestFiles(PR);
    check(
      "a 401 on the files call is retried once with a fresh token, and succeeds",
      result.ok === true && result.changed.paths.includes("apps/ios/A.swift"),
      () => JSON.stringify(result),
    );
    const exchanges = fetchImpl.calls.filter(isTokenExchange);
    check(
      "…having minted a second token to do it",
      exchanges.length === 2 && exchanges[0] === exchanges[1],
      () => JSON.stringify(fetchImpl.calls),
    );
  }
  {
    const { client } = make((url) => (isTokenExchange(url) ? jsonRes(201, tokenBody()) : jsonRes(401, {})));
    const result = await client.listPullRequestFiles(PR);
    check(
      "a SECOND 401 is deterministic — retrying a freshly minted token is a loop",
      result.ok === false && result.reason.includes("twice"),
      () => JSON.stringify(result),
    );
  }

  {
    // ── ITEM 7c: THE 401 RETRY IS BUDGETED LIKE ANY OTHER REQUEST ─────────
    //
    // The retry mints a fresh token, which is one more 5-second call — and the
    // loop-top guard has already been passed for THIS iteration, so without a
    // second check the worst case runs a full REQUEST_TIMEOUT_MS past the
    // deadline the guard exists to enforce. That is the failure the whole
    // budget is for: the serverless host kills the process mid-resolution, the
    // delivery is already claimed, `releaseDelivery` never runs because nothing
    // catches a killed process, and GitHub's redelivery sees the claim and
    // skips. The transition is lost permanently.
    //
    // Deleting the guard left every suite green. This pins it by IDENTITY of
    // the request LOG: after the 401 there must be no further token exchange.
    const budgeted = (advanceOnFiles) => {
      let filesSeen = 0;
      const calls = [];
      const fetchImpl = async (url) => {
        const u = String(url);
        calls.push(u);
        if (isTokenExchange(u)) return jsonRes(201, tokenBody());
        filesSeen += 1;
        clock += advanceOnFiles;
        return filesSeen === 1
          ? jsonRes(401, { message: "Bad credentials" })
          : filesPage([{ filename: "apps/ios/A.swift" }]);
      };
      return {
        calls,
        client: createGithubApp({ fetchImpl, nowMs: () => clock, appId: "424242", privateKey: PEM }),
      };
    };

    // PRECONDITION, with the same fixture and no time passing: the retry DOES
    // happen, and it works. Without this the assertion below would pass for a
    // client that never retries at all.
    clock = BASE_MS;
    const fast = budgeted(0);
    const fastResult = await fast.client.listPullRequestFiles(PR);
    const fastFiles = fast.calls.findIndex(isFilesRequest);
    check(
      "precondition: with budget to spare, a 401 IS retried with a freshly minted token",
      fastResult.ok === true && fast.calls.slice(fastFiles).some(isTokenExchange),
      () => JSON.stringify(fast.calls),
    );
    check(
      "precondition: …and the retry is what makes it succeed",
      fastResult.ok === true && fastResult.changed.paths.includes("apps/ios/A.swift"),
      () => JSON.stringify(fastResult),
    );

    // 4.5 seconds spent on the page-1 request leaves 4.5 of the 9-second
    // budget — less than the 5 seconds one more request may take.
    clock = BASE_MS;
    const tight = budgeted(4_500);
    const result = await tight.client.listPullRequestFiles(PR);
    const firstFiles = tight.calls.findIndex(isFilesRequest);
    check(
      "precondition: the tight run really did reach the files call and get its 401",
      firstFiles !== -1,
      () => JSON.stringify(tight.calls),
    );
    check(
      "a 401 retry that does not FIT in the remaining budget is not started",
      tight.calls.slice(firstFiles).some(isTokenExchange) === false,
      () => JSON.stringify(tight.calls),
    );
    check(
      "…and the run ends as a VALUE marked incomplete by the time budget, not as a throw",
      result.ok === true && JSON.stringify(result.changed.incomplete) === '["time-budget"]',
      () => JSON.stringify(result),
    );
    clock = BASE_MS;
  }
  {
    // ── ITEM 7b: THE TOKEN CACHE KEY CARRIES THE REPOSITORY ───────────────
    //
    // An installation token is minted SCOPED to one repository (`repositories:
    // [name]`), so two repositories under one installation must not share a
    // cache entry. Keying on the installation alone left every suite green
    // while the second repository's files call went out carrying a token
    // scoped to the first — which GitHub answers 404, reported as "the arkaik
    // GitHub App installation cannot see acme/two#2. The repository may have
    // been renamed, or the App removed from it." A true sentence about the
    // wrong thing, on a repository that is fine.
    //
    // Asserted by IDENTITY of the bearer token each files request carried, not
    // by how many exchanges happened.
    clock = BASE_MS;
    const authByRepo = new Map();
    const fetchImpl = async (url, init) => {
      const u = String(url);
      if (isTokenExchange(u)) {
        const repo = JSON.parse(String(init.body)).repositories[0];
        return jsonRes(201, { ...tokenBody(), token: `ghs_for_${repo}` });
      }
      authByRepo.set(new URL(u).pathname.split("/").slice(2, 4).join("/"), init.headers.authorization);
      return filesPage([{ filename: "a.ts" }]);
    };
    const client = createGithubApp({ fetchImpl, nowMs: () => clock, appId: "424242", privateKey: PEM });
    const ONE = { repoFullName: "acme/one", number: 1, installationId: "9001" };
    const TWO = { repoFullName: "acme/two", number: 2, installationId: "9001" };
    const r1 = await client.listPullRequestFiles(ONE);
    const r2 = await client.listPullRequestFiles(TWO);
    check(
      "precondition: both calls succeeded, and both are the SAME installation",
      r1.ok === true && r2.ok === true && ONE.installationId === TWO.installationId,
      () => JSON.stringify([r1, r2]),
    );
    check(
      "precondition: the fixture mints a DIFFERENT token per repository, so the two are tellable apart",
      authByRepo.get("acme/one") !== undefined && authByRepo.get("acme/two") !== undefined,
      () => JSON.stringify([...authByRepo]),
    );
    check(
      "the first repository's files call carries the token minted for THAT repository",
      authByRepo.get("acme/one") === "Bearer ghs_for_one",
      () => JSON.stringify([...authByRepo]),
    );
    check(
      "a second repository under the SAME installation does not reuse the first's scoped token",
      authByRepo.get("acme/two") === "Bearer ghs_for_two",
      () => JSON.stringify([...authByRepo]),
    );
  }

  // ── The installation-token cache ─────────────────────────────────────────
  {
    clock = BASE_MS;
    const { fetchImpl, client } = make((url) =>
      isTokenExchange(url) ? jsonRes(201, tokenBody()) : filesPage([{ filename: "a.ts" }]),
    );
    const first = await client.listPullRequestFiles(PR);
    check("precondition: the first call succeeded", first.ok === true, () => JSON.stringify(first));
    const afterFirst = fetchImpl.calls.length;
    const second = await client.listPullRequestFiles(PR);
    check("precondition: the second call succeeded", second.ok === true, () => JSON.stringify(second));
    check(
      "a live installation token is reused rather than re-minted",
      fetchImpl.calls.slice(afterFirst).every((u) => !isTokenExchange(u)),
      () => JSON.stringify(fetchImpl.calls.slice(afterFirst)),
    );

    // An hour later, the cached token is past its expiry.
    clock = BASE_MS + 3_600_000;
    const afterSecond = fetchImpl.calls.length;
    const third = await client.listPullRequestFiles(PR);
    check("precondition: the post-expiry call succeeded", third.ok === true, () => JSON.stringify(third));
    check(
      "an expired one is exchanged again",
      fetchImpl.calls.slice(afterSecond).some(isTokenExchange),
      () => JSON.stringify(fetchImpl.calls.slice(afterSecond)),
    );
    clock = BASE_MS;
  }
  {
    // ── ITEM 7e: A TOKEN WHOSE `expires_at` CANNOT BE READ ─────────────────
    //
    // `Date.parse` of a missing or malformed `expires_at` is NaN, and a NaN
    // expiry compares false against every clock — so a cache entry built from
    // one would be treated as LIVE forever, and every later delivery in that
    // process would send a token GitHub stopped honouring an hour ago. The
    // failure is invisible until it 401s, and the process is long-lived.
    //
    // "Expires now" is the safe reading: the token still serves THIS delivery
    // (GitHub minted it, it is good for an hour) and is simply never reused.
    // Asserted by IDENTITY on the second call's request list — "a token
    // exchange was requested again" — not on a call count.
    for (const [label, expires_at] of [
      ["absent", undefined],
      ["not a date", "whenever"],
      ["not even a string", 1_700_003_600_000],
    ]) {
      clock = BASE_MS;
      const { fetchImpl, client } = make((url) =>
        isTokenExchange(url)
          ? jsonRes(201, {
              token: "ghs_fixture",
              permissions: { pull_requests: "read" },
              ...(expires_at === undefined ? {} : { expires_at }),
            })
          : filesPage([{ filename: "a.ts" }]),
      );
      const first = await client.listPullRequestFiles(PR);
      check(
        `precondition: a token with an ${label} expires_at still serves THIS delivery`,
        first.ok === true && JSON.stringify(first.changed?.paths) === '["a.ts"]',
        () => JSON.stringify(first),
      );
      const afterFirst = fetchImpl.calls.length;
      // The clock has NOT moved. A readable one-hour expiry would be reused
      // here — that is exactly what the block above pins — so this is the same
      // situation with only the unreadable field changed.
      const second = await client.listPullRequestFiles(PR);
      check(`precondition: the second call succeeded too (${label})`, second.ok === true, () =>
        JSON.stringify(second),
      );
      check(
        `an ${label} expires_at is treated as already expired, so the next call exchanges a fresh token`,
        fetchImpl.calls.slice(afterFirst).some(isTokenExchange),
        () => JSON.stringify(fetchImpl.calls.slice(afterFirst)),
      );
    }
    clock = BASE_MS;
  }
  {
    // The cache lives on the INSTANCE, so two scenarios in one suite cannot
    // affect each other — and there is no test-only reset export in production.
    const { fetchImpl: f1, client: c1 } = make((url) =>
      isTokenExchange(url) ? jsonRes(201, tokenBody()) : filesPage([{ filename: "a.ts" }]),
    );
    const { fetchImpl: f2, client: c2 } = make((url) =>
      isTokenExchange(url) ? jsonRes(201, tokenBody()) : filesPage([{ filename: "a.ts" }]),
    );
    const r1 = await c1.listPullRequestFiles(PR);
    const r2 = await c2.listPullRequestFiles(PR);
    check("precondition: both clients succeeded", r1.ok === true && r2.ok === true, () => JSON.stringify([r1, r2]));
    check(
      "a second client does not inherit the first's token cache",
      f1.calls.some(isTokenExchange) && f2.calls.some(isTokenExchange),
      () => JSON.stringify([f1.calls, f2.calls]),
    );
  }
}

// The build directory is wiped in `.finally`, not in `.then`, and the failure
// paths set `process.exitCode` rather than calling `process.exit` — which would
// terminate before `finally` ever ran. A THROWING run used to leave
// tests/services/.test-build-github-app/ behind, which is how untracked
// transpiler output ends up in a working tree somebody then commits.
// `main()` runs INSIDE the chain, not before it: called outside, a throw there
// — transpiling the module under test is the likeliest place for one — escaped
// the chain entirely and `finally` never ran, which is precisely the case the
// paragraph above claims to cover.
Promise.resolve()
  .then(main)
  .then(asyncMain)
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} check(s) failed.`);
      process.exitCode = 1;
      return;
    }
    console.log("\nAll github-app checks passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  });
