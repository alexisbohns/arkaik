/**
 * Zod schemas for journal events (docs/spec/journal.md § Event Vocabulary).
 *
 * The zod half of the journal (the zod-free half — types, ordering, JSONL
 * parsing, cross-check — lives in journal.ts). {@link JournalEventSchema} is
 * the lenient envelope the bundle embeds: it validates `id`/`ts`/`type` and
 * preserves every other field via `.catchall`, so unknown `type` values and
 * forward-compatible fields survive a parse→rewrite round-trip. The per-type
 * schemas model the v1 vocabulary for consumers who want to strictly validate a
 * known event; they too keep unknown fields, so forward-compat data is never
 * stripped even from a recognized event.
 */

import { z } from "zod";
import { EdgeTypeSchema, PlatformSchema, SpeciesSchema, StatusSchema } from "./enums";
import type { JournalEvent } from "./journal";

/** Shared envelope fields (docs/spec/journal.md § Event Envelope). */
const envelope = {
  id: z.string().meta({ description: "ULID — sortable, collision-free without coordination." }),
  ts: z.string().meta({ description: "ISO 8601 timestamp." }),
  actor: z.string().optional().meta({ description: "Who/what wrote it (e.g. \"claude-code\", \"ci\")." }),
  v: z.number().int().optional().meta({ description: "Reserved per-event payload version; absent today." }),
};

/**
 * The lenient event envelope embedded in a bundle's `journal[]`. Validates the
 * envelope, tolerates unknown `type` values, and preserves unknown fields
 * (forward compatibility). Events carry no `project_id`.
 */
export const JournalEventSchema: z.ZodType<JournalEvent> = z
  .object({
    ...envelope,
    type: z.string().meta({ description: "Event type — the v1 vocabulary in docs/spec/journal.md, or an unknown forward-compatible value." }),
  })
  .catchall(z.unknown())
  .meta({
    id: "JournalEvent",
    description:
      "One append-only journal event. Type-specific payload fields sit flat on the object; unknown types and fields are preserved on rewrite (forward compatibility). See docs/spec/journal.md.",
  });

export const NodeCreatedEventSchema = z
  .object({ ...envelope, type: z.literal("node.created"), node_id: z.string(), species: SpeciesSchema, title: z.string() })
  .catchall(z.unknown());

export const NodeUpdatedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("node.updated"),
    node_id: z.string(),
    fields: z.array(z.string()),
    from: z.unknown().optional(),
    to: z.unknown().optional(),
  })
  .catchall(z.unknown());

export const NodeStatusChangedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("node.status_changed"),
    node_id: z.string(),
    from: StatusSchema,
    to: StatusSchema,
    platform: PlatformSchema.optional(),
  })
  .catchall(z.unknown());

export const NodeDeletedEventSchema = z
  .object({ ...envelope, type: z.literal("node.deleted"), node_id: z.string() })
  .catchall(z.unknown());

export const EdgeAddedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("edge.added"),
    edge_id: z.string(),
    source_id: z.string(),
    target_id: z.string(),
    edge_type: EdgeTypeSchema,
  })
  .catchall(z.unknown());

export const EdgeRemovedEventSchema = z
  .object({ ...envelope, type: z.literal("edge.removed"), edge_id: z.string() })
  .catchall(z.unknown());

export const ReleaseTaggedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("release.tagged"),
    version: z.string(),
    notes: z.string().optional(),
    platform: PlatformSchema.optional(),
  })
  .catchall(z.unknown());

export const IdeaProposedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("idea.proposed"),
    title: z.string(),
    description: z.string().optional(),
    node_id: z.string().optional(),
  })
  .catchall(z.unknown());

export const RequestFiledEventSchema = z
  .object({
    ...envelope,
    type: z.literal("request.filed"),
    title: z.string(),
    description: z.string().optional(),
    source: z.string().optional(),
    node_id: z.string().optional(),
  })
  .catchall(z.unknown());

export const RefAddedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("ref.added"),
    node_id: z.string(),
    ref_id: z.string(),
    ref_type: z.string(),
    url: z.string(),
  })
  .catchall(z.unknown());

export const RefRemovedEventSchema = z
  .object({ ...envelope, type: z.literal("ref.removed"), node_id: z.string(), ref_id: z.string() })
  .catchall(z.unknown());

export const RefStatusChangedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("ref.status_changed"),
    node_id: z.string(),
    ref_id: z.string(),
    from: z.string().optional(),
    to: z.string(),
    synced_at: z.string(),
  })
  .catchall(z.unknown());

/** Per-type schemas keyed by `type`, for validating a single known event. */
export const JOURNAL_EVENT_SCHEMAS = {
  "node.created": NodeCreatedEventSchema,
  "node.updated": NodeUpdatedEventSchema,
  "node.status_changed": NodeStatusChangedEventSchema,
  "node.deleted": NodeDeletedEventSchema,
  "edge.added": EdgeAddedEventSchema,
  "edge.removed": EdgeRemovedEventSchema,
  "release.tagged": ReleaseTaggedEventSchema,
  "idea.proposed": IdeaProposedEventSchema,
  "request.filed": RequestFiledEventSchema,
  "ref.added": RefAddedEventSchema,
  "ref.removed": RefRemovedEventSchema,
  "ref.status_changed": RefStatusChangedEventSchema,
} as const;

/**
 * Strict union of every known v1 event. Rejects unknown `type` values — use it
 * only when you deliberately want that; the bundle itself embeds the lenient
 * {@link JournalEventSchema} so unknown types round-trip.
 */
export const KnownJournalEventSchema = z.union([
  NodeCreatedEventSchema,
  NodeUpdatedEventSchema,
  NodeStatusChangedEventSchema,
  NodeDeletedEventSchema,
  EdgeAddedEventSchema,
  EdgeRemovedEventSchema,
  ReleaseTaggedEventSchema,
  IdeaProposedEventSchema,
  RequestFiledEventSchema,
  RefAddedEventSchema,
  RefRemovedEventSchema,
  RefStatusChangedEventSchema,
]);
