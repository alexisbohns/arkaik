/**
 * `arkaik` CLI entry point.
 *
 * A tiny hand-rolled command dispatcher — deliberately dependency-free (no
 * commander/yargs). Each command owns its own flag parsing so later commands
 * (init/log/release/sync/pack/open — separate issues) slot in by adding a
 * `case` here and a handler module under `./commands`.
 *
 * All schema behaviour is reused verbatim from `@arkaik/schema`; the commands
 * never re-implement validation or serialization.
 */
import { runValidate } from "./commands/validate";

const USAGE = `arkaik — CLI for Arkaik project bundles

Usage:
  arkaik <command> [options]

Commands:
  validate [path]   Validate a project bundle (folds in a journal.jsonl sidecar).

Options:
  -h, --help        Show this help.

Run "arkaik <command> --help" for command-specific help.`;

function main(argv: string[]): void {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case "validate":
      runValidate(rest);
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      process.exit(1);
  }
}

main(process.argv.slice(2));
