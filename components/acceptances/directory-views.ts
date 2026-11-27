import type { AcceptancesModel } from "@/lib/utils/acceptances-model";

/**
 * The Acceptances directory's views, in the order the switch shows them. Adding a
 * view is one entry here, one branch in `AcceptancesDirectory`, and its component.
 * The view lives in `?view=`; Contents is the default, so it is the absence.
 */
export type DirectoryViewId = "contents" | "mapping";

export interface DirectoryView {
  id: DirectoryViewId;
  label: string;
  /** The question the view answers: said under its label when the switch has room. */
  question: string;
  /** What the view found, said on its button: "123 promises". */
  count: (model: AcceptancesModel) => { n: number; word: string };
  /**
   * A view whose parts fold. The toolbar's expand-all is the baseline for them, and
   * `openByDefault` says which way a reader arrives: Mapping lands every journey open
   * (its rail is the index, the body the book).
   */
  folds?: { openByDefault: boolean };
}

export const DIRECTORY_VIEWS: readonly DirectoryView[] = [
  {
    id: "contents",
    label: "Contents",
    question: "Where does each promise live?",
    count: (model) => ({ n: model.shown, word: model.shown === 1 ? "promise" : "promises" }),
  },
  {
    id: "mapping",
    label: "Mapping",
    question: "What does the product promise, journey by journey?",
    count: (model) => ({ n: model.mapping.totals.journeys, word: model.mapping.totals.journeys === 1 ? "journey" : "journeys" }),
    folds: { openByDefault: true },
  },
];

export const DEFAULT_VIEW: DirectoryViewId = "contents";

/** The view a `?view=` value names; anything else is the default. */
export function viewFromParam(param: string | null): DirectoryViewId {
  return DIRECTORY_VIEWS.find((v) => v.id === param)?.id ?? DEFAULT_VIEW;
}
