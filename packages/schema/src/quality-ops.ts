/**
 * Operations over a project's Kritik state — the write half of the quality
 * layer (docs/rfcs/kritik.md § 4.4), kept pure so every caller shares one
 * meaning.
 *
 * `quality.ts` is the model and its projections: what a score *is*, and what a
 * matrix derives to. This module is what a verb *does* to that state — record a
 * score, open a finding, resolve one, mint an id, render an issue, build the
 * journal event that says it happened. Three entry points call these and no
 * two may disagree: the `arkaik kritik` CLI verbs, the `kritik_*` MCP tools,
 * and (Phase D) the app's Quality page.
 *
 * Two disciplines hold here, both inherited:
 *
 * - **Zod-free and fs-free.** Same reason as `quality.ts` — `validate.ts` is
 *   esbuild-bundled into the standalone validator, the plugin scripts are
 *   bundled into zero-dependency CJS, and the app imports this in a browser.
 *   The only import is a *type*, so nothing at all is dragged in at runtime.
 * - **Nothing mutates its input.** Every function returns fresh arrays. A
 *   caller that wants the old state to compare against still has it — which is
 *   what lets a verb say "replaced a level-2 with a level-3" rather than
 *   silently overwriting.
 *
 * Events come back as {@link EventInput} — type plus flat payload, no envelope.
 * Stamping (`id`, `ts`, `actor`) belongs to whoever writes: `makeEvent` for the
 * CLI, `store.persist` for MCP. Building a stamped event here would force this
 * module to import zod through `emit.ts` and would put the actor — the one
 * field the validator insists on knowing (`quality-event-no-actor`) — in the
 * hands of a module that cannot know it.
 */

import type { EventInput } from "./derive";
import { PLATFORM_IDS } from "./ids";
import {
  CROSS_SURFACE_ID,
  priorityOf,
  severityOf,
  type KritikCriterion,
  type KritikLibrary,
  type MaturityLevel,
  type QualityAssessment,
  type QualityFinding,
  type QualityMatrix,
  type SurfaceDef,
} from "./quality";

/**
 * The maturity a cell is expected to reach unless the audit says concretely why
 * not (SPEC § 6.3 / the skill's step 4). Level 3 is "Managed": systematic
 * across the surface, tested or reviewed. It seeds `{target_level}` in issue
 * skeletons and is what "scoring below target warrants a finding" measures
 * against.
 */
export const DEFAULT_TARGET_LEVEL: MaturityLevel = 3;

// --- Assessments -------------------------------------------------------------

/**
 * Record one score, latest-per-cell.
 *
 * A `(criterion × surface)` pair is a cell, and a cell holds exactly one level
 * — the validator says so (`quality-duplicate-assessment`), and the matrix
 * would otherwise have to pick a winner arbitrarily. So a second score for the
 * same cell REPLACES, in place, keeping the row's position: an audit re-scored
 * after a fix reads as a correction, not as an append-only pile the reader has
 * to date-sort. The replaced row comes back so the caller can report the move.
 */
export function upsertAssessment(
  assessments: readonly QualityAssessment[],
  next: QualityAssessment,
): { assessments: QualityAssessment[]; replaced?: QualityAssessment } {
  const index = assessments.findIndex(
    (candidate) => candidate.criterion_id === next.criterion_id && candidate.surface === next.surface,
  );
  if (index === -1) return { assessments: [...assessments, next] };
  const updated = [...assessments];
  const replaced = updated[index];
  updated[index] = next;
  return { assessments: updated, replaced };
}

// --- Surfaces ----------------------------------------------------------------

/**
 * Parse a `id[:title[:platform]]` surface spec — the shape both the install-time
 * picker and `arkaik kritik profile` accept, so a surface list learned once
 * works in either.
 *
 * The id is what every assessment and finding references forever, which is why
 * it is held to kebab-case rather than accepted as typed: a surface renamed by
 * a stray capital is a surface whose whole column silently empties. `platform`
 * is the optional bridge to `PLATFORM_IDS` for surfaces that ship views; a
 * database contract or an admin back-office simply has none, and inventing one
 * to fill the slot is worse than leaving it out.
 */
export function parseSurfaceSpec(spec: string): SurfaceDef {
  const parts = spec.split(":");
  const id = (parts[0] ?? "").trim();
  if (id === "") throw new Error(`--surface needs an id (got "${spec}")`);
  if (id === CROSS_SURFACE_ID) {
    throw new Error(
      `"${CROSS_SURFACE_ID}" is reserved — it is the contract lens between surfaces. ` +
        `Findings may carry it; it holds no assessments and never becomes a matrix column, so it is not declared here.`,
    );
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    throw new Error(
      `surface id "${id}" is not kebab-case — assessments reference it, so it has to be stable and typo-proof`,
    );
  }
  const title = (parts[1] ?? "").trim() || id;
  const platform = (parts[2] ?? "").trim();
  if (platform !== "" && !(PLATFORM_IDS as readonly string[]).includes(platform)) {
    throw new Error(
      `"${platform}" is not an Arkaik platform (${PLATFORM_IDS.join(", ")}). ` +
        `A surface that ships no views simply has none — leave it off rather than inventing one.`,
    );
  }
  return platform === "" ? { id, title } : { id, title, platform: platform as SurfaceDef["platform"] };
}

// --- Findings ----------------------------------------------------------------

/** The domain code a criterion belongs to — its own, or the prefix of its id. */
export function domainCodeOf(criterionId: string, library?: KritikLibrary): string {
  const criterion = (library?.criteria ?? []).find((candidate) => candidate.id === criterionId);
  if (typeof criterion?.domain === "string" && criterion.domain !== "") return criterion.domain;
  const dash = criterionId.indexOf("-");
  return dash > 0 ? criterionId.slice(0, dash) : criterionId;
}

/**
 * The next free finding id for a cell, in the pilot's convention:
 * `F-<audit>-<DOMAIN>-<surface>-NN`.
 *
 * Readable on sight — which audit, which domain, which surface — and stable
 * enough to quote in a PR body, which is how `quality.finding.resolved` finds
 * its way back (RFC § 3.4). The counter scans `taken` rather than the array
 * length so a refuted finding left in the file (they are disclosed, never
 * deleted) can never have its number handed out twice.
 */
export function mintFindingId(
  auditId: string,
  criterionId: string,
  surface: string,
  taken: Iterable<string>,
  library?: KritikLibrary,
): string {
  const prefix = `F-${auditId}-${domainCodeOf(criterionId, library)}-${surface}-`;
  const used = new Set(taken);
  for (let n = 1; n < 1000; n++) {
    const candidate = `${prefix}${String(n).padStart(2, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Kritik: exhausted finding ids for ${prefix}NN — 999 findings on one cell is a data problem, not a numbering one`);
}

/** Add a finding, or replace the one already carrying its id. */
export function upsertFinding(
  findings: readonly QualityFinding[],
  next: QualityFinding,
): { findings: QualityFinding[]; replaced?: QualityFinding } {
  const index = findings.findIndex((candidate) => candidate.id === next.id);
  if (index === -1) return { findings: [...findings, next] };
  const updated = [...findings];
  const replaced = updated[index];
  updated[index] = next;
  return { findings: updated, replaced };
}

/**
 * Move a finding to a new status, returning the updated list and the finding as
 * it now reads. `undefined` means no finding carries that id — the caller says
 * so in its own words rather than being handed a silent no-op.
 */
export function patchFinding(
  findings: readonly QualityFinding[],
  id: string,
  patch: Partial<QualityFinding>,
): { findings: QualityFinding[]; finding?: QualityFinding; previous?: QualityFinding } {
  const index = findings.findIndex((candidate) => candidate.id === id);
  if (index === -1) return { findings: [...findings] };
  const updated = [...findings];
  const previous = updated[index];
  const finding = { ...previous, ...patch };
  updated[index] = finding;
  return { findings: updated, finding, previous };
}

/**
 * Close a finding because the fix merged. `resolved_by` is the PR or commit URL
 * — the evidence that it is actually gone, which is the only thing separating
 * "resolved" from "we stopped looking at it".
 */
export function resolveFinding(
  findings: readonly QualityFinding[],
  id: string,
  resolvedBy?: string,
): { findings: QualityFinding[]; finding?: QualityFinding; previous?: QualityFinding } {
  return patchFinding(findings, id, {
    status: "resolved",
    ...(resolvedBy !== undefined ? { resolved_by: resolvedBy } : {}),
  });
}

/**
 * The one shape an acceptance note takes in a finding's `detail` — shared by
 * `acceptFinding` (repo files), the server's event fold, and the MCP client's
 * optimistic mirror of that fold, so the three can never drift into showing a
 * reader two different records of the same decision.
 */
export function acceptedDetail(detail: string, note: string): string {
  return `${detail}\n\nAccepted risk: ${note}`.trim();
}

/**
 * Accept a finding as a known, owned risk. The note is not optional politeness:
 * an accepted risk is a decision, the validator warns when it reads like
 * anything less (`quality-accepted-risk-no-note`), and the findings board
 * renders it as a decision-log entry. It is appended to `detail` rather than
 * replacing it, so what the finding actually says survives the acceptance.
 */
export function acceptFinding(
  findings: readonly QualityFinding[],
  id: string,
  note: string,
): { findings: QualityFinding[]; finding?: QualityFinding; previous?: QualityFinding } {
  const existing = findings.find((candidate) => candidate.id === id);
  const detail = existing === undefined ? note : acceptedDetail(existing.detail, note);
  return patchFinding(findings, id, { status: "accepted-risk", detail });
}

// --- Issue skeletons ---------------------------------------------------------

/** A criterion's issue skeleton, filled as far as what we know allows. */
export interface RenderedIssue {
  title: string;
  labels: string[];
  body: string;
  /** The criterion's typical remediation, when the pack carries one. */
  remediation?: string;
}

/** Fill `{placeholder}` tokens we actually know; leave the rest for the author. */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/**
 * Render a criterion's GitHub issue skeleton for one surface.
 *
 * Unknown placeholders are left standing rather than blanked. A skeleton is a
 * form for a human or an agent to finish, and an empty "### Risk" section reads
 * as "no risk" where `{risk_narrative}` reads as "your turn" — the difference
 * between an issue somebody files and an issue somebody closes.
 *
 * Passing the `finding` fills the half the criterion cannot know: the risk
 * numbers, the evidence, the narrative. That is the P0/P1 path (the skill's
 * step 8), where the issue exists because a specific defect does.
 */
export function renderIssue(
  criterion: KritikCriterion,
  options: {
    surface: string;
    /** The observed maturity. Absent leaves `{observed_level}` for the author. */
    level?: number | string;
    /** Defaults to one level above observed, capped at 4. */
    targetLevel?: number | string;
    finding?: QualityFinding;
    /** Only used to rank the `finding` footer; the template itself needs none. */
    library?: KritikLibrary;
  },
): RenderedIssue {
  const { surface, finding, library } = options;
  const anchors = criterion.level_anchors ?? {};
  const level = options.level === undefined || options.level === "" ? "" : String(options.level);
  const observed = level === "" ? "{observed_level}" : level;
  const target =
    options.targetLevel !== undefined && options.targetLevel !== ""
      ? String(options.targetLevel)
      : level === ""
        ? "{target_level}"
        : String(Math.min(Number(level) + 1, 4));

  const values: Record<string, string> = {
    surface,
    observed_level: observed,
    target_level: target,
    observed_level_name: anchors[`l${observed}`] ?? "{observed_level_name}",
    target_level_name: anchors[`l${target}`] ?? "{target_level_name}",
    target_anchor_text: anchors[`l${target}`] ?? "{target_anchor_text}",
    impact: String(finding?.impact ?? criterion.default_impact ?? 3),
  };
  if (finding !== undefined) {
    values.likelihood = String(finding.likelihood);
    values.evidence_bullets_with_file_paths = finding.evidence;
    values.risk_narrative = finding.detail;
    if (typeof finding.remediation === "string" && finding.remediation !== "") {
      values.remediation_step_1 = finding.remediation;
    }
  }

  const issue = criterion.issue ?? {};
  // A pack criterion may already carry a label matching the surface (SEC-02's
  // `supabase` is a domain label, not a surface one) — appending it blindly
  // files the issue with the same label twice.
  const labels = [...new Set([...(issue.labels ?? ["quality"]), surface])];
  const body = fillTemplate(issue.body_skeleton ?? "", values);

  return {
    title: fillTemplate(issue.title_template ?? `[Quality] ${criterion.id} on {surface}`, values),
    labels,
    body: finding === undefined ? body : `${body}\n${findingFooter(finding, library)}`,
    ...(typeof criterion.remediation === "string" && criterion.remediation !== ""
      ? { remediation: criterion.remediation }
      : {}),
  };
}

/**
 * The finding's own facts, appended below a filled skeleton.
 *
 * Criteria name their evidence placeholder differently — SEC-01 wants
 * `{evidence_bullets_with_file_paths}`, SEC-02 wants
 * `{tables_or_policies_with_migration_paths}` — so mapping a finding's evidence
 * onto the template by guessing token names would drop it silently on most of
 * the pack. This block always lands, says which finding the issue came from,
 * and is what makes `--finding` mean something rather than nearly nothing.
 */
function findingFooter(finding: QualityFinding, library?: KritikLibrary): string {
  const lines = [
    ``,
    `---`,
    `<sub>Kritik finding \`${finding.id}\` — **${severityOf(finding, library)} / ${priorityOf(finding, library)}** ` +
      `(impact ${finding.impact} x likelihood ${finding.likelihood}, cost ${finding.cost})</sub>`,
    ``,
    `**Evidence**`,
    finding.evidence,
  ];
  if (typeof finding.remediation === "string" && finding.remediation !== "") {
    lines.push(``, `**Remediation**`, finding.remediation);
  }
  return lines.join("\n");
}

// --- Signals -----------------------------------------------------------------

/** One mechanically checkable statement, bound to the cell it belongs to. */
export interface SignalRow {
  criterion_id: string;
  surface: string;
  /** 0-based position in the criterion's `signals[]` — how `--trip` names one. */
  index: number;
  signal: string;
}

/**
 * The signal pack for a project: every criterion's `signals[]`, expanded across
 * the surfaces that criterion applies to.
 *
 * These are **statements to check, not commands to run** — "grep X returns
 * nothing", "a CI job asserting Y exists". That is deliberate in the pack, and
 * it is why this returns a run sheet rather than pretending to execute
 * anything: the checks span greps, CI introspection, and database queries, and
 * a framework that guessed at running them would be wrong in a way nobody could
 * see. An agent reads the sheet, checks what it can, and records what tripped.
 *
 * `cross-surface` is excluded for the same reason it holds no assessments: it
 * is a lens over the contract between surfaces, not a surface anything runs on.
 */
export function signalRunSheet(
  library: KritikLibrary,
  surfaces: readonly SurfaceDef[],
  filter: { surface?: string; criterion?: string; domain?: string } = {},
): SignalRow[] {
  const surfaceIds = surfaces.map((surface) => surface.id).filter((id) => id !== CROSS_SURFACE_ID);
  const rows: SignalRow[] = [];
  for (const criterion of library.criteria ?? []) {
    if (criterion.superseded_by !== undefined) continue;
    if (filter.criterion !== undefined && criterion.id !== filter.criterion) continue;
    if (filter.domain !== undefined && criterion.domain !== filter.domain) continue;
    const signals = criterion.signals ?? [];
    if (signals.length === 0) continue;
    // No `applies_to` means "everywhere" — the same reading `applicableCells`
    // uses, so the run sheet and the matrix cover the same cells.
    const appliesTo = criterion.applies_to;
    for (const surfaceId of surfaceIds) {
      if (Array.isArray(appliesTo) && !appliesTo.includes(surfaceId)) continue;
      if (filter.surface !== undefined && surfaceId !== filter.surface) continue;
      signals.forEach((signal, index) => {
        rows.push({ criterion_id: criterion.id, surface: surfaceId, index, signal });
      });
    }
  }
  return rows;
}

// --- Journal event inputs ----------------------------------------------------

/**
 * `quality.audit.completed` for a finished run.
 *
 * The payload is the roll-up, so the matrix is the only honest source for it —
 * which is why this takes a computed {@link QualityMatrix} rather than letting
 * a caller hand-assemble scores that the next `compute-matrix` run would
 * contradict. Cells that were never scored are omitted rather than sent as
 * zero: "not assessed" and "assessed at nothing" are different claims, and
 * only one of them is a regression.
 */
export function auditCompletedInput(
  matrix: QualityMatrix,
  meta: { audit_id: string; framework_version: string; commit?: string },
): EventInput {
  const scores: Record<string, Record<string, number>> = {};
  for (const surface of matrix.surfaces) {
    const bySurface: Record<string, number> = {};
    for (const domain of matrix.domains) {
      const cell = matrix.matrix[domain]?.[surface];
      if (cell) bySurface[domain] = cell.score;
    }
    scores[surface] = bySurface;
  }
  return {
    type: "quality.audit.completed",
    payload: {
      audit_id: meta.audit_id,
      framework_version: meta.framework_version,
      ...(meta.commit !== undefined ? { commit: meta.commit } : {}),
      scores,
      counts: matrix.finding_counts,
    },
  };
}

/**
 * `quality.finding.opened` for a retained finding.
 *
 * `severity` and `priority` are stored on the EVENT while being forbidden on
 * the finding, and that is not an inconsistency. A finding is state, so its
 * severity must stay derivable from the numbers behind it. An event is a fact
 * about a moment: it says what this finding was ranked when it was opened,
 * under the scales in force then. A pack that later retunes its buckets must
 * not silently rewrite history.
 */
export function findingOpenedInput(finding: QualityFinding, library?: KritikLibrary): EventInput {
  return {
    type: "quality.finding.opened",
    payload: {
      finding_id: finding.id,
      criterion_id: finding.criterion_id,
      surface: finding.surface,
      severity: severityOf(finding, library),
      priority: priorityOf(finding, library),
      title: finding.title,
      ...(finding.node_ids !== undefined ? { node_ids: finding.node_ids } : {}),
      ...(finding.issue_url !== undefined ? { issue_url: finding.issue_url } : {}),
    },
  };
}

/** `quality.finding.resolved` — the fix merged, and `resolved_by` proves it. */
export function findingResolvedInput(
  finding: Pick<QualityFinding, "id" | "node_ids">,
  resolvedBy?: string,
): EventInput {
  return {
    type: "quality.finding.resolved",
    payload: {
      finding_id: finding.id,
      ...(resolvedBy !== undefined ? { resolved_by: resolvedBy } : {}),
      ...(finding.node_ids !== undefined ? { node_ids: finding.node_ids } : {}),
    },
  };
}

/**
 * `quality.finding.accepted` — a known, owned risk, recorded as an event.
 *
 * In a repository, acceptance is a state of the finding (`acceptFinding`
 * patches the file) and no event is written. This event exists for writes
 * made AWAY from the checkout: a hosted project has no findings file, so the
 * journal is the only place the decision can live, and the read derives the
 * status from it (`foldFindingEvents`).
 */
export function findingAcceptedInput(
  finding: Pick<QualityFinding, "id" | "node_ids">,
  reason: string,
): EventInput {
  return {
    type: "quality.finding.accepted",
    payload: {
      finding_id: finding.id,
      reason,
      ...(finding.node_ids !== undefined ? { node_ids: finding.node_ids } : {}),
    },
  };
}

/**
 * `quality.signal.tripped` — a mechanical check regressed between audits.
 *
 * A tripped signal is not a finding. It is the prompt to go look: cheap,
 * frequent, and allowed to be wrong, where a finding is expensive, rare, and
 * has survived an adversarial pass. Emitting one does not open anything.
 *
 * A hosted trip written from CI carries the `commit` it observed (#406) — the
 * one writer class that pays nothing for the anchor, since the revision under
 * test is ambient in a workflow. It stays optional here because this shape
 * describes every trip in every mode, and a repo-mode trip has no obligation
 * to anchor; requiring it is a route policy about a caller class, and lives
 * where that class is identified.
 */
export function signalTrippedInput(trip: {
  criterion_id: string;
  surface: string;
  signal: string;
  commit?: string;
  detail?: string;
}): EventInput {
  return {
    type: "quality.signal.tripped",
    payload: {
      criterion_id: trip.criterion_id,
      surface: trip.surface,
      signal: trip.signal,
      ...(trip.commit !== undefined ? { commit: trip.commit } : {}),
      ...(trip.detail !== undefined ? { detail: trip.detail } : {}),
    },
  };
}
