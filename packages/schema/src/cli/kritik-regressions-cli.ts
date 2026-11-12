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
import { auditReadings, readingOf, type AuditReading } from "../quality-plan";
import { detectRegressions, type Regression } from "../quality-regressions";
import { listAuditIds, loadQualitySectionThrough } from "./kritik-audit";
import { die, loadEffectiveLibrary } from "./kritik-paths";

const USAGE = `detect-regressions.js — what got worse between two Kritik audits

Usage: node detect-regressions.js [--from <audit>] [--to <audit>] [--root <dir>] [--json]

  --from       the older reading (default: the reading before --to)
  --to         the newer reading (default: the newest on disk); a plan's
               parts are one reading, named by the plan id or any part id
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

  // A plan's parts are scored apart and recorded once, so they are one reading:
  // the same pairing `arkaik kritik regressions` and `kritik_regressions` make.
  const readings = auditReadings(listAuditIds(root));
  if (readings.length < 2) {
    return die(
      `detect-regressions: needs two audits to compare — ` +
        `${readings.length === 0 ? "docs/quality/audits/ holds none" : `only "${readings[0].id}" exists`}.`,
    );
  }
  // An unknown id and "there is nothing older" are different refusals and must
  // read differently — folding them together names the wrong audit and hides
  // what the repo actually holds. The CLI verb and the MCP tool say the same
  // two things; a third wording here is how three entry points drift apart.
  const known = (id: string, flag: string): AuditReading => {
    const reading = readingOf(readings, id);
    if (reading === undefined) {
      return die(`detect-regressions: no audit "${id}" for ${flag} (have: ${readings.map((r) => r.id).join(", ")})`);
    }
    return reading;
  };
  const toReading = requestedTo === undefined ? readings[readings.length - 1] : known(requestedTo, "--to");
  const fromReading = requestedFrom === undefined ? readings[readings.indexOf(toReading) - 1] : known(requestedFrom, "--from");
  if (fromReading === undefined) {
    return die(`detect-regressions: "${toReading.id}" is the oldest audit — there is nothing before it to compare against.`);
  }
  if (fromReading === toReading) return die(`detect-regressions: --from and --to name the same audit ("${toReading.id}")`);
  // Order is the whole verdict: `detectRegressions` reads its first argument as
  // the earlier reading, so a hand-swapped pair would silently report a clean
  // run where a real regression exists — a false green in CI.
  if (readings.indexOf(fromReading) > readings.indexOf(toReading)) {
    return die(`detect-regressions: --from "${fromReading.id}" is newer than --to "${toReading.id}" — swap them, or the comparison inverts.`);
  }
  const from = fromReading.id;
  const to = toReading.id;
  /** The audit directory a reading's state runs through: its last member. */
  const lastAuditOf = (reading: AuditReading): string => reading.auditIds[reading.auditIds.length - 1];

  const library = loadEffectiveLibrary(scriptDir, root);
  let regressions: Regression[];
  try {
    // Merged through each audit, as the CLI verb reads them: a scoped re-audit
    // holds only the cells it re-scored, compared with their last reading.
    regressions = detectRegressions(
      loadQualitySectionThrough(root, lastAuditOf(fromReading), library),
      loadQualitySectionThrough(root, lastAuditOf(toReading), library),
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
