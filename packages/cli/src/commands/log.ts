/**
 * `arkaik log [--node <id>] [path]`.
 *
 * Reads a bundle + its journal (embedded `journal[]`, else the sibling
 * `journal.jsonl` sidecar — same discovery as `validate`) and prints history
 * from the shared projections in @arkaik/schema (docs/spec/journal.md
 * § Projections):
 *  - no `--node`: the project changelog — every event in journal order, with
 *    `release.tagged` markers called out as version boundaries;
 *  - `--node <id>`: that node's timeline (`computeNodeTimeline`).
 *
 * Read-only, never writes. An empty or absent journal prints an empty-state
 * line and exits 0 — never an error (the whole no-history backward-compat story).
 */
import { orderEvents, computeNodeTimeline, type JournalEvent } from "@arkaik/schema";
import { readBundle, nodesByIdOf } from "../lib/bundle-io";
import { loadJournalEvents } from "../lib/journal-io";
import { renderEventLine, formatEventDate } from "../lib/render-event";

const USAGE = `arkaik log [--node <id>] [path]

Print the project's journal history: the changelog of all events in order, or a
single node's timeline. Reads the bundle's embedded journal, or its sibling
journal.jsonl sidecar when there is none. Read-only; exits 0 even with no journal.

Arguments:
  path            Path to the bundle JSON file (required).

Options:
  --node <id>     Print the timeline of events touching node <id> instead of the
                  whole-project changelog.
  -h, --help      Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** A `<date>  <text>` line for one event. */
function line(event: JournalEvent, nodesById: Map<string, { title: string }>): string {
  return `  ${formatEventDate(event.ts)}  ${renderEventLine(event, nodesById)}`;
}

/** `--node`: the node's timeline. */
function logNode(events: JournalEvent[], nodeId: string, nodesById: Map<string, { title: string }>): never {
  const timeline = computeNodeTimeline(events, nodeId);
  const label = nodesById.get(nodeId)?.title ?? nodeId;
  console.log(`\n  Timeline — ${label}\n`);
  if (timeline.length === 0) {
    console.log(`  No journal events for node ${nodeId}.\n`);
    process.exit(0);
  }
  timeline.forEach((ev) => console.log(line(ev, nodesById)));
  console.log("");
  process.exit(0);
}

/** No `--node`: the whole-project changelog, releases as markers. */
function logChangelog(events: JournalEvent[], nodesById: Map<string, { title: string }>): never {
  console.log(`\n  Changelog\n`);
  if (events.length === 0) {
    console.log("  No journal events yet.\n");
    process.exit(0);
  }
  for (const ev of orderEvents(events)) {
    if (ev.type === "release.tagged") {
      const version = typeof ev.version === "string" ? ev.version : "?";
      const platform = typeof ev.platform === "string" ? ` [${ev.platform}]` : "";
      console.log(`\n  == ${version}${platform} ==  (${formatEventDate(ev.ts)})\n`);
    } else {
      console.log(line(ev, nodesById));
    }
  }
  console.log("");
  process.exit(0);
}

export function runLog(args: string[]): void {
  let nodeId: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--node") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --node\n\n${USAGE}`);
      nodeId = value;
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      positionals.push(arg);
    }
  }

  const filePath = positionals[0];
  if (filePath === undefined) fail(`Missing bundle path.\n\n${USAGE}`);

  let bundle: Record<string, unknown>;
  try {
    bundle = readBundle(filePath);
  } catch (e) {
    fail(`FATAL: ${(e as Error).message}`);
  }

  const nodesById = nodesByIdOf(bundle);
  const events = loadJournalEvents(bundle, filePath);

  if (nodeId !== undefined) {
    logNode(events, nodeId, nodesById);
  } else {
    logChangelog(events, nodesById);
  }
}
