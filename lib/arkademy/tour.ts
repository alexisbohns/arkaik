import { BMC_QUESTION_KEYS } from "./constants";
import type { Company } from "./schema";
import { bmcTourPath } from "./tools";

/**
 * What remains of the tour's first, timed player. The tour is now moved by
 * the reader, one screen at a time (lib/arkademy/tour-stage.ts,
 * components/arkademy/TourStage.tsx); from here it takes its address and
 * what the live region says at the end, and your own canvas takes the
 * `?step=` parser.
 *
 * Imports only its siblings, like every module in lib/arkademy/.
 */

/** The steps of a tour: one per question. */
const STEP_COUNT = BMC_QUESTION_KEYS.length;

/** `?step=N` as a step, N an integer from 1 to 9; anything else reads as absent. */
export function parseStepParam(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) return null;
  const step = Number(raw);
  return step <= STEP_COUNT ? step : null;
}

/** An example's tour, optionally at a step (its ask beat): the address the cover's cards link to. */
export function tourHref(companyId: string, step?: number): string {
  return step === undefined ? bmcTourPath(companyId) : `${bmcTourPath(companyId)}?step=${step}`;
}

/** What the live region says when the tour reaches its end. */
export function tourEndAnnouncement(company: Pick<Company, "name">): string {
  return `End of the tour: ${company.name}'s nine answers, read back as one paragraph.`;
}
