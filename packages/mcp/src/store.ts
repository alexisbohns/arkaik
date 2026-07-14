/**
 * Bundle store — discovery, fresh loads, and the validator-gated dual-write
 * path (docs/spec/mcp.md § Bundle Discovery, § Write Path). File IO comes
 * from `arkaik/io` verbatim (§ Reuse Seams): what the CLI and this server
 * consider "the bundle on disk" is one implementation.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  serializeBundle,
  toJournalEvents,
  validateBundle,
  type EventInput,
  type JournalEvent,
  type ValidationFinding,
} from "@arkaik/schema";
import { appendJournalEvent, journalPathFor, validateBundleAt, type BundleValidation } from "arkaik/io";

/** Every event this server writes carries the agent-plane actor. */
export const MCP_ACTOR = "arkaik-mcp";

export const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";

/**
 * Resolution order (docs/spec/mcp.md § Bundle Discovery):
 * `--bundle <path>` → `ARKAIK_BUNDLE` → `docs/arkaik/bundle.json` under cwd.
 */
export function resolveBundlePath(argv: readonly string[], env: Record<string, string | undefined>): string {
  const flagIndex = argv.indexOf("--bundle");
  const flagValue = flagIndex !== -1 ? argv[flagIndex + 1] : undefined;
  if (flagValue) return resolve(flagValue);
  if (env.ARKAIK_BUNDLE) return resolve(env.ARKAIK_BUNDLE);
  return resolve(DEFAULT_BUNDLE_PATH);
}

/**
 * Fresh read per tool call (spec requirement — external edits by humans,
 * other agents, or `git pull` must be picked up). Throws readBundle's /
 * "Missing top-level keys" errors; tool dispatch surfaces them as tool errors.
 */
export function loadBundle(bundlePath: string): BundleValidation {
  return validateBundleAt(bundlePath);
}

export interface WriteRefusal {
  ok: false;
  /** Pathed validator findings — the mutation was refused, nothing was written. */
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
}

export interface WriteSuccess {
  ok: true;
  warnings: ValidationFinding[];
  /** The stamped journal events that were persisted. */
  events: JournalEvent[];
}

export type WriteResult = WriteRefusal | WriteSuccess;

/**
 * The dual-write path (docs/spec/mcp.md § Write Path), in order: derive the
 * stamped events, fold them into the mutated bundle **in memory**, gate on
 * `validateBundle` (any error → refuse, write nothing), then persist —
 * journal first (sidecar JSONL append, or the embedded array for packed
 * interchange bundles), snapshot second via canonical `serializeBundle`.
 */
export function persistMutation(
  bundlePath: string,
  loaded: BundleValidation,
  next: { nodes?: unknown[]; edges?: unknown[] },
  inputs: readonly EventInput[],
): WriteResult {
  const events = toJournalEvents(inputs, MCP_ACTOR);
  const nextNodes = next.nodes ?? loaded.nodes;
  const nextEdges = next.edges ?? loaded.edges;

  const candidate: Record<string, unknown> = {
    ...loaded.bundle,
    nodes: nextNodes,
    edges: nextEdges,
    journal: [...loaded.journal, ...events],
  };

  const result = validateBundle(candidate);
  if (result.errors.length > 0) {
    return { ok: false, errors: result.errors, warnings: result.warnings };
  }

  // validateBundleAt folds a sidecar into `bundle.journal` in place, flagging
  // it with sidecarLoaded — embedded mode is "the file itself carried one".
  const embeddedJournal = !loaded.sidecarLoaded && (loaded.bundle as { journal?: unknown }).journal !== undefined;

  if (embeddedJournal) {
    writeFileSync(bundlePath, serializeBundle(candidate as unknown as Parameters<typeof serializeBundle>[0]));
  } else {
    const journalPath = journalPathFor(bundlePath);
    for (const event of events) {
      appendJournalEvent(journalPath, event);
    }
    if (next.nodes !== undefined || next.edges !== undefined) {
      const snapshot: Record<string, unknown> = { ...loaded.bundle, nodes: nextNodes, edges: nextEdges };
      delete snapshot.journal; // the fold above put the sidecar here — it stays a sidecar
      writeFileSync(bundlePath, serializeBundle(snapshot as unknown as Parameters<typeof serializeBundle>[0]));
    }
  }

  return { ok: true, warnings: result.warnings, events };
}
