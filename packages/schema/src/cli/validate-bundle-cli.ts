import { existsSync, readFileSync } from "node:fs";
import { validateBundle } from "../validate";

/**
 * Entry point for the standalone `validate-bundle.js` build artifact
 * (`docs/spec/toolchain.md` § @arkaik/schema). esbuild bundles this file
 * together with `@arkaik/schema` into a zero-dependency script so agents
 * without node_modules can still gate on it with nothing but Node.
 */

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

  const loose = bundle as { project?: unknown; nodes?: unknown; edges?: unknown } | null;
  if (typeof loose !== "object" || loose === null || !loose.project || !loose.nodes || !loose.edges) {
    console.error("FATAL: Missing top-level keys (project, nodes, edges).");
    process.exit(1);
  }

  const nodes = Array.isArray(loose.nodes) ? loose.nodes : [];
  const edges = Array.isArray(loose.edges) ? loose.edges : [];
  const result = validateBundle(bundle);

  console.log("\n  Arkaik Bundle Validation");
  console.log("  =======================\n");
  console.log(
    `  Nodes: ${nodes.length} (${countBySpecies(nodes, "view")} views, ${countBySpecies(nodes, "flow")} flows, ${countBySpecies(nodes, "data-model")} data-models, ${countBySpecies(nodes, "api-endpoint")} api-endpoints)`,
  );
  console.log(`  Edges: ${edges.length}`);
  console.log("");

  if (result.warnings.length > 0) {
    console.log(`  Warnings: ${result.warnings.length}`);
    result.warnings.forEach((w) => console.log(`    WARN: ${w.message}`));
    console.log("");
  }

  if (result.valid) {
    console.log("  Result: VALID\n");
    process.exit(0);
  }

  console.log(`  Errors: ${result.errors.length}`);
  result.errors.forEach((e) => console.log(`    ERROR: ${e.message}`));
  console.log("\n  Result: INVALID\n");
  process.exit(1);
}

main();
