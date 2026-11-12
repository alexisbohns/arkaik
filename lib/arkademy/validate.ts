import {
  ARKADEMY_FORMAT_VERSION,
  BMC_QUESTION_KEYS,
  BMC_QUESTION_KIND,
  MAX_ANSWERS_PER_QUESTION,
  MAX_DOCUMENT_BYTES,
  arkademyDocumentSchema,
  type ArkademyDocument,
} from "./schema";

/**
 * Validation of an Arkademy library document (the spec's § "Referential
 * rules"): the zod parse first, then the rules no field-level schema can see.
 * Errors refuse the upload; warnings are printed and the upload proceeds.
 * Every finding names a JSON path such as `uses[12].entity`; `$` is the
 * document itself.
 *
 * Pure and isomorphic: no Node API, no `@/` import (see schema.ts).
 */

export type ArkademyFinding = { level: "error" | "warning"; path: string; message: string };
export type ArkademyValidation =
  | { ok: true; document: ArkademyDocument; warnings: ArkademyFinding[] }
  | { ok: false; errors: ArkademyFinding[]; warnings: ArkademyFinding[] };

/** `["uses", 12, "entity"]` → `uses[12].entity`; the empty path → `$`. */
export function formatFindingPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out === "" ? String(part) : `.${String(part)}`;
  }
  return out === "" ? "$" : out;
}

/** The size rule's measure: UTF-8 bytes of the document's compact JSON text. */
export function documentByteLength(input: unknown): number | null {
  let json: string | undefined;
  try {
    json = JSON.stringify(input);
  } catch {
    return null;
  }
  return json === undefined ? null : new TextEncoder().encode(json).length;
}

/**
 * The path of every own `__proto__` key in `input`. `JSON.parse` keeps such a
 * key as an ordinary own property, but zod drops it without a word, so a
 * document holding one would lose that data silently. Iterative, so a deeply
 * nested value cannot overflow the stack.
 */
function protoKeyPaths(input: unknown): PropertyKey[][] {
  const found: PropertyKey[][] = [];
  const stack: { value: unknown; path: PropertyKey[] }[] = [{ value: input, path: [] }];
  while (stack.length > 0) {
    const { value, path } = stack.pop()!;
    if (Array.isArray(value)) {
      value.forEach((item, index) => stack.push({ value: item, path: [...path, index] }));
    } else if (value !== null && typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, "__proto__")) found.push([...path, "__proto__"]);
      for (const key of Object.keys(value)) {
        if (key !== "__proto__") stack.push({ value: (value as Record<string, unknown>)[key], path: [...path, key] });
      }
    }
  }
  return found.sort((a, b) => formatFindingPath(a).localeCompare(formatFindingPath(b)));
}

type JsonFrame =
  | { kind: "object"; keys: Set<string>; key: string | null; expectKey: boolean }
  | { kind: "array"; index: number };

/**
 * Every key repeated within one object of a JSON text, as error findings
 * named by path (`uses[3].text`). `JSON.parse` keeps the last of two equal
 * keys and drops the first without a word; this finds them in the text
 * itself. `text` must already be valid JSON (parse it first): the scan only
 * tracks strings, brackets, colons and commas. Keys compare by their decoded
 * value, so `"a"` and `"\u0061"` are the same key.
 */
export function duplicateJsonKeys(text: string): ArkademyFinding[] {
  const findings: ArkademyFinding[] = [];
  const stack: JsonFrame[] = [];
  const currentPath = () => stack.map((frame) => (frame.kind === "object" ? (frame.key ?? "") : frame.index));
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.kind === "object" && top.expectKey) {
        let key: string;
        try {
          key = JSON.parse(text.slice(index, end + 1)) as string;
        } catch {
          key = text.slice(index + 1, end);
        }
        top.expectKey = false;
        top.key = key;
        if (top.keys.has(key)) {
          findings.push({
            level: "error",
            path: formatFindingPath(currentPath()),
            message: `repeats the key "${key}" of the same object; JSON keeps only the last, so the first would be lost`,
          });
        } else {
          top.keys.add(key);
        }
      }
      index = end + 1;
      continue;
    }
    if (char === "{") stack.push({ kind: "object", keys: new Set(), key: null, expectKey: true });
    else if (char === "[") stack.push({ kind: "array", index: 0 });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") {
      const top = stack[stack.length - 1];
      if (top?.kind === "object") top.expectKey = true;
      else if (top?.kind === "array") top.index += 1;
    }
    index += 1;
  }
  return findings;
}

/**
 * A wording that looks like it holds a figure or a press claim: a digit
 * followed by `%`, a currency sign or code, or "reported", "reportedly",
 * "according to". Such a fact probably belongs in a sourced note.
 */
const FIGURE_OR_CLAIM = /\d\s?%|[$€£]|\b(?:USD|EUR)\b|\breported(?:ly)?\b|\baccording to\b/i;

const OPENERS = new Set(["The", "A", "An", "We", "It", "Our", "Nothing", "Free"]);
const PRONOUNS = new Set(["we", "our", "us", "my"]);
const CONJUNCTIONS = new Set(["and", "or", "but"]);

const FIGURE_OR_CLAIM_MESSAGE = "looks like a figure or a claim; put it in a sourced note";

/**
 * The prototype validator's wording heuristics for a use's `text`, as warning
 * messages. A wording can only be judged by reading the paragraph it lands
 * in, so these never refuse an upload.
 */
export function wordingWarnings(wording: string): string[] {
  const words = wording.split(/[^A-Za-z']+/).filter((word) => word.length > 0);
  const messages: string[] = [];
  const first = words[0] ?? "";
  if (OPENERS.has(first)) messages.push(`opens with "${first}"; the paragraph reads better without it`);
  if (CONJUNCTIONS.has(first.toLowerCase())) messages.push(`opens with "${first}"`);
  if (FIGURE_OR_CLAIM.test(wording)) messages.push(FIGURE_OR_CLAIM_MESSAGE);
  const pronoun = words.find((word) => word === "I" || (PRONOUNS.has(word.toLowerCase()) && word !== "US"));
  if (pronoun !== undefined) messages.push(`speaks in the first person ("${pronoun}")`);
  return messages;
}

/**
 * The heuristics for an entity's `label`. A label is a sentence-case chip,
 * not a phrase set mid-sentence, so the opener, first-person and conjunction
 * rules of {@link wordingWarnings} do not apply; only the figure-or-claim one
 * does.
 */
export function labelWarnings(label: string): string[] {
  return FIGURE_OR_CLAIM.test(label) ? [FIGURE_OR_CLAIM_MESSAGE] : [];
}

/**
 * Upgrade steps, keyed by the format they upgrade FROM: step N turns a
 * format-N document into a format-(N+1) one. Empty at format 1. A breaking
 * change to the shape adds its step here in the same PR as the bump.
 */
export const ARKADEMY_UPGRADES: Readonly<Record<number, (previous: unknown) => unknown>> = {};

export type ArkademyUpgrade = { ok: true; document: unknown } | { ok: false; message: string };

/**
 * Brings a stored document from `fromFormat` (its row's `format_version`) up
 * to {@link ARKADEMY_FORMAT_VERSION}. It never validates: the caller runs
 * {@link validateArkademyDocument} on the result.
 */
export function upgradeArkademyDocument(document: unknown, fromFormat: number): ArkademyUpgrade {
  if (!Number.isInteger(fromFormat) || fromFormat < 1) {
    return { ok: false, message: `format ${fromFormat} is not a format version` };
  }
  if (fromFormat > ARKADEMY_FORMAT_VERSION) {
    return {
      ok: false,
      message: `format ${fromFormat} is newer than this build reads (format ${ARKADEMY_FORMAT_VERSION})`,
    };
  }
  let current = document;
  for (let format = fromFormat; format < ARKADEMY_FORMAT_VERSION; format += 1) {
    const step = ARKADEMY_UPGRADES[format];
    if (!step) return { ok: false, message: `no upgrade from format ${format}` };
    current = step(current);
  }
  return { ok: true, document: current };
}

function groupKey(tool: string, company: string, question: string): string {
  return `${tool}\u0000${company}\u0000${question}`;
}

/**
 * `now` is only for the one clock-dependent rule (a note dated in the future
 * is a warning); tests pass a fixed date.
 */
export function validateArkademyDocument(input: unknown, options: { now?: Date } = {}): ArkademyValidation {
  const errors: ArkademyFinding[] = [];
  const warnings: ArkademyFinding[] = [];
  const error = (path: string, message: string) => errors.push({ level: "error", path, message });
  const warn = (path: string, message: string) => warnings.push({ level: "warning", path, message });

  // Rule 7 first: a document over the limit is refused before it is parsed.
  const bytes = documentByteLength(input);
  if (bytes === null) {
    error("$", "is not a JSON value");
    return { ok: false, errors, warnings };
  }
  if (bytes > MAX_DOCUMENT_BYTES) {
    error("$", `is ${bytes} bytes of JSON; the limit is ${MAX_DOCUMENT_BYTES}`);
    return { ok: false, errors, warnings };
  }

  for (const path of protoKeyPaths(input)) {
    error(formatFindingPath(path), 'is a "__proto__" key, which the document cannot hold: it would be dropped without a word');
  }

  const parsed = arkademyDocumentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) error(formatFindingPath(issue.path), issue.message);
    return { ok: false, errors, warnings };
  }
  const document: ArkademyDocument = parsed.data;

  // Rule 1: ids are unique within companies and within entities.
  const companyIndex = new Map<string, number>();
  document.companies.forEach((company, index) => {
    const first = companyIndex.get(company.id);
    if (first !== undefined) error(`companies[${index}].id`, `repeats the id "${company.id}" of companies[${first}]`);
    else companyIndex.set(company.id, index);
  });
  const entityIndex = new Map<string, number>();
  document.entities.forEach((entity, index) => {
    const first = entityIndex.get(entity.id);
    if (first !== undefined) error(`entities[${index}].id`, `repeats the id "${entity.id}" of entities[${first}]`);
    else entityIndex.set(entity.id, index);
  });

  const tools = new Map(document.tools.map((tool, index) => [tool.id as string, { tool, index }]));

  document.tools.forEach((tool, toolIndex) => {
    // Rule 2: the nine keys once each, in canonical order (zod pins the count).
    tool.questions.forEach((question, index) => {
      const expected = BMC_QUESTION_KEYS[index];
      if (question.key !== expected) {
        error(
          `tools[${toolIndex}].questions[${index}].key`,
          `must be "${expected}": the questions follow the order ${BMC_QUESTION_KEYS.join(", ")}`,
        );
      }
    });
    // Rule 3: every example names a company, once.
    const seen = new Map<string, number>();
    tool.examples.forEach((id, index) => {
      const path = `tools[${toolIndex}].examples[${index}]`;
      if (!companyIndex.has(id)) error(path, `names no company ("${id}")`);
      const first = seen.get(id);
      if (first !== undefined) error(path, `repeats "${id}" of examples[${first}]`);
      else seen.set(id, index);
    });
  });

  // Rule 4 and rule 5: each use, then each (tool, company, question) group.
  const groups = new Map<
    string,
    { first: number; count: number; orders: Map<number, number>; entities: Map<string, number> }
  >();
  const usedEntities = new Set<string>();
  document.uses.forEach((use, index) => {
    const path = `uses[${index}]`;
    const found = tools.get(use.tool);
    if (!found) {
      error(`${path}.tool`, `names no tool ("${use.tool}")`);
      return;
    }
    if (!found.tool.examples.includes(use.company)) {
      error(`${path}.company`, `"${use.company}" is not one of the tool's examples`);
    }
    const entityAt = entityIndex.get(use.entity);
    if (entityAt === undefined) {
      error(`${path}.entity`, `names no entity ("${use.entity}")`);
    } else {
      usedEntities.add(use.entity);
      const kind = document.entities[entityAt].kind;
      const expected = BMC_QUESTION_KIND[use.question];
      if (kind !== expected) {
        error(`${path}.entity`, `"${use.entity}" is a ${kind}; question ${use.question} takes a ${expected}`);
      }
    }

    const key = groupKey(use.tool, use.company, use.question);
    let group = groups.get(key);
    if (!group) {
      group = { first: index, count: 0, orders: new Map(), entities: new Map() };
      groups.set(key, group);
    }
    group.count += 1;
    if (group.count > MAX_ANSWERS_PER_QUESTION) {
      error(
        path,
        `is answer ${group.count} to ${use.question} for "${use.company}"; a question takes at most ${MAX_ANSWERS_PER_QUESTION}`,
      );
    }
    const orderAt = group.orders.get(use.order);
    if (orderAt !== undefined) error(`${path}.order`, `repeats order ${use.order} of uses[${orderAt}]`);
    else group.orders.set(use.order, index);
    const sameEntityAt = group.entities.get(use.entity);
    if (sameEntityAt !== undefined) error(`${path}.entity`, `repeats entity "${use.entity}" of uses[${sameEntityAt}]`);
    else group.entities.set(use.entity, index);
  });

  // Rule 6: open questions.
  const openIndex = new Map<string, number>();
  document.open.forEach((open, index) => {
    const path = `open[${index}]`;
    const found = tools.get(open.tool);
    if (!found) {
      error(`${path}.tool`, `names no tool ("${open.tool}")`);
      return;
    }
    if (!found.tool.examples.includes(open.company)) {
      error(`${path}.company`, `"${open.company}" is not one of the tool's examples`);
    }
    const key = groupKey(open.tool, open.company, open.question);
    const first = openIndex.get(key);
    if (first !== undefined) error(path, `repeats open[${first}]`);
    else openIndex.set(key, index);
    const group = groups.get(key);
    if (group) {
      error(path, `"${open.company}" answers ${open.question} (uses[${group.first}]), so it cannot leave it open`);
    }
  });

  // Warnings. Dates compare as YYYY-MM-DD strings, in UTC.
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  document.tools.forEach((tool, toolIndex) => {
    tool.examples.forEach((id, index) => {
      if (!companyIndex.has(id)) return;
      for (const key of BMC_QUESTION_KEYS) {
        const k = groupKey(tool.id, id, key);
        if (!groups.has(k) && !openIndex.has(k)) {
          warn(`tools[${toolIndex}].examples[${index}]`, `"${id}" neither answers nor leaves open ${key}`);
        }
      }
    });
  });

  const labels = new Map<string, number>();
  document.entities.forEach((entity, index) => {
    if (!usedEntities.has(entity.id)) {
      warn(`entities[${index}]`, `"${entity.id}" has no use, so it never appears as an inspiration`);
    }
    const labelKey = `${entity.kind}\u0000${entity.label.toLowerCase()}`;
    const first = labels.get(labelKey);
    if (first !== undefined) warn(`entities[${index}].label`, `repeats the ${entity.kind} label of entities[${first}]`);
    else labels.set(labelKey, index);
    for (const message of labelWarnings(entity.label)) warn(`entities[${index}].label`, message);
  });
  document.uses.forEach((use, index) => {
    for (const message of wordingWarnings(use.text)) warn(`uses[${index}].text`, message);
    if (use.note && use.note.source.date > today) {
      warn(`uses[${index}].note.source.date`, `${use.note.source.date} is in the future`);
    }
  });

  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, document, warnings };
}
