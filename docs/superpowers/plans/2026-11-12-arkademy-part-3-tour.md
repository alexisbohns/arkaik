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
| 2 | `22b42f89` feat(arkademy): the tour's clock — a step's timeline, the player's reducer and the step address | `lib/arkademy/tour.ts`, `tests/app/arkademy-tour.test.js`, `package.json` (`test:arkademy-tour`), `.github/workflows/ci.yml` (one step after "Arkademy cover tests") | The pure side: `TOUR_TIMING`, `stepTimeline`, `tourTimelines`, `stepView`, `nextBoundary`, `TourState`, `TourAction`, `initialTourState`, `resolveTourState`, `createTourReducer`, `parseStepParam`, `tourHref`, `stepAnnouncement`, `tourEndAnnouncement`. Test first: before the module existed the suite printed `FAIL: timing: …got undefined` then `TypeError: stepTimeline is not a function`. After it landed: 108 PASS. |
| 3 | `0864abdd` feat(arkademy): the tour player hook — one timeout per phase, a pause when hidden, the step in the address | `lib/hooks/usePrefersReducedMotion.ts`, `lib/hooks/useTourPlayer.ts` | `usePrefersReducedMotion` uses `useSyncExternalStore` (server snapshot `false`). `useTourPlayer({ timelines, initialStep, cardRef })` returns `{ state, view, reducedMotion, toggle, pause, back, next, goto, onKeyDown }`. It sets one `setTimeout` to the next visible boundary and pauses on `visibilitychange` to hidden. It calls `history.replaceState(null, "", …)` only when the `?step` in the address differs from the step shown. Manual navigation scrolls the question card into view when it is off screen. Keys: ← → Home End; K anywhere in the region; Space only when the region itself has focus; keys with a modifier are ignored, as are events from outside the region in the DOM (an open note card is a portal). |
| 4 | `8c4589a8` feat(arkademy): the tour's pieces — step rail, question card, controls and end card | `components/arkademy/StepRail.tsx`, `QuestionCard.tsx`, `TourControls.tsx`, `TourEndCard.tsx`, `app/wobble.generated.css`, `lib/wobble/wobble-registry.generated.ts` | The four pieces. `PlayIcon` and `PauseIcon` are new to the repo, so `npm run generate` added `pause` and `play` (one line each) to the two wobble files, committed here. |
| 5 | `a5102eaa` feat(arkademy): the tour page, its screen, and Play the tour on the cover | `components/arkademy/CanvasWalk.tsx`, `app/arkademy/business-model-canvas/tour/[example]/page.tsx`, `app/arkademy/business-model-canvas/page.tsx`, `tests/app/arkademy-tour.test.js` | The screen (`CanvasWalk`, mode `"tour"`), the page (head start, Suspense, `notFound()`), and the cover's two actions. Test first: the screen checks appended to the suite failed with `Cannot find module '…/components/arkademy/CanvasWalk.tsx'`. After the code landed: 135 PASS, including the screen rendered on the server in Node, the card's sentence without a duplicate marker, and source checks. |
| 6 | `0d79ae7e` docs(arkademy): the tour's route and components in the folder map | `docs/architecture.md` | The route and the five components in the folder maps. |
| 7 | `3603b9ac` feat(arkademy): the tour screen hands the page's end actions to the end card | `components/arkademy/CanvasWalk.tsx` (`endActions?: ReactNode` → `TourEndCard`'s `actions`), `tests/app/arkademy-tour.test.js` (two checks) | Lets part 4 add "Start your own" to the end card by passing one prop from the tour page. Test first: `FAIL: screen, step 9: the page's end actions come first in the end card`; after: 137 PASS. |
| 8 | `8c33cab1` docs(arkademy): part 3's record — the tour as built | `docs/superpowers/plans/2026-11-12-arkademy-part-3-tour.md` | — |

### After review (2026-11-12)

The review reproduced three bugs in the hook and asked for ten more changes. Fixed on this branch, one commit each, test first wherever a Node test reaches the change (the failing output was seen before each fix landed). Two commits change a lower part's files, marked **part 1** and **part 2**; they are meant to move down to those branches.

| Fix | Commit | Files | What changed |
|---|---|---|---|
| T8 (**part 1**) | `22ac5d4e` refactor(arkademy): the plain constants live in a module without zod, re-exported by the schema | new `lib/arkademy/constants.ts`; `lib/arkademy/schema.ts`; `tests/app/load-arkademy.js` | The format, question keys, entity kinds, limits and tokens (and `ToolId`, `BmcQuestionKey`, `EntityKind`, `NoteDateKind`) move to `constants.ts`. `schema.ts` re-exports every one, so existing imports keep working. The loader now accepts a name exported twice with the same value (a re-export); two different values are still an error. |
| T8 (**part 2**) | `281348c7` refactor(arkademy): the cover's modules take their constants without the schema | `lib/arkademy/paragraph.ts`, `prompt.ts`, `examples.ts`, `tools.ts`, `metadata.ts`, `canvas-link.ts` | Runtime imports come from `./constants`; type imports stay on `./schema`. |
| T8 | `b8c5bdfe` fix(arkademy): the tour takes its question keys without the schema, so no zod schema ships to the browser | `lib/arkademy/tour.ts` | Same for the tour. Chunks measured on `next start` (JS the page's HTML loads): tour 17 chunks, 1673 KB raw / 443 KB gzip, zod in 2 → 16 chunks, 1668 / 441, zod in 1. Cover 17, 1654 / 437, zod in 2 → 16, 1649 / 435, zod in 1. The zod chunk left is the app's own (`@arkaik/schema`'s `parseBundle`, also on `/docs`). |
| T5 (**part 2**) | `8638b567` fix(arkademy): an upcoming block's title stays readable — muted text, not a faded block | `components/arkademy/CanvasGrid.tsx` (one class: `faint && "opacity-40"` → `faint && "text-muted-foreground"`); `tests/app/arkademy-paragraph.test.js` (two checks) | Contrast on the page background: faint title 2.70 → 4.52 (light), 3.65 → 7.77 (dark); block number 1.67 → 4.52, 2.11 → 7.77. Safe for the cover: its mini grids never pass `through`, so they have no faint block. |
| T1 | `e06b87d1` fix(arkademy): a key that unmounts the focused element hands focus to the player, not the page | `tour.ts` (`TOUR_KEEP_FOCUS_ATTRIBUTE`, `keyKeepsFocus`), `useTourPlayer.ts`, `StepRail.tsx` and `TourControls.tsx` (`data-tour-keep-focus`) | Before ← → Home End, when the key's target is not a step link or a control, focus moves to the player region (`focus({ preventScroll: true })`). |
| T6 | `08c2ef38` fix(arkademy): Play after a pause waits only for the rest of the phase | `tour.ts` (`elapsedAfterPause`; `pause`/`hidden` take `ms?`), `useTourPlayer.ts` | The hook records when the running timeout was armed (a ref written in the timer effect, read in handlers), so the time spent in the phase goes into the action. The reducer keeps it, capped 1 ms short of the phase's end. |
| T2 | `564de282` fix(arkademy): Back to a tour lands on the step that was being watched | `tour.ts` (`stepFromSearch`), `useTourPlayer.ts` | The reducer's lazy initialiser reads `window.location.search` when `window` exists (exactly one valid `step`, else none) and falls back to the server's `initialStep`. A restored tour comes back on the watched step, complete and paused. |
| T3 | `ad48e7a3` fix(arkademy): a tour opened in a background tab waits to be seen before it plays | `tour.ts` (`resolveTourState` / `createTourReducer` take `hidden`), new `lib/hooks/useDocumentHidden.ts`, `useTourPlayer.ts` | While the page is hidden, a pending autoplay stays pending and paused; it plays once the page is seen. |
| T7 | `c3a2c832` fix(arkademy): an invalid step leaves the address when the tour starts from step 1 | `tour.ts` (`searchForStep`), `useTourPlayer.ts` | The address the player writes: `?step=3&step=5`, `0`, `10`, `-1`, `3.5` and `abc` are removed on step 1; other parameters are kept. |
| T4 | `4f5ae045` fix(arkademy): the live region keeps pace with the tour and speaks step 1 on arrival | `tour.ts` (`stepAnnouncement`'s `answers?`), new `lib/hooks/useHydrated.ts`, `useTourPlayer.ts` (`manualStep`), `CanvasWalk.tsx` | While the tour plays by itself, only "Step N of 9, Block. Prompt". The answers are given when the tour is paused, or on a step the reader moved to themselves. The region is empty on the server and filled after hydration, so step 1 is announced once. |
| T9 | `9ad16e06` feat(arkademy): the step rail takes its accessible name as a prop | `StepRail.tsx` | `label?: string`, default "Tour steps". |
| T5 | `4d9362a4` fix(arkademy): a step left open is round with a darker dashed outline | `StepRail.tsx` | Dashed border at full `muted-foreground`: 2.25 → 4.52 (light), 3.40 → 7.77 (dark). A second cue: an open step is round, the others square. |
| T12 | `e91d66b6` fix(arkademy): the card shows the answers that have arrived and counts the rest, instead of an empty space | `QuestionCard.tsx` | Only arrived answers are on the page, with "· 2 of 4" in the kicker until all have arrived. The open-on-purpose box and the sentence appear when they arrive. Arrivals fade in once from `@starting-style` (`motion-safe:starting:…`). The content below moves; the controls do not (rehearsed at 900 and 1440; fixed at 400). |
| T11 | `00c0aa93` feat(arkademy): the question card shows its block filling on the canvas, at every width | `QuestionCard.tsx` (`BlockPreview`, not exported) | Under "In the paragraph", "On the canvas" shows the current block with its number and title, and its answers without notes. It is dashed with "Left open on purpose." when left open, and appears with the sentence. |
| T13 | `c3539115` feat(arkademy): the end card comes into view when the tour ends | `CanvasWalk.tsx` | When the tour plays to its end, the end card scrolls into view (`block: "nearest"`, smooth, or at once under reduced motion). Focus does not move. Not on `?step=9` arrival. |
| T10 | `fbd8a66c` test(arkademy): the cover's tour links read from its syntax tree, not its text | `tests/app/arkademy-tour.test.js` | The cover's checks read its TypeScript syntax tree. The hook's two source-text checks are dropped: the keyboard-shortcuts suite already refuses a window or document keydown listener, and the address logic is `searchForStep`, tested. The exact-class "nothing waits" check is replaced by "no element waits hidden". The hook's browser-only behaviour has the Playwright script in "Part done when". |
| — | *(this commit)* docs(arkademy): the record after review | this file | — |

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
3. **Answers that have not arrived are absent, as the spec says** (after review). Reserving their space read as a broken, empty card. The card shows what has arrived, with a slim "N of M" count, and the content below moves. The controls never do: they sit above the card, and are fixed to the bottom on phones.
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
19. **After review: the chain in the card.** The question card ends with "In the paragraph" (the sentence) and "On the canvas" (the block), so answers, sentence and block are on screen together at 400 and 900, and at 1440 for a long example whose own block is below the fold. The canvas below keeps the whole picture.
20. **After review: a restored tour is complete and paused** on the step its address holds. A tour left on step 1 before its address changed has a clean address, so it autoplays again from step 1. Without `history.state` it cannot be told apart from a fresh visit.
21. **After review: the live region** gives "Step N of 9, Block. Prompt" while the tour plays by itself, and the answers too when paused or on a step the reader moved to. Measured on the real library, the spoken text per tour drops from 248 words (Pebbles) and 454 (Livestorm) to the nine short forms.
22. **After review: the faint block** is muted text, not a faded block (part 2's `CanvasGrid`). A step left open on the rail is round and dashed (two cues).

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

**Pure (`lib/arkademy/tour.ts`; names part 4 must not reuse in `lib/arkademy/`):** `TOUR_TIMING`, `StepTimeline`, `stepTimeline`, `tourTimelines`, `StepView`, `stepView`, `nextBoundary`, `elapsedAfterPause`, `TourState`, `TourAction` (`pause` and `hidden` take `ms?`), `initialTourState`, `resolveTourState(state, timelines, reducedMotion, hidden = false)`, `createTourReducer(timelines, reducedMotion = false, hidden = false)`, `parseStepParam`, `stepFromSearch(search)` (exactly one valid `step`, else null), `searchForStep(search, step)` (the query string to write, or null), `tourHref`, `stepAnnouncement({ …, answers?: boolean })`, `tourEndAnnouncement`, `TOUR_KEEP_FOCUS_ATTRIBUTE` (`"data-tour-keep-focus"`), `keyKeepsFocus(target)`.

**Constants (`lib/arkademy/constants.ts`, part 1 after review):** every plain constant of the schema and its derived types. **Client code imports runtime values from `./constants` (or `@/lib/arkademy/constants`), never from `schema.ts`**, which builds the zod schemas at load. Type-only imports from `schema.ts` are fine. The test loader accepts a re-export of the same value. For your own canvas, `parseStepParam` is the same `?step` parser. `tourHref` is the tour's address only; build `yours` links on `BMC_YOURS_PATH`.

**Hooks:** `usePrefersReducedMotion()`, `useDocumentHidden()` and `useHydrated()` (all reusable as they are, `useSyncExternalStore`, no effect). `useTourPlayer` (tour only) returns `{ state, view, reducedMotion, manualStep, toggle, pause, back, next, goto, onKeyDown }`.

**Components:**

| Component | Props | Notes for part 4 |
|---|---|---|
| `CanvasWalk` (`CanvasWalk.tsx`, client) | `CanvasWalkProps = TourWalkProps`: `{ mode: "tour"; company; questions; state; initialStep; next: { name; href } \| null; examplesHref; endActions?: ReactNode }` | Widen `CanvasWalkProps` to `TourWalkProps \| EditWalkProps` (`mode: "edit"`), and branch in `CanvasWalk` (`props.mode === "edit" ? <EditWalk …/> : <TourWalk …/>`). Reuse the layout classes: the root `grid gap-6 xl:grid-cols-[minmax(0,1fr)_48rem] xl:items-start`, and the right column `CanvasLink className="flex min-w-0 flex-col gap-6"` with the paragraph section `md:order-last`. |
| `StepRail` (`StepRail.tsx`, no hooks) | `{ steps: readonly StepRailItem[]; current; hrefFor(step); onSelect(step); label?: string; className? }`; `StepRailItem = { block; status: "answered" \| "open" \| "empty"; reached }`; `StepStatus` | For your canvas: `reached = status !== "empty"`, `hrefFor = (n) => \`${BMC_YOURS_PATH}?step=${n}\``, and a `label` of its own (default "Tour steps"). Its links carry `data-tour-keep-focus`. |
| `QuestionCard` (`QuestionCard.tsx`, no hooks) | `{ question; number; total; company: { name }; state; visibleAnswers; sentence; sentenceShown; headingId; ref?; className? }` (props unchanged after review); also `ARKADEMY_KICKER` (the mono kicker class) | Read-only: part 4's `QuestionEditor` is its own card. Reuse `ARKADEMY_KICKER` for the "Question N of 9 · {block}" line. It now lists only arrived answers ("N of M") and ends with "In the paragraph" and "On the canvas" once `sentenceShown`. |
| `TourControls` (`TourControls.tsx`, no hooks) | `{ step; steps; playing; atEnd; onBack; onToggle; onNext; className? }` | Tour only; its bottom-bar pattern (`fixed … md:static`) is the one to copy for Back/Next. |
| `TourEndCard` (`TourEndCard.tsx`, server-safe) | `{ company; next; examplesHref; actions?: ReactNode; className? }` | `actions` renders first in its button row. |

**The two insertion points for "Start your own":**

1. **The tour's end card.** In `app/arkademy/business-model-canvas/tour/[example]/page.tsx`, in `TourBody`'s `<CanvasWalk …>`, add `endActions={<StartYourOwnButton />}`. `CanvasWalk` hands it to `TourEndCard`'s `actions`, which renders it before "Next example" and "All examples". `StartYourOwnButton` is a client component (it reads the draft key to choose between "Start your own" and "Continue your canvas"); a server page may pass it as a prop to the client `CanvasWalk`. Use the `stone` button variant (spec: the one special action per page). Nothing changes in `TourEndCard.tsx` or `CanvasWalk.tsx`.
2. **The cover's actions row.** In `app/arkademy/business-model-canvas/page.tsx`, in `CoverFor`'s ready branch, the `actions` prop of `CoverHead` holds the "Play a tour" button. Put `<StartYourOwnButton />` before it, as one fragment (`actions={<><StartYourOwnButton /><Button asChild variant="outline">…Play a tour…</Button></>}`). `CoverHead` lays them out in `mt-6 flex flex-wrap gap-2`. The suite's check `cover: no link to your own canvas yet (part 4)` (it reads the cover's syntax tree for the identifier `BMC_YOURS_PATH`) must then be removed or inverted in `tests/app/arkademy-tour.test.js`.

---

## Part done when

On `feat/arkademy-tour` alone (without part 4), in the worktree `…/scratchpad/arkademy-p3-fix` after review. Real results:

```
rm -rf .next && npx tsc --noEmit             → silent
npm run lint                                → ✖ 3 problems (0 errors, 3 warnings)  (main's three no-img-element warnings)
actionlint                                  → silent
env -u DATABASE_URL npm run build           → exit 0; ƒ /arkademy/business-model-canvas/tour/[example]
npm run generate && git status --porcelain  → nothing
npm run test:arkademy-tour                   → 189 PASS, All arkademy-tour tests passed. (Node 26 and Node 20.19.5)
npm run test:arkademy-paragraph             → All arkademy-paragraph tests passed. (both)
npm run test:arkademy-schema                → All arkademy-schema tests passed. (both)
npm run test:keyboard-shortcuts             → All keyboard shortcut tests passed (both)
npm run test:docs-visibility                → All docs-visibility tests passed (both)
npm run test:landing                        → All landing tests passed. (both)
npm run test:panel-semantics                → All panel-semantics tests passed (both)
DATABASE_URL=… npm run test:arkademy-api    → All arkademy-api integration tests passed.
```

(Before review, in the main worktree, `npm run lint` also counted 15 errors in the gitignored `arkademy-content/*.js`. A worktree without that folder has none.)

**The hook in a browser.** `next dev` against a scratch Postgres with the fixture and the stress example published. With Playwright from a scratch folder, run `PW=<folder> node tour-fix-check.js <base> tidewise`, then the same with `pebbles` and `anthropic` after publishing the real library into the scratch database only. Expected: every line `PASS`, exit 0. Rehearsed results:

| Example | Result |
|---|---|
| Tidewise | 28 PASS |
| Pebbles | 26 PASS, 1 SKIP (no note on its step 6) |
| Anthropic | 26 PASS, 1 SKIP (no note on its step 6) |

```js
// PW=<folder holding node_modules/playwright> node tour-fix-check.js <base> [company=tidewise]
// Asserts, in a real browser, what the hook does and no Node test can reach:
//   T1 focus survives a key press that unmounts the focused element (end-card link, note marker);
//   T2 browser Back restores the watched step, complete and paused;
//   T3 a tour loaded hidden waits, and plays once seen;
//   T4 the live region: the short form while playing, the answers when paused;
//   T6 Play after a pause waits only for the rest of the phase;
//   T7 an invalid ?step leaves the address;
//   T12 the controls do not move while answers arrive (900, 1440);
//   T13 the end card comes into view at the end, focus unmoved.
// Prints PASS/FAIL lines and exits 1 on any failure.
const { chromium } = require(process.env.PW + "/node_modules/playwright");
const [base, company = "tidewise"] = process.argv.slice(2);
const TOUR = `${base}/arkademy/business-model-canvas/tour/${company}`;
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};
const currentStep = (page) => page.evaluate(() => document.querySelector('[aria-current="step"]')?.textContent);
const playLabel = (page) => page.evaluate(() => document.querySelector('[aria-label$="the tour"]')?.getAttribute("aria-label"));
const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el === document.body ? "BODY" : `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.textContent.trim().slice(0, 30)}`;
});

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const fresh = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    return { ctx, page };
  };

  // T1 — from the end card's "Next example" link, then from a note marker.
  {
    const { ctx, page } = await fresh();
    await page.goto(`${TOUR}?step=9`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /^Next example/ }).focus();
    await page.keyboard.press("ArrowLeft");
    check("T1: ← from Next example: focus moves to the player", (await active(page)) === "section Tour player", await active(page));
    await page.keyboard.press("ArrowLeft");
    check("T1: and the next ← still moves the step", (await currentStep(page)) === "7", await currentStep(page));
    await page.goto(`${TOUR}?step=6`, { waitUntil: "networkidle" });
    const marker = page.locator('section[aria-label="Tour player"] [data-note-marker]').first();
    if (await marker.count()) {
      await marker.focus();
      await page.keyboard.press("ArrowRight");
      check("T1: → from a note marker: focus moves to the player", (await active(page)) === "section Tour player", await active(page));
      await page.keyboard.press("ArrowRight");
      check("T1: and the next → still moves the step", (await currentStep(page)) === "8", await currentStep(page));
    } else console.log("SKIP: T1 note marker (no note on step 6 of this example)");
    await ctx.close();
  }

  // T2 — Back after autoplay moved on, and after Play from a cited step.
  {
    const { ctx, page } = await fresh();
    await page.goto(TOUR, { waitUntil: "networkidle" });
    await page.waitForFunction(() => location.search === "?step=3", null, { timeout: 60000 });
    await page.getByRole("link", { name: "Business Model Canvas" }).click();
    await page.waitForURL(/business-model-canvas$/);
    await page.goBack();
    await page.waitForTimeout(800);
    check("T2: Back after autoplay lands on step 3", (await currentStep(page)) === "3", await currentStep(page));
    check("T2: complete and paused", (await playLabel(page)) === "Play the tour", await playLabel(page));
    check("T2: the address still says step 3", (await page.evaluate(() => location.search)) === "?step=3");
    await page.goto(`${TOUR}?step=2`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Play the tour" }).click();
    await page.waitForFunction(() => location.search === "?step=4", null, { timeout: 60000 });
    await page.getByRole("link", { name: "Business Model Canvas" }).click();
    await page.waitForURL(/business-model-canvas$/);
    await page.goBack();
    await page.waitForTimeout(800);
    check("T2: from ?step=2 played to 4, Back lands on 4", (await currentStep(page)) === "4", await currentStep(page));
    await ctx.close();
  }

  // T3 — loaded hidden (visibility emulated before any script), then seen.
  {
    const { ctx, page } = await fresh();
    await page.addInitScript(() => {
      window.__hidden = true;
      Object.defineProperty(document, "visibilityState", { get: () => (window.__hidden ? "hidden" : "visible") });
      Object.defineProperty(document, "hidden", { get: () => window.__hidden });
    });
    await page.goto(TOUR, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    check("T3: hidden on load, it waits on step 1", (await currentStep(page)) === "1" && (await page.evaluate(() => location.search)) === "");
    check("T3: paused", (await playLabel(page)) === "Play the tour", await playLabel(page));
    check("T3: no answer has arrived", (await page.locator('section[aria-label="Tour player"] ul li').count()) === 0);
    await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForTimeout(400);
    check("T3: seen, it plays", (await playLabel(page)) === "Pause the tour", await playLabel(page));
    await ctx.close();
  }

  // T4 + T6 — the live region, and resuming mid-phase.
  {
    const { ctx, page } = await fresh();
    await page.goto(TOUR, { waitUntil: "networkidle" });
    await page.waitForTimeout(150);
    const live = () => page.evaluate(() => document.querySelector("[aria-live]").textContent);
    check("T4: step 1 is spoken on arrival, short while playing", /^Step 1 of 9, [^.]+\. [^]*\?$/.test(await live()), await live());
    await page.waitForTimeout(500); // ~650 ms into the 1,200 ms question phase
    await page.getByRole("button", { name: "Pause the tour" }).click();
    check("T4: paused, the answers are given", /answer/.test(await live()), await live());
    await page.waitForTimeout(1500);
    const t0 = Date.now();
    await page.getByRole("button", { name: "Play the tour" }).click();
    await page.locator('section[aria-label="Tour player"] ul li').first().waitFor({ timeout: 5000 });
    const waited = Date.now() - t0;
    check("T6: Play waits only for the rest of the phase (< 900 ms, not 1,200)", waited < 900, `${waited} ms`);
    await ctx.close();
  }

  // T7 — invalid steps leave the address.
  for (const bad of ["?step=3&step=5", "?step=0", "?step=10", "?step=-1", "?step=3.5", "?step=abc"]) {
    const { ctx, page } = await fresh();
    await page.goto(`${TOUR}${bad}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const search = await page.evaluate(() => location.search);
    check(`T7: ${bad} is dropped from the address`, search === "" || search === "?step=2", search);
    await ctx.close();
  }

  // T12 — the controls stay put while answers arrive.
  for (const width of [900, 1440]) {
    const { ctx, page } = await fresh({ viewport: { width, height: 900 } });
    await page.goto(TOUR, { waitUntil: "networkidle" });
    const top = () => page.getByRole("button", { name: /the tour$/ }).evaluate((el) => Math.round(el.getBoundingClientRect().top));
    const tops = [];
    for (let i = 0; i < 8; i++) { tops.push(await top()); await page.waitForTimeout(700); }
    check(`T12: at ${width} the play button never moves`, new Set(tops).size === 1, tops.join(","));
    await ctx.close();
  }

  // T13 — the end card comes into view; focus does not move.
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const { ctx, page } = await fresh({ viewport: { width: 400, height: 860 }, reducedMotion });
    await page.goto(`${TOUR}?step=8`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Play the tour" }).click(); // step 8 complete: step 9 plays to the end
    const before = await active(page);
    await page.waitForFunction(() => document.querySelector('[aria-label="Replay the tour"]'), null, { timeout: 40000 });
    await page.waitForTimeout(1200);
    const inView = await page.evaluate(() => {
      const r = document.querySelector("#tour-end-title").getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    check(`T13 (${reducedMotion}): the end card's title is in view`, inView);
    check(`T13 (${reducedMotion}): focus did not move`, (await active(page)) === before.replace("Pause", "Replay"), `${before} → ${await active(page)}`);
    await ctx.close();
  }

  check("no console error in any of it", errors.length === 0, JSON.stringify(errors));
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
```

**Production server (before review, unchanged since):**

- `/tour/nobody` → 404 in the chrome, with only the document's own 404 logged.
- The slow path streams the fallback at 0.36 s; an unknown id met there is the not-found page with `noindex` (status 200).

**Screenshots after review:** whole Pebbles and Anthropic tours (real library, scratch database only) at 400, 900 and 1440 px, light and dark, at step 1 (first phase), step 3 (mid-answers), step 6 (its sentence) and step 9 (ended, full page too). 48 shots: no sideways scroll, one `h1`, zero console errors. Kept outside the repo with the owner's backups (`p3-fix-shots/`).

**Before the PR:** `gh stack submit --auto` (not run: this part was built without pushing), and on the part 3 PR, title `feat(arkademy): the tour (part 3/4)`, label `no-lab-note`, no `## Lab Note` section. Read the PR's comments after opening.
