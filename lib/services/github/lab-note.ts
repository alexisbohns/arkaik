import "server-only";

import { makeEvent, type DeliverableShippedEvent } from "@arkaik/schema";

import { query } from "@/lib/services/db";
import { appendJournalEvents } from "@/lib/services/graph/store";
import { extractLabNoteYaml, parseLabNote, type LabNote } from "@/lib/services/github/lab-note-parse";
import { linkedProjects, ownerIdsFor, type PullRequestEvent } from "@/lib/services/github/pull-request";

/**
 * The Lab-Note-into-journal half of a merged-PR delivery (slice 3).
 *
 * Independent of acceptance promotion by design: a refused note never blocks
 * a status transition, and vice versa. Parse problems are OUTCOMES (logged,
 * reported in the delivery response, never fatal); only infrastructure
 * failures throw, so the webhook's existing claim-release/retry covers them —
 * and the content dedupe below makes the retry safe after a partial append.
 */
export type LabNoteOutcome =
  | { projectId: string; status: "appended"; eventId: string }
  | { projectId: string; status: "unchanged" }
  | { status: "no_note" }
  | { status: "invalid"; error: string };

export async function applyLabNote(event: PullRequestEvent): Promise<LabNoteOutcome[]> {
  const yaml = extractLabNoteYaml(event.body);
  if (yaml === null) return [{ status: "no_note" }];
  const parsed = parseLabNote(yaml);
  if (!parsed.ok) {
    console.warn(`[lab-note] ${event.repoFullName}#${event.number}: ${parsed.error}`);
    return [{ status: "invalid", error: parsed.error }];
  }

  // One event per linked PROJECT — a monorepo's several path-scoped links to
  // one repository still produce exactly one. Deliverables are repo-level, so
  // path scoping does not gate the note the way it gates promotions.
  const projectIds = [...new Set((await linkedProjects(event.repoFullName)).map((r) => r.projectId))];
  const outcomes: LabNoteOutcome[] = [];
  for (const projectId of projectIds) {
    outcomes.push(await appendToProject(projectId, event, parsed.note));
  }
  return outcomes;
}

/**
 * Deterministic serialization for the dedupe comparison. Plain
 * `JSON.stringify` would be order-sensitive, and the stored side has been
 * through Postgres `jsonb`, which does NOT preserve key order — the very
 * first redelivery would look like an edit.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
  return `{${entries.join(",")}}`;
}

/** The fields whose equality means "this re-delivery brings nothing new". */
function contentKey(payload: { title?: string; summary?: string; url?: string; lab_note?: LabNote }): string {
  return canonical([payload.title ?? null, payload.summary ?? null, payload.url ?? null, payload.lab_note ?? null]);
}

async function appendToProject(projectId: string, event: PullRequestEvent, note: LabNote): Promise<LabNoteOutcome> {
  const deliverableId = `pr-${event.number}`;
  const payload = {
    deliverable_id: deliverableId,
    title: note.en.title,
    summary: note.en.summary,
    url: event.url,
    lab_note: note,
  };

  // Latest occurrence for this deliverable — byte-identical content is a
  // redelivery, not an edit, and must not grow the journal.
  const { rows } = await query<{ event: DeliverableShippedEvent }>(
    `select event from graph_events
      where project_id = $1 and event->>'type' = 'deliverable.shipped' and event->>'deliverable_id' = $2
      order by seq desc limit 1`,
    [projectId, deliverableId],
  );
  if (rows.length > 0) {
    const prev = rows[0].event;
    if (contentKey({ title: prev.title, summary: prev.summary, url: prev.url, lab_note: prev.lab_note as LabNote }) === contentKey(payload)) {
      return { projectId, status: "unchanged" };
    }
  }

  const journalEvent = makeEvent("deliverable.shipped", payload, { actor: "github-app" });
  const ownerIds = await ownerIdsFor(projectId);
  const result = await appendJournalEvents(projectId, ownerIds, [journalEvent], "github-app");
  if (!result.ok) {
    console.warn(`[lab-note] ${projectId}: append refused (${result.reason})`);
    return { projectId, status: "unchanged" };
  }
  return { projectId, status: "appended", eventId: journalEvent.id };
}
