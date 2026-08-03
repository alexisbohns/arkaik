/**
 * `arkaik` CLI entry point.
 *
 * A tiny hand-rolled command dispatcher — deliberately dependency-free (no
 * commander/yargs). Each command owns its own flag parsing.
 *
 * All schema behaviour is reused verbatim from `@arkaik/schema`; the commands
 * never re-implement validation or serialization.
 */
import { runInit } from "./commands/init";
import { runValidate } from "./commands/validate";
import { runLog } from "./commands/log";
import { runRelease } from "./commands/release";
import { runDeliverable } from "./commands/deliverable";
import { runSyncCli } from "./commands/sync";
import { runPackCli } from "./commands/pack";
import { runOpenCli } from "./commands/open";
import { runPushCli } from "./commands/push";
import { runLinkCli } from "./commands/link";

const USAGE = `arkaik — CLI for Arkaik project bundles

Usage:
  arkaik <command> [options]

Commands:
  init [options]              Scaffold docs/arkaik/, install the agent skill (--update to upgrade).
  validate [path]             Validate a project bundle (folds in a journal.jsonl sidecar).
  log [--node <id>] [path]    Print the journal: project changelog, or one node's timeline.
  release <version> [path]    Tag a release (append release.tagged) and draft its notes.
  deliverable <title> [path]  Record a deliverable (append deliverable.shipped).
  sync [options] [path]       Mirror external ref status (GitHub issues/PRs) into node refs.
  pack [options] [path]       Produce a single self-contained interchange bundle (embeds the journal).
  open [options] [path]       Validate, then hand off the packed bundle to arkaik.app import.
  push [options] [path]       Validate, pack (journal stripped), and publish to Publik.
                               --delete <id> --key <owner_key> removes a snapshot.
  link [options] [path]       Point this repo at a hosted project so an agent can edit it.
                               --list shows the projects your token can reach.

Options:
  -h, --help        Show this help.
  -v, --version     Print the version.

Run "arkaik <command> --help" for command-specific help.`;

/**
 * Substituted from package.json by build.js. Never write this as a literal: the
 * sibling `arkaik-mcp` did, shipped 0.2.0 announcing itself as "0.1.0", and sent
 * anyone asking "does my install have hosted mode?" to the wrong answer. There
 * was no way to ask this of the CLI at all, which is the same problem wearing a
 * different hat — `npx` resolves a version you never chose, so "which build am I
 * running?" has to be answerable.
 */
declare const __ARKAIK_CLI_VERSION__: string;
const VERSION = __ARKAIK_CLI_VERSION__;

function main(argv: string[]): void {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    process.exit(0);
  }

  switch (command) {
    case "init":
      runInit(rest);
      return;
    case "validate":
      runValidate(rest);
      return;
    case "log":
      runLog(rest);
      return;
    case "release":
      runRelease(rest);
      return;
    case "deliverable":
      runDeliverable(rest);
      return;
    case "sync":
      runSyncCli(rest);
      return;
    case "pack":
      runPackCli(rest);
      return;
    case "open":
      runOpenCli(rest);
      return;
    case "push":
      runPushCli(rest);
      return;
    case "link":
      runLinkCli(rest);
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      process.exit(1);
  }
}

main(process.argv.slice(2));
