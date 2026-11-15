/**
 * `arkaik restore [--dry-run] [--replace] [--allow-history-loss]
 *                 [--allow-deletions] [--no-quality] [--no-weighing]
 *                 [--allow-quality-loss] [--allow-metadata-loss]
 *                 [--audit <id>]
 *                 [--root <dir>] [--api <base-url>] [path]`
 *
 * Land a locally-built bundle — history included — on the hosted project
 * this repo is linked to (docs/superpowers/specs/2026-08-04-bootstrap-method-
 * design.md § 7, docs/superpowers/plans/2026-08-04-bootstrap-method.md
 * Task 12), in one server-side transaction (`PUT .../bundle`, Task 11).
 *
 * ── Append by default, replace on request (#624) ────────────────────────────
 * The PUT always replaces what the server stores. What changed is what this
 * command SENDS:
 *
 *  - by default (append) it fetches the hosted export and sends the local
 *    bundle laid over it (`mergeForAppend`, ../lib/restore-merge.ts): every
 *    hosted-only event, node, edge, setting, quality section and weighing row
 *    survives, and a shared id takes the local record. Nothing on the host can
 *    be removed, so the four loss guards below have nothing to catch and do
 *    not run. A dry run fetches the export too, since the merge needs it;
 *  - `--replace` is the old verb: the local bundle replaces the hosted one
 *    wholesale. It is what undoing a restore from a backup needs, and it is the
 *    only mode the guards and their `--allow-*` escape hatches apply to.
 *
 * Everything below about the backup and the guards describes replace mode
 * first; append keeps the backup (a shared id still overwrites the hosted
 * record) and skips the guards.
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
 *  - it lands at `docs/arkaik/.backups/`, anchored to the LINK FILE's
 *    directory (the hosted project's identity), never to wherever `--path`
 *    happened to point — two restores of two different local bundle files
 *    into the SAME hosted project must not scatter their recovery trail
 *    across two directories;
 *  - every way that export can fail — thrown network error, non-200, a body
 *    that isn't bundle-shaped, a bundle with no journal array — aborts the
 *    run with no PUT ever sent, not a warning;
 *  - an unwritable backup directory (permissions, a full disk, whatever)
 *    aborts the same way, for the same reason;
 *  - once written, the backup is read back and re-parsed before the PUT is
 *    ever sent — "the write call returned" is not the same claim as "the
 *    bytes are on disk and parseable," and this is the one file that claim
 *    has to be true for;
 *  - a colliding timestamp can never silently replace an earlier backup
 *    (`writeBackupFile` below) — an explicit, loud failure instead;
 *  - the local bundle's OWN journal is checked against the hosted count
 *    before anything is sent: an outbound journal shorter than the hosted
 *    one looks exactly like an ordinary successful restore otherwise (empty
 *    history is a valid, silent input on every other layer — see the guard
 *    below) — `--allow-history-loss` is the deliberate escape hatch when a
 *    shrink really is intended;
 *  - the same export is diffed BY ID against the outbound snapshot, and any
 *    hosted node or edge the local bundle does not carry refuses the run
 *    (`--allow-deletions` is that guard's escape hatch), as does an outbound
 *    bundle with no quality section landing on a hosted project that has one
 *    (`--allow-quality-loss`, and note that `--no-quality` does NOT imply it
 *    — see `describeQualityLoss`). The count-based
 *    history guard above structurally cannot see this class: a hosted
 *    project that has drifted ahead of the committed cache (someone edited
 *    it in the app) yields a delta like `nodes 173 -> 448 (+276 -1 ~172)`,
 *    where the journal grew, every count rose, and the single `-1` is a
 *    node the maintainer deliberately deleted being resurrected — with its
 *    replacement and that replacement's edges dropped in exchange. In a
 *    method whose first principle is "bootstrap never deletes", any negative
 *    in a restore delta is a contradiction, not a number in a row;
 *  - `--dry-run` skips the backup entirely and on purpose (see the `dryRun`
 *    branch below) — nothing destructive happens in that mode, so there is
 *    nothing to back up, and writing one anyway would clutter
 *    `.backups/` with files that were never protecting anything.
 *
 * ── How quality's precedence differs from the journal's ─────────────────────
 * A bundle's embedded `journal` always wins over the sidecar (above).
 * `quality` follows a different rule, in two halves:
 *
 *   the fold WINS when it has something to project — sidecars on disk
 *   re-project over whatever section the local file carried;
 *   the local section SURVIVES when the fold has nothing — no audits, no
 *   profile, no resolvable pack — and ships as it arrived.
 *
 * So `arkaik restore --replace <backup-path>` sends the LIVE repo's sidecars when that
 * repo has any, and the backup's own captured section when it does not. Both
 * halves are deliberate. The first is not the split-brain the journal rule
 * exists to prevent:
 *
 *  - a journal is an append-only history that exists NOWHERE else. A backup's
 *    copy is the authoritative record of what the hosted project held, so it
 *    must win or the undo silently rewrites history;
 *  - a `quality` section is a PROJECTION of sidecars that are canonical in
 *    the repo (docs/rfcs/kritik.md § 8.3) and that a restore never reads
 *    from, writes to, or rolls back. Re-projecting them reproduces the state
 *    the backup captured — unless the hosted section came from a different
 *    machine, which the quality-loss guard catches only when the outbound
 *    bundle ends up with NO section at all. A stale section that survives a
 *    failed fold passes that guard, because the guard's question is "would
 *    this erase the hosted section", and a section is being sent;
 *  - server-side quality writes append journal events and never mutate
 *    `snapshot.quality` (`applyQualityResolutions`), so a resolution made in
 *    the app comes back with the JOURNAL — under the embedded-wins rule —
 *    rather than with the section;
 *  - and flipping it would collide with `--no-quality`, whose whole point is
 *    that a section the local bundle carried gets DELETED rather than sent.
 *
 * And the second half is what makes the undo path whole: a backup file always
 * carries a `quality` section, because the export it was written from
 * includes one. Dropping it on a machine whose sidecars are missing would
 * make `arkaik restore --replace <backup-path>` silently undo the snapshot and the
 * journal while discarding the quality half of the very state being restored.
 *
 * So: history is always restored, quality is re-derived where it can be and
 * carried through where it cannot. Both halves are pinned by
 * tests/cli/bootstrap-restore.test.js so they read as chosen, not accidental.
 *
 * ── Steps, in order ──────────────────────────────────────────────────────────
 *  1. read the link file for the project id and remote (mirrors `link.ts`);
 *  2. assemble the outbound bundle — BEFORE any network call, which is the
 *     point: a malformed sidecar or a `--audit` that names nothing aborts the
 *     run without a single request having left the machine. It is the local
 *     `bundle.json`, plus its journal and its `docs/quality/` sidecars.
 *     `restore` does not go through `runPack`, so it folds both itself:
 *     quality via `foldQualitySection` over the root `resolveQualityRoot`
 *     derives from the bundle's own path (`--root` overrides; `--audit` pins
 *     one audit; `--no-quality` deletes the section instead, including one
 *     the local file already carried), and the journal via
 *     `loadJournalEvents` (embedded journal wins over the `journal.jsonl`
 *     sidecar, the same precedence `arkaik validate` uses — load-bearing here
 *     for a reason beyond mere consistency: a BACKUP file always carries its
 *     journal embedded, so if the sidecar ever won instead, running `arkaik
 *     restore --replace <backup-path>` to undo a bad restore would silently pair that
 *     backup's old snapshot with whatever journal happens to sit in the
 *     LIVE repo's `journal.jsonl` — the exact split-brain this precedence
 *     exists to prevent) — `bundle.json` on disk does NOT itself contain the
 *     journal in the common case, so skipping this step would silently send
 *     an empty history and destroy the hosted one;
 *  3. GET the project for its current version — this becomes `If-Match` for
 *     BOTH a dry run and a real write. Dry-run needs it too: the server's
 *     preview runs the identical validation/version-check/delta path a real
 *     write does (`classifyDryRun`, Task 11), so a stale version must
 *     produce the same 412 in preview as it would for real;
 *  4. real restore only: GET the export, check its journal isn't shorter
 *     than the outbound one (unless `--allow-history-loss`) and that the
 *     outbound snapshot drops none of its nodes or edges (unless
 *     `--allow-deletions`) and that it does not erase a hosted `quality`
 *     section (unless `--allow-quality-loss`), then write the export to
 *     `docs/arkaik/.backups/<ts>-bundle.json` and abort on ANY failure — see
 *     above. All THREE guards run BEFORE the backup is written: a refused run
 *     should leave no trace in `.backups/`, exactly like a dry run. None of
 *     them runs under `--dry-run`, which never fetches the export at all;
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
 * Every message that names a backup path also names the verb: `arkaik
 * restore --replace <backupPath>` genuinely undoes a restore (the backup's embedded
 * journal wins on the way back in, per the precedence note above), so a
 * caller in a panic gets a command, not just a filename to stare at.
 *
 * The only network calls in this module go through the injected `httpClient`
 * seam (`../lib/providers`, the same seam `arkaik push`/`arkaik sync` use) —
 * never a bare `fetch` — so tests substitute a mock and never touch the real
 * network. `runRestore` is exported standalone (not just the CLI entry) so
 * tests can call it directly with a mock client, mirroring `runPush`.
 */
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { journalPathFor, loadJournalEvents } from "../lib/journal-io";
import { foldQualitySection, isQualitySection, resolveQualityRoot } from "../lib/kritik-io";
import { foldWeighingSection } from "../lib/weighing-io";
import { QUALITY_DIR } from "@arkaik/schema/src/cli/kritik-paths";
import { DEFAULT_HTTP_CLIENT, type HttpClient } from "../lib/providers";
import { describeAppendSummary, mergeForAppend, type AppendSummary } from "../lib/restore-merge";

export { mergeForAppend, describeAppendSummary, RESTORE_ACTOR, type AppendSummary } from "../lib/restore-merge";

const LINK_FILE = "docs/arkaik/arkaik.json";
const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";

/** Default hosted instance — override with `--api <base-url>` for self-hosted deployments. */
export const DEFAULT_API_BASE = "https://arkaik.app";

const USAGE = `arkaik restore [options] [path]

Land a local bundle on the linked hosted project — the landing step for a
bootstrapped map.

By default this APPENDS: the local bundle is merged into what the hosted
project already holds. Hosted-only events, nodes, edges, project settings,
quality and weighing state are all kept; where both sides hold the same id,
the local record wins, except a status changed on the hosted project after
your copy. Nothing on the hosted project is removed.

--replace swaps the hosted bundle, journal and sections for the local ones
wholesale, removing whatever the local bundle lacks. That is what undoing a
restore from a backup needs, and it refuses any loss you have not allowed
with an --allow-* flag.

Before a real run sends anything, this exports the CURRENT hosted state
(snapshot + journal) to docs/arkaik/.backups/<timestamp>-bundle.json (next to
the link file — not wherever the local bundle happens to live) and refuses to
proceed if that backup cannot be written — the server keeps no pre-image, so
this file is the only way back if the restore turns out to be wrong.

Arguments:
  path                Path to the local bundle JSON file
                       (default: ${DEFAULT_BUNDLE_PATH}). Its journal.jsonl
                       sidecar (or an embedded journal, which wins) is folded
                       in automatically, as is the docs/quality/ tree of the
                       repo that bundle belongs to.

Options:
  --dry-run             Ask the server what this restore WOULD do and print
                        the delta. Sends nothing destructive and takes no
                        backup (there is nothing to protect against in this
                        mode).
  --replace             Replace the hosted project wholesale instead of
                        appending to it. Anything the local bundle lacks is
                        removed, so each kind of loss below refuses unless its
                        --allow-* flag is passed too. Undo a restore with
                        the command a real restore prints (--replace with
                        every --allow-* flag).

Only with --replace:
  --allow-history-loss  Proceed even though the outbound journal has fewer
                        events than the hosted one currently holds. Without
                        this flag, that shrink refuses outright — it usually
                        means a missing/gitignored journal.jsonl or a bundle
                        from the wrong directory, not an intended history
                        rewrite.
  --allow-deletions     Proceed even though the local bundle drops nodes or
                        edges the hosted project currently has. Without this
                        flag, that refuses outright and names the ids — it
                        usually means the hosted project moved ahead of your
                        local copy (edited in the app), not an intended
                        deletion. Undoing a restore from a backup is the
                        common case where it IS intended.
  --allow-quality-loss  Proceed even though the restore would erase a quality
                        section the hosted project currently has. Without this
                        flag, that refuses outright — it usually means
                        docs/quality/ was looked for in the wrong place, which
                        --root fixes, rather than an intended wipe.
  --allow-metadata-loss Proceed even though the local bundle's project.metadata
                        lacks settings the hosted project has (products, maps,
                        ref_policy, pollen, ...). Without this flag, that
                        refuses outright and names the keys — those settings
                        are usually edited in the app and never reach the
                        repo bundle, so a restore would silently delete them.

Either mode:
  --no-quality          Do not send a quality section: skip the docs/quality/
                        fold AND drop any section the local bundle already
                        carries. An append keeps the hosted section. Under
                        --replace this does NOT by itself permit erasing the
                        hosted one — that needs --allow-quality-loss too,
                        because "don't send mine" and "destroy theirs" are
                        different decisions and only one is irreversible.
  --no-weighing         Do not send a weighing section: skip the docs/weighing/
                        fold AND drop any section the local bundle already
                        carries. An append keeps the hosted section and every
                        hosted assessment event. WARNING under --replace: an
                        assessment recorded only on the hosted project lives in
                        the journal that --replace overwrites, and the history
                        guard compares COUNTS, so it does not reliably protect
                        those events. The backup this command writes first
                        holds them.
  --audit <id>          Fold ONE audit's snapshot rather than merging every
                        audit into current state. An id that is not on disk is
                        an error, not an empty section.
  --root <dir>          Where docs/quality/ lives. Default: derived from the
                        bundle's own path, so restoring <repo>/docs/arkaik/
                        bundle.json folds <repo>'s audits whatever directory
                        you run from; only a bundle kept outside that layout
                        falls back to the cwd.
  --api <base-url>      Override the remote from docs/arkaik/arkaik.json
                        (also overridable with $ARKAIK_URL).
  -h, --help            Show this help.

Environment:
  ARKAIK_TOKEN       Required. Create one at <origin>/settings/tokens.
  ARKAIK_URL         Optional. Overrides the link file's remote (same as
                     \`arkaik link\`); --api still wins over this.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export interface RunRestoreOptions {
  /** Path to the local bundle file, resolved against `cwd` (default: docs/arkaik/bundle.json). */
  path?: string;
  /** Preview via the server's dry-run mode instead of writing for real. Default: false. */
  dryRun?: boolean;
  /** Replace the hosted project wholesale instead of appending to it (#624). The loss guards and their `allow*` overrides apply only here. Default: false. */
  replace?: boolean;
  /** Proceed even when the outbound journal is shorter than the hosted one. Default: false. */
  allowHistoryLoss?: boolean;
  /** Proceed even when the outbound snapshot drops hosted nodes or edges. Default: false. */
  allowDeletions?: boolean;
  /** Skip folding docs/quality/ into the outbound bundle, and drop any section the local bundle carries. Default: false. */
  noQuality?: boolean;
  /** Skip folding docs/weighing/ into the outbound bundle, and drop any section the local bundle carries. Default: false. */
  noWeighing?: boolean;
  /** Pin one audit's snapshot instead of merging every audit into current state. */
  audit?: string;
  /** Repo root holding docs/quality/. Default: derived from the bundle's path, cwd as fallback. */
  root?: string;
  /** Proceed even when the restore would wipe a quality section the hosted project has. Default: false. */
  allowQualityLoss?: boolean;
  /** Proceed even when the outbound `project.metadata` drops keys the hosted one has. Default: false. */
  allowMetadataLoss?: boolean;
  /** Hosted API base URL, overriding $ARKAIK_URL and the link file's `remote`. */
  apiBase?: string;
  /** Base directory the link file / bundle path resolve against (default: process.cwd()). */
  cwd?: string;
  /** Environment ARKAIK_TOKEN / ARKAIK_URL are read from (default: process.env). */
  env?: Record<string, string | undefined>;
  /** The HTTP seam every request goes through (default: real fetch). Tests inject a mock. */
  httpClient?: HttpClient;
}

/** Minimal shape of the `BundleDelta` the server returns — see `lib/services/graph/restore.ts`. All fields are optional here since this side only ever displays them, never computes them. */
export type DeltaSummary = Record<string, number | undefined>;

export interface RunRestoreResult {
  /** False only for a fatal PRE-FLIGHT error (bad link file, missing token, unreadable bundle, a would-be history loss, or the mandatory backup step failing) — no PUT was ever attempted. */
  ok: boolean;
  /** Set when `ok` is false. */
  fatal?: string;
  dryRun: boolean;
  /** Whether this run appended to the hosted project (the default) or replaced it. */
  mode?: "append" | "replace";
  /** Append only, once the merge ran: what the hosted project had that the local bundle did not, all of it kept. */
  kept?: AppendSummary;
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
  /** Whether a `quality` section was folded into the outbound bundle. */
  qualityFolded?: boolean;
  /**
   * What happened to quality on the way out — folded, skipped, or deleted.
   *
   * Unlike `RunPackResult.qualityNotice`, this is set even under
   * `--no-quality`. `pack` writes a bundle the caller can inspect; `restore`
   * replaces a hosted project and returns a delta that says nothing about
   * quality at all, so "what did you do with my findings" has to be answered
   * here or nowhere.
   */
  qualityNotice?: string;
}

function fatalResult(
  dryRun: boolean,
  message: string,
  quality: { qualityFolded?: boolean; qualityNotice?: string } = {},
): RunRestoreResult {
  return { ok: false, fatal: message, dryRun, requestSent: false, ...quality };
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
 * The recovery instruction every message naming a backup path should carry —
 * not just the filename, but the verb: `arkaik restore --replace <backupPath>`
 * genuinely restores that snapshot (its embedded journal wins on the way
 * back in — see the module doc comment's precedence note). Centralized so
 * every call site says the same thing, in the same words.
 */
function backupNoteFor(backupPath: string | undefined): string {
  if (!backupPath) return "";
  return ` Your pre-restore backup is at ${backupPath}. Undo this restore with: ${undoCommandFor(backupPath)}`;
}

/**
 * The command that puts a backup back. It has to be `--replace` (an append of the
 * backup would keep everything the restore added), and it has to carry all four
 * `--allow-*` flags: the backup predates the restore, so it has fewer events and
 * nodes and may lack settings or a quality section the restore brought, and each
 * of those trips a guard. Going back to exactly the backup IS the intended loss.
 * Anything written on the hosted project after the restore is lost too, which is
 * why the undo is printed, never run.
 */
export function undoCommandFor(backupPath: string): string {
  return `arkaik restore --replace --allow-history-loss --allow-deletions --allow-quality-loss --allow-metadata-loss ${backupPath}`;
}

/** The `--allow-*` flags set on `options`, by their CLI names. */
function allowFlagsOf(options: RunRestoreOptions): string[] {
  return [
    options.allowHistoryLoss && "--allow-history-loss",
    options.allowDeletions && "--allow-deletions",
    options.allowQualityLoss && "--allow-quality-loss",
    options.allowMetadataLoss && "--allow-metadata-loss",
  ].filter((flag): flag is string => typeof flag === "string");
}

/** Why an `--allow-*` flag without `--replace` is refused rather than ignored. */
function describeAllowWithoutReplace(flags: string[]): string {
  return (
    `${flags.join(", ")} only ${flags.length === 1 ? "applies" : "apply"} with --replace. ` +
    `restore appends by default and removes nothing, so there is no loss to allow. ` +
    `To replace the hosted project (for example to undo a restore from a backup), add --replace.`
  );
}

/**
 * Interpret the PUT response — success or one of the seven documented
 * failure statuses — into a `RunRestoreResult`. Every failure gets its own
 * actionable message; the real-restore ones (backupPath set) always name the
 * backup AND the undo command, since that is the recovery instruction. 428/
 * 400 should never actually happen from this CLI (it always sends a valid
 * `If-Match` and `?dryRun` token), but are still handled distinctly rather
 * than falling into a generic branch, in case a bug ever does produce one.
 */
async function interpretPutResponse(
  res: Response,
  ctx: {
    dryRun: boolean;
    bundlePath: string;
    backupPath?: string;
    version: string;
    qualityFolded?: boolean;
    qualityNotice?: string;
    mode: "append" | "replace";
    kept?: AppendSummary;
  },
): Promise<RunRestoreResult> {
  const base: RunRestoreResult = {
    ok: true,
    dryRun: ctx.dryRun,
    mode: ctx.mode,
    kept: ctx.kept,
    bundlePath: ctx.bundlePath,
    backupPath: ctx.backupPath,
    requestSent: true,
    status: res.status,
    qualityFolded: ctx.qualityFolded,
    qualityNotice: ctx.qualityNotice,
  };
  const backupNote = backupNoteFor(ctx.backupPath);

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
      return { ...base, errorMessage: `Project not found (or not owned by this token). Nothing was written.${backupNote}` };
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

/**
 * Write the pre-restore backup with two guarantees `bootstrap.ts`'s sibling
 * `writeFileAtomic` (temp file + rename) gives `bundle.json`/`journal.jsonl`,
 * PLUS one more this file needs that one doesn't: a colliding timestamp must
 * never silently replace an earlier backup. Two restores landing on the
 * identical millisecond stamp inside one process is remote (a dedicated test
 * forces it by freezing the clock); two SEPARATE real restores colliding
 * needs two independent round-trips inside the same millisecond, rarer
 * still — but the failure mode if it ever happened, a backup silently
 * overwritten by a different one, is exactly what this file exists to make
 * impossible, not merely unlikely.
 *
 * Technique: write to a same-directory temp file (so nothing at `filePath`
 * itself is ever a truncated partial write, even if this process is killed
 * mid-write), then `linkSync` the temp file into place — a hard link FAILS
 * with EEXIST if `filePath` already exists, giving atomicity and exclusivity
 * together rather than trading one for the other (a bare `writeFileSync(...,
 * { flag: "wx" })` gets exclusivity alone, with no protection against a
 * truncated file at the real path if the process dies mid-write). The temp
 * file is removed either way in `finally` — once linked, it was only ever a
 * staging area; on a collision, nothing should linger behind either.
 */
function writeBackupFile(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, content);
  try {
    linkSync(tmpPath, filePath);
  } finally {
    unlinkSync(tmpPath);
  }
}

/**
 * Ids present in `before` but absent from `after`, matched by `id` — the same
 * key the server's own delta matches on. Entries carrying no string id are
 * skipped on both sides: they cannot be matched either way, and the server
 * already accounts for them separately as `nodesMalformed`/`edgesMalformed`.
 */
function removedIds(before: unknown[], after: unknown[]): string[] {
  const kept = new Set<string>();
  for (const item of after) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id === "string") kept.add(id);
  }
  const removed: string[] = [];
  for (const item of before) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id === "string" && !kept.has(id)) removed.push(id);
  }
  return removed;
}

/** At most `limit` ids, with an explicit "+N more" rather than a silent truncation. */
function listIds(ids: string[], limit = 10): string {
  if (ids.length <= limit) return ids.join(", ");
  return `${ids.slice(0, limit).join(", ")}, and ${ids.length - limit} more`;
}

/**
 * The refusal message for a restore that would drop hosted entities. It names
 * the ids because a bare count is what made this class of loss cost a
 * 20-minute investigation instead of being self-evident: `-1 node` says
 * nothing, `-1 node (DM-bounce)` says everything.
 */
function describeDeletions(removedNodes: string[], removedEdges: string[], bundlePath: string): string {
  const parts: string[] = [];
  if (removedNodes.length > 0) parts.push(`${removedNodes.length} node${removedNodes.length === 1 ? "" : "s"}`);
  if (removedEdges.length > 0) parts.push(`${removedEdges.length} edge${removedEdges.length === 1 ? "" : "s"}`);
  const lines = [
    `This restore would DELETE ${parts.join(" and ")} the hosted project currently has and ${bundlePath} does not. Nothing was sent.`,
  ];
  if (removedNodes.length > 0) lines.push(`  nodes: ${listIds(removedNodes)}`);
  if (removedEdges.length > 0) lines.push(`  edges: ${listIds(removedEdges)}`);
  lines.push(
    `Usually this means the hosted project moved ahead of your local copy (someone edited it in the app) ` +
      `and the local bundle is the stale side — not that you meant to delete anything. ` +
      `Adopt the hosted state locally first: \`GET /api/graph/projects/<id>/export\` is what answers ` +
      `"what am I about to overwrite".`,
  );
  lines.push(
    `If the deletions really are intended — undoing an earlier restore from a backup legitimately removes ` +
      `what that restore added — re-run with --allow-deletions.`,
  );
  return lines.join("\n");
}

/**
 * Why a restore that would erase the hosted quality section is refused, and
 * what to do about it.
 *
 * The remedy is NOT guessed here. `foldQualitySection` already established
 * why the outbound bundle has no section — no audits, no profile, no
 * resolvable pack — and its notice says so in the same words `arkaik pack`
 * prints, so that notice is quoted rather than paraphrased. Guessing was the
 * defect: a repo with a populated `docs/quality/` and no `profile.json` was
 * told `no docs/quality/ under <dir>` and sent after a `--root` problem that
 * did not exist, when the fix was `arkaik kritik profile`.
 *
 * `--no-quality` keeps its own branch, because there the fold never ran and
 * there is nothing to quote — and because pointing that caller at `--root`
 * would be wrong for the opposite reason: their root is fine, they asked not
 * to send. The distinction is why `--no-quality` does not imply
 * `--allow-quality-loss`; "do not send mine" and "destroy theirs" are
 * different sentences, and only one of them is irreversible.
 *
 * `--root` is named only when there is genuinely no `docs/quality/` under the
 * root that was searched — the one case where a wrong root really is the
 * likeliest explanation.
 */
function describeQualityLoss(
  hostedQuality: Record<string, unknown>,
  qualityRoot: string,
  noQuality: boolean,
  foldNotice: string | undefined,
): string {
  // Findings AND assessments: a section holding 40 scored cells and no open
  // findings still represents an audit someone ran, and "(0 findings)" sells
  // that erasure as nothing.
  const findings = Array.isArray(hostedQuality.findings) ? hostedQuality.findings.length : 0;
  const assessments = Array.isArray(hostedQuality.assessments) ? hostedQuality.assessments.length : 0;
  const parts: string[] = [];
  if (findings > 0) parts.push(`${findings} open finding${findings === 1 ? "" : "s"}`);
  if (assessments > 0) parts.push(`${assessments} assessment${assessments === 1 ? "" : "s"}`);
  const held = parts.length > 0 ? parts.join(" and ") : "no findings or assessments";

  const lines = [
    `This restore would ERASE the hosted project's quality section (${held}). Nothing was sent.`,
  ];
  if (noQuality) {
    lines.push(
      `You passed --no-quality, which says "do not send my quality data" — not "destroy what is already there". ` +
        `Those are different decisions, and this verb has no server-side undo, so the second one has to be typed: ` +
        `re-run with --allow-quality-loss as well if you really mean to wipe it.`,
    );
  } else {
    if (foldNotice !== undefined) {
      lines.push("The outbound bundle has no section because the fold found nothing to build one from:");
      lines.push(`  ${foldNotice}`);
    }
    if (!existsSync(join(qualityRoot, QUALITY_DIR))) {
      lines.push(
        `There is no ${QUALITY_DIR}/ under ${qualityRoot} at all. If this project's sidecars live somewhere ` +
          `else, point --root at that repo and the section is rebuilt rather than removed.`,
      );
    }
    lines.push(`If the hosted section really is meant to go, re-run with --allow-quality-loss.`);
  }
  return lines.join("\n");
}

/** Top-level `project.metadata` keys the hosted project has and the outbound bundle does not. */
export function droppedMetadataKeys(hostedProject: unknown, outboundProject: unknown): string[] {
  const metadataOf = (project: unknown): Record<string, unknown> => {
    if (typeof project !== "object" || project === null || Array.isArray(project)) return {};
    const metadata = (project as { metadata?: unknown }).metadata;
    return typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  };
  const outbound = metadataOf(outboundProject);
  return Object.keys(metadataOf(hostedProject))
    .filter((key) => !(key in outbound))
    .sort();
}

/**
 * Why a restore that would drop hosted `project.metadata` keys is refused (#423).
 *
 * `PUT .../bundle` replaces `project.metadata` wholesale, and that object is
 * where the settings that only ever exist server-side live — products, custom
 * maps, `ref_policy`, `pollen.plant` — written in the app, never in the repo
 * bundle. A restore of that bundle deleted them without a word: the delta
 * counts nodes, edges and events and reads `+0 -0`, and the first symptom was
 * a federation feed answering 404 for six days. Only DROPPED keys refuse: a
 * changed value is what restoring a backup is for, and a missing key is the
 * shape every one of those losses had.
 */
function describeMetadataLoss(dropped: string[], bundlePath: string): string {
  return [
    `This restore would DELETE ${dropped.length} hosted project setting${dropped.length === 1 ? "" : "s"} ` +
      `(project.metadata: ${dropped.join(", ")}) that ${bundlePath} does not carry. Nothing was sent.`,
    `Those settings are usually edited in the app and never reach the repo bundle. Copy them into the local ` +
      `bundle's project.metadata (GET .../export has them) so the restore keeps them, or re-run with ` +
      `--allow-metadata-loss if they really are meant to go.`,
  ].join("\n");
}

type ExportedBundle = { project?: unknown; nodes: unknown[]; edges: unknown[]; journal: unknown[]; quality?: unknown; weighing?: unknown };

/**
 * GET the hosted export and check it is a whole bundle, or say why not. A real
 * run needs it as the backup (the only recovery path), so every failure keeps
 * the "refusing to restore without a backup" wording; an append dry run needs
 * it only to merge, and says that instead.
 */
async function fetchExport(
  httpClient: HttpClient,
  url: string,
  headers: Record<string, string>,
  dryRun: boolean,
): Promise<ExportedBundle | string> {
  const why = dryRun ? "An append preview needs it to merge." : "Refusing to restore without a backup.";
  let exported: unknown;
  try {
    const exportRes = await httpClient(url, { headers });
    if (!exportRes.ok) {
      return `Could not export the current hosted state (${exportRes.status}). ${why} Nothing was sent.`;
    }
    const body = await safeJson(exportRes);
    exported = body.bundle;
  } catch (e) {
    return `Could not export the current hosted state: ${(e as Error).message}. ${why}`;
  }
  if (typeof exported !== "object" || exported === null || Array.isArray(exported)) {
    return `The export response was not a bundle. ${why} Nothing was sent.`;
  }
  const bundle = exported as Record<string, unknown>;
  if (!Array.isArray(bundle.journal) || !Array.isArray(bundle.nodes) || !Array.isArray(bundle.edges)) {
    return dryRun
      ? "The exported bundle is missing nodes, edges, or a journal array, so there is nothing whole to merge into. Nothing was sent."
      : "The exported bundle is missing nodes, edges, or a journal array — an incomplete backup would not cover what restore is about to destroy. Refusing to restore. Nothing was sent.";
  }
  return bundle as ExportedBundle;
}

export async function runRestore(options: RunRestoreOptions = {}): Promise<RunRestoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const dryRun = options.dryRun ?? false;
  const replace = options.replace ?? false;
  const mode: "append" | "replace" = replace ? "replace" : "append";
  const allowHistoryLoss = options.allowHistoryLoss ?? false;
  const allowDeletions = options.allowDeletions ?? false;
  const noQuality = options.noQuality ?? false;
  const noWeighing = options.noWeighing ?? false;
  const allowQualityLoss = options.allowQualityLoss ?? false;
  const allowMetadataLoss = options.allowMetadataLoss ?? false;
  const httpClient = options.httpClient ?? DEFAULT_HTTP_CLIENT;

  // The --allow-* flags permit a loss, and only --replace can cause one. Passing one without
  // it is almost always a command written before append became the default (#624) — most
  // often an undo from a backup, which needs --replace to remove what the restore added.
  // Refuse rather than quietly append.
  const strayAllowFlags = allowFlagsOf(options);
  if (strayAllowFlags.length > 0 && !replace) return fatalResult(dryRun, describeAllowWithoutReplace(strayAllowFlags));

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
  // Precedence: --api flag > $ARKAIK_URL > the link file's own `remote` >
  // the public default — same order packages/mcp/src/config.ts's
  // resolveRemoteConfig uses for the same two-source combination, and the
  // same env var `arkaik link` itself honors. Env beats the persisted link
  // file deliberately: a user who exports ARKAIK_URL for `arkaik link
  // --list` and then runs `arkaik restore` in the same shell must land on
  // the SAME remote, not silently fall back to whatever an earlier `arkaik
  // link` run happened to persist.
  const baseUrl = (options.apiBase ?? env.ARKAIK_URL ?? link.remote ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const encodedProjectId = encodeURIComponent(projectId);

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
  // Step 4b: quality. `restore` assembles its own outbound bundle rather than
  // going through `runPack`, so it needs its own fold — and `delete` rather
  // than "skip the fold" for the same reason `pack` does: a local bundle.json
  // may already carry a `quality` key, and declining to add one would send
  // that one. `qualityRoot` is kept for the loss guard's message below, which
  // needs to name the directory that was actually searched.
  const outboundBundle: Record<string, unknown> = { ...local, journal: journalEvents };
  const qualityRoot = resolveQualityRoot({ root: options.root, bundlePath, fallback: cwd });
  let qualityFolded = false;
  let qualityNotice: string | undefined;
  if (noQuality) {
    delete outboundBundle.quality;
    qualityNotice = "Quality: deleted before sending (--no-quality)";
  } else {
    try {
      const fold = foldQualitySection(outboundBundle, qualityRoot, options.audit);
      qualityFolded = fold.folded;
      qualityNotice = fold.notice;
    } catch (e) {
      return fatalResult(dryRun, (e as Error).message);
    }
  }
  const qualityFields = { qualityFolded, qualityNotice };

  // Weighing rides the same bundle, from the same repo root. An append keeps every hosted
  // weighing row and event (`mergeForAppend`). Under --replace there is NO loss guard of its
  // own, and the history guard does not stand in for one: an assessment recorded only on
  // the hosted project is a journal event, the PUT replaces the journal, and the guard
  // compares COUNTS. The backup written before the PUT is the only recovery there.
  if (noWeighing) {
    delete outboundBundle.weighing;
  } else {
    try {
      foldWeighingSection(outboundBundle, qualityRoot);
    } catch (e) {
      return fatalResult(dryRun, (e as Error).message);
    }
  }

  const headers = { Authorization: `Bearer ${token}` };

  // Step 2: read the current version. Needed for If-Match on BOTH branches —
  // see the module doc comment for why dry-run doesn't get to skip this.
  let version: string;
  try {
    const projectRes = await httpClient(`${baseUrl}/api/graph/projects/${encodedProjectId}`, { headers });
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

  // A replace dry run never fetches the export (it has nothing to diff it against that the
  // server's own delta does not already show). Every other run needs it: a real run for the
  // backup and the guards, an append for the merge.
  let exportedBundle: ExportedBundle | undefined;
  if (!(replace && dryRun)) {
    const read = await fetchExport(httpClient, `${baseUrl}/api/graph/projects/${encodedProjectId}/export`, headers, dryRun);
    if (typeof read === "string") return fatalResult(dryRun, read, qualityFields);
    exportedBundle = read;
  }

  let sendBundle: Record<string, unknown> = outboundBundle;
  let kept: AppendSummary | undefined;
  if (!replace && exportedBundle !== undefined) {
    try {
      const merged = mergeForAppend(exportedBundle as Record<string, unknown>, outboundBundle);
      sendBundle = merged.bundle;
      kept = merged.kept;
    } catch (e) {
      return fatalResult(dryRun, `Could not merge the local bundle into the hosted one: ${(e as Error).message}. Nothing was sent.`, qualityFields);
    }
  }
  const putBody = JSON.stringify({ bundle: sendBundle });
  const resultCtx = { dryRun, bundlePath, version, mode, kept, ...qualityFields };

  if (dryRun) {
    // No backup, on purpose: the server writes nothing in this mode, so
    // there is nothing destructive to protect against — see the module doc
    // comment. The explicit `?dryRun=1` is used rather than the bare
    // `?dryRun` shorthand, per Task 12's note: the safer of the two
    // recognized preview spellings for a code path that must never
    // accidentally take the destructive branch.
    let res: Response;
    try {
      res = await httpClient(`${baseUrl}/api/graph/projects/${encodedProjectId}/bundle?dryRun=1`, {
        method: "PUT",
        headers: putHeaders,
        body: putBody,
      });
    } catch (e) {
      return { ok: true, dryRun, mode, kept, bundlePath, requestSent: false, errorMessage: `Network error: ${(e as Error).message}` };
    }
    return interpretPutResponse(res, resultCtx);
  }
  if (exportedBundle === undefined) {
    // Unreachable: only a replace dry run skips the export, and it returned above.
    return fatalResult(dryRun, "Internal error: no hosted export in hand for a real restore. Nothing was sent.", qualityFields);
  }
  const exported = exportedBundle;

  // ── Loss guards (--replace only) ────────────────────────────────────────
  // An append can only add and update — the merge keeps every hosted id, key
  // and section — so none of the four losses below can happen and the guards
  // are skipped. They exist for --replace, where each one is a typed decision.
  if (replace) {
    // ── History-loss guard ───────────────────────────────────────────────────
    // An outbound journal SHORTER than the hosted one silently wipes history
    // and reads as an ordinary successful restore everywhere else:
    // `loadJournalEvents` returns `[]` by design when there is no sidecar and
    // no embedded journal, nothing downstream objects to an empty journal, and
    // the collapse shows up only as `events N -> 0` in the printed delta —
    // formatted identically to the two unremarkable lines above it. Ordinary
    // triggers: `journal.jsonl` uncommitted or gitignored, `arkaik restore
    // <path>` pointing at a bundle in a different directory than its sidecar,
    // or a fresh clone run before `merge`. `exportedBundle.journal` is already
    // a validated array from the check just above, so no extra round-trip is
    // needed to compare against it.
    const hostedEventCount = exported.journal.length;
    if (journalEvents.length < hostedEventCount && !allowHistoryLoss) {
      return fatalResult(
        dryRun,
        `This restore would replace ${hostedEventCount} hosted journal events with ${journalEvents.length}. ` +
          `Nothing was sent. If that is intended, re-run with --allow-history-loss; ` +
          `otherwise check that ${journalPathFor(bundlePath)} exists and is current.`,
        qualityFields,
      );
    }

    // ── Quality-loss guard ───────────────────────────────────────────────────
    // Same shape as the history guard above, and the same blind spot without
    // it: a repo with no sidecars restoring over a hosted project that HAS a
    // quality section erases every open finding on it, and the printed delta
    // says nothing about quality at all. The export is already in hand for the
    // backup, so this costs no extra round-trip. Runs before the backup write
    // for the reason the history guard states: a refused run should leave
    // nothing behind in `.backups/`.
    //
    // `--no-quality` deliberately does NOT imply this flag — see
    // `describeQualityLoss`.
    //
    // Both sides are tested with the SAME predicate (`isQualitySection`, shared
    // with the fold). Checking only `=== undefined` on the outbound side let a
    // local `"quality": null` or `"quality": "oops"` count as a section and sail
    // past into the request. The schema rejects it one layer down, so this is
    // defence in depth rather than the only line, but a guard that fails open on
    // a shape it never considered is not a guard.
    //
    // Note what this guard CANNOT see: a section the local bundle carried that
    // the fold did not replace (`carriedSection`). The outbound bundle has one,
    // so nothing fires — correctly, since that is the undo path. See the
    // precedence section in this file's header.
    const hostedQuality = exported.quality;
    if (isQualitySection(hostedQuality) && !isQualitySection(outboundBundle.quality) && !allowQualityLoss) {
      return fatalResult(dryRun, describeQualityLoss(hostedQuality, qualityRoot, noQuality, qualityNotice), qualityFields);
    }

    // ── Metadata-loss guard (#423) ──────────────────────────────────────────
    // Same shape as the guards around it, and the same blind spot without it:
    // `project.metadata` is replaced wholesale and the printed delta never
    // mentions it. Runs before the backup write so a refused run leaves nothing
    // behind in `.backups/`. See `describeMetadataLoss`.
    const droppedKeys = droppedMetadataKeys(exported.project, outboundBundle.project);
    if (droppedKeys.length > 0 && !allowMetadataLoss) {
      return fatalResult(dryRun, describeMetadataLoss(droppedKeys, bundlePath), qualityFields);
    }

    // ── Deletion guard ───────────────────────────────────────────────────────
    // The history guard above compares COUNTS, so it cannot see a deletion that
    // arrives alongside a much larger addition — the shape a brownfield
    // bootstrap always has. Diffing the export BY ID is what makes it visible,
    // and the export is already in hand for the backup, so this costs no extra
    // round-trip. Runs before the backup write for the same reason the history
    // guard does: a refused run should leave nothing behind in `.backups/`.
    const removedNodes = removedIds(exported.nodes, Array.isArray(local.nodes) ? local.nodes : []);
    const removedEdges = removedIds(exported.edges, Array.isArray(local.edges) ? local.edges : []);
    if ((removedNodes.length > 0 || removedEdges.length > 0) && !allowDeletions) {
      return fatalResult(dryRun, describeDeletions(removedNodes, removedEdges, bundlePath), qualityFields);
    }
  }

  // Anchored to the LINK FILE's directory, not `bundlePath`'s — the backup
  // is a pre-image of the HOSTED project (identified by the link file), not
  // of wherever the local input file happens to live. See the module doc
  // comment.
  const backupDir = join(cwd, "docs", "arkaik", ".backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `${stamp}-bundle.json`);
  const backupContent = `${JSON.stringify(exported, null, 2)}\n`;
  try {
    mkdirSync(backupDir, { recursive: true });
    writeBackupFile(backupPath, backupContent);
    // Verify: a write call returning successfully only means the OS
    // accepted it, not that the bytes are actually readable back — this is
    // "the only recovery path that exists" (module doc comment), so prove
    // it before trusting it, rather than assuming a successful
    // `writeFileSync` always leaves usable JSON on disk.
    JSON.parse(readFileSync(backupPath, "utf8"));
  } catch (e) {
    return fatalResult(
      dryRun,
      `Could not write the pre-restore backup to ${backupPath}: ${(e as Error).message}\n` +
        `Refusing to restore — this verb replaces the hosted project's snapshot AND journal, and the backup is the only way back.`,
      qualityFields,
    );
  }

  // ── The one destructive request this command ever sends ────────────────
  let res: Response;
  try {
    res = await httpClient(`${baseUrl}/api/graph/projects/${encodedProjectId}/bundle`, {
      method: "PUT",
      headers: putHeaders,
      body: putBody,
    });
  } catch (e) {
    return {
      ok: true,
      dryRun,
      mode,
      kept,
      bundlePath,
      backupPath,
      requestSent: false,
      errorMessage: `Network error: ${(e as Error).message}. Nothing was sent.${backupNoteFor(backupPath)}`,
    };
  }

  return interpretPutResponse(res, { ...resultCtx, backupPath });
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

  // A deletion is the one number in these rows that contradicts the method's
  // own first principle, and it is the easiest to miss: it renders as a `-1`
  // in a line whose every other figure is large and rising. Call it out in
  // words. This is also the ONLY place a dry run can surface it — that branch
  // never fetches the export, so it has no ids of its own to diff, only the
  // server's counts.
  const count = (k: string): number => (typeof delta[k] === "number" ? (delta[k] as number) : 0);
  const nodesRemoved = count("nodesRemoved");
  const edgesRemoved = count("edgesRemoved");
  if (nodesRemoved > 0 || edgesRemoved > 0) {
    const parts: string[] = [];
    if (nodesRemoved > 0) parts.push(`${nodesRemoved} node${nodesRemoved === 1 ? "" : "s"}`);
    if (edgesRemoved > 0) parts.push(`${edgesRemoved} edge${edgesRemoved === 1 ? "" : "s"}`);
    console.log(
      `  WARNING: this DELETES ${parts.join(" and ")} from the hosted project. ` +
        `Bootstrap never deletes — check the hosted project has not moved ahead of your local bundle.`,
    );
  }
}

/**
 * Print the result and set the process exit code. Exported (not just used by
 * `runRestoreCli`) so tests can drive it directly with a mock console — safe
 * to call in-process on a SUCCESS result specifically, since that path uses
 * `process.exitCode` rather than `process.exit()` (see the success branch
 * below); the failure branches still call `process.exit(1)`, unchanged, and
 * would terminate a test process the same way they always have.
 */
export function reportRestore(result: RunRestoreResult): void {
  if (!result.ok) fail(`FATAL: ${result.fatal}`);

  if (result.backupPath) {
    console.log(`Backed up the current hosted project (snapshot + journal) to ${result.backupPath}`);
  }

  // Unconditionally, because the server's delta reports nodes, edges and
  // events and says nothing about quality: a restore that just replaced a
  // hosted section holding N findings would otherwise be silent in both
  // directions. On stdout, not stderr as `runPackCli` uses — `pack` keeps
  // stdout pure bundle JSON, while this command's stdout is already the
  // human report the notice belongs in, beside the backup path and the delta.
  if (result.qualityNotice !== undefined) {
    console.log(result.qualityNotice);
  }
  if (result.kept !== undefined) {
    console.log(describeAppendSummary(result.kept));
  }

  if (!result.requestSent) {
    console.error(result.errorMessage ?? "Restore failed before a request could be sent.");
    process.exit(1);
  }

  if (result.status === 200) {
    if (result.dryRun) {
      console.log("[dry-run] server preview — nothing was written:");
      printDelta(result.delta);
      console.log(
        result.mode === "replace"
          ? "Re-run without --dry-run to apply — that run takes the backup, and only that run checks the " +
              "history, deletion, quality-loss and metadata-loss guards (all four read the export, which a dry run never fetches)."
          : "Re-run without --dry-run to apply — that run takes the backup first.",
      );
    } else {
      console.log(`Restored. New version ${result.version}.`);
      printDelta(result.delta);
      if (result.backupPath) {
        console.log(`  Undo this restore with: ${undoCommandFor(result.backupPath)}`);
      }
    }
    // process.exitCode (not process.exit(0)): the lines just printed are the
    // only recovery instruction that exists for this run, and process.exit()
    // can truncate buffered stdout before it flushes — letting the event
    // loop drain naturally and exiting via the code instead removes that
    // risk for the one line that must never be lost.
    process.exitCode = 0;
    return;
  }

  console.error(result.errorMessage ?? `Restore failed (${result.status}).`);
  for (const finding of result.serverFindings ?? []) {
    console.error(`  ${finding.message ?? JSON.stringify(finding)}`);
  }
  process.exit(1);
}

export function runRestoreCli(argv: string[]): void {
  let dryRun = false;
  let replace = false;
  let allowHistoryLoss = false;
  let allowDeletions = false;
  let noQuality = false;
  let noWeighing = false;
  let allowQualityLoss = false;
  let allowMetadataLoss = false;
  let audit: string | undefined;
  let root: string | undefined;
  let apiBase: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exitCode = 0;
      return;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--replace") {
      replace = true;
    } else if (arg === "--allow-history-loss") {
      allowHistoryLoss = true;
    } else if (arg === "--allow-deletions") {
      allowDeletions = true;
    } else if (arg === "--no-quality") {
      noQuality = true;
    } else if (arg === "--no-weighing") {
      noWeighing = true;
    } else if (arg === "--allow-quality-loss") {
      allowQualityLoss = true;
    } else if (arg === "--allow-metadata-loss") {
      allowMetadataLoss = true;
    } else if (arg === "--audit") {
      const value = argv[++i];
      if (value === undefined) fail(`Missing value for --audit\n\n${USAGE}`);
      audit = value;
    } else if (arg === "--root") {
      const value = argv[++i];
      if (value === undefined) fail(`Missing value for --root\n\n${USAGE}`);
      root = value;
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

  // Carried over from `arkaik pack`: one names an audit to fold, the other
  // removes the section. Not extended to --root, which says WHERE to look and
  // is inert rather than contradictory when nothing is looked up.
  if (noQuality && audit !== undefined) {
    fail(`--audit and --no-quality contradict each other: one names an audit to fold, the other removes the section\n\n${USAGE}`);
  }

  // Refused here as well as in runRestore, so the argv mistake is named with the usage beside it.
  const allowFlags = allowFlagsOf({ allowHistoryLoss, allowDeletions, allowQualityLoss, allowMetadataLoss });
  if (allowFlags.length > 0 && !replace) fail(`${describeAllowWithoutReplace(allowFlags)}\n\n${USAGE}`);

  runRestore({
    path: positionals[0],
    dryRun,
    replace,
    allowHistoryLoss,
    allowDeletions,
    noQuality,
    noWeighing,
    allowQualityLoss,
    allowMetadataLoss,
    audit,
    root,
    apiBase,
  })
    .then((result) => reportRestore(result))
    .catch((e: unknown) => fail(`FATAL: ${(e as Error).message}`));
}
