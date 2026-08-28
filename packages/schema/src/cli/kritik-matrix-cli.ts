/**
 * Entry point for the standalone `compute-matrix.js` build artifact — the
 * Kritik roll-up, bundled zero-dependency so an agent auditing a repo without
 * `node_modules` can still gate on it with nothing but Node.
 *
 * It is the **only** thing that may write `matrix.json`. Everything it prints
 * is derived from `scores.json` + `findings.json` + the effective library
 * (pack ⊕ overlay), so a hand-edited matrix is not a shortcut, it is a lie the
 * next audit will contradict.
 *
 * The reading and the roll-up itself live in `kritik-audit.ts`, shared verbatim
 * with `arkaik kritik matrix` and the `kritik_matrix` MCP tool: three ways in,
 * one set of numbers out. What stays here is only what "being a script" means —
 * argument parsing, and printing for a terminal.
 *
 * Usage: node compute-matrix.js [audit-id] [--root <dir>] [--json]
 */

import { dirname, resolve } from "node:path";
import { priorityOf, severityOf } from "../quality";
import { computeAuditMatrix, matrixPath, renderMatrixMarkdown, resolveAuditId } from "./kritik-audit";
import { die, loadEffectiveLibrary } from "./kritik-paths";

const USAGE = `compute-matrix.js — roll one Kritik audit up into its comparative matrix

Usage: node compute-matrix.js [audit-id] [--root <dir>] [--json]

  audit-id     the audit under docs/quality/audits/ (default: the newest one)
  --root       repo root holding docs/quality/ (default: the current directory)
  --json       print matrix.json to stdout instead of the markdown table

Reads  docs/quality/audits/<id>/{scores,findings}.json
Writes docs/quality/audits/<id>/matrix.json`;

function parseArgs(argv: string[]) {
  let auditId: string | undefined;
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg === "--json") json = true;
    else if (arg === "--root") root = argv[++i] ?? root;
    else if (arg.startsWith("--")) die(`compute-matrix: unknown option ${arg}\n\n${USAGE}`);
    else auditId ??= arg;
  }
  return { auditId, root, json };
}

function main(): void {
  const { auditId: requested, root, json } = parseArgs(process.argv.slice(2));
  // The script's own directory, taken from argv rather than `import.meta.url`
  // or `__dirname`: this file is bundled to CJS and dropped into a repo that
  // may run it from anywhere, and argv[1] is the one answer both formats agree on.
  const scriptDir = dirname(resolve(process.argv[1] ?? "."));

  // The audit-file layer throws so the MCP server and the CLI can each frame a
  // failure their own way; here, a failure IS the exit code and the message.
  let auditId: string;
  try {
    auditId = resolveAuditId(root, requested);
  } catch (error) {
    return die(`compute-matrix: ${(error as Error).message}`);
  }

  const library = loadEffectiveLibrary(scriptDir, root);
  let computed: ReturnType<typeof computeAuditMatrix>;
  try {
    computed = computeAuditMatrix(root, auditId, library);
  } catch (error) {
    return die(`compute-matrix: ${(error as Error).message}`);
  }
  const { section, matrix, file } = computed;

  if (json) {
    process.stdout.write(`${JSON.stringify(file, null, 2)}\n`);
    return;
  }

  const domainNames = new Map((library.domains ?? []).map((d) => [d.code, d.name]));
  process.stdout.write(`${renderMatrixMarkdown(matrix, domainNames)}\n\n`);

  const open = section.findings.filter((f) => (f.status ?? "open") === "open");
  const lanes = { P0: 0, P1: 0, P2: 0, P3: 0 } as Record<string, number>;
  for (const finding of open) lanes[priorityOf(finding, library)]++;
  const counts = matrix.finding_counts;
  process.stdout.write(
    `${section.assessments.length} assessments · ${open.length} open findings ` +
      `(${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low)\n` +
      `lanes: P0 ${lanes.P0} · P1 ${lanes.P1} · P2 ${lanes.P2} · P3 ${lanes.P3}\n`,
  );

  // The P0 list is the answer; the matrix is the evidence. Lead with it.
  const p0 = open.filter((f) => priorityOf(f, library) === "P0");
  if (p0.length > 0) {
    process.stdout.write(`\nP0 — fix first:\n`);
    for (const finding of p0) {
      process.stdout.write(`  [${severityOf(finding, library)}] ${finding.surface} · ${finding.id} — ${finding.title}\n`);
    }
  }
  process.stdout.write(`\nwrote ${matrixPath(root, auditId)}\n`);
}

main();
