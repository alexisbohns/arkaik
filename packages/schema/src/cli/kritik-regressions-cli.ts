/**
 * Entry point for the standalone `detect-regressions.js` build artifact — what
 * got worse between two Kritik audits, bundled zero-dependency so a repo
 * running Kritik from the plugin alone can gate on it with nothing but Node.
 *
 * The comparison itself lives in `../quality-regressions`, shared verbatim with
 * `arkaik kritik regressions` and the `kritik_regressions` MCP tool: three ways
 * in, one verdict out. What stays here is only what "being a script" means —
 * argument parsing, printing, and an exit code.
 *
 * Usage: node detect-regressions.js [--from <audit>] [--to <audit>] [--root <dir>] [--json]
 */

import { dirname, resolve } from "node:path";
import { detectRegressions, type Regression } from "../quality-regressions";
import { listAuditIds, loadQualitySection } from "./kritik-audit";
import { die, loadEffectiveLibrary } from "./kritik-paths";

const USAGE = `detect-regressions.js — what got worse between two Kritik audits

Usage: node detect-regressions.js [--from <audit>] [--to <audit>] [--root <dir>] [--json]

  --from       the older reading (default: the audit before --to)
  --to         the newer reading (default: the newest on disk)
  --root       repo root holding docs/quality/ (default: the current directory)
  --json       print the full list as JSON

Reads docs/quality/audits/<id>/{scores,findings}.json for both audits.
Exits 1 when anything regressed. Writes nothing — recording the trips is
\`arkaik kritik regressions --record\`.`;

function parseArgs(argv: string[]) {
  let root = process.cwd();
  let from: string | undefined;
  let to: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg === "--json") json = true;
    else if (arg === "--root") root = argv[++i] ?? root;
    else if (arg === "--from") from = argv[++i];
    else if (arg === "--to") to = argv[++i];
    else die(`detect-regressions: unknown option ${arg}\n\n${USAGE}`);
  }
  return { root, from, to, json };
}

function main(): void {
  const { root, from: requestedFrom, to: requestedTo, json } = parseArgs(process.argv.slice(2));
  // argv[1], not import.meta.url or __dirname: this file is bundled to CJS and
  // dropped into a repo that may run it from anywhere.
  const scriptDir = dirname(resolve(process.argv[1] ?? "."));

  const audits = listAuditIds(root);
  if (audits.length < 2) {
    return die(
      `detect-regressions: needs two audits to compare — ` +
        `${audits.length === 0 ? "docs/quality/audits/ holds none" : `only "${audits[0]}" exists`}.`,
    );
  }
  const known = (id: string): string | undefined => (audits.includes(id) ? id : undefined);
  const to = requestedTo === undefined ? audits[audits.length - 1] : known(requestedTo);
  if (to === undefined) return die(`detect-regressions: no audit "${requestedTo}" (have: ${audits.join(", ")})`);
  const from = requestedFrom === undefined ? audits[audits.indexOf(to) - 1] : known(requestedFrom);
  if (from === undefined) return die(`detect-regressions: no older audit to compare "${to}" against`);
  if (from === to) return die(`detect-regressions: --from and --to name the same audit ("${to}")`);

  const library = loadEffectiveLibrary(scriptDir, root);
  let regressions: Regression[];
  try {
    regressions = detectRegressions(
      loadQualitySection(root, from, library),
      loadQualitySection(root, to, library),
      library,
    );
  } catch (error) {
    return die(`detect-regressions: ${(error as Error).message}`);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ from, to, total: regressions.length, regressions }, null, 2)}\n`);
  } else if (regressions.length === 0) {
    process.stdout.write(`nothing regressed between ${from} and ${to}\n`);
  } else {
    for (const regression of regressions) {
      process.stdout.write(`[${regression.kind}] ${regression.criterion_id} x ${regression.surface}\n  ${regression.detail}\n`);
    }
    process.stdout.write(`\n${regressions.length} regression(s) between ${from} and ${to}\n`);
  }
  process.exit(regressions.length > 0 ? 1 : 0);
}

main();
