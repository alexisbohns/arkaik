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
  findingOpenedInput,
  findingResolvedInput,
  isOpenFinding,
  mintFindingId,
  orderEvents,
  priorityOf,
  renderIssue,
  resolveFinding,
  severityOf,
  signalRunSheet,
  signalTrippedInput,
  upsertAssessment,
  upsertFinding,
  type EventInput,
  type JournalEvent,
  type KritikCriterion,
  type KritikLibrary,
  type MaturityLevel,
  type QualityAssessment,
  type QualityFinding,
  type QualityProfile,
  type RemediationCost,
} from "@arkaik/schema";
import {
  computeAuditMatrix,
  listAuditIds,
  loadFindings,
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
        "The comparative quality matrix for one audit: a score and grade per (domain x surface), the weighted roll-up per surface, and open findings by priority lane. Anti-averaging caps are applied — one open Critical caps its cell at D, one open High at B — so a cell full of 3s cannot absorb a live defect. Refreshes the audit's matrix.json, and with record=true appends quality.audit.completed.",
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

      const open = section.findings.filter(isOpenFinding);
      const lanes: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
      for (const finding of open) lanes[priorityOf(finding, library)]++;

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
        p0: open
          .filter((finding) => priorityOf(finding, library) === "P0")
          .map((finding) => ({
            id: finding.id,
            surface: finding.surface,
            criterion_id: finding.criterion_id,
            title: finding.title,
            severity: severityOf(finding, library),
          })),
        events,
      };
    },
  );

  tool(
    {
      name: "kritik_findings",
      description:
        "Findings across every audit, with their derived severity and priority. Filter by surface, status, priority, or criterion. Severity and priority are computed from impact x likelihood and cost on every read — they are never stored, so they cannot drift from the numbers behind them.",
      inputSchema: {
        type: "object",
        properties: {
          surface: { type: "string" },
          status: { type: "string", enum: [...FINDING_STATUSES] },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          criterion_id: { type: "string" },
          audit_id: { type: "string", description: "Default: every audit." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
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
      const matches = rows.filter((row) => {
        if (typeof args.surface === "string" && row.surface !== args.surface) return false;
        if (typeof args.status === "string" && (row.status ?? "open") !== args.status) return false;
        if (typeof args.priority === "string" && row.priority !== args.priority) return false;
        if (typeof args.criterion_id === "string" && row.criterion_id !== args.criterion_id) return false;
        return true;
      });
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
