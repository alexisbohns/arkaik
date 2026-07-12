/**
 * `arkaik release <version> [--platform <p>] [--compact] [path]`.
 *
 * Tags a version and drafts its release notes (docs/spec/journal.md § Releases):
 *  1. append a validated `release.tagged` event (version, optional platform) to
 *     the `journal.jsonl` sidecar via `makeEvent` + the append helper — exactly
 *     one new line, envelope stamped (ULID id, ISO ts, actor);
 *  2. print a release-note DRAFT: the since-last-release slice
 *     (`computeChangelog` to the new marker), platform-filtered when `--platform`
 *     is set (the marker carries the platform, so the changelog scopes itself);
 *  3. with `--compact` (default OFF), move that slice out of the working journal
 *     into `journal/archive-<version>.jsonl` — history is kept, not deleted, and
 *     the working journal stays small (docs/spec/journal.md:93).
 *
 * Release only appends to the journal (a marker has no snapshot effect), so the
 * bundle file is never rewritten and `arkaik validate` — which cross-checks the
 * snapshot against the journal by value — stays green afterward.
 */
import {
  computeChangelog,
  makeEvent,
  orderEvents,
  type JournalEvent,
  type ReleaseTaggedEvent,
} from "@arkaik/schema";
import { readBundle, nodesByIdOf } from "../lib/bundle-io";
import { appendJournalEvent, compactSlice, journalPathFor, readJournalEvents } from "../lib/journal-io";
import { renderEventLine } from "../lib/render-event";

const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";
const ACTOR = "arkaik-cli";

const USAGE = `arkaik release <version> [--platform <p>] [--compact] [path]

Tag a release and draft its notes. Appends a validated release.tagged event to
the journal.jsonl sidecar and prints a release-note draft covering the events
since the previous release. The bundle file is not modified.

Arguments:
  version           The version being released (e.g. 1.2.0). Required.
  path              Path to the bundle JSON file (default: ${DEFAULT_BUNDLE_PATH}).

Options:
  --platform <p>    Scope this release to a platform; the draft (and the marker)
                    are filtered to that platform's events.
  --compact         Move the released slice out of journal.jsonl into
                    journal/archive-<version>.jsonl. Default OFF: compaction is
                    opt-in, and archives are kept (history is relocated, never
                    deleted).
  -h, --help        Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * The raw events strictly between the previous release marker and `version`'s
 * marker, in journal order — the slice compaction relocates. Unlike the
 * changelog draft, this is never platform-filtered: it is the literal set of
 * lines to move out of the working journal.
 */
function rawReleaseSlice(events: readonly JournalEvent[], version: string): JournalEvent[] {
  const ordered = orderEvents(events);
  const isRelease = (ev: JournalEvent): boolean => ev.type === "release.tagged";

  let toIndex = -1;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (isRelease(ordered[i]) && (ordered[i] as ReleaseTaggedEvent).version === version) {
      toIndex = i;
      break;
    }
  }
  if (toIndex === -1) return [];

  let fromIndex = -1;
  for (let i = toIndex - 1; i >= 0; i -= 1) {
    if (isRelease(ordered[i])) {
      fromIndex = i;
      break;
    }
  }
  return ordered.slice(fromIndex + 1, toIndex);
}

export function runRelease(args: string[]): void {
  let platform: string | undefined;
  let compact = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--compact") {
      compact = true;
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

  const version = positionals[0];
  if (version === undefined) fail(`Missing version.\n\n${USAGE}`);
  const filePath = positionals[1] ?? DEFAULT_BUNDLE_PATH;

  let bundle: Record<string, unknown>;
  try {
    bundle = readBundle(filePath);
  } catch (e) {
    fail(`FATAL: ${(e as Error).message}`);
  }
  const nodesById = nodesByIdOf(bundle);
  const journalPath = journalPathFor(filePath);
  const existing = readJournalEvents(journalPath);

  // Build + validate the marker (a bad --platform enum throws here).
  let event: JournalEvent;
  try {
    event = makeEvent(
      "release.tagged",
      { version, ...(platform !== undefined ? { platform } : {}) },
      { actor: ACTOR },
    );
  } catch (e) {
    fail(`FATAL: could not build release event — ${(e as Error).message}`);
  }

  appendJournalEvent(journalPath, event);
  console.log(`\n  Tagged release ${version}${platform ? ` [${platform}]` : ""} -> ${journalPath}`);

  // Draft the notes from the since-last-release slice (platform-scoped when the
  // marker is). computeChangelog resolves platform filtering from the marker.
  const all = [...existing, event];
  const changelog = computeChangelog(all, version, { nodesById });

  console.log(`\n  Release notes DRAFT — ${version}${changelog.platform ? ` (${changelog.platform})` : ""}`);
  console.log(
    changelog.fromVersion ? `  Changes since ${changelog.fromVersion}:\n` : `  Initial changes:\n`,
  );
  if (changelog.events.length === 0) {
    console.log("  (no changes in this release)");
  } else {
    changelog.events.forEach((ev) => console.log(`  - ${renderEventLine(ev, nodesById)}`));
  }
  console.log("");

  // Compaction: relocate the raw between-markers slice into the archive.
  if (compact) {
    const slice = rawReleaseSlice(all, version);
    if (slice.length === 0) {
      console.log("  --compact: nothing to archive (empty slice).\n");
    } else {
      compactSlice(journalPath, slice, version);
      console.log(
        `  --compact: moved ${slice.length} event(s) to journal/archive-${version}.jsonl (kept, not deleted).\n`,
      );
    }
  }

  process.exit(0);
}
