/**
 * `arkaik validate [--fix-format] [path]`.
 *
 * Reuses `@arkaik/schema` directly — validateBundle (semantic graph rules),
 * parseJournalLines (JSONL sidecar), and serializeBundle (canonical form) — so
 * there is no re-implemented logic here (docs/spec/toolchain.md § @arkaik/schema).
 *
 * The validate path mirrors packages/schema/src/cli/validate-bundle-cli.ts: it
 * reads the bundle JSON, auto-discovers a sibling `journal.jsonl` sidecar and
 * folds it in via parseJournalLines when the bundle carries no embedded
 * journal (docs/spec/journal.md § Canonical), then runs validateBundle and
 * prints a report over the structured {path, rule, message, severity} findings.
 * Exit 0 when valid, 1 when invalid; warnings never fail.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { serializeBundle, type ValidationFinding } from "@arkaik/schema";
import { readBundle } from "../lib/bundle-io";
import { validateBundleAt, JOURNAL_SIDECAR } from "../lib/bundle-validate";

const USAGE = `arkaik validate [--fix-format] [path]

Validate a project bundle against the Arkaik schema rules. When the bundle has
no embedded journal, a sibling journal.jsonl sidecar is folded in before
validating. Exit 0 when valid, 1 when invalid; warnings never fail.

Arguments:
  path            Path to the bundle JSON file (required).

Options:
  --fix-format    Rewrite <path> to canonical serialization (serializeBundle)
                  in place, instead of validating. Idempotent; preserves
                  unknown keys/fields. A journal.jsonl sidecar is NOT folded in
                  — fix-format only touches the bundle file itself.
  -h, --help      Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function countBySpecies(nodes: unknown[], species: string): number {
  return nodes.filter((n) => (n as { species?: unknown } | null)?.species === species).length;
}

/** Exported so `arkaik open` (packages/cli/src/commands/open.ts) can format the
 * same findings it gates on without re-implementing the string shape. */
export function formatFinding(f: ValidationFinding): string {
  const where = f.path ? ` ${f.path}` : "";
  return `${f.severity.toUpperCase()} [${f.rule}]${where}: ${f.message}`;
}

/** `--fix-format`: rewrite the bundle file to canonical serialization in place. */
function fixFormat(filePath: string): never {
  let bundle: Record<string, unknown>;
  try {
    bundle = readBundle(filePath);
  } catch (e) {
    return fail(`FATAL: ${(e as Error).message}`);
  }
  const before = readFileSync(filePath, "utf8");
  // serializeBundle preserves unknown top-level keys (schema_version, journal)
  // and unknown fields, and is idempotent — running twice yields no change.
  const after = serializeBundle(bundle as unknown as Parameters<typeof serializeBundle>[0]);
  if (after === before) {
    console.log(`Already canonical: ${filePath}`);
  } else {
    writeFileSync(filePath, after);
    console.log(`Reformatted: ${filePath}`);
  }
  process.exit(0);
}

/** `validate`: validate the bundle (+ sidecar journal) and report findings. */
function validate(filePath: string): never {
  const v = (() => {
    try {
      return validateBundleAt(filePath);
    } catch (e) {
      return fail(`FATAL: ${(e as Error).message}`);
    }
  })();

  console.log("\n  Arkaik Bundle Validation");
  console.log("  =======================\n");
  console.log(
    `  Nodes: ${v.nodes.length} (${countBySpecies(v.nodes, "view")} views, ${countBySpecies(v.nodes, "flow")} flows, ${countBySpecies(v.nodes, "data-model")} data-models, ${countBySpecies(v.nodes, "api-endpoint")} api-endpoints)`,
  );
  console.log(`  Edges: ${v.edges.length}`);
  if (v.sidecarLoaded) {
    console.log(`  Journal: ${v.journal.length} event(s) from ${JOURNAL_SIDECAR} sidecar`);
  } else if (v.journal.length > 0) {
    console.log(`  Journal: ${v.journal.length} embedded event(s)`);
  }
  console.log("");

  if (v.result.warnings.length > 0) {
    console.log(`  Warnings: ${v.result.warnings.length}`);
    v.result.warnings.forEach((w) => console.log(`    ${formatFinding(w)}`));
    console.log("");
  }

  // Sidecar line-parse findings are hard errors, joined with the semantic
  // errors from validateBundle.
  const errorLines = [
    ...v.sidecarFindings.map((f) => `ERROR [${f.rule}] line ${f.line}: ${f.message}`),
    ...v.result.errors.map(formatFinding),
  ];

  if (errorLines.length === 0) {
    console.log("  Result: VALID\n");
    process.exit(0);
  }

  console.log(`  Errors: ${errorLines.length}`);
  errorLines.forEach((m) => console.log(`    ${m}`));
  console.log("\n  Result: INVALID\n");
  process.exit(1);
}

export function runValidate(args: string[]): void {
  let fixFormatFlag = false;
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--fix-format") {
      fixFormatFlag = true;
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      positionals.push(arg);
    }
  }

  const filePath = positionals[0];
  if (filePath === undefined) {
    fail(`Missing bundle path.\n\n${USAGE}`);
  }

  if (fixFormatFlag) {
    fixFormat(filePath);
  } else {
    validate(filePath);
  }
}
