/**
 * `arkaik push [--include-journal] [--api <base-url>] [path]`
 * `arkaik push --delete <id> --key <owner_key> [--api <base-url>]`
 *
 * Completes the Kommit journey — repo bundle to shareable URL without
 * touching the browser (docs/spec/toolchain.md § the CLI, Phase 4;
 * docs/spec/services.md § Publik → Surfaces: "CLI `arkaik push`").
 *
 * Create flow:
 *  1. validate — the exact same shape + semantic + snapshot<->journal
 *     cross-check `arkaik open` gates on (`../lib/bundle-validate`'s
 *     `validateBundleAt`). An INVALID bundle prints findings and exits
 *     non-zero; nothing is packed or sent.
 *  2. pack — reuse `arkaik pack`'s internals (`./pack`'s `runPack`) rather
 *     than re-implementing bundle assembly. The journal is stripped by
 *     default (`noJournal: true`, the Publik-safe posture,
 *     docs/spec/journal.md:41): it is never even embedded, so a stripped
 *     push never sends journal bytes over the wire regardless of what the
 *     server does with them. `--include-journal` flips that off, embedding
 *     the journal exactly like a bare `arkaik pack` would.
 *  3. `POST {api}/api/publik[?include_journal=true]` with the packed,
 *     canonical bundle as the body (docs/spec/services.md § Publik →
 *     Protocol — the API this command talks to is implemented at
 *     `app/api/publik/route.ts` / `lib/services/publik.ts`).
 *  4. report the response: `201` prints the URL + owner key prominently
 *     with a save-it warning (the key is returned exactly once and there is
 *     no recovery path in M4); `422` prints the server's structured
 *     findings; `429` prints the retry-after; `413`/`503` get clear,
 *     specific messages; any other non-201 status is a generic failure.
 *     Every non-201 outcome exits 1.
 *
 * Delete flow: `DELETE {api}/api/publik/{id}` with
 * `Authorization: Bearer <owner_key>` — `204` is success, `403` is a clear
 * "owner key does not match" error, anything else is reported and exits 1.
 *
 * No update verb: snapshots are immutable server-side (docs/spec/services.md
 * § Publik → Storage — "there is no update endpoint"); re-running `push`
 * mints a new id.
 *
 * The only network call in this module goes through the injected
 * `HttpClient` seam (`../lib/providers`, the same seam `arkaik sync` uses)
 * — never a bare `fetch` — so tests substitute a mock and this command's
 * tests (and CI) never touch the real network. `runPush`/`runPushDelete` are
 * exported standalone (not just the CLI entry) so tests can call them
 * directly with a mock client.
 */
import { resolve } from "node:path";
import type { ValidationFinding } from "@arkaik/schema";
import { validateBundleAt, type BundleValidation } from "../lib/bundle-validate";
import { formatFinding } from "./validate";
import { runPack } from "./pack";
import { DEFAULT_HTTP_CLIENT, type HttpClient } from "../lib/providers";

const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";

/** Default Publik host — override with `--api <base-url>` for self-hosted deployments. */
export const DEFAULT_API_BASE = "https://arkaik.app";

const USAGE = `arkaik push [--include-journal] [--api <base-url>] [path]
arkaik push --delete <id> --key <owner_key> [--api <base-url>]

Publish a project bundle to Publik (anonymous, account-less snapshot
sharing) or delete a previously published one. Push validates the bundle
first — the same shape + semantic + snapshot<->journal checks as
"arkaik validate"/"arkaik open" — and only on success packs it (reusing
"arkaik pack" internals) and POSTs it to Publik.

The journal is stripped before packing by default and never sent — the
Publik-safe posture (docs/spec/journal.md). --include-journal embeds it
(like a bare "arkaik pack") and forwards ?include_journal=true so the server
knows to keep it.

Snapshots are immutable: there is no update verb. Pushing again always mints
a new id. The owner key printed on success is shown exactly once and cannot
be recovered — save it if you may need to delete the snapshot later.

Arguments:
  path                Path to the bundle JSON file (default: ${DEFAULT_BUNDLE_PATH}).
                       Ignored with --delete.

Options:
  --include-journal   Embed the journal in the pushed bundle and forward
                       ?include_journal=true. Default: stripped, omitted
                       entirely from the request body.
  --api <base-url>    Publik API base URL (default: ${DEFAULT_API_BASE}).
                       Point at a self-hosted deployment.
  --delete <id>       Delete a snapshot by id instead of pushing. Requires
                       --key.
  --key <owner_key>   Owner key for --delete (from the original push's
                       output).
  -h, --help          Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Create (push)
// ---------------------------------------------------------------------------

export interface RunPushOptions {
  /** Path to the bundle JSON file (default: docs/arkaik/bundle.json), resolved against `cwd`. */
  path?: string;
  /** Embed the journal (forwarding ?include_journal=true) instead of stripping it. */
  includeJournal?: boolean;
  /** Publik API base URL (default: https://arkaik.app). */
  apiBase?: string;
  /** Base directory `path` resolves against (default: process.cwd()). */
  cwd?: string;
  /** The HTTP seam the POST goes through (default: real fetch). Tests inject a mock. */
  httpClient?: HttpClient;
}

/** Structured outcome of a `POST /api/publik` request, once one was actually sent. */
export type PushOutcome = "created" | "rejected";

export interface RunPushResult {
  ok: boolean;
  /** Set when `ok` is false — a fatal error (bad path/JSON, or a pack failure) before a request could be attempted. */
  fatal?: string;
  bundlePath: string;
  /** Local validation outcome (same gate as `arkaik open`). */
  valid: boolean;
  errorLines: string[];
  warningLines: string[];
  /** True once a request was actually sent (only when `valid`). */
  requestSent: boolean;
  /** HTTP status of the POST response, when one was received. */
  status?: number;
  /** Set on 201: the new snapshot's id. */
  id?: string;
  /** Set on 201: the shareable URL. */
  url?: string;
  /** Set on 201: the one-time owner key — never logged or persisted by this command. */
  ownerKey?: string;
  /** Set on 422: the server's structured validation findings. */
  serverFindings?: ValidationFinding[];
  /** Set on 429: seconds until the caller may retry (from the `retry-after` header). */
  retryAfter?: string | null;
  /** Human-readable message for any non-201 outcome (network error, non-201 status, or a request that never got sent). */
  errorMessage?: string;
}

function fatalResult(bundlePath: string, message: string): RunPushResult {
  return {
    ok: false,
    fatal: message,
    bundlePath,
    valid: false,
    errorLines: [],
    warningLines: [],
    requestSent: false,
  };
}

/**
 * Validate, pack (journal stripped unless `includeJournal`), and POST to
 * Publik. Mirrors `runOpen`'s validate-gate shape: an invalid bundle returns
 * `ok: true, valid: false` with findings and never reaches pack/network.
 */
export async function runPush(options: RunPushOptions = {}): Promise<RunPushResult> {
  const cwd = options.cwd ?? process.cwd();
  const filePath = resolve(cwd, options.path ?? DEFAULT_BUNDLE_PATH);
  const includeJournal = options.includeJournal ?? false;
  const apiBase = options.apiBase ?? DEFAULT_API_BASE;
  const httpClient = options.httpClient ?? DEFAULT_HTTP_CLIENT;

  let v: BundleValidation;
  try {
    v = validateBundleAt(filePath);
  } catch (e) {
    return fatalResult(filePath, (e as Error).message);
  }

  const warningLines = v.result.warnings.map(formatFinding);
  const errorLines = [
    ...v.sidecarFindings.map((f) => `ERROR [${f.rule}] line ${f.line}: ${f.message}`),
    ...v.result.errors.map(formatFinding),
  ];

  if (!v.valid) {
    return { ok: true, bundlePath: filePath, valid: false, errorLines, warningLines, requestSent: false };
  }

  // Reuse pack's internals verbatim — noJournal strips journal[] before
  // serialization, so a stripped push never even has journal bytes to send.
  const packed = runPack({ path: filePath, noJournal: !includeJournal, cwd });
  if (!packed.ok) {
    return fatalResult(filePath, packed.fatal ?? "pack failed");
  }

  const url = `${apiBase}/api/publik${includeJournal ? "?include_journal=true" : ""}`;

  let res: Response;
  try {
    res = await httpClient(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: packed.output,
    });
  } catch (e) {
    return {
      ok: true,
      bundlePath: filePath,
      valid: true,
      errorLines,
      warningLines,
      requestSent: false,
      errorMessage: `Network error: ${(e as Error).message}`,
    };
  }

  const status = res.status;

  if (status === 201) {
    const body = (await res.json()) as { id?: string; url?: string; owner_key?: string };
    return {
      ok: true,
      bundlePath: filePath,
      valid: true,
      errorLines,
      warningLines,
      requestSent: true,
      status,
      id: body.id,
      url: body.url,
      ownerKey: body.owner_key,
    };
  }

  // Every non-201 response body is `{ error, message }` (§ Protocol), plus
  // `findings` on 422. Tolerate a non-JSON or empty body defensively.
  let errBody: { error?: string; message?: string; findings?: ValidationFinding[] } = {};
  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // no body / not JSON — fall through with the generic message below.
  }

  return {
    ok: true,
    bundlePath: filePath,
    valid: true,
    errorLines,
    warningLines,
    requestSent: true,
    status,
    serverFindings: errBody.findings,
    retryAfter: status === 429 ? res.headers.get("retry-after") : undefined,
    errorMessage: errBody.message ?? `Request failed with status ${status}`,
  };
}

function reportPush(result: RunPushResult): never {
  if (result.warningLines.length > 0) {
    console.error(`Warnings: ${result.warningLines.length}`);
    result.warningLines.forEach((w) => console.error(`  ${w}`));
  }

  if (!result.valid) {
    console.error(`Errors: ${result.errorLines.length}`);
    result.errorLines.forEach((e) => console.error(`  ${e}`));
    console.error("\nInvalid bundle — not packed, not pushed.");
    process.exit(1);
  }

  if (!result.requestSent) {
    console.error(`FATAL: ${result.errorMessage ?? "Push failed before a request could be sent."}`);
    process.exit(1);
  }

  if (result.status === 201) {
    console.log("\n  Published to Publik");
    console.log("  ====================\n");
    console.log(`  URL:        ${result.url}`);
    console.log(`  Owner key:  ${result.ownerKey}`);
    console.log("\n  Save this key now — it is shown only once and is required to delete this");
    console.log("  snapshot later. There is no recovery path if it is lost.");
    console.log(`\n  Delete with: arkaik push --delete ${result.id} --key <owner_key>\n`);
    process.exit(0);
  }

  if (result.status === 422) {
    console.error("Server rejected the bundle (422):");
    (result.serverFindings ?? []).forEach((f) => console.error(`  ${formatFinding(f)}`));
    process.exit(1);
  }

  if (result.status === 429) {
    console.error(`Rate limited (429) — try again in ${result.retryAfter ?? "a while"} second(s).`);
    process.exit(1);
  }

  if (result.status === 413) {
    console.error(`Bundle too large (413): ${result.errorMessage ?? "exceeds the Publik size cap."}`);
    process.exit(1);
  }

  if (result.status === 503) {
    console.error(`Publik is unavailable (503): ${result.errorMessage ?? "services not configured on this deployment."}`);
    process.exit(1);
  }

  console.error(`Push failed (${result.status}): ${result.errorMessage}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export interface RunPushDeleteOptions {
  id: string;
  key: string;
  /** Publik API base URL (default: https://arkaik.app). */
  apiBase?: string;
  /** The HTTP seam the DELETE goes through (default: real fetch). Tests inject a mock. */
  httpClient?: HttpClient;
}

export interface RunPushDeleteResult {
  /** False only for a network-level failure — the request never completed. */
  ok: boolean;
  fatal?: string;
  status?: number;
  deleted: boolean;
  errorMessage?: string;
}

/** `DELETE {api}/api/publik/{id}` with `Authorization: Bearer <key>`. */
export async function runPushDelete(options: RunPushDeleteOptions): Promise<RunPushDeleteResult> {
  const apiBase = options.apiBase ?? DEFAULT_API_BASE;
  const httpClient = options.httpClient ?? DEFAULT_HTTP_CLIENT;
  const url = `${apiBase}/api/publik/${options.id}`;

  let res: Response;
  try {
    res = await httpClient(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${options.key}` },
    });
  } catch (e) {
    return { ok: false, fatal: `Network error: ${(e as Error).message}`, deleted: false };
  }

  if (res.status === 204) {
    return { ok: true, status: 204, deleted: true };
  }

  let errBody: { error?: string; message?: string } = {};
  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // no body / not JSON
  }

  return {
    ok: true,
    status: res.status,
    deleted: false,
    errorMessage: errBody.message ?? `Delete failed with status ${res.status}`,
  };
}

function reportDelete(id: string, result: RunPushDeleteResult): never {
  if (!result.ok) fail(`FATAL: ${result.fatal}`);

  if (result.deleted) {
    console.log(`Deleted ${id}`);
    process.exit(0);
  }

  console.error(`Delete failed (${result.status}): ${result.errorMessage}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export function runPushCli(args: string[]): void {
  let includeJournal = false;
  let apiBase: string | undefined;
  let deleteId: string | undefined;
  let key: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--include-journal") {
      includeJournal = true;
    } else if (arg === "--api") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --api\n\n${USAGE}`);
      apiBase = value;
    } else if (arg === "--delete") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --delete\n\n${USAGE}`);
      deleteId = value;
    } else if (arg === "--key") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --key\n\n${USAGE}`);
      key = value;
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      positionals.push(arg);
    }
  }

  if (deleteId !== undefined) {
    if (key === undefined) fail(`--delete requires --key <owner_key>\n\n${USAGE}`);
    if (positionals.length > 0) {
      fail(`Unexpected argument(s) with --delete: ${positionals.join(" ")}\n\n${USAGE}`);
    }

    runPushDelete({ id: deleteId, key, apiBase })
      .then((result) => reportDelete(deleteId, result))
      .catch((e: unknown) => fail(`FATAL: ${(e as Error).message}`));
    return;
  }

  if (key !== undefined) fail(`--key is only valid with --delete\n\n${USAGE}`);

  const filePath = positionals[0] ?? DEFAULT_BUNDLE_PATH;

  runPush({ path: filePath, includeJournal, apiBase })
    .then((result) => {
      if (!result.ok) fail(`FATAL: ${result.fatal}`);
      reportPush(result);
    })
    .catch((e: unknown) => fail(`FATAL: ${(e as Error).message}`));
}
