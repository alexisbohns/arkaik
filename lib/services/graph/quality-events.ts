import {
  findingAcceptedInput,
  findingResolvedInput,
  isOpenFinding,
  makeEvent,
  signalTrippedInput,
  type JournalEvent,
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

/** Why one finding in a batch was refused. */
export type QualityEventRefusal = {
  finding_id: string;
  reason: "unknown_finding" | "not_open";
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
 * `priorEvents` is folded over `section` first (`foldQualityEvents`) so
 * "open" is judged post-fold: a finding a prior `quality.finding.resolved`
 * or `quality.finding.accepted` event already decided reads as not-open here
 * exactly the way it would on the next `GET`, even though `section` itself —
 * the stored snapshot — was never touched. A finding decided earlier in the
 * SAME batch is refused the same way, via `decidedInBatch`, so two entries
 * naming the same finding cannot both succeed.
 *
 * A `quality.signal.tripped` entry skips all of that: it decides nothing, so
 * it consults no finding and can produce no refusal. It is still bound by the
 * batch's fate — a trip sent alongside a finding decision that is refused is
 * refused with it.
 *
 * All-or-nothing, mirroring `persistMutation`: any refusal — one unknown id,
 * one not-open finding, anywhere in the batch — refuses every entry. No
 * event is planned for a batch that will not fully succeed, so a caller
 * retrying a corrected batch never has to reason about a partial write.
 */
export function planQualityEvents(
  section: QualitySection | undefined,
  priorEvents: readonly JournalEvent[],
  inputs: readonly QualityEventInput[],
  actor: string,
): { ok: true; events: JournalEvent[] } | { ok: false; refusals: QualityEventRefusal[] } {
  const folded = foldQualityEvents(section, priorEvents);
  // Guarded entry-by-entry for the same reason the fold is: this is section
  // content nobody has re-validated since it left storage, and a malformed
  // entry must fall out as `unknown_finding`, not surface as a 500.
  const findings = new Map<string, QualityFinding>();
  for (const finding of Array.isArray(folded?.findings) ? folded.findings : []) {
    const id = (finding as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id !== "" && !findings.has(id)) findings.set(id, finding);
  }

  const refusals: QualityEventRefusal[] = [];
  const events: JournalEvent[] = [];
  const decidedInBatch = new Set<string>();

  for (const input of inputs) {
    // A trip is handled before the finding lookup because it has no finding to
    // look up: it decides nothing, so `unknown_finding`, `not_open` and
    // `decidedInBatch` all have nothing to say about it.
    if (input.type === "quality.signal.tripped") {
      const trip = signalTrippedInput(input);
      events.push(makeEvent(trip.type, trip.payload, { actor }));
      continue;
    }

    // `quality.assessment.scored` and a scoped `quality.audit.completed` are
    // parsed (Task 9, issue #473) but not yet planned — that is Task 10's
    // job, once `priorEvents` carries scores and audits to check a scoped
    // re-audit against. Refusing loudly here, rather than falling through to
    // `input.finding_id` (which neither new type has), is what keeps this
    // function's narrowing sound in the meantime.
    if (input.type === "quality.assessment.scored" || input.type === "quality.audit.completed") {
      throw new Error("not planned yet");
    }

    const finding = findings.get(input.finding_id);
    if (finding === undefined) {
      refusals.push({ finding_id: input.finding_id, reason: "unknown_finding" });
      continue;
    }
    if (!isOpenFinding(finding) || decidedInBatch.has(finding.id)) {
      refusals.push({ finding_id: input.finding_id, reason: "not_open" });
      continue;
    }
    decidedInBatch.add(finding.id);

    const eventInput =
      input.type === "quality.finding.resolved"
        ? findingResolvedInput(finding, input.resolved_by)
        : findingAcceptedInput(finding, input.reason);
    events.push(makeEvent(eventInput.type, eventInput.payload, { actor }));
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, events };
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
