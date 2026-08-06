import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { validateBundle } from "../validate";
import { parseJournalLines, type JournalEvent } from "../journal";

/**
 * Entry point for the standalone `validate-bundle.js` build artifact
 * (`docs/spec/toolchain.md` § @arkaik/schema). esbuild bundles this file
 * together with `@arkaik/schema` into a zero-dependency script so agents
 * without node_modules can still gate on it with nothing but Node.
 *
 * The snapshot↔journal cross-check (docs/spec/journal.md § Authority &
 * Consistency Model) runs against the bundle's `journal` array. In a repo the
 * canonical journal is the JSONL sidecar next to the snapshot, never embedded
 * (docs/spec/journal.md § Canonical), so this CLI auto-discovers a sibling
 * `journal.jsonl` and folds its events into the bundle before validating. That
 * is what makes the dual-write hard gate real: `node validate-bundle.js
 * docs/arkaik/bundle.json` gates the *appended* event, not just an embedded
 * projection. An embedded `journal` (the packed interchange form) always wins —
 * the sidecar is only consulted when none is present.
 *
 * The compaction archives (`journal/archive-<version>.jsonl`) are folded in
 * alongside the sidecar. `arkaik release --compact` *relocates* history into
 * them, it never deletes it (docs/spec/journal.md § Releases, Compaction &
 * Growth), so a validator that read only the working file would call a
 * perfectly healthy compacted project invalid the moment a release archived a
 * node's `node.created` or its last status transition (#358).
 */

const JOURNAL_SIDECAR = "journal.jsonl";
const JOURNAL_ARCHIVE_DIR = "journal";

/** The compaction archives beside the sidecar, sorted so a report is deterministic. */
function archivePaths(bundleDir: string): string[] {
  const dir = join(bundleDir, JOURNAL_ARCHIVE_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("archive-") && name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(dir, name));
}

function countBySpecies(nodes: unknown[], species: string): number {
  return nodes.filter((n) => (n as { species?: unknown } | null)?.species === species).length;
}

function main(): void {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node validate-bundle.js <path-to-bundle.json>");
    process.exit(1);
  }
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  let bundle: unknown;
  try {
    bundle = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`FATAL: Cannot parse JSON — ${(e as Error).message}`);
    process.exit(1);
  }

  const loose = bundle as { project?: unknown; nodes?: unknown; edges?: unknown; journal?: unknown } | null;
  if (typeof loose !== "object" || loose === null || !loose.project || !loose.nodes || !loose.edges) {
    console.error("FATAL: Missing top-level keys (project, nodes, edges).");
    process.exit(1);
  }

  // Fold in the canonical JSONL sidecar AND its compaction archives when the
  // bundle carries no embedded journal. Line-level parse findings (bad JSON,
  // missing envelope fields) carry the 1-based line number and are hard errors —
  // a malformed line invalidates exactly that one event and never damages the
  // rest (docs/spec/journal.md). Archive findings name their file too, since a
  // bare line number would be ambiguous across several files.
  const lineFindings: string[] = [];
  let sidecarLoaded = false;
  const archivesLoaded: string[] = [];
  if (loose.journal === undefined) {
    const bundleDir = dirname(filePath);
    const sidecarPath = join(bundleDir, JOURNAL_SIDECAR);
    const folded: JournalEvent[] = [];
    if (existsSync(sidecarPath)) {
      const { events, findings } = parseJournalLines(readFileSync(sidecarPath, "utf8"));
      for (const finding of findings) lineFindings.push(finding.message);
      sidecarLoaded = true;
      folded.push(...events);
    }
    for (const archivePath of archivePaths(bundleDir)) {
      const name = basename(archivePath);
      const { events, findings } = parseJournalLines(readFileSync(archivePath, "utf8"));
      for (const finding of findings) lineFindings.push(`${name} — ${finding.message}`);
      archivesLoaded.push(name);
      folded.push(...events);
    }
    if (sidecarLoaded || archivesLoaded.length > 0) loose.journal = folded;
  }

  const nodes = Array.isArray(loose.nodes) ? loose.nodes : [];
  const edges = Array.isArray(loose.edges) ? loose.edges : [];
  const journal = Array.isArray(loose.journal) ? loose.journal : [];
  const result = validateBundle(bundle);

  console.log("\n  Arkaik Bundle Validation");
  console.log("  =======================\n");
  console.log(
    `  Nodes: ${nodes.length} (${countBySpecies(nodes, "view")} views, ${countBySpecies(nodes, "flow")} flows, ${countBySpecies(nodes, "data-model")} data-models, ${countBySpecies(nodes, "api-endpoint")} api-endpoints, ${countBySpecies(nodes, "acceptance")} acceptances)`,
  );
  console.log(`  Edges: ${edges.length}`);
  if (sidecarLoaded || archivesLoaded.length > 0) {
    const from = [
      ...(sidecarLoaded ? [`${JOURNAL_SIDECAR} sidecar`] : []),
      ...(archivesLoaded.length > 0 ? [`${archivesLoaded.length} archive(s)`] : []),
    ].join(" + ");
    console.log(`  Journal: ${journal.length} event(s) from ${from}`);
  } else if (journal.length > 0) {
    console.log(`  Journal: ${journal.length} embedded event(s)`);
  }
  console.log("");

  if (result.warnings.length > 0) {
    console.log(`  Warnings: ${result.warnings.length}`);
    result.warnings.forEach((w) => console.log(`    WARN: ${w.message}`));
    console.log("");
  }

  const errorMessages = [...lineFindings, ...result.errors.map((e) => e.message)];

  if (errorMessages.length === 0) {
    console.log("  Result: VALID\n");
    process.exit(0);
  }

  console.log(`  Errors: ${errorMessages.length}`);
  errorMessages.forEach((m) => console.log(`    ERROR: ${m}`));
  console.log("\n  Result: INVALID\n");
  process.exit(1);
}

main();
