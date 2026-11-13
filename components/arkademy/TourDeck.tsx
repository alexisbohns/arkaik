import { CircleDashedIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { ExpressiveShape } from "@/components/arkademy/ExpressiveShape";
import { displayAnswers, type CanvasQuestionState } from "@/lib/arkademy/paragraph";
import type { BmcQuestion, BmcQuestionKey } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

/** Each block's side of the canvas: how it's made, what it offers, who it's for, the money. */
export const TOUR_SIDE: Record<BmcQuestionKey, "make" | "offer" | "people" | "money"> = {
  kp: "make",
  ka: "make",
  kr: "make",
  vp: "offer",
  cr: "people",
  ch: "people",
  seg: "people",
  rev: "money",
  cost: "money",
};

interface TourDeckProps {
  /** The document's nine questions, canonical order. */
  questions: readonly Pick<BmcQuestion, "key" | "block">[];
  /** The example's canvas, canonical order (matched by key). */
  state: readonly CanvasQuestionState[];
  /** How many tiles lie face up, from the first question (`tilesFaceUp`). */
  faceUp: number;
  /** The tile turned over on this screen (it flips in), or none. */
  turning?: BmcQuestionKey;
  /** Names the deck for assistive technology. Omit with `decorative`. */
  label?: string;
  /** Unique on the page: a face's heading id is `${idPrefix}--${key}`. */
  idPrefix: string;
  /** The opening's deck: all face down, a picture only, hidden from assistive technology. */
  decorative?: boolean;
  className?: string;
}

/** A tile's back: the card's pattern, its number in a corner and a shape in the middle. */
function TileBack({ number }: { number: number }) {
  return (
    <div className="mx-tile__back" aria-hidden="true">
      <span className="mx-tile__back-number mx-numeral">{number}</span>
      <ExpressiveShape shape="cookie9" className="mx-tile__back-shape" />
    </div>
  );
}

/**
 * The tour's canvas as a deck of nine tiles, laid in the canvas's own
 * arrangement (two columns in question order on a narrow screen, the
 * canonical ten-column layout from a 48rem-wide deck), lying face down.
 * Tiles before `faceUp` lie face up — block number, title, answers — tinted
 * by side as on the cover (on a deck narrower than 36rem, an earlier tile
 * shows a tally of its answers instead, the list kept for assistive
 * technology, so the turning tile stays the screen's subject); `turning` is drawn with both faces and flips over
 * when it mounts (m3-tour.css; not with reduced motion, where it simply lies
 * face up).
 *
 * A face-down tile, its back and the turning tile's back are hidden from
 * assistive technology: only faces are read, in question order. The turning
 * face's heading takes focus when the screen changes (`data-tour-focus`).
 *
 * No hooks and no "use client": the server renders a whole deck.
 */
export function TourDeck({ questions, state, faceUp, turning, label, idPrefix, decorative, className }: TourDeckProps) {
  const byKey = new Map(state.map((question) => [question.key, question]));
  return (
    <div
      role={decorative ? undefined : "group"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={cn("mx-deck", className)}
    >
      <div className="mx-deck__grid">
        {questions.map((question, i) => {
          const number = i + 1;
          const isTurning = !decorative && question.key === turning;
          const up = !decorative && (number <= faceUp || isTurning);
          const answers = displayAnswers(byKey.get(question.key));
          const open = answers.length === 0 && byKey.get(question.key)?.open === true;
          const headingId = `${idPrefix}--${question.key}`;
          return (
            <div
              key={question.key}
              className="mx-tile"
              data-question={question.key}
              data-side={TOUR_SIDE[question.key]}
              data-tile={isTurning ? "turning" : up ? "up" : "down"}
              data-open={up && open ? "" : undefined}
              aria-hidden={up ? undefined : true}
              style={{ "--mx-deal": i } as CSSProperties}
            >
              {up ? (
                <div className="mx-tile__card">
                  <div role="group" aria-labelledby={headingId} className="mx-tile__face">
                    <h3
                      id={headingId}
                      tabIndex={isTurning ? -1 : undefined}
                      data-tour-focus={isTurning ? "" : undefined}
                      className="mx-tile__title"
                    >
                      <span className="mx-tile__number mx-numeral">{number}</span>
                      <span className="min-w-0 wrap-anywhere">{question.block}</span>
                    </h3>
                    {answers.length > 0 ? (
                      <>
                        <ul className="mx-tile__answers">
                          {answers.map((answer, j) => (
                            <li key={j}>{answer.text}</li>
                          ))}
                        </ul>
                        {/* On a narrow deck an earlier tile shows a tally; its list is still read. */}
                        {!isTurning && (
                          <p className="mx-tile__tally" aria-hidden="true">
                            {answers.length} {answers.length === 1 ? "answer" : "answers"}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mx-tile__empty">
                        {open && (
                          <CircleDashedIcon aria-hidden="true" className="mr-1 inline size-[1em] align-[-0.125em]" />
                        )}
                        {open ? "Left open on purpose." : "Not answered yet."}
                      </p>
                    )}
                  </div>
                  {isTurning && <TileBack number={number} />}
                </div>
              ) : (
                <TileBack number={number} />
              )}
              {isTurning && <ExpressiveShape shape="sunny" className="mx-tile__burst" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
