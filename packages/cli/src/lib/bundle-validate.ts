/**
 * Shared "read + fold + validate" for the `arkaik` CLI — shape + semantic +
 * snapshot<->journal cross-checks (docs/spec/journal.md § Authority &
 * Consistency Model), reused by both `arkaik validate` (reports + exits) and
 * `arkaik open` (gates the handoff to arkaik.app import on this exact check).
 *
 * Mirrors packages/schema/src/cli/validate-bundle-cli.ts: fold in a sibling
 * `journal.jsonl` sidecar when the bundle carries no embedded journal — an
 * embedded `journal` (the packed interchange form) always wins — then run
 * `validateBundle`. Kept as one shared implementation inside packages/cli (both
 * callers are esbuild-bundled into the same CLI binary, unlike the standalone
 * schema artifact) so the fold logic can't drift between `validate` and `open`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  validateBundle,
  parseJournalLines,
  type JournalLineFinding,
  type ValidationResult,
} from "@arkaik/schema";
import { readBundle } from "./bundle-io";

/** The canonical JSONL sidecar name, sibling to the bundle (mirrors journal-io.ts). */
export const JOURNAL_SIDECAR = "journal.jsonl";

export interface BundleValidation {
  bundle: Record<string, unknown>;
  nodes: unknown[];
  edges: unknown[];
  journal: unknown[];
  /** True when a sibling journal.jsonl sidecar was folded in (no embedded journal was present). */
  sidecarLoaded: boolean;
  /** Line-level parse findings from the sidecar (bad JSON, missing envelope fields) — hard errors. */
  sidecarFindings: JournalLineFinding[];
  result: ValidationResult;
  /** No sidecar line-parse findings and no validateBundle errors. Warnings never fail. */
  valid: boolean;
}

/**
 * Read `filePath`, fold in a sibling journal.jsonl sidecar when the bundle has
 * no embedded journal, and run `validateBundle`. Throws (readBundle's errors,
 * or a "Missing top-level keys" Error) on a fatal read/shape problem — callers
 * decide how to report it (message + exit code).
 */
export function validateBundleAt(filePath: string): BundleValidation {
  const bundle = readBundle(filePath);

  const loose = bundle as { project?: unknown; nodes?: unknown; edges?: unknown; journal?: unknown };
  if (!loose.project || !loose.nodes || !loose.edges) {
    throw new Error("Missing top-level keys (project, nodes, edges).");
  }

  let sidecarFindings: JournalLineFinding[] = [];
  let sidecarLoaded = false;
  if (loose.journal === undefined) {
    const sidecarPath = join(dirname(filePath), JOURNAL_SIDECAR);
    if (existsSync(sidecarPath)) {
      const { events, findings } = parseJournalLines(readFileSync(sidecarPath, "utf8"));
      sidecarFindings = findings;
      sidecarLoaded = true;
      loose.journal = events;
    }
  }

  const nodes = Array.isArray(loose.nodes) ? loose.nodes : [];
  const edges = Array.isArray(loose.edges) ? loose.edges : [];
  const journal = Array.isArray(loose.journal) ? loose.journal : [];
  const result = validateBundle(bundle);
  const valid = sidecarFindings.length === 0 && result.errors.length === 0;

  return { bundle, nodes, edges, journal, sidecarLoaded, sidecarFindings, result, valid };
}
