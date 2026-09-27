import {
  assessmentScoredInput,
  auditCompletedInput,
  baselineEventPayload,
  CROSS_SURFACE_ID,
  deriveAuditScope,
  deriveQualityMatrix,
  findingAcceptedInput,
  findingResolvedInput,
  implicitAuditBaseline,
  isOpenFinding,
  makeEvent,
  recordedAuditIds,
  resolveKritikLibrary,
  scopedAuditId,
  scopeSummary,
  signalTrippedInput,
  withImplicitBaseline,
  type JournalEvent,
  type KritikLibrary,
  type MaturityLevel,
  type QualityFinding,
  type QualitySection,
} from "@arkaik/schema";

import { foldQualityEvents } from "@/lib/utils/quality";

/**
 * The hosted, events-only write path behind
 * `POST /api/graph/projects/{id}/quality/events` (issue #400, hosted Kritik,
 * part 2 of the stack).
 *
 * This is the pure core: shape validation plus the same all-or-nothing
 * refusal logic `persistMutation` uses for graph ops, with the section and
 * the finding's prior journal events taken as plain arguments rather than
 * read here. That is what keeps this module DB-free (no db/auth imports, no
 * `server-only`) and importable by the DB-free test loader — the route in
 * `app/api/graph/projects/[projectId]/quality/events/route.ts` is the only
 * caller that supplies real data, the same seam
 * `lib/services/github/quality.ts`'s `applyQualityResolutions` uses for the
 * GitHub App's resolution pass.
 *
 * **Events-only, always.** Neither export ever produces or accepts a mutated
 * `QualitySection` — `snapshot.quality` is never rewritten. A finding's
 * stored `status` stays exactly as the last audit left it; what changes is
 * the journal, and `foldQualityEvents` (lib/utils/quality.ts) is what turns
 * an appended event into a finding that reads as resolved or accepted-risk.
 * Same doctrine as the webhook's resolution pass, applied to a second writer.
 *
 * **The whitelist is the point.** Exactly five event types can be appended
 * through this path — `quality.finding.resolved`, `quality.finding.accepted`,
 * `quality.signal.tripped` (issue #406), `quality.assessment.scored` and a
 * scoped `quality.audit.completed` (issue #473) — and nothing else. The first
 * two are decisions; the third is admitted on a different ground, and the
 * difference is what the rule is made of: a trip is append-only *by
 * construction*. It decides nothing, so there is no verdict for it to
 * overwrite, no finding for it to reach, and nothing a second trip can undo.
 * That is why {@link requiredScopeFor} can let a narrower credential send one.
 * The last two are writes of assessment state — a hosted score, and a scoped
 * re-audit's completion — but both are scoped to a re-audit the server can
 * check against the journal, so neither is a general append either: a hosted
 * caller can only ever be recording progress against a re-audit it is
 * actually running, never inventing scores or a roll-up out of thin air (the
 * `scores`/`counts` refusal below is what keeps the roll-up server-computed).
 * This is still not a general event-append surface: the journal's `GET` stays
 * read-only, and every other event type in the schema is written by the
 * mutation pipeline or the webhook, never by a caller naming a type directly.
 */

/** One caller-supplied event, after the whitelist has narrowed its shape. */
export type QualityEventInput =
  | { type: "quality.finding.resolved"; finding_id: string; resolved_by?: string }
  | { type: "quality.finding.accepted"; finding_id: string; reason: string }
  | {
      type: "quality.signal.tripped";
      criterion_id: string;
      surface: string;
      signal: string;
      commit: string;
      detail?: string;
    }
  | {
      type: "quality.assessment.scored";
      criterion_id: string;
      surface: string;
      level: number;
      evidence: string;
      audit_id?: string;
      commit?: string;
    }
  | { type: "quality.audit.completed"; scope: true; audit_id: string; commit?: string };

/**
 * Why one entry in a batch was refused. `index` is the entry's position in
 * the request's `events` array — the one field every refusal carries, since a
 * score or a completion names no finding. `finding_id` is there for the two
 * decision reasons; `detail` says what to do instead, worded the way the MCP
 * words the same refusal in repo mode.
 */
export type QualityEventRefusal = {
  index: number;
  reason:
    | "unknown_finding"
    | "not_open"
    | "invalid_assessment"
    | "out_of_scope"
    | "no_baseline"
    | "not_scored"
    | "already_recorded"
    | "scope_mismatch";
  finding_id?: string;
  detail?: string;
};

const MAX_EVENTS = 50;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isValidLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
}

/**
 * Shape-validate a request body into a batch of {@link QualityEventInput}.
 *
 * Purely structural — it never looks at a finding, a section, or the
 * journal, so it cannot itself refuse `unknown_finding` or `not_open` (that
 * is {@link planQualityEvents}'s job, once real data is available). Returns
 * the parsed batch on success; the return is distinguishable from an error
 * via `Array.isArray`, since a legal batch is never mistaken for
 * `{ error }`.
 *
 * Whitelist: `type` must be `quality.finding.resolved`,
 * `quality.finding.accepted`, `quality.signal.tripped`,
 * `quality.assessment.scored` or a scoped `quality.audit.completed`. `type`
 * is read FIRST and the per-type fields after it, because the shapes share no
 * field across the board — a trip names a criterion, not a finding. On the
 * two finding types: `finding_id` a non-empty string; `resolved_by`, when
 * present, a non-empty string; `reason` a required non-empty string for
 * `accepted`. On a trip: `criterion_id`, `surface`, `signal` and `commit`
 * non-empty strings, `detail` a non-empty string when present. On a scored
 * entry: `criterion_id`, `surface` and `evidence` non-empty strings, `level`
 * an integer 0–4, `audit_id`/`commit` non-empty strings when present. On a
 * scoped audit-completed entry: `scope` must be `true` (this path only ever
 * records a scoped re-audit, never a comprehensive one), `audit_id` a
 * non-empty string, `commit` a non-empty string when present — and `scores`
 * or `counts` on the entry is refused outright, because the server computes
 * both from the journal rather than trusting a caller's roll-up. 1–50
 * entries.
 *
 * `commit` is required here rather than in the schema (where it is optional,
 * because it describes every trip in every mode) — this parser only ever sees
 * the hosted caller class, and that class pays nothing for the anchor.
 */
export function parseQualityEventInputs(body: unknown): QualityEventInput[] | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be an object with an events array" };
  }
  const { events } = body as { events?: unknown };
  if (!Array.isArray(events)) return { error: "events must be an array" };
  if (events.length === 0) return { error: "events must contain at least one entry" };
  if (events.length > MAX_EVENTS) return { error: `events must contain at most ${MAX_EVENTS} entries` };

  const parsed: QualityEventInput[] = [];
  for (const [index, raw] of events.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { error: `events[${index}] must be an object` };
    }
    const entry = raw as Record<string, unknown>;

    if (entry.type === "quality.finding.resolved") {
      if (!isNonEmptyString(entry.finding_id)) {
        return { error: `events[${index}].finding_id must be a non-empty string` };
      }
      if (entry.resolved_by !== undefined && !isNonEmptyString(entry.resolved_by)) {
        return { error: `events[${index}].resolved_by must be a non-empty string when present` };
      }
      parsed.push({
        type: "quality.finding.resolved",
        finding_id: entry.finding_id,
        ...(entry.resolved_by !== undefined ? { resolved_by: entry.resolved_by as string } : {}),
      });
      continue;
    }

    if (entry.type === "quality.finding.accepted") {
      if (!isNonEmptyString(entry.finding_id)) {
        return { error: `events[${index}].finding_id must be a non-empty string` };
      }
      if (!isNonEmptyString(entry.reason)) {
        return { error: `events[${index}].reason must be a non-empty string` };
      }
      parsed.push({ type: "quality.finding.accepted", finding_id: entry.finding_id, reason: entry.reason });
      continue;
    }

    if (entry.type === "quality.signal.tripped") {
      for (const field of ["criterion_id", "surface", "signal", "commit"] as const) {
        if (!isNonEmptyString(entry[field])) {
          return { error: `events[${index}].${field} must be a non-empty string` };
        }
      }
      if (entry.detail !== undefined && !isNonEmptyString(entry.detail)) {
        return { error: `events[${index}].detail must be a non-empty string when present` };
      }
      parsed.push({
        type: "quality.signal.tripped",
        criterion_id: entry.criterion_id as string,
        surface: entry.surface as string,
        signal: entry.signal as string,
        commit: entry.commit as string,
        ...(entry.detail !== undefined ? { detail: entry.detail as string } : {}),
      });
      continue;
    }

    if (entry.type === "quality.assessment.scored") {
      for (const field of ["criterion_id", "surface", "evidence"] as const) {
        if (!isNonEmptyString(entry[field])) {
          return { error: `events[${index}].${field} must be a non-empty string` };
        }
      }
      if (!isValidLevel(entry.level)) {
        return { error: `events[${index}].level must be an integer 0-4` };
      }
      if (entry.audit_id !== undefined && !isNonEmptyString(entry.audit_id)) {
        return { error: `events[${index}].audit_id must be a non-empty string when present` };
      }
      if (entry.commit !== undefined && !isNonEmptyString(entry.commit)) {
        return { error: `events[${index}].commit must be a non-empty string when present` };
      }
      parsed.push({
        type: "quality.assessment.scored",
        criterion_id: entry.criterion_id as string,
        surface: entry.surface as string,
        level: entry.level,
        evidence: entry.evidence as string,
        ...(entry.audit_id !== undefined ? { audit_id: entry.audit_id as string } : {}),
        ...(entry.commit !== undefined ? { commit: entry.commit as string } : {}),
      });
      continue;
    }

    if (entry.type === "quality.audit.completed") {
      if ("scores" in entry || "counts" in entry) {
        return { error: `events[${index}]: scores and counts are computed by the server` };
      }
      if (entry.scope !== true) {
        return { error: `events[${index}].scope must be true — only a scoped re-audit is recorded here` };
      }
      if (!isNonEmptyString(entry.audit_id)) {
        return { error: `events[${index}].audit_id must be a non-empty string` };
      }
      if (entry.commit !== undefined && !isNonEmptyString(entry.commit)) {
        return { error: `events[${index}].commit must be a non-empty string when present` };
      }
      parsed.push({
        type: "quality.audit.completed",
        scope: true,
        audit_id: entry.audit_id,
        ...(entry.commit !== undefined ? { commit: entry.commit as string } : {}),
      });
      continue;
    }

    return {
      error: `events[${index}].type must be quality.finding.resolved, quality.finding.accepted, quality.signal.tripped, quality.assessment.scored or quality.audit.completed`,
    };
  }

  return parsed;
}

/**
 * Plan the journal events one batch of {@link QualityEventInput}s would
 * produce, or refuse the whole batch.
 *
 * `priorEvents` is the project's quality journal as far as this path cares:
 * the finding decisions, the hosted scores (`quality.assessment.scored`) and
 * every recorded `quality.audit.completed`. It is folded over `section` first
 * (`foldQualityEvents`) so every check reads the state the next `GET` would
 * show — "open" is judged post-fold, and a hosted score already sits in its
 * cell — even though `section` itself, the stored snapshot, was never
 * touched. The fold then moves forward entry by entry: each planned decision
 * or score is folded in and appended to a working copy of the journal, so a
 * later entry in the SAME batch sees it. That is what refuses a finding
 * decided twice in one batch, what lets a resolution widen the scope of a
 * score sent after it, and what lets a batch score cells and complete the
 * re-audit in one request.
 *
 * A `quality.signal.tripped` entry skips all of that: it decides nothing, so
 * it consults no finding and can produce no refusal. It is still bound by the
 * batch's fate — a trip sent alongside an entry that is refused is refused
 * with it.
 *
 * **A score (issue #473)** is checked against the pack and the profile the
 * way `kritik_score` checks it in repo mode, then against the scope: hosted
 * scoring is scoped-only, so a cell `deriveAuditScope` does not list is
 * `out_of_scope`, and no recorded reading at all is `no_baseline`. The scope
 * is measured over `withImplicitBaseline` of the STORED section, never the
 * folded one — the baseline is the restored audit's reading, and the stored
 * snapshot is the one copy of it no hosted score has overwritten. The score
 * lands in the scoped audit `scopedAuditId` names (the caller's, else the one
 * already open from the same `since`, else `<YYYY-MM>-scoped[-NN]`, the month
 * read off `now` in UTC).
 *
 * **The baseline is written here, once.** Before the first hosted score folds
 * into `section.assessments`, the implicit reading is still exact; after it,
 * no reader can rebuild the level a re-scored cell had at the audit. So the
 * batch that holds the first accepted score also records that reading for
 * real — backdated to the baseline's own `ts`, flagged `baseline: true`, and
 * put first in the plan. Once it is in the journal the synthesis switches
 * itself off (a recording exists), which is what makes this happen once.
 *
 * **A scoped completion** records the reading of a re-audit already in
 * progress: it must have at least one score (earlier or in this batch), must
 * not already be recorded, and every score in it must share one `since` —
 * the current scope's. The caller never supplies the reading: it is
 * `deriveQualityMatrix` over the section folded through everything, the same
 * numbers the matrix will show.
 *
 * All-or-nothing, mirroring `persistMutation`: any refusal anywhere in the
 * batch refuses every entry, each refusal naming the entry's `index`. No
 * event is planned for a batch that will not fully succeed, so a caller
 * retrying a corrected batch never has to reason about a partial write.
 */
export function planQualityEvents(
  section: QualitySection | undefined,
  priorEvents: readonly JournalEvent[],
  inputs: readonly QualityEventInput[],
  actor: string,
  now: Date = new Date(),
): { ok: true; events: JournalEvent[] } | { ok: false; refusals: QualityEventRefusal[] } {
  const library = resolveKritikLibrary(section);
  const criteria: Pick<KritikLibrary, "criteria"> = library ?? { criteria: [] };
  let working = foldQualityEvents(section, priorEvents);
  // The journal as it will read once this batch lands — grows as entries are
  // planned, so each check sees every entry before it.
  const journal: JournalEvent[] = [...priorEvents];
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  // Over the STORED section: the one copy of the restored audit's levels no
  // hosted score has overwritten, so the synthesized reading is exact.
  const withBaseline = () => withImplicitBaseline(journal, section, library);

  const refusals: QualityEventRefusal[] = [];
  const events: JournalEvent[] = [];

  const plan = (event: JournalEvent) => {
    events.push(event);
    journal.push(event);
    working = foldQualityEvents(working, [event]);
  };

  for (const [index, input] of inputs.entries()) {
    // A trip is handled before the finding lookup because it has no finding to
    // look up: it decides nothing, so there is nothing here to refuse it for.
    if (input.type === "quality.signal.tripped") {
      const trip = signalTrippedInput(input);
      plan(makeEvent(trip.type, trip.payload, { actor }));
      continue;
    }

    if (input.type === "quality.assessment.scored") {
      const invalid = invalidAssessment(section, library, input.criterion_id, input.surface);
      if (invalid !== null) {
        refusals.push({ index, reason: "invalid_assessment", detail: invalid });
        continue;
      }

      const scope = deriveAuditScope(withBaseline(), working ?? { findings: [], assessments: [] }, criteria);
      if (scope.since === null) {
        refusals.push({
          index,
          reason: "no_baseline",
          detail: "No recorded audit and no restored assessments to measure a re-score from — there is nothing for it to be a re-score of.",
        });
        continue;
      }
      const inScope = scope.cells.some((cell) => cell.criterion_id === input.criterion_id && cell.surface === input.surface);
      if (!inScope) {
        refusals.push({
          index,
          reason: "out_of_scope",
          detail:
            `${input.criterion_id} on "${input.surface}" is not in the scoped re-audit (${scopeSummary(scope)}). ` +
            `Hosted scoring only re-scores the cells a fix since the last audit made stale.`,
        });
        continue;
      }

      const since = scope.since;
      const recorded = recordedAuditIds(withBaseline());
      const scored = journal.filter((event) => event?.type === "quality.assessment.scored");
      const known = new Set<string>(recorded);
      for (const assessment of Array.isArray(working?.assessments) ? working.assessments : []) {
        const id = (assessment as { audit_id?: unknown } | null)?.audit_id;
        if (typeof id === "string" && id !== "") known.add(id);
      }
      let open: string | undefined;
      for (const event of scored) {
        const id = (event as { audit_id?: unknown }).audit_id;
        if (typeof id !== "string" || id === "") continue;
        known.add(id);
        if (sinceOf(event) === since && !recorded.includes(id)) open = id;
      }

      let auditId: string;
      try {
        auditId = scopedAuditId({ since, month, requested: input.audit_id, known: [...known], recorded, open });
      } catch (error) {
        refusals.push({ index, reason: "invalid_assessment", detail: (error as Error).message });
        continue;
      }

      // The first hosted score of a restored audit: record its reading for
      // real before this score overwrites a level it is computed from. After
      // the push the journal holds a recording, so this never fires twice.
      const baseline = implicitAuditBaseline(journal, section, library);
      if (baseline !== null) {
        const event = makeEvent("quality.audit.completed", baselineEventPayload(baseline), { ts: baseline.ts, actor });
        events.unshift(event);
        journal.push(event);
      }

      const score = assessmentScoredInput(
        {
          criterion_id: input.criterion_id,
          surface: input.surface,
          level: input.level as MaturityLevel,
          evidence: input.evidence,
          audit_id: auditId,
          ...(input.commit !== undefined ? { commit: input.commit } : {}),
        },
        since,
      );
      plan(makeEvent(score.type, score.payload, { actor }));
      continue;
    }

    if (input.type === "quality.audit.completed") {
      const auditId = input.audit_id;
      if (recordedAuditIds(withBaseline()).includes(auditId)) {
        refusals.push({ index, reason: "already_recorded", detail: `"${auditId}" is already recorded — its reading is history.` });
        continue;
      }
      const scored = journal.filter(
        (event) => event?.type === "quality.assessment.scored" && (event as { audit_id?: unknown }).audit_id === auditId,
      );
      if (scored.length === 0) {
        refusals.push({ index, reason: "not_scored", detail: `No hosted score belongs to "${auditId}" — score a cell in it before recording it.` });
        continue;
      }
      const sinces = new Set(scored.map(sinceOf));
      const current = deriveAuditScope(withBaseline(), working ?? { findings: [], assessments: [] }, criteria).since;
      const [since] = sinces;
      if (sinces.size !== 1 || typeof since !== "string" || since !== current) {
        refusals.push({
          index,
          reason: "scope_mismatch",
          detail:
            `"${auditId}" was scored from ${[...sinces].map((s) => (typeof s === "string" ? `"${s}"` : "no scope")).join(", ")}, ` +
            `but the current scope is measured from ${current === null ? "no recorded audit" : `"${current}"`}.`,
        });
        continue;
      }

      const matrix = deriveQualityMatrix({ quality: working }, library);
      const cells = new Set(
        scored.map((event) => {
          const { criterion_id: criterionId, surface } = event as { criterion_id?: unknown; surface?: unknown };
          return `${String(criterionId)}::${String(surface)}`;
        }),
      ).size;
      const frameworkVersion = matrix.framework_version ?? section?.framework_version ?? library?.version ?? "unknown";
      const reading = auditCompletedInput(matrix, {
        audit_id: auditId,
        framework_version: frameworkVersion,
        ...(input.commit !== undefined ? { commit: input.commit } : {}),
        scope: { partial: true, cells, since },
      });
      plan(makeEvent(reading.type, reading.payload, { actor }));
      continue;
    }

    // Guarded for the same reason the fold is: this is section content nobody
    // has re-validated since it left storage, and a malformed entry must fall
    // out as `unknown_finding`, not surface as a 500.
    const finding = findingOf(working, input.finding_id);
    if (finding === undefined) {
      refusals.push({ index, finding_id: input.finding_id, reason: "unknown_finding" });
      continue;
    }
    // `working` already holds any decision planned earlier in this batch, so
    // a second entry naming the same finding reads as not-open here.
    if (!isOpenFinding(finding)) {
      refusals.push({ index, finding_id: input.finding_id, reason: "not_open" });
      continue;
    }

    const eventInput =
      input.type === "quality.finding.resolved"
        ? findingResolvedInput(finding, input.resolved_by)
        : findingAcceptedInput(finding, input.reason);
    plan(makeEvent(eventInput.type, eventInput.payload, { actor }));
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, events };
}

/** The first finding in `section` with this id — first wins, the fold's own tie-break for a malformed duplicate. */
function findingOf(section: QualitySection | undefined, id: string): QualityFinding | undefined {
  for (const finding of Array.isArray(section?.findings) ? section.findings : []) {
    if ((finding as { id?: unknown } | null)?.id === id) return finding;
  }
  return undefined;
}

/** The `scope.since` a hosted score was measured from, or `undefined` for a malformed row. */
function sinceOf(event: JournalEvent): string | undefined {
  const since = (event as { scope?: { since?: unknown } }).scope?.since;
  return typeof since === "string" && since !== "" ? since : undefined;
}

/**
 * Why a hosted score can't land in `criterionId` × `surface`, or `null` when
 * it can: the same four refusals `kritik_score` makes in repo mode, worded
 * the same way, checked against the STORED section's pack and profile.
 */
function invalidAssessment(
  section: QualitySection | undefined,
  library: KritikLibrary | undefined,
  criterionId: string,
  surface: string,
): string | null {
  const criterion = (library?.criteria ?? []).find((candidate) => candidate?.id === criterionId);
  if (criterion === undefined) {
    return `unknown criterion "${criterionId}" — no criterion by that id in this project's pack.`;
  }
  if (typeof criterion.superseded_by === "string") {
    return (
      `Criterion "${criterionId}" is retired — superseded by "${criterion.superseded_by}". Score that one instead; ` +
      `the old id is kept only so past audits still mean what they meant.`
    );
  }
  if (surface === CROSS_SURFACE_ID) {
    return `"${CROSS_SURFACE_ID}" is a findings-only lens — it carries no matrix column, so a score there would render nowhere.`;
  }
  const declared = (Array.isArray(section?.profile?.surfaces) ? section.profile.surfaces : [])
    .map((candidate) => (candidate as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === "string" && id !== "");
  if (declared.length > 0 && !declared.includes(surface)) {
    return `Surface "${surface}" is not declared in this project's profile. Declared: ${declared.join(", ")}.`;
  }
  const appliesTo = criterion.applies_to;
  if (Array.isArray(appliesTo) && !appliesTo.includes(surface)) {
    return (
      `${criterionId} does not apply to "${surface}" (applies to: ${appliesTo.join(", ")}). ` +
      `Scoring it there would produce a cell nothing rolls up.`
    );
  }
  return null;
}

/**
 * The NARROWEST scope that suffices for this batch — not the only one that
 * does.
 *
 * A trip is append-only by construction, so `quality:append` suffices for a
 * batch of nothing but trips. Any finding decision in the batch is a verdict
 * on the graph's quality state and needs `graph:write` — which is what makes
 * a CI credential in a public repo unable to decide a finding's fate, the
 * bar issue #406 exists to clear.
 *
 * The caller must treat `graph:write` as subsuming `quality:append`, because
 * this returns a floor rather than an exact requirement: a `graph:write`-only
 * agent token appending a trip is asking for LESS than it holds, and refusing
 * it would break every #400 caller the moment it sent an observation. The
 * route does that; a future caller must too.
 */
export function requiredScopeFor(inputs: readonly QualityEventInput[]): "graph:write" | "quality:append" {
  return inputs.every((i) => i.type === "quality.signal.tripped") ? "quality:append" : "graph:write";
}

/**
 * Whether a caller holding `scopes` may send this batch.
 *
 * The subsumption rule, in one place instead of in a route comment: holding
 * `graph:write` is enough for anything this route accepts, including a batch
 * of nothing but trips. {@link requiredScopeFor} returns a floor, and a caller
 * that asks for less than it holds must not be refused — checking the returned
 * scope on its own would 403 every `graph:write`-only agent token (issue #400's
 * callers) the moment it appended an observation.
 */
export function callerMaySendQualityEvents(
  scopes: readonly string[],
  inputs: readonly QualityEventInput[],
): boolean {
  return scopes.includes("graph:write") || scopes.includes(requiredScopeFor(inputs));
}
