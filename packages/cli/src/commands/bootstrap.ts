/**
 * `arkaik bootstrap <subcommand>` — the deterministic half of the bootstrap
 * method (docs/superpowers/specs/2026-08-04-bootstrap-method-design.md).
 *
 * Determinism lives here; judgment lives in the `arkaik-bootstrap` skill. The
 * two meet at a file boundary: agents read a slice, agents write a fragment,
 * and this command group owns everything else — ID uniqueness, edge
 * resolution, journal construction, validation gating.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { buildCorpus } from "../lib/bootstrap/corpus";
import { BOOTSTRAP_ROOT, CORPUS_DIR, ensureGitignored } from "../lib/bootstrap/paths";

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
    default:
      console.error(`Unknown bootstrap subcommand: ${sub}\n\n${USAGE}`);
      process.exit(1);
  }
}
