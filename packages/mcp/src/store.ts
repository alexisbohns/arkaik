/**
 * Bundle store — discovery, fresh loads, and the validator-gated dual-write
 * path (docs/spec/mcp.md § Bundle Discovery, § Write Path). File IO comes
 * from `arkaik/io` verbatim (§ Reuse Seams): what the CLI and this server
 * consider "the bundle on disk" is one implementation.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  makeEvent,
  missingProvenanceNodeIds,
  serializeBundle,
  toJournalEvents,
  validateBundle,
  type EventInput,
  type JournalEvent,
  type MutationOp,
  type Project,
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

/** The graph a tool reads, however it was obtained. */
export interface LoadedGraph {
  loaded: BundleValidation;
  nodes: unknown[];
  edges: unknown[];
  project: Project;
  journal: JournalEvent[];
}

/**
 * Where the bundle lives — the one thing that differs between running against a
 * repo file and running against a hosted project.
 *
 * `tools.ts` and the 14-tool catalog are written against this interface and know
 * nothing else, which is what makes local and remote incapable of drifting: the
 * tools, their schemas, their filters and their result shapes are literally the
 * same code. A remote session is a different `Store`, not a different server.
 */
export interface Store {
  /** A fresh read per tool call — external edits must be picked up. */
  load(): Promise<LoadedGraph>;
  /**
   * Apply a mutation. Refusals carry pathed findings and write nothing.
   *
   * `next` carries BOTH forms of the same change, because the two stores need
   * different ones: `nodes`/`edges` are the outcome `applyOps` computed here,
   * which the file store writes directly; `ops` is the intent, which the remote
   * store sends so the SERVER can recompute it under its own row lock. Sending
   * an outcome to the server would be a read-modify-write, and two agents on
   * one project could then clobber each other.
   */
  persist(
    graph: LoadedGraph,
    next: { nodes?: unknown[]; edges?: unknown[]; ops?: readonly MutationOp[] },
    inputs: readonly EventInput[],
  ): Promise<WriteResult>;
  /** For the startup banner. */
  describe(): string;
}

/** The snapshot's node ids, in order — the input side of the provenance check. */
function nodeIdsOf(nodes: readonly unknown[]): string[] {
  return nodes
    .map((node) => (node as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === "string");
}

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
  // Adopt the journal before this mutation's own events (#357). Computed over
  // the PRE-mutation snapshot deliberately: a node this mutation creates brings
  // its own node.created, while a node it *deletes* still needs vouching for —
  // the node.deleted references an id that is about to leave the snapshot, and
  // without the baseline that reference would dangle. Minting it first also
  // gives it the lowest ULID of the batch, so it reads first in the sidecar.
  // A mutation that derives no events writes no journal line, so it needs no
  // adoption marker either — a no-op must stay a no-op.
  const baselineNodeIds =
    inputs.length === 0
      ? []
      : missingProvenanceNodeIds(nodeIdsOf(loaded.nodes), loaded.journal as JournalEvent[]);
  const events = [
    ...(baselineNodeIds.length > 0
      ? [makeEvent("journal.baseline", { node_ids: baselineNodeIds }, { actor: MCP_ACTOR })]
      : []),
    ...toJournalEvents(inputs, MCP_ACTOR),
  ];
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

  // validateBundleAt folds the sidecar AND its compaction archives into
  // `bundle.journal` in place, flagging each source — embedded mode is "the
  // file itself carried one". Both flags matter: a project whose whole history
  // has been compacted has archives and no working journal.jsonl yet is still
  // sidecar-shaped, and treating it as embedded would inline its journal into
  // the snapshot on the next write.
  const journalOnDisk = loaded.sidecarLoaded || loaded.archivesLoaded.length > 0;
  const embeddedJournal = !journalOnDisk && (loaded.bundle as { journal?: unknown }).journal !== undefined;

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

// ---------------------------------------------------------------------------
// FileStore — the repo bundle (the original, unchanged behaviour)
// ---------------------------------------------------------------------------

/** A `Store` over `docs/arkaik/bundle.json` + its journal sidecar. */
export function createFileStore(bundlePath: string): Store {
  return {
    async load(): Promise<LoadedGraph> {
      let loaded: BundleValidation;
      try {
        loaded = loadBundle(bundlePath);
      } catch (error) {
        throw new Error(`Cannot load bundle at ${bundlePath}: ${(error as Error).message}`);
      }
      return {
        loaded,
        nodes: loaded.nodes,
        edges: loaded.edges,
        project: (loaded.bundle as { project: Project }).project,
        journal: loaded.journal as JournalEvent[],
      };
    },

    async persist(graph, next, inputs) {
      return persistMutation(bundlePath, graph.loaded, next, inputs);
    },

    describe() {
      return `bundle: ${bundlePath}`;
    },
  };
}
