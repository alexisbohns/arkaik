import {
  findingAcceptedInput,
  findingResolvedInput,
  isOpenFinding,
  makeEvent,
  type JournalEvent,
  type QualityFinding,
  type QualitySection,
} from "@arkaik/schema";

import { foldFindingEvents } from "@/lib/utils/quality";

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
 * the journal, and `foldFindingEvents` (lib/utils/quality.ts) is what turns
 * an appended event into a finding that reads as resolved or accepted-risk.
 * Same doctrine as the webhook's resolution pass, applied to a second writer.
 *
 * **The whitelist is the point.** Exactly two event types can be appended
 * through this path — `quality.finding.resolved` and
 * `quality.finding.accepted` — and nothing else. This is not a general
 * event-append surface: the journal's `GET` stays read-only, and every other
 * event type in the schema is written by the mutation pipeline or the
 * webhook, never by a caller naming a type directly.
 */

/** One caller-supplied event, after the whitelist has narrowed its shape. */
export type QualityEventInput =
  | { type: "quality.finding.resolved"; finding_id: string; resolved_by?: string }
  | { type: "quality.finding.accepted"; finding_id: string; reason: string };

/** Why one finding in a batch was refused. */
export type QualityEventRefusal = {
  finding_id: string;
  reason: "unknown_finding" | "not_open";
};

const MAX_EVENTS = 50;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
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
 * Whitelist: `type` must be `quality.finding.resolved` or
 * `quality.finding.accepted`; `finding_id` a non-empty string on both;
 * `resolved_by`, when present, a non-empty string; `reason` a required
 * non-empty string for `accepted`. 1–50 entries.
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
    if (!isNonEmptyString(entry.finding_id)) {
      return { error: `events[${index}].finding_id must be a non-empty string` };
    }

    if (entry.type === "quality.finding.resolved") {
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
      if (!isNonEmptyString(entry.reason)) {
        return { error: `events[${index}].reason must be a non-empty string` };
      }
      parsed.push({ type: "quality.finding.accepted", finding_id: entry.finding_id, reason: entry.reason });
      continue;
    }

    return { error: `events[${index}].type must be quality.finding.resolved or quality.finding.accepted` };
  }

  return parsed;
}

/**
 * Plan the journal events one batch of {@link QualityEventInput}s would
 * produce, or refuse the whole batch.
 *
 * `priorEvents` is folded over `section` first (`foldFindingEvents`) so
 * "open" is judged post-fold: a finding a prior `quality.finding.resolved`
 * or `quality.finding.accepted` event already decided reads as not-open here
 * exactly the way it would on the next `GET`, even though `section` itself —
 * the stored snapshot — was never touched. A finding decided earlier in the
 * SAME batch is refused the same way, via `decidedInBatch`, so two entries
 * naming the same finding cannot both succeed.
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
  const folded = foldFindingEvents(section, priorEvents);
  const findings = new Map<string, QualityFinding>(
    (Array.isArray(folded?.findings) ? folded.findings : []).map((finding) => [finding.id, finding]),
  );

  const refusals: QualityEventRefusal[] = [];
  const events: JournalEvent[] = [];
  const decidedInBatch = new Set<string>();

  for (const input of inputs) {
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
