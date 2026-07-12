/**
 * `arkaik sync [--provider <name>] [--dry-run] [path]`.
 *
 * Mirrors external ref status into the bundle (docs/spec/bundle-format.md §
 * References, docs/vision.md § References, Assets & Integrations — the Kommit
 * mode: "reads refs, queries the external APIs with locally provided tokens
 * ..., updates the mirrored status, and appends ref.status_changed events. No
 * arkaik server involved."):
 *
 *  1. walk every node's `metadata.refs`;
 *  2. for a ref whose `type` maps to a *live* provider (v1: GitHub only, via
 *     `../lib/providers`), fetch its current external status through the
 *     injectable `httpClient` seam — never a bare `fetch` — so tests (and CI)
 *     never touch the real network;
 *  3. a ref of an unknown type, or one whose provider is a documented stub
 *     (GitLab/Linear — not yet implemented), is left untouched: no error, no
 *     write, just a notice for stubs;
 *  4. when the fetched status differs from the ref's stored `external_status`,
 *     update `external_status` + `synced_at` on the ref and append ONE
 *     validated `ref.status_changed` event (dual-write, docs/spec/journal.md §
 *     Authority & Consistency Model) — same run, same `synced_at`. Unchanged
 *     refs get neither a write nor an event;
 *  5. the bundle is rewritten canonically (`serializeBundle`) only if at least
 *     one ref changed; `--dry-run` reports the same diff without writing
 *     anything.
 *
 * `node.status` is never touched and `status_mapped` is never set — the ref's
 * `external_status`/`synced_at` are the only snapshot fields this command
 * writes, so `crossCheckJournal` (which cross-checks `node.status_changed`
 * against `node.status`, not ref fields) stays satisfied and `arkaik validate`
 * stays green afterward.
 *
 * The clock (`now`) and the http client are both injectable via {@link
 * RunSyncOptions}, and `runSync` is exported standalone (not just the CLI
 * entry) so tests can call it directly with a mock client and a fixed time.
 */
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { makeEvent, serializeBundle, type JournalEvent } from "@arkaik/schema";
import { readBundle } from "../lib/bundle-io";
import { appendJournalEvent, journalPathFor } from "../lib/journal-io";
import { renderEventLine } from "../lib/render-event";
import {
  DEFAULT_HTTP_CLIENT,
  fetchRefStatus,
  providerForType,
  PROVIDERS,
  type HttpClient,
} from "../lib/providers";

const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";
const ACTOR = "arkaik-cli";

const PROVIDER_LINES = PROVIDERS.map((p) => {
  const state = p.status === "live" ? "live " : "stub ";
  const token = p.tokenEnvVar ? ` (token: ${p.tokenEnvVar})` : "";
  const note = p.status === "stub" ? " — not yet implemented, refs are reported and skipped" : "";
  return `  ${p.name.padEnd(8)} ${state}— ${p.refTypes.join(", ")}${token}${note}`;
}).join("\n");

const USAGE = `arkaik sync [--provider <name>] [--dry-run] [path]

Mirror external ref status into node metadata.refs. Reads every node's
metadata.refs, queries each ref's provider for its current external status,
and — when it differs from the mirrored external_status — updates
external_status + synced_at in the bundle and appends a validated
ref.status_changed event to journal.jsonl (dual-write, same run). Unchanged
refs are left alone. Refs of an unrecognized type, or handled by a stub
provider, are never modified and never error. external_status is a mirror,
never authoritative: node.status is never changed and status_mapped is never
auto-set by this command.

Providers (v1):
${PROVIDER_LINES}

Arguments:
  path              Path to the bundle JSON file (default: ${DEFAULT_BUNDLE_PATH}).

Options:
  --provider <name> Only sync refs handled by this provider (${PROVIDERS.map((p) => p.name).join(" | ")}).
  --dry-run         Report what would change without writing the bundle or
                     appending to the journal.
  -h, --help        Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export interface RefSyncChange {
  nodeId: string;
  refId: string;
  refType: string;
  from?: string;
  to: string;
}

export interface RefSyncUnchanged {
  nodeId: string;
  refId: string;
  refType: string;
  status: string;
}

export interface RefSyncSkip {
  nodeId: string;
  refId: string;
  refType: string;
  reason: "unknown-type" | "stub-provider" | "filtered-out";
  provider?: string;
}

export interface RefSyncError {
  nodeId: string;
  refId: string;
  refType: string;
  message: string;
}

export interface RunSyncOptions {
  /** Path to the bundle JSON file (default: docs/arkaik/bundle.json), resolved against `cwd`. */
  path?: string;
  /** Only sync refs handled by this provider name. */
  provider?: string;
  /** Report what would change without writing anything. */
  dryRun?: boolean;
  /** Base directory `path` resolves against (default: process.cwd()). */
  cwd?: string;
  /** Source of tokens, keyed by each provider's `tokenEnvVar` (default: process.env). */
  env?: Record<string, string | undefined>;
  /** The HTTP seam every provider call goes through (default: real fetch). Tests inject a mock. */
  httpClient?: HttpClient;
  /** Clock for `synced_at`/event `ts` (default: `() => new Date()`). Tests inject a fixed clock. */
  now?: () => Date;
  /** Journal event `actor` (default: "arkaik-cli"). */
  actor?: string;
}

export interface RunSyncResult {
  ok: boolean;
  /** Set when `ok` is false — a fatal error before any ref was processed. */
  fatal?: string;
  bundlePath: string;
  journalPath: string;
  dryRun: boolean;
  changed: RefSyncChange[];
  unchanged: RefSyncUnchanged[];
  skipped: RefSyncSkip[];
  errors: RefSyncError[];
  /** Node id -> title, gathered from the snapshot as read — for rendering the report. */
  nodeTitles: Map<string, string>;
}

function fatalResult(bundlePath: string, journalPath: string, dryRun: boolean, message: string): RunSyncResult {
  return {
    ok: false,
    fatal: message,
    bundlePath,
    journalPath,
    dryRun,
    changed: [],
    unchanged: [],
    skipped: [],
    errors: [],
    nodeTitles: new Map(),
  };
}

/**
 * Sync every node's `metadata.refs` against their external providers. Pure
 * with respect to its inputs (bundle path, provider filter, injected clock +
 * http client): the only side effects are the bundle rewrite and journal
 * append, both skipped under `--dry-run`.
 */
export async function runSync(options: RunSyncOptions = {}): Promise<RunSyncResult> {
  const cwd = options.cwd ?? process.cwd();
  const filePath = resolve(cwd, options.path ?? DEFAULT_BUNDLE_PATH);
  const journalPath = journalPathFor(filePath);
  const dryRun = options.dryRun ?? false;
  const httpClient = options.httpClient ?? DEFAULT_HTTP_CLIENT;
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;
  const actor = options.actor ?? ACTOR;

  if (options.provider !== undefined && !PROVIDERS.some((p) => p.name === options.provider)) {
    return fatalResult(
      filePath,
      journalPath,
      dryRun,
      `Unknown provider: ${options.provider} (known: ${PROVIDERS.map((p) => p.name).join(", ")})`,
    );
  }

  let bundle: Record<string, unknown>;
  try {
    bundle = readBundle(filePath);
  } catch (e) {
    return fatalResult(filePath, journalPath, dryRun, (e as Error).message);
  }

  const nodes = Array.isArray(bundle.nodes) ? (bundle.nodes as Record<string, unknown>[]) : [];
  const syncedAt = now().toISOString();

  const changed: RefSyncChange[] = [];
  const unchanged: RefSyncUnchanged[] = [];
  const skipped: RefSyncSkip[] = [];
  const errors: RefSyncError[] = [];
  const nodeTitles = new Map<string, string>();
  let dirty = false;

  for (const node of nodes) {
    const nodeId = typeof node.id === "string" ? node.id : undefined;
    if (nodeId !== undefined && typeof node.title === "string") nodeTitles.set(nodeId, node.title);
    const metadata = node.metadata;
    const refs =
      metadata !== null && typeof metadata === "object" && Array.isArray((metadata as Record<string, unknown>).refs)
        ? ((metadata as Record<string, unknown>).refs as Record<string, unknown>[])
        : [];

    for (const ref of refs) {
      const refId = typeof ref.id === "string" ? ref.id : undefined;
      const refType = typeof ref.type === "string" ? ref.type : undefined;
      const refUrl = typeof ref.url === "string" ? ref.url : undefined;
      // Malformed ref (missing id/type/url) — leave untouched; validate() flags shape errors.
      if (nodeId === undefined || refId === undefined || refType === undefined || refUrl === undefined) continue;

      const provider = providerForType(refType);
      if (!provider) {
        skipped.push({ nodeId, refId, refType, reason: "unknown-type" });
        continue;
      }
      if (options.provider !== undefined && provider.name !== options.provider) {
        skipped.push({ nodeId, refId, refType, reason: "filtered-out", provider: provider.name });
        continue;
      }
      if (provider.status !== "live") {
        skipped.push({ nodeId, refId, refType, reason: "stub-provider", provider: provider.name });
        continue;
      }

      const token = provider.tokenEnvVar ? env[provider.tokenEnvVar] : undefined;
      let fetched: string;
      try {
        fetched = await fetchRefStatus({ type: refType, url: refUrl }, { token, httpClient });
      } catch (e) {
        errors.push({ nodeId, refId, refType, message: (e as Error).message });
        continue;
      }

      const previous = typeof ref.external_status === "string" ? ref.external_status : undefined;
      if (fetched === previous) {
        unchanged.push({ nodeId, refId, refType, status: fetched });
        continue;
      }

      changed.push({ nodeId, refId, refType, from: previous, to: fetched });
      if (dryRun) continue;

      ref.external_status = fetched;
      ref.synced_at = syncedAt;
      dirty = true;

      const event = makeEvent(
        "ref.status_changed",
        {
          node_id: nodeId,
          ref_id: refId,
          ...(previous !== undefined ? { from: previous } : {}),
          to: fetched,
          synced_at: syncedAt,
        },
        { actor, ts: syncedAt },
      );
      appendJournalEvent(journalPath, event);
    }
  }

  if (dirty && !dryRun) {
    writeFileSync(filePath, serializeBundle(bundle as unknown as Parameters<typeof serializeBundle>[0]));
  }

  return { ok: true, bundlePath: filePath, journalPath, dryRun, changed, unchanged, skipped, errors, nodeTitles };
}

/** A rendered `ref.status_changed` line for a change, reusing the shared event renderer. */
function changeLine(change: RefSyncChange, nodeTitles: Map<string, string>): string {
  const event: JournalEvent = {
    id: "",
    ts: "",
    type: "ref.status_changed",
    node_id: change.nodeId,
    ref_id: change.refId,
    ...(change.from !== undefined ? { from: change.from } : {}),
    to: change.to,
    synced_at: "",
  };
  const nodesById = new Map<string, { title: string }>();
  for (const [id, title] of nodeTitles) nodesById.set(id, { title });
  return renderEventLine(event, nodesById);
}

function report(result: RunSyncResult): void {
  const nodeTitles = result.nodeTitles;
  console.log(`\n  Arkaik Sync${result.dryRun ? " (dry run)" : ""}`);
  console.log("  ============\n");

  if (result.changed.length === 0) {
    console.log("  No ref status changes.");
  } else {
    console.log(`  ${result.dryRun ? "Would change" : "Changed"}: ${result.changed.length}`);
    result.changed.forEach((c) => console.log(`    - ${changeLine(c, nodeTitles)}`));
  }

  if (result.unchanged.length > 0) {
    console.log(`  Unchanged: ${result.unchanged.length}`);
  }

  const stubSkips = result.skipped.filter((s) => s.reason === "stub-provider");
  if (stubSkips.length > 0) {
    console.log(`  Skipped (provider not yet implemented): ${stubSkips.length}`);
    const byProvider = new Map<string, number>();
    for (const s of stubSkips) byProvider.set(s.provider ?? "?", (byProvider.get(s.provider ?? "?") ?? 0) + 1);
    for (const [provider, count] of byProvider) console.log(`    - ${provider}: ${count} ref(s)`);
  }

  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`);
    result.errors.forEach((e) => console.log(`    - ${e.nodeId}/${e.refId} (${e.refType}): ${e.message}`));
  }

  console.log("");
}

export function runSyncCli(args: string[]): void {
  let provider: string | undefined;
  let dryRun = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--provider") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --provider\n\n${USAGE}`);
      provider = value;
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      positionals.push(arg);
    }
  }

  const filePath = positionals[0] ?? DEFAULT_BUNDLE_PATH;

  runSync({ path: filePath, provider, dryRun })
    .then((result) => {
      if (!result.ok) fail(`FATAL: ${result.fatal}`);
      report(result);
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch((e: unknown) => fail(`FATAL: ${(e as Error).message}`));
}
