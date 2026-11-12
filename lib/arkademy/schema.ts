import { z } from "zod";

/**
 * The Arkademy library document: one versioned JSON document that holds every
 * tool, example company, entity and use (docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md
 * § "The library document"). The owner edits it outside the repository and
 * uploads it with `npm run arkademy -- publish`; the app reads it back from
 * Postgres through lib/services/arkademy.ts.
 *
 * Every module in lib/arkademy/ imports only `zod` and its siblings by
 * relative path — never `@/…` — so tests/app/load-arkademy.js can transpile
 * the folder by discovery with no alias table. Keep it that way: an `@/`
 * import here fails that loader on purpose.
 *
 * The interfaces below are the contract; the zod schema implements them with
 * `z.strictObject` everywhere, so an unknown key is an error at upload (a typo
 * must not silently drop data). `SchemaMatchesTypes` at the end makes `tsc`
 * fail if the two ever disagree.
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

export interface ArkademyDocument {
  formatVersion: 1;
  tools: [BmcTool]; // format 1 holds exactly one tool
  companies: Company[]; // 1–100
  entities: Entity[]; // 0–5000
  uses: Use[]; // 0–10000
  open: OpenQuestion[]; // questions an example leaves open on purpose
}

export interface BmcTool {
  id: "business-model-canvas";
  title: string; // 1–60, e.g. "Business Model Canvas"
  tagline: string; // 1–160, the shell card and the meta description
  pitch: {
    headline: string; // 1–120
    body: string[]; // 1–6 paragraphs, each 1–800
  };
  prompt: {
    label: string; // 1–60, the block's title on the cover
    text: string; // 1–4000, newlines allowed, PROMPT_TOKEN at most once
  };
  questions: BmcQuestion[]; // exactly nine, keys in BMC_QUESTION_KEYS order
  examples: string[]; // company ids, 1–24, unique: gallery and tour order
}

export interface BmcQuestion {
  key: BmcQuestionKey;
  block: string; // 1–40, the canvas block title, "Customer segments"
  prompt: string; // 1–160, the question, "Who is this for?"
  hint: string; // 0–300, shown under the question
  gap: string; // 1–60, completes "open: …", "who it is for"
  sentence: string; // 1–160, template, see the spec's § "The paragraph"
  sentencePlural?: string; // 1–160, used when the question has two answers or more
}

export interface Company {
  id: string; // slug
  name: string; // 1–40, opens sentences: "Notion is for …"
  oneLiner: string; // 1–200
  simulation: boolean; // true: built from public information, not the company's records
  note?: string; // 1–400, shown wherever the example is shown
}

export interface Entity {
  id: string; // slug, permanent once published
  kind: EntityKind;
  label: string; // neutral wording
}

export interface Use {
  tool: ToolId;
  company: string; // Company.id
  question: BmcQuestionKey;
  entity: string; // Entity.id
  text: string; // this company's own wording
  order: number; // integer ≥ 0, ascending within (tool, company, question)
  note?: UseNote; // a sourced fact about this company's case
}

/**
 * A fact about one company's use, never about the entity: a figure, a date, a
 * named supplier — anything a reader could ask "says who?" about. It always
 * has a source a reader can open.
 */
export interface UseNote {
  text: string; // 1–200, the fact, "about $5.6B in the second quarter of 2026"
  source: {
    name: string; // 1–80, no parentheses, who says so, "Anthropic, press release"
    url: string; // https only, the page that states it
    date: string; // YYYY-MM-DD
    dateKind: NoteDateKind; // the page's own date, or the day an undated page was read
  };
}

export interface OpenQuestion {
  tool: ToolId;
  company: string;
  question: BmcQuestionKey;
}

// ---------------------------------------------------------------------------
// Field rules
// ---------------------------------------------------------------------------

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WORDING_BAD_ENDING = /[.!?;:,]$/;

/**
 * Characters no text field may hold, whatever it is, with the name the error
 * message gives them. Postgres refuses NUL in `jsonb`; the rest are invisible
 * or reorder what a reader sees, so they would pass the trim and single-line
 * rules while breaking the page:
 *
 * - C0 controls U+0000–U+001F except tab (U+0009) and newline (U+000A), which
 *   only multi-line fields accept (so a carriage return is refused everywhere);
 * - DEL U+007F and the C1 controls U+0080–U+009F;
 * - U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR;
 * - zero-width and invisible format characters: U+200B–U+200D, U+2060–U+2064,
 *   U+FEFF, U+180E;
 * - bidirectional controls: U+061C, U+200E, U+200F, U+202A–U+202E,
 *   U+2066–U+2069.
 *
 * Everything else is allowed, including no-break spaces (U+00A0, U+202F) and
 * well-formed astral characters such as emoji. Ill-formed UTF-16 (a lone
 * surrogate) is refused separately, by {@link textCharacterProblem}.
 */
const FORBIDDEN_CHARACTERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u0000-\u0008\u000B-\u001F]/, "a control character"],
  [/[\u007F-\u009F]/, "a control character"],
  [/[\u2028\u2029]/, "a line or paragraph separator"],
  [/[\u200B-\u200D\u2060-\u2064\uFEFF\u180E]/, "an invisible zero-width character"],
  [/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/, "a bidirectional control character"],
];

const codePoint = (char: string) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

/** The first lone surrogate in `value`, or null when it is well-formed UTF-16. */
function loneSurrogate(value: string): string | null {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return value[index];
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return value[index];
  }
  return null;
}

/**
 * Why `value` cannot be a text field, as a message that names the offending
 * code point (never the text around it), or null when every character is
 * allowed. `multiline` fields also accept a newline and a tab.
 */
export function textCharacterProblem(value: string, options: { multiline?: boolean } = {}): string | null {
  if (!options.multiline && /[\r\n]/.test(value)) return "must be a single line";
  const lone = loneSurrogate(value);
  if (lone !== null) return `must not contain ${codePoint(lone)}, a lone surrogate (the text is not well-formed)`;
  for (const [pattern, name] of FORBIDDEN_CHARACTERS) {
    const found = pattern.exec(value);
    if (found) return `must not contain ${codePoint(found[0])}, ${name}`;
  }
  if (!options.multiline && value.includes("\t")) return "must not contain U+0009, a tab (only multi-line fields take one)";
  return null;
}

/**
 * A trimmed text field of `min`–`max` characters. Single-line unless
 * `multiline` (only `pitch.body[]` and `prompt.text` are). Every text field
 * refuses the characters listed at {@link FORBIDDEN_CHARACTERS}.
 */
function text(min: number, max: number, options: { multiline?: boolean } = {}) {
  const base = z
    .string()
    .min(min)
    .max(max)
    .refine((value) => value === value.trim(), { message: "must not start or end with whitespace" });
  const singleLine = options.multiline
    ? base
    : base.refine((value) => !/[\r\n]/.test(value), { message: "must be a single line" });
  return singleLine.superRefine((value, ctx) => {
    const problem = textCharacterProblem(value, options);
    if (problem !== null && problem !== "must be a single line") ctx.addIssue({ code: "custom", message: problem });
  });
}

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(SLUG, { message: "must be a slug: lowercase letters and digits, words joined by single hyphens" });

/** `Use.text` and `Entity.label`: the wording rules. */
const wording = text(1, ANSWER_MAX_LENGTH).refine((value) => !WORDING_BAD_ENDING.test(value), {
  message: "must not end with . ! ? ; : or ,",
});

/** Whether `value` is a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Why `value` cannot be a note's source link, or null when it can. The rule:
 * it parses as a WHATWG URL with the `https:` protocol, carries no username
 * or password, and is written exactly as `new URL(value).href` writes it, the
 * one exception being a bare origin (no path, query or fragment), which may
 * leave out its trailing slash. So a lowercase scheme and host, no default
 * port, no dot segments, and every space or non-ASCII character
 * percent-encoded. The messages name the rule, never the URL.
 */
export function sourceUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an https URL";
  }
  if (url.protocol !== "https:") return "must be an https URL";
  if (url.username !== "" || url.password !== "" || /^[^/?#]*\/\/[^/?#]*@/.test(value)) {
    return "must not carry a username or password";
  }
  const bareOrigin = url.pathname === "/" && url.search === "" && url.hash === "" && url.href === `${value}/`;
  if (url.href !== value && !bareOrigin) {
    return "must be written in its normalised form (lowercase scheme and host, no default port, no dot segments, spaces and non-ASCII characters percent-encoded)";
  }
  return null;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Every rule a sentence template breaks, as messages. Empty when it is sound. */
export function templateProblems(template: string): string[] {
  const problems: string[] = [];
  const lists = count(template, LIST_TOKEN);
  const subjects = count(template, SUBJECT_TOKEN);
  if (lists !== 1) problems.push(`must contain ${LIST_TOKEN} exactly once (found ${lists})`);
  if (subjects > 1) problems.push(`must contain ${SUBJECT_TOKEN} at most once (found ${subjects})`);
  if (subjects === 1 && !template.startsWith(SUBJECT_TOKEN)) {
    problems.push(`${SUBJECT_TOKEN} must open the template`);
  }
  if (template.startsWith(LIST_TOKEN)) problems.push(`must not start with ${LIST_TOKEN}`);
  // Every brace must belong to exactly {S} or {L}: take those out, then any
  // other {…} is an unknown token and any brace left over is a stray one
  // (`{{L}}`, a lone `{`), which would show in the paragraph.
  const rest = template.split(SUBJECT_TOKEN).join("").split(LIST_TOKEN).join("");
  const unknown = rest.match(/\{[^{}]+\}/g) ?? [];
  if (unknown.length > 0) problems.push(`unknown token ${unknown[0]}`);
  if (/[{}]/.test(rest.replace(/\{[^{}]+\}/g, ""))) {
    problems.push(`has a stray brace: every { or } must belong to ${SUBJECT_TOKEN} or ${LIST_TOKEN}`);
  }
  return problems;
}

const template = text(1, 160).superRefine((value, ctx) => {
  for (const message of templateProblems(value)) ctx.addIssue({ code: "custom", message });
});

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

const bmcQuestionSchema = z
  .strictObject({
    key: z.enum(BMC_QUESTION_KEYS),
    block: text(1, 40),
    prompt: text(1, 160),
    hint: text(0, 300),
    gap: text(1, 60),
    sentence: template,
    sentencePlural: template.optional(),
  })
  .superRefine((question, ctx) => {
    if (question.sentencePlural === undefined) return;
    const singular = question.sentence.includes(SUBJECT_TOKEN);
    const plural = question.sentencePlural.includes(SUBJECT_TOKEN);
    if (singular !== plural) {
      ctx.addIssue({
        code: "custom",
        path: ["sentencePlural"],
        message: `must use ${SUBJECT_TOKEN} if and only if sentence does`,
      });
    }
  });

const bmcToolSchema = z.strictObject({
  id: z.literal(BMC_TOOL_ID),
  title: text(1, 60),
  tagline: text(1, 160),
  pitch: z.strictObject({
    headline: text(1, 120),
    body: z.array(text(1, 800, { multiline: true })).min(1).max(6),
  }),
  prompt: z.strictObject({
    label: text(1, 60),
    text: text(1, 4000, { multiline: true }).refine((value) => count(value, PROMPT_TOKEN) <= 1, {
      message: `must contain ${PROMPT_TOKEN} at most once`,
    }),
  }),
  questions: z.array(bmcQuestionSchema).length(BMC_QUESTION_KEYS.length),
  examples: z.array(slug).min(1).max(24),
});

const companySchema = z.strictObject({
  id: slug,
  name: text(1, 40),
  oneLiner: text(1, 200),
  simulation: z.boolean(),
  note: text(1, 400).optional(),
});

const entitySchema = z.strictObject({
  id: slug,
  kind: z.enum(ENTITY_KINDS),
  label: wording,
});

/**
 * A note is set inside parentheses after its answer, so it holds none of its
 * own and does not end in punctuation. Whether its date is in the future is a
 * warning in validate.ts: it depends on the clock.
 */
const useNoteSchema = z.strictObject({
  text: text(1, NOTE_MAX_LENGTH)
    .refine((value) => !/[()]/.test(value), { message: "must not contain parentheses" })
    .refine((value) => !WORDING_BAD_ENDING.test(value), { message: "must not end with . ! ? ; : or ," }),
  source: z.strictObject({
    // Set inside the note's parentheses too, so it holds none of its own.
    name: text(1, 80).refine((value) => !/[()]/.test(value), { message: "must not contain parentheses" }),
    url: text(1, 500).superRefine((value, ctx) => {
      const problem = sourceUrlProblem(value);
      if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
    }),
    date: z.string().refine(isCalendarDate, { message: "must be a real date written YYYY-MM-DD" }),
    dateKind: z.enum(NOTE_DATE_KINDS),
  }),
});

const useSchema = z.strictObject({
  tool: z.literal(BMC_TOOL_ID),
  company: slug,
  question: z.enum(BMC_QUESTION_KEYS),
  entity: slug,
  text: wording,
  order: z.number().int().min(0),
  note: useNoteSchema.optional(),
});

const openQuestionSchema = z.strictObject({
  tool: z.literal(BMC_TOOL_ID),
  company: slug,
  question: z.enum(BMC_QUESTION_KEYS),
});

export const arkademyDocumentSchema = z.strictObject({
  formatVersion: z.literal(ARKADEMY_FORMAT_VERSION),
  tools: z.tuple([bmcToolSchema]),
  companies: z.array(companySchema).min(1).max(100),
  entities: z.array(entitySchema).max(5000),
  uses: z.array(useSchema).max(10000),
  open: z.array(openQuestionSchema),
});

// Compile-time only: `tsc` fails on this line if the interfaces above and the
// schema stop describing the same shape. Nothing reads it at runtime.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type SchemaMatchesTypes = Assert<Same<z.infer<typeof arkademyDocumentSchema>, ArkademyDocument>>;
