import type { ArkademyIndex } from "./index-document";
import type { CanvasQuestionState } from "./paragraph";
import { BMC_QUESTION_KEYS } from "./constants";
import type { Company } from "./schema";

/** One example as the pages draw it: the company and its nine questions. */
export interface ExampleCanvas {
  company: Company;
  questions: CanvasQuestionState[]; // nine, canonical order
}

/**
 * An example's canvas, from its uses in `order`, each answer carrying its
 * entity id and its note when it has one. `null` for an id that is not one
 * of the tool's examples — a company outside `tool.examples` has no tour.
 */
export function exampleCanvas(index: ArkademyIndex, companyId: string): ExampleCanvas | null {
  if (!index.tool.examples.includes(companyId)) return null;
  const company = index.company(companyId);
  if (!company) return null;
  return {
    company,
    questions: BMC_QUESTION_KEYS.map((key) => ({
      key,
      answers: index.uses(companyId, key).map((use) =>
        use.note ? { text: use.text, entity: use.entity, note: use.note } : { text: use.text, entity: use.entity },
      ),
      open: index.isOpen(companyId, key),
    })),
  };
}
