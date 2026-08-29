/**
 * `arkaik kritik <verb>` — the quality layer's command surface (RFC § 4.4).
 *
 * Kritik keeps its state in `docs/quality/` sidecars, canonical in a repository
 * exactly as `journal.jsonl` is canonical while a bundle's embedded `journal[]`
 * is only the interchange projection. These verbs read and write those files;
 * the bundle's `quality` section is produced from them, never edited instead of
 * them.
 *
 * What each verb *does* is `@arkaik/schema` — `quality-ops.ts` for the
 * operations, `cli/kritik-audit.ts` for the files, `cli/kritik-overlay.ts` for
 * the overlay. The same functions back the plugin's standalone scripts and the
 * `kritik_*` MCP tools, so the three entry points cannot disagree about what a
 * score is, how a finding is numbered, or what a matrix says. What lives here
 * is only what "being a CLI verb" means: flags, refusals, and printing.
 *
 * Three refusals are deliberately stricter than the validator, which only
 * warns: an unknown criterion, an undeclared surface, and a score with no
 * evidence all fail *here*, before anything is written. The validator has to
 * tolerate data it did not create; a command that is creating it does not, and
 * a typo caught at the keystroke costs nothing where the same typo caught two
 * audits later costs the comparison.
 */

import {
  CROSS_SURFACE_ID,
  DEFAULT_TARGET_LEVEL,
  REMEDIATION_COSTS,
  acceptFinding,
  auditCompletedInput,
  detectRegressions,
  findingOpenedInput,
  findingResolvedInput,
  isOpenFinding,
  mintFindingId,
  orderEvents,
  parseSurfaceSpec,
  priorityOf,
  renderIssue,
  resolveFinding,
  severityOf,
  signalRunSheet,
  signalTrippedInput,
  upsertAssessment,
  upsertFinding,
  type JournalEvent,
  type KritikCriterion,
  type KritikLibrary,
  type MaturityLevel,
  type QualityAssessment,
  type QualityFinding,
  type QualityProfile,
  type Regression,
  type RemediationCost,
  type SurfaceDef,
} from "@arkaik/schema";
import {
  computeAuditMatrix,
  listAuditIds,
  loadFindings,
  loadQualitySection,
  loadScoresOrEmpty,
  locateFinding,
  matrixPath,
  newestAuditId,
  renderMatrixMarkdown,
  requireProfile,
  saveFindings,
  saveScores,
  scoresPath,
} from "@arkaik/schema/src/cli/kritik-audit";
import {
  CRITERION_TEMPLATE,
  addCriterionToOverlay,
  buildCriterion,
  type CriterionDraft,
} from "@arkaik/schema/src/cli/kritik-overlay";
import { loadProfile, profilePath, writeJson } from "@arkaik/schema/src/cli/kritik-paths";
import { existsSync, readFileSync } from "node:fs";
import { KRITIK_ACTOR, appendQualityEvents, loadKritikLibrary, resolveJournal } from "../lib/kritik-io";
import { readFullJournalEvents } from "../lib/journal-io";

const USAGE = `arkaik kritik <subcommand> [options]

Audit this product's quality with the Kritik framework: a maturity level per
criterion per surface backed by evidence, findings carrying risk and cost, and
a comparative matrix whose caps stop one open Critical being averaged into a B.

Subcommands:
  profile               Pick this project's surfaces (writes docs/quality/profile.json).
  score <c> <s> <lvl>   Record one maturity level, with its evidence.
  finding open ...      Open a finding on a (criterion x surface) cell.
  finding resolve <id>  Close it because the fix merged.
  finding accept <id>   Accept it as a known, owned risk.
  matrix [audit-id]     Roll an audit up (writes matrix.json).
  signals               The signal pack, and what has tripped since the last audit.
  regressions           What got worse between two audits.
  issue <criterion>     Print the prefilled GitHub issue skeleton.
  criterion add ...     Add a project-specific criterion to the overlay.

Common options:
  --root <dir>      Repo root holding docs/quality/ (default: the current directory).
  --actor <name>    Who is writing (default: ${KRITIK_ACTOR}). Recorded on every quality.* event.
  --bundle <path>   The Arkaik bundle whose journal receives events
                    (default: docs/arkaik/bundle.json; skipped when absent).
  --no-journal      Write the audit files only; append no journal events.
  -h, --help        Show this help, or a subcommand's.

Run "arkaik kritik <subcommand> --help" for the flags each one takes.`;

const SCORE_USAGE = `arkaik kritik score <criterion> <surface> <level> --evidence <text|@file> [options]

Record one (criterion x surface) maturity level. A cell holds exactly one level,
so re-scoring replaces in place — the correction reads as a correction.

Arguments:
  criterion         A criterion id from the pack or this project's overlay (e.g. SEC-01).
  surface           A surface id declared in docs/quality/profile.json.
  level             0-4. Absent from the file means N/A; 0 means "not addressed".

Options:
  --evidence <e>    file:line / config citations. \`@path\` reads them from a file.
                    Required: a score without a citation is an opinion.
  --audit <id>      The audit run (default: the newest, or the current YYYY-MM).
  --commit <sha>    The commit the evidence is pinned to.

Writes docs/quality/audits/<id>/scores.json`;

const FINDING_USAGE = `arkaik kritik finding <open|resolve|accept> [options]

  open <criterion> <surface> --title <t> --impact <1-5> --likelihood <1-5>
       --cost <S|M|L|XL> --evidence <text|@file> [--detail <d>] [--remediation <r>]
       [--nodes <id,id>] [--issue-url <u>] [--id <finding-id>] [--audit <id>]

    Opens a finding and appends quality.finding.opened. Severity and priority are
    printed, never stored — they are derived from impact x likelihood and cost, so
    they can never drift from the numbers behind them. The surface may be
    "${CROSS_SURFACE_ID}" for a defect that belongs to the contract between surfaces.

  resolve <finding-id> [--by <pr-or-commit-url>]

    Marks it resolved and appends quality.finding.resolved. Searched across every
    audit: a finding opened in 2026-08 is routinely fixed during 2026-09.

  accept <finding-id> --note <why>

    Records it as a known, owned risk. The note is required — an accepted risk is a
    decision and reads like one. No journal event: acceptance is a state of the
    finding, not something that happened to the product.`;

const MATRIX_USAGE = `arkaik kritik matrix [audit-id] [--json] [--record]

Roll one audit up into its comparative matrix and write matrix.json — the only
thing that may write that file.

  audit-id          The audit under docs/quality/audits/ (default: the newest).
  --json            Print matrix.json instead of the markdown table.
  --record          Also append quality.audit.completed, carrying these scores
                    and counts. Do this once per finished audit.`;

const SIGNALS_USAGE = `arkaik kritik signals [--surface <s>] [--criterion <c>] [--domain <CODE>] [--json]
arkaik kritik signals --trip <criterion> --surface <s> --signal <index|text> [--detail <d>]

Signals are the cheap checks between full audits: a grep that must return
nothing, a CI job that must exist. They are statements to check, not commands to
run — the pack spans greps, CI introspection and database queries, so this
prints the run sheet rather than pretending to execute it.

Exits 1 when anything has tripped since the last recorded audit, which is what
makes it usable as a CI step.

  --trip            Record one as tripped: appends quality.signal.tripped.
                    --signal takes the row's index from the run sheet, or the text.
  --json            The full run sheet as JSON (what an agent should read).`;

const REGRESSIONS_USAGE = `arkaik kritik regressions [--from <audit>] [--to <audit>] [--record] [--json]

What got worse between two audits: a cell whose maturity dropped, a cell that
gained an open Critical or High finding, a finding that was resolved and is open
again. Cells scored in only one of the two audits are not compared — a
half-finished audit is not a regression.

Exits 1 when anything regressed, which is what makes it usable as a CI step or a
scheduled routine.

  --from <audit>    The older reading (default: the audit before --to).
  --to <audit>      The newer reading (default: the newest on disk).
  --record          Append one quality.signal.tripped per regression.
  --json            The full list as JSON.`;

const ISSUE_USAGE = `arkaik kritik issue <criterion> --surface <s> [--level <n>] [--finding <id>]

Print the criterion's GitHub issue skeleton, filled as far as what we know
allows. Placeholders we cannot fill are left standing — a skeleton is a form to
finish, and an empty "### Risk" reads as "no risk" where {risk_narrative} reads
as "your turn".

  --level <n>       The observed maturity, so the anchors fill in.
  --finding <id>    Fill the risk numbers, evidence and narrative from a finding.
                    This is the P0/P1 path: the issue exists because a defect does.`;

const CRITERION_USAGE = `arkaik kritik criterion add --id <ID> --domain <CODE> --name <t> --question <q> \\
    --applies-to <s1,s2> --anchor l0=<text> ... --anchor l4=<text> [options]

Add a criterion the pack does not have to this project's overlay
(docs/quality/criteria.custom.json). A pack upgrade never touches it.

  --id              A project-reserved id, e.g. X-01. Never a pack id.
  --domain          Owning domain code — an existing one (SEC, PRV, …) or your own.
  --domain-name     Display name, required only when --domain is a new code.
  --anchor lN=<t>   What each level looks like HERE. All five are required: a
                    criterion scored inconsistently makes its whole row incomparable.
  --weight <1-3>    Weight in the domain roll-up (default 1).
  --impact <1-5>    Seeds finding severity (default 3).
  --signal <s>      A mechanically checkable hook; repeatable.
  --check <s>       A concrete audit step; repeatable.
  --label <s>       An issue label; repeatable (default: quality).
  --from <file>     Read a complete criterion from JSON instead of these flags.
  --template        Print a starting-point criterion and exit.
  --force           Replace an existing criterion with this id.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Options every subcommand accepts, stripped out before its own parsing. */
interface CommonOptions {
  root: string;
  actor: string;
  bundlePath?: string;
  journal: boolean;
}

function takeCommon(args: string[]): { rest: string[]; common: CommonOptions } {
  const rest: string[] = [];
  const common: CommonOptions = { root: process.cwd(), actor: KRITIK_ACTOR, journal: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root") common.root = args[++i] ?? common.root;
    else if (arg === "--actor") common.actor = args[++i] ?? common.actor;
    else if (arg === "--bundle") common.bundlePath = args[++i];
    else if (arg === "--no-journal") common.journal = false;
    else rest.push(arg);
  }
  return { rest, common };
}

/** A tiny flag bag: `--key value` into `single`, repeatables into `many`, bare `--flag` into `flags`. */
function collect(
  args: string[],
  repeatable: readonly string[] = [],
  boolean: readonly string[] = [],
): { single: Record<string, string>; many: Record<string, string[]>; flags: Set<string>; positionals: string[] } {
  const single: Record<string, string> = {};
  const many: Record<string, string[]> = Object.fromEntries(repeatable.map((key) => [key, [] as string[]]));
  const flags = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (boolean.includes(key) || key === "help") {
      flags.add(key);
      continue;
    }
    const value = args[++i];
    if (value === undefined) fail(`kritik: --${key} needs a value`);
    if (key in many) many[key].push(value);
    else single[key] = value;
  }
  return { single, many, flags, positionals };
}

/** `@path` reads from a file; anything else is the text itself. */
function textOrFile(value: string): string {
  if (!value.startsWith("@")) return value;
  const path = value.slice(1);
  if (!existsSync(path)) fail(`kritik: no file at ${path}`);
  return readFileSync(path, "utf8").trim();
}

/** The current month, the audit-id convention the pack and the pilot both use. */
function currentAuditId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The audit to write into: what was asked for, else the newest on disk, else
 * this month. Writers may create an audit; readers may not, which is why they
 * call `newestAuditId` and let it throw.
 */
function auditForWrite(root: string, requested?: string): string {
  if (requested !== undefined) return requested;
  const existing = listAuditIds(root);
  return existing.length > 0 ? existing[existing.length - 1] : currentAuditId();
}

function loadLibraryOrFail(root: string): KritikLibrary {
  try {
    return loadKritikLibrary(root).library;
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}`);
  }
}

function profileOrFail(root: string): QualityProfile {
  try {
    return requireProfile(root);
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}`);
  }
}

/** A criterion id that is actually in the effective library — or the closest ids to it. */
function criterionOrFail(library: KritikLibrary, criterionId: string): KritikCriterion {
  const criterion = (library.criteria ?? []).find((candidate) => candidate.id === criterionId);
  if (!criterion) {
    const domain = criterionId.split("-")[0];
    const siblings = (library.criteria ?? []).filter((c) => c.domain === domain).map((c) => c.id);
    return fail(
      `kritik: no criterion "${criterionId}" in the pack or this project's overlay.\n` +
        (siblings.length > 0
          ? `Criteria in ${domain}: ${siblings.join(", ")}`
          : `Domains: ${(library.domains ?? []).map((d) => d.code).join(", ")}`),
    );
  }
  if (typeof criterion.superseded_by === "string") {
    return fail(
      `kritik: criterion "${criterionId}" is retired — superseded by "${criterion.superseded_by}".\n` +
        `Score that one instead; the old id is kept only so past audits still mean what they meant.`,
    );
  }
  return criterion;
}

/**
 * A surface the profile actually declares. `cross-surface` is accepted only
 * where it is meaningful: findings may carry it, assessments may not, because it
 * has no matrix column for a score to render in.
 */
function surfaceOrFail(profile: QualityProfile, surface: string, options: { allowCrossSurface?: boolean } = {}): string {
  if (surface === CROSS_SURFACE_ID) {
    if (options.allowCrossSurface) return surface;
    return fail(
      `kritik: "${CROSS_SURFACE_ID}" is a findings-only lens — it carries no matrix column, so a score there would render nowhere.`,
    );
  }
  const declared = (profile.surfaces ?? []).map((s: SurfaceDef) => s.id);
  if (!declared.includes(surface)) {
    return fail(
      `kritik: surface "${surface}" is not declared in ${profilePath(".")}.\n` +
        `This project's surfaces: ${declared.join(", ") || "(none — run `arkaik kritik profile` first)"}`,
    );
  }
  return surface;
}

function intOrFail(label: string, value: string | undefined, min: number, max: number): number {
  if (value === undefined) fail(`kritik: ${label} is required\n`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`kritik: ${label} must be an integer ${min}-${max} (got "${value}")`);
  }
  return parsed;
}

/** Report the journal write, or why there wasn't one. */
function reportJournal(
  root: string,
  inputs: ReturnType<typeof findingOpenedInput>[],
  common: CommonOptions,
): void {
  if (!common.journal) {
    console.log(`  journal: skipped (--no-journal)`);
    return;
  }
  const journal = resolveJournal(root, common.bundlePath);
  if (!journal.present) {
    console.log(`  journal: none at ${journal.bundlePath} — Kritik does not need one, so nothing was appended`);
    return;
  }
  const written = appendQualityEvents(root, inputs, { actor: common.actor, bundlePath: common.bundlePath });
  if (written.baseline !== undefined) {
    console.log(`  journal: adopted ${(written.baseline as { node_ids?: string[] }).node_ids?.length ?? 0} pre-existing nodes first`);
  }
  console.log(`  journal: ${written.events.map((e) => e.type).join(", ")} -> ${written.journalPath}`);
}

// --- profile -----------------------------------------------------------------

const PROFILE_USAGE = `arkaik kritik profile --surface <id>[:<title>[:<platform>]] [...] [--weight <CODE>=<n>] [--force]

Pick this project's surfaces — the one decision everything downstream is shaped
by. Each criterion's applies_to intersects this list to produce the audit's
cells, and the matrix has exactly these columns.

  --surface         id[:title[:platform]]. \`platform\` (web|ios|android) is the
                    optional bridge to the product map, for surfaces that ship
                    views. A database contract or a CLI simply has none.
  --weight CODE=n   How hard this product is graded on a domain (default 1).
  --force           Overwrite an existing profile. Changing the surface list
                    invalidates every score recorded against the old one.

Writes docs/quality/profile.json`;

function runProfile(args: string[], common: CommonOptions): void {
  const { many, flags } = collect(args, ["surface", "weight"], ["force"]);
  if (flags.has("help")) {
    console.log(PROFILE_USAGE);
    process.exit(0);
  }

  if (many.surface.length === 0) fail(`kritik: at least one --surface is required\n\n${PROFILE_USAGE}`);

  const surfaces: SurfaceDef[] = [];
  const seen = new Set<string>();
  for (const spec of many.surface) {
    let surface: SurfaceDef;
    try {
      surface = parseSurfaceSpec(spec);
    } catch (error) {
      return fail(`kritik: ${(error as Error).message}`);
    }
    if (seen.has(surface.id)) fail(`kritik: duplicate surface id "${surface.id}"`);
    seen.add(surface.id);
    surfaces.push(surface);
  }

  const weights: Record<string, number> = {};
  for (const spec of many.weight) {
    const at = spec.indexOf("=");
    if (at <= 0) fail(`kritik: --weight wants CODE=number (got "${spec}")`);
    const code = spec.slice(0, at).trim();
    const value = Number(spec.slice(at + 1));
    if (!Number.isFinite(value) || value <= 0) fail(`kritik: weight for "${code}" must be a positive number`);
    weights[code] = value;
  }

  const path = profilePath(common.root);
  if (existsSync(path) && !flags.has("force")) {
    fail(
      `kritik: ${path} already exists.\n` +
        `Changing the surface list invalidates every score recorded against the old one, so this refuses by default.\n` +
        `Pass --force if that is genuinely what you want.`,
    );
  }

  const profile: QualityProfile =
    Object.keys(weights).length > 0 ? { surfaces, domain_weights: weights } : { surfaces };
  writeJson(path, profile);
  console.log(
    `\n  wrote ${path}\n` +
      `  ${surfaces.length} surface${surfaces.length === 1 ? "" : "s"}: ${surfaces.map((s) => s.id).join(", ")}\n` +
      `  ${Object.keys(weights).length > 0 ? `weights: ${Object.entries(weights).map(([k, v]) => `${k}=${v}`).join(" ")}` : "weights: 1 across every domain"}\n`,
  );
  process.exit(0);
}

// --- score -------------------------------------------------------------------

function runScore(args: string[], common: CommonOptions): void {
  const { single, flags, positionals } = collect(args);
  if (flags.has("help")) {
    console.log(SCORE_USAGE);
    process.exit(0);
  }

  const [criterionId, surfaceArg, levelArg] = positionals;
  if (criterionId === undefined || surfaceArg === undefined || levelArg === undefined) {
    fail(`kritik: score takes <criterion> <surface> <level>\n\n${SCORE_USAGE}`);
  }

  const library = loadLibraryOrFail(common.root);
  const profile = profileOrFail(common.root);
  const criterion = criterionOrFail(library, criterionId);
  const surface = surfaceOrFail(profile, surfaceArg);
  const level = intOrFail("level", levelArg, 0, 4) as MaturityLevel;

  // A criterion scored on a surface it does not apply to is a cell that rolls up
  // nowhere — and, worse, one whose absence elsewhere then looks deliberate.
  const appliesTo = criterion.applies_to;
  if (Array.isArray(appliesTo) && !appliesTo.includes(surface)) {
    fail(
      `kritik: ${criterionId} does not apply to "${surface}" (applies to: ${appliesTo.join(", ")}).\n` +
        `Scoring it there would produce a cell nothing rolls up.`,
    );
  }

  if (single.evidence === undefined || single.evidence.trim() === "") {
    fail(`kritik: --evidence is required — a score without a citation is an opinion, not an assessment.\n\n${SCORE_USAGE}`);
  }
  const evidence = textOrFile(single.evidence);

  const auditId = auditForWrite(common.root, single.audit);
  const file = loadScoresOrEmpty(common.root, auditId);
  const assessment: QualityAssessment = {
    criterion_id: criterionId,
    surface,
    level,
    evidence,
    audit_id: auditId,
    ...(single.commit !== undefined ? { commit: single.commit } : {}),
    ts: new Date().toISOString(),
  };
  const { assessments, replaced } = upsertAssessment(file.assessments, assessment);
  saveScores(common.root, auditId, {
    ...file,
    audit_id: auditId,
    framework_version: file.framework_version ?? library.version,
    ...(single.commit !== undefined ? { commit: single.commit } : {}),
    assessments,
  });

  const anchor = criterion.level_anchors?.[`l${level}`];
  console.log(
    `\n  ${replaced ? `re-scored ${criterionId} x ${surface}: ${replaced.level} -> ${level}` : `scored ${criterionId} x ${surface} at ${level}`}` +
      `${anchor ? ` — ${anchor}` : ""}\n` +
      `  ${assessments.length} assessment${assessments.length === 1 ? "" : "s"} in ${auditId} -> ${scoresPath(common.root, auditId)}`,
  );
  if (level < DEFAULT_TARGET_LEVEL) {
    console.log(
      `  below the level-${DEFAULT_TARGET_LEVEL} target — open a finding, or say in the evidence why this surface should not reach it.`,
    );
  }
  console.log("");
  process.exit(0);
}

// --- finding -----------------------------------------------------------------

function runFinding(args: string[], common: CommonOptions): void {
  const [action, ...rest] = args;
  if (action === undefined || action === "--help" || action === "-h") {
    console.log(FINDING_USAGE);
    process.exit(action === undefined ? 1 : 0);
  }
  if (action === "open") return runFindingOpen(rest, common);
  if (action === "resolve") return runFindingResolve(rest, common);
  if (action === "accept") return runFindingAccept(rest, common);
  fail(`kritik: unknown finding action "${action}"\n\n${FINDING_USAGE}`);
}

function runFindingOpen(args: string[], common: CommonOptions): void {
  const { single, flags, positionals } = collect(args);
  if (flags.has("help")) {
    console.log(FINDING_USAGE);
    process.exit(0);
  }

  const [criterionId, surfaceArg] = positionals;
  if (criterionId === undefined || surfaceArg === undefined) {
    fail(`kritik: finding open takes <criterion> <surface>\n\n${FINDING_USAGE}`);
  }

  const library = loadLibraryOrFail(common.root);
  const profile = profileOrFail(common.root);
  criterionOrFail(library, criterionId);
  const surface = surfaceOrFail(profile, surfaceArg, { allowCrossSurface: true });

  if (single.title === undefined || single.title.trim() === "") {
    fail(`kritik: --title is required — one line naming the actual defect, not the category.\n\n${FINDING_USAGE}`);
  }
  if (single.evidence === undefined || single.evidence.trim() === "") {
    fail(`kritik: --evidence is required — file:line citations someone can check.\n\n${FINDING_USAGE}`);
  }
  const impact = intOrFail("--impact", single.impact, 1, 5);
  const likelihood = intOrFail("--likelihood", single.likelihood, 1, 5);
  const cost = single.cost as RemediationCost | undefined;
  if (cost === undefined || !REMEDIATION_COSTS.includes(cost)) {
    fail(
      `kritik: --cost must be one of ${REMEDIATION_COSTS.join(", ")} — it decides priority, ` +
        `so a High that is cheap to fix outranks a High that is not.`,
    );
  }

  const auditId = auditForWrite(common.root, single.audit);
  const file = loadFindings(common.root, auditId);
  const taken = new Set(file.findings.map((f) => f.id));
  const id = single.id ?? mintFindingId(auditId, criterionId, surface, taken, library);
  if (single.id !== undefined && taken.has(single.id)) {
    fail(`kritik: finding "${single.id}" already exists in ${auditId} — resolve or accept it rather than reopening the id.`);
  }

  const nodes = single.nodes?.split(",").map((n) => n.trim()).filter((n) => n !== "");
  const finding: QualityFinding = {
    id,
    criterion_id: criterionId,
    surface,
    title: single.title,
    detail: single.detail ?? single.title,
    evidence: textOrFile(single.evidence),
    impact,
    likelihood,
    cost,
    status: "open",
    ...(single.remediation !== undefined ? { remediation: single.remediation } : {}),
    ...(nodes !== undefined && nodes.length > 0 ? { node_ids: nodes } : {}),
    ...(single["issue-url"] !== undefined ? { issue_url: single["issue-url"] } : {}),
  };

  const { findings } = upsertFinding(file.findings, finding);
  saveFindings(common.root, auditId, {
    ...file,
    audit_id: auditId,
    framework_version: file.framework_version ?? library.version,
    findings,
  });

  const severity = severityOf(finding, library);
  const priority = priorityOf(finding, library);
  console.log(
    `\n  opened ${id} — ${finding.title}\n` +
      `  ${severity} / ${priority} (impact ${impact} x likelihood ${likelihood} = ${impact * likelihood}, cost ${cost}) on ${surface}\n` +
      `  ${findings.length} finding${findings.length === 1 ? "" : "s"} in ${auditId}`,
  );
  reportJournal(common.root, [findingOpenedInput(finding, library)], common);
  if (priority === "P0") {
    console.log(`  P0: file the issue now — \`arkaik kritik issue ${criterionId} --surface ${surface} --finding ${id}\``);
  }
  console.log("");
  process.exit(0);
}

function runFindingResolve(args: string[], common: CommonOptions): void {
  const { single, flags, positionals } = collect(args);
  if (flags.has("help")) {
    console.log(FINDING_USAGE);
    process.exit(0);
  }
  const id = positionals[0];
  if (id === undefined) fail(`kritik: finding resolve takes <finding-id>\n\n${FINDING_USAGE}`);

  const located = locateFinding(common.root, id);
  if (!located) fail(`kritik: no finding "${id}" in any audit under ${common.root}/docs/quality/audits/`);

  if (located.finding.status === "resolved") {
    // Idempotent on purpose: Phase E's webhook will call this on every PR that
    // names the id, and a second call must not append a second event.
    console.log(`\n  ${id} is already resolved — nothing written.\n`);
    process.exit(0);
  }

  const { findings, finding } = resolveFinding(located.file.findings, id, single.by);
  saveFindings(common.root, located.auditId, { ...located.file, findings });

  console.log(`\n  resolved ${id} — ${located.finding.title}` + (single.by ? `\n  by ${single.by}` : ""));
  if (single.by === undefined) {
    console.log(`  no --by: without the PR or commit that closed it, "resolved" means "we stopped looking".`);
  }
  reportJournal(common.root, [findingResolvedInput(finding ?? located.finding, single.by)], common);
  console.log("");
  process.exit(0);
}

function runFindingAccept(args: string[], common: CommonOptions): void {
  const { single, flags, positionals } = collect(args);
  if (flags.has("help")) {
    console.log(FINDING_USAGE);
    process.exit(0);
  }
  const id = positionals[0];
  if (id === undefined) fail(`kritik: finding accept takes <finding-id>\n\n${FINDING_USAGE}`);
  if (single.note === undefined || single.note.trim() === "") {
    fail(`kritik: --note is required — an accepted risk is a decision and reads like one.`);
  }

  const located = locateFinding(common.root, id);
  if (!located) fail(`kritik: no finding "${id}" in any audit under ${common.root}/docs/quality/audits/`);

  const { findings } = acceptFinding(located.file.findings, id, single.note);
  saveFindings(common.root, located.auditId, { ...located.file, findings });

  console.log(
    `\n  accepted ${id} as a known risk — ${located.finding.title}\n` +
      `  ${single.note}\n` +
      `  no journal event: acceptance is a state of the finding, not something that happened to the product.\n`,
  );
  process.exit(0);
}

// --- matrix ------------------------------------------------------------------

function runMatrix(args: string[], common: CommonOptions): void {
  const { flags, positionals } = collect(args, [], ["json", "record"]);
  if (flags.has("help")) {
    console.log(MATRIX_USAGE);
    process.exit(0);
  }

  const library = loadLibraryOrFail(common.root);
  let auditId: string;
  try {
    auditId = positionals[0] ?? newestAuditId(common.root);
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}`);
  }

  let computed: ReturnType<typeof computeAuditMatrix>;
  try {
    computed = computeAuditMatrix(common.root, auditId, library);
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}`);
  }
  const { section, matrix, file } = computed;

  if (flags.has("json")) {
    console.log(JSON.stringify(file, null, 2));
  } else {
    const domainNames = new Map((library.domains ?? []).map((d) => [d.code, d.name]));
    console.log(`\n${renderMatrixMarkdown(matrix, domainNames)}\n`);

    const open = section.findings.filter(isOpenFinding);
    const lanes: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const finding of open) lanes[priorityOf(finding, library)]++;
    const counts = matrix.finding_counts;
    console.log(
      `${section.assessments.length} assessments · ${open.length} open findings ` +
        `(${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low)\n` +
        `lanes: P0 ${lanes.P0} · P1 ${lanes.P1} · P2 ${lanes.P2} · P3 ${lanes.P3}`,
    );

    const p0 = open.filter((finding) => priorityOf(finding, library) === "P0");
    if (p0.length > 0) {
      console.log(`\nP0 — fix first:`);
      for (const finding of p0) {
        console.log(`  [${severityOf(finding, library)}] ${finding.surface} · ${finding.id} — ${finding.title}`);
      }
    }
    console.log(`\nwrote ${matrixPath(common.root, auditId)}`);
  }

  if (flags.has("record")) {
    reportJournal(
      common.root,
      [auditCompletedInput(matrix, { audit_id: auditId, framework_version: file.framework_version, ...(file.commit !== undefined ? { commit: file.commit } : {}) })],
      common,
    );
  }
  console.log("");
  process.exit(0);
}

// --- signals -----------------------------------------------------------------

/** `quality.signal.tripped` events with no `quality.audit.completed` after them. */
function tripsSinceLastAudit(root: string, common: CommonOptions): JournalEvent[] {
  const journal = resolveJournal(root, common.bundlePath);
  if (!journal.present) return [];
  const events = orderEvents(readFullJournalEvents(journal.journalPath));
  const lastAudit = events.map((event) => event.type).lastIndexOf("quality.audit.completed");
  return events.slice(lastAudit + 1).filter((event) => event.type === "quality.signal.tripped");
}

function runSignals(args: string[], common: CommonOptions): void {
  const { single, flags } = collect(args, [], ["json"]);
  if (flags.has("help")) {
    console.log(SIGNALS_USAGE);
    process.exit(0);
  }

  const library = loadLibraryOrFail(common.root);
  const profile = profileOrFail(common.root);

  if (single.trip !== undefined) {
    const criterion = criterionOrFail(library, single.trip);
    if (single.surface === undefined) fail(`kritik: --trip needs --surface`);
    const surface = surfaceOrFail(profile, single.surface);
    if (single.signal === undefined) fail(`kritik: --trip needs --signal (a run-sheet index, or the statement itself)`);
    const signals = criterion.signals ?? [];
    const index = Number(single.signal);
    const signal = Number.isInteger(index) && index >= 0 && index < signals.length ? signals[index] : single.signal;
    console.log(`\n  tripped ${criterion.id} x ${surface}\n  ${signal}`);
    reportJournal(
      common.root,
      [signalTrippedInput({ criterion_id: criterion.id, surface, signal, ...(single.detail !== undefined ? { detail: single.detail } : {}) })],
      common,
    );
    console.log(`  a tripped signal is not a finding — it is the prompt to go look.\n`);
    process.exit(0);
  }

  const filter = {
    ...(single.surface !== undefined ? { surface: surfaceOrFail(profile, single.surface) } : {}),
    ...(single.criterion !== undefined ? { criterion: criterionOrFail(library, single.criterion).id } : {}),
    ...(single.domain !== undefined ? { domain: single.domain } : {}),
  };
  const rows = signalRunSheet(library, profile.surfaces ?? [], filter);
  const trips = tripsSinceLastAudit(common.root, common);

  if (flags.has("json")) {
    console.log(JSON.stringify({ signals: rows, tripped_since_last_audit: trips }, null, 2));
    process.exit(trips.length > 0 ? 1 : 0);
  }

  const filtered = Object.keys(filter).length > 0;
  if (filtered) {
    console.log("");
    let current = "";
    for (const row of rows) {
      const key = `${row.criterion_id} x ${row.surface}`;
      if (key !== current) {
        current = key;
        console.log(`  ${key}`);
      }
      console.log(`    [${row.index}] ${row.signal}`);
    }
    console.log(`\n  ${rows.length} check${rows.length === 1 ? "" : "s"}.`);
  } else {
    // 88 criteria across several surfaces is a four-figure run sheet. Printing it
    // unasked would bury the one line anybody reads — what has already tripped.
    const criteria = new Set(rows.map((row) => row.criterion_id)).size;
    console.log(
      `\n  ${rows.length} checks across ${criteria} criteria and ${(profile.surfaces ?? []).length} surfaces.\n` +
        `  Narrow it (--surface, --criterion, --domain) to read them, or --json to take the lot.` +
        (listAuditIds(common.root).length > 1
          ? `\n  Comparing two audits is \`arkaik kritik regressions\`.`
          : ""),
    );
  }

  if (trips.length > 0) {
    console.log(`\n  tripped since the last recorded audit:`);
    for (const trip of trips) {
      const event = trip as unknown as { criterion_id: string; surface: string; signal: string };
      console.log(`    ${event.criterion_id} x ${event.surface} — ${event.signal}`);
    }
    console.log("");
    process.exit(1);
  }
  console.log("");
  process.exit(0);
}

// --- regressions --------------------------------------------------------------

/** The two audits to compare, or a refusal saying why there is no pair. */
function auditPair(root: string, from?: string, to?: string): { from: string; to: string } {
  const audits = listAuditIds(root);
  if (audits.length < 2) {
    fail(
      `kritik: regressions needs two audits to compare — ` +
        `${audits.length === 0 ? "docs/quality/audits/ holds none" : `only "${audits[0]}" exists`}.\n` +
        `A regression is the difference between two readings; one reading is a baseline.`,
    );
  }
  const known = (id: string): string => {
    if (!audits.includes(id)) fail(`kritik: no audit "${id}" under docs/quality/audits/ (have: ${audits.join(", ")})`);
    return id;
  };
  const newer = to === undefined ? audits[audits.length - 1] : known(to);
  const older = from === undefined ? audits[audits.indexOf(newer) - 1] : known(from);
  if (older === undefined) {
    fail(`kritik: "${newer}" is the oldest audit — there is nothing before it to compare against.`);
  }
  if (older === newer) {
    fail(`kritik: --from and --to name the same audit ("${newer}") — a regression needs two readings.`);
  }
  // Order is the whole verdict: `detectRegressions` reads its first argument as
  // the EARLIER reading, so a hand-swapped pair reports a clean run where a real
  // regression exists — a false green in the CI step this verb exists to be.
  if (audits.indexOf(older) > audits.indexOf(newer)) {
    fail(`kritik: --from "${older}" is newer than --to "${newer}" — swap them, or the comparison inverts.`);
  }
  return { from: older, to: newer };
}

function runRegressions(args: string[], common: CommonOptions): void {
  const { single, flags } = collect(args, [], ["json", "record"]);
  if (flags.has("help")) {
    console.log(REGRESSIONS_USAGE);
    process.exit(0);
  }

  const library = loadLibraryOrFail(common.root);
  profileOrFail(common.root);
  const { from, to } = auditPair(common.root, single.from, single.to);

  let regressions: Regression[];
  try {
    regressions = detectRegressions(
      loadQualitySection(common.root, from, library),
      loadQualitySection(common.root, to, library),
      library,
    );
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}`);
  }

  if (flags.has("json")) {
    console.log(JSON.stringify({ from, to, total: regressions.length, regressions }, null, 2));
  } else if (regressions.length === 0) {
    console.log(`\n  nothing regressed between ${from} and ${to}.\n`);
  } else {
    console.log("");
    for (const regression of regressions) {
      console.log(`  [${regression.kind}] ${regression.criterion_id} x ${regression.surface}`);
      console.log(`    ${regression.detail}`);
    }
    console.log(`\n  ${regressions.length} regression${regressions.length === 1 ? "" : "s"} between ${from} and ${to}.`);
  }

  if (flags.has("record") && regressions.length > 0) {
    reportJournal(
      common.root,
      regressions.map((regression) =>
        signalTrippedInput({
          criterion_id: regression.criterion_id,
          surface: regression.surface,
          signal: regression.signal,
          detail: regression.detail,
        }),
      ),
      common,
    );
    console.log(`  a tripped signal is not a finding — it is the prompt to go look.\n`);
  }

  // Exit 1 on regressions, the same CI contract `signals` already offers.
  process.exit(regressions.length > 0 ? 1 : 0);
}

// --- issue -------------------------------------------------------------------

function runIssue(args: string[], common: CommonOptions): void {
  const { single, flags, positionals } = collect(args);
  if (flags.has("help")) {
    console.log(ISSUE_USAGE);
    process.exit(0);
  }
  const criterionId = positionals[0];
  if (criterionId === undefined) fail(`kritik: issue takes <criterion>\n\n${ISSUE_USAGE}`);
  if (single.surface === undefined) fail(`kritik: --surface is required\n\n${ISSUE_USAGE}`);

  const library = loadLibraryOrFail(common.root);
  const criterion = criterionOrFail(library, criterionId);
  // A profile is not required to render a skeleton — the pack alone can do it,
  // and poking at a criterion before installing Kritik is legitimate. But when
  // there IS one, a typo'd surface becomes a filed issue labelled for a surface
  // this product does not have, which is worse than a refusal.
  const declared = loadProfile(common.root);
  if (declared) surfaceOrFail(declared, single.surface, { allowCrossSurface: true });

  let finding: QualityFinding | undefined;
  if (single.finding !== undefined) {
    const located = locateFinding(common.root, single.finding);
    if (!located) fail(`kritik: no finding "${single.finding}" in any audit`);
    finding = located.finding;
  }

  const rendered = renderIssue(criterion, {
    surface: single.surface,
    ...(single.level !== undefined ? { level: single.level } : {}),
    ...(finding !== undefined ? { finding, library } : {}),
  });
  process.stdout.write(`Title: ${rendered.title}\n`);
  process.stdout.write(`Labels: ${rendered.labels.join(", ")}\n\n`);
  process.stdout.write(`${rendered.body}\n`);
  if (rendered.remediation) process.stdout.write(`\n<!-- Typical remediation: ${rendered.remediation} -->\n`);
  process.exit(0);
}

// --- criterion ---------------------------------------------------------------

function runCriterion(args: string[], common: CommonOptions): void {
  const [action, ...rest] = args;
  if (action === undefined || action === "--help" || action === "-h") {
    console.log(CRITERION_USAGE);
    process.exit(action === undefined ? 1 : 0);
  }
  if (action !== "add") fail(`kritik: unknown criterion action "${action}" (only \`add\`)\n\n${CRITERION_USAGE}`);

  const { single, many, flags } = collect(rest, ["anchor", "signal", "check", "label"], ["template", "force"]);
  if (flags.has("help")) {
    console.log(CRITERION_USAGE);
    process.exit(0);
  }

  const { library: pack } = (() => {
    try {
      const loaded = loadKritikLibrary(common.root);
      return { library: loaded.pack.library };
    } catch (error) {
      return fail(`kritik: ${(error as Error).message}`);
    }
  })();

  if (flags.has("template")) {
    // The criterion shape as a starting point — edit it, then `--from`. Printed
    // rather than written so nothing is created by a look.
    console.log(JSON.stringify(CRITERION_TEMPLATE, null, 2));
    process.exit(0);
  }

  let criterion: KritikCriterion;
  try {
    if (single.from !== undefined) {
      if (!existsSync(single.from)) fail(`kritik: no file at ${single.from}`);
      criterion = JSON.parse(readFileSync(single.from, "utf8")) as KritikCriterion;
    } else {
      const anchors: Record<string, string> = {};
      for (const spec of many.anchor) {
        const at = spec.indexOf("=");
        if (at <= 0) fail(`kritik: --anchor wants lN=<text> (got "${spec}")`);
        anchors[spec.slice(0, at).trim()] = spec.slice(at + 1);
      }
      const draft: CriterionDraft = {
        id: single.id ?? "",
        domain: single.domain ?? "",
        ...(single.subcategory !== undefined ? { subcategory: single.subcategory } : {}),
        name: single.name ?? "",
        question: single.question ?? "",
        ...(single.definition !== undefined ? { definition: single.definition } : {}),
        ...(single.rationale !== undefined ? { rationale: single.rationale } : {}),
        appliesTo: (single["applies-to"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        anchors,
        ...(single.weight !== undefined ? { weight: Number(single.weight) } : {}),
        ...(single.impact !== undefined ? { impact: Number(single.impact) } : {}),
        signals: many.signal,
        checklist: many.check,
        ...(single.remediation !== undefined ? { remediation: single.remediation } : {}),
        labels: many.label,
      };
      criterion = buildCriterion(draft);
    }
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}\n\n${CRITERION_USAGE}`);
  }

  let written: ReturnType<typeof addCriterionToOverlay>;
  try {
    written = addCriterionToOverlay(common.root, pack, criterion, {
      force: flags.has("force"),
      ...(single["domain-name"] !== undefined ? { domainName: single["domain-name"] } : {}),
    });
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}`);
  }

  console.log(
    `\n  ${written.replaced ? "replaced" : "added"} ${criterion.id} (${criterion.domain}) -> ${written.path}\n` +
      `  applies to ${(criterion.applies_to ?? []).join(", ") || "every surface"}` +
      (written.addedDomain !== undefined ? `\n  declared a new domain: ${written.addedDomain}` : "") +
      `\n  it scores and rolls up exactly like a pack criterion — \`arkaik kritik issue ${criterion.id} --surface <s>\`\n`,
  );
  process.exit(0);
}

// --- dispatch ----------------------------------------------------------------

export function runKritik(args: string[]): void {
  const { rest, common } = takeCommon(args);
  const [sub, ...subArgs] = rest;

  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(USAGE);
    process.exit(sub === undefined ? 1 : 0);
  }

  switch (sub) {
    case "profile":
      return runProfile(subArgs, common);
    case "score":
      return runScore(subArgs, common);
    case "finding":
      return runFinding(subArgs, common);
    case "matrix":
      return runMatrix(subArgs, common);
    case "signals":
      return runSignals(subArgs, common);
    case "regressions":
      return runRegressions(subArgs, common);
    case "issue":
      return runIssue(subArgs, common);
    case "criterion":
      return runCriterion(subArgs, common);
    default:
      fail(`kritik: unknown subcommand "${sub}"\n\n${USAGE}`);
  }
}
