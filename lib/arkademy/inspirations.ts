import type { ArkademyIndex } from "./index-document";
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
  companies: { id: string; name: string }[]; // in tool.examples order
}

/** How many inspirations a question shows before "Show all N". */
export const INSPIRATIONS_SHOWN = 6;

/** Per question: the entities of its kind that some example uses, most shared first, then label, then id. */
export function inspirationCatalog(index: ArkademyIndex): Record<BmcQuestionKey, Inspiration[]> {
  const catalog = {} as Record<BmcQuestionKey, Inspiration[]>;
  for (const key of BMC_QUESTION_KEYS) {
    const kind = BMC_QUESTION_KIND[key];
    const list: Inspiration[] = [];
    for (const entity of index.document.entities) {
      if (entity.kind !== kind) continue;
      const companies = index.usersOf(entity.id).flatMap((id) => {
        const company = index.company(id);
        return company ? [{ id: company.id, name: company.name }] : [];
      });
      if (companies.length > 0) list.push({ entity: entity.id, label: entity.label, companies });
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

/**
 * The inspirations a question still offers: drops the entities already added
 * to it and any whose label matches an answer's text, case-insensitively.
 */
export function availableInspirations(
  list: readonly Inspiration[],
  answers: readonly { text: string; inspiration?: { entity: string } }[],
): Inspiration[] {
  const chosen = new Set(answers.flatMap((answer) => (answer.inspiration ? [answer.inspiration.entity] : [])));
  const texts = new Set(answers.map((answer) => answer.text.trim().toLocaleLowerCase("en")));
  return list.filter(
    (inspiration) =>
      !chosen.has(inspiration.entity) && !texts.has(inspiration.label.trim().toLocaleLowerCase("en")),
  );
}

/** "Crumb & Co", "Tidewise and Inkwell", "A, B and C", then "A, B and 2 more". */
export function companiesLine(companies: readonly { name: string }[]): string {
  const names = companies.map((company) => company.name);
  if (names.length <= 1) return names.join("");
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
