import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateBundle } from "../validate";
import { parseJournalLines, type JournalLineFinding } from "../journal";

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
 */

const JOURNAL_SIDECAR = "journal.jsonl";

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

  // Fold in the canonical JSONL sidecar when the bundle carries no embedded
  // journal. Line-level parse findings (bad JSON, missing envelope fields) carry
  // the 1-based line number and are hard errors — a malformed line invalidates
  // exactly that one event and never damages the rest (docs/spec/journal.md).
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

  console.log("\n  Arkaik Bundle Validation");
  console.log("  =======================\n");
  console.log(
    `  Nodes: ${nodes.length} (${countBySpecies(nodes, "view")} views, ${countBySpecies(nodes, "flow")} flows, ${countBySpecies(nodes, "data-model")} data-models, ${countBySpecies(nodes, "api-endpoint")} api-endpoints, ${countBySpecies(nodes, "acceptance")} acceptances)`,
  );
  console.log(`  Edges: ${edges.length}`);
  if (sidecarLoaded) {
    console.log(`  Journal: ${journal.length} event(s) from ${JOURNAL_SIDECAR} sidecar`);
  } else if (journal.length > 0) {
    console.log(`  Journal: ${journal.length} embedded event(s)`);
  }
  console.log("");

  if (result.warnings.length > 0) {
    console.log(`  Warnings: ${result.warnings.length}`);
    result.warnings.forEach((w) => console.log(`    WARN: ${w.message}`));
    console.log("");
  }

  const errorMessages = [
    ...sidecarFindings.map((f) => f.message),
    ...result.errors.map((e) => e.message),
  ];

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
