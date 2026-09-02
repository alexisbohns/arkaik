/**
 * The `kritik_*` half of the tool catalog (docs/rfcs/kritik.md § 4.4) — the
 * `arkaik kritik` verbs as MCP tools, which is what turns a scheduled agent
 * audit into a monitoring loop: a routine wakes, reads the signal pack, audits
 * what changed since the last audited commit, scores through these tools, and
 * the journal accumulates the quality history the UI renders as trends.
 *
 * **The same code as the CLI.** Every operation here is `@arkaik/schema`'s —
 * `quality-ops.ts`, `cli/kritik-audit.ts` — and the pack and journal seams come
 * from `arkaik/io`, exactly as `store.ts` takes its file IO from there. A score
 * written by an agent and a score written by a person are the same write.
 *
 * **Two stores, one of them without a floor.** Kritik's state lives in
 * `docs/quality/` sidecars, canonical in a repository the way `journal.jsonl`
 * is. A hosted project has no such directory, so these tools exist only in repo
 * mode and say so plainly rather than half-working. That is not a gap: an audit
 * reads the code, and an agent auditing a hosted map has no code to read.
 *
 * **Journal first, sidecar second.** The journal write is the gated one — it
 * runs through `store.persist`, which folds the events into the bundle in
 * memory and refuses the whole thing on a validator error. Doing it first means
 * a refusal leaves nothing behind; doing it second would leave a finding on
 * disk that no event ever announced.
 */

import {
  CROSS_SURFACE_ID,
  FINDING_STATUSES,
  MATURITY_LEVELS,
  REMEDIATION_COSTS,
  acceptFinding,
  auditCompletedInput,
  deriveQualityMatrix,
  detectRegressions,
  findingOpenedInput,
  findingResolvedInput,
  isOpenFinding,
  mintFindingId,
  orderEvents,
  priorityOf,
  renderIssue,
  resolveFinding,
  resolveKritikLibrary,
  severityOf,
  signalRunSheet,
  signalTrippedInput,
  upsertAssessment,
  upsertFinding,
  type AuditState,
  type EventInput,
  type JournalEvent,
  type KritikCriterion,
  type KritikLibrary,
  type MaturityLevel,
  type QualityAssessment,
  type QualityFinding,
  type QualityProfile,
  type QualitySection,
  type Regression,
  type RemediationCost,
} from "@arkaik/schema";
import {
  computeAuditMatrix,
  listAuditIds,
  loadFindings,
  loadQualitySection,
  loadScoresOrEmpty,
  locateFinding,
  newestAuditId,
  requireProfile,
  saveFindings,
  saveScores,
} from "@arkaik/schema/src/cli/kritik-audit";
import { loadProfile } from "@arkaik/schema/src/cli/kritik-paths";
import { loadKritikLibrary, readFullJournalEvents, resolveJournal } from "arkaik/io";
import { ToolError, type ToolDefinition, type ToolHandler } from "./protocol";
import type { LoadedGraph, Store } from "./store";

export interface KritikContext {
  store: Store;
  /**
   * The repo root holding `docs/quality/`, or `undefined` in hosted mode. Set
   * by index.ts from the resolved bundle path, so the audit files and the
   * journal are always halves of the same checkout.
   */
  qualityRoot?: string;
}

/** The repo root Kritik reads, or the refusal that says why there isn't one. */
function rootOf(ctx: KritikContext): string {
  if (ctx.qualityRoot === undefined) {
    throw new ToolError(
      `Kritik runs against a repository's docs/quality/ files, and this session is connected to a hosted project ` +
        `(${ctx.store.describe()}). Point the server at the checkout instead — \`arkaik-mcp --bundle <path>\` — ` +
        `and run the audit where the code is.`,
    );
  }
  return ctx.qualityRoot;
}

/** Hosted quality state: the stored section, already folded by the server. */
function hostedSection(graph: LoadedGraph): { section: QualitySection; library: KritikLibrary | undefined } {
  const section = (graph.loaded.bundle as { quality?: QualitySection }).quality;
  if (section === undefined || !Array.isArray(section.findings)) {
    throw new ToolError(
      "This hosted project has no quality section yet. Run an audit in the repository and `arkaik restore` it — hosted Kritik reads what an audit stored.",
    );
  }
  return { section, library: resolveKritikLibrary(section) };
}

/** Recording belongs to the audit run — the same refusal for every hosted write `kritik_matrix`/`kritik_regressions` might otherwise attempt. */
function refuseHostedRecord(eventType: string): never {
  throw new ToolError(`Recording ${eventType} belongs to the audit run, which reads code. Run the audit where the checkout is.`);
}

/** Open findings, tallied into priority lanes and the P0 shortlist — the piece `kritik_matrix` needs identically in both modes. */
function openFindingsSummary(
  findings: readonly QualityFinding[],
  library: KritikLibrary | undefined,
): {
  open: QualityFinding[];
  lanes: Record<string, number>;
  p0: { id: string; surface: string; criterion_id: string; title: string; severity: string }[];
} {
  const open = findings.filter(isOpenFinding);
  const lanes: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const finding of open) lanes[priorityOf(finding, library)]++;
  const p0 = open
    .filter((finding) => priorityOf(finding, library) === "P0")
    .map((finding) => ({
      id: finding.id,
      surface: finding.surface,
      criterion_id: finding.criterion_id,
      title: finding.title,
      severity: severityOf(finding, library),
    }));
  return { open, lanes, p0 };
}

/**
 * Resolve the `from`/`to` pair for a regression comparison out of a known list
 * of audit ids (ascending), applying the same not-found / too-few / same-audit
 * / inverted-order guards `kritik_regressions` needs in both modes — only the
 * "no audit under X" phrasing and where `audits` itself comes from differ.
 */
function resolveAuditPair(
  audits: readonly string[],
  args: Record<string, unknown>,
  notFoundHint: string,
): { from: string; to: string } {
  if (audits.length < 2) {
    throw new ToolError(
      `regressions needs two audits to compare — ${audits.length === 0 ? `${notFoundHint} holds none` : `only "${audits[0]}" exists`}. ` +
        `A regression is the difference between two readings; one reading is a baseline.`,
    );
  }
  const known = (id: string): string => {
    if (!audits.includes(id)) throw new ToolError(`no audit "${id}" ${notFoundHint} (have: ${audits.join(", ")})`);
    return id;
  };
  const to = typeof args.to === "string" && args.to !== "" ? known(args.to) : audits[audits.length - 1];
  const from = typeof args.from === "string" && args.from !== "" ? known(args.from) : audits[audits.indexOf(to) - 1];
  if (from === undefined) throw new ToolError(`"${to}" is the oldest audit — there is nothing before it to compare against.`);
  if (from === to) throw new ToolError(`from and to name the same audit ("${to}") — a regression needs two readings.`);
  // Order is the whole verdict: a hand-swapped pair reports a clean run where
  // a real regression exists.
  if (audits.indexOf(from) > audits.indexOf(to)) {
    throw new ToolError(`from "${from}" is newer than to "${to}" — swap them, or the comparison inverts.`);
  }
  return { from, to };
}

/** The five-condition filter `kritik_findings` applies identically in both modes. */
function matchesFindingArgs(
  row: { surface: string; status?: string; priority: string; criterion_id: string; id: string },
  args: Record<string, unknown>,
): boolean {
  if (typeof args.surface === "string" && row.surface !== args.surface) return false;
  if (typeof args.status === "string" && (row.status ?? "open") !== args.status) return false;
  if (typeof args.priority === "string" && row.priority !== args.priority) return false;
  if (typeof args.criterion_id === "string" && row.criterion_id !== args.criterion_id) return false;
  if (typeof args.finding_id === "string" && row.id !== args.finding_id) return false;
  return true;
}

function libraryOf(root: string): KritikLibrary {
  try {
    return loadKritikLibrary(root).library;
  } catch (error) {
    throw new ToolError((error as Error).message);
  }
}

function profileOf(root: string): QualityProfile {
  try {
    return requireProfile(root);
  } catch (error) {
    throw new ToolError((error as Error).message);
  }
}

function criterionOf(library: KritikLibrary, criterionId: string): KritikCriterion {
  const criterion = (library.criteria ?? []).find((candidate) => candidate.id === criterionId);
  if (!criterion) {
    const domain = criterionId.split("-")[0];
    const siblings = (library.criteria ?? []).filter((c) => c.domain === domain).map((c) => c.id);
    throw new ToolError(
      `No criterion "${criterionId}" in the pack or this project's overlay.` +
        (siblings.length > 0
          ? ` Criteria in ${domain}: ${siblings.join(", ")}.`
          : ` Domains: ${(library.domains ?? []).map((d) => d.code).join(", ")}.`),
    );
  }
  if (typeof criterion.superseded_by === "string") {
    throw new ToolError(
      `Criterion "${criterionId}" is retired — superseded by "${criterion.superseded_by}". Score that one instead; ` +
        `the old id is kept only so past audits still mean what they meant.`,
    );
  }
  return criterion;
}

function surfaceOf(profile: QualityProfile, surface: string, allowCrossSurface = false): string {
  if (surface === CROSS_SURFACE_ID) {
    if (allowCrossSurface) return surface;
    throw new ToolError(
      `"${CROSS_SURFACE_ID}" is a findings-only lens — it carries no matrix column, so a score there would render nowhere.`,
    );
  }
  const declared = (profile.surfaces ?? []).map((candidate) => candidate.id);
  if (!declared.includes(surface)) {
    throw new ToolError(`Surface "${surface}" is not declared in this project's profile. Declared: ${declared.join(", ")}.`);
  }
  return surface;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolError(`\`${key}\` is required and must be a non-empty string.`);
  }
  return value;
}

function requireInt(args: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolError(`\`${key}\` is required and must be an integer ${min}-${max}.`);
  }
  return value;
}

/** The current month — the audit-id convention the pack and the pilot both use. */
function currentAuditId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** What to write into: the requested audit, else the newest, else this month. */
function auditForWrite(root: string, requested: unknown): string {
  if (typeof requested === "string" && requested !== "") return requested;
  const existing = listAuditIds(root);
  return existing.length > 0 ? existing[existing.length - 1] : currentAuditId();
}

export function buildKritikCatalog(ctx: KritikContext): {
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
} {
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};
  const tool = (definition: ToolDefinition, handler: ToolHandler) => {
    tools.push(definition);
    handlers[definition.name] = handler;
  };

  /**
   * Append quality events through the store's own gated write path — the same
   * `persist` every other write tool uses, with no node or edge change, so the
   * events are stamped with `MCP_ACTOR`, validated, and refused as one unit.
   * A repo whose bundle carries no journal still gets one here, because the MCP
   * server only ever runs against a bundle; the "no journal at all" case the
   * CLI tolerates cannot arise.
   */
  const record = async (graph: LoadedGraph, inputs: readonly EventInput[]): Promise<JournalEvent[]> => {
    if (inputs.length === 0) return [];
    const result = await ctx.store.persist(graph, {}, inputs);
    if (!result.ok) {
      throw new ToolError("Quality event refused by validateBundle — nothing was written.", {
        findings: result.errors,
        warnings: result.warnings,
      });
    }
    return result.events;
  };

  const load = async (): Promise<LoadedGraph> => {
    try {
      return await ctx.store.load();
    } catch (error) {
      throw new ToolError(`Cannot load ${ctx.store.describe()}: ${(error as Error).message}`);
    }
  };

  // ---- Read -----------------------------------------------------------------

  tool(
    {
      name: "kritik_matrix",
      description:
        "The comparative quality matrix: a score and grade per (domain x surface), the weighted roll-up per surface, and open findings by priority lane. Anti-averaging caps are applied — one open Critical caps its cell at D, one open High at B — so a cell full of 3s cannot absorb a live defect. In repo mode this refreshes the audit's matrix.json, and with record=true appends quality.audit.completed; in hosted mode it is a read of the stored quality section (no audit_id/commit — hosted has no audit file) and record is refused — recording belongs to the audit run, which reads code.",
      inputSchema: {
        type: "object",
        properties: {
          audit_id: { type: "string", description: "Default: the newest audit on disk." },
          record: {
            type: "boolean",
            description: "Append quality.audit.completed carrying these scores and counts. Once per finished audit.",
          },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const hosted = ctx.qualityRoot === undefined;
      if (hosted) {
        if (args.record === true) refuseHostedRecord("quality.audit.completed");
        const graph = await load();
        const { section, library } = hostedSection(graph);
        const m = deriveQualityMatrix({ quality: section }, library);
        const { open, lanes, p0 } = openFindingsSummary(section.findings, library);
        // Normalized to the SAME flat shape repo mode's `...file` spread
        // produces (matrix = the cell grid, overall/finding_counts siblings of
        // it) — audit_id/commit are legitimately absent, hosted has no audit
        // file to carry them.
        return {
          ...(m.framework_version !== undefined ? { framework_version: m.framework_version } : {}),
          matrix: m.matrix,
          overall: m.overall,
          finding_counts: m.finding_counts,
          assessment_count: section.assessments.length,
          open_findings: open.length,
          lanes,
          p0,
          events: [] as JournalEvent[],
        };
      }

      const root = rootOf(ctx);
      const library = libraryOf(root);
      let auditId: string;
      try {
        auditId = typeof args.audit_id === "string" && args.audit_id !== "" ? args.audit_id : newestAuditId(root);
      } catch (error) {
        throw new ToolError((error as Error).message);
      }

      let computed: ReturnType<typeof computeAuditMatrix>;
      try {
        computed = computeAuditMatrix(root, auditId, library);
      } catch (error) {
        throw new ToolError((error as Error).message);
      }
      const { section, matrix, file } = computed;

      const { open, lanes, p0 } = openFindingsSummary(section.findings, library);

      let events: JournalEvent[] = [];
      if (args.record === true) {
        const graph = await load();
        events = await record(graph, [
          auditCompletedInput(matrix, {
            audit_id: auditId,
            framework_version: file.framework_version,
            ...(file.commit !== undefined ? { commit: file.commit } : {}),
          }),
        ]);
      }

      return {
        ...file,
        assessment_count: section.assessments.length,
        open_findings: open.length,
        lanes,
        p0,
        events,
      };
    },
  );

  tool(
    {
      name: "kritik_findings",
      description:
        "Findings, with their derived severity and priority. Filter by surface, status, priority, criterion, or finding id. Severity and priority are computed from impact x likelihood and cost on every read — they are never stored, so they cannot drift from the numbers behind them. Repo mode reads across every audit under docs/quality/audits/, filterable by audit_id; hosted findings are a single living pool with no audit_id partition.",
      inputSchema: {
        type: "object",
        properties: {
          surface: { type: "string" },
          status: { type: "string", enum: [...FINDING_STATUSES] },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          criterion_id: { type: "string" },
          finding_id: { type: "string" },
          audit_id: { type: "string", description: "Default: every audit. Not valid in hosted mode." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const hosted = ctx.qualityRoot === undefined;
      if (hosted) {
        if (typeof args.audit_id === "string" && args.audit_id !== "") {
          throw new ToolError("Hosted findings are a living pool — audit_id does not partition them (issue #400 decision 3).");
        }
        const graph = await load();
        const { section, library } = hostedSection(graph);
        const rows = section.findings.map((finding) => ({
          ...finding,
          severity: severityOf(finding, library),
          priority: priorityOf(finding, library),
        }));
        const matches = rows.filter((row) => matchesFindingArgs(row, args));
        return { total: matches.length, findings: matches };
      }

      const root = rootOf(ctx);
      const library = libraryOf(root);
      const auditIds = typeof args.audit_id === "string" && args.audit_id !== "" ? [args.audit_id] : listAuditIds(root);

      const rows = auditIds.flatMap((auditId) =>
        loadFindings(root, auditId).findings.map((finding) => ({
          ...finding,
          audit_id: auditId,
          severity: severityOf(finding, library),
          priority: priorityOf(finding, library),
        })),
      );
      const matches = rows.filter((row) => matchesFindingArgs(row, args));
      return { total: matches.length, findings: matches };
    },
  );

  tool(
    {
      name: "kritik_signals",
      description:
        "The signal pack: every applicable criterion's mechanically checkable statements, expanded across the surfaces it applies to, plus anything that has tripped since the last recorded audit. These are statements to CHECK, not commands to run — a grep that must return nothing, a CI job that must exist — so run them yourself and report what failed with kritik_trip_signal.",
      inputSchema: {
        type: "object",
        properties: {
          surface: { type: "string" },
          criterion_id: { type: "string" },
          domain: { type: "string", description: "Domain code, e.g. SEC." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const root = rootOf(ctx);
      const library = libraryOf(root);
      const profile = profileOf(root);
      const filter = {
        ...(typeof args.surface === "string" ? { surface: surfaceOf(profile, args.surface) } : {}),
        ...(typeof args.criterion_id === "string" ? { criterion: criterionOf(library, args.criterion_id).id } : {}),
        ...(typeof args.domain === "string" ? { domain: args.domain } : {}),
      };
      const rows = signalRunSheet(library, profile.surfaces ?? [], filter);

      // "Since the last audit" is the window that matters: a trip recorded
      // before the audit that followed it has already been folded into a score.
      const journal = resolveJournal(root);
      const events = journal.present ? orderEvents(readFullJournalEvents(journal.journalPath)) : [];
      const lastAudit = events.map((event) => event.type).lastIndexOf("quality.audit.completed");
      const tripped = events.slice(lastAudit + 1).filter((event) => event.type === "quality.signal.tripped");

      return { library_version: library.version, total: rows.length, signals: rows, tripped_since_last_audit: tripped };
    },
  );

  tool(
    {
      name: "kritik_regressions",
      description:
        "What got worse between two audits: a cell whose maturity level dropped, a cell that gained an open Critical or High finding, and a finding that was resolved and is open again. Cells scored in only one of the two audits are not compared — a half-finished audit is not a regression. With record=true, appends one quality.signal.tripped per regression (repo mode only — hosted comparisons are read-only and cover assessment-level drops, since hosted findings are a living pool rather than per-audit snapshots). A tripped signal is NOT a finding; it is the prompt to go look.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "The older audit. Default: the audit before `to`." },
          to: { type: "string", description: "The newer audit. Default: the newest on disk." },
          record: { type: "boolean", description: "Append one quality.signal.tripped per regression." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const hosted = ctx.qualityRoot === undefined;
      if (hosted) {
        if (args.record === true) refuseHostedRecord("quality.signal.tripped");
        const graph = await load();
        const { section, library } = hostedSection(graph);
        const grouped = new Map<string, QualityAssessment[]>();
        for (const assessment of section.assessments) {
          if (typeof assessment.audit_id !== "string" || assessment.audit_id === "") continue;
          const bucket = grouped.get(assessment.audit_id);
          if (bucket) bucket.push(assessment);
          else grouped.set(assessment.audit_id, [assessment]);
        }
        const audits = [...grouped.keys()].sort();
        const { from, to } = resolveAuditPair(audits, args, "in this project's assessments");

        // Both sides share the same living pool of findings (issue #400
        // decision 3), so finding-based regression kinds cannot fire here: a
        // severe finding already open before `from` suppresses new-severe, and
        // a finding's status is identical on both sides so reopened cannot
        // fire either. Only the assessment-level level-drop kind is honest to
        // report against a single pool of findings.
        const fromState: AuditState = { assessments: grouped.get(from) ?? [], findings: section.findings };
        const toState: AuditState = { assessments: grouped.get(to) ?? [], findings: section.findings };

        let regressions: Regression[];
        try {
          regressions = detectRegressions(fromState, toState, library);
        } catch (error) {
          throw new ToolError((error as Error).message);
        }

        return {
          from,
          to,
          total: regressions.length,
          regressions,
          events: [] as JournalEvent[],
          note: "hosted comparison covers assessment level drops only — findings are a living pool (issue #400 decision 3)",
        };
      }

      const root = rootOf(ctx);
      const library = libraryOf(root);
      const audits = listAuditIds(root);
      const { from, to } = resolveAuditPair(audits, args, "under docs/quality/audits/");

      let regressions: Regression[];
      try {
        regressions = detectRegressions(
          loadQualitySection(root, from, library),
          loadQualitySection(root, to, library),
          library,
        );
      } catch (error) {
        throw new ToolError((error as Error).message);
      }

      let events: JournalEvent[] = [];
      if (args.record === true && regressions.length > 0) {
        const graph = await load();
        events = await record(
          graph,
          regressions.map((regression) =>
            signalTrippedInput({
              criterion_id: regression.criterion_id,
              surface: regression.surface,
              signal: regression.signal,
              detail: regression.detail,
            }),
          ),
        );
      }

      return { from, to, total: regressions.length, regressions, events };
    },
  );

  tool(
    {
      name: "kritik_issue",
      description:
        "The criterion's GitHub issue skeleton, filled as far as what is known allows. Placeholders that cannot be filled are left standing — a skeleton is a form to finish, and an empty '### Risk' reads as 'no risk'. Pass finding_id for the P0/P1 path: the risk numbers, evidence and narrative come from the finding.",
      inputSchema: {
        type: "object",
        properties: {
          criterion_id: { type: "string" },
          surface: { type: "string" },
          level: { type: "integer", minimum: 0, maximum: 4, description: "The observed maturity, so the anchors fill in." },
          finding_id: { type: "string" },
        },
        required: ["criterion_id", "surface"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const hosted = ctx.qualityRoot === undefined;
      if (hosted) {
        const graph = await load();
        const { section, library } = hostedSection(graph);
        if (library === undefined) {
          throw new ToolError("This hosted project's quality section carries no criteria vocabulary — no embedded library and no scored criteria to synthesize one from.");
        }
        const criterion = criterionOf(library, requireString(args, "criterion_id"));
        const surface = requireString(args, "surface");
        if (section.profile) surfaceOf(section.profile, surface, true);

        let finding: QualityFinding | undefined;
        if (typeof args.finding_id === "string" && args.finding_id !== "") {
          finding = section.findings.find((candidate) => candidate.id === args.finding_id);
          if (!finding) throw new ToolError(`No finding "${args.finding_id}" in this hosted project's quality section.`);
        }

        return renderIssue(criterion, {
          surface,
          ...(typeof args.level === "number" ? { level: args.level } : {}),
          ...(finding !== undefined ? { finding, library } : {}),
        });
      }

      const root = rootOf(ctx);
      const library = libraryOf(root);
      const criterion = criterionOf(library, requireString(args, "criterion_id"));
      const surface = requireString(args, "surface");
      // Rendering needs only the pack, so no profile is required — but where one
      // exists, a typo'd surface becomes a filed issue labelled for a surface
      // this product does not have.
      const declared = loadProfile(root);
      if (declared) surfaceOf(declared, surface, true);

      let finding: QualityFinding | undefined;
      if (typeof args.finding_id === "string" && args.finding_id !== "") {
        const located = locateFinding(root, args.finding_id);
        if (!located) throw new ToolError(`No finding "${args.finding_id}" in any audit.`);
        finding = located.finding;
      }

      return renderIssue(criterion, {
        surface,
        ...(typeof args.level === "number" ? { level: args.level } : {}),
        ...(finding !== undefined ? { finding, library } : {}),
      });
    },
  );

  // ---- Write ----------------------------------------------------------------

  tool(
    {
      name: "kritik_score",
      description:
        "Record one (criterion x surface) maturity level with the evidence behind it. A cell holds exactly one level, so re-scoring replaces in place. Evidence is required: a score without a citation is an opinion, not an assessment. Score what the code IS, never what an open PR promises — that is what makes a trend real.",
      inputSchema: {
        type: "object",
        properties: {
          criterion_id: { type: "string" },
          surface: { type: "string" },
          level: {
            type: "integer",
            enum: [...MATURITY_LEVELS],
            description: "0 Absent · 1 Ad-hoc · 2 Defined · 3 Managed · 4 Verified. N/A is the absence of the row, not a level.",
          },
          evidence: { type: "string", description: "file:line / config citations, markdown." },
          audit_id: { type: "string", description: "Default: the newest audit, or the current YYYY-MM." },
          commit: { type: "string" },
        },
        required: ["criterion_id", "surface", "level", "evidence"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const root = rootOf(ctx);
      const library = libraryOf(root);
      const profile = profileOf(root);
      const criterionId = requireString(args, "criterion_id");
      const criterion = criterionOf(library, criterionId);
      const surface = surfaceOf(profile, requireString(args, "surface"));
      const level = requireInt(args, "level", 0, 4) as MaturityLevel;
      const evidence = requireString(args, "evidence");

      const appliesTo = criterion.applies_to;
      if (Array.isArray(appliesTo) && !appliesTo.includes(surface)) {
        throw new ToolError(
          `${criterionId} does not apply to "${surface}" (applies to: ${appliesTo.join(", ")}). ` +
            `Scoring it there would produce a cell nothing rolls up.`,
        );
      }

      const auditId = auditForWrite(root, args.audit_id);
      const file = loadScoresOrEmpty(root, auditId);
      const assessment: QualityAssessment = {
        criterion_id: criterionId,
        surface,
        level,
        evidence,
        audit_id: auditId,
        ...(typeof args.commit === "string" ? { commit: args.commit } : {}),
        ts: new Date().toISOString(),
      };
      const { assessments, replaced } = upsertAssessment(file.assessments, assessment);
      saveScores(root, auditId, {
        ...file,
        audit_id: auditId,
        framework_version: file.framework_version ?? library.version,
        ...(typeof args.commit === "string" ? { commit: args.commit } : {}),
        assessments,
      });

      return {
        assessment,
        audit_id: auditId,
        assessment_count: assessments.length,
        ...(replaced !== undefined ? { replaced_level: replaced.level } : {}),
        anchor: criterion.level_anchors?.[`l${level}`],
      };
    },
  );

  tool(
    {
      name: "kritik_open_finding",
      description:
        "Open a finding on a (criterion x surface) cell and append quality.finding.opened. One finding is one defect — not one criterion, and not one surface's worth of grumbling. Verify Critical and High adversarially BEFORE opening: try to refute them against the repo, and record the verdict. Severity and priority come back derived; they are never stored.",
      inputSchema: {
        type: "object",
        properties: {
          criterion_id: { type: "string" },
          surface: { type: "string", description: `A profile surface, or "${CROSS_SURFACE_ID}" for a defect belonging to the contract between surfaces.` },
          title: { type: "string", description: "One line naming the actual defect, not the category." },
          detail: { type: "string", description: "What breaks, for whom, and the path that gets there. Defaults to the title." },
          evidence: { type: "string", description: "file:line citations someone can check." },
          impact: { type: "integer", minimum: 1, maximum: 5, description: "Worst plausible consequence." },
          likelihood: { type: "integer", minimum: 1, maximum: 5, description: "Probability it materializes." },
          cost: { type: "string", enum: [...REMEDIATION_COSTS], description: "S <= half day · M <= 2 days · L <= 1 week · XL beyond." },
          remediation: { type: "string" },
          node_ids: { type: "array", items: { type: "string" }, description: "Product-graph nodes this is about." },
          issue_url: { type: "string" },
          verification: {
            type: "object",
            properties: {
              verdict: { type: "string", enum: ["CONFIRMED", "REFUTED", "DOWNGRADED"] },
              note: { type: "string" },
            },
            required: ["verdict"],
            additionalProperties: false,
            description: "The adversarial pass. A refuted finding is disclosed, not deleted — open it with status refuted.",
          },
          audit_id: { type: "string" },
          finding_id: { type: "string", description: "Default: minted as F-<audit>-<DOMAIN>-<surface>-NN." },
        },
        required: ["criterion_id", "surface", "title", "evidence", "impact", "likelihood", "cost"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const root = rootOf(ctx);
      const library = libraryOf(root);
      const profile = profileOf(root);
      const criterionId = requireString(args, "criterion_id");
      criterionOf(library, criterionId);
      const surface = surfaceOf(profile, requireString(args, "surface"), true);
      const title = requireString(args, "title");
      const evidence = requireString(args, "evidence");
      const impact = requireInt(args, "impact", 1, 5);
      const likelihood = requireInt(args, "likelihood", 1, 5);
      const cost = requireString(args, "cost") as RemediationCost;
      if (!REMEDIATION_COSTS.includes(cost)) {
        throw new ToolError(`\`cost\` must be one of ${REMEDIATION_COSTS.join(", ")} — it decides priority.`);
      }

      const auditId = auditForWrite(root, args.audit_id);
      const file = loadFindings(root, auditId);
      const taken = new Set(file.findings.map((candidate) => candidate.id));
      const requestedId = typeof args.finding_id === "string" && args.finding_id !== "" ? args.finding_id : undefined;
      if (requestedId !== undefined && taken.has(requestedId)) {
        throw new ToolError(`Finding "${requestedId}" already exists in ${auditId} — resolve or accept it rather than reopening the id.`);
      }
      const id = requestedId ?? mintFindingId(auditId, criterionId, surface, taken, library);

      const nodeIds = Array.isArray(args.node_ids)
        ? (args.node_ids as unknown[]).filter((value): value is string => typeof value === "string")
        : undefined;
      const verification = args.verification as QualityFinding["verification"] | undefined;
      const finding: QualityFinding = {
        id,
        criterion_id: criterionId,
        surface,
        title,
        detail: typeof args.detail === "string" && args.detail !== "" ? args.detail : title,
        evidence,
        impact,
        likelihood,
        cost,
        status: verification?.verdict === "REFUTED" ? "refuted" : "open",
        ...(typeof args.remediation === "string" ? { remediation: args.remediation } : {}),
        ...(nodeIds !== undefined && nodeIds.length > 0 ? { node_ids: nodeIds } : {}),
        ...(typeof args.issue_url === "string" ? { issue_url: args.issue_url } : {}),
        ...(verification !== undefined ? { verification } : {}),
      };

      // A refuted finding is disclosed, never announced: it stays in the file so
      // a reader learns what was checked and dismissed, but nothing was found, so
      // no `finding.opened` goes into the history.
      const graph = await load();
      const events = await record(graph, finding.status === "refuted" ? [] : [findingOpenedInput(finding, library)]);

      const { findings } = upsertFinding(file.findings, finding);
      saveFindings(root, auditId, {
        ...file,
        audit_id: auditId,
        framework_version: file.framework_version ?? library.version,
        findings,
      });

      return {
        finding,
        audit_id: auditId,
        severity: severityOf(finding, library),
        priority: priorityOf(finding, library),
        finding_count: findings.length,
        events,
      };
    },
  );

  tool(
    {
      name: "kritik_resolve_finding",
      description:
        "Close a finding because the fix merged, and append quality.finding.resolved. `resolved_by` is the PR or commit URL — the evidence it is actually gone, which is the only thing separating 'resolved' from 'we stopped looking'. Idempotent: resolving an already-resolved finding writes nothing.",
      inputSchema: {
        type: "object",
        properties: {
          finding_id: { type: "string" },
          resolved_by: { type: "string", description: "The PR or commit URL that closed it." },
        },
        required: ["finding_id"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const root = rootOf(ctx);
      const id = requireString(args, "finding_id");
      const located = locateFinding(root, id);
      if (!located) throw new ToolError(`No finding "${id}" in any audit under docs/quality/audits/.`);
      if (located.finding.status === "resolved") {
        return { finding: located.finding, audit_id: located.auditId, events: [], note: "Already resolved — nothing written." };
      }

      const resolvedBy = typeof args.resolved_by === "string" && args.resolved_by !== "" ? args.resolved_by : undefined;
      const graph = await load();
      const events = await record(graph, [findingResolvedInput(located.finding, resolvedBy)]);

      const { findings, finding } = resolveFinding(located.file.findings, id, resolvedBy);
      saveFindings(root, located.auditId, { ...located.file, findings });
      return { finding, audit_id: located.auditId, events };
    },
  );

  tool(
    {
      name: "kritik_accept_finding",
      description:
        "Record a finding as a known, owned risk. The note is required — an accepted risk is a decision and reads like one, and the findings board renders it as a decision-log entry. No journal event: acceptance is a state of the finding, not something that happened to the product.",
      inputSchema: {
        type: "object",
        properties: {
          finding_id: { type: "string" },
          note: { type: "string", description: "Why this risk is accepted, and by what reasoning." },
        },
        required: ["finding_id", "note"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const root = rootOf(ctx);
      const id = requireString(args, "finding_id");
      const note = requireString(args, "note");
      const located = locateFinding(root, id);
      if (!located) throw new ToolError(`No finding "${id}" in any audit under docs/quality/audits/.`);

      const { findings, finding } = acceptFinding(located.file.findings, id, note);
      saveFindings(root, located.auditId, { ...located.file, findings });
      return { finding, audit_id: located.auditId, events: [] };
    },
  );

  tool(
    {
      name: "kritik_trip_signal",
      description:
        "Record that a monitoring signal failed between audits: appends quality.signal.tripped. A tripped signal is NOT a finding — it is the prompt to go look. Cheap, frequent, and allowed to be wrong, where a finding is expensive, rare, and has survived an adversarial pass.",
      inputSchema: {
        type: "object",
        properties: {
          criterion_id: { type: "string" },
          surface: { type: "string" },
          signal: { type: "string", description: "The statement that failed, or its index in the criterion's signals[]." },
          detail: { type: "string", description: "What you actually observed." },
        },
        required: ["criterion_id", "surface", "signal"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const root = rootOf(ctx);
      const library = libraryOf(root);
      const profile = profileOf(root);
      const criterion = criterionOf(library, requireString(args, "criterion_id"));
      const surface = surfaceOf(profile, requireString(args, "surface"));
      const raw = requireString(args, "signal");

      const signals = criterion.signals ?? [];
      const index = Number(raw);
      const signal = Number.isInteger(index) && index >= 0 && index < signals.length ? signals[index] : raw;

      const graph = await load();
      const events = await record(graph, [
        signalTrippedInput({
          criterion_id: criterion.id,
          surface,
          signal,
          ...(typeof args.detail === "string" ? { detail: args.detail } : {}),
        }),
      ]);
      return { criterion_id: criterion.id, surface, signal, events };
    },
  );

  return { tools, handlers };
}
