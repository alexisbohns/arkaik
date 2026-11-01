/**
 * `arkaik shot [--manifest <file>] [--commit <sha>] [--order <n>] [--remote <url>] [--bundle <path>] [--dry-run] [node_id platform value]`
 *
 * Record screenshots (spec 2026-11-01). Entries come from `--manifest`, a
 * JSON array of `{ node_id, platform, url, detail? }`, and/or one positional
 * triple. Two modes, chosen by the repo:
 *
 *  - **hosted** (docs/arkaik/arkaik.json present): post the entries to
 *    `POST /api/graph/projects/{id}/screenshots` (scope `screenshot:append`),
 *    chunked by 100. `--commit` and `--order` are required — the door records
 *    CI shots only, and a CI shot without provenance is worthless. A refusal
 *    or any non-2xx is exit 1; skips (`stale_order`, `unchanged`) are
 *    reported and exit 0.
 *  - **Kommit** (no link): dual-write the local bundle through `applyOps`
 *    (`record_screenshot` op) and append the derived events to the journal
 *    sidecar — exactly what the skill does by hand. With `--commit` the shot
 *    is `source: ci` (and `--order` is required); without it, `manual`.
 *
 * The project id and remote come from docs/arkaik/arkaik.json; the token
 * from $ARKAIK_TOKEN, never from a file.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  PLATFORM_IDS,
  applyOps,
  isPlatformId,
  serializeBundle,
  toJournalEvents,
  type Edge,
  type MutationOp,
  type Node,
  type PlatformId,
} from "@arkaik/schema";
import { readBundle } from "../lib/bundle-io";
import { appendJournalEvent, ensureJournalBaseline, journalPathFor } from "../lib/journal-io";
import { renderEventLine } from "../lib/render-event";

const LINK_FILE = "docs/arkaik/arkaik.json";
const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";
const DEFAULT_BASE_URL = "https://arkaik.app";
const ACTOR = "arkaik-cli";
/** The door's per-request cap (lib/services/graph/screenshots.ts MAX_ENTRIES). */
const MAX_ENTRIES_PER_REQUEST = 100;
/** The flags `shot` understands; any other `--…` argument (including `--flag=value`) is refused. */
const KNOWN_FLAGS = new Set(["--manifest", "--commit", "--order", "--remote", "--bundle", "--dry-run", "--help"]);
/** Of those, the ones that consume the next argument. */
const VALUED_FLAGS = new Set(["--manifest", "--commit", "--order", "--remote", "--bundle"]);

const USAGE = `arkaik shot — record screenshots for views and acceptances

Usage:
  arkaik shot --manifest <file> --commit <sha> --order <n> [options]
  arkaik shot <node_id> <platform> <value> [--commit <sha> --order <n>]

Options:
  --manifest <file>   JSON array of { node_id, platform, url, detail? }.
  --commit <sha>      The commit the shots were rendered from. Required when hosted.
  --order <n>         The commit's height on the default branch (git rev-list --count). Required with --commit.
  --remote <url>      Hosted only: the instance origin. Default: $ARKAIK_URL, else the link file's remote, else ${DEFAULT_BASE_URL}
  --bundle <path>     Kommit only: the bundle to write (default: ${DEFAULT_BUNDLE_PATH}).
  --dry-run           Show what would be recorded and exit 0.
  -h, --help          Show this help.

Environment:
  ARKAIK_TOKEN        Required when hosted. A screenshot:append token from <origin>/settings/tokens.

Reads ${LINK_FILE} for the project id; without it the repo bundle is written instead.
Exit 0 when every entry is recorded or skipped; exit 1 on a refusal or any failed request.`;

export interface RunShotOptions {
  /** Injectable for tests; defaults to the global fetch. */
  httpClient?: typeof fetch;
  cwd?: string;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
  errorLog?: (message: string) => void;
}

export interface RunShotResult {
  ok: boolean;
}

interface ManifestEntry {
  node_id: string;
  platform: PlatformId;
  url: string;
  detail?: string;
}

interface DoorResponse {
  version?: string;
  applied?: Array<{ node_id: string; platform: string; url: string }>;
  skipped?: Array<{ index: number; node_id: string; platform: string; reason: string }>;
  refusals?: Array<{ index: number; node_id: string; platform: string; reason: string; detail?: string }>;
  error?: string;
  message?: string;
}

/** The URI scheme of a value (`https:`, `data:`, `http:`, …), or undefined for a bare path. */
function schemeOf(value: string): string | undefined {
  const match = /^([a-z][a-z0-9+.-]*:)/i.exec(value);
  return match === null ? undefined : match[1].toLowerCase();
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

function readManifest(file: string): ManifestEntry[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { error: `Could not read ${file}: ${(e as Error).message}` };
  }
  if (!Array.isArray(parsed)) return { error: `${file} must be a JSON array of { node_id, platform, url, detail? }` };
  const entries: ManifestEntry[] = [];
  for (const [i, raw] of parsed.entries()) {
    if (typeof raw !== "object" || raw === null) return { error: `${file}[${i}] must be an object` };
    const r = raw as Record<string, unknown>;
    if (typeof r.node_id !== "string" || r.node_id === "") return { error: `${file}[${i}].node_id must be a non-empty string` };
    if (typeof r.platform !== "string" || !isPlatformId(r.platform)) return { error: `${file}[${i}].platform must be one of: ${PLATFORM_IDS.join(", ")}` };
    if (typeof r.url !== "string" || r.url === "") return { error: `${file}[${i}].url must be a non-empty string` };
    if (r.detail !== undefined && typeof r.detail !== "string") return { error: `${file}[${i}].detail must be a string` };
    entries.push({ node_id: r.node_id, platform: r.platform, url: r.url, ...(typeof r.detail === "string" && r.detail !== "" ? { detail: r.detail } : {}) });
  }
  return entries;
}

function describeFailure(status: number, baseUrl: string, body: DoorResponse): string {
  if (status === 401) return `Unauthorized — check ARKAIK_TOKEN (create one at ${baseUrl}/settings/tokens).`;
  if (status === 403) return "Forbidden — this token lacks the screenshot:append scope (or graph:write).";
  if (status === 404) return `No linked project in this account — check ${LINK_FILE}.`;
  if (status === 409) return "The project changed under every retry — run again.";
  return `Request failed (${status})${body.message ? ` — ${body.message}` : body.error ? ` — ${body.error}` : ""}.`;
}

export async function runShot(argv: string[], options: RunShotOptions = {}): Promise<RunShotResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const errorLog = options.errorLog ?? ((m: string) => console.error(m));
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const doFetch = options.httpClient ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  if (argv.includes("--help") || argv.includes("-h")) {
    log(USAGE);
    return { ok: true };
  }

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUED_FLAGS.has(arg)) { i++; continue; }
    if (arg.startsWith("--")) {
      if (KNOWN_FLAGS.has(arg)) continue;
      errorLog(`Unknown flag ${arg}. Flags take a separate value (--manifest shots.json), see arkaik shot --help.`);
      return { ok: false };
    }
    positional.push(arg);
  }
  if (positional.length !== 0 && positional.length !== 3) {
    errorLog("A positional shot is exactly <node_id> <platform> <value>; see arkaik shot --help.");
    return { ok: false };
  }

  const manifestFile = flagValue(argv, "--manifest");
  const commit = flagValue(argv, "--commit");
  const orderArg = flagValue(argv, "--order");
  const dryRun = argv.includes("--dry-run");
  let order: number | undefined;
  if (orderArg !== undefined) {
    order = Number(orderArg);
    if (!Number.isInteger(order) || order < 0) {
      errorLog(`--order must be a non-negative integer, got "${orderArg}".`);
      return { ok: false };
    }
  }
  if (commit !== undefined && order === undefined) {
    errorLog("--order is required with --commit: the commit's height on the default branch (git rev-list --count <sha>).");
    return { ok: false };
  }

  const entries: ManifestEntry[] = [];
  if (manifestFile !== undefined) {
    // resolve, not join: the workflow (and the tests) may pass an absolute path.
    const read = readManifest(resolve(cwd, manifestFile));
    if (!Array.isArray(read)) {
      errorLog(read.error);
      return { ok: false };
    }
    entries.push(...read);
  }
  if (positional.length === 3) {
    const [node_id, platform, url] = positional;
    if (!isPlatformId(platform)) {
      errorLog(`"${platform}" is not a platform. Expected one of: ${PLATFORM_IDS.join(", ")}.`);
      return { ok: false };
    }
    entries.push({ node_id, platform, url });
  }
  if (entries.length === 0) {
    errorLog("Nothing to record: pass --manifest <file> or <node_id> <platform> <value>.");
    return { ok: false };
  }
  // The door and `decideScreenshot` refuse these too; refusing here names the value before any request or write.
  for (const e of entries) {
    const scheme = schemeOf(e.url);
    if (scheme !== undefined && scheme !== "https:" && scheme !== "data:") {
      errorLog(`"${e.url}": screenshot values must be https:// URLs, image data URIs, or paths relative to the bundle (got ${scheme})`);
      return { ok: false };
    }
  }

  const linkPath = join(cwd, LINK_FILE);
  if (existsSync(linkPath)) {
    return runHosted({ entries, commit, order, dryRun, linkPath, argv, env, doFetch, log, errorLog });
  }
  return runKommit({ entries, commit, order, dryRun, cwd, argv, log, errorLog });
}

interface HostedInput {
  entries: ManifestEntry[];
  commit: string | undefined;
  order: number | undefined;
  dryRun: boolean;
  linkPath: string;
  argv: string[];
  env: Record<string, string | undefined>;
  doFetch: typeof fetch;
  log: (m: string) => void;
  errorLog: (m: string) => void;
}

async function runHosted(input: HostedInput): Promise<RunShotResult> {
  const { entries, commit, order, dryRun, linkPath, argv, env, doFetch, log, errorLog } = input;
  if (commit === undefined || order === undefined) {
    errorLog("--commit and --order are required against a hosted project: the door records CI shots, and a CI shot without provenance is worthless.");
    return { ok: false };
  }
  let link: { project_id?: string; remote?: string };
  try {
    link = JSON.parse(readFileSync(linkPath, "utf8")) as { project_id?: string; remote?: string };
  } catch {
    errorLog(`Could not read ${LINK_FILE}.`);
    return { ok: false };
  }
  const projectId = link.project_id;
  if (!projectId) {
    errorLog(`${LINK_FILE} has no project_id. Run \`arkaik link --project <id>\`.`);
    return { ok: false };
  }
  const baseUrl = (flagValue(argv, "--remote") ?? env.ARKAIK_URL ?? link.remote ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doorEntries = entries.map((e) => ({ node_id: e.node_id, platform: e.platform, url: e.url, commit, order, ...(e.detail !== undefined ? { detail: e.detail } : {}) }));

  if (dryRun) {
    log(`Would record ${doorEntries.length} screenshot(s) on ${projectId} (${baseUrl}) from ${commit} (order ${order}):`);
    for (const e of doorEntries) log(`  ${e.node_id}@${e.platform} ← ${e.url}`);
    return { ok: true };
  }

  const token = env.ARKAIK_TOKEN;
  if (!token) {
    errorLog(`ARKAIK_TOKEN is not set. Create a screenshot:append token at ${baseUrl}/settings/tokens and export it.`);
    return { ok: false };
  }

  for (let start = 0; start < doorEntries.length; start += MAX_ENTRIES_PER_REQUEST) {
    const chunk = doorEntries.slice(start, start + MAX_ENTRIES_PER_REQUEST);
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/api/graph/projects/${encodeURIComponent(projectId)}/screenshots`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ entries: chunk }),
      });
    } catch (e) {
      errorLog(`Could not reach ${baseUrl}: ${(e as Error).message}`);
      return { ok: false };
    }
    let body: DoorResponse = {};
    try { body = (await res.json()) as DoorResponse; } catch { /* a non-JSON error body */ }
    if (res.status === 422 && Array.isArray(body.refusals)) {
      for (const r of body.refusals) {
        const e = chunk[r.index];
        errorLog(`refused: ${e?.node_id ?? r.node_id}@${e?.platform ?? r.platform} — ${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
      }
      // Each request is atomic, but earlier chunks have already landed; a re-run skips those as `unchanged`.
      errorLog(start > 0
        ? `Nothing from entries ${start}–${start + chunk.length - 1} was recorded: a refused entry refuses its whole batch (the ${start} before them were applied above).`
        : "Nothing was recorded: a refused entry refuses the whole batch.");
      return { ok: false };
    }
    if (!res.ok) {
      errorLog(describeFailure(res.status, baseUrl, body));
      return { ok: false };
    }
    for (const a of body.applied ?? []) log(`recorded: ${a.node_id}@${a.platform} ← ${a.url}`);
    for (const s of body.skipped ?? []) log(`skipped: ${s.node_id}@${s.platform} — ${s.reason}`);
  }
  return { ok: true };
}

interface KommitInput {
  entries: ManifestEntry[];
  commit: string | undefined;
  order: number | undefined;
  dryRun: boolean;
  cwd: string;
  argv: string[];
  log: (m: string) => void;
  errorLog: (m: string) => void;
}

/** The slot form a value takes, the same reading the skill applies by hand. */
function formOf(value: string): "url" | "data" | "path" {
  if (/^https:\/\//i.test(value)) return "url";
  if (/^data:/i.test(value)) return "data";
  return "path";
}

function runKommit(input: KommitInput): RunShotResult {
  const { entries, commit, order, dryRun, cwd, argv, log, errorLog } = input;
  const bundlePath = resolve(cwd, flagValue(argv, "--bundle") ?? DEFAULT_BUNDLE_PATH);
  let bundle: Record<string, unknown>;
  try {
    bundle = readBundle(bundlePath);
  } catch (e) {
    errorLog(`FATAL: ${(e as Error).message}`);
    return { ok: false };
  }
  const source = commit !== undefined ? "ci" : "manual";
  const ops: MutationOp[] = entries.map((e) => ({
    op: "record_screenshot",
    node_id: e.node_id,
    platform: e.platform,
    source,
    form: formOf(e.url),
    value: e.url,
    ...(commit !== undefined ? { commit, order } : {}),
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
  }));

  if (dryRun) {
    log(`Would record ${ops.length} ${source} screenshot(s) into ${bundlePath}:`);
    for (const e of entries) log(`  ${e.node_id}@${e.platform} ← ${e.url}`);
    return { ok: true };
  }

  const project = bundle.project;
  if (typeof project !== "object" || project === null || !("id" in project) || typeof project.id !== "string") {
    errorLog(`FATAL: ${bundlePath} has no project.id.`);
    return { ok: false };
  }
  // readBundle hands back the raw record by design (validation is `arkaik validate`'s job);
  // the nodes/edges casts are the CLI's accepted idiom (sync.ts, and the MCP server's tools.ts).
  const nodes = Array.isArray(bundle.nodes) ? (bundle.nodes as Node[]) : [];
  const edges = Array.isArray(bundle.edges) ? (bundle.edges as Edge[]) : [];
  let outcome;
  try {
    outcome = applyOps({ projectId: project.id, nodes, edges }, ops);
  } catch (e) {
    errorLog(`FATAL: ${(e as Error).message}`);
    return { ok: false };
  }
  if (outcome.eventInputs.length === 0) {
    log("Nothing to record: every slot already holds this value, or a newer CI shot outranks it.");
    return { ok: true };
  }
  let events;
  try {
    events = toJournalEvents(outcome.eventInputs, ACTOR);
  } catch (e) {
    errorLog(`FATAL: could not build screenshot event — ${(e as Error).message}`);
    return { ok: false };
  }
  const next = { ...bundle, nodes: outcome.nodes, edges: outcome.edges, project: { ...project, updated_at: new Date().toISOString() } };
  const journalPath = journalPathFor(bundlePath);
  // The first append to a journal-less bundle makes it cross-checked (#357).
  const baseline = ensureJournalBaseline(journalPath, bundle, ACTOR);
  writeFileSync(bundlePath, serializeBundle(next as unknown as Parameters<typeof serializeBundle>[0]));
  if (baseline !== undefined) log(`  ${renderEventLine(baseline)} -> ${journalPath}`);
  for (const event of events) {
    appendJournalEvent(journalPath, event);
    log(`  ${renderEventLine(event)} -> ${journalPath}`);
  }
  return { ok: true };
}

export function runShotCli(argv: string[]): void {
  void runShot(argv).then((result) => {
    if (!result.ok) process.exit(1);
  });
}
