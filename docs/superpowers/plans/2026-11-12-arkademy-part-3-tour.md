# Arkademy — Part 3: the tour — record of what was built

**Goal:** `/arkademy/business-model-canvas/tour/{companyId}[?step=N]`, where a visitor watches one example's Business Model Canvas built in nine steps. In each step the question appears, its answers arrive (a noted answer with its note marker), the paragraph gains the step's sentence, and the canvas block fills. The tour autoplays, with Pause, Back and Next. Each step has its own address. Under reduced motion every step is shown whole and the tour waits paused. The page is never indexed. The cover gains "Play a tour" in its hero and "Play the tour" on each example card.

**Branch:** `feat/arkademy-tour`, created with `gh stack add feat/arkademy-tour` on part 2 (`feat/arkademy-cover` at `4c7b137`), in the worktree `/Users/alexis/code/arkaik-arkademy`. The code was rehearsed twice in throwaway worktrees (on `76f7a2c`, then on `4c7b137` after part 2's review fixes), then built on this branch from the rehearsed files. This document records what was built; it is not a plan to re-type.

**Spec:** `docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md` § "The tour" and § "The stack → Part 3", as revised after part 2's review. Where this record and the spec differ, § "Readings and deviations" says why.

**Lab Note:** none. Label the PR `no-lab-note`; the single note ships with part 4.

---

## The tasks, as committed

| # | Commit | Files | What it does |
|---|---|---|---|
| 1 | — | — | `gh stack add feat/arkademy-tour` from `feat/arkademy-cover`; `rm -rf .next`. |
| 2 | `78019c3` feat(arkademy): the tour's clock — a step's timeline, the player's reducer and the step address | `lib/arkademy/tour.ts`, `tests/app/arkademy-tour.test.js`, `package.json` (`test:arkademy-tour`), `.github/workflows/ci.yml` (one step after "Arkademy cover tests") | The pure side: `TOUR_TIMING`, `stepTimeline`, `tourTimelines`, `stepView`, `nextBoundary`, `TourState`, `TourAction`, `initialTourState`, `resolveTourState`, `createTourReducer`, `parseStepParam`, `tourHref`, `stepAnnouncement`, `tourEndAnnouncement`. Test first: before the module existed the suite printed `FAIL: timing: …got undefined` then `TypeError: stepTimeline is not a function`. After it landed: 108 PASS. |
| 3 | `14bfb74` feat(arkademy): the tour player hook — one timeout per phase, a pause when hidden, the step in the address | `lib/hooks/usePrefersReducedMotion.ts`, `lib/hooks/useTourPlayer.ts` | `usePrefersReducedMotion` uses `useSyncExternalStore` (server snapshot `false`). `useTourPlayer({ timelines, initialStep, cardRef })` returns `{ state, view, reducedMotion, toggle, pause, back, next, goto, onKeyDown }`. It sets one `setTimeout` to the next visible boundary and pauses on `visibilitychange` to hidden. It calls `history.replaceState(null, "", …)` only when the `?step` in the address differs from the step shown. Manual navigation scrolls the question card into view when it is off screen. Keys: ← → Home End; K anywhere in the region; Space only when the region itself has focus; keys with a modifier are ignored, as are events from outside the region in the DOM (an open note card is a portal). |
| 4 | `6833183` feat(arkademy): the tour's pieces — step rail, question card, controls and end card | `components/arkademy/StepRail.tsx`, `QuestionCard.tsx`, `TourControls.tsx`, `TourEndCard.tsx`, `app/wobble.generated.css`, `lib/wobble/wobble-registry.generated.ts` | The four pieces. `PlayIcon` and `PauseIcon` are new to the repo, so `npm run generate` added `pause` and `play` (one line each) to the two wobble files, committed here. |
| 5 | `7844dbe` feat(arkademy): the tour page, its screen, and Play the tour on the cover | `components/arkademy/CanvasWalk.tsx`, `app/arkademy/business-model-canvas/tour/[example]/page.tsx`, `app/arkademy/business-model-canvas/page.tsx`, `tests/app/arkademy-tour.test.js` | The screen (`CanvasWalk`, mode `"tour"`), the page (head start, Suspense, `notFound()`), and the cover's two actions. Test first: the screen checks appended to the suite failed with `Cannot find module '…/components/arkademy/CanvasWalk.tsx'`. After the code landed: 135 PASS, including the screen rendered on the server in Node, the card's sentence without a duplicate marker, and source checks. |
| 6 | `7caac17` docs(arkademy): the tour's route and components in the folder map | `docs/architecture.md` | The route and the five components in the folder maps. |
| 7 | `c08b14e` feat(arkademy): the tour screen hands the page's end actions to the end card | `components/arkademy/CanvasWalk.tsx` (`endActions?: ReactNode` → `TourEndCard`'s `actions`), `tests/app/arkademy-tour.test.js` (two checks) | Lets part 4 add "Start your own" to the end card by passing one prop from the tour page. Test first: `FAIL: screen, step 9: the page's end actions come first in the end card`; after: 137 PASS. |
| 8 | *(this document)* docs(arkademy): part 3's record — the tour as built | `docs/superpowers/plans/2026-11-12-arkademy-part-3-tour.md` | — |

---

## Layout and pacing (decided and rehearsed)

**What is on screen at once.** The DOM order is the player (rail, controls, question card, end card, live region), then one `CanvasLink` wrapping the paragraph and the canvas.

- **Below 768 px (400):** one column: the rail (nine 28 px links in one row), the question card, the paragraph, then the canvas in one column. Back, Play/Pause and Next sit in a bar fixed to the bottom with 44 px targets (`TourControls`). The page column gets `pb-28` so the bar never covers the end.
- **From 768 px (900):** the canvas moves above the paragraph through CSS `order`. The canvas holds nothing focusable, so the tab order still matches what is seen. It is in the canonical arrangement once its container is 48rem wide (about 850 px of window).
- **From 1280 px (1440):** two columns. The player is `minmax(0,1fr)`, 312 px at 1440, beside a 48rem column with the canvas (canonical, no card around it, so its container is exactly 48rem) above the paragraph. The question, its arriving answers and the block they fill are on screen together.
- **The rejected layout:** question card beside the paragraph, over a full-width canvas. With a real paragraph of 1,800–2,800 characters, the canvas falls below the fold, and the block filling, the moment the method is about, is never seen.
- **The sentence in the card.** The question card ends with "In the paragraph", followed by this question's sentence (or gap pill), so the visitor sees the answers become a sentence even when the end of the paragraph is off screen. That sentence carries no note markers; they are in the answer list just above.

**Pacing.** `TOUR_TIMING = { questionMs: 1200, answerMs: 900, readMsPerChar: 30, sentenceMs: 900, dwellMs: 2400 }`. Each reading phase lasts the longer of its floor and 30 ms per character of what it shows: the question's prompt first, then each answer's wording (notes are not counted; Pause is there for them). Then come the sentence (900 ms) and a hold (2,400 ms). Measured tour lengths:

| Library | Tour length |
|---|---|
| The fixture's three examples | 50–55 s |
| The stress example (2,687 characters, five notes, 140-character wordings) | 93 s |
| The real library | 56 s (Pebbles) to 98 s (Livestorm); Anthropic 90 s |

The spec's fixed 700 ms per answer leaves under a second for a 140-character answer.

---

## Readings and deviations

1. **The timeline reads lengths, not a count.** The spec has `stepTimeline(answerCount)` and `createTourReducer(answerCounts)`. Here they are `stepTimeline(promptLength, answerLengths)`, `tourTimelines(questions, state)` (answers measured through `displayAnswers`) and `createTourReducer(timelines, reducedMotion = false)`. `stepView(timeline, elapsed)` takes a timeline. Added: `nextBoundary(timeline, elapsed)`, the next moment the step looks different. `dwellAt` is kept in the timeline, but it is not a boundary, because nothing changes on screen there.
2. **`TourState` gains `autoplay`.** "Autoplay unless reduced motion" cannot be decided on the server, and the repo's React Compiler lint refuses a `setState` in an effect body. So an arrival without `?step` stores `{ step: 1, playing: false, elapsed: 0, autoplay: true }`. `resolveTourState(state, timelines, reducedMotion)` settles it at render time: playing from the first phase, or, under reduced motion, step 1 complete and paused. The reducer resolves the state before every action. No effect sets state, and the server HTML (with the button labelled "Pause the tour") matches the first client render. Exported too: `initialTourState(timelines, step)` and `tourEndAnnouncement(company)` (the live region at the end).
3. **Answers that have not arrived are in the DOM, `invisible` and `aria-hidden`.** The spec says they are absent from it. They keep their place so nothing below them jumps at 900 px, where the canvas sits under the card. `visibility: hidden` takes them out of the accessibility tree and the tab order, so a reader still never meets them early. The cost is an empty area in the card at the start of a step (owner point 2).
4. **Back and Next use `aria-disabled`, not `disabled`, on steps 1 and 9.** A disabled button drops its focus, and the next → would land nowhere. Rehearsed: focus stays on the button.
5. **The play button has three names:** "Play the tour", "Pause the tour", and "Replay the tour" when the last step is complete. The visible labels are Play, Pause and Replay (the label is part of the name, WCAG 2.5.3).
6. **Play on a complete step starts the next one** (the spec's rule). Play on step 9 complete, ended or not, starts again from step 1 (owner point 3).
7. **A step link to the current step** restarts that step while playing, and shows it whole while paused (`goto` applies to every valid step).
8. **The end card** says "End of the tour" and "Nine questions, one paragraph". It offers "Next example: {name}" (the following example in gallery order, wrapping; hidden with a single example) and "All examples" (the cover's `#examples`). The spec's "Choose another example" became these two links. The card shows whenever step 9 is complete, so `?step=9` shows it too.
9. **Opening a note pauses the tour** (the owner's notes-behind-a-click decision; the coordinator suggested pausing). `CanvasWalk`'s `onClickCapture` pauses when a click lands in `[data-note-marker]` (`SourcedNote`'s documented attribute), in the card or in the paragraph. Rehearsed: the click pauses, → inside the open card leaves the step alone, and Escape returns focus to the marker.
10. **The tour's canvas shows answers without their notes.** The canvas is the map; the notes are in the card and the paragraph. So the same note is offered at most twice on screen (answer list and paragraph), never three times.
11. **The newest sentence is marked** with `[&_[data-kind][data-question=KEY]]:!bg-foreground/10`, nine literal classes. It is `!important`, so `CanvasLink`'s lighter hover tint never replaces it; the link still tints every other sentence. The link never outlines the `current` block (`data-current`), so the ring and the link do not fight either. No change to `ParagraphView`; the spec's suggested `highlight` prop was not needed.
12. **`pending` and `through`.** Before the step's sentence arrives: `through = step - 1`, `pending = key`, `current = key`, and the paragraph shows `composeParagraph({ …, through: step }).slice(0, through)`. After: `through = step` and no `pending`.
13. **The page streams like the cover.** It awaits `settledWithin(lookupArkademy(), ARKADEMY_HEAD_START_MS)`. If the library answered in time, the tour renders in place, and an unknown id calls `notFound()` before any byte is sent: a real 404 inside the Arkademy's chrome. Otherwise the breadcrumb, a fallback `h1` ("Business Model Canvas tour") and `LibraryPlaceholder` stream first. An unknown id met only then calls `notFound()` inside the boundary, and Next renders the not-found page with `noindex`, but the status is 200 because it was already sent. The spec says "before any boundary"; that cannot be known on the slow path without giving up streaming.
14. **The paragraph's measure** is `max-w-[80ch]` inside its card. `ParagraphView` sets no width; at 1440 the card's 720 px of text is just over 80ch.
15. **Keyboard discoverability.** The player region carries `aria-keyshortcuts="ArrowLeft ArrowRight Home End Space K"`. A visible hint was tried and removed: it reserved an awkward gap under the card at 900 px. K works anywhere in the region (no button uses it); Space only on the region itself.
16. **`CanvasWalk` is keyed by company** (`key={company.id}` on the page), so "Next example" mounts a fresh player instead of carrying the old example's state into the new one.
17. **Headings.** The page's `h1` is the company's name (with the "Simulation" badge), followed by its one-liner and one line of UI copy: "The Business Model Canvas in nine questions: watch each answer become a sentence and fill its block." The question card's prompt is an `h2`. The paragraph and canvas sections have kicker-style `h2`s ("{Company} in one paragraph", "The canvas"), and the blocks are `h3`. The company's `note` is at the foot of the page.
18. **The cover's hero action** ("Play a tour", an `<a href="#examples">`) shows only when the library is ready. Each card's link reads "Play the tour" plus a visually hidden ": {name}", so a list of links tells the examples apart.

---

## Verified facts

Read on this branch.

- `components/arkademy/SourcedNote.tsx:53` `SourcedNote({ note, answer })`; `:58` `data-note-marker=""` on the Popover trigger (the attribute the pause listens for).
- `components/arkademy/CanvasGrid.tsx:53` `pending?`; `:88` `clampThrough(through, questions.length)`; `:97` the pending block.
- `components/arkademy/CanvasLink.tsx:19` `CanvasLink({ children, className })`; `lib/arkademy/canvas-link.ts:40` the link outlines `[data-block]:not([data-current])` only.
- `lib/arkademy/head-start.ts:13` `ARKADEMY_HEAD_START_MS = 300`, `:20` `settledWithin`; `lib/services/arkademy.ts:66` `ARKADEMY_READ_TIMEOUT_MS = 5000`.
- `lib/arkademy/paragraph.ts:63` `displayAnswers`, `:151` `clampThrough`, `:157` `composeParagraph`.
- `lib/arkademy/metadata.ts:90` `bmcTourMetadata` (always `noindex`, canonical without `?step`); `lib/arkademy/tools.ts:16` `bmcTourPath`.
- `tests/app/keyboard-shortcuts.test.js:199` refuses `(window|document).addEventListener("keydown"`. The hook's only document listener is `visibilitychange`.
- `components/arkademy/ExampleCard.tsx:18` `actions?: ReactNode`, `:42` rendered at the card's top right.
- `app/arkademy/business-model-canvas/page.tsx:71-88` `CoverHead` with `actions` (`:88`); `:119` the hero's actions; `:167` each card's actions.
- `components/arkademy/TourEndCard.tsx:17` `actions?: ReactNode`, `:41` rendered first in the row.
- `lib/wobble/wobble-registry.generated.ts:137` `pause`, `:142` `play`.
- `package.json:43` `test:arkademy-tour`; `.github/workflows/ci.yml:230` its step (build job, Node 20).
- **Lint, the React Compiler rules (probed in the rehearsal):** `eslint-config-next` flags an unconditional `setState` in an effect body and a `ref.current` read during render. A conditional `setState` in an effect is not flagged. This part has neither: refs are read only in event handlers.

---

## What part 4 gets from this part

**Pure (`lib/arkademy/tour.ts`; names part 4 must not reuse in `lib/arkademy/`):** `TOUR_TIMING`, `StepTimeline`, `stepTimeline`, `tourTimelines`, `StepView`, `stepView`, `nextBoundary`, `TourState`, `TourAction`, `initialTourState`, `resolveTourState`, `createTourReducer`, `parseStepParam`, `tourHref`, `stepAnnouncement`, `tourEndAnnouncement`. For your own canvas, `parseStepParam` is the same `?step` parser. `tourHref` is the tour's address only; build `yours` links on `BMC_YOURS_PATH`.

**Hooks:** `usePrefersReducedMotion()` (reusable as it is), and `useTourPlayer` (tour only).

**Components:**

| Component | Props | Notes for part 4 |
|---|---|---|
| `CanvasWalk` (`CanvasWalk.tsx`, client) | `CanvasWalkProps = TourWalkProps`: `{ mode: "tour"; company; questions; state; initialStep; next: { name; href } \| null; examplesHref; endActions?: ReactNode }` | Widen `CanvasWalkProps` to `TourWalkProps \| EditWalkProps` (`mode: "edit"`), and branch in `CanvasWalk` (`props.mode === "edit" ? <EditWalk …/> : <TourWalk …/>`). Reuse the layout classes: the root `grid gap-6 xl:grid-cols-[minmax(0,1fr)_48rem] xl:items-start`, and the right column `CanvasLink className="flex min-w-0 flex-col gap-6"` with the paragraph section `md:order-last`. |
| `StepRail` (`StepRail.tsx`, no hooks) | `{ steps: readonly StepRailItem[]; current; hrefFor(step); onSelect(step); className? }`; `StepRailItem = { block; status: "answered" \| "open" \| "empty"; reached }`; `StepStatus` | For your canvas: `reached = status !== "empty"`, `hrefFor = (n) => \`${BMC_YOURS_PATH}?step=${n}\``. The `nav` is labelled "Tour steps"; pass a different label by adding an optional `label` prop if needed. |
| `QuestionCard` (`QuestionCard.tsx`, no hooks) | `{ question; number; total; company: { name }; state; visibleAnswers; sentence; sentenceShown; headingId; ref?; className? }`; also `ARKADEMY_KICKER` (the mono kicker class) | Read-only: part 4's `QuestionEditor` is its own card. Reuse `ARKADEMY_KICKER` for the "Question N of 9 · {block}" line. |
| `TourControls` (`TourControls.tsx`, no hooks) | `{ step; steps; playing; atEnd; onBack; onToggle; onNext; className? }` | Tour only; its bottom-bar pattern (`fixed … md:static`) is the one to copy for Back/Next. |
| `TourEndCard` (`TourEndCard.tsx`, server-safe) | `{ company; next; examplesHref; actions?: ReactNode; className? }` | `actions` renders first in its button row. |

**The two insertion points for "Start your own":**

1. **The tour's end card.** In `app/arkademy/business-model-canvas/tour/[example]/page.tsx`, in `TourBody`'s `<CanvasWalk …>`, add `endActions={<StartYourOwnButton />}`. `CanvasWalk` hands it to `TourEndCard`'s `actions`, which renders it before "Next example" and "All examples". `StartYourOwnButton` is a client component (it reads the draft key to choose between "Start your own" and "Continue your canvas"); a server page may pass it as a prop to the client `CanvasWalk`. Use the `stone` button variant (spec: the one special action per page). Nothing changes in `TourEndCard.tsx` or `CanvasWalk.tsx`.
2. **The cover's actions row.** In `app/arkademy/business-model-canvas/page.tsx`, in `CoverFor`'s ready branch, the `actions` prop of `CoverHead` holds the "Play a tour" button. Put `<StartYourOwnButton />` before it, as one fragment (`actions={<><StartYourOwnButton /><Button asChild variant="outline">…Play a tour…</Button></>}`). `CoverHead` lays them out in `mt-6 flex flex-wrap gap-2`. The suite's source check `cover: no link to your own canvas yet (part 4)` (`!cover.includes("BMC_YOURS_PATH")`) must then be removed or inverted in `tests/app/arkademy-tour.test.js`.

---

## Part done when

On `feat/arkademy-tour` alone (without part 4). Real results from the build:

```
rm -rf .next; actionlint                    → silent
npx eslint --ignore-pattern 'arkademy-content/**'
                                            → ✖ 3 problems (0 errors, 3 warnings)  (main's three no-img-element warnings)
npm run lint                                → 15 errors, all in the gitignored arkademy-content/*.js (the owner's
                                              content scripts, absent in CI); 0 in tracked files
npx tsc --noEmit                            → silent
env -u DATABASE_URL npm run build           → exit 0; ƒ /arkademy/business-model-canvas/tour/[example]
npm run generate && git status --porcelain  → no tracked change (wobble files committed in task 4)
npm run test:arkademy-tour                   → 137 PASS, All arkademy-tour tests passed. (Node 26 and Node 20.19.5)
npm run test:arkademy-paragraph             → All arkademy-paragraph tests passed. (both)
npm run test:arkademy-schema                → All arkademy-schema tests passed. (both)
npm run test:keyboard-shortcuts             → All keyboard shortcut tests passed (both)
npm run test:docs-visibility                → All docs-visibility tests passed (both)
npm run test:landing                        → All landing tests passed. (both)
npm run test:panel-semantics                → All panel-semantics tests passed (both)
DATABASE_URL=… npm run test:arkademy-api    → All arkademy-api integration tests passed.
```

**Production server** (`next start`, scratch Postgres with the fixture and the stress example):

- `/tour/nobody` → 404, `h1` "Not in the library"; the only console message is the document's own 404.
- `/tour/tidewise?step=5` and the cover: 200, no console error. The cover's actions are "Play a tour", then "Play the tour: Crumb & Co", ": Tidewise", ": Inkwell", ": Longwind".
- The slow path, with the table locked for 2 s before a cold read: first byte at 0.36 s with the breadcrumb, the fallback `h1` and "Loading the library…". The not-found page and `noindex` follow, with status 200 (deviation 13). Warm, the same id is a 404.

**The browser rehearsal** (`next dev`, Playwright from a scratch folder):

- Whole tours of Tidewise (fixture) and Longwind (stress) from arrival to the end at 400, 900 and 1440 px, light and dark, with screenshots at step 1 (first phase), step 3 (mid-answers), step 5 (its sentence) and step 9 (ended). Every shot: no sideways scroll, one `h1`, zero console errors, the URL rewritten to `?step=N` from step 2 on, the live region on the right step.
- Reduced motion at the three widths, light and dark: arrival complete and paused ("Play the tour", nothing hidden); Play goes to step 2 whole and plays.
- Interactions:
  - pause holds;
  - Back, Next, step links, Home, End, ←, → and Space/K on the region;
  - Space on a focused button stays the button's;
  - `aria-disabled` Back keeps focus;
  - tab order: header, breadcrumb, the region, nine step links, Back, Play, Next;
  - Back from the cover returns to `?step=4`;
  - `?step=5` lands complete and paused;
  - opening a note pauses the tour, and Escape returns focus to the marker.
- The real library (`arkademy-content/arkademy.json`), loaded into the scratch database only, at 1440 light; no real content enters the repo:
  - **Pebbles** (56 s): short wordings sit on the floors, so it moves briskly. Its open revenue question reads as intended: a dashed "Pebbles leaves this open on purpose." box in the card, a dashed block, and the pill at the end of the paragraph.
  - **Anthropic** (90 s, five notes): four or five answers per step, each read before the next arrives. The note markers sit after their answers in the card and the paragraph. The canonical canvas grows tall at 1440 (each 2-column block is about 150 px wide), so by step 9 the paragraph is below the fold; the card's "In the paragraph" carries the new sentence meanwhile.
  - Zero console errors.

**Before the PR:** `gh stack submit --auto` (not run: this part was built without pushing), and on the part 3 PR, title `feat(arkademy): the tour (part 3/4)`, label `no-lab-note`, no `## Lab Note` section. Read the PR's comments after opening.
