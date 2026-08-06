/**
 * `arkaik deliverable <title> [--id <id>] [--summary <s>] [--url <u>]
 *  [--nodes id,id] [--platform <p>] [path]`.
 *
 * Appends one validated `deliverable.shipped` event to the journal.jsonl
 * sidecar (docs/spec/journal.md § Releases) — a unit of shipped work, typically
 * one merged PR. `--id` is the stable deliverable identity (`pr-123` by
 * convention); re-running with the same id EDITS: consumers resolve content
 * latest-wins, anchored at the first occurrence. Without `--id` a fresh ULID
 * is used, so the deliverable cannot be edited by re-append — fine for one-off
 * notes, wrong for PR automation.
 *
 * `--nodes` ids are checked against the snapshot before writing, so a typo
 * fails loudly here instead of surfacing later as a validator error.
 */
import { makeEvent, ulid, type JournalEvent } from "@arkaik/schema";
import { readBundle, nodesByIdOf } from "../lib/bundle-io";
import { appendJournalEvent, ensureJournalBaseline, journalPathFor } from "../lib/journal-io";
import { renderEventLine } from "../lib/render-event";

const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";
const ACTOR = "arkaik-cli";

const USAGE = `arkaik deliverable <title> [options] [path]

Record a deliverable: append a validated deliverable.shipped event to the
journal.jsonl sidecar. The bundle file is not modified.

Arguments:
  title             What shipped, in one line. Required.
  path              Path to the bundle JSON file (default: ${DEFAULT_BUNDLE_PATH}).

Options:
  --id <id>         Stable deliverable id (convention: pr-123). Re-appending
                    with the same id edits the deliverable (latest-wins
                    content, anchored at the first occurrence). Default: a
                    fresh ULID.
  --summary <s>     A short human note.
  --url <u>         The PR (or other reference) URL.
  --nodes <id,id>   Comma-separated ids of graph nodes this touched. Checked
                    against the snapshot.
  --platform <p>    Scope to a platform's release rhythm.
  -h, --help        Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function runDeliverable(args: string[]): void {
  let id: string | undefined;
  let summary: string | undefined;
  let url: string | undefined;
  let nodes: string[] | undefined;
  let platform: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--id") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --id\n\n${USAGE}`);
      id = value;
    } else if (arg === "--summary") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --summary\n\n${USAGE}`);
      summary = value;
    } else if (arg === "--url") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --url\n\n${USAGE}`);
      url = value;
    } else if (arg === "--nodes") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --nodes\n\n${USAGE}`);
      nodes = value.split(",").map((n) => n.trim()).filter((n) => n !== "");
      // An all-empty/blank --nodes value (e.g. "") means "no nodes", not [].
      if (nodes.length === 0) nodes = undefined;
    } else if (arg === "--platform") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --platform\n\n${USAGE}`);
      platform = value;
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      positionals.push(arg);
    }
  }

  const title = positionals[0];
  if (title === undefined) fail(`Missing title.\n\n${USAGE}`);
  const filePath = positionals[1] ?? DEFAULT_BUNDLE_PATH;

  let bundle: Record<string, unknown>;
  try {
    bundle = readBundle(filePath);
  } catch (e) {
    fail(`FATAL: ${(e as Error).message}`);
  }

  // A typo'd node id fails HERE, before anything is written.
  if (nodes !== undefined) {
    const nodesById = nodesByIdOf(bundle);
    const unknown = nodes.filter((n) => !nodesById.has(n));
    if (unknown.length > 0) {
      fail(`FATAL: --nodes references unknown node id(s): ${unknown.join(", ")}`);
    }
  }

  const deliverableId = id ?? ulid();

  let event: JournalEvent;
  try {
    event = makeEvent(
      "deliverable.shipped",
      {
        deliverable_id: deliverableId,
        title,
        ...(summary !== undefined ? { summary } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(nodes !== undefined ? { node_ids: nodes } : {}),
        ...(platform !== undefined ? { platform } : {}),
      },
      { actor: ACTOR },
    );
  } catch (e) {
    fail(`FATAL: could not build deliverable event — ${(e as Error).message}`);
  }

  const journalPath = journalPathFor(filePath);
  // This append is what makes a journal-less bundle's journal non-empty, and
  // therefore cross-checked — so adopt the pre-existing nodes first (#357).
  const baseline = ensureJournalBaseline(journalPath, bundle, ACTOR);
  appendJournalEvent(journalPath, event);
  if (baseline !== undefined) {
    console.log(`\n  ${renderEventLine(baseline)} -> ${journalPath}`);
  }
  console.log(
    `\n  Recorded deliverable ${deliverableId} — ${title} -> ${journalPath}\n`,
  );
  process.exit(0);
}
