/**
 * `arkaik live --platform <p> [--detail <text>] [--mentions <file>] [--paths <prefixes>] [--dry-run] [AC-id …]`
 *
 * Mark the acceptances a deploy carried `live` on one platform, through the
 * #424 door (`POST /api/graph/projects/{id}/live`, scope `release:append`).
 *
 * Ids come from the positional arguments and from `--mentions <file>`: a JSON
 * array with one `{ number, title, body, files }` per merged pull request,
 * which the mark-live workflow assembles with `gh`. Each PR is read with the
 * same `AC-id@platform` grammar the GitHub App applies on merge
 * (`mentionedAcceptances`, @arkaik/schema):
 *   - an explicit `@<platform>` mention counts;
 *   - a mention of another platform never does;
 *   - an unknown suffix (`@android-tv`) is reported, never guessed;
 *   - a BARE mention (`AC-x`) counts only when there is no `--paths`, or when
 *     one of that PR's changed files sits under a given prefix — the webhook's
 *     path-scoped-link rule, applied from the deploy side. In a monorepo an
 *     iOS-only PR that forgot `@ios` must not mark web live.
 *
 * An inferred id the door refuses is dropped with a warning and the batch
 * resent — the webhook's rule for inferred scopes; an explicit `@platform`
 * claim that is refused is still fatal. "Inferred" means the id counted ONLY
 * through a bare mention: the door answers `platform_not_applicable` (the
 * acceptance does not list this platform) or `unknown_node` (a Lab Note
 * `nodes:` id from another project), and the webhook would have filtered
 * either out rather than block every other mark in the deploy.
 *
 * A deploy that carried no acceptance is normal: "nothing to mark", exit 0.
 * A refusal or any non-2xx from the door is a failure, exit 1 — the workflow
 * step goes red instead of reporting green while nothing went live.
 *
 * The project id and remote come from docs/arkaik/arkaik.json (`arkaik link`);
 * the token from $ARKAIK_TOKEN, never from a file.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { PLATFORM_IDS, isPlatformId, mentionedAcceptances, type PlatformId } from "@arkaik/schema";

const LINK_FILE = "docs/arkaik/arkaik.json";
const DEFAULT_BASE_URL = "https://arkaik.app";
/** The door's per-request cap (lib/services/graph/live.ts MAX_ENTRIES). */
const MAX_ENTRIES_PER_REQUEST = 50;
/** The flags `live` understands; any other `--…` argument (including `--flag=value`) is refused. */
const KNOWN_FLAGS = new Set(["--platform", "--detail", "--mentions", "--paths", "--remote", "--dry-run", "--help"]);
/** Of those, the ones that consume the next argument. */
const VALUED_FLAGS = new Set(["--platform", "--detail", "--mentions", "--paths", "--remote"]);
/** Refusal reasons that, on an INFERRED id, mean "the webhook would have filtered this out". */
const DROPPABLE_REASONS = new Set(["platform_not_applicable", "unknown_node"]);
/** A positional argument must look like an acceptance id; anything else is a misplaced flag value. */
const ACCEPTANCE_ID = /^AC-[A-Za-z0-9._-]+$/;

const USAGE = `arkaik live — mark the acceptances a deploy carried live on one platform

Usage:
  arkaik live --platform <web|ios|android> [options] [AC-id ...]

Options:
  --platform <id>     Required. The platform that went live.
  --detail <text>     Evidence to record on the status change: a deploy URL, a build number.
  --mentions <file>   JSON array of merged pull requests: [{ number, title, body, files }].
                      Acceptances mentioned as AC-id@<platform> count; bare AC-id mentions
                      count only when the PR touched one of --paths (or --paths is absent).
  --paths <prefixes>  Comma-separated path prefixes that make a bare mention count (apps/web).
  --dry-run           Print the entries and send nothing.
  --remote <url>      Instance origin. Default: $ARKAIK_URL, else the link file's remote, else ${DEFAULT_BASE_URL}
  -h, --help          Show this help.

Environment:
  ARKAIK_TOKEN        Required. A release:append token from <origin>/settings/tokens.

Reads ${LINK_FILE} for the project id. Exit 0 when nothing needs marking; exit 1 on a refusal or any failed request.`;

export interface RunLiveOptions {
  /** Injectable for tests; defaults to the global fetch. */
  httpClient?: typeof fetch;
  cwd?: string;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
  errorLog?: (message: string) => void;
}

export interface LiveResult {
  ok: boolean;
  /** The ids the command resolved to mark, after derivation and dedupe. */
  ids?: string[];
}

/** One merged pull request, as the mark-live workflow writes it. */
export interface MentionedPullRequest {
  number: number;
  title: string;
  body: string;
  files: string[];
}

export interface DerivedLiveIds {
  ids: string[];
  /** Unknown platform suffixes, one line each, naming the PR. */
  warnings: string[];
  /**
   * The subset of `ids` that counted ONLY through a bare mention — no PR claims
   * them as `@<platform>` for this deploy's platform. The door may refuse these
   * (`platform_not_applicable`, `unknown_node`); `runLive` drops them and
   * resends instead of failing, as the webhook filters an inferred scope.
   */
  inferred: string[];
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index !== -1 ? argv[index + 1] : undefined;
}

/**
 * `apps/web`, `./apps/web` and `apps/web/` all mean the directory; a prefix
 * matches whole path segments. Null when nothing is left (`/`, `./`).
 */
function normalisePrefix(prefix: string): string | null {
  const trimmed = prefix.trim().replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? null : `${trimmed}/`;
}

/** Whether any changed file sits under one of the (normalised) prefixes. */
function touchesAny(files: readonly string[], prefixes: readonly string[]): boolean {
  return files.some((file) => prefixes.some((prefix) => file.startsWith(prefix)));
}

/**
 * The ids a deploy of `platform` carried, read from merged pull requests with
 * the webhook's grammar. Pure; exported for tests and for anything else that
 * wants the rule without the request.
 */
export function deriveLiveIds(
  prs: readonly MentionedPullRequest[],
  platform: PlatformId,
  paths: readonly string[],
): DerivedLiveIds {
  const prefixes = paths.map(normalisePrefix).filter((p): p is string => p !== null);
  const ids: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const explicit = new Set<string>();
  for (const pr of prs) {
    const scan = mentionedAcceptances({ title: pr.title ?? "", body: pr.body ?? "" });
    for (const unknown of scan.unknown) {
      warnings.push(`#${pr.number || "?"}: ${unknown.id}@${unknown.platform} names no platform arkaik knows — ignored`);
    }
    for (const mention of scan.mentions) {
      if (mention.platform === platform) explicit.add(mention.id);
      // No --paths means every PR's bare mentions count (a single-platform repo).
      const counts =
        mention.platform === platform ||
        (mention.platform === null && (prefixes.length === 0 || touchesAny(pr.files ?? [], prefixes)));
      if (!counts || seen.has(mention.id)) continue;
      seen.add(mention.id);
      ids.push(mention.id);
    }
  }
  return { ids, warnings, inferred: ids.filter((id) => !explicit.has(id)) };
}

function readMentions(file: string): MentionedPullRequest[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { error: `Could not read ${file}: ${(e as Error).message}` };
  }
  if (!Array.isArray(parsed)) return { error: `${file} must be a JSON array of pull requests` };
  const prs: MentionedPullRequest[] = [];
  for (const [i, raw] of parsed.entries()) {
    if (typeof raw !== "object" || raw === null) return { error: `${file}[${i}] must be an object` };
    const r = raw as Record<string, unknown>;
    prs.push({
      number: typeof r.number === "number" && Number.isFinite(r.number) ? r.number : 0,
      title: typeof r.title === "string" ? r.title : "",
      body: typeof r.body === "string" ? r.body : "",
      files: Array.isArray(r.files) ? r.files.filter((f): f is string => typeof f === "string") : [],
    });
  }
  return prs;
}

function describeFailure(status: number, baseUrl: string, body: LiveResponse): string {
  if (status === 401) return `Unauthorized — check ARKAIK_TOKEN (create one at ${baseUrl}/settings/tokens).`;
  if (status === 403) return "Forbidden — this token lacks the release:append scope (or graph:write).";
  if (status === 404) return `No linked project in this account — check ${LINK_FILE}.`;
  if (status === 409) return "The project changed under every retry — run again.";
  return `Request failed (${status})${body.message ? ` — ${body.message}` : body.error ? ` — ${body.error}` : ""}.`;
}

interface LiveResponse {
  version?: string;
  applied?: Array<{ node_id: string; platform: string; from: string; to: string }>;
  skipped?: Array<{ index: number; node_id: string; platform: string; reason: string }>;
  refusals?: Array<{ index: number; node_id: string; platform: string; reason: string; detail?: string }>;
  error?: string;
  message?: string;
}

export async function runLive(argv: string[], options: RunLiveOptions = {}): Promise<LiveResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const errorLog = options.errorLog ?? ((m: string) => console.error(m));
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const doFetch = options.httpClient ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  if (argv.includes("--help") || argv.includes("-h")) {
    log(USAGE);
    return { ok: true };
  }

  // Argument shape first: a `--platform=web` must read as an unknown flag, not as a missing --platform.
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUED_FLAGS.has(arg)) { i++; continue; }
    if (arg.startsWith("--")) {
      if (KNOWN_FLAGS.has(arg)) continue;
      errorLog(`Unknown flag ${arg}. Flags take a separate value (--mentions file.json), see arkaik live --help.`);
      return { ok: false };
    }
    if (arg.includes("@")) {
      errorLog(`"${arg}": positional ids take no @platform — the platform comes from --platform.`);
      return { ok: false };
    }
    if (!ACCEPTANCE_ID.test(arg)) {
      errorLog(`"${arg}" is not an acceptance id (they start with AC-). Flags take one value each; see arkaik live --help.`);
      return { ok: false };
    }
    positional.push(arg);
  }

  const platformArg = flagValue(argv, "--platform");
  if (!platformArg) {
    errorLog(`--platform is required: arkaik live --platform <${PLATFORM_IDS.join("|")}> …`);
    return { ok: false };
  }
  if (!isPlatformId(platformArg)) {
    errorLog(`"${platformArg}" is not a platform. Expected one of: ${PLATFORM_IDS.join(", ")}.`);
    return { ok: false };
  }
  const platform: PlatformId = platformArg;
  const detail = flagValue(argv, "--detail");
  const mentionsFile = flagValue(argv, "--mentions");
  const paths = (flagValue(argv, "--paths") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const dryRun = argv.includes("--dry-run");

  const linkPath = join(cwd, LINK_FILE);
  let link: { project_id?: string; remote?: string };
  try {
    link = JSON.parse(readFileSync(linkPath, "utf8")) as { project_id?: string; remote?: string };
  } catch {
    errorLog(`No ${LINK_FILE}. Run \`arkaik link --project <id>\` first — live only targets hosted projects.`);
    return { ok: false };
  }
  const projectId = link.project_id;
  if (!projectId) {
    errorLog(`${LINK_FILE} has no project_id. Run \`arkaik link --project <id>\`.`);
    return { ok: false };
  }
  const baseUrl = (flagValue(argv, "--remote") ?? env.ARKAIK_URL ?? link.remote ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => { if (!seen.has(id)) { seen.add(id); ids.push(id); } };
  for (const id of positional) add(id);
  // Ids that may be dropped on a platform_not_applicable / unknown_node refusal. A positional id
  // is an explicit claim by whoever ran the command, so it is never inferred.
  const inferred = new Set<string>();
  if (mentionsFile) {
    // resolve, not join: the workflow (and the tests) may pass an absolute path.
    const prs = readMentions(resolve(cwd, mentionsFile));
    if (!Array.isArray(prs)) {
      errorLog(prs.error);
      return { ok: false };
    }
    const derived = deriveLiveIds(prs, platform, paths);
    for (const warning of derived.warnings) errorLog(`warning: ${warning}`);
    for (const id of derived.ids) add(id);
    for (const id of derived.inferred) if (!positional.includes(id)) inferred.add(id);
  }

  if (ids.length === 0) {
    log(`Nothing to mark live on ${platform}.`);
    return { ok: true, ids };
  }

  // An empty --detail (a workflow input left blank) is no evidence at all; the door refuses "".
  const hasDetail = detail !== undefined && detail !== "";
  const entries = ids.map((node_id) => ({ node_id, platform, ...(hasDetail ? { detail } : {}) }));
  if (dryRun) {
    log(`Would mark ${platform} live for ${ids.length} acceptance(s) on ${projectId} (${baseUrl}):`);
    for (const entry of entries) log(`  ${entry.node_id}@${platform}${hasDetail ? ` — ${detail}` : ""}`);
    return { ok: true, ids };
  }

  const token = env.ARKAIK_TOKEN;
  if (!token) {
    errorLog(`ARKAIK_TOKEN is not set. Create a release:append token at ${baseUrl}/settings/tokens and export it.`);
    return { ok: false };
  }

  const post = async (chunk: typeof entries): Promise<{ res: Response; body: LiveResponse } | null> => {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/api/graph/projects/${encodeURIComponent(projectId)}/live`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ entries: chunk }),
      });
    } catch (e) {
      errorLog(`Could not reach ${baseUrl}: ${(e as Error).message}`);
      return null;
    }
    let body: LiveResponse = {};
    try { body = (await res.json()) as LiveResponse; } catch { /* a non-JSON error body */ }
    return { res, body };
  };

  /** Entries that earlier requests got through (applied or skipped), for an honest refusal header. */
  let landed = 0;
  for (let start = 0; start < entries.length; start += MAX_ENTRIES_PER_REQUEST) {
    const end = Math.min(start + MAX_ENTRIES_PER_REQUEST, entries.length) - 1;
    // Each entry keeps its index in the whole batch, so a refusal on a resent (shorter) chunk still names it.
    let chunk = entries.slice(start, end + 1).map((entry, i) => ({ entry, at: start + i }));
    let resent = false;
    for (;;) {
      const sent = await post(chunk.map((c) => c.entry));
      if (!sent) return { ok: false, ids };
      const { res, body } = sent;
      if (res.status === 422 && body.refusals) {
        const refusals = body.refusals;
        // The webhook's rule: an inferred scope the project does not list is filtered, not fatal.
        // Once only — a second refusal on the resend is a real one.
        const droppable =
          !resent && refusals.every((r) => DROPPABLE_REASONS.has(r.reason) && inferred.has(r.node_id));
        if (droppable) {
          const dropped = new Set<string>();
          for (const r of refusals) {
            errorLog(`warning: ${r.node_id}@${r.platform} was inferred from a bare mention and the project does not list it that way (${r.reason}) — dropped`);
            dropped.add(r.node_id);
          }
          chunk = chunk.filter((c) => !dropped.has(c.entry.node_id));
          resent = true;
          if (chunk.length === 0) {
            log(`Nothing left to send in entries ${start}–${end} after dropping inferred ids.`);
            break;
          }
          continue;
        }
        // Each request is atomic, but earlier requests have already landed.
        errorLog(
          landed > 0
            ? `Refused — entries ${start}–${end} wrote nothing; the ${landed} before them were applied above (a re-run skips them):`
            : "Refused — nothing was written:",
        );
        for (const r of refusals) {
          const at = chunk[r.index]?.at ?? start + r.index;
          errorLog(`  entries[${at}] ${r.node_id}@${r.platform}: ${r.reason}${r.detail ? ` — ${r.detail}` : ""}`);
        }
        errorLog("Re-run with the other ids as arguments — acceptances already live are skipped, so a retry is safe.");
        return { ok: false, ids };
      }
      if (!res.ok) {
        // A 422 without refusals (invalid_bundle, mutation_refused) lands here too, with its message.
        errorLog(describeFailure(res.status, baseUrl, body));
        return { ok: false, ids };
      }
      for (const a of body.applied ?? []) log(`${a.node_id}: ${a.from} → ${a.to} [${a.platform}]`);
      for (const sk of body.skipped ?? []) log(`${sk.node_id}: already live [${sk.platform}]`);
      landed += chunk.length;
      break;
    }
  }
  return { ok: true, ids };
}

export function runLiveCli(argv: string[]): void {
  void runLive(argv).then((result) => {
    if (!result.ok) process.exit(1);
  });
}
