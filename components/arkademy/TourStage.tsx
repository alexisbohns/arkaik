"use client";

import { ArrowLeftIcon, ArrowRightIcon, CircleDashedIcon, FlaskConicalIcon, PencilLineIcon, XIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { CanvasGrid } from "@/components/arkademy/CanvasGrid";
import { CanvasLink } from "@/components/arkademy/CanvasLink";
import type { ExampleAccent } from "@/components/arkademy/example-accents";
import { ExpressiveShape } from "@/components/arkademy/ExpressiveShape";
import { ParagraphView } from "@/components/arkademy/ParagraphView";
import { SourcedNote } from "@/components/arkademy/SourcedNote";
import { StartYourOwnLink } from "@/components/arkademy/StartYourOwnLink";
import { TOUR_SIDE, TourDeck } from "@/components/arkademy/TourDeck";
import { TourThemeToggle } from "@/components/arkademy/TourThemeToggle";
import { composeParagraph, displayAnswers, type CanvasQuestionState } from "@/lib/arkademy/paragraph";
import type { BmcQuestion, Company } from "@/lib/arkademy/schema";
import { tourEndAnnouncement } from "@/lib/arkademy/tour";
import {
  askAnnouncement,
  askCadence,
  endCadence,
  nextTourStage,
  paragraphFit,
  paragraphWords,
  previousTourStage,
  tilesFaceUp,
  TOUR_STEPS,
  tourPips,
  tourStageFromSearch,
  tourStageHref,
  tourStageIndex,
  tourStageKey,
  turnAnnouncement,
  type TourStage as Stage,
} from "@/lib/arkademy/tour-stage";
import { cn } from "@/lib/utils";

export interface TourStageProps {
  company: Company;
  /** The document's nine questions, canonical order. */
  questions: BmcQuestion[];
  /** The example's canvas, from `exampleCanvas`. */
  state: CanvasQuestionState[];
  /** The company's badge, as its cover card draws it. */
  accent: ExampleAccent;
  /** The tool's name: "Business Model Canvas". */
  toolTitle: string;
  /** The cover. */
  coverHref: string;
  /**
   * The address's query string as the server read it (no `?`). The live
   * address (`useSearchParams`) wins once there is one; this is what a render
   * outside Next's router (a test) reads.
   */
  search?: string;
}

/** How the current screen arrived: on the page's load, or by moving forward or back. */
type Arrival = "arrive" | "forward" | "back";

/** A staged entrance's delay, for m3-tour.css's `.mx-pop`. */
function at(ms: number): CSSProperties {
  return { "--mx-at": `${ms}ms` } as CSSProperties;
}

/**
 * Without JavaScript there is no press to hurry a screen along, so it shows
 * whole at once: every entrance off (the burst too, which only an animation
 * ever shows). A `<noscript>` style: with JavaScript the browser never applies it.
 */
const NO_SCRIPT_CSS =
  "<style>.mx-tour *,.mx-tour-choices *{animation:none!important}.mx-tour .mx-tile__burst{display:none!important}</style>";

/** What a press on Space or Enter leaves to the focused element itself. */
const INTERACTIVE = "a, button, summary, input, textarea, select, [contenteditable], [role='button']";

/**
 * The tour, one screen at a time (lib/arkademy/tour-stage.ts): the opening,
 * then each question in two beats — asked and answered as a conversation,
 * then its tile turned face up on the deck — then the end, the paragraph
 * word by word and the whole canvas. The tour's own top bar (leave, the
 * company, the stepper, the theme) is the only chrome: the Arkademy's header
 * is left out on this route (ArkademyHeaderSlot).
 *
 * The reader moves it: Continue, Back, a pip of the stepper, ← and →, or
 * Space and Enter anywhere that is not a control. Nothing moves on a timer.
 * A screen arrives on a rhythm (lib/arkademy/tour-stage.ts
 * `askCadence`, `endCadence`), as CSS animations with computed delays that
 * play once as it mounts (m3-tour.css); a press while it is still arriving
 * — Continue, Space, Enter, →, a click on the screen, or focus moving into
 * it — shows the rest at once (each running animation finished), and the
 * next press moves on. Reduced motion, a step back onto a screen, and a
 * reader without JavaScript get each screen whole at once.
 *
 * The address is the state: the stage is read from `?step=`/`&beat=` and
 * every move pushes a history entry (Next keeps `useSearchParams` in step with
 * `history.pushState`), so Back and Forward walk the tour and a reload lands
 * where the reader was. The server renders the same screen from the same
 * address; every control is a real link, so the tour works without
 * JavaScript, one page per screen.
 *
 * On each move the page returns to its top, focus goes to the new screen's
 * heading (the question, the turned tile, the end), and a polite live region
 * says what arrived with it — all of it at once, whatever the pace on screen.
 */
export function TourStage({
  company,
  questions,
  state,
  accent,
  toolTitle,
  coverHref,
  search: served = "",
}: TourStageProps) {
  const params = useSearchParams();
  const search = params ? params.toString() : served;
  const stage = tourStageFromSearch(search);
  const index = tourStageIndex(stage);

  // The direction of the last move, kept as state from the previous render's stage.
  const [seen, setSeen] = useState(index);
  const [arrival, setArrival] = useState<Arrival>("arrive");
  if (seen !== index) {
    setSeen(index);
    setArrival(index > seen ? "forward" : "back");
  }

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const turning = stage.kind === "question" && stage.beat === "canvas";
  useEffect(() => {
    if (arrival === "arrive") return;
    window.scrollTo({ top: 0 });
    // The turned tile may sit below the fold on a phone: focusing it brings it into view.
    stageRef.current?.querySelector<HTMLElement>("[data-tour-focus]")?.focus({ preventScroll: !turning });
  }, [index, arrival, turning]);

  /**
   * Following the end's reveal: where the paragraph cannot fit on screen (a
   * phone, a short window), the view keeps the line being revealed in sight,
   * then brings the canvas in as it enters — a gentle glide each frame toward
   * it, only ever down. It stops for good as soon as the reader scrolls,
   * touches, clicks or presses a key, when the skip shows everything, and
   * when all is in view. Not with reduced motion (nothing is revealed over
   * time then), nor on a step back (the screen is whole at once).
   */
  const followRef = useRef<(() => void) | null>(null);
  const following = stage.kind === "end" && arrival !== "back";
  useEffect(() => {
    if (!following) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const screen = stageRef.current;
    const words = screen ? Array.from(screen.querySelectorAll<HTMLElement>(".mx-word")) : [];
    const canvas = screen?.querySelector<HTMLElement>(".mx-end__canvas") ?? null;
    if (words.length === 0) return;
    const bar = rootRef.current?.querySelector<HTMLElement>(".mx-tour-bottom") ?? null;
    const seen = (element: Element) => Number(getComputedStyle(element).opacity) > 0.02;
    /** The last word on screen: the words arrive in order, so a binary search. */
    const lastSeen = () => {
      let low = -1;
      let high = words.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high + 1) / 2);
        if (seen(words[mid])) low = mid;
        else high = mid - 1;
      }
      return low;
    };
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("pointerdown", stop);
      followRef.current = null;
    };
    const tick = () => {
      // The sticky bar covers the window's foot; on a phone the end's bar is in the flow.
      const inset = bar && getComputedStyle(bar).position === "sticky" ? bar.offsetHeight : 0;
      const viewBottom = window.innerHeight - inset - 24;
      const canvasIn = canvas !== null && seen(canvas);
      let target: number | null = null;
      if (canvasIn) {
        const box = canvas.getBoundingClientRect();
        target = box.top + Math.min(box.height, window.innerHeight * 0.55);
      } else {
        const i = lastSeen();
        if (i >= 0) target = words[i].getBoundingClientRect().bottom + 16;
      }
      const over = target === null ? 0 : target - viewBottom;
      if (over > 1) window.scrollBy(0, Math.max(1, over * 0.09));
      // Done: the canvas has fully arrived and is in view.
      if (canvasIn && Number(getComputedStyle(canvas).opacity) > 0.98 && over <= 1) return stop();
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("pointerdown", stop);
    followRef.current = stop;
    frame = requestAnimationFrame(tick);
    return stop;
  }, [following, index]);

  /**
   * The skip: while the screen is still arriving (any of its entrances still
   * running, or waiting its turn), finish them all — the screen shows whole —
   * and say so. CSS transitions (the stepper's morph) are left alone.
   */
  function revealIfArriving(): boolean {
    const root = rootRef.current;
    if (!root || typeof root.getAnimations !== "function") return false;
    const arriving = root
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running" && !(animation instanceof CSSTransition));
    if (arriving.length === 0) return false;
    followRef.current?.();
    for (const animation of arriving) animation.finish();
    return true;
  }

  const hrefFor = (target: Stage) => tourStageHref(company.id, target, search);
  const go = (target: Stage) => {
    window.history.pushState(null, "", tourStageHref(company.id, target, window.location.search));
  };
  const next = nextTourStage(stage);
  const previous = previousTourStage(stage);
  /** Continue: first the rest of the screen, if it is still arriving; then the next one. */
  const advance = () => {
    if (revealIfArriving()) return;
    if (next) go(next);
  };

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Any key the reader presses is theirs: the end stops following its reveal.
    followRef.current?.();
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // React bubbles events out of portals: keys typed in an open note card are the card's.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest("input, textarea, select, [contenteditable]")) return;
    const onControl = Boolean(element?.closest(INTERACTIVE));
    if (event.key === "ArrowRight" || (!onControl && (event.key === " " || event.key === "Enter"))) {
      event.preventDefault();
      advance();
    } else if (event.key === "ArrowLeft" && previous) {
      event.preventDefault();
      go(previous);
    }
  }

  /** A click on the screen itself (not on a control), or focus moving into it, shows the rest of it at once. */
  function onStageClick(event: MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    revealIfArriving();
  }
  function onStageFocus(event: FocusEvent<HTMLElement>) {
    if (event.target instanceof Element && !event.target.hasAttribute("data-tour-focus")) revealIfArriving();
  }

  const step = stage.kind === "question" ? stage.step : null;
  const question = step === null ? null : questions[step - 1];
  const questionState = step === null ? null : state[step - 1];
  const announcement =
    arrival === "arrive"
      ? ""
      : stage.kind === "end"
        ? tourEndAnnouncement(company)
        : question && questionState && step !== null
          ? stage.kind === "question" && stage.beat === "canvas"
            ? turnAnnouncement({ step, question, state: questionState })
            : askAnnouncement({ step, question, company, state: questionState })
          : "";
  const ending =
    stage.kind === "end"
      ? endCadence(paragraphWords(composeParagraph({ questions, state, subject: company.name })))
      : null;

  const link = (target: Stage, props: StageLinkProps, onGo: () => void = () => go(target)) => (
    <StageLink href={hrefFor(target)} onGo={onGo} {...props} />
  );

  return (
    <div
      ref={rootRef}
      className="mx-tour"
      data-stage={stage.kind === "question" ? stage.beat : stage.kind}
      onKeyDown={onKeyDown}
    >
      <noscript dangerouslySetInnerHTML={{ __html: NO_SCRIPT_CSS }} />
      <header className="mx-tour-row mx-tour-top">
        <a
          href={coverHref}
          className="mx-icon-btn [grid-area:close]"
          aria-label={`Leave the tour, back to the ${toolTitle}`}
        >
          <XIcon aria-hidden="true" />
        </a>
        {stage.kind === "opening" ? (
          <p className="mx-tour-top__tool [grid-area:who]">{toolTitle} · a tour</p>
        ) : (
          <div className="mx-tour-top__who [grid-area:who]">
            <CompanyBadge company={company} accent={accent} size="s" />
            <h1 className="mx-title-l min-w-0 truncate">{company.name}</h1>
          </div>
        )}
        <StepPips stage={stage} questions={questions} link={link} />
        <TourThemeToggle className="[grid-area:theme]" />
      </header>

      <div
        ref={stageRef}
        key={tourStageKey(stage)}
        className="mx-tour-row mx-tour-stage"
        data-enter={arrival === "back" ? "back" : "forward"}
        onClick={onStageClick}
        onFocus={onStageFocus}
      >
        {stage.kind === "opening" && <Opening company={company} accent={accent} questions={questions} state={state} />}
        {stage.kind === "question" &&
          question &&
          questionState &&
          (stage.beat === "ask" ? (
            <AskBeat
              step={stage.step}
              question={question}
              state={questionState}
              questions={questions}
              allState={state}
              company={company}
              accent={accent}
            />
          ) : (
            <TurnBeat step={stage.step} question={question} questions={questions} state={state} company={company} />
          ))}
        {stage.kind === "end" && ending && (
          <End company={company} questions={questions} state={state} ending={ending} />
        )}
      </div>

      <nav aria-label="Tour" className="mx-tour-bottom">
        <div className="mx-tour-row mx-tour-bottom__inner">
          {previous ? (
            link(previous, {
              className: "mx-btn mx-tour-back",
              children: (
                <>
                  <ArrowLeftIcon aria-hidden="true" />
                  <span className="mx-tour-back__label">Back</span>
                </>
              ),
            })
          ) : (
            <a href={coverHref} className="mx-btn mx-btn--m mx-tour-quiet">
              <ArrowLeftIcon aria-hidden="true" />
              The cover
            </a>
          )}
          <div className="mx-tour-bottom__end">
            <p className="mx-tour-keys" aria-hidden="true">
              <kbd>←</kbd>
              <kbd>→</kbd>
            </p>
            {stage.kind === "end" && ending ? (
              <div key="choices" className="mx-tour-choices" onFocus={onStageFocus}>
                <a href={coverHref} className="mx-btn mx-tour-cta mx-btn--tonal mx-pop" style={at(ending.choices)}>
                  Back to the cover
                </a>
                <span className="mx-pop" style={at(ending.choices + 160)}>
                  <StartYourOwnLink
                    className="mx-btn mx-tour-cta mx-btn--filled"
                    icon={<PencilLineIcon aria-hidden="true" />}
                  />
                </span>
              </div>
            ) : (
              next &&
              link(
                next,
                {
                  className: "mx-btn mx-tour-cta mx-btn--filled mx-tour-continue",
                  children: (
                    <>
                      {stage.kind === "opening" ? "Start the tour" : "Continue"}
                      <ArrowRightIcon aria-hidden="true" />
                    </>
                  ),
                },
                advance,
              )
            )}
          </div>
        </div>
      </nav>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

interface StageLinkProps {
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-current"?: "step";
  "data-pip"?: string;
  "data-side"?: string;
}

/**
 * A move through the tour: a real link to the stage's address (so it works
 * without JavaScript, and opens in a new tab with a modifier), which with
 * JavaScript pushes the address instead of loading it. Space follows it too,
 * as it presses a button.
 */
function StageLink({ href, onGo, children, ...rest }: StageLinkProps & { href: string; onGo: () => void }) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onGo();
  }
  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    if (event.key !== " ") return;
    event.preventDefault();
    event.currentTarget.click();
  }
  return (
    <a href={href} onClick={onClick} onKeyDown={onKeyDown} {...rest}>
      {children}
    </a>
  );
}

/** The company's initial in its accent shape, as on its cover card. Decorative: the name is always written beside it. */
function CompanyBadge({
  company,
  accent,
  size,
  className,
  style,
}: {
  company: Pick<Company, "name">;
  accent: ExampleAccent;
  size: "s" | "m" | "xl";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span aria-hidden="true" className={cn("mx-badge", `mx-badge--${size}`, accent.tone, className)} style={style}>
      <ExpressiveShape shape={accent.shape} className="mx-badge__shape" />
      <span className="mx-badge__letter">{company.name.charAt(0).toUpperCase()}</span>
    </span>
  );
}

/**
 * The step indicator: nine pips, one per question, each a link to its
 * question. Ahead, a small ring; the question being asked, a long pill in
 * primary; once its tile is turned, the pip morphs into a tile — a small
 * rounded square in its side's colour, ringed — and stays one, done.
 */
function StepPips({
  stage,
  questions,
  link,
}: {
  stage: Stage;
  questions: readonly BmcQuestion[];
  link: (target: Stage, props: StageLinkProps) => ReactNode;
}) {
  const pips = tourPips(stage);
  const shown = stage.kind === "question" ? stage.step : stage.kind === "end" ? TOUR_STEPS : 0;
  return (
    <nav aria-label="Questions" className="mx-pips-nav [grid-area:pips]">
      <ol className="mx-pips">
        {questions.map((question, i) => {
          const pip = pips[i];
          const here = pip === "current" || pip === "turned";
          const status = pip === "done" || pip === "turned" ? ", face up" : "";
          return (
            <li key={question.key}>
              {link(
                { kind: "question", step: i + 1, beat: "ask" },
                {
                  className: "mx-pip",
                  "data-pip": pip,
                  "data-side": TOUR_SIDE[question.key],
                  "aria-current": here ? "step" : undefined,
                  "aria-label": `Question ${i + 1}: ${question.block}${status}`,
                  children: <span className="mx-pip__mark" />,
                },
              )}
            </li>
          );
        })}
      </ol>
      {shown > 0 && (
        <p className="mx-pips__count" aria-hidden="true">
          <span className="mx-pips__now">{shown}</span>
          <span className="mx-pips__of">/{TOUR_STEPS}</span>
        </p>
      )}
    </nav>
  );
}

/** The opening: who the tour is about, and the deck lying face down. */
function Opening({
  company,
  accent,
  questions,
  state,
}: {
  company: Company;
  accent: ExampleAccent;
  questions: readonly BmcQuestion[];
  state: readonly CanvasQuestionState[];
}) {
  return (
    <section aria-labelledby="tour-title" className="mx-opening">
      <div className="mx-opening__text">
        <CompanyBadge company={company} accent={accent} size="xl" className="mx-pop mx-pop--shape" style={at(0)} />
        <div className="mx-pop" style={at(120)}>
          <h1 id="tour-title" tabIndex={-1} data-tour-focus="" className="mx-opening__name">
            {company.name}
          </h1>
          {company.simulation && (
            <span className="mx-chip mt-4">
              <FlaskConicalIcon aria-hidden="true" />
              Simulation
            </span>
          )}
        </div>
        <p className="mx-subtitle mx-opening__one-liner mx-pop" style={at(240)}>
          {company.oneLiner}
        </p>
        <p className="mx-opening__how mx-pop" style={at(360)}>
          Nine questions, asked one at a time. Each answer turns a tile of {company.name}&apos;s canvas face up.
        </p>
        {company.note && (
          <p className="mx-body-s mx-opening__note mx-pop" style={at(440)}>
            {company.note}
          </p>
        )}
      </div>
      <div className="mx-opening__table">
        <TourDeck
          questions={questions}
          state={state}
          faceUp={0}
          idPrefix="tour-opening"
          decorative
          className="mx-deck--canonical mx-deck--table"
        />
      </div>
    </section>
  );
}

/**
 * The conversation beat, on its rhythm (`askCadence`: pop · pop-pop · pop ·
 * pop-pop): the asker — the Arkademy, a "?" in its own shape — pops in; then
 * the question (the screen's h2, its place in the tour read before it by
 * assistive technology only: the stepper is the one place shown) and its
 * explanation hard on its heels, in one soft elevated bubble style; then the
 * company's badge; then its answers in one tight run, each tinted like its
 * block, a noted answer followed by its note's marker — or, for a question
 * left open, the open answer in the dashed style the canvas gives it.
 */
function AskBeat({
  step,
  question,
  state,
  questions,
  allState,
  company,
  accent,
}: {
  step: number;
  question: BmcQuestion;
  state: CanvasQuestionState;
  questions: readonly BmcQuestion[];
  allState: readonly CanvasQuestionState[];
  company: Company;
  accent: ExampleAccent;
}) {
  const answers = displayAnswers(state);
  const gap =
    answers.length === 0
      ? composeParagraph({ questions, state: allState, subject: company.name, through: step })[step - 1]
      : undefined;
  const openText = gap?.kind === "gap" ? gap.text : `open: ${question.gap}`;
  const aside = state.open
    ? `${company.name} leaves this open on purpose. Not knowing yet is an answer too.`
    : `${company.name} has not answered this one.`;
  const pace = askCadence(question.hint.trim() !== "", answers.length > 0 ? answers.length : 2);
  return (
    <section aria-labelledby="tour-question" className="mx-chat">
      <div className="mx-chat__ask">
        <span aria-hidden="true" className="mx-chat__asker mx-pop mx-pop--shape" style={at(pace.asker)}>
          <ExpressiveShape shape="cookie9" className="mx-badge__shape" />
          <span className="mx-chat__asker-mark">?</span>
        </span>
        <div className="mx-chat__bubbles">
          <h2
            id="tour-question"
            tabIndex={-1}
            data-tour-focus=""
            className="mx-bubble mx-bubble--asker mx-bubble--question mx-pop"
            style={at(pace.question)}
          >
            <span className="sr-only">
              Question {step} of {TOUR_STEPS}, {question.block}:{" "}
            </span>
            {question.prompt}
          </h2>
          {pace.hint !== null && (
            <p className="mx-bubble mx-bubble--asker mx-bubble--hint mx-pop" style={at(pace.hint)}>
              {question.hint}
            </p>
          )}
        </div>
      </div>
      <div className="mx-chat__reply" data-side={TOUR_SIDE[question.key]}>
        <CompanyBadge
          company={company}
          accent={accent}
          size="m"
          className="mx-chat__avatar mx-pop mx-pop--shape"
          style={at(pace.company)}
        />
        {answers.length > 0 ? (
          <ul
            aria-label={`${company.name}'s ${answers.length === 1 ? "answer" : "answers"}`}
            className="mx-chat__answers"
          >
            {answers.map((answer, i) => (
              <li key={i} className="mx-bubble mx-bubble--answer mx-pop" style={at(pace.replies[i])}>
                {answer.text}
                {answer.note && <SourcedNote note={answer.note} answer={answer.text} />}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mx-chat__answers">
            <p className="mx-bubble mx-bubble--open mx-pop" style={at(pace.replies[0])}>
              <CircleDashedIcon aria-hidden="true" className="mr-2 inline size-[1em] align-[-0.125em]" />
              {openText}
            </p>
            <p className="mx-bubble mx-bubble--aside mx-pop" style={at(pace.replies[1])}>
              {aside}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** The canvas beat: the deck dealt, the earlier tiles face up, this question's tile flipping over. */
function TurnBeat({
  step,
  question,
  questions,
  state,
  company,
}: {
  step: number;
  question: BmcQuestion;
  questions: readonly BmcQuestion[];
  state: readonly CanvasQuestionState[];
  company: Company;
}) {
  const faceUp = tilesFaceUp({ kind: "question", step, beat: "canvas" });
  return (
    <section aria-labelledby="tour-turn" className="mx-turn">
      {/* The stepper is the one place shown; assistive technology reads where the deck is from this heading. */}
      <h2 id="tour-turn" className="sr-only">
        Question {step} of {TOUR_STEPS}, {question.block}, on the canvas: {faceUp} of {TOUR_STEPS} blocks face up
      </h2>
      <TourDeck
        questions={questions}
        state={state}
        faceUp={faceUp - 1}
        turning={question.key}
        label={`${company.name}'s canvas, ${faceUp} of ${TOUR_STEPS} blocks face up`}
        idPrefix="tour-deck"
        className="mx-deck--stage"
      />
    </section>
  );
}

/**
 * The end: the paragraph the nine answers make (ParagraphView, as on the
 * cover), flowing in word by word in short runs (`endCadence`), then — on
 * the next beat, only then — the
 * whole canvas, linked to it as on the cover's cards: hovering a sentence or a
 * block fades the rest and lifts the tile. Side by side on a wide screen
 * (the paragraph on the left), stacked on a narrow one. Where to go next
 * waits in the bar below, after the canvas.
 */
function End({
  company,
  questions,
  state,
  ending,
}: {
  company: Company;
  questions: readonly BmcQuestion[];
  state: readonly CanvasQuestionState[];
  ending: ReturnType<typeof endCadence>;
}) {
  const segments = composeParagraph({ questions, state, subject: company.name });
  // Sized to fit beside the canvas by its length (`paragraphFit`); a short one leaves the canvas its canonical shape.
  const fit = paragraphFit(segments);
  return (
    <section aria-labelledby="tour-end" className="mx-end">
      <h2 id="tour-end" tabIndex={-1} data-tour-focus="" className="mx-end__title mx-pop" style={at(0)}>
        {company.name}, in one paragraph
      </h2>
      <div className="mx-item mx-end__card mx-pop" data-fit={fit} style={at(150)}>
        <CanvasLink className="contents">
          <ParagraphView segments={segments} words={ending} className="mx-end__paragraph" />
          <div className="mx-end__canvas mx-pop" style={at(ending.canvas)}>
            <CanvasGrid
              questions={questions}
              state={state}
              density="full"
              idPrefix="tour-canvas"
              label={`${company.name}'s canvas`}
            />
          </div>
        </CanvasLink>
      </div>
    </section>
  );
}
