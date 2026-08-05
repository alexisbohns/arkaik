/**
 * `arkaik restore [--dry-run] [--api <base-url>] [path]`
 *
 * Land a locally-built bundle — history included — on the hosted project
 * this repo is linked to (docs/superpowers/specs/2026-08-04-bootstrap-method-
 * design.md § 7, docs/superpowers/plans/2026-08-04-bootstrap-method.md
 * Task 12). This is the one destructive verb the CLI offers: it replaces the
 * hosted project's snapshot AND its journal wholesale, in one server-side
 * transaction (`PUT .../bundle`, Task 11).
 *
 * ── Why the client-side backup is not optional ──────────────────────────────
 * The server keeps NO pre-image of a restore. A server-side backup table was
 * considered and rejected (design doc § 7, "Stated trade-off"): it would need
 * a migration, and a migration is a manual production step in this repo —
 * exactly the kind of foot-gun this command exists to avoid introducing on
 * its own destructive path. That leaves the client-side backup this command
 * writes, right before it sends the PUT, as THE ONLY RECOVERY PATH THAT
 * EXISTS. If it doesn't get written, there is no undo. Every choice below is
 * shaped by that one fact:
 *
 *  - the backup is written from `GET .../export` (snapshot + journal
 *    embedded), never from `GET .../{id}` (snapshot only, no journal) — a
 *    backup missing the journal is not a backup, since the journal is
 *    exactly what a restore overwrites;
 *  - every way that export can fail — thrown network error, non-200, a body
 *    that isn't bundle-shaped, a bundle with no journal array — aborts the
 *    run with no PUT ever sent, not a warning;
 *  - an unwritable backup directory (permissions, a full disk, whatever)
 *    aborts the same way, for the same reason;
 *  - `--dry-run` skips the backup entirely and on purpose (see the `dryRun`
 *    branch below) — nothing destructive happens in that mode, so there is
 *    nothing to back up, and writing one anyway would clutter
 *    `.backups/` with files that were never protecting anything.
 *
 * ── Steps, in order ──────────────────────────────────────────────────────────
 *  1. read the link file for the project id and remote (mirrors `link.ts`);
 *  2. GET the project for its current version — this becomes `If-Match` for
 *     BOTH a dry run and a real write. Dry-run needs it too: the server's
 *     preview runs the identical validation/version-check/delta path a real
 *     write does (`classifyDryRun`, Task 11), so a stale version must
 *     produce the same 412 in preview as it would for real;
 *  3. real restore only: GET the export, write it to
 *     `docs/arkaik/.backups/<ts>-bundle.json`, and abort on ANY failure —
 *     see above;
 *  4. assemble the outbound bundle: the local `bundle.json` plus its journal,
 *     via `loadJournalEvents` (embedded journal wins over the `journal.jsonl`
 *     sidecar, the same precedence `arkaik validate` uses) — `bundle.json` on
 *     disk does NOT itself contain the journal in the common case, so
 *     skipping this step would silently send an empty history and destroy
 *     the hosted one;
 *  5. PUT it. Real restore sends no `dryRun` query param at all (the
 *     server's `classifyDryRun` treats an absent param as "real write" —
 *     the correct default here, since this branch really is one); dry-run
 *     sends the explicit `?dryRun=1`, never the bare `?dryRun` shorthand,
 *     which is the safer of the two recognized "preview" spellings to rely
 *     on from a code path that must never accidentally take the destructive
 *     branch.
 *
 * A 412 means someone (or something) changed the project since step 2 read
 * its version. That is NOT a "just retry" situation — the state the caller
 * was about to overwrite has moved since they last saw it — so the failure
 * message here deliberately does not say "retry"; it says re-run the command
 * to read the current state and decide again.
 *
 * The only network calls in this module go through the injected `httpClient`
 * seam (`../lib/providers`, the same seam `arkaik push`/`arkaik sync` use) —
 * never a bare `fetch` — so tests substitute a mock and never touch the real
 * network. `runRestore` is exported standalone (not just the CLI entry) so
 * tests can call it directly with a mock client, mirroring `runPush`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadJournalEvents } from "../lib/journal-io";
import { DEFAULT_HTTP_CLIENT, type HttpClient } from "../lib/providers";

const LINK_FILE = "docs/arkaik/arkaik.json";
const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";

/** Default hosted instance — override with `--api <base-url>` for self-hosted deployments. */
export const DEFAULT_API_BASE = "https://arkaik.app";

const USAGE = `arkaik restore [options] [path]

Replace the linked hosted project's bundle AND journal with a local bundle —
the landing step for a bootstrapped map. Before sending anything, this
exports the CURRENT hosted state (snapshot + journal) to
docs/arkaik/.backups/<timestamp>-bundle.json and refuses to proceed if that
backup cannot be written — the server keeps no pre-image, so this file is the
only way back if the restore turns out to be wrong.

Arguments:
  path                Path to the local bundle JSON file
                       (default: ${DEFAULT_BUNDLE_PATH}). Its journal.jsonl
                       sidecar (or an embedded journal, which wins) is folded
                       in automatically.

Options:
  --dry-run          Ask the server what this restore WOULD do and print the
                      delta. Sends nothing destructive and takes no backup
                      (there is nothing to protect against in this mode).
  --api <base-url>   Override the remote from docs/arkaik/arkaik.json.
  -h, --help         Show this help.

Environment:
  ARKAIK_TOKEN       Required. Create one at <origin>/settings/tokens.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export interface RunRestoreOptions {
  /** Path to the local bundle file, resolved against `cwd` (default: docs/arkaik/bundle.json). */
  path?: string;
  /** Preview via the server's dry-run mode instead of writing for real. Default: false. */
  dryRun?: boolean;
  /** Hosted API base URL, overriding the link file's `remote`. */
  apiBase?: string;
  /** Base directory the link file / bundle path resolve against (default: process.cwd()). */
  cwd?: string;
  /** Environment ARKAIK_TOKEN is read from (default: process.env). */
  env?: Record<string, string | undefined>;
  /** The HTTP seam every request goes through (default: real fetch). Tests inject a mock. */
  httpClient?: HttpClient;
}

/** Minimal shape of the `BundleDelta` the server returns — see `lib/services/graph/restore.ts`. All fields are optional here since this side only ever displays them, never computes them. */
export type DeltaSummary = Record<string, number | undefined>;

export interface RunRestoreResult {
  /** False only for a fatal PRE-FLIGHT error (bad link file, missing token, unreadable bundle, or the mandatory backup step failing) — no PUT was ever attempted. */
  ok: boolean;
  /** Set when `ok` is false. */
  fatal?: string;
  dryRun: boolean;
  bundlePath?: string;
  /** Set once the pre-restore backup was written (real restore only — dry-run never takes one). */
  backupPath?: string;
  /** True once the `PUT .../bundle` request was actually sent and a response was received. */
  requestSent: boolean;
  /** HTTP status of the PUT response, once one was received. */
  status?: number;
  /** Set on 200: the version after this call (bumped for a real write, unchanged for a dry run). */
  version?: string;
  /** Set on 200: the server-computed `BundleDelta`. */
  delta?: DeltaSummary;
  /** Set on 412: the server's current version, for reference. */
  conflictCurrent?: string;
  /** Set on 422: the server's structured validation findings. */
  serverFindings?: Array<{ message?: string; [key: string]: unknown }>;
  /** Human-readable message for any non-200 outcome, or a request that never got sent. */
  errorMessage?: string;
}

function fatalResult(dryRun: boolean, message: string): RunRestoreResult {
  return { ok: false, fatal: message, dryRun, requestSent: false };
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function describeVersionReadFailure(status: number, baseUrl: string, projectId: string): string {
  if (status === 401) return `Unauthorized — check ARKAIK_TOKEN (create one at ${baseUrl}/settings/tokens).`;
  if (status === 403) return `Forbidden — this token lacks the graph:read scope, or does not own project ${projectId}.`;
  if (status === 404) return `No project "${projectId}" in this account. Run \`arkaik link --list\` to see the ids.`;
  return `Could not read the project (${status}). Nothing was sent.`;
}

/**
 * Interpret the PUT response — success or one of the seven documented
 * failure statuses — into a `RunRestoreResult`. Every failure gets its own
 * actionable message; the real-restore ones (backupPath set) always name the
 * backup, since that is the recovery instruction. 428/400 should never
 * actually happen from this CLI (it always sends a valid `If-Match` and
 * `?dryRun` token), but are still handled distinctly rather than falling
 * into a generic branch, in case a bug ever does produce one.
 */
async function interpretPutResponse(
  res: Response,
  ctx: { dryRun: boolean; bundlePath: string; backupPath?: string; version: string },
): Promise<RunRestoreResult> {
  const base: RunRestoreResult = {
    ok: true,
    dryRun: ctx.dryRun,
    bundlePath: ctx.bundlePath,
    backupPath: ctx.backupPath,
    requestSent: true,
    status: res.status,
  };
  const backupNote = ctx.backupPath ? ` Your pre-restore backup is at ${ctx.backupPath}.` : "";

  if (res.status === 200) {
    const body = await safeJson(res);
    return {
      ...base,
      version: typeof body.version === "string" ? body.version : undefined,
      delta: (body.delta as DeltaSummary | undefined) ?? undefined,
    };
  }

  const body = await safeJson(res);

  switch (res.status) {
    case 404:
      return { ...base, errorMessage: `Project not found (or not owned by this token). Nothing was sent.${backupNote}` };
    case 428:
      return {
        ...base,
        errorMessage: `The server rejected this request for a missing If-Match header — this CLI always sends one, so this points at a bug, not a version conflict. Nothing was written.${backupNote}`,
      };
    case 400:
      if (body.error === "invalid_dry_run") {
        return {
          ...base,
          errorMessage: `The server rejected the dry-run indicator this CLI sent — this points at a bug, not a version conflict. Nothing was written.${backupNote}`,
        };
      }
      return {
        ...base,
        errorMessage: `The server rejected If-Match as malformed — this points at a bug, not a version conflict. Nothing was written.${backupNote}`,
      };
    case 412: {
      const current = typeof body.current === "string" ? body.current : undefined;
      return {
        ...base,
        conflictCurrent: current,
        errorMessage:
          `Conflict — the hosted project changed since this run read version ${ctx.version} ` +
          `(it is now ${current ?? "unknown"}). Nothing was written.${backupNote} ` +
          `Do not retry with the same version — that would overwrite state that has since moved. ` +
          `Re-run \`arkaik restore\` to read the current state and decide again.`,
      };
    }
    case 403:
      return {
        ...base,
        errorMessage:
          `This bundle exceeds the hosted tier's entity limit ` +
          `(limit ${body.limit ?? "uncapped"}, actual ${body.actual ?? "unknown"}, tier ${body.tier ?? "unknown"}). ` +
          `Nothing was written.${backupNote}`,
      };
    case 413:
      return {
        ...base,
        errorMessage: `The bundle is too large for the server to accept (limit ${body.limit ?? "5MB"} bytes). Nothing was written.${backupNote}`,
      };
    case 422:
      return {
        ...base,
        serverFindings: Array.isArray(body.errors) ? (body.errors as Array<{ message?: string }>) : undefined,
        errorMessage: `The server's validator rejected the bundle — see the findings below. Nothing was written.${backupNote}`,
      };
    default:
      return {
        ...base,
        errorMessage: `Restore failed (${res.status}): ${typeof body.message === "string" ? body.message : "unknown error"}.${backupNote}`,
      };
  }
}

export async function runRestore(options: RunRestoreOptions = {}): Promise<RunRestoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const dryRun = options.dryRun ?? false;
  const httpClient = options.httpClient ?? DEFAULT_HTTP_CLIENT;

  const linkPath = join(cwd, LINK_FILE);
  if (!existsSync(linkPath)) {
    return fatalResult(dryRun, `No ${LINK_FILE}. Run \`arkaik link\` first — restore only targets hosted projects.`);
  }
  let link: { project_id?: string; remote?: string };
  try {
    link = JSON.parse(readFileSync(linkPath, "utf8")) as { project_id?: string; remote?: string };
  } catch (e) {
    return fatalResult(dryRun, `Could not parse ${LINK_FILE}: ${(e as Error).message}`);
  }
  const projectId = link.project_id;
  if (!projectId) return fatalResult(dryRun, `${LINK_FILE} has no project_id. Run \`arkaik link --project <id>\`.`);
  const baseUrl = (options.apiBase ?? link.remote ?? DEFAULT_API_BASE).replace(/\/+$/, "");

  const token = env.ARKAIK_TOKEN;
  if (!token) return fatalResult(dryRun, `ARKAIK_TOKEN is not set. Create a token at ${baseUrl}/settings/tokens and export it.`);

  const bundlePath = resolve(cwd, options.path ?? DEFAULT_BUNDLE_PATH);
  if (!existsSync(bundlePath)) return fatalResult(dryRun, `No bundle at ${bundlePath}. Run \`arkaik merge\` (or \`arkaik pack\`) first.`);
  let localRaw: unknown;
  try {
    localRaw = JSON.parse(readFileSync(bundlePath, "utf8"));
  } catch (e) {
    return fatalResult(dryRun, `Could not parse ${bundlePath}: ${(e as Error).message}`);
  }
  if (typeof localRaw !== "object" || localRaw === null || Array.isArray(localRaw)) {
    return fatalResult(dryRun, `${bundlePath} is not a bundle object.`);
  }
  const local = localRaw as Record<string, unknown>;
  const journalEvents = loadJournalEvents(local, bundlePath);
  const outboundBundle = { ...local, journal: journalEvents };

  const headers = { Authorization: `Bearer ${token}` };

  // Step 2: read the current version. Needed for If-Match on BOTH branches —
  // see the module doc comment for why dry-run doesn't get to skip this.
  let version: string;
  try {
    const projectRes = await httpClient(`${baseUrl}/api/graph/projects/${projectId}`, { headers });
    if (!projectRes.ok) {
      return fatalResult(dryRun, describeVersionReadFailure(projectRes.status, baseUrl, projectId));
    }
    const body = await safeJson(projectRes);
    if (typeof body.version !== "string" || body.version.length === 0) {
      return fatalResult(dryRun, "The project response had no usable version — cannot set If-Match safely. Nothing was sent.");
    }
    version = body.version;
  } catch (e) {
    return fatalResult(dryRun, `Could not read the project: ${(e as Error).message}`);
  }

  const putHeaders = { ...headers, "Content-Type": "application/json", "If-Match": `"${version}"` };
  const putBody = JSON.stringify({ bundle: outboundBundle });

  if (dryRun) {
    // No backup, on purpose: the server writes nothing in this mode, so
    // there is nothing destructive to protect against — see the module doc
    // comment. The explicit `?dryRun=1` is used rather than the bare
    // `?dryRun` shorthand, per Task 12's note: the safer of the two
    // recognized preview spellings for a code path that must never
    // accidentally take the destructive branch.
    let res: Response;
    try {
      res = await httpClient(`${baseUrl}/api/graph/projects/${projectId}/bundle?dryRun=1`, {
        method: "PUT",
        headers: putHeaders,
        body: putBody,
      });
    } catch (e) {
      return { ok: true, dryRun, bundlePath, requestSent: false, errorMessage: `Network error: ${(e as Error).message}` };
    }
    return interpretPutResponse(res, { dryRun, bundlePath, version });
  }

  // ── Mandatory pre-restore backup ────────────────────────────────────────
  // The only recovery path that exists (no server-side pre-image, by
  // deliberate design — see the module doc comment). MUST happen before the
  // PUT below, and ANY failure — network, shape, or filesystem — MUST abort
  // the run rather than warn and continue.
  let exported: unknown;
  try {
    const exportRes = await httpClient(`${baseUrl}/api/graph/projects/${projectId}/export`, { headers });
    if (!exportRes.ok) {
      return fatalResult(dryRun, `Could not export the current hosted state (${exportRes.status}). Refusing to restore without a backup. Nothing was sent.`);
    }
    const body = await safeJson(exportRes);
    exported = body.bundle;
  } catch (e) {
    return fatalResult(dryRun, `Could not export the current hosted state: ${(e as Error).message}. Refusing to restore without a backup.`);
  }

  if (typeof exported !== "object" || exported === null || Array.isArray(exported)) {
    return fatalResult(dryRun, "The export response was not a bundle. Refusing to restore without a backup. Nothing was sent.");
  }
  const exportedBundle = exported as { nodes?: unknown; edges?: unknown; journal?: unknown };
  if (!Array.isArray(exportedBundle.journal) || !Array.isArray(exportedBundle.nodes) || !Array.isArray(exportedBundle.edges)) {
    return fatalResult(
      dryRun,
      "The exported bundle is missing nodes, edges, or a journal array — an incomplete backup would not cover what restore is about to destroy. Refusing to restore. Nothing was sent.",
    );
  }

  const backupDir = join(dirname(bundlePath), ".backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `${stamp}-bundle.json`);
  try {
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(backupPath, `${JSON.stringify(exported, null, 2)}\n`);
  } catch (e) {
    return fatalResult(
      dryRun,
      `Could not write the pre-restore backup to ${backupPath}: ${(e as Error).message}\n` +
        `Refusing to restore — this verb replaces the hosted project's snapshot AND journal, and the backup is the only way back.`,
    );
  }

  // ── The one destructive request this command ever sends ────────────────
  let res: Response;
  try {
    res = await httpClient(`${baseUrl}/api/graph/projects/${projectId}/bundle`, {
      method: "PUT",
      headers: putHeaders,
      body: putBody,
    });
  } catch (e) {
    return {
      ok: true,
      dryRun,
      bundlePath,
      backupPath,
      requestSent: false,
      errorMessage: `Network error: ${(e as Error).message}. Your pre-restore backup is at ${backupPath} — nothing was sent.`,
    };
  }

  return interpretPutResponse(res, { dryRun, bundlePath, backupPath, version });
}

// ---------------------------------------------------------------------------
// Reporting + CLI entry
// ---------------------------------------------------------------------------

function printDelta(delta: DeltaSummary | undefined): void {
  if (!delta) return;
  const n = (k: string): number | string => delta[k] ?? "?";
  console.log(
    `  nodes  ${n("nodesBefore")} -> ${n("nodesAfter")}  (+${n("nodesAdded")} -${n("nodesRemoved")} ~${n("nodesChanged")}${
      delta.nodesMalformed ? `, ${delta.nodesMalformed} malformed` : ""
    })`,
  );
  console.log(
    `  edges  ${n("edgesBefore")} -> ${n("edgesAfter")}  (+${n("edgesAdded")} -${n("edgesRemoved")} ~${n("edgesChanged")}${
      delta.edgesMalformed ? `, ${delta.edgesMalformed} malformed` : ""
    })`,
  );
  console.log(
    `  events ${n("eventsBefore")} -> ${n("eventsAfter")}  (+${n("eventsAdded")} -${n("eventsDropped")} ~${n("eventsChanged")}${
      delta.eventsMalformed ? `, ${delta.eventsMalformed} malformed` : ""
    })`,
  );
}

function reportRestore(result: RunRestoreResult): never {
  if (!result.ok) fail(`FATAL: ${result.fatal}`);

  if (result.backupPath) {
    console.log(`Backed up the current hosted project (snapshot + journal) to ${result.backupPath}`);
  }

  if (!result.requestSent) {
    console.error(result.errorMessage ?? "Restore failed before a request could be sent.");
    process.exit(1);
  }

  if (result.status === 200) {
    if (result.dryRun) {
      console.log("[dry-run] server preview — nothing was written:");
      printDelta(result.delta);
      console.log("Re-run without --dry-run to apply.");
    } else {
      console.log(`Restored. New version ${result.version}.`);
      printDelta(result.delta);
    }
    process.exit(0);
  }

  console.error(result.errorMessage ?? `Restore failed (${result.status}).`);
  for (const finding of result.serverFindings ?? []) {
    console.error(`  ${finding.message ?? JSON.stringify(finding)}`);
  }
  process.exit(1);
}

export function runRestoreCli(argv: string[]): void {
  let dryRun = false;
  let apiBase: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--api") {
      const value = argv[++i];
      if (value === undefined) fail(`Missing value for --api\n\n${USAGE}`);
      apiBase = value;
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length > 1) fail(`Unexpected argument(s): ${positionals.slice(1).join(" ")}\n\n${USAGE}`);

  runRestore({ path: positionals[0], dryRun, apiBase })
    .then((result) => reportRestore(result))
    .catch((e: unknown) => fail(`FATAL: ${(e as Error).message}`));
}
