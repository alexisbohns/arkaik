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
 * is. A hosted project has no such directory — instead it reads the quality
 * section the server folds from the journal, and transitions findings, scores
 * and scoped completions by posting journal events to the host (issue #400,
 * #473). What stays repo-only is `kritik_signals`, `kritik_trip_signal` and
 * `kritik_open_finding` — a signal is checked against the repo, and a new
 * finding cites code an agent auditing a hosted map has no checkout to read
 * against. `kritik_score` and `kritik_matrix record=true` join the hosted
 * tools, scoped-only: a hosted session can score and record the cells a fix
 * made stale — `kritik_scope`'s list — because that is still reading code,
 * just not writing a sidecar. A hosted session refuses a COMPREHENSIVE audit
 * not because the server couldn't take it, but because that is its own
 * design — batching, review, a different lifecycle — rather than a narrower
 * version of this one. And the scope check itself is a workflow guard, not an
 * access control: any `graph:write` caller may resolve a finding and then
 * score its cell in the same batch, widening its own scope as it goes (see
 * `quality-events.ts`'s `planQualityEvents`). Those three tools say so
 * plainly rather than half-working; every other tool works in both modes.
 *
 * **Journal first, sidecar second.** In repo mode, the journal write is the
 * gated one — it runs through `store.persist`, which folds the events into
 * the bundle in memory and refuses the whole thing on a validator error. Doing
 * it first means a refusal leaves nothing behind; doing it second would leave
 * a finding on disk that no event ever announced. Hosted writes have no
 * sidecar at all — the journal event is the only thing written, and the
 * server's fold is the read.
 */

import {
  CROSS_SURFACE_ID,
  FINDING_STATUSES,
  MATURITY_LEVELS,
  REMEDIATION_COSTS,
  acceptFinding,
  acceptedDetail,
  auditCompletedInput,
  deriveAuditScope,
  deriveQualityMatrix,
  deriveQualityTrend,
  detectRegressions,
  findingOpenedInput,
  findingResolvedInput,
  isOpenFinding,
  mintFindingId,
  orderEvents,
  priorityOf,
  recordedAuditIds,
  renderIssue,
  resolveFinding,
  resolveKritikLibrary,
  scopeSummary,
  severityOf,
  signalRunSheet,
  signalTrippedInput,
  trendRows,
  upsertAssessment,
  upsertFinding,
  withImplicitBaseline,
  type AuditCompletedScope,
  type AuditScope,
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
  type ScopeCell,
} from "@arkaik/schema";
import {
  computeAuditMatrix,
  listAuditIds,
  loadCurrentQualitySection,
  loadFindings,
  loadQualitySectionThrough,
  loadScoresOrEmpty,
  locateFinding,
  newestAuditId,
  requireProfile,
  saveFindings,
  saveScores,
  auditOrderNote,
  declaredScopeSince,
  scopedAuditTarget,
} from "@arkaik/schema/src/cli/kritik-audit";
import { loadProfile } from "@arkaik/schema/src/cli/kritik-paths";
import { loadKritikLibrary, readFullJournalEvents, resolveJournal } from "arkaik/io";
import { ToolError, type ToolDefinition, type ToolHandler } from "./protocol";
import type { HostedQualityInput, LoadedGraph, QualityEventRefusal, Store } from "./store";

export interface KritikContext {
  store: Store;
  /**
   * The repo root holding `docs/quality/`, or `undefined` in hosted mode. Set
   * by index.ts from the resolved bundle path, so the audit files and the
   * journal are always halves of the same checkout.
   */
  qualityRoot?: string;
}

/** The repo root, or the refusal explaining what genuinely needs a checkout. */
function repoRootOf(ctx: KritikContext, needs: string): string {
  if (ctx.qualityRoot === undefined) {
    throw new ToolError(
      `${needs} This session is connected to a hosted project (${ctx.store.describe()}); ` +
        `run it where the checkout is — \`arkaik-mcp --bundle <path>\`.`,
    );
  }
  return ctx.qualityRoot;
}

/** Repo-mode branch reached only after the hosted case above has already returned — the refusal text is never shown. */
const REPO_MODE_ONLY = "Repo-mode reads come from docs/quality/ files.";

/**
 * Hosted status transitions go through the server, which owns the openness
 * verdict (post-fold) — so this does no client-side pre-checking beyond the
 * resolve idempotency case, and surfaces the server's refusal verbatim.
 */
async function appendHosted(store: Store, inputs: readonly HostedQualityInput[]): Promise<JournalEvent[]> {
  if (store.appendQualityEvents === undefined) {
    throw new ToolError(`${store.describe()} cannot append quality events.`);
  }
  try {
    return await store.appendQualityEvents(inputs);
  } catch (error) {
    throw new ToolError((error as Error).message);
  }
}

/** Hosted quality state: the stored section, already folded by the server. */
/**
 * The hint a hosted session gives when there is nothing to measure from. Repo
 * mode points at `kritik_matrix record=true`; a hosted one would refuse (it
 * records a scoped re-audit, which needs an audit to measure from), so a
 * hosted agent is sent to the repository instead of round in a loop.
 */
const NO_HOSTED_AUDIT =
  "This hosted project has no audit to measure from. One must be run in the repository and restored (`arkaik restore`) first — a hosted session cannot write one.";

function hostedSection(graph: LoadedGraph): { section: QualitySection; library: KritikLibrary | undefined } {
  const section = (graph.loaded.bundle as { quality?: QualitySection }).quality;
  // Both arrays are required by the section schema; checking both here means
  // no caller downstream dereferences one this function never vouched for.
  if (section === undefined || !Array.isArray(section.findings) || !Array.isArray(section.assessments)) {
    throw new ToolError(
      "This hosted project has no quality section yet. Run an audit in the repository and `arkaik restore` it — hosted Kritik reads what an audit stored.",
    );
  }
  return { section, library: resolveKritikLibrary(section) };
}

/** Recording belongs to the audit run — the same refusal `kritik_regressions` still uses for `quality.signal.tripped` (recording a completion is `kritik_matrix`'s own hosted path, issue #473). */
function refuseHostedRecord(eventType: string): never {
  throw new ToolError(`Recording ${eventType} belongs to the audit run, which reads code. Run the audit where the checkout is.`);
}

/**
 * The hosted matrix, flat like repo mode's `...file` spread — the shape
 * `kritik_matrix` returns from a plain read AND, with `audit_id`/`scope`/
 * `left_unscored`/`events` layered on top, from a `record=true` completion.
 * Read fresh from whatever `graph` is passed in, so a caller that just wrote
 * a completion can reload and hand this the post-write graph.
 */
function hostedMatrixRead(graph: LoadedGraph): {
  framework_version?: string;
  matrix: ReturnType<typeof deriveQualityMatrix>["matrix"];
  overall: ReturnType<typeof deriveQualityMatrix>["overall"];
  finding_counts: ReturnType<typeof deriveQualityMatrix>["finding_counts"];
  assessment_count: number;
  open_findings: number;
  lanes: Record<string, number>;
  p0: ReturnType<typeof openFindingsSummary>["p0"];
} {
  const { section, library } = hostedSection(graph);
  const m = deriveQualityMatrix({ quality: section }, library);
  const { open, lanes, p0 } = openFindingsSummary(section.findings, library);
  return {
    ...(m.framework_version !== undefined ? { framework_version: m.framework_version } : {}),
    matrix: m.matrix,
    overall: m.overall,
    finding_counts: m.finding_counts,
    assessment_count: section.assessments.length,
    open_findings: open.length,
    lanes,
    p0,
  };
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

  /**
   * The scope as it stands, in either mode: the journal's resolutions against
   * the CURRENT state — the merge across every audit — because a finding
   * resolved this week was routinely opened two audits ago, and its cell's
   * standing score may come from any of them. Shared by `kritik_scope` (which
   * returns it) and `kritik_score` with scope=true (which refuses what it does
   * not list), so the two can never disagree about a cell.
   */
  const scopeOf = (graph: LoadedGraph, options: { since?: string; widen?: boolean } = {}): AuditScope => {
    let section: Pick<QualitySection, "profile" | "assessments" | "findings">;
    let library: Pick<KritikLibrary, "criteria">;
    let events: readonly JournalEvent[];
    if (ctx.qualityRoot === undefined) {
      const hosted = hostedSection(graph);
      section = hosted.section;
      library = hosted.library ?? { criteria: [] };
      // A restored project's audit never got a `quality.audit.completed` — the
      // synthesized reading, dated where the audit was taken, stands in for it
      // so the window still opens from a real "since" (issue #472).
      events = withImplicitBaseline(graph.journal, hosted.section, hosted.library);
    } else {
      const root = ctx.qualityRoot;
      const full = libraryOf(root);
      const profile = profileOf(root);
      try {
        section = loadCurrentQualitySection(root, full) ?? { profile, assessments: [], findings: [] };
      } catch (error) {
        throw new ToolError((error as Error).message);
      }
      library = full;
      events = graph.journal;
    }

    if (options.since !== undefined) {
      const recorded = recordedAuditIds(events);
      if (!recorded.includes(options.since)) {
        // A hosted record=true records a scoped re-audit, which itself needs
        // an audit to measure from — pointing a hosted agent at it would loop.
        const hint =
          ctx.qualityRoot !== undefined
            ? "A scope is measured from a recorded reading — kritik_matrix with record=true writes one."
            : recorded.length > 0
              ? "Pass one of the recorded audits, or leave since off to measure from the newest."
              : NO_HOSTED_AUDIT;
        throw new ToolError(`No recorded audit "${options.since}" in this journal (recorded: ${recorded.join(", ") || "none"}). ${hint}`);
      }
    }

    return deriveAuditScope(events, section, library, options);
  };

  // ---- Read -----------------------------------------------------------------

  tool(
    {
      name: "kritik_matrix",
      description:
        "The comparative quality matrix: a score and grade per (domain x surface), the weighted roll-up per surface, and open findings by priority lane. Anti-averaging caps are applied — one open Critical caps its cell at D, one open High at B — so a cell full of 3s cannot absorb a live defect. In repo mode this refreshes the audit's matrix.json, and with record=true appends quality.audit.completed; in hosted mode it is a read of the stored quality section, and record=true (with the audit_id kritik_score returned) records that scoped re-audit — the server computes the reading from the scores it holds, rather than accepting one on the wire. A scoped re-audit (scored with kritik_score scope=true, or, in repo mode, declared with scope=true here) returns `scope` and records the MERGED matrix through it with a scope marker, so the trend never reads its unscored cells as dropped; matrix.json stays this audit alone.",
      inputSchema: {
        type: "object",
        properties: {
          audit_id: {
            type: "string",
            description: "Default: the newest audit on disk. Hosted: required with record=true, refused otherwise.",
          },
          record: {
            type: "boolean",
            description: "Append quality.audit.completed carrying these scores and counts. Once per finished audit. Hosted: the server computes the scores and counts.",
          },
          scope: {
            type: "boolean",
            description: "Treat the audit as a scoped re-audit even though it was scored without kritik_score scope=true (which marks it). Repo mode only.",
          },
          commit: {
            type: "string",
            description: "Hosted record only: the commit the scoped re-audit read. Repo mode reads it from the audit's scores.json.",
          },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const hosted = ctx.qualityRoot === undefined;
      if (hosted) {
        if (args.record === true) {
          if (typeof args.audit_id !== "string" || args.audit_id === "") {
            throw new ToolError(
              "record=true in a hosted session records a scoped re-audit: pass the audit_id kritik_score returned (e.g. 2026-09-scoped).",
            );
          }
          const auditId = args.audit_id;
          const commit = typeof args.commit === "string" && args.commit !== "" ? args.commit : undefined;
          const graph = await load();
          // The cells this audit's scope still lists that no score carrying
          // its audit_id has covered — meaningful only while the scope those
          // scores were measured against is still the CURRENT one, mirroring
          // repo mode's own left_unscored (recording closes the window, so a
          // cell left out here drops out of the next kritik_scope).
          const scope = scopeOf(graph);
          const scoredForAudit = (graph.journal as JournalEvent[]).filter(
            (event) => event.type === "quality.assessment.scored" && (event as { audit_id?: unknown }).audit_id === auditId,
          );
          const scoredSince = scoredForAudit
            .map((event) => (event as { scope?: { since?: unknown } }).scope?.since)
            .find((since): since is string => typeof since === "string");
          let leftUnscored: { criterion_id: string; surface: string; kind: string }[] = [];
          if (scope.since !== null && scoredSince === scope.since) {
            const done = new Set(
              scoredForAudit.map(
                (event) =>
                  `${String((event as { criterion_id?: unknown }).criterion_id)}::${String((event as { surface?: unknown }).surface)}`,
              ),
            );
            leftUnscored = scope.cells
              .filter((cell) => !done.has(`${cell.criterion_id}::${cell.surface}`))
              .map((cell) => ({ criterion_id: cell.criterion_id, surface: cell.surface, kind: cell.kind }));
          }

          if (ctx.store.appendQualityEvents === undefined) {
            throw new ToolError(`${ctx.store.describe()} cannot append quality events.`);
          }
          let events: JournalEvent[];
          try {
            events = await ctx.store.appendQualityEvents([
              { type: "quality.audit.completed", scope: true, audit_id: auditId, ...(commit !== undefined ? { commit } : {}) },
            ]);
          } catch (error) {
            // No idempotency key: a POST whose response was dropped and a
            // fresh one are indistinguishable except by verdict. But
            // already_recorded fires for ANY recorded audit_id sharing this
            // name — a comprehensive audit, the since/baseline audit, or a
            // genuine scoped one — and this audit_id might collide with one
            // of those (an agent passing kritik_scope's `since` by mistake,
            // say). Only a landed event that is ITSELF a scoped, non-baseline
            // recording of THIS re-audit — and only when this audit actually
            // holds hosted scores — is the earlier attempt landing; anything
            // else is a genuine refusal and must not be reported as success.
            const refusals = (error as Error & { refusals?: QualityEventRefusal[] }).refusals;
            if (
              Array.isArray(refusals) &&
              refusals.length > 0 &&
              refusals.every((r) => r.reason === "already_recorded") &&
              scoredForAudit.length > 0
            ) {
              const reloaded = await load();
              const landed = (reloaded.journal as JournalEvent[]).find(
                (event) =>
                  event.type === "quality.audit.completed" &&
                  (event as { audit_id?: unknown }).audit_id === auditId &&
                  (event as { baseline?: unknown }).baseline !== true &&
                  (event as { scope?: { partial?: unknown } }).scope?.partial === true,
              );
              if (landed !== undefined) {
                return {
                  ...hostedMatrixRead(reloaded),
                  audit_id: auditId,
                  scope: (landed as { scope?: unknown }).scope,
                  // Not reconstructable: recording re-anchors the scope on
                  // the landed reading itself, so "what's left" no longer
                  // means what it meant before the write landed.
                  events: [landed],
                  note: "Already recorded — returning the reading that landed. left_unscored can't be reconstructed after recording.",
                };
              }
            }
            throw new ToolError((error as Error).message);
          }

          const reloaded = await load();
          const recorded = events.find((event) => event.type === "quality.audit.completed") as
            | (JournalEvent & { scope?: unknown })
            | undefined;
          return {
            ...hostedMatrixRead(reloaded),
            audit_id: auditId,
            scope: recorded?.scope,
            left_unscored: leftUnscored,
            events,
          };
        }
        if (args.scope === true) {
          throw new ToolError(
            "In a hosted session a scoped re-audit is recorded with record=true and its audit_id; the read is always the current state.",
          );
        }
        // Refused, not ignored: silently returning the whole-pool matrix for a
        // request that believed it scoped to one audit is the wrong-answer
        // failure mode issue #400 was opened against.
        if (typeof args.audit_id === "string" && args.audit_id !== "") {
          throw new ToolError("The hosted matrix is the current state, not one audit — audit_id does not partition it (issue #400 decision 3).");
        }
        const graph = await load();
        // audit_id/commit are legitimately absent from a plain read — hosted
        // has no audit file to carry them.
        return { ...hostedMatrixRead(graph), events: [] as JournalEvent[] };
      }

      const root = repoRootOf(ctx, REPO_MODE_ONLY);
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

      // What a scoped audit was measured from: its kritik_score stamp, else —
      // when scope=true declares it by hand — `declaredScopeSince`, which also
      // refuses an audit already recorded. Loaded lazily: a comprehensive audit
      // needs no journal.
      let graph: LoadedGraph | undefined;
      let since = loadScoresOrEmpty(root, auditId).scope?.since;
      if (since === undefined && args.scope === true) {
        graph = await load();
        try {
          since = declaredScopeSince(auditId, recordedAuditIds(graph.journal));
        } catch (error) {
          throw new ToolError(`scope=true refused — ${(error as Error).message}`);
        }
      }
      const scope: AuditCompletedScope | undefined =
        since !== undefined ? { partial: true, cells: section.assessments.length, since } : undefined;

      // The cells the scope still lists that this audit has not re-scored.
      // Recording closes the window and they drop out of the next scope, so
      // the reply names them — before recording, and as it happens.
      let leftUnscored: { criterion_id: string; surface: string; kind: string }[] = [];
      if (scope !== undefined) {
        graph = graph ?? (await load());
        const current = scopeOf(graph);
        if (current.since === scope.since) {
          const done = new Set(section.assessments.map((a) => `${a.criterion_id}::${a.surface}`));
          leftUnscored = current.cells
            .filter((cell) => !done.has(`${cell.criterion_id}::${cell.surface}`))
            .map((cell) => ({ criterion_id: cell.criterion_id, surface: cell.surface, kind: cell.kind }));
        }
      }

      let events: JournalEvent[] = [];
      if (args.record === true) {
        // The merged matrix through this audit — where the product stands —
        // not the scoped audit's own dozen cells; see `auditCompletedInput`.
        let recorded = matrix;
        if (scope !== undefined) {
          try {
            recorded = deriveQualityMatrix({ quality: loadQualitySectionThrough(root, auditId, library) }, library);
          } catch (error) {
            throw new ToolError((error as Error).message);
          }
        }
        events = await record(graph ?? (await load()), [
          auditCompletedInput(recorded, {
            audit_id: auditId,
            framework_version: file.framework_version,
            ...(file.commit !== undefined ? { commit: file.commit } : {}),
            ...(scope !== undefined ? { scope } : {}),
          }),
        ]);
      }

      // Named, not silently dropped: an agent that passed commit believes it
      // lands somewhere.
      const notes =
        typeof args.commit === "string" && args.commit !== ""
          ? ["commit is only used when recording in a hosted session — repo mode reads it from the audit's scores.json"]
          : undefined;

      return {
        ...file,
        ...(scope !== undefined ? { scope, left_unscored: leftUnscored } : {}),
        assessment_count: section.assessments.length,
        open_findings: open.length,
        lanes,
        p0,
        events,
        ...(notes !== undefined ? { notes } : {}),
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

      const root = repoRootOf(ctx, REPO_MODE_ONLY);
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
        "The signal pack: every applicable criterion's mechanically checkable statements, expanded across the surfaces it applies to, plus anything that has tripped since the last recorded audit. These are statements to CHECK, not commands to run — a grep that must return nothing, a CI job that must exist — so run them yourself and report what failed with kritik_trip_signal. Repo sessions only: the pack and its run sheet live with the code.",
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
      const root = repoRootOf(
        ctx,
        "Signals are statements checked against the repository — the pack and its run sheet live with the code.",
      );
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
        "What got worse between two audits: a cell whose maturity level dropped, a cell that gained an open Critical or High finding, and a finding that was resolved and is open again. In repo mode each side is every audit through it, merged latest-wins, so a scoped re-audit's cells are compared with their last reading wherever it was taken; cells with no reading on one side are not compared — a half-finished audit is not a regression. With record=true, appends one quality.signal.tripped per regression (repo mode only — hosted comparisons are read-only and cover assessment-level drops, since hosted findings are a living pool rather than per-audit snapshots). A tripped signal is NOT a finding; it is the prompt to go look.",
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

      const root = repoRootOf(ctx, REPO_MODE_ONLY);
      const library = libraryOf(root);
      const audits = listAuditIds(root);
      const { from, to } = resolveAuditPair(audits, args, "under docs/quality/audits/");

      let regressions: Regression[];
      try {
        // Merged through each audit: a scoped `to` holds only the cells it
        // re-scored, each compared with its last reading wherever it was taken.
        regressions = detectRegressions(
          loadQualitySectionThrough(root, from, library),
          loadQualitySectionThrough(root, to, library),
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
      name: "kritik_trend",
      description:
        "Where the product stood at each recorded audit, oldest first: one row per quality.audit.completed in the journal, the overall score per surface (or one domain's score with domain), and how each moved against the row above. The score, not the findings — 'from where we started to where we are now'. Rows are ordered by when they were recorded, a re-recorded audit id keeps only its latest reading, and a framework major bump between two audits marks the later row comparable=false with no delta across it. Works in both modes: repo reads the journal sidecar, hosted reads the hosted journal — and there a restored audit with no recorded reading appears as a baseline first row.",
      inputSchema: {
        type: "object",
        properties: {
          surface: { type: "string", description: "One column only." },
          domain: { type: "string", description: "Domain code, e.g. SEC — that domain's score per surface instead of the roll-up." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const graph = await load();
      // The weights that roll each snapshot up, from wherever this mode keeps
      // the profile: the folded section when hosted, docs/quality/ in a repo.
      // Neither is required — a journal with audits but no profile still has
      // a trend, with every domain weighing 1 as the matrix would weigh it.
      const quality = ctx.qualityRoot === undefined ? (graph.loaded.bundle as { quality?: QualitySection }).quality : undefined;
      const profile = ctx.qualityRoot === undefined ? quality?.profile : (loadProfile(ctx.qualityRoot) ?? undefined);
      // A restored project's audit never got a `quality.audit.completed` — the
      // synthesized reading, dated where the audit was taken, stands in as its
      // first row rather than leaving the trend with none at all (issue #472).
      const events =
        quality !== undefined && Array.isArray(quality.assessments) && Array.isArray(quality.findings)
          ? withImplicitBaseline(graph.journal, quality, resolveKritikLibrary(quality))
          : graph.journal;
      const trend = deriveQualityTrend(events, profile);
      const filter = {
        ...(typeof args.surface === "string" && args.surface !== "" ? { surface: args.surface } : {}),
        ...(typeof args.domain === "string" && args.domain !== "" ? { domain: args.domain } : {}),
      };
      const { surfaces, rows } = trendRows(trend, filter);
      return {
        total: trend.snapshots.length,
        surfaces,
        rows,
        snapshots: trend.snapshots,
        ...(trend.snapshots.length === 0
          ? { note: ctx.qualityRoot === undefined ? NO_HOSTED_AUDIT : "No recorded audits yet — `kritik_matrix` with record=true writes one." }
          : rows[0]?.baseline === true
            ? {
                // Synthesized only until the first hosted score writes the
                // baseline for real (flagged `baseline: true`); after that the
                // row IS a recorded reading, and saying otherwise is false.
                note: graph.journal.some(
                  (event) => event.type === "quality.audit.completed" && (event as { baseline?: unknown }).baseline === true,
                )
                  ? "The first row is the restored audit's reading, recorded when the first hosted score landed."
                  : "The first row is the restored audit's reading, rebuilt from its stored scores — no reading was recorded for it.",
              }
            : {}),
      };
    },
  );

  tool(
    {
      name: "kritik_scope",
      description:
        "The cells a batch of fixes made stale — the work list for a scoped re-audit. A score only moves when its cell is re-scored, so after closing findings this lists exactly which (criterion x surface) cells to re-score instead of running a comprehensive audit: every quality.finding.resolved since the last recorded audit names its cell (`kind: direct`, `because` = finding ids), and one hop over node_ids adds neighbouring assessed cells a shared fix plausibly moved (`kind: widened`, `because` = node ids). Accepted risks are not fixes and never scope anything. `unknown` lists resolved ids that name no finding — report those, something closed an id that does not exist; `unscorable` lists resolved findings whose cell nothing can re-score (a retired criterion, a surface no longer in the profile). It plans an audit and scores nothing: re-score each cell with kritik_score, evidence and scope=true (which writes into an audit of its own, `<YYYY-MM>-scoped`, never the `since` audit whose recorded reading is history), then kritik_matrix with that audit_id and record=true. Recording closes the window: a cell left unscored drops out of the next scope, so re-score a widened cell that did not move at its current level, saying so in the evidence. Works in both modes — hosted reads the hosted journal and quality section. In a hosted project whose audit arrived by restore with no recorded reading, the scope measures from that audit, dated where it was taken. In a hosted session, open_audit and rescored show what the scoped re-audit in progress has already covered — record only when every cell is rescored. In a hosted session the server checks each kritik_score against the default scope (measured from the newest recorded audit, widened), so since and widen=false only change what this read shows, not which cells kritik_score accepts.",
      inputSchema: {
        type: "object",
        properties: {
          since: { type: "string", description: "The recorded audit to measure from. Default: the newest quality.audit.completed." },
          widen: { type: "boolean", description: "Add the one-hop node neighbours. Default: true." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const graph = await load();
      const since = typeof args.since === "string" && args.since !== "" ? args.since : undefined;
      const scope = scopeOf(graph, {
        ...(since !== undefined ? { since } : {}),
        ...(args.widen === false ? { widen: false } : {}),
      });

      // Hosted only: the scoped re-audit already in progress, if any. An
      // agent mid-re-audit can then see how much of this list kritik_score
      // has already covered without replaying every kritik_score reply.
      //
      // The rule mirrors the server planner's (`planQualityEvents` in
      // lib/services/graph/quality-events.ts), which names the audit an
      // id-less score lands in: the LAST `quality.assessment.scored`, in
      // journal order, whose `scope.since` is the current since and whose
      // audit_id is not recorded (the implicit baseline counting as
      // recorded). Journal order, never lexical order — the two disagree
      // once a month holds `-scoped` and `-scoped-02`.
      let openAudit: { audit_id: string; scored: { criterion_id: string; surface: string }[] } | null = null;
      let cells: (ScopeCell & { rescored?: true })[] = scope.cells;
      if (ctx.qualityRoot === undefined && scope.since !== null) {
        const { section, library } = hostedSection(graph);
        const recorded = new Set(recordedAuditIds(withImplicitBaseline(graph.journal, section, library)));
        const scoredEvents = (graph.journal as JournalEvent[]).filter((event) => event.type === "quality.assessment.scored");
        const auditIdOf = (event: JournalEvent): string | undefined => {
          const id = (event as { audit_id?: unknown }).audit_id;
          return typeof id === "string" && id !== "" ? id : undefined;
        };
        const sinceOf = (event: JournalEvent): string | undefined => {
          const since = (event as { scope?: { since?: unknown } }).scope?.since;
          return typeof since === "string" && since !== "" ? since : undefined;
        };
        let open: string | undefined;
        for (const event of scoredEvents) {
          const id = auditIdOf(event);
          if (id !== undefined && sinceOf(event) === scope.since && !recorded.has(id)) open = id;
        }
        if (open !== undefined) {
          const scored: { criterion_id: string; surface: string }[] = [];
          for (const event of scoredEvents) {
            if (auditIdOf(event) !== open || sinceOf(event) !== scope.since) continue;
            const criterionId = (event as { criterion_id?: unknown }).criterion_id;
            const surface = (event as { surface?: unknown }).surface;
            if (typeof criterionId === "string" && typeof surface === "string") scored.push({ criterion_id: criterionId, surface });
          }
          openAudit = { audit_id: open, scored };
          const done = new Set(scored.map((cell) => `${cell.criterion_id}::${cell.surface}`));
          cells = scope.cells.map((cell) =>
            done.has(`${cell.criterion_id}::${cell.surface}`) ? { ...cell, rescored: true } : cell,
          );
        }
      }

      return {
        ...scope,
        cells,
        summary: scopeSummary(scope),
        ...(ctx.qualityRoot === undefined ? { open_audit: openAudit } : {}),
        ...(scope.since === null
          ? {
              note:
                ctx.qualityRoot === undefined
                  ? NO_HOSTED_AUDIT
                  : "No recorded audit yet — a scope is measured from one. `kritik_matrix` with record=true writes it.",
            }
          : {}),
      };
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

      const root = repoRootOf(ctx, REPO_MODE_ONLY);
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
        "Record one (criterion x surface) maturity level with the evidence behind it. A cell holds exactly one level, so re-scoring replaces in place. Evidence is required: a score without a citation is an opinion, not an assessment. Score what the code IS, never what an open PR promises — that is what makes a trend real. For a scoped re-audit pass scope=true: a cell kritik_scope does not list is refused (so a between-milestone re-audit cannot drift into a comprehensive one), and the score lands in a scoped audit of its own (default <YYYY-MM>-scoped). In a hosted session scoring is scoped-only (scope=true is required) and nothing is written to disk. The server checks the cell against the scope, names the audit (default <YYYY-MM>-scoped), and, for a restored audit with no recorded reading, records that baseline first. You are still reading code: have the product's code at hand to read — the session can stay hosted — and pass commit so the evidence can be checked against it.",
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
          audit_id: {
            type: "string",
            description: "Default: the newest audit, or the current YYYY-MM. With scope=true: the scoped audit in progress, else <YYYY-MM>-scoped.",
          },
          commit: { type: "string" },
          scope: {
            type: "boolean",
            description:
              "This is a scoped re-audit: refuse a cell kritik_scope does not list. In repo mode, leave it off to re-score an out-of-scope cell on purpose; a hosted session must pass it.",
          },
        },
        required: ["criterion_id", "surface", "level", "evidence"],
        additionalProperties: false,
      },
    },
    async (args) => {
      if (ctx.qualityRoot === undefined) {
        if (args.scope !== true) {
          throw new ToolError(
            "A hosted session scores only a scoped re-audit: pass scope=true and score the cells kritik_scope lists. " +
              "A comprehensive audit is a different, repo-mode operation — it runs in a session pointed at a checkout, not this one.",
          );
        }
        const graph = await load();
        const { library } = hostedSection(graph); // refuses a project with no quality section
        const criterionId = requireString(args, "criterion_id");
        const surface = requireString(args, "surface");
        const level = requireInt(args, "level", 0, 4) as MaturityLevel;
        const evidence = requireString(args, "evidence");
        const commit = typeof args.commit === "string" && args.commit !== "" ? args.commit : undefined;
        const events = await appendHosted(ctx.store, [
          {
            type: "quality.assessment.scored",
            criterion_id: criterionId,
            surface,
            level,
            evidence,
            ...(typeof args.audit_id === "string" && args.audit_id !== "" ? { audit_id: args.audit_id } : {}),
            ...(commit !== undefined ? { commit } : {}),
          },
        ]);
        const scored = events.find((e) => e.type === "quality.assessment.scored") as
          | (JournalEvent & { audit_id: string; scope?: { since?: string } })
          | undefined;
        const baseline = events.find(
          (e) => e.type === "quality.audit.completed" && (e as { baseline?: unknown }).baseline === true,
        ); // by flag, never by position
        const notes: string[] = [];
        if (baseline !== undefined) {
          notes.push(
            `Recorded the baseline reading of ${(baseline as { audit_id?: string }).audit_id} first, dated where that audit was taken — the scope and the trend now measure from a real event.`,
          );
        }
        if (commit === undefined) {
          notes.push("No commit given — it is the only thing that lets a hosted reader check this evidence against the tree it cites.");
        }
        return {
          assessment: {
            criterion_id: criterionId,
            surface,
            level,
            evidence,
            audit_id: scored?.audit_id,
            ...(commit !== undefined ? { commit } : {}),
            ts: scored?.ts,
          },
          audit_id: scored?.audit_id,
          ...(scored?.scope?.since !== undefined ? { scoped_from: scored.scope.since } : {}),
          anchor: library?.criteria?.find((c) => c.id === criterionId)?.level_anchors?.[`l${level}`],
          events,
          ...(notes.length > 0 ? { notes } : {}),
        };
      }

      const root = repoRootOf(ctx, "Scoring reads the code — evidence is file:line against a working tree.");
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

      let scopedFrom: string | undefined;
      let auditId: string;
      // Loaded only when needed: to scope, or to say a plain score rewrites a
      // recorded reading. Scoring itself never touches the journal.
      const graph = await load();
      if (args.scope === true) {
        const scope = scopeOf(graph);
        if (scope.since === null) {
          throw new ToolError("scope=true needs a recorded audit to measure from — kritik_matrix with record=true writes one.");
        }
        if (!scope.cells.some((cell) => cell.criterion_id === criterionId && cell.surface === surface)) {
          throw new ToolError(
            `${criterionId} x ${surface} is not in the current scope (${scopeSummary(scope)}). ` +
              `kritik_scope lists the cells; leave scope off to re-score this one on purpose.`,
          );
        }
        try {
          auditId = scopedAuditTarget(
            root,
            scope.since,
            currentAuditId(),
            typeof args.audit_id === "string" && args.audit_id !== "" ? args.audit_id : undefined,
            recordedAuditIds(graph.journal),
          );
        } catch (error) {
          throw new ToolError((error as Error).message);
        }
        scopedFrom = scope.since;
      } else {
        auditId = auditForWrite(root, args.audit_id);
      }
      // Said out loud rather than refused — each has a legitimate use.
      const notes: string[] = [];
      if (scopedFrom === undefined) {
        if (recordedAuditIds(graph.journal).includes(auditId)) {
          notes.push(`${auditId} is already recorded — a re-score here rewrites that reading. For a re-audit after fixes, pass scope=true.`);
        }
        const order = auditOrderNote(root, auditId);
        if (order !== undefined) notes.push(order);
      }
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
        ...(scopedFrom !== undefined ? { scope: { since: scopedFrom } } : {}),
        assessments,
      });

      return {
        assessment,
        audit_id: auditId,
        ...(scopedFrom !== undefined ? { scoped_from: scopedFrom } : {}),
        assessment_count: assessments.length,
        ...(replaced !== undefined ? { replaced_level: replaced.level } : {}),
        anchor: criterion.level_anchors?.[`l${level}`],
        ...(notes.length > 0 ? { notes } : {}),
      };
    },
  );

  tool(
    {
      name: "kritik_open_finding",
      description:
        "Open a finding on a (criterion x surface) cell and append quality.finding.opened. One finding is one defect — not one criterion, and not one surface's worth of grumbling. Verify Critical and High adversarially BEFORE opening: try to refute them against the repo, and record the verdict. Severity and priority come back derived; they are never stored. Repo sessions only: a new finding cites code, so a hosted session refuses.",
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
      const root = repoRootOf(ctx, "A new finding cites code: evidence is file:line, verified adversarially against the checkout.");
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
      const id = requireString(args, "finding_id");
      const resolvedBy = typeof args.resolved_by === "string" && args.resolved_by !== "" ? args.resolved_by : undefined;

      if (ctx.qualityRoot === undefined) {
        const graph = await load();
        const { section } = hostedSection(graph);
        const finding = section.findings.find((candidate) => candidate.id === id);
        if (!finding) throw new ToolError(`No finding "${id}" in this hosted project's quality section.`);
        if (finding.status === "resolved") {
          return { finding, events: [] as JournalEvent[], note: "Already resolved — nothing written." };
        }

        // The server's post-fold openness check is the only "not open" verdict
        // that matters here — see appendHosted.
        const events = await appendHosted(ctx.store, [
          { type: "quality.finding.resolved", finding_id: finding.id, ...(resolvedBy !== undefined ? { resolved_by: resolvedBy } : {}) },
        ]);
        return {
          finding: { ...finding, status: "resolved" as const, ...(resolvedBy !== undefined ? { resolved_by: resolvedBy } : {}) },
          events,
        };
      }

      const root = repoRootOf(ctx, REPO_MODE_ONLY);
      const located = locateFinding(root, id);
      if (!located) throw new ToolError(`No finding "${id}" in any audit under docs/quality/audits/.`);
      if (located.finding.status === "resolved") {
        return { finding: located.finding, audit_id: located.auditId, events: [], note: "Already resolved — nothing written." };
      }

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
        "Record a finding as a known, owned risk. The note is required — an accepted risk is a decision and reads like one, and the findings board renders it as a decision-log entry. In repo mode acceptance is a state of the finding, written straight to the findings file with no journal event; a hosted session has no findings file to hold that state, so it appends quality.finding.accepted instead, and the read derives status accepted-risk from it.",
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
      const id = requireString(args, "finding_id");
      const note = requireString(args, "note");

      if (ctx.qualityRoot === undefined) {
        const graph = await load();
        const { section } = hostedSection(graph);
        const finding = section.findings.find((candidate) => candidate.id === id);
        if (!finding) throw new ToolError(`No finding "${id}" in this hosted project's quality section.`);

        const events = await appendHosted(ctx.store, [{ type: "quality.finding.accepted", finding_id: finding.id, reason: note }]);
        // Mirrors what the server's fold will derive: lib/utils/quality.ts
        // folds an accepted event into status accepted-risk with the note
        // appended to detail — this is that same shape, computed client-side
        // for the immediate reply, through the same `acceptedDetail`.
        return {
          finding: { ...finding, status: "accepted-risk" as const, detail: acceptedDetail(finding.detail, note) },
          events,
        };
      }

      const root = repoRootOf(ctx, REPO_MODE_ONLY);
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
        "Record that a monitoring signal failed between audits: appends quality.signal.tripped. A tripped signal is NOT a finding — it is the prompt to go look. Cheap, frequent, and allowed to be wrong, where a finding is expensive, rare, and has survived an adversarial pass. Repo sessions only: signals are checked against the repository.",
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
      const root = repoRootOf(
        ctx,
        "Signals are statements checked against the repository — the pack and its run sheet live with the code.",
      );
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
