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
 * Usage: node compute-matrix.js [audit-id] [--root <dir>] [--json]
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  deriveQualityMatrix,
  gradeOf,
  priorityOf,
  severityOf,
  type QualityAssessment,
  type QualityFinding,
  type QualityMatrixCell,
} from "../quality";
import { auditDir, die, loadEffectiveLibrary, loadProfile, readJson, writeJson } from "./kritik-paths";

interface ScoresFile {
  audit_id?: string;
  commit?: string;
  framework_version?: string;
  assessments: QualityAssessment[];
}
interface FindingsFile {
  audit_id?: string;
  commit?: string;
  framework_version?: string;
  findings: QualityFinding[];
}

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

/** The newest audit id present, so the common case needs no argument. */
function newestAudit(root: string): string {
  const dir = join(root, "docs", "quality", "audits");
  if (!existsSync(dir)) die(`compute-matrix: no audits directory at ${dir}`);
  const ids = readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
  if (ids.length === 0) die(`compute-matrix: no audits found under ${dir}`);
  return ids[ids.length - 1];
}

function markdown(
  matrix: ReturnType<typeof deriveQualityMatrix>,
  domainNames: Map<string, string>,
): string {
  const cell = (value: QualityMatrixCell | null | undefined) =>
    value ? `${value.score} (${value.grade}${value.capped ? "*" : ""})` : "—";
  const lines: string[] = [];
  lines.push(`| Domain | ${matrix.surfaces.join(" | ")} |`);
  lines.push(`| --- | ${matrix.surfaces.map(() => "---").join(" | ")} |`);
  for (const domain of matrix.domains) {
    const label = domainNames.get(domain) ?? domain;
    lines.push(`| **${domain}** ${label} | ${matrix.surfaces.map((s) => cell(matrix.matrix[domain]?.[s])).join(" | ")} |`);
  }
  lines.push(
    `| **Overall (weighted)** | ${matrix.surfaces
      .map((s) => {
        const score = matrix.overall[s];
        return score === null || score === undefined ? "—" : `**${score} (${gradeOf(score)})**`;
      })
      .join(" | ")} |`,
  );
  return lines.join("\n");
}

function main(): void {
  const { auditId: requested, root, json } = parseArgs(process.argv.slice(2));
  // The script's own directory, taken from argv rather than `import.meta.url`
  // or `__dirname`: this file is bundled to CJS and dropped into a repo that
  // may run it from anywhere, and argv[1] is the one answer both formats agree on.
  const scriptDir = dirname(resolve(process.argv[1] ?? "."));
  const auditId = requested ?? newestAudit(root);
  const dir = auditDir(root, auditId);

  const scoresPath = join(dir, "scores.json");
  const findingsPath = join(dir, "findings.json");
  if (!existsSync(scoresPath)) die(`compute-matrix: no scores.json at ${scoresPath}`);

  const scores = readJson<ScoresFile>(scoresPath);
  // A run that produced no findings is a real (if rare) outcome, not a setup error.
  const findings = existsSync(findingsPath) ? readJson<FindingsFile>(findingsPath) : { findings: [] };

  const profile = loadProfile(root);
  if (!profile) {
    die(
      `compute-matrix: no profile at docs/quality/profile.json — run init-profile.js first.\n` +
        `Without a surface list there are no columns to roll up into.`,
    );
  }

  const library = loadEffectiveLibrary(scriptDir, root);
  const section = {
    framework_version: scores.framework_version ?? library.version,
    profile,
    assessments: Array.isArray(scores.assessments) ? scores.assessments : [],
    findings: Array.isArray(findings.findings) ? findings.findings : [],
  };
  const matrix = deriveQualityMatrix({ quality: section }, library);

  const out = {
    audit_id: auditId,
    commit: scores.commit,
    framework_version: section.framework_version,
    matrix: matrix.matrix,
    overall: matrix.overall,
    finding_counts: matrix.finding_counts,
  };
  writeJson(join(dir, "matrix.json"), out);

  if (json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  const domainNames = new Map((library.domains ?? []).map((d) => [d.code, d.name]));
  process.stdout.write(`${markdown(matrix, domainNames)}\n\n`);

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
  process.stdout.write(`\nwrote ${join(dir, "matrix.json")}\n`);
}

main();
