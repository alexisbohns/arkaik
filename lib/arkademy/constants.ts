/**
 * The Arkademy's plain constants and the types derived from them: the format,
 * the question keys and entity kinds, the limits and the template tokens.
 * No zod, so a client module (the tour, the paragraph, the tool paths) can
 * import them without pulling the library's validation schema into the
 * browser bundle. lib/arkademy/schema.ts re-exports every name here, so an
 * import from "./schema" keeps working on the server.
 */

export const ARKADEMY_FORMAT_VERSION = 1;
/**
 * Bump this by hand, in the same PR, on any change that makes the schema or
 * the validator stricter WITHOUT a format bump (a new refusal, a tighter
 * limit). It goes into the server's cache key and the route's ETag
 * (lib/services/arkademy.ts), so a deploy never serves a cached document its
 * own schema would refuse, nor answers 304 to a body an older build served.
 * A format bump needs no revision bump: the format is in both already.
 */
export const ARKADEMY_SCHEMA_REVISION = 1;
export const BMC_TOOL_ID = "business-model-canvas";
export type ToolId = typeof BMC_TOOL_ID;

/** Canonical order: the order the questions are asked and the paragraph reads. */
export const BMC_QUESTION_KEYS = ["seg", "vp", "ch", "cr", "rev", "kr", "ka", "kp", "cost"] as const;
export type BmcQuestionKey = (typeof BMC_QUESTION_KEYS)[number];

export const ENTITY_KINDS = [
  "segment",
  "value-proposition",
  "channel",
  "relationship",
  "revenue-stream",
  "resource",
  "activity",
  "partner",
  "cost",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const BMC_QUESTION_KIND = {
  seg: "segment",
  vp: "value-proposition",
  ch: "channel",
  cr: "relationship",
  rev: "revenue-stream",
  kr: "resource",
  ka: "activity",
  kp: "partner",
  cost: "cost",
} as const satisfies Record<BmcQuestionKey, EntityKind>;

export const ANSWER_MAX_LENGTH = 140;
export const MAX_ANSWERS_PER_QUESTION = 5;
export const MAX_DOCUMENT_BYTES = 1_048_576; // 1 MiB of JSON text
export const PROMPT_TOKEN = "{{paragraph}}";
export const NOTE_MAX_LENGTH = 200;
/** A note's date is the one its source carries, or the day an undated page was read. */
export const NOTE_DATE_KINDS = ["published", "accessed"] as const;
export type NoteDateKind = (typeof NOTE_DATE_KINDS)[number];

/** The two tokens a sentence template may hold: the subject, and the joined answers. */
export const SUBJECT_TOKEN = "{S}";
export const LIST_TOKEN = "{L}";
