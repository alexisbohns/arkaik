import "server-only";

import { createPrivateKey, createSign } from "node:crypto";

/**
 * The only place in arkaik that calls the GitHub API *back*.
 *
 * Everything else about the webhook reads the delivery payload and stops there.
 * Path-scoped repository links cannot: deciding whether a pull request belongs
 * to `apps/ios` or `apps/webapp` needs the list of files it changed, and that
 * list is not in the payload. So this module authenticates as the GitHub App,
 * exchanges that for an installation token, and reads
 * `GET /repos/{owner}/{repo}/pulls/{number}/files`.
 *
 * ── NO NEW DEPENDENCY ──────────────────────────────────────────────────────
 * The App JWT is RS256, which node's own `crypto.createSign("RSA-SHA256")`
 * produces directly — its default padding IS PKCS#1 v1.5, i.e. exactly RS256,
 * so no padding option is passed and none should be added. A JWT library for
 * one 20-line signature would be a supply-chain surface for nothing.
 *
 * ── THE PERMISSION ─────────────────────────────────────────────────────────
 * The files endpoint is a sub-resource of a pull request and needs
 * **Pull requests: Read**, which the arkaik App already requests
 * (docs/hosted-projects.md step 4). No permission change and no reinstall.
 * Nothing here reads a blob: only `filename` and `previous_filename` are ever
 * looked at — never `patch`, never `raw_url`, never `contents_url` — so no
 * Contents permission is involved for what this code does. That claim is not
 * left as an assertion either: the token exchange asks for `pull_requests:
 * read` explicitly and the response's granted permissions are checked, so a
 * misconfigured App fails with a message naming the permission instead of a
 * bare 403 much later.
 *
 * ── DETERMINISTIC IS A VALUE, TRANSIENT IS A THROW ─────────────────────────
 * The two kinds of failure are separated BY TYPE, not by inspecting a message,
 * because the caller must do opposite things with them:
 *
 *   - a missing env var, an unparseable key, a key that is not RSA, a revoked
 *     installation — no retry will ever fix these, so they come back as
 *     `{ ok: false, reason }`, a value the caller has to destructure, and are
 *     reported to the user;
 *   - a 5xx, a socket error, a rate limit — a retry plausibly fixes these, so
 *     they are THROWN as `GithubTransientError`, which
 *     app/api/github/webhook/route.ts catches, releasing the delivery claim so
 *     GitHub's redelivery can redo the work.
 *
 * A caller cannot accidentally retry a missing env var, and cannot accidentally
 * report a retryable failure as a permanent one, because neither value is ever
 * in a shape where that is spellable.
 */

/**
 * GitHub's cap on this endpoint, in FILES. Beyond it, the list is incomplete.
 *
 * FILES, NOT PATHS, and the distinction is not pedantic: a rename contributes
 * TWO paths (`filename` and `previous_filename`), so comparing this to a path
 * count made a pull request of 1500 renames read as 3000 "files" and stop
 * paginating at half of GitHub's real cap. The pages never read are exactly
 * where the only files inside a linked prefix may live, and the delivery would
 * report truncation of a pull request that was never truncated.
 */
const MAX_FILES = 3000;
/** 100 is the endpoint's maximum; the default of 30 would triple the requests. */
const PER_PAGE = 100;
/** MAX_FILES / PER_PAGE. A second bound so a broken `Link` header cannot loop. */
const MAX_PAGES = MAX_FILES / PER_PAGE;
/** Each request. A webhook handler that hangs is a delivery GitHub gives up on. */
const REQUEST_TIMEOUT_MS = 5_000;
/**
 * The WHOLE resolution — token exchange and every page — not each request.
 *
 * A per-request timeout bounds one request and says nothing about 31 of them in
 * a row. The failure that matters is not a slow GitHub: it is the SERVERLESS
 * HOST killing the function mid-pagination at its own 10-15 second limit. The
 * delivery is claimed by then, `releaseDelivery` never runs because nothing
 * catches a process that was killed, and GitHub's redelivery sees the claim and
 * skips — the transition is lost permanently, which is the single failure the
 * release-on-failure posture exists to prevent.
 *
 * 9 seconds, so that a host limit of 10 still has headroom. The budget is spent
 * as a GO/NO-GO before each request rather than as an abort during one: a page
 * is started only if a full `REQUEST_TIMEOUT_MS` still fits inside the budget,
 * which makes "nothing this function starts can finish after the deadline" a
 * property rather than an estimate, and means an exhausted budget never has to
 * be told apart from a cancelled request.
 *
 * Exhaustion is TRUNCATION, not a transient throw. A throw would release the
 * claim and GitHub would redeliver the same enormous pull request into the same
 * budget, forever — a deterministic failure dressed as a retryable one. As
 * truncation it is a value: what matched is still real, "nothing matched" is
 * explicitly not evidence, and `resolveRepoScope` already refuses and reports
 * that case (lib/services/github/pull-request.ts, rule c/d).
 */
const RESOLUTION_BUDGET_MS = 9_000;
/** An installation token lasts an hour; treated as expired a minute early. */
const TOKEN_SKEW_MS = 60_000;
const API_ROOT = "https://api.github.com";

/**
 * WHY THE LIST ARKAIK HOLDS IS NOT THE WHOLE LIST — one value per distinct
 * cause, rather than one boolean for all three.
 *
 * THREE UNRELATED THINGS make a file list incomplete here, and a boolean cannot
 * tell them apart. It used to be one, and the warning built on it asserted
 * GitHub's 3000-file cap as the cause in all three cases — so a pull request of
 * eleven files whose second page timed out was reported to its author as
 * "changes more files than GitHub will list", which is a sentence about a pull
 * request that does not exist. The cause travels with the flag so that every
 * report can name the one it actually observed:
 *
 *   - `github-file-cap`   — GitHub stops listing at MAX_FILES files;
 *   - `time-budget`       — RESOLUTION_BUDGET_MS ran out before the next page
 *                           could START (see that constant: exhaustion is
 *                           truncation, never a throw);
 *   - `unreadable-entry`  — an item came back in a shape `parseFilesPage` could
 *                           not read, so its path is missing from a page that
 *                           was otherwise fine.
 *
 * They are not mutually exclusive: a run can hit the cap AND drop an entry, so
 * this is a list rather than a single value, and reporting one of two observed
 * causes would be the same defect one level down.
 */
export type IncompleteCause = "github-file-cap" | "time-budget" | "unreadable-entry";

/**
 * The changed paths of one pull request.
 *
 * `incomplete` is EMPTY when the list is whole. A non-empty list is safe in
 * exactly ONE direction, and the caller depends on that: a missing file can
 * only REMOVE a match, never manufacture one. So platforms found in an
 * incomplete list are real (a missing claim at worst), while "nothing matched"
 * in one is not evidence of anything and must not be treated as one — and
 * neither is "this platform is absent", which is why
 * `lib/services/github/pull-request.ts` removes no ref on an incomplete list.
 */
export interface ChangedFiles {
  /** `filename` and, for a rename, `previous_filename` too. Deduped, sorted. */
  paths: string[];
  /** Empty means COMPLETE. Sorted, so a report's wording is deterministic. */
  incomplete: IncompleteCause[];
}

/**
 * Deterministic outcomes are VALUES. `reason` is the exact sentence the
 * delivery response shows in GitHub's Recent Deliveries — the only report
 * channel this feature has — so it names the variable to set or the setting to
 * change, not just what went wrong.
 */
export type ChangedFilesResult =
  | { ok: true; changed: ChangedFiles }
  | { ok: false; reason: string };

/** A failure a redelivery could plausibly fix. Thrown, never returned. */
export class GithubTransientError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GithubTransientError";
    this.status = status;
  }
}

/**
 * A private key as the environment mangled it, turned back into a PEM.
 *
 * Two manglings are repaired, and each repair is safe because of a property of
 * PEM itself rather than because of a guess about the input:
 *
 *   - SURROUNDING QUOTES, from a `.env` file or a secret store that wraps
 *     multi-line values. A PEM never begins with `"` or `'`.
 *   - LITERAL `\n` / `\r\n` ESCAPES, from a host whose secret store holds only
 *     single-line values — by far the commonest deployment mistake here, and
 *     one whose native failure is `ERR_OSSL_UNSUPPORTED: DECODER routines::
 *     unsupported`, which names nothing a human can act on. The replacement is
 *     UNCONDITIONAL rather than "only if there are no real newlines": no PEM
 *     header, footer, or base64 body character is a backslash, so a well-formed
 *     key cannot lose information here. That is the invariant; the conditional
 *     version is a guess about which mangling happened.
 *
 * Nothing else is guessed at. A base64-encoded copy of the whole file is
 * repairable in principle and is deliberately NOT repaired: each further
 * encoding accepted is one more branch in a game that has no end, and the
 * message below names it instead so the operator can act.
 */
export function normalizePrivateKeyPem(raw: string): string {
  let key = raw.trim();
  if (
    key.length >= 2 &&
    ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\r/g, "").replace(/\\n/g, "\n");
}

export type AppReadiness =
  | { ok: true; appId: string; privateKeyPem: string }
  | { ok: false; message: string };

/**
 * Whether this deployment can call the GitHub API back, and if not, why — in a
 * sentence that is shown to whoever opens Recent Deliveries.
 *
 * READ AT CALL TIME, never at module import: the same posture as
 * `servicesConfigured()` in lib/services/db.ts, so a deployment that adds the
 * key does not need a code path to have been imported after it.
 *
 * The key is PARSED here rather than merely inspected. A marker check would
 * accept a PEM whose newlines were stripped entirely — the BEGIN line is still
 * there — and the failure would surface later as a crypto stack trace in the
 * server log instead of as a sentence in the delivery response.
 */
export function appReadiness(
  env: { appId?: string | null; privateKey?: string | null } = {},
): AppReadiness {
  const appId = (env.appId ?? process.env.GITHUB_APP_ID ?? "").trim();
  const rawKey = env.privateKey ?? process.env.GITHUB_APP_PRIVATE_KEY ?? "";

  const missing: string[] = [];
  if (!appId) missing.push("GITHUB_APP_ID");
  if (!rawKey.trim()) missing.push("GITHUB_APP_PRIVATE_KEY");
  if (missing.length > 0) {
    return {
      ok: false,
      message:
        `path-scoped repository links need arkaik to read the pull request's changed files, and ` +
        `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set on this deployment. ` +
        `Set ${missing.length > 1 ? "them" : "it"} and redeploy, then edit or push to the pull ` +
        `request to re-deliver.`,
    };
  }

  const privateKeyPem = normalizePrivateKeyPem(rawKey);
  let keyType: string | undefined;
  try {
    // PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`, what GitHub's "Generate a
    // private key" button downloads) and PKCS#8 are both accepted by
    // `createPrivateKey` and sign identically, so no format check is made and
    // no conversion should ever be instructed.
    keyType = createPrivateKey(privateKeyPem).asymmetricKeyType;
  } catch {
    return {
      ok: false,
      message:
        `GITHUB_APP_PRIVATE_KEY is set but could not be read as a PEM private key. Paste the .pem ` +
        `file contents verbatim, including the "-----BEGIN" and "-----END" lines; literal \\n ` +
        `escapes are accepted and converted, but a base64-encoded copy of the file is not.`,
    };
  }

  // THE ALGORITHM, NOT JUST THE ENCODING — and decided HERE, at the one place
  // readiness is determined, because a non-RSA key is a DETERMINISTIC
  // misconfiguration and this is where those become values instead of throws.
  //
  // "Parses as a PEM" is not the same question as "can sign RS256". The way
  // this happens in practice is a TLS or SSH key pasted into the wrong secret,
  // and node treats the two common ones DIFFERENTLY — both badly, in ways
  // pinned in tests/services/github-app.test.js:
  //
  //   - an ED25519 key makes `createSign("RSA-SHA256").sign()` THROW
  //     (`ERR_CRYPTO_UNSUPPORTED_OPERATION`) at signing time, deep inside a
  //     claimed delivery. That throw is not a `GithubTransientError`, but
  //     nothing distinguishes it from one at the catch site: route.ts releases
  //     the claim, GitHub redelivers, and the identical broken secret throws
  //     again, for as long as GitHub keeps retrying;
  //   - an EC key does NOT throw. `createSign("RSA-SHA256")` signs with ECDSA
  //     and returns 70-odd bytes, so a well-formed JWT carrying a signature
  //     GitHub cannot verify goes out, comes back 401, and is reported as
  //     "GitHub rejected arkaik's App credentials. Check GITHUB_APP_ID and
  //     GITHUB_APP_PRIVATE_KEY, and that this deployment's clock is correct."
  //     — true, unretried, and pointing at three things when the answer is one.
  //
  // One check covers both, and it is a WHITELIST of the two RSA variants rather
  // than a blacklist of the key types known to fail today: every key type that
  // is not RSA is one `createSign("RSA-SHA256")` cannot correctly use, and a
  // whitelist stays right when node learns a new one.
  if (keyType !== "rsa" && keyType !== "rsa-pss") {
    return {
      ok: false,
      message:
        `GITHUB_APP_PRIVATE_KEY is a valid PEM private key but is ${keyType ?? "of an unknown type"}, ` +
        `not RSA, so it cannot produce the RS256 signature a GitHub App JWT requires. This is what a ` +
        `TLS or SSH key pasted into the wrong secret looks like. Use the .pem GitHub's "Generate a ` +
        `private key" button downloads from the App's settings page.`,
    };
  }

  return { ok: true, appId, privateKeyPem };
}

/**
 * A GitHub App JWT: RS256 over `{iat, exp, iss}`.
 *
 * `iat` is BACKDATED 60 seconds because GitHub rejects a token issued in the
 * future outright, and a server clock a second fast is enough to do that.
 *
 * `exp` is 8 minutes out, not 10. GitHub's rule is "no more than 10 minutes in
 * the future" measured against GITHUB's clock, so `now + 600` sits exactly on
 * the limit and 401s the moment the local clock runs a second ahead. The
 * stricter `exp - iat <= 600` reading some tooling applies also holds here
 * (540). Both margins cost nothing.
 *
 * Regenerated per exchange rather than cached: it is cheap, and the thing worth
 * caching is the installation token it buys.
 */
export function buildAppJwt(input: { appId: string; privateKeyPem: string; nowMs?: number }): string {
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: nowSeconds - 60, exp: nowSeconds + 480, iss: input.appId };

  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signingInput = `${encode(header)}.${encode(payload)}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  // `createSign("RSA-SHA256")` defaults to PKCS#1 v1.5 padding, which is what
  // RS256 means. Passing an explicit padding here is how someone eventually
  // switches it to PSS and gets a signature GitHub silently rejects.
  const signature = signer.sign(createPrivateKey(input.privateKeyPem)).toString("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * The paths one page of the files endpoint names.
 *
 * BOTH `filename` AND `previous_filename` count. A rename reports the new path
 * as `filename` and the old one as `previous_filename`, and a file MOVED OUT of
 * `apps/ios` is a change to `apps/ios` — the same evidence a deletion is. Taking
 * only `filename` would make a directory reorganisation systematically
 * under-report the tree it moved away from.
 *
 * `status` is NOT filtered on, at all. A removed file is still a changed path —
 * deleting `apps/ios/Foo.swift` is an iOS change — and a whitelist of statuses
 * goes stale the first time GitHub adds a value to that enum.
 *
 * A malformed item is COUNTED, not thrown on: `dropped` becomes truncation at
 * the caller, because an item that could not be read has exactly the same
 * consequence as one that was never returned — the list is incomplete.
 *
 * `files` IS RETURNED SEPARATELY FROM `paths.length`, and that is the whole
 * point of it. One entry is one FILE and may yield two paths, so the two
 * numbers differ by exactly the number of renames on the page. `files` is what
 * `MAX_FILES` — GitHub's own cap, expressed in files — has to be compared
 * against; `paths.length` is what the matcher consumes. Counting a rename twice
 * against the cap stopped pagination at half the real limit on a
 * reorganisation, which is precisely the kind of pull request whose later pages
 * decide a platform. It counts entries GitHub RETURNED, dropped ones included:
 * an entry arkaik could not read still spent one of GitHub's 3000.
 */
export function parseFilesPage(body: unknown): { paths: string[]; files: number; dropped: number } {
  if (!Array.isArray(body)) return { paths: [], files: 0, dropped: 1 };
  const paths: string[] = [];
  let dropped = 0;
  for (const entry of body) {
    const item = entry as { filename?: unknown; previous_filename?: unknown } | null;
    if (!item || typeof item !== "object" || typeof item.filename !== "string" || item.filename === "") {
      dropped += 1;
      continue;
    }
    paths.push(item.filename);
    if (typeof item.previous_filename === "string" && item.previous_filename !== "") {
      paths.push(item.previous_filename);
    }
  }
  return { paths, files: body.length, dropped };
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export interface GithubAppOptions {
  /** Tests inject; production uses the global fetch. */
  fetchImpl?: typeof fetch;
  /** Tests inject; production uses Date.now. */
  nowMs?: () => number;
  /** Defaults to process.env, read at call time. */
  appId?: string | null;
  privateKey?: string | null;
}

export interface PullRequestRef {
  repoFullName: string;
  number: number;
  installationId: string | null;
}

export interface GithubApp {
  listPullRequestFiles(pr: PullRequestRef): Promise<ChangedFilesResult>;
}

/**
 * A GitHub App client.
 *
 * THE INSTALLATION-TOKEN CACHE LIVES ON THE INSTANCE, not at module scope —
 * the `createRemoteProvider({ fetchImpl })` precedent. Two scenarios in one
 * test suite then cannot share state, and there is no `__resetForTests` export
 * sitting in production code.
 *
 * It is an optimisation and never a correctness input: a cold serverless
 * process simply exchanges again, and an entry within a minute of expiry is
 * treated as gone. Concurrent exchanges are deliberately NOT deduped — GitHub
 * does not invalidate a previously issued installation token when it mints a
 * new one, so a duplicate exchange is harmless, and the machinery to prevent it
 * would be the more interesting thing to get wrong. The map grows with the
 * number of LIVE installations a process sees; there is no eviction beyond
 * dropping expired entries as they are looked up.
 */
export function createGithubApp(options: GithubAppOptions = {}): GithubApp {
  return buildGithubApp(options);
}

let shared: GithubApp | null = null;

/**
 * The process-wide client, created on first use.
 *
 * This is what makes the installation-token cache mean anything: a client built
 * per delivery would exchange a fresh token every time and the cache would be
 * write-only. It is safe to hold across deliveries because it reads its
 * credentials from `process.env` AT CALL TIME — the module-level value caches
 * the token map, not the configuration.
 *
 * A cold serverless process simply starts with an empty map and exchanges
 * again, which is why the cache is an optimisation and never a correctness
 * input. Tests build their own with `createGithubApp({ fetchImpl })` and never
 * touch this one.
 */
export function githubApp(): GithubApp {
  shared ??= buildGithubApp({});
  return shared;
}

function buildGithubApp(options: GithubAppOptions): GithubApp {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.nowMs ?? (() => Date.now());
  const tokenCache = new Map<string, CachedToken>();

  /**
   * Every outbound request, in one place.
   *
   * A network error, a socket reset and an abort all land in the catch, and all
   * three are transient by definition — nothing was learned about the
   * repository, and the same request may well succeed on GitHub's redelivery.
   */
  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          // GitHub refuses requests with no User-Agent, and node's global fetch
          // sends a bare `node`. Naming arkaik costs one header and makes the
          // App's traffic identifiable in GitHub's own logs.
          "user-agent": "arkaik",
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new GithubTransientError(
        `GitHub request failed: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  /** 403 is both "forbidden" and "rate limited"; only the headers tell them apart. */
  function isRateLimited(res: Response): boolean {
    return res.headers.get("x-ratelimit-remaining") === "0" || res.headers.get("retry-after") !== null;
  }

  /** 5xx and 429 are transient wherever they appear; encoded once. */
  function throwIfTransient(res: Response, what: string): void {
    if (res.status >= 500 || res.status === 429) {
      throw new GithubTransientError(`GitHub returned ${res.status} for ${what}`, res.status);
    }
  }

  async function installationToken(
    pr: PullRequestRef,
    readiness: Extract<AppReadiness, { ok: true }>,
    installationId: string,
    { fresh }: { fresh: boolean },
  ): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
    // Scoped to the one repository and the one permission, so a leaked token
    // reads one repository's pull requests and nothing else — which is why the
    // cache key carries the repository as well as the installation.
    const cacheKey = `${installationId}/${pr.repoFullName}`;
    if (fresh) tokenCache.delete(cacheKey);

    const cached = tokenCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAtMs - TOKEN_SKEW_MS > now()) return { ok: true, token: cached.token };
      tokenCache.delete(cacheKey);
    }

    const jwt = buildAppJwt({
      appId: readiness.appId,
      privateKeyPem: readiness.privateKeyPem,
      nowMs: now(),
    });
    const res = await request(`${API_ROOT}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        repositories: [pr.repoFullName.split("/")[1] ?? pr.repoFullName],
        permissions: { pull_requests: "read" },
      }),
    });

    throwIfTransient(res, "the installation-token exchange");
    if (res.status === 403 && isRateLimited(res)) {
      throw new GithubTransientError("GitHub rate-limited the installation-token exchange", 403);
    }

    if (res.status === 401) {
      return {
        ok: false,
        reason:
          `GitHub rejected arkaik's App credentials. Check GITHUB_APP_ID and ` +
          `GITHUB_APP_PRIVATE_KEY, and that this deployment's clock is correct.`,
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        reason:
          `the arkaik GitHub App installation ${installationId} no longer exists, so the pull ` +
          `request's changed files cannot be read. Reinstall the App on ${pr.repoFullName}.`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason:
          `GitHub refused to issue an installation token for ${pr.repoFullName} (HTTP ${res.status}). ` +
          `The arkaik GitHub App needs "Pull requests: Read" on this repository.`,
      };
    }

    const body = (await res.json().catch(() => null)) as {
      token?: unknown;
      expires_at?: unknown;
      permissions?: { pull_requests?: unknown };
    } | null;
    if (!body || typeof body.token !== "string") {
      return { ok: false, reason: `GitHub returned an installation token arkaik could not read.` };
    }
    // The runtime half of this module's permission claim: rather than asserting
    // in a doc that "Pull requests: Read" is enough, ask for it and check it was
    // granted. A misconfigured App then names the permission here instead of
    // producing a bare 403 one request later.
    if (body.permissions?.pull_requests === undefined) {
      return {
        ok: false,
        reason:
          `the arkaik GitHub App's token for ${pr.repoFullName} does not carry ` +
          `"Pull requests: Read", which is the permission the pull-request files API needs. ` +
          `Grant it in the App's repository permissions.`,
      };
    }

    const expiresAtMs = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : NaN;
    tokenCache.set(cacheKey, {
      token: body.token,
      // An unreadable `expires_at` is treated as "expires now", so the token is
      // used for this delivery and never cached — the safe direction, since a
      // cached token that outlives its real expiry costs a failed delivery.
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : now(),
    });
    return { ok: true, token: body.token };
  }

  return {
    async listPullRequestFiles(pr: PullRequestRef): Promise<ChangedFilesResult> {
      /**
       * THE DEADLINE FOR THE WHOLE RESOLUTION, taken before anything is
       * requested — including the installation-token exchange.
       *
       * Starting it after the exchange would leave a 5-second request outside
       * the budget that is supposed to bound the function, and the host that
       * kills the process does not care which request was the slow one. See
       * RESOLUTION_BUDGET_MS for why exhaustion is truncation and not a throw.
       */
      const deadline = now() + RESOLUTION_BUDGET_MS;
      /**
       * Whether one more request can still START and finish inside the budget.
       *
       * Measured against the WORST case for the request about to be issued, not
       * against the time already spent, so the guarantee is "nothing started
       * here outlives the deadline" rather than "we noticed afterwards" — which
       * is what lets an exhausted budget be a plain `break` instead of an
       * aborted request that would have to be told apart from a real one.
       */
      const canAffordAnotherRequest = (): boolean => now() + REQUEST_TIMEOUT_MS <= deadline;

      const readiness = appReadiness({ appId: options.appId, privateKey: options.privateKey });
      if (!readiness.ok) return { ok: false, reason: readiness.message };

      if (!pr.installationId) {
        return {
          ok: false,
          reason:
            `this delivery carries no GitHub App installation id and none is stored for ` +
            `${pr.repoFullName}, so arkaik cannot read the pull request's changed files. A plain ` +
            `repository webhook cannot do this; install the arkaik GitHub App on the repository.`,
        };
      }

      let token = await installationToken(pr, readiness, pr.installationId, { fresh: false });
      if (!token.ok) return { ok: false, reason: token.reason };

      const [owner, name] = pr.repoFullName.split("/");
      const base =
        `${API_ROOT}/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(name ?? "")}` +
        `/pulls/${pr.number}/files`;

      const paths: string[] = [];
      let files = 0;
      let dropped = 0;
      /**
       * Every reason this list ended up short, each recorded where it happens.
       *
       * A `Set` rather than a single value: the cap and an unreadable entry can
       * both hold on one run, and picking one to report is how a warning ends
       * up naming a cause nobody observed.
       */
      const incomplete = new Set<IncompleteCause>();
      let page = 1;
      let retriedAuth = false;

      for (;;) {
        if (!canAffordAnotherRequest()) {
          // The same INCOMPLETENESS a stop-at-GitHub's-cap produces, because it
          // is the same fact — the list arkaik holds is short — but recorded as
          // its own cause, because the two are nothing alike to whoever reads
          // the delivery. It is deliberately NOT a throw; see
          // RESOLUTION_BUDGET_MS.
          incomplete.add("time-budget");
          break;
        }

        const res = await request(`${base}?per_page=${PER_PAGE}&page=${page}`, {
          headers: { authorization: `Bearer ${token.token}` },
        });

        throwIfTransient(res, `${pr.repoFullName}#${pr.number} files`);

        if (res.status === 401 && !retriedAuth) {
          // A cached token that GitHub has since invalidated. Worth exactly one
          // retry with a fresh one: a 401 on a token minted seconds ago is
          // about the credentials, and retrying that forever is a loop.
          //
          // Budgeted like any other request. Without this the exchange is one
          // more 5-second call that the loop-top guard has already been passed
          // for, and the worst case would run REQUEST_TIMEOUT_MS past the
          // deadline the guard exists to enforce.
          if (!canAffordAnotherRequest()) {
            incomplete.add("time-budget");
            break;
          }
          retriedAuth = true;
          token = await installationToken(pr, readiness, pr.installationId, { fresh: true });
          if (!token.ok) return { ok: false, reason: token.reason };
          continue;
        }
        if (res.status === 401) {
          return {
            ok: false,
            reason:
              `GitHub rejected arkaik's installation token for ${pr.repoFullName} twice. Check that ` +
              `the arkaik GitHub App is still installed on this repository.`,
          };
        }
        if (res.status === 403) {
          if (isRateLimited(res)) {
            throw new GithubTransientError(
              `GitHub rate-limited the files API for ${pr.repoFullName}#${pr.number}`,
              403,
            );
          }
          return {
            ok: false,
            reason:
              `GitHub refused the pull-request files API for ${pr.repoFullName}: the arkaik GitHub ` +
              `App needs "Pull requests: Read" on this repository.`,
          };
        }
        if (res.status === 404) {
          return {
            ok: false,
            reason:
              `the arkaik GitHub App installation cannot see ${pr.repoFullName}#${pr.number}. The ` +
              `repository may have been renamed, or the App removed from it.`,
          };
        }
        if (!res.ok) {
          return {
            ok: false,
            reason: `GitHub returned HTTP ${res.status} for ${pr.repoFullName}#${pr.number}'s changed files.`,
          };
        }

        const body = await res.json().catch(() => null);
        const parsed = parseFilesPage(body);
        dropped += parsed.dropped;
        files += parsed.files;
        for (const p of parsed.paths) paths.push(p);

        // The `Link` header is the authority on whether more pages exist. When
        // it is absent — some proxies strip it — a page that came back FULL is
        // the only remaining evidence that another one follows.
        const link = res.headers.get("link");
        const hasNext = link === null ? Array.isArray(body) && body.length >= PER_PAGE : /rel="next"/.test(link);
        if (!hasNext) break;
        // `files`, NOT `paths.length`. A rename is one file and two paths, so
        // the path count reaches MAX_FILES after half as many files and stops
        // paginating on a pull request GitHub never truncated — see MAX_FILES.
        if (page >= MAX_PAGES || files >= MAX_FILES) {
          // GitHub caps this endpoint; there is no truncation flag in the body,
          // so having stopped while more pages existed IS the flag.
          incomplete.add("github-file-cap");
          break;
        }
        page += 1;
      }

      // A malformed item has the same consequence as one never returned — the
      // list is short — but it is a DIFFERENT cause, and it can co-occur with
      // either break above, so it is added rather than folded into them.
      if (dropped > 0) incomplete.add("unreadable-entry");

      return {
        ok: true,
        changed: {
          paths: [...new Set(paths)].sort(),
          // Sorted so a report built from this reads the same on every run
          // regardless of which cause was hit first.
          incomplete: [...incomplete].sort(),
        },
      };
    },
  };
}
