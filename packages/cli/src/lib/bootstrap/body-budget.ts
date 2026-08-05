/**
 * Bound a PR body to a target size WITHOUT ever cutting into a `## Lab Note`
 * section — the only signal that must survive byte-for-byte no matter what
 * else gets trimmed (`has_lab_note` is computed from the full body at mining
 * time and stays `true` forever after; a truncated-away note means an agent
 * is told one exists and can't find it).
 *
 * Extracted out of `slice.ts` as its own module, deliberately: `boundBody`
 * was previously only reachable through a full corpus -> plan -> CLI round
 * trip, which is exactly why two real defects shipped with zero coverage —
 * every fixture available at the time put the Lab Note LAST in the body, so
 * nothing ever exercised trailing content after it. As its own
 * dependency-free module this gets direct unit tests instead (see
 * `tests/cli/bootstrap-body-budget.test.js`); no other file in this package
 * needs to change for that to work.
 */

/** Matches `corpus.ts`'s `has_lab_note` detection exactly — same heading, same anchoring. */
const LAB_NOTE_HEADING_RE = /^##\s+Lab Note.*$/m;
/** Any other H2 heading — marks where the Lab Note's own section ends. */
const NEXT_HEADING_RE = /^##\s+/m;

/** Longest body handed out inside one slice. A target the function tries to hit, not a hard ceiling — see `boundBody`'s floor below. */
export const MAX_BODY_CHARS = 4000;

export interface LabNoteSection {
  /** Everything before the `## Lab Note` heading. */
  before: string;
  /** The heading itself, through the next `## ` heading or end of body. */
  note: string;
  /** Everything from that next heading (or end of body) onward. */
  after: string;
}

/**
 * Split `body` into the prose before a `## Lab Note` section, the section
 * itself, and whatever follows it. Returns `null` when there is no Lab Note
 * heading at all.
 */
export function splitLabNoteSection(body: string): LabNoteSection | null {
  const heading = LAB_NOTE_HEADING_RE.exec(body);
  if (!heading) return null;
  const noteStart = heading.index;
  const restStart = noteStart + heading[0].length;
  const next = NEXT_HEADING_RE.exec(body.slice(restStart));
  const noteEnd = next ? restStart + next.index : body.length;
  return { before: body.slice(0, noteStart), note: body.slice(noteStart, noteEnd), after: body.slice(noteEnd) };
}

/** One marker format for the one concept ("this text was cut here"), used by every truncation point below. */
function truncationMarker(cutChars: number): string {
  return `\n\n[… truncated ${cutChars} characters …]\n\n`;
}

/** Keep `text`'s head, cut its tail, and mark the cut with the exact count — a no-op when `text` already fits `budget`. */
function headTruncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.length - budget;
  return `${text.slice(0, budget)}${truncationMarker(cut)}`;
}

/**
 * Bound a body around its Lab Note: only the note itself is retained whole.
 * The prose BEFORE it and anything AFTER it each share whatever budget is
 * left once the note is accounted for, independently head-truncated (kept
 * from their own start, cut at their own end, marked only if actually cut).
 *
 * A previous version of this function retained `after` in full, on the
 * unstated assumption that real bodies never have trailing content past the
 * note. Every one of this repo's own sampled PRs put the note last, so
 * nothing ever exercised the other shape — and the assumption was wrong in
 * two ways at once: with a large `after`, the "bounded" body could come out
 * LARGER than the input (a truncation that grows what it truncates); with
 * `before` empty and `after` untouched, it could be a complete no-op with no
 * marker, silently handing back the full unbounded body. Both are closed by
 * treating `before` and `after` symmetrically here, and by the hard floor in
 * `boundBody` below.
 */
function boundAroundNote(section: LabNoteSection): string {
  const remaining = Math.max(0, MAX_BODY_CHARS - section.note.length);
  const beforeBudget = Math.floor(remaining / 2);
  const afterBudget = remaining - beforeBudget;
  return `${headTruncate(section.before, beforeBudget)}${section.note}${headTruncate(section.after, afterBudget)}`;
}

/**
 * Truncate an oversized PR body without ever cutting into a `## Lab Note`
 * section. When there's no Lab Note, this is a plain head-truncate. When
 * there is one, see `boundAroundNote` above.
 *
 * Hard floor: this function never returns something the same size as, or
 * bigger than, what it received. If truncating a Lab-Note-bearing body
 * didn't actually shrink it (the note alone can be bigger than the whole
 * cap, or `before`/`after` were already small enough that the truncation
 * markers add more than they cut), the untouched original is returned
 * instead of a "truncated" body that would be a lie about being smaller.
 */
export function boundBody(body: string): string {
  if (body.length <= MAX_BODY_CHARS) return body;

  const section = splitLabNoteSection(body);
  const bounded = section ? boundAroundNote(section) : headTruncate(body, MAX_BODY_CHARS);

  return bounded.length < body.length ? bounded : body;
}
