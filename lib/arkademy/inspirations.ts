import type { ArkademyIndex } from "./index-document";
import { cleanAnswer } from "./paragraph";
import { BMC_QUESTION_KEYS, BMC_QUESTION_KIND } from "./schema";
import type { BmcQuestionKey } from "./schema";

/**
 * Inspirations for your own canvas (spec § "Inspirations"): for each
 * question, the library's entities of that question's kind that at least one
 * example uses, most shared first, each naming the examples that use it. The
 * catalog is built on the server and passed as props; `availableInspirations`
 * runs on the client against the visitor's answers. Notes never travel here:
 * an inspiration is the entity's neutral label and the companies' names only.
 */

export interface Inspiration {
  entity: string;
  label: string;
  /** The label as an answer: `inspirationAnswer` of the label and the companies' own wordings. */
  answer: string;
  companies: { id: string; name: string }[]; // in tool.examples order
}

/** Per question: the entities of its kind that some example uses, most shared first, then label, then id. */
export function inspirationCatalog(index: ArkademyIndex): Record<BmcQuestionKey, Inspiration[]> {
  const catalog = {} as Record<BmcQuestionKey, Inspiration[]>;
  const wordings = new Map<string, string[]>();
  for (const use of index.document.uses) {
    const list = wordings.get(use.entity);
    if (list) list.push(use.text);
    else wordings.set(use.entity, [use.text]);
  }
  for (const key of BMC_QUESTION_KEYS) {
    const kind = BMC_QUESTION_KIND[key];
    const list: Inspiration[] = [];
    for (const entity of index.document.entities) {
      if (entity.kind !== kind) continue;
      const companies = index.usersOf(entity.id).flatMap((id) => {
        const company = index.company(id);
        return company ? [{ id: company.id, name: company.name }] : [];
      });
      if (companies.length === 0) continue;
      const answer = inspirationAnswer(entity.label, wordings.get(entity.id) ?? []);
      list.push({ entity: entity.id, label: entity.label, answer, companies });
    }
    list.sort(
      (a, b) =>
        b.companies.length - a.companies.length ||
        a.label.localeCompare(b.label, "en", { sensitivity: "base" }) ||
        (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0),
    );
    catalog[key] = list;
  }
  return catalog;
}

/**
 * A label is a sentence-case chip; an answer sits mid-sentence. The first
 * letter is lower-cased unless the first word has a capital after its first
 * letter, which covers names written that way ("GitHub") and acronyms of two
 * letters or more ("AWS"). "A product map" becomes "a product map".
 */
export function answerFromLabel(label: string): string {
  const text = label.trim();
  const firstWord = text.split(/\s/, 1)[0] ?? "";
  const rest = firstWord.slice(1);
  if (rest !== rest.toLocaleLowerCase("en")) return text;
  return text.charAt(0).toLocaleLowerCase("en") + text.slice(1);
}

/** A word stripped of the punctuation around it, for comparing words across texts. */
function bareWord(word: string): string {
  return word.replace(/^[^0-9A-Za-z\u00C0-\uFFFF]+|[^0-9A-Za-z\u00C0-\uFFFF]+$/g, "");
}

/**
 * The answer an inspiration becomes. `answerFromLabel` lowers a first letter
 * it cannot tell from a name's ("Broadcom and Google", "Apple App Store"), so
 * the companies' own wordings of the entity decide: they sit mid-sentence,
 * where a capital is a name's. When one of them holds the label's first word
 * with the same capital, the label is kept as it is.
 */
export function inspirationAnswer(label: string, wordings: readonly string[]): string {
  const answer = answerFromLabel(label);
  const text = label.trim();
  if (answer === text) return answer;
  const first = bareWord(text.split(/\s/, 1)[0] ?? "");
  const named = first !== "" && wordings.some((wording) => wording.split(/\s+/).some((word) => bareWord(word) === first));
  return named ? text : answer;
}

/**
 * The inspirations a question still offers: drops the entities already added
 * to it and any whose label matches an answer's text, case-insensitively.
 */
export function availableInspirations(
  list: readonly Inspiration[],
  answers: readonly { text: string; inspiration?: { entity: string } }[],
): Inspiration[] {
  // A label typed as an answer (any case) is on the canvas already.
  const chosen = new Set(answers.flatMap((answer) => (answer.inspiration ? [answer.inspiration.entity] : [])));
  const key = (text: string) => cleanAnswer(text).toLocaleLowerCase("en");
  const texts = new Set(answers.map((answer) => key(answer.text)));
  return list.filter(
    (inspiration) =>
      !chosen.has(inspiration.entity) &&
      !texts.has(key(inspiration.label)) &&
      !texts.has(key(inspiration.answer)),
  );
}

/** "Crumb & Co", "Tidewise and Inkwell", "A, B and C", then "A, B and 2 more". */
export function companiesLine(companies: readonly { name: string }[]): string {
  const names = companies.map((company) => company.name);
  if (names.length <= 1) return names.join("");
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * Where an inspiration comes from, as the page may say it: "the Anthropic
 * example", "the Notion and Figma examples". An example may be a simulation,
 * so the page never states "used by Anthropic" as a fact about the company.
 */
export function examplesPhrase(companies: readonly { name: string }[]): string {
  return `the ${companiesLine(companies)} ${companies.length === 1 ? "example" : "examples"}`;
}

/** One example's own inspirations, for the "From one example" disclosure. */
export interface ExampleInspirations {
  company: { id: string; name: string };
  items: Inspiration[];
}

/**
 * Shared first. The entities two examples or more use are what the canvas
 * teaches, so they are listed at once, most shared first (the catalog's
 * order). The rest, each from a single example, are grouped by that example,
 * in the tool's example order, behind one disclosure.
 */
export function splitInspirations(
  items: readonly Inspiration[],
  examples: readonly string[],
): { shared: Inspiration[]; single: ExampleInspirations[] } {
  const shared: Inspiration[] = [];
  const groups = new Map<string, ExampleInspirations>();
  for (const item of items) {
    if (item.companies.length >= 2) {
      shared.push(item);
      continue;
    }
    const company = item.companies[0];
    if (!company) continue;
    const group = groups.get(company.id);
    if (group) group.items.push(item);
    else groups.set(company.id, { company, items: [item] });
  }
  const rank = (id: string) => {
    const at = examples.indexOf(id);
    return at < 0 ? examples.length : at;
  };
  const single = [...groups.values()].sort((a, b) => rank(a.company.id) - rank(b.company.id));
  return { shared, single };
}
