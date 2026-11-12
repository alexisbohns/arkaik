"use client";

import { useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";

import { CanvasGrid } from "@/components/arkademy/CanvasGrid";
import { CanvasLink } from "@/components/arkademy/CanvasLink";
import { ParagraphView } from "@/components/arkademy/ParagraphView";
import { ARKADEMY_KICKER, QuestionCard } from "@/components/arkademy/QuestionCard";
import { StepRail, type StepRailItem } from "@/components/arkademy/StepRail";
import { TourControls } from "@/components/arkademy/TourControls";
import { TourEndCard } from "@/components/arkademy/TourEndCard";
import { Card } from "@/components/ui/card";
import { composeParagraph, displayAnswers, type CanvasQuestionState } from "@/lib/arkademy/paragraph";
import type { BmcQuestion, BmcQuestionKey, Company } from "@/lib/arkademy/schema";
import { stepAnnouncement, tourEndAnnouncement, tourHref, tourTimelines } from "@/lib/arkademy/tour";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useTourPlayer } from "@/lib/hooks/useTourPlayer";
import { cn } from "@/lib/utils";

/** The tour: one example's canvas, built question by question. */
export interface TourWalkProps {
  mode: "tour";
  company: Company;
  /** The document's nine questions, canonical order. */
  questions: BmcQuestion[];
  /** The example's canvas, from `exampleCanvas`. */
  state: CanvasQuestionState[];
  /** From `?step=` on arrival (`parseStepParam`), or null to autoplay from step 1. */
  initialStep: number | null;
  /** The next example's tour, for the end card; null with a single example. */
  next: { name: string; href: string } | null;
  /** The cover's gallery. */
  examplesHref: string;
  /** Shown first in the end card: part 4's "Start your own" (a server page may pass a client component). */
  endActions?: ReactNode;
}

/** Part 4 widens this union with `{ mode: "edit"; … }`. */
export type CanvasWalkProps = TourWalkProps;

/**
 * The newest sentence (or gap pill) of the paragraph, marked like a
 * highlighter stroke that moves on with each step. `!important`, so the
 * paragraph–canvas link's lighter hover tint (`CanvasLink`) never replaces it;
 * the link still tints every other sentence. Literal class names, so Tailwind
 * finds them.
 */
const NEWEST: Record<BmcQuestionKey, string> = {
  seg: "[&_[data-kind][data-question=seg]]:!bg-foreground/10",
  vp: "[&_[data-kind][data-question=vp]]:!bg-foreground/10",
  ch: "[&_[data-kind][data-question=ch]]:!bg-foreground/10",
  cr: "[&_[data-kind][data-question=cr]]:!bg-foreground/10",
  rev: "[&_[data-kind][data-question=rev]]:!bg-foreground/10",
  kr: "[&_[data-kind][data-question=kr]]:!bg-foreground/10",
  ka: "[&_[data-kind][data-question=ka]]:!bg-foreground/10",
  kp: "[&_[data-kind][data-question=kp]]:!bg-foreground/10",
  cost: "[&_[data-kind][data-question=cost]]:!bg-foreground/10",
};

/**
 * The screen a canvas is walked through, question by question: the step
 * rail, the controls and the question card (the player), the paragraph as it
 * grows, and the canvas as its blocks fill. One mode today, the tour; part 4
 * adds "edit" for your own canvas.
 *
 * Layout. Below 768px one column — player, paragraph, canvas — with the
 * controls fixed to the bottom. From 768px the canvas moves above the
 * paragraph (CSS order; the canvas holds nothing focusable, so the tab order
 * still follows what is seen), in its canonical arrangement once its column
 * is 48rem wide. From 1280px the player sits beside a 48rem column holding
 * the canvas above the paragraph, so the question, its answers and the block
 * they fill are on screen together. The paragraph and the canvas share one
 * `CanvasLink`: a sentence and its block light each other up.
 *
 * Opening a note (its marker, in the card or the paragraph) pauses the tour,
 * so the step does not move on under the open card.
 */
export function CanvasWalk(props: CanvasWalkProps) {
  return <TourWalk {...props} />;
}

function TourWalk({ company, questions, state, initialStep, next, examplesHref, endActions }: TourWalkProps) {
  const timelines = useMemo(() => tourTimelines(questions, state), [questions, state]);
  const cardRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const player = useTourPlayer({ timelines, initialStep, cardRef });
  const { step, playing, ended } = player.state;

  // When the tour plays to its end, the end card comes into view (at once under reduced
  // motion). Focus stays where it is: nothing moves it on its own.
  useEffect(() => {
    if (!ended) return;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: player.reducedMotion ? "auto" : "smooth" });
  }, [ended, player.reducedMotion]);
  const { view } = player;
  const question = questions[step - 1];
  const questionState = state[step - 1];
  // Through the step once its sentence has arrived; until then the block is pending.
  const through = view.sentenceShown ? step : step - 1;

  const composed = composeParagraph({ questions, state, subject: company.name, through: step });
  const segments = composed.slice(0, through);
  const atEnd = ended || (step === questions.length && view.complete);

  // The canvas is the map: answers only. Their notes are in the card and the paragraph.
  const canvasState = useMemo(
    () => state.map((entry) => ({ ...entry, answers: entry.answers.map((answer) => ({ text: answer.text })) })),
    [state],
  );
  const rail: StepRailItem[] = questions.map((entry, i) => ({
    block: entry.block,
    status: displayAnswers(state[i]).length > 0 ? "answered" : state[i].open ? "open" : "empty",
    reached: i + 1 < step,
  }));
  // Empty until the page is live, so step 1 is announced once on arrival. While the tour
  // plays by itself only the step and its question; the answers too when paused or
  // when the reader moved to the step.
  const hydrated = useHydrated();
  const announcement = !hydrated
    ? ""
    : ended
      ? tourEndAnnouncement(company)
      : stepAnnouncement({
          step,
          question,
          company,
          state: questionState,
          answers: !playing || player.manualStep === step,
        });

  function pauseOnNote(event: MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("[data-note-marker]")) player.pause();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_48rem] xl:items-start" onClickCapture={pauseOnNote}>
      <section
        aria-label="Tour player"
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Space K"
        tabIndex={0}
        onKeyDown={player.onKeyDown}
        className="flex min-w-0 flex-col gap-4 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="flex flex-col gap-3">
          <StepRail steps={rail} current={step} hrefFor={(n) => tourHref(company.id, n)} onSelect={player.goto} />
          <TourControls
            step={step}
            steps={questions.length}
            playing={playing}
            atEnd={atEnd}
            onBack={player.back}
            onToggle={player.toggle}
            onNext={player.next}
          />
        </div>
        <QuestionCard
          ref={cardRef}
          question={question}
          number={step}
          total={questions.length}
          company={company}
          state={questionState}
          visibleAnswers={view.visibleAnswers}
          sentence={composed[step - 1]}
          sentenceShown={view.sentenceShown}
          headingId="tour-question"
        />
        {atEnd && (
          <div ref={endRef} className="scroll-mt-4 scroll-mb-24 md:scroll-mb-4">
            <TourEndCard company={company} next={next} examplesHref={examplesHref} actions={endActions} />
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </section>

      <CanvasLink className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="tour-paragraph-title" className="min-w-0 md:order-last">
          <Card className="gap-3 p-4 sm:p-6">
            <h2 id="tour-paragraph-title" className={ARKADEMY_KICKER}>
              {company.name} in one paragraph
            </h2>
            {segments.length > 0 ? (
              <ParagraphView
                segments={segments}
                className={cn("max-w-[80ch]", view.sentenceShown && NEWEST[question.key])}
              />
            ) : (
              <p className="text-[15px] leading-7 text-muted-foreground">
                The paragraph starts with the first question&apos;s answers.
              </p>
            )}
          </Card>
        </section>

        <section aria-labelledby="tour-canvas-title" className="min-w-0">
          <h2 id="tour-canvas-title" className={cn(ARKADEMY_KICKER, "mb-3")}>
            The canvas
          </h2>
          <CanvasGrid
            questions={questions}
            state={canvasState}
            density="full"
            idPrefix="tour-canvas"
            label={`${company.name}'s canvas`}
            current={question.key}
            pending={view.sentenceShown ? undefined : question.key}
            through={through}
          />
        </section>
      </CanvasLink>
    </div>
  );
}
