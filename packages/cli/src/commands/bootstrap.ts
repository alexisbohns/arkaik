/**
 * `arkaik bootstrap <subcommand>` — the deterministic half of the bootstrap
 * method (docs/superpowers/specs/2026-08-04-bootstrap-method-design.md).
 *
 * Determinism lives here; judgment lives in the `arkaik-bootstrap` skill. The
 * two meet at a file boundary: agents read a slice, agents write a fragment,
 * and this command group owns everything else — ID uniqueness, edge
 * resolution, journal construction, validation gating.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { serializeBundle } from "@arkaik/schema";

import { buildCorpus } from "../lib/bootstrap/corpus";
import { loadFragments } from "../lib/bootstrap/fragments";
import { renderIndex } from "../lib/bootstrap/index-view";
import { detectMode, planUnits, readManifest, readProfile, writeManifest } from "../lib/bootstrap/manifest";
import { mergeFragments } from "../lib/bootstrap/merge";
import { BOOTSTRAP_ROOT, CORPUS_DIR, ensureGitignored } from "../lib/bootstrap/paths";
import { resolveSlice } from "../lib/bootstrap/slice";
import { readBundle } from "../lib/bundle-io";
import { journalPathFor, loadJournalEvents } from "../lib/journal-io";

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
  -h, --help       Show this help.`;

function runPlan(argv: string[]): void {
  const cwd = process.cwd();
  // A literal, not path.join: this value is written into manifest.json by
  // writeManifest, so it must not become `docs\arkaik\bundle.json` on Windows.
  // Every other command in this CLI spells it the same way (init.ts:36,
  // pack.ts:38, push.ts:54, sync.ts:59, open.ts:35, release.ts:30).
  let bundle = "docs/arkaik/bundle.json";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(PLAN_USAGE);
      process.exit(0);
    } else if (arg === "--bundle") {
      bundle = nextValue(argv, ++i, "--bundle", PLAN_USAGE);
    } else {
      fail(`Unknown option: ${arg}\n\n${PLAN_USAGE}`);
    }
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

    const pending = manifest.units.filter((u) => u.status === "pending").length;
    console.log(`Planned ${manifest.units.length} units (${pending} pending) in ${mode} mode.`);
    for (const u of manifest.units) console.log(`  [${u.status}] w${u.wave} ${u.id} — ${u.title}`);
    if (ignored) console.log(`  added ${BOOTSTRAP_ROOT}/ to .gitignore`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
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
required node.created / node.status_changed events, and write the bundle
plus its journal.jsonl sidecar.

Options:
  --dry-run    Report what would change; write nothing.
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

    const serialized = serializeBundle(result.bundle as never);
    const journalPath = journalPathFor(bundlePath);
    const journalText = result.journal.map((e) => JSON.stringify(e)).join("\n") + (result.journal.length ? "\n" : "");

    if (!dryRun) {
      writeFileSync(bundlePath, serialized);
      writeFileSync(journalPath, journalText);
    }

    console.log(`${dryRun ? "[dry-run] " : ""}Merged ${loaded.length} fragments:`);
    console.log(
      `  +${result.counts.nodesAdded} nodes, ~${result.counts.nodesUpdated} updated, ` +
        `${result.counts.nodesRetired} retired, +${result.counts.edgesAdded} edges, +${result.counts.eventsAdded} events`,
    );
    console.log(`  bundle ${(Buffer.byteLength(serialized) / 1024).toFixed(0)}KB, journal ${result.journal.length} events`);
    if (missing.length > 0) console.log(`  ${missing.length} units have no fragment yet: ${missing.join(", ")}`);
    console.log(`Next: arkaik validate ${manifest.bundle}`);
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
