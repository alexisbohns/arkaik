/**
 * The hosted write path for the backlog: `idea.proposed` and `request.filed`,
 * the two journal-only events — an event with no graph change behind it, so
 * nothing `/mutations` can derive from ops (docs/spec/services.md § Hosted
 * Graph Projects → Write contract).
 *
 * Two pure halves, like `weighing-events.ts`: a parser that turns a request
 * body into typed entries (a shape error is a 400), and a planner that stamps
 * and validates them against the project's nodes (a refusal is a 422 naming
 * each entry's `index`). The hosted route is their only caller today; the
 * repo store reaches the same events through `toJournalEvents` and the whole-
 * bundle validator, and the planner checks the same things that validator
 * would refuse a backlog event for.
 */

import { makeEvent } from "./emit";
import type { JournalEvent } from "./journal";
import type { ValidationFinding } from "./validate";

/** The only event types the hosted journal append accepts. */
export const BACKLOG_EVENT_TYPES = ["idea.proposed", "request.filed"] as const;
export type BacklogEventType = (typeof BACKLOG_EVENT_TYPES)[number];

/** What one request may carry. A batch is a few signals, never a migration. */
export const BACKLOG_WRITE_LIMITS = { maxEvents: 50 } as const;

/** The envelope the server stamps; a body that carries one is refused. */
const STAMPED_FIELDS = ["id", "ts", "actor"] as const;

/** One parsed entry: its type and its payload, envelope-free. */
export interface BacklogEventInput {
  type: BacklogEventType;
  payload: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `{ events: [...] }` → typed entries, or the first shape error. Only the two
 * backlog types pass; the envelope (`id`, `ts`, `actor`) is the server's to
 * stamp, so a body that claims one is an error rather than silently overwritten.
 */
export function parseBacklogEventInputs(body: unknown): BacklogEventInput[] | { error: string } {
  if (!isObject(body)) return { error: "body must be an object with an events array" };
  const { events } = body as { events?: unknown };
  if (!Array.isArray(events)) return { error: "events must be an array" };
  if (events.length === 0) return { error: "events must contain at least one entry" };
  if (events.length > BACKLOG_WRITE_LIMITS.maxEvents) {
    return { error: `events must contain at most ${BACKLOG_WRITE_LIMITS.maxEvents} entries` };
  }

  const parsed: BacklogEventInput[] = [];
  for (const [index, raw] of events.entries()) {
    if (!isObject(raw)) return { error: `events[${index}] must be an object` };
    const { type, ...payload } = raw;
    if (!(BACKLOG_EVENT_TYPES as readonly unknown[]).includes(type)) {
      return { error: `events[${index}].type must be ${BACKLOG_EVENT_TYPES.join(" or ")}` };
    }
    for (const stamped of STAMPED_FIELDS) {
      if (stamped in payload) return { error: `events[${index}].${stamped} is stamped by the server — remove it` };
    }
    parsed.push({ type: type as BacklogEventType, payload });
  }
  return parsed;
}

export type BacklogRefusalReason = "invalid_entry" | "unknown_node";

/** Why one entry was refused. `index` is its position in the request's `events`. */
export interface BacklogRefusal {
  index: number;
  reason: BacklogRefusalReason;
  detail: string;
}

export type BacklogPlan =
  | { ok: true; events: JournalEvent[]; warnings: ValidationFinding[] }
  | { ok: false; refusals: BacklogRefusal[] };

export interface BacklogPlanOptions {
  /** Stamped as the event's `actor`. */
  actor: string;
  /** Event time; defaults to now. */
  ts?: string;
}

/**
 * Stamp and check a batch. All or nothing: any refusal refuses the batch.
 *
 * - Each entry goes through `makeEvent`, so it is checked by the same zod
 *   schema every writer uses (a `title` is required, `source_kind` and
 *   `provenance` are closed vocabularies).
 * - `node_id` must name a node of the project: the bundle validator refuses a
 *   dangling node reference in the journal, and this is that check.
 * - `stake_ids` naming no node is a warning, as it is in the validator: the
 *   ids are a fact about filing time, and a stake can be deleted later.
 */
export function planBacklogEvents(
  nodes: readonly { id?: unknown }[],
  inputs: readonly BacklogEventInput[],
  options: BacklogPlanOptions,
): BacklogPlan {
  const nodeIds = new Set(nodes.map((n) => n?.id).filter((id): id is string => typeof id === "string"));
  const ts = options.ts ?? new Date().toISOString();
  const refusals: BacklogRefusal[] = [];
  const warnings: ValidationFinding[] = [];
  const events: JournalEvent[] = [];

  inputs.forEach((input, index) => {
    let event: JournalEvent;
    try {
      event = makeEvent(input.type, input.payload, { actor: options.actor, ts });
    } catch (err) {
      const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      const detail = issues?.length
        ? issues.map((i) => `${i.path.join(".") || "entry"}: ${i.message}`).join("; ")
        : err instanceof Error ? err.message : "invalid entry";
      refusals.push({ index, reason: "invalid_entry", detail });
      return;
    }

    const nodeId = (event as { node_id?: unknown }).node_id;
    if (typeof nodeId === "string" && !nodeIds.has(nodeId)) {
      refusals.push({ index, reason: "unknown_node", detail: `node_id "${nodeId}" is not a node of this project` });
      return;
    }

    const stakeIds = (event as { stake_ids?: unknown }).stake_ids;
    if (Array.isArray(stakeIds)) {
      stakeIds.forEach((id, i) => {
        if (typeof id === "string" && !nodeIds.has(id)) {
          warnings.push({
            path: `events[${index}].stake_ids[${i}]`,
            rule: "journal-dangling-stake-ref",
            message: `events[${index}] (${event.type}): names stake "${id}", which is not a node of this project.`,
            severity: "warning",
          });
        }
      });
    }
    events.push(event);
  });

  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, events, warnings };
}
