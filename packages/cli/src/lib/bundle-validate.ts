/**
 * Shared "read + fold + validate" for the `arkaik` CLI — shape + semantic +
 * snapshot<->journal cross-checks (docs/spec/journal.md § Authority &
 * Consistency Model), reused by both `arkaik validate` (reports + exits) and
 * `arkaik open` (gates the handoff to arkaik.app import on this exact check).
 *
 * Mirrors packages/schema/src/cli/validate-bundle-cli.ts: fold in the sibling
 * `journal.jsonl` sidecar *and its compaction archives* when the bundle carries
 * no embedded journal — an embedded `journal` (the packed interchange form)
 * always wins — then run `validateBundle`. Kept as one shared implementation
 * inside packages/cli (both callers are esbuild-bundled into the same CLI
 * binary, unlike the standalone schema artifact) so the fold logic can't drift
 * between `validate` and `open`.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  validateBundle,
  parseJournalLines,
  type JournalEvent,
  type JournalLineFinding,
  type ValidationResult,
} from "@arkaik/schema";
import { readBundle } from "./bundle-io";
import { archivePathsFor, journalPathFor } from "./journal-io";

export { JOURNAL_SIDECAR } from "./journal-io";

/** A sidecar line finding from a compaction archive — same shape, plus which file. */
export interface JournalArchiveFinding extends JournalLineFinding {
  /** The archive's file name, e.g. `archive-1.3.0.jsonl`. */
  file: string;
}

export interface BundleValidation {
  bundle: Record<string, unknown>;
  nodes: unknown[];
  edges: unknown[];
  journal: unknown[];
  /** True when a sibling journal.jsonl sidecar was folded in (no embedded journal was present). */
  sidecarLoaded: boolean;
  /** Line-level parse findings from the sidecar (bad JSON, missing envelope fields) — hard errors. */
  sidecarFindings: JournalLineFinding[];
  /** File names of the `journal/archive-*.jsonl` compaction archives folded in. */
  archivesLoaded: string[];
  /** The same line-level parse findings from those archives — equally hard errors. */
  archiveFindings: JournalArchiveFinding[];
  result: ValidationResult;
  /** No sidecar/archive line-parse findings and no validateBundle errors. Warnings never fail. */
  valid: boolean;
}

/**
 * Read `filePath`, fold in the sibling journal sidecar + archives when the
 * bundle has no embedded journal, and run `validateBundle`. Throws (readBundle's
 * errors, or a "Missing top-level keys" Error) on a fatal read/shape problem —
 * callers decide how to report it (message + exit code).
 */
export function validateBundleAt(filePath: string): BundleValidation {
  const bundle = readBundle(filePath);

  const loose = bundle as { project?: unknown; nodes?: unknown; edges?: unknown; journal?: unknown };
  if (!loose.project || !loose.nodes || !loose.edges) {
    throw new Error("Missing top-level keys (project, nodes, edges).");
  }

  let sidecarFindings: JournalLineFinding[] = [];
  let sidecarLoaded = false;
  const archiveFindings: JournalArchiveFinding[] = [];
  const archivesLoaded: string[] = [];
  if (loose.journal === undefined) {
    const sidecarPath = journalPathFor(filePath);
    const folded: JournalEvent[] = [];
    if (existsSync(sidecarPath)) {
      const { events, findings } = parseJournalLines(readFileSync(sidecarPath, "utf8"));
      sidecarFindings = findings;
      sidecarLoaded = true;
      folded.push(...events);
    }
    // `arkaik release --compact` moves the released slice into
    // journal/archive-<version>.jsonl and keeps it there (docs/spec/journal.md
    // § Releases, Compaction & Growth). Those events are still history, so the
    // cross-check must see them: otherwise the first release archives a node's
    // node.created — or a middle slice strands an older status transition as
    // the new "last" one — and a healthy project reads as INVALID (#358).
    for (const archivePath of archivePathsFor(sidecarPath)) {
      const { events, findings } = parseJournalLines(readFileSync(archivePath, "utf8"));
      const file = basename(archivePath);
      for (const finding of findings) archiveFindings.push({ ...finding, file });
      archivesLoaded.push(file);
      folded.push(...events);
    }
    // Either source alone is enough to say "this project's journal lives on
    // disk": a bundle whose entire history has been compacted has archives and
    // no working file at all. Callers that branch on storage shape must test
    // BOTH flags (see `journalOnDisk` in the MCP write path).
    if (sidecarLoaded || archivesLoaded.length > 0) loose.journal = folded;
  }

  const nodes = Array.isArray(loose.nodes) ? loose.nodes : [];
  const edges = Array.isArray(loose.edges) ? loose.edges : [];
  const journal = Array.isArray(loose.journal) ? loose.journal : [];
  const result = validateBundle(bundle);
  const valid =
    sidecarFindings.length === 0 && archiveFindings.length === 0 && result.errors.length === 0;

  return {
    bundle,
    nodes,
    edges,
    journal,
    sidecarLoaded,
    sidecarFindings,
    archivesLoaded,
    archiveFindings,
    result,
    valid,
  };
}

/**
 * The sidecar + archive line-parse findings as report lines, in the one shape
 * `arkaik validate`, `arkaik open` and `arkaik push` all print. Shared so a new
 * kind of line finding can't be surfaced by one command and silently dropped by
 * another — all three gate on the same `valid`, so all three must say why.
 */
export function journalLineErrorLines(v: BundleValidation): string[] {
  return [
    ...v.sidecarFindings.map((f) => `ERROR [${f.rule}] line ${f.line}: ${f.message}`),
    ...v.archiveFindings.map((f) => `ERROR [${f.rule}] ${f.file} line ${f.line}: ${f.message}`),
  ];
}
