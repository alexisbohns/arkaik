/**
 * `arkaik bootstrap <subcommand>` — the deterministic half of the bootstrap
 * method (docs/superpowers/specs/2026-08-04-bootstrap-method-design.md).
 *
 * Determinism lives here; judgment lives in the `arkaik-bootstrap` skill. The
 * two meet at a file boundary: agents read a slice, agents write a fragment,
 * and this command group owns everything else — ID uniqueness, edge
 * resolution, journal construction, validation gating.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { serializeBundle, validateBundle } from "@arkaik/schema";

import { buildCorpus } from "../lib/bootstrap/corpus";
import { loadFragments } from "../lib/bootstrap/fragments";
import { renderIndex } from "../lib/bootstrap/index-view";
import type { Manifest } from "../lib/bootstrap/manifest";
import { detectMode, planUnits, readManifest, readProfile, renderIssues, writeManifest } from "../lib/bootstrap/manifest";
import { mergeFragments } from "../lib/bootstrap/merge";
import { BOOTSTRAP_ROOT, CORPUS_DIR, ensureGitignored } from "../lib/bootstrap/paths";
import { resolveSlice } from "../lib/bootstrap/slice";
import { readBundle } from "../lib/bundle-io";
import { journalPathFor, loadJournalEvents } from "../lib/journal-io";
import { formatFinding } from "./validate";

const USAGE = `arkaik bootstrap <subcommand> [options]

Subcommands:
  corpus [options]        Mine merged PRs, docs and surfaces into .arkaik/corpus/.
  plan [options]          Emit the work-unit manifest (--issues files GitHub issues).
  slice <unit>            Print exactly the corpus subset one work unit needs.
  index [path]            Print a compact id/title/species listing of the map.
  merge [options]         Assemble fragments onto the bundle, then validate.

Options:
  -h, --help              Show this help.

Run "arkaik bootstrap <subcommand> --help" for subcommand help.`;

const CORPUS_USAGE = `arkaik bootstrap corpus [options]

Mine merged PRs, design docs and code surfaces into .arkaik/corpus/.

Options:
  --from-json <file>  Replay a captured \`gh pr list --json\` payload instead of calling gh.
  --from-git          Mine merge commits with git instead of gh (loses Lab Notes).
  --limit <n>         Max PRs to fetch from gh (default: 1000).
  --since <iso-date>  Keep only PRs merged at or after this date.
  -h, --help          Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** `argv[i]`, failing loudly instead of silently falling through as `undefined`. */
function nextValue(argv: string[], i: number, flag: string, usage: string): string {
  const value = argv[i];
  if (value === undefined) fail(`Missing value for ${flag}\n\n${usage}`);
  return value;
}

/**
 * Write `content` to `filePath` via a same-directory temp file plus a rename,
 * so a process killed mid-write can never leave a truncated file at
 * `filePath` — `renameSync` within one directory is a single filesystem
 * operation on every platform this CLI targets. The temp name includes the
 * pid so two merges racing on the same bundle (a misuse this file otherwise
 * does nothing to prevent) don't clobber each other's in-flight temp file.
 */
function writeFileAtomic(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, filePath);
}

function runCorpus(argv: string[]): void {
  const cwd = process.cwd();
  let fromJson: string | undefined;
  let fromGit = false;
  let limit = 1000;
  let since: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(CORPUS_USAGE);
      process.exit(0);
    } else if (arg === "--from-json") {
      fromJson = nextValue(argv, ++i, "--from-json", CORPUS_USAGE);
    } else if (arg === "--from-git") {
      fromGit = true;
    } else if (arg === "--limit") {
      const raw = nextValue(argv, ++i, "--limit", CORPUS_USAGE);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        fail(`--limit must be a positive integer, got: ${raw}\n\n${CORPUS_USAGE}`);
      }
      limit = parsed;
    } else if (arg === "--since") {
      since = nextValue(argv, ++i, "--since", CORPUS_USAGE);
    } else {
      fail(`Unknown option: ${arg}\n\n${CORPUS_USAGE}`);
    }
  }

  // Task 1's ensureGitignored expects cwd to be the repo root; from a
  // subdirectory --from-git still walks full history while listFiles only
  // sees the subtree, so a silently inconsistent corpus is worse than
  // refusing to run.
  if (!existsSync(path.join(cwd, ".git"))) {
    fail("`arkaik bootstrap corpus` must run from the repository root (no .git here).");
  }

  try {
    const result = buildCorpus({ cwd, fromJson, fromGit, limit, since });
    const ignored = ensureGitignored(cwd);
    console.log(`Corpus written to ${CORPUS_DIR}/`);
    console.log(`  ${result.prs} merged PRs, ${result.docs} docs, ${result.surfaces} surfaces`);
    if (result.sinceDroppedUndated > 0) {
      console.log(`  --since also dropped ${result.sinceDroppedUndated} PR(s) with a missing/unparseable merge date`);
    }
    if (ignored) console.log(`  added ${BOOTSTRAP_ROOT}/ to .gitignore`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const PLAN_USAGE = `arkaik bootstrap plan [options]

Emit the work-unit manifest at .arkaik/bootstrap/manifest.json. With no recon
profile only the wave-0 recon unit is planned; re-run after recon writes
profile.json to expand waves 1-3. Existing unit statuses are preserved for
units whose scope/slice is unchanged since the last plan.

Options:
  --bundle <path>  Bundle to bootstrap (default: docs/arkaik/bundle.json).
  --issues         File one GitHub issue per pending unit instead of driving
                   in-session. Same manifest, alternate driver: durable and
                   parallel across machines, at the cost of a cold-start
                   context tax per unit. A unit that already has a filed
                   issue (tracked locally in manifest.json, not checked
                   against GitHub) is skipped, not re-filed.
  --print          With --issues, print the rendered issues as JSON instead
                   of filing them — never calls \`gh\`. Requires --issues.
  -h, --help       Show this help.`;

function runPlan(argv: string[]): void {
  const cwd = process.cwd();
  // A literal, not path.join: this value is written into manifest.json by
  // writeManifest, so it must not become `docs\arkaik\bundle.json` on Windows.
  // Every other command in this CLI spells it the same way (init.ts:36,
  // pack.ts:38, push.ts:54, sync.ts:59, open.ts:35, release.ts:30).
  let bundle = "docs/arkaik/bundle.json";
  let issues = false;
  let print = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(PLAN_USAGE);
      process.exit(0);
    } else if (arg === "--bundle") {
      bundle = nextValue(argv, ++i, "--bundle", PLAN_USAGE);
    } else if (arg === "--issues") {
      issues = true;
    } else if (arg === "--print") {
      print = true;
    } else {
      fail(`Unknown option: ${arg}\n\n${PLAN_USAGE}`);
    }
  }

  // `--print` only means something as a rendering choice for `--issues` — on
  // its own it would silently do nothing (the normal summary is printed
  // either way), which is worse than telling the caller their flags don't
  // combine the way they probably expect.
  if (print && !issues) {
    fail(`--print requires --issues\n\n${PLAN_USAGE}`);
  }

  // Same guard as `corpus`: manifest.json/profile.json/fragments all live
  // under .arkaik/, which is only meaningful relative to the repo root — run
  // from a subdirectory and `plan` would scatter .arkaik/bootstrap/
  // somewhere `corpus` (and a human) would never look for it.
  if (!existsSync(path.join(cwd, ".git"))) {
    fail("`arkaik bootstrap plan` must run from the repository root (no .git here).");
  }

  try {
    const mode = detectMode(cwd, bundle);
    const manifest = planUnits({ mode, bundle, profile: readProfile(cwd), previous: readManifest(cwd) });
    writeManifest(cwd, manifest);
    // paths.ts's own contract: .arkaik/ never lands in git. `corpus` usually
    // runs first and already does this, but `plan` can run first too (or
    // stand alone against an existing profile.json), so it can't assume
    // corpus already ignored the directory.
    const ignored = ensureGitignored(cwd);
    if (ignored) console.log(`  added ${BOOTSTRAP_ROOT}/ to .gitignore`);

    if (issues) {
      runPlanIssues(cwd, manifest, print);
      return;
    }

    const pending = manifest.units.filter((u) => u.status === "pending").length;
    console.log(`Planned ${manifest.units.length} units (${pending} pending) in ${mode} mode.`);
    for (const u of manifest.units) console.log(`  [${u.status}] w${u.wave} ${u.id} — ${u.title}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * The `--issues` alternate output mode: same manifest, filed as one GitHub
 * issue per pending unit instead of summarized for in-session fan-out.
 *
 * `renderIssues` (manifest.ts) already excludes units carrying an
 * `issueUrl` — this function is what makes that guard actually stick: each
 * successful `gh issue create` is written back to manifest.json (via
 * `writeManifest`) BEFORE moving to the next unit, not batched until the end.
 * `gh` shells out per unit and can fail partway through (rate limit, auth,
 * network); persisting incrementally means a re-run after such a failure
 * resumes at the first not-yet-filed unit instead of re-filing everything
 * already filed. This is local bookkeeping only, not reconciliation against
 * GitHub's real issue state (open/closed/deleted) — out of scope here.
 */
function runPlanIssues(cwd: string, manifest: Manifest, print: boolean): void {
  const rendered = renderIssues(manifest);

  if (print) {
    // The testability seam: returns before anything below touches `gh`.
    console.log(JSON.stringify(rendered, null, 2));
    return;
  }

  if (rendered.length === 0) {
    console.log("Every pending unit already has a filed issue — nothing to do.");
    return;
  }

  let filedThisRun = 0;
  for (const issue of rendered) {
    const res = spawnSync("gh", ["issue", "create", "--title", issue.title, "--body", issue.body], {
      cwd,
      encoding: "utf8",
    });
    // Matches corpus.ts's fetchPrsViaGh: `res.error` (gh isn't installed or
    // isn't runnable at all) is a DIFFERENT failure from a non-zero exit
    // (gh ran and refused) — `res.stderr` is `undefined`, not `""`, in the
    // former case, so checking `res.status` alone and blindly calling
    // `.trim()` on stderr would crash with its own TypeError instead of
    // reporting the real problem.
    if (res.error) {
      console.error(`gh not runnable: ${res.error.message}`);
      process.exit(1);
    }
    if (res.status !== 0) {
      console.error(`gh issue create failed for ${issue.unit}: ${(res.stderr ?? "").trim()}`);
      console.error(
        `${filedThisRun} of ${rendered.length} issue(s) filed before this failure — re-run ` +
          "`arkaik bootstrap plan --issues` after fixing the problem above; already-filed units are not re-filed.",
      );
      process.exit(1);
    }

    const url = res.stdout.trim();
    const target = manifest.units.find((u) => u.id === issue.unit);
    if (target) target.issueUrl = url;
    filedThisRun += 1;
    // Written after EVERY unit, not once at the end: if `gh` fails on the
    // next unit, this write is what a re-run relies on to know what's
    // already filed.
    writeManifest(cwd, manifest);
    console.log(`Filed ${issue.unit}: ${url}`);
  }
}

const SLICE_USAGE = `arkaik bootstrap slice <unit>

Print exactly the corpus subset one work unit needs, as compact JSON (id,
scope, matching PRs, matching surfaces, and — only when the unit asks for it
— the docs manifest). Reads .arkaik/bootstrap/manifest.json; run
\`arkaik bootstrap plan\` first.`;

function runSlice(argv: string[]): void {
  const cwd = process.cwd();
  const unitId = argv[0];
  if (unitId === "-h" || unitId === "--help") {
    console.log(SLICE_USAGE);
    process.exit(0);
  }
  // A missing required argument is a usage error, not a help request — it
  // belongs on stderr via fail() like every other error path in this file,
  // not printed to stdout the way -h/--help's actual usage dump is.
  if (unitId === undefined) fail(`Missing required argument: <unit>\n\n${SLICE_USAGE}`);

  const manifest = readManifest(cwd);
  if (!manifest) fail("No manifest. Run `arkaik bootstrap plan` first.");
  const unit = manifest.units.find((u) => u.id === unitId);
  if (!unit) fail(`Unknown unit: ${unitId}\nKnown units: ${manifest.units.map((u) => u.id).join(", ")}`);

  try {
    // Compact, not pretty-printed: this command exists to bound what one
    // agent reads (~30-60KB instead of the whole corpus), and 2-space
    // indentation on an array of PR/surface objects meaningfully inflates
    // that for no one — the consumer is an agent parsing JSON, not a human
    // skimming a terminal.
    console.log(JSON.stringify(resolveSlice(cwd, unit)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const INDEX_USAGE = `arkaik bootstrap index [path]

Print a compact id/species/title/product listing of the map, one
tab-separated line per node (default: docs/arkaik/bundle.json).`;

function runIndex(argv: string[]): void {
  if (argv[0] === "-h" || argv[0] === "--help") {
    console.log(INDEX_USAGE);
    process.exit(0);
  }
  // `index` takes one positional path, no flags — but nothing previously
  // stopped an unrecognized option (e.g. a `--bundle` typo modeled on
  // `plan`'s flag) from being silently treated AS that path, producing a
  // confusing "File not found: <cwd>/--bundle" instead of a clear error.
  // Every other subcommand in this file rejects an unknown option via
  // fail(); match that instead of accepting anything that isn't -h/--help.
  if (argv[0] !== undefined && argv[0].startsWith("-")) {
    fail(`Unknown option: ${argv[0]}\n\n${INDEX_USAGE}`);
  }
  // A literal default, joined the same way runPlan's --bundle default is —
  // it is immediately resolved against cwd below, never serialized, so
  // path.join's platform separator is harmless here.
  const target = argv[0] ?? path.join("docs", "arkaik", "bundle.json");
  try {
    // path.resolve, not path.join: an absolute `target` (a positional arg,
    // just like manifest.ts's --bundle) must resolve to itself, not get
    // mangled into <cwd>/<abs path> — the same fix Task 3 made for
    // detectMode's bundle path, kept in agreement here.
    process.stdout.write(renderIndex(readBundle(path.resolve(process.cwd(), target)) as { nodes?: unknown }));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const MERGE_USAGE = `arkaik bootstrap merge [options]

Assemble every fragment named by the manifest onto the bundle: verify ID
uniqueness, resolve edge endpoints, apply reconcile ops, synthesize the
required node.created / node.status_changed / decision.status_changed
events, validate the result (errors block the write; warnings are reported
but never block it), and write the bundle plus its journal.jsonl sidecar.

Options:
  --dry-run    Report what would change (including validation); write nothing.
  -h, --help   Show this help.`;

/**
 * `bundlePath` is resolved with `path.resolve`, matching `detectMode`
 * (manifest.ts) — `manifest.bundle` may already be absolute (from `plan
 * --bundle <abs path>`), and `path.join` would mangle that into
 * `<cwd>/<abs path>`. The two commands must agree on what `--bundle` means;
 * see manifest.ts's `detectMode` doc for the story on why this matters.
 */
function runMerge(argv: string[]): void {
  const cwd = process.cwd();
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(MERGE_USAGE);
      process.exit(0);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      fail(`Unknown option: ${arg}\n\n${MERGE_USAGE}`);
    }
  }

  const manifest = readManifest(cwd);
  if (!manifest) {
    fail("No manifest. Run `arkaik bootstrap plan` first.");
  }

  try {
    const bundlePath = path.resolve(cwd, manifest.bundle);
    const base = existsSync(bundlePath)
      ? (readBundle(bundlePath) as Record<string, unknown>)
      : {
          schema_version: 3,
          project: {
            id: path.basename(cwd),
            title: path.basename(cwd),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          nodes: [],
          edges: [],
        };

    // `loadJournalEvents`, not a direct sidecar-only read: the base bundle
    // may carry an EMBEDDED `journal[]` (the interchange projection,
    // docs/spec/journal.md — e.g. a bundle produced by `arkaik pack`, or a
    // hosted export, dropped in as the bootstrap target). Reading only the
    // sidecar would silently discard that entire embedded history the
    // moment this merge writes its own sidecar-only output.
    const baseJournal = loadJournalEvents(base, bundlePath) as unknown as Array<Record<string, unknown>>;

    const { loaded, problems, missing } = loadFragments(cwd, manifest);
    for (const problem of problems) console.error(`fragment ${problem.unit}: ${problem.message}`);
    if (problems.length > 0) process.exit(1);

    const fallbackTs = String((base.project as Record<string, unknown> | undefined)?.created_at ?? new Date().toISOString());
    const result = mergeFragments({ base, baseJournal, fragments: loaded, fallbackTs });

    for (const error of result.errors) console.error(`merge ${error.unit}: ${error.message}`);
    if (result.errors.length > 0) process.exit(1);

    const project = result.bundle.project as Record<string, unknown>;
    const lastTs = result.journal.length > 0 ? String(result.journal[result.journal.length - 1].ts) : undefined;
    result.bundle.project = { ...project, updated_at: lastTs ?? project.updated_at };

    // This command's own usage text says "then validate" — until this point
    // that was aspirational: merge wrote unconditionally and left
    // `arkaik validate` as a suggestion for afterward. Warnings never fail a
    // run (a partial, in-progress bootstrap — wave 1 of 3 — legitimately has
    // warnings; warning-CLEAN is the operator's own gate at the end, not
    // merge's gate on every invocation), but an ERROR must block the write: a
    // merged bundle that fails its own journal cross-check is exactly the
    // defect class this file exists to catch before it reaches disk, not
    // after. `validateBundle` already runs `crossCheckJournal` internally
    // when a `journal` is present, so folding the merged journal onto a
    // throwaway copy of the bundle here is enough — no separate
    // `crossCheckJournal` call needed, and `result.bundle` itself (what
    // actually gets serialized) stays journal-free either way.
    const validation = validateBundle({ ...result.bundle, journal: result.journal });
    if (validation.warnings.length > 0) {
      console.log(`  ${validation.warnings.length} validation warning(s):`);
      for (const warning of validation.warnings) console.log(`    ${formatFinding(warning)}`);
    }
    if (validation.errors.length > 0) {
      for (const error of validation.errors) console.error(formatFinding(error));
      console.error("Merged bundle fails validation — nothing was written. Fix the fragment(s) above and re-run.");
      process.exit(1);
    }

    const serialized = serializeBundle(result.bundle as never);
    const journalPath = journalPathFor(bundlePath);
    const journalText = result.journal.map((e) => JSON.stringify(e)).join("\n") + (result.journal.length ? "\n" : "");

    if (!dryRun) {
      // A genuinely fresh repo (the design spec's greenfield case: "no
      // bundle" — not just an `arkaik init` stub) has no `docs/arkaik/`
      // directory at all yet; without this, the first-ever merge crashed
      // with a raw ENOENT instead of creating its own target.
      mkdirSync(path.dirname(bundlePath), { recursive: true });
      // Write-then-rename, not a direct writeFileSync, for both files: a
      // process killed mid-write left a truncated bundle or journal on disk.
      // This doesn't make the PAIR atomic (a kill between the two renames
      // still leaves them out of sync — a known, accepted gap; see this
      // task's notes in docs/superpowers/plans/2026-08-04-bootstrap-method.md,
      // Task 9), but it does mean neither file is ever half-written.
      writeFileAtomic(bundlePath, serialized);
      writeFileAtomic(journalPath, journalText);
    }

    console.log(`${dryRun ? "[dry-run] " : ""}Merged ${loaded.length} fragments:`);
    console.log(
      `  +${result.counts.nodesAdded} nodes, ~${result.counts.nodesUpdated} updated, ` +
        `${result.counts.nodesRetired} retired, +${result.counts.edgesAdded} edges, +${result.counts.eventsAdded} events`,
    );
    console.log(`  bundle ${(Buffer.byteLength(serialized) / 1024).toFixed(0)}KB, journal ${result.journal.length} events`);
    if (missing.length > 0) console.log(`  ${missing.length} units have no fragment yet: ${missing.join(", ")}`);
    const wroteOrWould = dryRun ? "would be written" : "written";
    console.log(
      validation.warnings.length > 0
        ? `Validated (0 errors, ${validation.warnings.length} warnings above) — ${wroteOrWould}.`
        : `Validated clean — ${wroteOrWould}.`,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export function runBootstrap(argv: string[]): void {
  const [sub, ...rest] = argv;

  if (sub === undefined || sub === "-h" || sub === "--help" || sub === "help") {
    console.log(USAGE);
    process.exit(0);
  }

  switch (sub) {
    case "corpus":
      runCorpus(rest);
      return;
    case "plan":
      runPlan(rest);
      return;
    case "slice":
      runSlice(rest);
      return;
    case "index":
      runIndex(rest);
      return;
    case "merge":
      runMerge(rest);
      return;
    default:
      console.error(`Unknown bootstrap subcommand: ${sub}\n\n${USAGE}`);
      process.exit(1);
  }
}
