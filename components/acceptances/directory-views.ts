import type { AcceptancesModel } from "@/lib/utils/acceptances-model";

/**
 * The Acceptances directory's views, in the order the switch shows them. Adding a
 * view is one entry here, one branch in `AcceptancesDirectory`, and its component.
 * The view lives in `?view=`; Contents is the default, so it is the absence.
 */
export type DirectoryViewId = "contents";

export interface DirectoryView {
  id: DirectoryViewId;
  label: string;
  /** The question the view answers: said under its label when the switch has room. */
  question: string;
  /** What the view found, said on its button: "123 promises". */
  count: (model: AcceptancesModel) => { n: number; word: string };
}

export const DIRECTORY_VIEWS: readonly DirectoryView[] = [
  {
    id: "contents",
    label: "Contents",
    question: "Where does each promise live?",
    count: (model) => ({ n: model.shown, word: model.shown === 1 ? "promise" : "promises" }),
  },
];

export const DEFAULT_VIEW: DirectoryViewId = "contents";

/** The view a `?view=` value names; anything else is the default. */
export function viewFromParam(param: string | null): DirectoryViewId {
  return DIRECTORY_VIEWS.find((v) => v.id === param)?.id ?? DEFAULT_VIEW;
}
