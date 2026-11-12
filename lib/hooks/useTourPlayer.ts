"use client";

import { useEffect, useMemo, useReducer, useRef, type KeyboardEvent, type RefObject } from "react";

import {
  createTourReducer,
  keyKeepsFocus,
  initialTourState,
  nextBoundary,
  parseStepParam,
  stepFromSearch,
  resolveTourState,
  stepView,
  type StepTimeline,
  type StepView,
  type TourAction,
  type TourState,
} from "@/lib/arkademy/tour";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

export interface TourPlayer {
  state: TourState;
  view: StepView;
  reducedMotion: boolean;
  /** Play or pause, as the play button does. */
  toggle: () => void;
  /** Stop playing, if playing: opening a note does this, so the step does not move on under it. */
  pause: () => void;
  back: () => void;
  next: () => void;
  goto: (step: number) => void;
  /** For the player region's own `onKeyDown`: ← → Home End, and Space or K. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Binds lib/arkademy/tour.ts to a screen: one timeout to the next phase
 * boundary while playing (never a frame loop), a pause when the page is
 * hidden, `?step=N` kept current with `replaceState` (never `pushState`: nine
 * history entries would make Back useless), and the reduced-motion preference
 * — under it every step renders complete, and an arrival without a step
 * starts paused instead of playing.
 *
 * Manual navigation (buttons, step links, keys) scrolls the question card
 * into view when it is off screen; autoplay never scrolls the page.
 */
export function useTourPlayer({
  timelines,
  initialStep,
  cardRef,
}: {
  timelines: readonly StepTimeline[];
  /** From `?step=` on arrival, or null. */
  initialStep: number | null;
  /** The question card, scrolled into view on manual navigation when off screen. */
  cardRef: RefObject<HTMLElement | null>;
}): TourPlayer {
  const reducedMotion = usePrefersReducedMotion();
  const reducer = useMemo(() => createTourReducer(timelines, reducedMotion), [timelines, reducedMotion]);
  // The address the browser shows wins over the server's: Back to a tour replays the
  // server render it was first opened with, but the address holds the step being
  // watched (replaceState kept it current), which comes back complete and paused.
  // On a hard load the two agree, so hydration matches.
  const [stored, dispatch] = useReducer(reducer, null, () =>
    initialTourState(timelines, typeof window === "undefined" ? initialStep : stepFromSearch(window.location.search)),
  );
  const state = resolveTourState(stored, timelines, reducedMotion);
  const timeline = timelines[state.step - 1];
  const view = reducedMotion ? stepView(timeline, timeline.total) : stepView(timeline, state.elapsed);

  // When the running timeout was armed, so a pause keeps the time spent in the phase.
  const armedAt = useRef<number | null>(null);
  const spentMs = () => (armedAt.current === null ? 0 : performance.now() - armedAt.current);

  // The clock: one timeout to the next moment the step looks different.
  useEffect(() => {
    if (!state.playing) return;
    const target = reducedMotion ? timeline.total : nextBoundary(timeline, state.elapsed);
    if (target === null) return;
    const ms = Math.max(0, target - state.elapsed);
    armedAt.current = performance.now();
    const id = window.setTimeout(() => dispatch({ type: "tick", ms }), ms);
    return () => {
      window.clearTimeout(id);
      armedAt.current = null;
    };
  }, [state.playing, state.elapsed, timeline, reducedMotion]);

  // A hidden page pauses the tour; it does not resume by itself.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") dispatch({ type: "hidden", ms: spentMs() });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // `?step=N` follows the step, autoplay included, so a reload or a shared
  // link lands on the step being watched. An arrival without a step keeps its
  // clean address until the step first changes.
  useEffect(() => {
    const url = new URL(window.location.href);
    const shown = parseStepParam(url.searchParams.get("step") ?? undefined);
    if (shown === state.step || (shown === null && state.step === 1)) return;
    url.searchParams.set("step", String(state.step));
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [state.step]);

  function navigate(action: TourAction) {
    const card = cardRef.current;
    if (card) {
      const top = card.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight - 96) {
        card.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
      }
    }
    dispatch(action);
  }

  const toggle = () => dispatch(state.playing ? { type: "pause", ms: spentMs() } : { type: "play" });
  const pause = () => dispatch({ type: "pause", ms: spentMs() });
  const back = () => navigate({ type: "back" });
  const next = () => navigate({ type: "next" });
  const goto = (step: number) => navigate({ type: "goto", step });

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // React bubbles events out of portals: keys typed in an open note card
    // (rendered elsewhere in the DOM) are the card's, not the player's.
    if (!event.currentTarget.contains(event.target as Node)) return;
    const onRegion = event.target === event.currentTarget;
    const navigation = ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key);
    // The focused element may unmount with the step (an end-card link, a note
    // marker): hand focus to the region first, so the next key still lands here.
    if (navigation && !onRegion && !keyKeepsFocus(event.target as Element)) {
      event.currentTarget.focus({ preventScroll: true });
    }
    switch (event.key) {
      case "ArrowLeft":
        back();
        break;
      case "ArrowRight":
        next();
        break;
      case "Home":
        goto(1);
        break;
      case "End":
        goto(timelines.length);
        break;
      case "k":
      case "K":
        toggle();
        break;
      case " ":
        // A focused button or link keeps its own Space.
        if (!onRegion) return;
        toggle();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return { state, view, reducedMotion, toggle, pause, back, next, goto, onKeyDown };
}
