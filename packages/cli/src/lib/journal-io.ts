/**
 * Filesystem journal I/O for the `arkaik` CLI — the write primitives that touch
 * disk (docs/spec/journal.md § Storage Shapes). Kept out of @arkaik/schema on
 * purpose: the schema package stays browser-safe, so the `fs` half of the write
 * path lives here where `arkaik log` / `arkaik release` (and later `sync`) can
 * share it. Pure event construction (`makeEvent`, `ulid`) and reads
 * (`parseJournalLines`) are reused verbatim from the schema package.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  makeEvent,
  missingProvenanceNodeIds,
  parseJournalLines,
  type JournalEvent,
} from "@arkaik/schema";

/** The canonical JSONL sidecar name, sibling to the bundle (mirrors validate). */
export const JOURNAL_SIDECAR = "journal.jsonl";

/** The sidecar path for a bundle: `journal.jsonl` in the bundle's directory. */
export function journalPathFor(bundlePath: string): string {
  return join(dirname(bundlePath), JOURNAL_SIDECAR);
}

/** The compaction archive path for a version: `journal/archive-<version>.jsonl`. */
export function archivePathFor(journalPath: string, version: string): string {
  return join(dirname(journalPath), "journal", `archive-${version}.jsonl`);
}

/**
 * Every compaction archive beside `journalPath` — the `journal/archive-*.jsonl`
 * files {@link compactSlice} writes — sorted by name so callers (and their
 * reports) are deterministic. An absent `journal/` directory means no
 * compaction has happened → `[]`.
 */
export function archivePathsFor(journalPath: string): string[] {
  const dir = join(dirname(journalPath), "journal");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("archive-") && name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Parse the JSONL journal at `journalPath` into its events (file order). An
 * absent file is the no-history state → `[]`, never an error. Malformed lines
 * are dropped by {@link parseJournalLines}; callers that need line findings
 * should parse themselves.
 */
export function readJournalEvents(journalPath: string): JournalEvent[] {
  if (!existsSync(journalPath)) return [];
  return parseJournalLines(readFileSync(journalPath, "utf8")).events;
}

/**
 * The whole journal for a sidecar: the working `journal.jsonl` plus every
 * compaction archive beside it. Compaction *relocates* history, never deletes
 * it (docs/spec/journal.md § Releases, Compaction & Growth), so anything asking
 * "what does this journal record?" — validation, provenance — must read both
 * halves or a compacted project reads as a project with amnesia (#358). Events
 * come back sidecar-first then archive-by-archive; call `orderEvents` if order
 * matters.
 */
export function readFullJournalEvents(journalPath: string): JournalEvent[] {
  const events = readJournalEvents(journalPath);
  for (const archivePath of archivePathsFor(journalPath)) {
    events.push(...readJournalEvents(archivePath));
  }
  return events;
}

/**
 * The journal events for a bundle: the embedded `journal` array when present
 * (the packed interchange form always wins), otherwise the sibling
 * `journal.jsonl` sidecar — the same precedence `arkaik validate` uses
 * (docs/spec/journal.md § Canonical).
 */
export function loadJournalEvents(bundle: { journal?: unknown }, bundlePath: string): JournalEvent[] {
  if (Array.isArray(bundle.journal)) return bundle.journal as JournalEvent[];
  return readJournalEvents(journalPathFor(bundlePath));
}

/** One event serialized as a single JSONL line (with its trailing newline). */
function toLine(event: JournalEvent): string {
  return JSON.stringify(event) + "\n";
}

/**
 * Append one event as one line to `journalPath`, creating the file (and its
 * directory) if needed. Never corrupts existing lines: if the file does not
 * already end in a newline, one is inserted first, so the new event can never
 * be merged onto a previous unterminated line.
 */
export function appendJournalEvent(journalPath: string, event: JournalEvent): void {
  const line = toLine(event);
  if (!existsSync(journalPath)) {
    mkdirSync(dirname(journalPath), { recursive: true });
    writeFileSync(journalPath, line);
    return;
  }
  const existing = readFileSync(journalPath, "utf8");
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(journalPath, prefix + line);
}

/**
 * Adopt the journal before writing to it (#357): if the snapshot holds nodes
 * whose creation the journal — working file *and* archives — does not record,
 * append ONE `journal.baseline` naming them and return it; otherwise write
 * nothing and return `undefined`.
 *
 * Every writer calls this immediately before its own first append, because that
 * append is what makes the journal non-empty and therefore cross-checked: a
 * bundle whose nodes predate journaling would otherwise be flipped to
 * permanently INVALID by its first release marker or deliverable. Self-limiting
 * by construction — once the baseline is on disk the next call finds nothing
 * missing — so callers need no "already did this" bookkeeping across runs.
 */
export function ensureJournalBaseline(
  journalPath: string,
  bundle: { nodes?: unknown },
  actor: string,
): JournalEvent | undefined {
  const snapshotNodeIds = (Array.isArray(bundle.nodes) ? bundle.nodes : [])
    .map((node) => (node as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === "string");

  const missing = missingProvenanceNodeIds(snapshotNodeIds, readFullJournalEvents(journalPath));
  if (missing.length === 0) return undefined;

  const event = makeEvent("journal.baseline", { node_ids: missing }, { actor });
  appendJournalEvent(journalPath, event);
  return event;
}

/**
 * Compaction (docs/spec/journal.md:93): move `slice` out of the working journal
 * into `journal/archive-<version>.jsonl`, identifying slice events by `id`. The
 * archive is appended to (never overwritten — history is kept), and the working
 * journal is rewritten with the surviving lines in their original order. Slice
 * events are matched by id, so lines not in the slice are preserved verbatim in
 * order; the surviving set is re-serialized canonically per line.
 */
export function compactSlice(journalPath: string, slice: readonly JournalEvent[], version: string): void {
  if (slice.length === 0) return;
  const sliceIds = new Set(slice.map((ev) => ev.id));

  const all = readJournalEvents(journalPath);
  const surviving = all.filter((ev) => !sliceIds.has(ev.id));

  const archivePath = archivePathFor(journalPath, version);
  mkdirSync(dirname(archivePath), { recursive: true });
  const archiveLines = slice.map(toLine).join("");
  if (existsSync(archivePath)) {
    const existing = readFileSync(archivePath, "utf8");
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    appendFileSync(archivePath, prefix + archiveLines);
  } else {
    writeFileSync(archivePath, archiveLines);
  }

  writeFileSync(journalPath, surviving.map(toLine).join(""));
}
