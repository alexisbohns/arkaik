# Arkademy — Part 4: your own canvas — Implementation Plan and Record

> **Status: built.** This plan was executed on `feat/arkademy-your-canvas`, stacked on part 3's real tip `8c33cab1`. It is now the part's record: § "As built" lists every change against the plan that part 3's real code or the real library required, the tasks show the code as committed (final state, after `adf4f62e`), and § "Part done when" holds the real results. Steps keep the checkbox syntax so the part can be replayed. After review, eighteen more commits apply the review's fixes (§ "Review fixes"); where the task code below differs from the branch, the branch and that section win.

**Goal:** `/arkademy/business-model-canvas/yours[?step=1..9]`, where a visitor answers the Business Model Canvas's nine questions for their own product, one question at a time, and watches the paragraph and the canvas build as they type. A question can be left open on purpose. Inspirations from the library sit beside the question. The draft is saved in this browser only, under `arkaik:arkademy:bmc`. There are three exports: copy the paragraph, copy as Markdown, download JSON. Start over asks first. The cover gains its "Start your own" / "Continue your canvas" action, and this part's PR carries the single Lab Note for the whole Arkademy.

**Architecture:**
- **Pure rules** go into `lib/arkademy/` beside parts 1 and 2's modules, tested from Node by one new suite (`test:arkademy-canvas`) through part 1's loader:
  - `inspirations.ts`: the catalog, what a question still offers, and a label made an answer.
  - `canvas.ts`: the draft, its pure reducer, its state as the paragraph reads it, and `?step=`.
  - `canvas-storage.ts`: the versioned envelope, read tolerantly.
  - `canvas-export.ts`: paragraph, Markdown and JSON.
- **One module store** in `lib/hooks/useCanvasDraft.ts` is the only reader and writer of the key. It is read through `useSyncExternalStore`, with a "loading" server snapshot, and the draft is read when the first component subscribes, after mount. So there is no hydration mismatch and no setState in an effect.
- **One client screen**, `components/arkademy/YourCanvas.tsx`, renders part 2's `ParagraphView` and `CanvasGrid` inside one `CanvasLink`, beside four new pieces: `QuestionSteps`, `QuestionEditor`, `InspirationList` and `CanvasToolbar` (with `StartOverDialog`).
- **The page** is a server component that follows the cover's head-start-then-Suspense pattern. `StartYourOwnButton` is the cover's action.

**Tech Stack:** Next.js 16.2 App Router, React 19 (`useSyncExternalStore`, `flushSync`), Tailwind CSS 4, the app's shadcn primitives (`Button` with the `stone` variant, `Card`, `Input`, `Textarea`, `Checkbox`, `Label`, `Dialog`, `Skeleton`), sonner toasts, lucide icons that are already registered, plain Node test scripts (`tests/app/load-arkademy.js` for `lib/arkademy/`, `tests/app/load-arkademy-tsx.js` for components), and GitHub Actions on Node 20.

**Spec:** `docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md` as of part 2's tip `4c7b137`, § "Your own canvas", § "Lab Notes", § "The stack → Part 4" and § "Settled questions" (no copy-as-prompt). Where this plan and the spec differ, § "Readings and deviations" says why, and this plan wins.

**Branch:** `feat/arkademy-your-canvas`, created by Task 1 with `gh stack add` on top of part 3's branch `feat/arkademy-tour`, in the worktree `/Users/alexis/code/arkaik-arkademy`. A stack already exists: never run `gh stack init`.

**Position in the stack:** part 4 of 4, the top. It changes nothing in parts 1 and 2 except one insertion in the cover page's actions row. In part 3 it touches only the tour page (one prop, `endActions`) and one source check in part 3's suite, which it inverts (Task 8).

**Rehearsed, then built:** every task was first rehearsed in a detached worktree of part 2 at `4c7b137`, before part 3 existed. It was then built on the real branch, on top of part 3, and the whole check below was re-run there. A scratch Postgres 16 held the part 1 fixture, and a dev server served the pages. A Playwright run used the page for real:
- a whole canvas filled by keyboard only;
- an inspiration added and reworded;
- a question left open and the choice undone;
- reorder and remove;
- the five-answer cap;
- reload;
- a corrupt, a newer and a blocked storage value;
- Start over, two tabs, and the three exports (clipboard read, download captured).

Screenshots at 400, 900 and 1440 px, light and dark, of the empty, a half-filled and a full canvas, a larger fictional library, the cover and the no-library state were opened and read. `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run generate` and every suite named below were run, and the new suite also ran under a real Node 20.19.5. Every expected output in this plan is what that run printed. Code shown in full is the committed file, byte for byte.

## As built

The commits, oldest first (`git log --oneline feat/arkademy-tour..HEAD`, read upwards):

```
adf4f62e fix(arkademy): an inspiration that starts with a name keeps its capital
3ef44b8c docs(arkademy): your own canvas in the folder map
df98b448 feat(arkademy): Start your own on the cover and at the end of every tour
a88d38ac feat(arkademy): your own canvas — one question at a time, inspirations, the paragraph and the canvas building as you type
169a1250 feat(arkademy): the draft's store, read after mount, and a text download
78f04b5c feat(arkademy): your canvas's exports — the paragraph, Markdown and JSON
85de68e3 feat(arkademy): your canvas in browser storage, read tolerantly
640852f6 feat(arkademy): your canvas's draft and its pure reducer
eee9d309 feat(arkademy): inspirations for your own canvas, from the library's shared entities
51a40bdd docs(arkademy): implementation plan for part 4, your own canvas
```

The final docs commit (this record) follows.

**Changes required by part 3's real code** (its record, § "What part 4 gets from this part"):
1. **`parseStepParam` is reused.** Part 3 exports `parseStepParam` from `lib/arkademy/tour.ts`, so `canvas.ts` does not define `parseCanvasStep`. The yours page imports part 3's parser. Its eight test cases are part 3's and are not repeated, so this suite has 8 checks fewer than rehearsed.
2. **`ARKADEMY_KICKER` is reused.** `QuestionEditor` and `YourCanvas` take the mono kicker class from part 3's `QuestionCard.tsx`. It is the same string the rehearsal wrote inline.
3. **"Start your own" goes where part 3 left room for it.**
   - On the cover it goes first in `CoverHead`'s existing `actions` row, as a fragment before "Play a tour", not in a second row after the tagline.
   - On the tour it goes to the end card through `CanvasWalk`'s `endActions`, one prop in `app/arkademy/business-model-canvas/tour/[example]/page.tsx`.
   - `TourEndCard.tsx` and `CanvasWalk.tsx` are unchanged.
   - The plan's conditional Task 10 is therefore folded into Task 8. Part 3's suite check "cover: no link to your own canvas yet (part 4)" is inverted in the same commit, into "cover: Start your own leads the hero's actions, before Play a tour (part 4)", and a check "tour: the end card offers your own canvas (part 4)" is added.
4. **`StartYourOwnButton` has no `variant` prop.** The stone button is the special action on both pages: the tour page has no other stone button. Its default size is `default`, matching "Play a tour" and the end card's buttons.
5. **`CanvasWalk` is not widened with an edit mode,** though part 3's record suggests it. This part keeps its own screen (`YourCanvas`), as planned (reading 1).
6. **`StepRail` is not used for the step row, and `QuestionSteps` stays.** The rail is labelled "Tour steps" and names each link "Step N: …", both hard-coded; adopting it meant changing part 3's component under review. Its 28px links are smaller than the 36px targets an editing screen on a phone gets here. Its `href` per step, however, is a good idea for a later shared component (§ "For the owner").

**Change required by the real library** (loaded into the scratch database only, never committed): `answerFromLabel` lowered names that are capitalised by their first letter alone:
- "Broadcom and Google for TPU capacity" became "broadcom …";
- "Apple App Store and Google Play" became "apple App Store …";
- "Agentic AI Foundation" became "agentic …".

Commit `adf4f62e` adds `inspirationAnswer(label, wordings)`. The catalog computes each inspiration's `answer` on the server, keeping the label as it is when one of the companies' own wordings of the entity holds the label's first word with the same capital: wordings sit mid-sentence, where a capital is a name's. `Inspiration` gains `answer`, and `addInspiration` carries `text` (that answer) instead of `label`. On the real library, the labels it keeps are exactly the names: Supabase, Apple, GitHub, Agentic AI Foundation, Broadcom, Daily.co, Gladia, Google (twice), Interprefy, Kota, Skello, Slack. No common word is kept. The tests were written first and seen failing (`TypeError: inspirationAnswer is not a function`).


---

## Review fixes

The review found nothing blocking and fifteen things to fix. Each is one commit on `feat/arkademy-your-canvas` after `4304f651`, written test first wherever a Node test reaches it. Three more commits fix what the browser run of those fixes found. Read oldest first:

```
0de2a26a test(arkademy): the canvas store in Node, and sturdier checks in place of source text      Y13
0d08a890 fix(arkademy): a name or an answer drops the control characters the schema refuses          Y10
45e8a612 fix(arkademy): an answer of only punctuation is no answer                                    Y2
25d1b50a fix(arkademy): a duplicate is caught by its words, not its punctuation or case               Y3
e5d00858 fix(arkademy): the Enter that confirms an input-method word adds nothing                     Y6
8b1f525f fix(arkademy): Shift+Enter does nothing in an answer; Escape clears the add field            Y11
a823fd40 fix(arkademy): emptying an answer and pressing Tab keeps the focus on the page               Y5
b11c2f56 fix(arkademy): every result of the visitor's own actions is announced                        Y4
d1293316 fix(arkademy): the Markdown export escapes a name or an answer that reads as structure       Y8
4de4b75d fix(arkademy): an inspiration names its example, not a fact about the company                Y12
e86bdb58 feat(arkademy): inspirations list the shared answers first, the rest behind one step         Y15
ebe60649 fix(arkademy): a storage that refused a write is tried again on the next change              Y14
21c5aa7a fix(arkademy): text set aside from an unreadable draft stays offered until discarded         Y1
7b438979 fix(arkademy): two tabs typing at once no longer lose each other's keystrokes                Y9
c1bc8d78 fix(arkademy): "left open on purpose" and the current sentence pass 3:1 in both themes       Y7
c57fb222 fix(arkademy): a confirmed action runs once its dialog has closed, so the focus lands        (found running Y1)
e0ce5c5a fix(arkademy): removing a field of only punctuation is announced as an empty answer          (found running Y2/Y4)
f259ff2a fix(arkademy): the inspirations column is never taller than the question card                (found running Y15)
```

**Choices made where the review left one open**
- **Y1, kept text.** Every unreadable value is kept. `arkaik:arkademy:bmc:unreadable` holds a JSON list, oldest first (`readKeptAside`, `keepAside`). A bare value written by the first build reads as one kept value. The page reads the list on every load and offers one download per value ("Download the old text", or "Download text 1", "Download text 2"). Discard asks first, in `ConfirmDialog` (Cancel, then a red "Discard"), then removes the key and focuses the name field. `StartOverDialog` became the general `ConfirmDialog`.
- **Y3, an edit into a duplicate.** The visitor's words are kept: the field is marked `aria-invalid`, says "Same as answer N." until it is reworded, and leaving it changes nothing (`duplicateAnswers`). Adding a duplicate stays refused; answers are compared cleaned (`cleanAnswer`) and case-folded.
- **Y9, two tabs.** When another tab writes, two kinds of field stay as this tab has them:
  - each field this tab has changed since its last save;
  - the field with the focus (`setDraftFieldInFocus`).

  A field is the name, or one question (its answers and its left-open flag). Every other field comes from the other tab (`mergeOtherTab`, pure and tested). The pending save stays scheduled and wins for those fields. An answer from the other tab whose id a kept answer holds gets a new id, so the field under the caret is never remounted. Two tabs typing in the same question at the same moment still end on the last writer for that question.
- **Y10, control characters.** `schema.ts` keeps its list unexported, so `canvas.ts` holds its own `stripTextControls`, and the suite checks every BMP code point against the schema's `textCharacterProblem`, so the two cannot drift. No part 1 file is edited.
- **Y14, retrying.** A failed write, or a probe that failed at load, is retried on the next change, and success clears the notice. Storage that could not even be read at load is never written, because it may hold a draft this page has not seen.
- **Y15, inspirations.**
  - Only entities two examples or more use are listed at once, most shared first (`splitInspirations`).
  - "From one example (N)" reveals the rest, grouped under "In the … example" in the tool's example order.
  - A question with nothing shared says "No two examples share an answer here yet." above the disclosure.
  - From 768 px the column is never taller than the question card: it scrolls inside the card's height and stays in view (sticky) past a taller card.
  - On a phone, "Stuck? N inspirations" sits inside the card, above Back and Next.
  - `INSPIRATIONS_SHOWN` is gone. `YourCanvas`'s `tool` prop carries `examples`.

**The other fixes, as built**
- **Y2:** `hasWords` decides what is an answer. "..." and "!" are refused on add, removed on blur after an edit, never stored, never count against "Leave this open", and are dropped from a stored draft.
- **Y4:** `canvasAnnouncement` words every result:
  - added, with "n of 5" or the fifth;
  - refused as a duplicate, as punctuation only, or at five;
  - moved to position n of m;
  - removed, or "the empty answer";
  - left open and undone;
  - Start over.

  A counter appends an invisible no-break space on alternate messages, so a repeat is still read.
- **Y5:** an emptied row removed on blur, while the focus was moving into that same row, sends the focus to the next answer or the add field.
- **Y6:** `isPlainEnter` refuses keyCode 229 (WebKit fires `compositionend` before the confirming Enter's keydown). It applies in the answer fields, the add field and the name field.
- **Y7:** measured ratios are below.
- **Y8:** `markdownText` escapes backslashes and backticks anywhere, and a line-opening `#`, `-`, `+`, `*`, `>` or `1.`/`1)`, in the title, the paragraph and each answer. **A deliberate departure from "answers as typed".**
- **Y11:** Shift+Enter does nothing in an answer or the add field. Escape clears the add field when it has text.
- **Y12:** "in the Anthropic example", or "in the Notion and Figma examples" (`examplesPhrase`), in the accessible name and the visible line.
- **Y13:** a new suite, `test:arkademy-draft-store` (44 checks, its own CI step), drives the store with a fake `window`, an in-memory `Storage` and fake timers:
  - load, the throttle, page hide and leaving;
  - another tab, and two tabs typing;
  - blocked, read-only and full storage, and the retry;
  - newer and unreadable drafts, and the kept list and its discard.

  The store exports `canvasDraftStore` for it. The brittle checks are replaced:
  - the stone class-string check is dropped;
  - the editor's kicker is checked on its text and its question on the `h2` element;
  - the keydown source scan is dropped (`tests/app/keyboard-shortcuts.test.js` walks every component).

**Edits to files owned by parts 1 to 3**
- `tests/app/arkademy-tour.test.js` (part 3), commit `0de2a26a`:
  - line 355: the cover check compares positions, `cover.indexOf("<StartYourOwnButton") < cover.lastIndexOf("Play a tour")`;
  - line 358: the tour check is `tourPage.includes("endActions={<StartYourOwnButton")`.

  No other part 1–3 file changed in these commits. `docs/architecture.md` (shared) has its `StartOverDialog` line renamed to `ConfirmDialog` in `21c5aa7a`.

**Contrast, measured** in Chromium against what is behind each line (light / dark):

| Line | Before (review) | After |
|---|---|---|
| Open step: dashed border | 2.25 / — | 4.51 / 7.76 |
| Open step: dashed-circle icon (new second cue) | — | 4.51 / 7.76 |
| "Leave this open" panel: dashed border | 1.79 / 2.41 | 4.83 / 6.91 |
| Current sentence: underline | 2.32 / — | 4.83 / 6.91 |
| Preview's blank: dashes | 1.94 / — | 4.59 / 6.35 |

**The real library** (scratch database only), shared at once + from one example, per question:

| Question | Shared | From one example |
|---|---|---|
| Customer segments | 4 | 26 in 11 groups |
| Value propositions | 1 ("work handed to an AI agent as to a teammate") | 38 in 11 groups |
| Channels | 6, led by "free self-serve sign-up" (4) | 15 in 9 groups |
| Customer relationships | 4, led by the account manager and self-serve (4 each) | 13 in 8 groups |
| Revenue streams | 3, led by "per-seat subscription" (4) | 8 in 5 groups |
| Key resources | 2 | 25 in 11 groups |
| Key activities | 4 | 17 in 9 groups |
| Key partners | 5 (AI vendors, model providers, the app stores, CRMs, GitHub) | 15 in 7 groups |
| Cost structure | 3, led by "engineering time and team" (5) | 5 in 4 groups |

The shared lists read as patterns, and value propositions now opens with one shared answer and an honest "From one example (38)". The column for value propositions measures 494 px at 1440 (the card's height) instead of about 2,900 px.

**Not done now (as agreed)**
- A live paragraph in the right column.
- "Continue your canvas" on a cover with no library.
- Safari's download: `downloadTextFile` revokes the object URL right after `click()`, as `downloadJson` does. The reviewer reports Safari may cancel a download whose URL is revoked that early. It is **unverified here**: no Safari run was possible. A deferred revoke (`setTimeout(…, 0)` or on the next frame) is the usual remedy.

## Readings and deviations

The spec fixes names and shapes; these are the places it was silent, ambiguous or wrong, and what the code below does.

1. **No `CanvasWalk mode="edit"`.** The spec has part 4 extend part 3's `CanvasWalk`, `StepRail` and `QuestionCard`. Part 3 was not built when this part was planned, and an editor shares little with a read-only player: inputs, focus rules, storage notices, inspirations. Part 4 therefore owns its screen (`YourCanvas.tsx`) and its step row (`QuestionSteps.tsx`). Both reuse part 2's `ParagraphView`, `CanvasGrid`, `CanvasLink` and `CopyButton` as they are. Sharing a step rail with the tour is a later, separate refactor.
2. **`?step=` is read with part 3's `parseStepParam`** (`lib/arkademy/tour.ts`). `canvas.ts` adds only `yoursHref(step?)`; `tourHref` is the tour's address alone.
3. **The reducer is pure.** Answer ids are sequential (`a1`, `a2`, …: one more than the highest in use, `nextAnswerId`), not random. `updatedAt` is stamped by the store when it applies a change, not by the reducer.
4. **Emptying an answer does not remove it at once.** The spec's `edit` with empty text removed the answer. That deleted the field under the visitor's caret mid-retype ("select all, type the new words"). An `edit` keeps the text as typed, blank included. The field removes a blank answer on blur. `draftState`, storage and the exports never see a blank answer.
5. **Additions to `DraftAction`:** `move` (`{ id, offset: -1 | 1 }`, within its question) for reordering, which the brief asks for and the spec's actions lacked. `add` and `addInspiration` refuse a duplicate (same words, any case, in the same question) and anything past five, returning the same object so the store writes nothing.
6. **Fields are auto-growing textareas, not inputs.** At 400 px a single-line input shows about 30 of an answer's 140 characters. Each answer and the add field are `Textarea` with `[field-sizing:content]`; Enter never inserts a line break (it adds, or moves on), and pasted line breaks become spaces. An answer is still one line of the paragraph. Browsers without `field-sizing` show one row that scrolls.
7. **Answers are read as shown.** Part 2's review made `displayAnswers` the one reading of answers for the paragraph and the grid: cleaned of a closing run of `. ! ? … ; : ,`, empties dropped. `questionStatus`, the Markdown and the JSON read through it too, so what is exported is exactly what is on screen: `bakers.` exports as `bakers`, and an answer of `...` is no answer. The spec said "as typed (trimmed)".
8. **Saving.** These were found in rehearsal:
   - A change is written at most 300 ms after the first unsaved one. This is a throttle: the spec's debounce never fired while someone typed without pausing.
   - A pending change is written at once on `pagehide` and when the last component unsubscribes (a client navigation away). With nothing pending, nothing is written. Flushing an idle tab overwrote a value another tab or the visitor had just changed.
   - An empty draft removes the key, so the cover says "Start your own" again.
   - A probe write at load detects blocked storage and a zero quota before the visitor types.
   - The `newer` read also carries a best-effort `draft`, shown and never saved.
9. **`StartOverDialog` owns its trigger.** The app's destructive confirmation is `DeleteConfirmDialog` (`components/graph/DeleteConfirmDialog.tsx`): a `Dialog` with a title, one sentence, Cancel (outline, first, focused) and the red action. Radix's Dialog returns focus on close only to its `DialogTrigger` (`node_modules/@radix-ui/react-dialog/dist/index.mjs:148`, `context.triggerRef.current?.focus()`). `DeleteConfirmDialog` has no trigger, so Cancel leaves focus on `<body>` everywhere it is used. `StartOverDialog` keeps the look and makes its button the trigger: Cancel and Escape return focus to "Start over", and a confirmed start over sends focus to the name field.
10. **Downloading reuses `downloadJson`'s technique, not the function.** `downloadJson` (`lib/utils/export.ts:153-169`) takes a `ProjectBundle` and its module imports the data layer, so `lib/utils/download.ts` gets `downloadTextFile(filename, text, type)`: Blob, object URL, a temporary link, revoke. `export.ts` is not touched; its suites have their own loaders.
11. **The current question is underlined in the paragraph, not tinted.** Part 2's `CanvasLink` tints a sentence and outlines its block on hover and focus. The current sentence is underlined instead (a different property), so a hovered sentence and the current one are never confused. Rehearsed: hovering the current sentence tints it and keeps its underline, and the current block never takes the hover outline.
12. **The page follows the cover's loading pattern.** It awaits `settledWithin(lookupArkademy(), ARKADEMY_HEAD_START_MS)` and renders in place when the library answered. Otherwise the breadcrumb, the `h1` "Your canvas" and the intro stream at once, and the editor (or the message) streams in behind `Suspense` with `LibraryPlaceholder`. Without a library, `ArkademyMessage` is followed by `StrandedDraft`: when this browser holds a draft, it downloads the stored value as it is (spec § "States without a document").
13. **Notes never appear on your own canvas.** `draftState` never carries a note, and an inspiration carries the entity's label and the companies' names only (the suite checks the keys).
14. **`StartYourOwnButton`** is the stone special action on the cover (first in the hero's actions row) and on the tour's end card. On the cover it is drawn only when the library is ready, since the actions row exists only then.
15. **The suite stubs `next/font/google`** while it renders `YourCanvas` in Node. `YourCanvas` takes `ARKADEMY_SECTION_TITLE` from `ArkademyChrome.tsx`, which imports `lib/fonts.ts`, and `next/font` runs only inside Next's compiler. The stub lives in the suite; part 2's `load-arkademy-tsx.js` is unchanged.
16. **No `.gitignore` line:** the suite builds into part 1's `tests/app/.test-build-arkademy/`, already ignored.
17. **An inspiration's answer keeps a name's capital** (`inspirationAnswer`, § "As built"). The spec's rule for `answerFromLabel` looks at the first word alone and cannot tell "Broadcom" from "Free", so the companies' own wordings decide. `Inspiration` gains `answer`, and `addInspiration` carries `text`.
18. **Part 3's suite is edited once:** its check that the cover has no link to your own canvas is inverted, as part 3's record asks (Task 8).

## The design

The owner asked for clear and simple, to be enhanced in a later iteration. Every choice below was checked in screenshots at 400, 900 and 1440 px, light and dark (§ "Part done when").

**What is on screen, by width.**
- **1440 px** (the 72rem column; screenshot `half-1440-light.png`):
  - The breadcrumb, the `h1` "Your canvas" (Gochi Hand), one line saying what the page does and that it stays in this browser, and "Read an example first" (the cover's `#examples`).
  - The name field.
  - The row of nine numbered steps, with "3 of 9 answered · 1 left open" at its right.
  - Two columns: the question card (`minmax(0,1fr)`) and the inspirations (20rem) beside it.
  - The paragraph card, at a 72-character measure, with the toolbar.
  - The canvas in the canonical ten-column arrangement.
  - At 900 px tall, the question, its answers, the inspirations and the start of the paragraph are on screen together. The card's own "In your paragraph" line shows this question's sentence as it is typed, so the live feedback stays where the eyes are while the full paragraph and the canvas are a scroll away.
- **900 px:** the same, with the inspirations in a 16rem column; the canvas keeps the canonical arrangement.
- **400 px:** one column in the same order.
  - The inspirations sit behind a full-width "Stuck? N inspirations" toggle under the card, one tap away; the card stays short and the keyboard does not cover a list.
  - An answer's move and remove buttons wrap under its field (the field keeps at least 15rem), so a 140-character answer reads in four lines, not seven.
  - The nine steps fit one row (36px targets, 4px gaps).
  - The canvas is one block per row.
  - No sideways scroll at any width.

**Moving between questions.**
- **In order:** Back and Next at the foot of the card. Next on question 9 reads "Read your paragraph" and focuses the paragraph's heading.
- **By keyboard:** Enter on an empty add field goes to the next question with the caret already in its add field, so a whole canvas fills with type, Enter, type, Enter, Enter. Enter in the name field goes to the add field. Enter in an answer goes to the add field.
- **By pointer:**
  - a step number;
  - a block's title on the canvas;
  - a gap pill in the paragraph ("open: who it is for").
- **Where focus lands:** pointer moves focus the question's heading (no touch keyboard pops up) and scroll the card into view if needed. Keyboard activations (`event.detail === 0`) land in the add field.
- **The URL:** each move rewrites `?step=N` with `replaceState`, so a reload returns to the same question.

**The first run.** An empty draft still shows the whole tool:
- the nine steps, all plain;
- question 1 with its hint and an empty add field;
- the "In your paragraph" line reading "This product is for ___." (the sentence with a dashed blank where the answer goes);
- the paragraph as nine "open: …" chips;
- the canvas with every block "Not answered yet.";
- the inspirations for question 1;
- the toolbar drawn but disabled.

**Naming the product.** "Your product's name", above the steps, with the placeholder "This product" (what the paragraph says while it is empty) and at most 60 characters. Its helper line says it opens the paragraph and, while storage works, "Saved in this browser only."

**Answers.**
- **Adding:** Enter or the Add button. At five answers the add field and the inspirations are disabled, the help line says "Five answers is the most a question takes.", and focus moves to Next.
- **Duplicates:** a duplicate (any case) is refused with "That answer is already here."
- **Length:** the last 20 of the 140 characters are counted down in the help line; `maxLength` stops the 141st.
- **Editing:** rewording happens in place.
- **Reordering:** with ↑ and ↓ buttons, or Alt+↑ and Alt+↓ in the field.
- **Removing:** with × (focus moves to the next answer, or the add field), or by emptying the field and leaving it.

**"Left open on purpose".**
- The checkbox shows only while the question has no answer. Ticked, its box turns dashed and says "Your paragraph says so. Untick it, or add an answer, to answer it after all."
- The step number turns dashed, the paragraph shows the dashed "left open on purpose: …" pill, and the block turns dashed with "Left open on purpose."
- To undo, untick it or add an answer (adding clears it).

**Inspirations.**
- The neutral labels of the question's kind, most shared first, each with "Crumb & Co, Tidewise and Inkwell" or "A, B and 6 more".
- Six are shown, then "Show all N" / "Show fewer".
- One click adds `answerFromLabel(label)` (lower-cased first letter unless the first word is like "GitHub" or "AWS"), remembering the entity and the library version, and announces "Added: …". Focus goes to the add field from the keyboard, or to the heading from a pointer.
- An inspiration already added, or whose label matches an answer, is not offered again.
- A question no example answers has no inspirations panel.

**Starting over.** The toolbar's quiet "Start over" opens "Start over?": "Your product's name and every answer leave this browser. Download JSON first if you want to keep a copy.", with Cancel (focused) and a red "Start over". Confirmed, the key is removed, the canvas is empty at question 1, the name field has focus, and a toast says "Started over."

**Storage.**
- **Unavailable** (blocked, private mode, quota): the canvas works in memory under a notice, "This browser is not saving your canvas: its storage is off or full. Download JSON before you leave to keep a copy.", with Download JSON.
- **Unreadable:** the raw value is copied to `arkaik:arkademy:bmc:unreadable` first. The canvas starts empty under "A canvas saved here earlier could not be read, so this one starts empty. Its text is kept aside in this browser.", with "Download the old text" and Dismiss.
- **Newer** (`v` above 1): shown, never saved, under "A newer version of this page saved your canvas. Reload to keep working on it; changes made here are not saved." with Reload.
- **Another tab** writing: this tab adopts it.

**A returning visitor** lands on the first question neither answered nor left open (or `?step=N`), with the name, the answers, the paragraph and the canvas as they left them. The cover's button reads "Continue your canvas".

**When done.**
- With every question answered or left open, the paragraph card ends with: "Every question is answered or left open on purpose. Paste your paragraph into the baseline prompt, or download the canvas to keep it." The link goes to the cover's `#prompt-title`.
- The toolbar copies the paragraph, copies the canvas as Markdown, or downloads `<name>-business-model-canvas.json`.

## Repo traps that apply

- **CI runs Node 20; this machine runs Node 26, which strips TypeScript.** Never `require` a `.ts` file from a test. The suite goes through `tests/app/load-arkademy.js` (pure modules) and `tests/app/load-arkademy-tsx.js` (components). Run it under Node 20 too when a binary is at hand (`/private/tmp/claude-503/-Users-alexis-code-arkaik/6c13545b-ad9c-48df-8d3e-f15018c9bdc0/scratchpad/node20/node-v20.19.5-darwin-arm64/bin/node` was used in the rehearsal).
- **`lib/arkademy/` imports only `zod` and its siblings by relative path.** The loader refuses `@/` by name (`tests/app/load-arkademy.js:52-56`). The new modules import `./schema`, `./paragraph`, `./tools`, `./canvas`, `./inspirations` and `./index-document` only. React, hooks and the DOM stay in `components/`, `lib/hooks/` and `lib/utils/`.
- **One merged export namespace.** The loader throws `"X" is exported by both …` on a repeated name across `lib/arkademy/*.ts`. Every name in § "Names this part exports" was checked against parts 1 and 2 at `4c7b137` and against the names part 3's draft plan lists for `tour.ts`. If part 3 shipped a name listed there, the suite fails at load: rename this part's name, not part 3's.
- **eslint with the React Compiler rules gates the build job.** The design keeps to them:
  - no `useEffect`;
  - no refs;
  - no setState in an effect;
  - the store is a module (like `useOverviewLayout`);
  - focus moves in event handlers (`flushSync`, then `document.getElementById(...).focus()`);
  - every keyboard handler sits on an element.
  `npm run lint` on the rehearsed tree printed `✖ 3 problems (0 errors, 3 warnings)`: the three `@next/next/no-img-element` warnings `main` already has. Part 3 may add warnings of its own; the gate is 0 errors.
- **No keydown listener on `window` or `document`.** `tests/app/keyboard-shortcuts.test.js:199` fails on one. Every handler here is a React `onKeyDown` on a field, and the suite checks `QuestionEditor.tsx`'s source too.
- **actionlint gates the build job.** The CI edit is one plain step; run `actionlint` after it (silent).
- **Generated files.** CI runs `npm run generate` and fails on a diff, and a lucide icon the repo has never used dirties `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css`. This part uses only registered icons (§ "Verified facts"). Do not add another icon. Rehearsed: `npm run generate` leaves the tree clean.
- **A stale `.next/` breaks `tsc`.** `tsconfig.json` includes `.next/types/**/*.ts`, and a build from another part leaves validators naming pages this branch may not have. `rm -rf .next` before `npx tsc --noEmit` after switching branches.
- **The dev server may ignore edits** in a worktree under `/private/tmp`. Restart it after `rm -rf .next/dev`, and `curl` the page for a class you just added before trusting a screenshot.
- **Turbopack needs a real `node_modules`** (`npm ci`), never a symlinked one.
- **Development reads Postgres on every request; production caches the library.** Use `npm run dev` for the visual check.
- **macOS keys in Playwright:** Home does not move the caret in a textarea (it scrolls); the scripts below set the selection instead.
- **The worktree is shared.** Start Task 1 only when `git status --short` on `feat/arkademy-tour` prints nothing but untracked plan files.

## Local Postgres and a dev server, for the visual check

Task 11 needs a migrated Postgres with the fixture published, and a dev server. Homebrew's Postgres 16 binaries are on the PATH. Use a directory **outside the repository** and free ports: check with `lsof -nP -iTCP:<port> -sTCP:LISTEN`, which prints nothing when free (the built run used 6847 and 5847).

```bash
export PGSCRATCH=/path/to/your/scratchpad/pg-arkademy-p4     # outside the repo
initdb -D "$PGSCRATCH/data" -U arkaik --auth=trust > "$PGSCRATCH.initdb.log"
pg_ctl -D "$PGSCRATCH/data" -l "$PGSCRATCH.log" -o "-p 6847 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
createdb -h 127.0.0.1 -p 6847 -U arkaik arkademy_p4
export DATABASE_URL=postgres://arkaik@127.0.0.1:6847/arkademy_p4
npm run --silent db:migrate | tail -1
npm run --silent arkademy -- publish tests/fixtures/arkademy/document.json > "$PGSCRATCH.publish.log" 2>&1; grep published "$PGSCRATCH.publish.log"
```

Expected: `server started`; `[db:migrate] done — applied 13 migration(s).`; `published v1 (10.1 KB, 1 warning)`. Do not pipe the publish into `head`: the script dies with `EPIPE` when its output is cut, after the row is written.

---

## Verified facts

Read at part 2's tip `4c7b137`.

- **The cover:**
  - `app/arkademy/business-model-canvas/page.tsx:73`, inside `CoverHead`'s `<header>`: `{tagline && <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{tagline}</p>}`, the only tagline line. This part's insertion point.
  - `:52`: `settledWithin(lookupArkademy(), ARKADEMY_HEAD_START_MS)`; `:58`: the `Suspense` fallback with `LibraryPlaceholder`. The pattern the yours page copies.
- **`lib/arkademy/paragraph.ts`:**
  - `:52` `cleanAnswer`;
  - `:63` `displayAnswers(question | undefined)`;
  - `:157` `composeParagraph`;
  - `:219` `paragraphText` (no gaps, no notes).
- **`lib/arkademy/head-start.ts`:** `:13` `ARKADEMY_HEAD_START_MS = 300`, `:20` `settledWithin`.
- **Paths and metadata:** `lib/arkademy/tools.ts:13` `BMC_YOURS_PATH`; `lib/arkademy/metadata.ts:103` `bmcYoursMetadata(tool | null)` (always `noindex`).
- **The lookup:** `lib/services/arkademy.ts:34`, the `ready` lookup carries `version` (the library version the inspirations and exports record).
- **Part 2's components:**
  - `ParagraphView.tsx:57`: sentences `data-kind="sentence"`, gaps `data-kind="gap"`, both `data-question`; gaps are buttons with `onSelectQuestion`; no width.
  - `CanvasGrid.tsx:73`: `current`, `onSelectQuestion`, blocks `data-block` / `data-current`.
  - `CanvasLink.tsx:19`: one wrapper, `className="contents"` keeps a parent's layout.
  - `LibraryPlaceholder.tsx:11`; `CopyButton.tsx:25` `{ text, label, what }`.
- **`ArkademyChrome.tsx`** exports `ARKADEMY_COLUMN`, `ARKADEMY_TITLE` and `ARKADEMY_SECTION_TITLE`, and imports `lib/fonts.ts` (`next/font/google`).
- **`tests/app/load-arkademy-tsx.js:60`** `requireTsx(relativePath)`: React's automatic JSX runtime, `@/` resolved to the repo root, no alias table.
- **Storage hooks:** `lib/hooks/useOverviewLayout.ts:41`/`:65` and `lib/hooks/useStonePreferences.ts:52`/`:78`: module stores read through `useSyncExternalStore` with a server snapshot, the repo's answer to "no setState in an effect" when reading `localStorage`.
- **`app/projects/page.tsx:348`:** `window.history.replaceState(null, "", …)` for a cosmetic URL change.
- **Downloads:**
  - `lib/utils/export.ts:153-169` `downloadJson(bundle)`: `URL.createObjectURL` (`:159`), a link appended, clicked, removed, `URL.revokeObjectURL` (`:166`).
  - `components/generate/PromptOutput.tsx:24-31` does the same inline for a `.txt`.
- **`components/graph/DeleteConfirmDialog.tsx:39-71`:** `<Dialog open>` with no `DialogTrigger`, Cancel `variant="outline"` then the action `variant="destructive"` (`:67`).
- **`node_modules/@radix-ui/react-dialog/dist/index.mjs:148`:** on close, focus goes to `context.triggerRef.current`, which is null without a `DialogTrigger`.
- **`tests/app/keyboard-shortcuts.test.js:199`:** the keydown-listener check.
- **Registered lucide icons** (`lib/wobble/wobble-registry.generated.ts`): `arrow-down` `:16`, `arrow-up` `:21`, `chevron-down` `:33`, `chevron-left` `:34`, `chevron-right` `:35`, `copy` `:61`, `download` `:66`, `info` `:102`, `lightbulb` `:111`, `plus` `:142`, `rotate-ccw` `:149`, `rotate-cw` `:150`, `x` `:193`.
- **CI wiring:** `package.json:42` `"test:arkademy-paragraph"`; `.github/workflows/ci.yml:224` `run: npm run test:arkademy-paragraph`, the last Arkademy step of the build job.
- **`docs/architecture.md`:** `:70` the cover's line in "App Router Structure", `:71` the `  api/` line after it, `:192` the `  publik/` line that closes the `arkademy/` block of "Component Map".
- **The fixture** `tests/fixtures/arkademy/document.json`:
  - examples `crumb-and-co`, `tidewise`, `inkwell`;
  - `word-of-mouth` is used by all three, `app-stores` and `subscriptions` by two, and `pop-up-stalls` by none;
  - Crumb & Co has five `ka` uses;
  - `kp` has an empty hint;
  - only `cost` has a `sentencePlural`;
  - `rev`, `kp` and `cost` have templates without `{S}`.

## Names this part exports

In `lib/arkademy/` (one namespace with parts 1–3):
- `inspirations.ts`: `Inspiration`, `INSPIRATIONS_SHOWN`, `inspirationCatalog`, `answerFromLabel`, `inspirationAnswer`, `availableInspirations`, `companiesLine`.
- `canvas.ts`: `NAME_MAX_LENGTH`, `DraftAnswer`, `CanvasDraft`, `DraftAction`, `QuestionStatus`, `emptyDraft`, `oneLine`, `cutText`, `fitAnswer`, `answersOf`, `hasAnswerText`, `nextAnswerId`, `draftReducer`, `draftIsEmpty`, `draftState`, `questionStatus`, `firstUnfinishedStep`, `yoursHref`.
- `canvas-storage.ts`: `DRAFT_STORAGE_KEY`, `DRAFT_UNREADABLE_KEY`, `DRAFT_FORMAT`, `DRAFT_UPGRADES`, `UNREADABLE_DRAFT_FILENAME`, `StoredDraftRead`, `repairDraft`, `readStoredDraft`, `serializeDraft`.
- `canvas-export.ts`: `CanvasTool`, `CanvasExport`, `canvasParagraphText`, `canvasMarkdown`, `canvasJson`, `canvasJsonText`, `canvasFilename`.

Outside it:
- `lib/hooks/useCanvasDraft.ts`: `DRAFT_WRITE_DELAY_MS`, `DraftPersistence`, `CanvasDraftView`, `dispatchDraft`, `dismissUnreadableDraft`, `useCanvasDraft`, `useHasCanvasDraft`, `useStoredDraftText`.
- `lib/utils/download.ts`: `downloadTextFile`.

## Files shared with part 3 (as built)

| File | Part 3's code | This part's edit |
|---|---|---|
| `app/arkademy/business-model-canvas/page.tsx` | `CoverHead`'s `actions` row holds "Play a tour" | `<StartYourOwnButton />` first, in a fragment (Task 8) |
| `app/arkademy/business-model-canvas/tour/[example]/page.tsx` | `<CanvasWalk … />` with no `endActions` | `endActions={<StartYourOwnButton />}` (Task 8) |
| `tests/app/arkademy-tour.test.js` | "cover: no link to your own canvas yet (part 4)" | inverted, plus the end-card check (Task 8) |
| `package.json`, `.github/workflows/ci.yml` | `test:arkademy-tour` and its step | this part's line and step follow them (Task 2) |
| `docs/architecture.md` | the tour's route and components | inserted before `  api/` and before `  publik/` (Task 9) |
| `components/arkademy/QuestionCard.tsx` | exports `ARKADEMY_KICKER` | imported, not edited |
| `lib/arkademy/tour.ts` | exports `parseStepParam` | imported, not edited |

## File map

- Create `lib/arkademy/inspirations.ts`, `lib/arkademy/canvas.ts`, `lib/arkademy/canvas-storage.ts`, `lib/arkademy/canvas-export.ts`.
- Create `lib/hooks/useCanvasDraft.ts`, `lib/utils/download.ts`.
- Create `components/arkademy/QuestionSteps.tsx`, `QuestionEditor.tsx`, `InspirationList.tsx`, `StartOverDialog.tsx`, `CanvasToolbar.tsx`, `YourCanvas.tsx`, `StrandedDraft.tsx`, `StartYourOwnButton.tsx`.
- Create `app/arkademy/business-model-canvas/yours/page.tsx`.
- Create `tests/app/arkademy-canvas.test.js`.
- Modify `app/arkademy/business-model-canvas/page.tsx`, `package.json`, `.github/workflows/ci.yml`, `docs/architecture.md`; and, only if it exists, `components/arkademy/TourEndCard.tsx`.
- Must not touch:
  - `lib/arkademy/schema.ts`, `validate.ts`, `index-document.ts`, `paragraph.ts`;
  - the fixture;
  - any part 2 component (`ParagraphView`, `CanvasGrid`, `CanvasLink`, `CopyButton`, …);
  - `lib/utils/export.ts`;
  - `tests/app/load-arkademy.js`, `tests/app/load-arkademy-tsx.js`;
  - `packages/**`, generated files, `db/**`, `scripts/**`.

---

### Task 1: The branch

**Files:** none.

- [ ] **Step 1: Start from part 3's clean tip**

```bash
cd /Users/alexis/code/arkaik-arkademy
git checkout feat/arkademy-tour
git status --short
git log --oneline -1
```

Expected: `git status --short` prints nothing, or only untracked plan files under `docs/superpowers/plans/`. If it prints anything else, stop: another agent is working on part 3. The log line is part 3's tip.

- [ ] **Step 2: Stack the branch**

```bash
gh stack view
gh stack add feat/arkademy-your-canvas
git branch --show-current
rm -rf .next
```

Expected: `gh stack view` lists `feat/arkademy-content`, `feat/arkademy-cover` and `feat/arkademy-tour`; then `feat/arkademy-your-canvas`. Never run `gh stack init`: the stack exists.

---

### Task 2: Inspirations

**Files:**
- Create: `lib/arkademy/inspirations.ts`
- Create: `tests/app/arkademy-canvas.test.js`
- Modify: `package.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Write the test first**

Create `tests/app/arkademy-canvas.test.js`. It is the suite's header, its inspirations section, and its footer; Tasks 3, 4, 5 and 7 each insert one more section immediately above the line `cleanup();`.

```js
#!/usr/bin/env node

/**
 * Your own canvas's pure side (lib/arkademy/): the inspirations, the draft's
 * reducer, browser storage's parse and serialise, and the three exports.
 * DB-free, so it runs in CI's `build` job.
 *
 * Cases that the fictional fixture (tests/fixtures/arkademy/document.json)
 * does not hold are built in memory; the fixture itself is never edited.
 */

const fs = require("fs");
const path = require("path");
const { loadArkademy, cleanup } = require("./load-arkademy");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");

const A = loadArkademy();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}
function same(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

const document = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const validation = A.validateArkademyDocument(document, { now: new Date("2026-11-12T00:00:00Z") });
check("the fixture validates", validation.ok, JSON.stringify(validation.errors));
const tool = document.tools[0];
const index = A.indexArkademy(validation.document);

// --- inspirations -------------------------------------------------------------------
{
  const { inspirationCatalog, availableInspirations, answerFromLabel, inspirationAnswer, companiesLine, INSPIRATIONS_SHOWN } = A;
  const catalog = inspirationCatalog(index);
  same("catalog: one list per question, canonical order", Object.keys(catalog), A.BMC_QUESTION_KEYS);
  same(
    "catalog: channels, most shared first, the unused stall absent",
    catalog.ch.map((item) => item.entity),
    ["word-of-mouth", "app-stores"],
  );
  same(
    "catalog: companies in example order, with their names",
    catalog.ch[0].companies,
    [
      { id: "crumb-and-co", name: "Crumb & Co" },
      { id: "tidewise", name: "Tidewise" },
      { id: "inkwell", name: "Inkwell" },
    ],
  );
  same("catalog: an entity's neutral label, never a company's wording", catalog.ch[1].label, "app stores");
  same(
    "catalog: a tie on companies sorts by label",
    catalog.ka.map((item) => item.label),
    [
      "baking overnight",
      "packing orders",
      "planning delivery rounds",
      "shipping small improvements",
      "sourcing flour",
      "taking orders",
      "updating the tables every season",
    ],
  );
  same("catalog: shared revenue first", catalog.rev.map((item) => item.entity), ["subscriptions"]);
  check("catalog: only entities of the question's kind", catalog.seg.every((item) => item.entity !== "word-of-mouth"));
  check(
    "catalog: an inspiration carries no note",
    Object.values(catalog).every((list) => list.every((item) => Object.keys(item).join() === "entity,label,answer,companies")),
  );

  // Ties on label too sort by id; labels compare without case or accents.
  const tie = JSON.parse(JSON.stringify(validation.document));
  tie.entities.push({ id: "b-zz", kind: "partner", label: "Local millers" }, { id: "a-zz", kind: "partner", label: "local millers" });
  tie.uses.push(
    { tool: "business-model-canvas", company: "tidewise", question: "kp", entity: "b-zz", text: "the mill", order: 1 },
    { tool: "business-model-canvas", company: "inkwell", question: "kp", entity: "a-zz", text: "a mill", order: 1 },
  );
  same(
    "catalog: same count and same label (any case) fall back to the id",
    inspirationCatalog(A.indexArkademy(tie)).kp.map((item) => item.entity),
    ["cloud-host", "harbour-offices", "a-zz", "b-zz", "local-millers"],
  );

  same("show six before Show all", INSPIRATIONS_SHOWN, 6);

  const channels = catalog.ch;
  same(
    "available: drops an entity already added",
    availableInspirations(channels, [{ text: "telling friends", inspiration: { entity: "word-of-mouth" } }]).map((i) => i.entity),
    ["app-stores"],
  );
  same(
    "available: drops a label typed as an answer, any case",
    availableInspirations(channels, [{ text: "  App Stores " }]).map((i) => i.entity),
    ["word-of-mouth"],
  );
  same("available: nothing to drop", availableInspirations(channels, []).length, 2);

  same("answerFromLabel: sentence case lowered", answerFromLabel("A product map that stays true"), "a product map that stays true");
  same("answerFromLabel: a name with an inner capital kept", answerFromLabel("GitHub sponsors"), "GitHub sponsors");
  same("answerFromLabel: an acronym kept", answerFromLabel("AWS credits"), "AWS credits");
  same("answerFromLabel: already lower", answerFromLabel("word of mouth"), "word of mouth");
  same("answerFromLabel: one capital letter alone is lowered", answerFromLabel("X"), "x");
  same("answerFromLabel: accents", answerFromLabel("École partners"), "école partners");
  same("answerFromLabel: trimmed", answerFromLabel("  Hosting "), "hosting");

  // A name that is capitalised by its first letter alone (Broadcom, Apple) is
  // told apart by the companies' own wordings of the entity, which sit
  // mid-sentence: a capital there is a name's.
  same(
    "inspirationAnswer: a name the wordings capitalise keeps its capital",
    inspirationAnswer("Broadcom and Google for TPU capacity", ["Broadcom and Google for TPU capacity"]),
    "Broadcom and Google for TPU capacity",
  );
  same(
    "inspirationAnswer: found anywhere in a wording, punctuation aside",
    inspirationAnswer("Apple App Store and Google Play", ["the Apple and Google app stores"]),
    "Apple App Store and Google Play",
  );
  same(
    "inspirationAnswer: a common first word is lowered",
    inspirationAnswer("Third-party AI model providers", ["third-party AI model providers", "AI providers"]),
    "third-party AI model providers",
  );
  same("inspirationAnswer: no wording, the label rule alone", inspirationAnswer("Word of mouth", []), "word of mouth");
  same("inspirationAnswer: an inner capital needs no wording", inspirationAnswer("GitHub", []), "GitHub");
  check(
    "catalog: each answer is its label's answer (the fixture holds no name)",
    Object.values(catalog).every((list) => list.every((item) => item.answer === answerFromLabel(item.label))),
  );
  const named = JSON.parse(JSON.stringify(validation.document));
  named.entities.push({ id: "brine-co", kind: "partner", label: "Brine & Sons for salt" });
  named.uses.push({ tool: "business-model-canvas", company: "tidewise", question: "kp", entity: "brine-co", text: "Brine & Sons, who sell the salt", order: 1 });
  same(
    "catalog: a name keeps its capital in the answer",
    inspirationCatalog(A.indexArkademy(named)).kp.find((item) => item.entity === "brine-co").answer,
    "Brine & Sons for salt",
  );

  same("companiesLine: one", companiesLine([{ name: "Crumb & Co" }]), "Crumb & Co");
  same("companiesLine: two", companiesLine([{ name: "A" }, { name: "B" }]), "A and B");
  same("companiesLine: three", companiesLine([{ name: "A" }, { name: "B" }, { name: "C" }]), "A, B and C");
  same(
    "companiesLine: four or more",
    companiesLine([{ name: "Notion" }, { name: "Figma" }, { name: "C" }, { name: "D" }]),
    "Notion, Figma and 2 more",
  );
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-canvas test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-canvas tests passed.");
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/app/arkademy-canvas.test.js
```

Expected: `PASS: the fixture validates`, then `TypeError: inspirationCatalog is not a function` and a non-zero exit.

- [ ] **Step 3: Write `lib/arkademy/inspirations.ts`**

```ts
import type { ArkademyIndex } from "./index-document";
import { BMC_QUESTION_KEYS, BMC_QUESTION_KIND } from "./schema";
import type { BmcQuestionKey } from "./schema";

/**
 * Inspirations for your own canvas (spec § "Inspirations"): for each
 * question, the library's entities of that question's kind that at least one
 * example uses, most shared first, each naming the examples that use it. The
 * catalog is built on the server and passed as props; `availableInspirations`
 * runs on the client against the visitor's answers. Notes never travel here:
 * an inspiration is the entity's neutral label and the companies' names only.
 */

export interface Inspiration {
  entity: string;
  label: string;
  /** The label as an answer: `inspirationAnswer` of the label and the companies' own wordings. */
  answer: string;
  companies: { id: string; name: string }[]; // in tool.examples order
}

/** How many inspirations a question shows before "Show all N". */
export const INSPIRATIONS_SHOWN = 6;

/** Per question: the entities of its kind that some example uses, most shared first, then label, then id. */
export function inspirationCatalog(index: ArkademyIndex): Record<BmcQuestionKey, Inspiration[]> {
  const catalog = {} as Record<BmcQuestionKey, Inspiration[]>;
  const wordings = new Map<string, string[]>();
  for (const use of index.document.uses) {
    const list = wordings.get(use.entity);
    if (list) list.push(use.text);
    else wordings.set(use.entity, [use.text]);
  }
  for (const key of BMC_QUESTION_KEYS) {
    const kind = BMC_QUESTION_KIND[key];
    const list: Inspiration[] = [];
    for (const entity of index.document.entities) {
      if (entity.kind !== kind) continue;
      const companies = index.usersOf(entity.id).flatMap((id) => {
        const company = index.company(id);
        return company ? [{ id: company.id, name: company.name }] : [];
      });
      if (companies.length === 0) continue;
      const answer = inspirationAnswer(entity.label, wordings.get(entity.id) ?? []);
      list.push({ entity: entity.id, label: entity.label, answer, companies });
    }
    list.sort(
      (a, b) =>
        b.companies.length - a.companies.length ||
        a.label.localeCompare(b.label, "en", { sensitivity: "base" }) ||
        (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0),
    );
    catalog[key] = list;
  }
  return catalog;
}

/**
 * A label is a sentence-case chip; an answer sits mid-sentence. The first
 * letter is lower-cased unless the first word has a capital after its first
 * letter, which covers names written that way ("GitHub") and acronyms of two
 * letters or more ("AWS"). "A product map" becomes "a product map".
 */
export function answerFromLabel(label: string): string {
  const text = label.trim();
  const firstWord = text.split(/\s/, 1)[0] ?? "";
  const rest = firstWord.slice(1);
  if (rest !== rest.toLocaleLowerCase("en")) return text;
  return text.charAt(0).toLocaleLowerCase("en") + text.slice(1);
}

/** A word stripped of the punctuation around it, for comparing words across texts. */
function bareWord(word: string): string {
  return word.replace(/^[^0-9A-Za-z\u00C0-\uFFFF]+|[^0-9A-Za-z\u00C0-\uFFFF]+$/g, "");
}

/**
 * The answer an inspiration becomes. `answerFromLabel` lowers a first letter
 * it cannot tell from a name's ("Broadcom and Google", "Apple App Store"), so
 * the companies' own wordings of the entity decide: they sit mid-sentence,
 * where a capital is a name's. When one of them holds the label's first word
 * with the same capital, the label is kept as it is.
 */
export function inspirationAnswer(label: string, wordings: readonly string[]): string {
  const answer = answerFromLabel(label);
  const text = label.trim();
  if (answer === text) return answer;
  const first = bareWord(text.split(/\s/, 1)[0] ?? "");
  const named = first !== "" && wordings.some((wording) => wording.split(/\s+/).some((word) => bareWord(word) === first));
  return named ? text : answer;
}

/**
 * The inspirations a question still offers: drops the entities already added
 * to it and any whose label matches an answer's text, case-insensitively.
 */
export function availableInspirations(
  list: readonly Inspiration[],
  answers: readonly { text: string; inspiration?: { entity: string } }[],
): Inspiration[] {
  // A label typed as an answer (any case) is on the canvas already.
  const chosen = new Set(answers.flatMap((answer) => (answer.inspiration ? [answer.inspiration.entity] : [])));
  const texts = new Set(answers.map((answer) => answer.text.trim().toLocaleLowerCase("en")));
  return list.filter(
    (inspiration) =>
      !chosen.has(inspiration.entity) &&
      !texts.has(inspiration.label.trim().toLocaleLowerCase("en")) &&
      !texts.has(inspiration.answer.trim().toLocaleLowerCase("en")),
  );
}

/** "Crumb & Co", "Tidewise and Inkwell", "A, B and C", then "A, B and 2 more". */
export function companiesLine(companies: readonly { name: string }[]): string {
  const names = companies.map((company) => company.name);
  if (names.length <= 1) return names.join("");
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
```

- [ ] **Step 4: Run it again**

```bash
node tests/app/arkademy-canvas.test.js | grep -c '^PASS'
node tests/app/arkademy-canvas.test.js | tail -1
```

Expected: `32`, then `All arkademy-canvas tests passed.` (with the code as shown, its final state; the commit as first made counted 25, before `adf4f62e` added the inspiration-answer checks).

- [ ] **Step 5: The npm script and the CI step**

In `package.json`, insert one line immediately after part 3's `    "test:arkademy-tour": "node tests/app/arkademy-tour.test.js",`:

```json
    "test:arkademy-canvas": "node tests/app/arkademy-canvas.test.js",
```

In `.github/workflows/ci.yml`, immediately after part 3's line `        run: npm run test:arkademy-tour`, insert:

```yaml

      # Your own canvas's pure side (lib/arkademy/): the inspirations, the
      # draft's reducer, browser storage's parse and serialise, and the three
      # exports (paragraph, Markdown, JSON).
      - name: Arkademy canvas tests (inspirations, draft reducer, storage, exports)
        run: npm run test:arkademy-canvas
```

```bash
npm run test:arkademy-canvas | tail -1
actionlint
```

Expected: `All arkademy-canvas tests passed.`; `actionlint` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add lib/arkademy/inspirations.ts tests/app/arkademy-canvas.test.js package.json .github/workflows/ci.yml
git commit -m "feat(arkademy): inspirations for your own canvas, from the library's shared entities"
```

End the message with the attribution lines your session's instructions give.

---

### Task 3: The draft and its reducer

**Files:**
- Create: `lib/arkademy/canvas.ts`
- Modify: `tests/app/arkademy-canvas.test.js`

- [ ] **Step 1: Write the test first**

Insert this section into `tests/app/arkademy-canvas.test.js` immediately above the line `cleanup();`:

```js
// --- the draft and its reducer -------------------------------------------------------
{
  const { draftReducer, emptyDraft, draftState, draftIsEmpty, firstUnfinishedStep, questionStatus } = A;
  const { yoursHref, nextAnswerId, NAME_MAX_LENGTH } = A;
  const run = (actions, start = emptyDraft()) => actions.reduce((draft, action) => draftReducer(draft, action), start);

  same("empty draft", emptyDraft(), { name: "", answers: [], open: [], updatedAt: "" });
  check("empty draft is empty", draftIsEmpty(emptyDraft()));

  const one = run([{ type: "add", question: "seg", text: "  bakers who open at dawn.  " }]);
  same("add: trimmed, sequential id", one.answers, [{ id: "a1", question: "seg", text: "bakers who open at dawn." }]);
  const blank = run([{ type: "add", question: "seg", text: "   " }]);
  same("add: blank refused", blank.answers.length, 0);
  same("add: one line", run([{ type: "add", question: "vp", text: "fresh\nbread\r\nat\tdawn" }]).answers[0].text, "fresh bread at dawn");
  same("add: cut to 140", run([{ type: "add", question: "vp", text: "x".repeat(200) }]).answers[0].text.length, 140);
  const emoji = "😀".repeat(80); // 160 UTF-16 units
  check("add: a cut never splits a surrogate pair", !/[\uD800-\uDBFF]$/.test(run([{ type: "add", question: "vp", text: emoji }]).answers[0].text));
  same(
    "add: a duplicate (any case) refused",
    run([
      { type: "add", question: "seg", text: "Bakers" },
      { type: "add", question: "seg", text: " bakers " },
    ]).answers.length,
    1,
  );
  same(
    "add: the same words in another question are fine",
    run([
      { type: "add", question: "seg", text: "bakers" },
      { type: "add", question: "kr", text: "bakers" },
    ]).answers.length,
    2,
  );

  const five = run(["a", "b", "c", "d", "e"].map((text) => ({ type: "add", question: "ka", text })));
  same("five answers", five.answers.length, 5);
  check("a sixth is refused, same object", draftReducer(five, { type: "add", question: "ka", text: "f" }) === five);
  check(
    "a sixth inspiration is refused too",
    draftReducer(five, { type: "addInspiration", question: "ka", entity: "order-taking", text: "taking orders", documentVersion: 1 }) === five,
  );

  const opened = run([{ type: "setOpen", question: "rev", open: true }]);
  same("setOpen: on", opened.open, ["rev"]);
  same("setOpen: canonical order", run([{ type: "setOpen", question: "cost", open: true }], opened).open, ["rev", "cost"]);
  same("add clears open", run([{ type: "add", question: "rev", text: "tips" }], opened).open, []);
  const answeredOne = run([{ type: "add", question: "rev", text: "tips" }]);
  check("setOpen refused with answers, same object", draftReducer(answeredOne, { type: "setOpen", question: "rev", open: true }) === answeredOne);
  same("setOpen: off", run([{ type: "setOpen", question: "rev", open: false }], opened).open, []);
  check("setOpen: unchanged is the same object", draftReducer(opened, { type: "setOpen", question: "rev", open: true }) === opened);

  const inspired = run([
    { type: "setOpen", question: "ch", open: true },
    { type: "addInspiration", question: "ch", entity: "word-of-mouth", text: " word of mouth ", documentVersion: 7 },
  ]);
  same("addInspiration: the inspiration's answer, trimmed, entity and version kept", inspired.answers, [
    { id: "a1", question: "ch", text: "word of mouth", inspiration: { entity: "word-of-mouth", documentVersion: 7 } },
  ]);
  same("addInspiration clears open", inspired.open, []);
  check(
    "addInspiration: the same entity twice is refused",
    draftReducer(inspired, { type: "addInspiration", question: "ch", entity: "word-of-mouth", text: "word of mouth", documentVersion: 7 }) === inspired,
  );
  const reworded = run([{ type: "edit", id: "a1", text: "neighbours telling neighbours" }], inspired);
  same("rewording keeps the inspiration", reworded.answers[0], {
    id: "a1",
    question: "ch",
    text: "neighbours telling neighbours",
    inspiration: { entity: "word-of-mouth", documentVersion: 7 },
  });

  const edited = run([{ type: "edit", id: "a1", text: "" }], one);
  same("edit to blank keeps the answer while its field has focus", edited.answers.length, 1);
  same("a blank answer is not in the state", draftState(edited)[0].answers, []);
  same("…and the field removes it", run([{ type: "remove", id: "a1" }], edited).answers, []);
  same("edit: kept as typed, spaces included", run([{ type: "edit", id: "a1", text: "bakers " }], one).answers[0].text, "bakers ");
  check("edit: unknown id is the same object", draftReducer(one, { type: "edit", id: "a9", text: "x" }) === one);
  check("remove: unknown id is the same object", draftReducer(one, { type: "remove", id: "a9" }) === one);

  const mixed = run([
    { type: "add", question: "ka", text: "first" },
    { type: "add", question: "seg", text: "someone" },
    { type: "add", question: "ka", text: "second" },
    { type: "add", question: "ka", text: "third" },
  ]);
  same(
    "move: down, past another question's answer",
    run([{ type: "move", id: "a1", offset: 1 }], mixed).answers.filter((a) => a.question === "ka").map((a) => a.text),
    ["second", "first", "third"],
  );
  same(
    "move: up",
    run([{ type: "move", id: "a4", offset: -1 }], mixed).answers.filter((a) => a.question === "ka").map((a) => a.text),
    ["first", "third", "second"],
  );
  check("move: the first up is the same object", draftReducer(mixed, { type: "move", id: "a1", offset: -1 }) === mixed);
  check("move: the last down is the same object", draftReducer(mixed, { type: "move", id: "a4", offset: 1 }) === mixed);
  same("ids keep counting after a removal", nextAnswerId(run([{ type: "remove", id: "a4" }], mixed).answers), "a4");
  same("ids follow the highest", nextAnswerId([{ id: "a2" }, { id: "x" }, { id: "a10" }]), "a11");

  same("rename: kept as typed", run([{ type: "rename", name: "Acme " }]).name, "Acme ");
  same("rename: cut to 60", run([{ type: "rename", name: "n".repeat(80) }]).name.length, NAME_MAX_LENGTH);
  same("rename: one line", run([{ type: "rename", name: "Acme\nBakery" }]).name, "Acme Bakery");

  same("reset", run([{ type: "reset" }], inspired), emptyDraft());
  const empty = emptyDraft();
  check("reset of an empty draft is the same object", draftReducer(empty, { type: "reset" }) === empty);
  const other = { name: "Other tab", answers: [], open: ["kp"], updatedAt: "2026-11-12T10:00:00.000Z" };
  check("replace: takes the other tab's draft", draftReducer(inspired, { type: "replace", draft: other }) === other);

  const full = run([
    { type: "rename", name: "Tidy" },
    { type: "add", question: "seg", text: "  people who fish  " },
    { type: "addInspiration", question: "ch", entity: "app-stores", text: "app stores", documentVersion: 2 },
    { type: "setOpen", question: "rev", open: true },
  ]);
  const state = draftState(full);
  same("state: nine, canonical", state.map((q) => q.key), A.BMC_QUESTION_KEYS);
  same("state: trimmed text", state[0].answers, [{ text: "people who fish" }]);
  same("state: entity from the inspiration", state[2].answers, [{ text: "app stores", entity: "app-stores" }]);
  same("state: open", state[4], { key: "rev", answers: [], open: true });
  same("status: answered, open, empty", [state[0], state[4], state[5]].map(questionStatus), ["answered", "open", "empty"]);
  const dots = run([{ type: "add", question: "seg", text: "..." }]);
  same("status: an answer that cleans to nothing is not an answer", questionStatus(draftState(dots)[0]), "empty");
  same("first unfinished: such a question is still unfinished", firstUnfinishedStep(dots), 1);
  check("a name alone is not empty", !draftIsEmpty(run([{ type: "rename", name: "Tidy" }])));
  check("an open question alone is not empty", !draftIsEmpty(opened));

  same("first unfinished: empty draft", firstUnfinishedStep(emptyDraft()), 1);
  same("first unfinished: after seg", firstUnfinishedStep(one), 2);
  same(
    "first unfinished: open counts as finished",
    firstUnfinishedStep(run([{ type: "setOpen", question: "vp", open: true }], one)),
    3,
  );
  const allDone = run(A.BMC_QUESTION_KEYS.map((question) => ({ type: "add", question, text: `answer ${question}` })));
  same("first unfinished: all done is step 1", firstUnfinishedStep(allDone), 1);

  same("yoursHref", [yoursHref(), yoursHref(4)], [
    "/arkademy/business-model-canvas/yours",
    "/arkademy/business-model-canvas/yours?step=4",
  ]);
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/app/arkademy-canvas.test.js | tail -3
```

Expected: the stack trace of `TypeError: emptyDraft is not a function` and a non-zero exit.

- [ ] **Step 3: Write `lib/arkademy/canvas.ts`**

```ts
import { displayAnswers } from "./paragraph";
import type { CanvasAnswer, CanvasQuestionState } from "./paragraph";
import { ANSWER_MAX_LENGTH, BMC_QUESTION_KEYS, MAX_ANSWERS_PER_QUESTION } from "./schema";
import type { BmcQuestionKey } from "./schema";
import { BMC_YOURS_PATH } from "./tools";

/**
 * Your own canvas (spec § "Your own canvas"): the visitor's draft and the pure
 * reducer every edit goes through. The draft lives in this browser only
 * (canvas-storage.ts parses and serialises it; lib/hooks/useCanvasDraft.ts is
 * its one reader and writer). Imports only its siblings, like every module in
 * lib/arkademy/.
 *
 * The reducer is pure: answer ids are sequential (`a1`, `a2`, …) rather than
 * random, and `updatedAt` is stamped by the store that writes, not here.
 */

/** The visitor's product name, the paragraph's subject. Empty reads as "This product". */
export const NAME_MAX_LENGTH = 60;

export interface DraftAnswer {
  /** Unique within the draft, for React keys and edits: `a1`, `a2`, … */
  id: string;
  question: BmcQuestionKey;
  /** As typed, at most ANSWER_MAX_LENGTH, one line. Trimmed when composed, stored and exported. */
  text: string;
  /** The library entity this answer was added from. Kept when the visitor rewords it. */
  inspiration?: { entity: string; documentVersion: number };
}

export interface CanvasDraft {
  name: string; // ≤ NAME_MAX_LENGTH
  answers: DraftAnswer[]; // per question, in display order
  open: BmcQuestionKey[]; // canonical order, never a question with answers
  updatedAt: string; // ISO 8601, or "" for a draft never written
}

export type DraftAction =
  | { type: "rename"; name: string }
  | { type: "add"; question: BmcQuestionKey; text: string }
  | { type: "addInspiration"; question: BmcQuestionKey; entity: string; text: string; documentVersion: number } // text: the inspiration's `answer`
  | { type: "edit"; id: string; text: string } // a blank text is kept while its field has focus; the field removes it on blur
  | { type: "remove"; id: string }
  | { type: "move"; id: string; offset: -1 | 1 } // within its question
  | { type: "setOpen"; question: BmcQuestionKey; open: boolean }
  | { type: "reset" }
  | { type: "replace"; draft: CanvasDraft }; // another tab wrote

export type QuestionStatus = "answered" | "open" | "empty";

export function emptyDraft(): CanvasDraft {
  return { name: "", answers: [], open: [], updatedAt: "" };
}

/** Line breaks and tabs become single spaces: every draft text is one line. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n\t]+\s*/g, " ");
}

/** The first `max` UTF-16 units, never splitting a surrogate pair. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** A typed or pasted answer as the draft keeps it: one line, at most ANSWER_MAX_LENGTH. */
export function fitAnswer(text: string): string {
  return cutText(oneLine(text), ANSWER_MAX_LENGTH);
}

/** The answers of one question, in display order (blank ones included). */
export function answersOf(draft: CanvasDraft, question: BmcQuestionKey): DraftAnswer[] {
  return draft.answers.filter((answer) => answer.question === question);
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("en") === b.trim().toLocaleLowerCase("en");
}

/** Whether a question already holds this text, compared trimmed and case-insensitively. */
export function hasAnswerText(draft: CanvasDraft, question: BmcQuestionKey, text: string): boolean {
  return answersOf(draft, question).some((answer) => sameText(answer.text, text));
}

/** The id the next answer gets: one more than the highest `aN` in use. */
export function nextAnswerId(answers: readonly { id: string }[]): string {
  let highest = 0;
  for (const answer of answers) {
    const match = /^a(\d{1,9})$/.exec(answer.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `a${highest + 1}`;
}

function inCanonicalOrder(keys: Iterable<BmcQuestionKey>): BmcQuestionKey[] {
  const set = new Set(keys);
  return BMC_QUESTION_KEYS.filter((key) => set.has(key));
}

function withAnswer(draft: CanvasDraft, answer: DraftAnswer): CanvasDraft {
  return {
    ...draft,
    answers: [...draft.answers, answer],
    open: draft.open.filter((key) => key !== answer.question),
  };
}

/** Room for one more non-duplicate answer in this question. */
function canAdd(draft: CanvasDraft, question: BmcQuestionKey, text: string): boolean {
  return (
    text !== "" &&
    answersOf(draft, question).length < MAX_ANSWERS_PER_QUESTION &&
    !hasAnswerText(draft, question, text)
  );
}

/**
 * Every edit of your own canvas. Returns the same object when the action
 * changes nothing (an add at five answers, a duplicate, an unknown id, setOpen
 * on a question with answers), so the store knows there is nothing to save.
 */
export function draftReducer(draft: CanvasDraft, action: DraftAction): CanvasDraft {
  switch (action.type) {
    case "rename": {
      const name = cutText(oneLine(action.name), NAME_MAX_LENGTH);
      return name === draft.name ? draft : { ...draft, name };
    }
    case "add": {
      const text = fitAnswer(action.text.trim()).trim();
      if (!canAdd(draft, action.question, text)) return draft;
      return withAnswer(draft, { id: nextAnswerId(draft.answers), question: action.question, text });
    }
    case "addInspiration": {
      const chosen = answersOf(draft, action.question).some((answer) => answer.inspiration?.entity === action.entity);
      const text = fitAnswer(oneLine(action.text).trim()).trim();
      if (chosen || !canAdd(draft, action.question, text)) return draft;
      return withAnswer(draft, {
        id: nextAnswerId(draft.answers),
        question: action.question,
        text,
        inspiration: { entity: action.entity, documentVersion: action.documentVersion },
      });
    }
    case "edit": {
      const text = fitAnswer(action.text);
      const target = draft.answers.find((answer) => answer.id === action.id);
      if (!target || target.text === text) return draft;
      return { ...draft, answers: draft.answers.map((answer) => (answer.id === action.id ? { ...answer, text } : answer)) };
    }
    case "remove": {
      const answers = draft.answers.filter((answer) => answer.id !== action.id);
      return answers.length === draft.answers.length ? draft : { ...draft, answers };
    }
    case "move": {
      const from = draft.answers.findIndex((answer) => answer.id === action.id);
      if (from < 0) return draft;
      const question = draft.answers[from].question;
      let to = from + action.offset;
      while (to >= 0 && to < draft.answers.length && draft.answers[to].question !== question) to += action.offset;
      if (to < 0 || to >= draft.answers.length) return draft;
      const answers = draft.answers.slice();
      [answers[from], answers[to]] = [answers[to], answers[from]];
      return { ...draft, answers };
    }
    case "setOpen": {
      const isOpen = draft.open.includes(action.question);
      if (action.open === isOpen) return draft;
      if (action.open && answersOf(draft, action.question).length > 0) return draft;
      const open = action.open
        ? inCanonicalOrder([...draft.open, action.question])
        : draft.open.filter((key) => key !== action.question);
      return { ...draft, open };
    }
    case "reset":
      return draftIsEmpty(draft) && draft.answers.length === 0 ? draft : emptyDraft();
    case "replace":
      return action.draft;
  }
}

/** Nothing worth keeping: no name, no answer with words, nothing left open. */
export function draftIsEmpty(draft: CanvasDraft): boolean {
  return (
    draft.name.trim() === "" && draft.open.length === 0 && draft.answers.every((answer) => answer.text.trim() === "")
  );
}

/**
 * The draft as the paragraph and the canvas grid read it: nine questions in
 * canonical order, answers trimmed, blank ones left out, each carrying its
 * entity id when it came from an inspiration. Never a note.
 */
export function draftState(draft: CanvasDraft): CanvasQuestionState[] {
  return BMC_QUESTION_KEYS.map((key) => {
    const answers: CanvasAnswer[] = [];
    for (const answer of answersOf(draft, key)) {
      const text = answer.text.trim();
      if (text === "") continue;
      answers.push(answer.inspiration ? { text, entity: answer.inspiration.entity } : { text });
    }
    return { key, answers, open: answers.length === 0 && draft.open.includes(key) };
  });
}

/** As every page shows it: answered when an answer survives `displayAnswers` ("..." does not). */
export function questionStatus(question: CanvasQuestionState): QuestionStatus {
  if (displayAnswers(question).length > 0) return "answered";
  return question.open ? "open" : "empty";
}

/** The step (1–9) a visit lands on without `?step=`: the first question neither answered nor open, else 1. */
export function firstUnfinishedStep(draft: CanvasDraft): number {
  const index = draftState(draft).findIndex((question) => questionStatus(question) === "empty");
  return index < 0 ? 1 : index + 1;
}

/** Your own canvas, optionally at a step. */
export function yoursHref(step?: number): string {
  return step === undefined ? BMC_YOURS_PATH : `${BMC_YOURS_PATH}?step=${step}`;
}
```

- [ ] **Step 4: Run it again**

```bash
node tests/app/arkademy-canvas.test.js | grep -c '^PASS'
node tests/app/arkademy-canvas.test.js | tail -1
```

Expected: `86`, then `All arkademy-canvas tests passed.` (with the code as shown, its final state; the commit as first made counted 79, before `adf4f62e` added the inspiration-answer checks).

- [ ] **Step 5: Commit**

```bash
git add lib/arkademy/canvas.ts tests/app/arkademy-canvas.test.js
git commit -m "feat(arkademy): your canvas's draft and its pure reducer"
```

---

### Task 4: The draft in browser storage

**Files:**
- Create: `lib/arkademy/canvas-storage.ts`
- Modify: `tests/app/arkademy-canvas.test.js`

- [ ] **Step 1: Write the test first**

Insert immediately above `cleanup();`:

```js
// --- browser storage -----------------------------------------------------------------
{
  const { readStoredDraft, serializeDraft, repairDraft, emptyDraft, draftReducer } = A;
  const { DRAFT_STORAGE_KEY, DRAFT_UNREADABLE_KEY, DRAFT_FORMAT, DRAFT_UPGRADES } = A;
  same("key", [DRAFT_STORAGE_KEY, DRAFT_UNREADABLE_KEY], ["arkaik:arkademy:bmc", "arkaik:arkademy:bmc:unreadable"]);
  same("format", DRAFT_FORMAT, 1);
  same("no upgrades at version 1", Object.keys(DRAFT_UPGRADES), []);

  same("null: none", readStoredDraft(null), { status: "none" });
  same("blank: none", readStoredDraft("  "), { status: "none" });

  const draft = {
    name: "Tidy",
    answers: [
      { id: "a1", question: "seg", text: "people who fish" },
      { id: "a2", question: "ch", text: "app stores", inspiration: { entity: "app-stores", documentVersion: 3 } },
    ],
    open: ["rev"],
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
  const stored = JSON.stringify({ v: 1, draft });
  same("a valid v1", readStoredDraft(stored), { status: "ok", draft });
  same("serialize: the envelope", serializeDraft(draft), stored);
  same("serialize round trip", readStoredDraft(serializeDraft(draft)), { status: "ok", draft });
  same(
    "serialize: answers trimmed, blank ones left out",
    JSON.parse(
      serializeDraft({
        ...draft,
        answers: [
          { id: "a1", question: "seg", text: " people " },
          { id: "a3", question: "vp", text: "   " },
        ],
      }),
    ).draft.answers,
    [{ id: "a1", question: "seg", text: "people" }],
  );

  same("broken JSON: unreadable", readStoredDraft("{not json"), { status: "unreadable", raw: "{not json" });
  same("an array: unreadable", readStoredDraft("[1,2]").status, "unreadable");
  same("no v: unreadable", readStoredDraft(JSON.stringify({ draft })).status, "unreadable");
  same("a wrong shape: unreadable", readStoredDraft(JSON.stringify({ v: 1, draft: { name: "x" } })).status, "unreadable");
  same("a draft that is a string: unreadable", readStoredDraft(JSON.stringify({ v: 1, draft: "x" })).status, "unreadable");
  same("v: 0 is unreadable", readStoredDraft(JSON.stringify({ v: 0, draft })).status, "unreadable");

  const newer = readStoredDraft(JSON.stringify({ v: 2, draft }));
  same("v: 2 is newer", [newer.status, newer.v], ["newer", 2]);
  same("newer: shown as best this build can", newer.draft, draft);
  same(
    "newer with a shape this build cannot read: an empty canvas",
    readStoredDraft(JSON.stringify({ v: 3, draft: [] })).draft,
    emptyDraft(),
  );

  const repaired = readStoredDraft(
    JSON.stringify({
      v: 1,
      draft: {
        name: "N".repeat(70),
        answers: [
          { id: "a1", question: "nope", text: "unknown key" },
          { id: "a2", question: "seg", text: 42 },
          { id: "a3", question: "seg", text: "y".repeat(200) },
          ...["1", "2", "3", "4", "5", "6"].map((n) => ({ id: `k${n}`, question: "ka", text: `task ${n}` })),
          { id: "a3", question: "vp", text: "repeated id" },
          { question: "vp", text: "no id" },
          { id: "a9", question: "kp", text: "   " },
          { id: "a10", question: "ch", text: "bad inspiration", inspiration: { entity: "Not A Slug", documentVersion: 1 } },
        ],
        open: ["rev", "rev", "seg", "nope", 4],
        updatedAt: 12,
      },
    }),
  );
  same("repair: still ok", repaired.status, "ok");
  const r = repaired.draft;
  same("repair: name cut to 60", r.name.length, 60);
  same("repair: unknown key and non-string text dropped", r.answers.some((a) => a.text === "unknown key"), false);
  same("repair: a 200-character text cut to 140", r.answers.find((a) => a.id === "a3").text.length, 140);
  same("repair: six answers keep the first five", r.answers.filter((a) => a.question === "ka").map((a) => a.text), [
    "task 1",
    "task 2",
    "task 3",
    "task 4",
    "task 5",
  ]);
  same("repair: a repeated or missing id gets a new one", r.answers.filter((a) => a.question === "vp").map((a) => a.id), ["a11", "a12"]);
  same("repair: blank text dropped", r.answers.some((a) => a.question === "kp"), false);
  same("repair: a bad inspiration dropped, the answer kept", r.answers.find((a) => a.id === "a10"), {
    id: "a10",
    question: "ch",
    text: "bad inspiration",
  });
  same("repair: open deduplicated, keys with answers and unknown keys dropped", r.open, ["rev"]);
  same("repair: updatedAt not a string", r.updatedAt, "");
  same("repairDraft: not an object", repairDraft(null), null);

  // A repaired draft keeps working with the reducer.
  same("repaired ids keep counting", draftReducer(r, { type: "add", question: "kr", text: "boats" }).answers.at(-1).id, "a13");
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/app/arkademy-canvas.test.js | grep -E '^FAIL|Error' | head -3
```

Expected:

```
FAIL: key — expected ["arkaik:arkademy:bmc","arkaik:arkademy:bmc:unreadable"], got [null,null]
FAIL: format — expected 1, got undefined
TypeError: Cannot convert undefined or null to object
```

- [ ] **Step 3: Write `lib/arkademy/canvas-storage.ts`**

```ts
import { cutText, emptyDraft, fitAnswer, NAME_MAX_LENGTH, nextAnswerId, oneLine } from "./canvas";
import type { CanvasDraft, DraftAnswer } from "./canvas";
import { BMC_QUESTION_KEYS, MAX_ANSWERS_PER_QUESTION } from "./schema";
import type { BmcQuestionKey } from "./schema";

/**
 * Your own canvas in browser storage (spec § "Browser storage"): one draft per
 * browser under one key, in a versioned envelope `{ "v": 1, "draft": … }`.
 * Pure parse and serialise; lib/hooks/useCanvasDraft.ts is the only code that
 * touches localStorage.
 */

export const DRAFT_STORAGE_KEY = "arkaik:arkademy:bmc";
/** Where an unreadable stored value is copied before anything overwrites it. */
export const DRAFT_UNREADABLE_KEY = "arkaik:arkademy:bmc:unreadable";
/** The envelope version this build writes. */
export const DRAFT_FORMAT = 1;
/** `DRAFT_UPGRADES[n]` turns a version-n draft into a version-(n+1) one. Empty at version 1. */
export const DRAFT_UPGRADES: Readonly<Record<number, (old: unknown) => unknown>> = {};
/** The file an unreadable stored value downloads as. */
export const UNREADABLE_DRAFT_FILENAME = "business-model-canvas-unreadable.txt";

export type StoredDraftRead =
  | { status: "none" }
  | { status: "ok"; draft: CanvasDraft }
  | { status: "unreadable"; raw: string }
  /** Written by a newer build: shown as best this build can, never saved over. */
  | { status: "newer"; v: number; raw: string; draft: CanvasDraft };

const QUESTION_KEYS: ReadonlySet<string> = new Set(BMC_QUESTION_KEYS);
const ANSWER_ID = /^[A-Za-z0-9_-]{1,40}$/;
const ENTITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repairInspiration(value: unknown): DraftAnswer["inspiration"] | undefined {
  if (!isRecord(value)) return undefined;
  const { entity, documentVersion } = value;
  if (typeof entity !== "string" || entity.length > 64 || !ENTITY_ID.test(entity)) return undefined;
  if (typeof documentVersion !== "number" || !Number.isInteger(documentVersion) || documentVersion < 1) return undefined;
  return { entity, documentVersion };
}

/**
 * A stored draft made usable, or null when it has no usable shape (not an
 * object, or no `answers` array). Tolerant: answers with an unknown question
 * or a non-string or blank text are dropped, texts are cut to 140 characters,
 * a question keeps its first five answers, a missing or repeated id gets a new
 * one, `open` is deduplicated and loses the keys that have answers.
 */
export function repairDraft(value: unknown): CanvasDraft | null {
  if (!isRecord(value) || !Array.isArray(value.answers)) return null;
  const perQuestion = new Map<string, number>();
  const kept: DraftAnswer[] = [];
  const pendingIds: number[] = [];
  const usedIds = new Set<string>();
  for (const item of value.answers) {
    if (!isRecord(item)) continue;
    const { question, text, id } = item;
    if (typeof question !== "string" || !QUESTION_KEYS.has(question)) continue;
    if (typeof text !== "string") continue;
    const fitted = fitAnswer(text).trim();
    if (fitted === "") continue;
    const count = perQuestion.get(question) ?? 0;
    if (count >= MAX_ANSWERS_PER_QUESTION) continue;
    perQuestion.set(question, count + 1);
    const answer: DraftAnswer = { id: "", question: question as BmcQuestionKey, text: fitted };
    const inspiration = repairInspiration(item.inspiration);
    if (inspiration) answer.inspiration = inspiration;
    if (typeof id === "string" && ANSWER_ID.test(id) && !usedIds.has(id)) {
      answer.id = id;
      usedIds.add(id);
    } else {
      pendingIds.push(kept.length);
    }
    kept.push(answer);
  }
  for (const position of pendingIds) kept[position].id = nextAnswerId(kept);

  const answered = new Set(kept.map((answer) => answer.question));
  const openKeys = new Set(
    (Array.isArray(value.open) ? value.open : []).filter(
      (key): key is BmcQuestionKey => typeof key === "string" && QUESTION_KEYS.has(key) && !answered.has(key as BmcQuestionKey),
    ),
  );
  return {
    name: typeof value.name === "string" ? cutText(oneLine(value.name), NAME_MAX_LENGTH) : "",
    answers: kept,
    open: BMC_QUESTION_KEYS.filter((key) => openKeys.has(key)),
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.length <= 40 ? value.updatedAt : "",
  };
}

/** What the stored value holds. `null` (nothing stored) and a blank string are `none`. */
export function readStoredDraft(raw: string | null): StoredDraftRead {
  if (raw === null || raw.trim() === "") return { status: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "unreadable", raw };
  }
  if (!isRecord(parsed)) return { status: "unreadable", raw };
  const v = parsed.v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return { status: "unreadable", raw };
  if (v > DRAFT_FORMAT) return { status: "newer", v, raw, draft: repairDraft(parsed.draft) ?? emptyDraft() };

  let draft: unknown = parsed.draft;
  for (let from = v; from < DRAFT_FORMAT; from++) {
    const upgrade = DRAFT_UPGRADES[from];
    if (!upgrade) return { status: "unreadable", raw };
    try {
      draft = upgrade(draft);
    } catch {
      return { status: "unreadable", raw };
    }
  }
  const repaired = repairDraft(draft);
  return repaired ? { status: "ok", draft: repaired } : { status: "unreadable", raw };
}

/** The stored value: the envelope, answers trimmed, blank ones left out. */
export function serializeDraft(draft: CanvasDraft): string {
  const answers = draft.answers
    .filter((answer) => answer.text.trim() !== "")
    .map((answer) => ({
      id: answer.id,
      question: answer.question,
      text: answer.text.trim(),
      ...(answer.inspiration ? { inspiration: answer.inspiration } : {}),
    }));
  return JSON.stringify({
    v: DRAFT_FORMAT,
    draft: { name: draft.name, answers, open: draft.open, updatedAt: draft.updatedAt },
  });
}
```

- [ ] **Step 4: Run it again**

```bash
node tests/app/arkademy-canvas.test.js | grep -c '^PASS'
node tests/app/arkademy-canvas.test.js | tail -1
```

Expected: `116`, then `All arkademy-canvas tests passed.` (with the code as shown, its final state; the commit as first made counted 109, before `adf4f62e` added the inspiration-answer checks).

- [ ] **Step 5: Commit**

```bash
git add lib/arkademy/canvas-storage.ts tests/app/arkademy-canvas.test.js
git commit -m "feat(arkademy): your canvas in browser storage, read tolerantly"
```

---

### Task 5: The exports

**Files:**
- Create: `lib/arkademy/canvas-export.ts`
- Modify: `tests/app/arkademy-canvas.test.js`

- [ ] **Step 1: Write the test first**

Insert immediately above `cleanup();`:

```js
// --- exports -------------------------------------------------------------------------
{
  const { canvasMarkdown, canvasJson, canvasJsonText, canvasFilename, canvasParagraphText, draftState, emptyDraft } = A;
  const toolPart = { title: tool.title, questions: tool.questions };
  const draft = {
    name: "  Tidy Harbour ",
    answers: [
      { id: "a1", question: "seg", text: "people who fish from the shore " },
      { id: "a2", question: "ch", text: "app stores", inspiration: { entity: "app-stores", documentVersion: 4 } },
      { id: "a3", question: "ch", text: "harbour noticeboards." },
      { id: "a4", question: "vp", text: "..." },
    ],
    open: ["rev"],
    updatedAt: "",
  };
  const state = draftState(draft);

  same(
    "paragraph text",
    canvasParagraphText({ tool: toolPart, name: draft.name, state }),
    "Tidy Harbour is for people who fish from the shore. It reaches them through app stores and harbour noticeboards.",
  );
  same(
    "markdown, byte-exact: answered, open and empty questions, a name",
    canvasMarkdown({ tool: toolPart, name: draft.name, state }),
    [
      "# Tidy Harbour: Business Model Canvas",
      "",
      "Tidy Harbour is for people who fish from the shore. It reaches them through app stores and harbour noticeboards.",
      "",
      "## Customer segments",
      "",
      "- people who fish from the shore",
      "",
      "## Value propositions",
      "",
      "_Not answered yet._",
      "",
      "## Channels",
      "",
      "- app stores",
      "- harbour noticeboards",
      "",
      "## Customer relationships",
      "",
      "_Not answered yet._",
      "",
      "## Revenue streams",
      "",
      "_Left open on purpose._",
      "",
      "## Key resources",
      "",
      "_Not answered yet._",
      "",
      "## Key activities",
      "",
      "_Not answered yet._",
      "",
      "## Key partners",
      "",
      "_Not answered yet._",
      "",
      "## Cost structure",
      "",
      "_Not answered yet._",
      "",
    ].join("\n"),
  );
  const unnamed = canvasMarkdown({ tool: toolPart, name: " ", state: draftState(emptyDraft()) });
  check("markdown without a name: the default subject, no paragraph line", unnamed.startsWith("# This product: Business Model Canvas\n\n## Customer segments\n\n_Not answered yet._\n\n## Value"));
  check("markdown: a single trailing newline", unnamed.endsWith("_Not answered yet._\n") && !unnamed.endsWith("\n\n"));
  same("markdown: nine sections", (unnamed.match(/^## /gm) ?? []).length, 9);

  const exported = canvasJson({ tool: toolPart, name: draft.name, state, documentVersion: 4, exportedAt: "2026-11-12T10:00:00.000Z" });
  same("json: header", [exported.format, exported.formatVersion, exported.tool, exported.name, exported.documentVersion, exported.exportedAt], [
    "arkaik.arkademy.canvas",
    1,
    "business-model-canvas",
    "Tidy Harbour",
    4,
    "2026-11-12T10:00:00.000Z",
  ]);
  same("json: the paragraph", exported.paragraph, canvasParagraphText({ tool: toolPart, name: draft.name, state }));
  same("json: nine questions with their words", exported.questions.map((q) => [q.key, q.state]), [
    ["seg", "answered"],
    ["vp", "empty"],
    ["ch", "answered"],
    ["cr", "empty"],
    ["rev", "open"],
    ["kr", "empty"],
    ["ka", "empty"],
    ["kp", "empty"],
    ["cost", "empty"],
  ]);
  same("json: a question", exported.questions[2], {
    key: "ch",
    block: "Channels",
    prompt: "How do they find out about it, and how do they get it?",
    state: "answered",
    answers: [{ text: "app stores", entity: "app-stores" }, { text: "harbour noticeboards" }],
  });
  const text = canvasJsonText(exported);
  check("json text: two-space indentation, trailing newline", text.startsWith('{\n  "format": "arkaik.arkademy.canvas",') && text.endsWith("}\n"));
  same("json text parses back", JSON.parse(text), exported);

  same("markdown and json: answers as shown, cleaned", [canvasMarkdown({ tool: toolPart, name: draft.name, state }).includes("- harbour noticeboards\n"), exported.questions[1].state], [true, "empty"]);
  same("filename: a name", canvasFilename("Tidy Harbour"), "tidy-harbour-business-model-canvas.json");
  same("filename: accents", canvasFilename("Café Crème"), "cafe-creme-business-model-canvas.json");
  same("filename: punctuation only", canvasFilename("!!! ???"), "business-model-canvas.json");
  same("filename: empty", canvasFilename(""), "business-model-canvas.json");
  same("filename: long names cut, no trailing dash", canvasFilename(`${"a".repeat(59)} b`), `${"a".repeat(59)}-business-model-canvas.json`);
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/app/arkademy-canvas.test.js | tail -3
```

Expected: the stack trace of `TypeError: canvasParagraphText is not a function`.

- [ ] **Step 3: Write `lib/arkademy/canvas-export.ts`**

```ts
import { questionStatus } from "./canvas";
import type { QuestionStatus } from "./canvas";
import { composeParagraph, DEFAULT_SUBJECT, displayAnswers, paragraphText } from "./paragraph";
import type { CanvasQuestionState } from "./paragraph";
import { BMC_TOOL_ID } from "./schema";
import type { BmcQuestion, BmcQuestionKey, BmcTool } from "./schema";

/**
 * Your own canvas's three exports (spec § "Exports"), pure: the paragraph as
 * plain text, the canvas as Markdown, and the canvas as a JSON file that reads
 * on its own (each question travels with its block title and its wording).
 * Every one is built from `draftState` and reads answers through
 * `displayAnswers`, as the paragraph and the grid do, so what is exported is
 * exactly what is shown.
 */

/** What the exports need of the tool: its title and its nine questions. */
export type CanvasTool = Pick<BmcTool, "title" | "questions">;

export interface CanvasExport {
  format: "arkaik.arkademy.canvas";
  formatVersion: 1;
  tool: "business-model-canvas";
  name: string;
  exportedAt: string; // ISO 8601
  documentVersion: number; // the library version this page was served with
  paragraph: string;
  questions: {
    key: BmcQuestionKey;
    block: string;
    prompt: string;
    state: QuestionStatus;
    answers: { text: string; entity?: string }[];
  }[];
}

/** Copy the paragraph: what the paragraph says, gaps left out. */
export function canvasParagraphText(input: { tool: CanvasTool; name: string; state: readonly CanvasQuestionState[] }): string {
  return paragraphText(composeParagraph({ questions: input.tool.questions, state: input.state, subject: input.name }));
}

function stateFor(state: readonly CanvasQuestionState[], question: BmcQuestion): CanvasQuestionState {
  return state.find((entry) => entry.key === question.key) ?? { key: question.key, answers: [], open: false };
}

/**
 * Copy as Markdown: a `#` title, the paragraph (left out when empty), then a
 * `##` section per question in canonical order — its answers as a list, or
 * "_Left open on purpose._", or "_Not answered yet._". A single trailing newline.
 */
export function canvasMarkdown(input: { tool: CanvasTool; name: string; state: readonly CanvasQuestionState[] }): string {
  const title = input.name.trim() || DEFAULT_SUBJECT;
  const blocks = [`# ${title}: ${input.tool.title}`];
  const paragraph = canvasParagraphText(input);
  if (paragraph !== "") blocks.push(paragraph);
  for (const question of input.tool.questions) {
    const entry = stateFor(input.state, question);
    const status = questionStatus(entry);
    blocks.push(`## ${question.block}`);
    if (status === "answered") blocks.push(displayAnswers(entry).map((answer) => `- ${answer.text}`).join("\n"));
    else blocks.push(status === "open" ? "_Left open on purpose._" : "_Not answered yet._");
  }
  return `${blocks.join("\n\n")}\n`;
}

/** Download JSON: the canvas with its questions' words, so the file reads on its own. */
export function canvasJson(input: {
  tool: CanvasTool;
  name: string;
  state: readonly CanvasQuestionState[];
  documentVersion: number;
  exportedAt: string;
}): CanvasExport {
  return {
    format: "arkaik.arkademy.canvas",
    formatVersion: 1,
    tool: BMC_TOOL_ID,
    name: input.name.trim(),
    exportedAt: input.exportedAt,
    documentVersion: input.documentVersion,
    paragraph: canvasParagraphText(input),
    questions: input.tool.questions.map((question) => {
      const entry = stateFor(input.state, question);
      return {
        key: question.key,
        block: question.block,
        prompt: question.prompt,
        state: questionStatus(entry),
        answers: displayAnswers(entry).map((answer) =>
          answer.entity ? { text: answer.text, entity: answer.entity } : { text: answer.text },
        ),
      };
    }),
  };
}

/** The file's text: two-space indentation and a trailing newline. */
export function canvasJsonText(canvas: CanvasExport): string {
  return `${JSON.stringify(canvas, null, 2)}\n`;
}

/** `acme-bakery-business-model-canvas.json`, or `business-model-canvas.json` for a name with no letters or digits. */
export function canvasFilename(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug === "" ? `${BMC_TOOL_ID}.json` : `${slug}-${BMC_TOOL_ID}.json`;
}
```

- [ ] **Step 4: Run it again, and under Node 20 if you have it**

```bash
node tests/app/arkademy-canvas.test.js | grep -c '^PASS'
node tests/app/arkademy-canvas.test.js | tail -1
```

Expected: `133`, then `All arkademy-canvas tests passed.` (with the code as shown, its final state; the commit as first made counted 126, before `adf4f62e` added the inspiration-answer checks).

- [ ] **Step 5: Commit**

```bash
git add lib/arkademy/canvas-export.ts tests/app/arkademy-canvas.test.js
git commit -m "feat(arkademy): your canvas's exports — the paragraph, Markdown and JSON"
```

---

### Task 6: The draft's store and a text download

**Files:**
- Create: `lib/hooks/useCanvasDraft.ts`, `lib/utils/download.ts`

These run only in a browser; Task 7's render checks and Task 11's browser run test them.

- [ ] **Step 1: Write `lib/utils/download.ts`**

```ts
/**
 * Hands the reader a text file: a Blob, an object URL and a temporary link,
 * the technique `downloadJson` uses for a project bundle
 * (lib/utils/export.ts). Browser only; call it from an event handler.
 */
export function downloadTextFile(filename: string, text: string, type = "application/json"): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Write `lib/hooks/useCanvasDraft.ts`**

```ts
"use client";

import { useSyncExternalStore } from "react";

import { draftIsEmpty, draftReducer, emptyDraft, firstUnfinishedStep } from "@/lib/arkademy/canvas";
import type { CanvasDraft, DraftAction } from "@/lib/arkademy/canvas";
import {
  DRAFT_STORAGE_KEY,
  DRAFT_UNREADABLE_KEY,
  readStoredDraft,
  serializeDraft,
} from "@/lib/arkademy/canvas-storage";

/**
 * Your own canvas's draft: the only code that reads or writes its key
 * (`arkaik:arkademy:bmc`, spec § "Browser storage").
 *
 * A module store read through `useSyncExternalStore`, like
 * useOverviewLayout and useStonePreferences, so nothing calls setState in an
 * effect and the server and the first client render agree: both see
 * `{ phase: "loading" }` (the page draws a skeleton), and the draft is read
 * from storage when the first component subscribes — after mount — so a
 * stored canvas never causes a hydration mismatch and never flashes empty.
 *
 * A change is written at most 300 ms later; a pending one is written at once
 * on `pagehide` and when the last component unsubscribes (a client
 * navigation away). Another tab's write arrives as a
 * `storage` event and replaces this tab's draft: two tabs converge on the
 * last writer.
 */

/** The longest a change waits before it is written. */
export const DRAFT_WRITE_DELAY_MS = 300;

/** "on": saved in this browser. "unavailable": storage is off, throws or is full. "newer": a newer build wrote it; never saved over. */
export type DraftPersistence = "on" | "unavailable" | "newer";

export type CanvasDraftView =
  | { phase: "loading" }
  | {
      phase: "ready";
      draft: CanvasDraft;
      /** The step a visit lands on without `?step=`, fixed when the draft was read. */
      startStep: number;
      persistence: DraftPersistence;
      /** A stored value this build could not read, copied aside before anything overwrote it. */
      unreadable: string | null;
    };

const LOADING: CanvasDraftView = { phase: "loading" };
const PROBE_KEY = "arkaik:arkademy:bmc:probe";

let view: CanvasDraftView = LOADING;
const listeners = new Set<() => void>();
let writeTimer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  for (const listener of listeners) listener();
}

/** `localStorage`, or null where reaching it throws (blocked site data, some private modes). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A storage that reads may still refuse writes (a zero quota, a full disk). */
function writable(storage: Storage): boolean {
  try {
    storage.setItem(PROBE_KEY, "1");
    storage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

function load() {
  const storage = browserStorage();
  let raw: string | null = null;
  let available = storage !== null;
  if (storage) {
    try {
      raw = storage.getItem(DRAFT_STORAGE_KEY);
    } catch {
      available = false;
    }
    if (available && !writable(storage)) available = false;
  }

  const read = readStoredDraft(raw);
  let draft = emptyDraft();
  let persistence: DraftPersistence = available ? "on" : "unavailable";
  let unreadable: string | null = null;
  if (read.status === "ok") draft = read.draft;
  if (read.status === "newer") {
    draft = read.draft;
    if (available) persistence = "newer";
  }
  if (read.status === "unreadable") {
    unreadable = read.raw;
    try {
      storage?.setItem(DRAFT_UNREADABLE_KEY, read.raw);
    } catch {
      persistence = "unavailable";
    }
  }
  view = { phase: "ready", draft, startStep: firstUnfinishedStep(draft), persistence, unreadable };
}

function write() {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (view.phase !== "ready" || view.persistence !== "on") return;
  const storage = browserStorage();
  try {
    if (!storage) throw new Error("no storage");
    if (draftIsEmpty(view.draft)) storage.removeItem(DRAFT_STORAGE_KEY);
    else storage.setItem(DRAFT_STORAGE_KEY, serializeDraft(view.draft));
  } catch {
    view = { ...view, persistence: "unavailable" };
    emit();
  }
}

/** Writes a pending change now. With nothing pending it writes nothing, so a tab at rest never overwrites another's draft. */
function flush() {
  if (writeTimer !== undefined) write();
}

function onStorage(event: StorageEvent) {
  if (event.key !== DRAFT_STORAGE_KEY && event.key !== null) return;
  if (view.phase !== "ready") return;
  const read = readStoredDraft(event.key === null ? null : event.newValue);
  if (read.status === "unreadable") return; // keep this tab's canvas
  // The other tab wrote last; a pending write here would undo it.
  clearTimeout(writeTimer);
  writeTimer = undefined;
  const draft = read.status === "none" ? emptyDraft() : read.draft;
  const persistence = read.status === "newer" && view.persistence === "on" ? "newer" : view.persistence;
  view = { ...view, draft: draftReducer(view.draft, { type: "replace", draft }), persistence };
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    load();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", flush);
  }
  listeners.add(listener);
  listener();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    flush();
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pagehide", flush);
    view = LOADING;
  };
}

function getSnapshot(): CanvasDraftView {
  return view;
}

function getServerSnapshot(): CanvasDraftView {
  return LOADING;
}

/** Every edit goes through the draft's reducer; a change is stamped and written after a pause. */
export function dispatchDraft(action: DraftAction) {
  if (view.phase !== "ready") return;
  const next = draftReducer(view.draft, action);
  if (next === view.draft) return;
  view = { ...view, draft: action.type === "reset" ? next : { ...next, updatedAt: new Date().toISOString() } };
  emit();
  // At most DRAFT_WRITE_DELAY_MS after the first unsaved change: a timer reset
  // on every keystroke would never fire while someone types without pausing.
  if (writeTimer === undefined) writeTimer = setTimeout(write, DRAFT_WRITE_DELAY_MS);
}

/** Hides the unreadable notice; the copy kept aside stays where it is. */
export function dismissUnreadableDraft() {
  if (view.phase !== "ready" || view.unreadable === null) return;
  view = { ...view, unreadable: null };
  emit();
}

export function useCanvasDraft(): CanvasDraftView {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribeToOtherTabs(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/**
 * Whether this browser holds a canvas worth continuing — for the cover's
 * "Start your own" / "Continue your canvas". The server and the first client
 * render say no; the label changes after hydration.
 */
function hasDraftSnapshot(): boolean {
  if (view.phase === "ready") return !draftIsEmpty(view.draft);
  try {
    const read = readStoredDraft(window.localStorage.getItem(DRAFT_STORAGE_KEY));
    return read.status === "newer" || (read.status === "ok" && !draftIsEmpty(read.draft));
  } catch {
    return false;
  }
}

export function useHasCanvasDraft(): boolean {
  return useSyncExternalStore(subscribeToOtherTabs, hasDraftSnapshot, () => false);
}

/** The stored value as it is, or null: what a page without a library offers to download. */
function storedTextSnapshot(): string | null {
  try {
    return window.localStorage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useStoredDraftText(): string | null {
  return useSyncExternalStore(subscribeToOtherTabs, storedTextSnapshot, () => null);
}
```

- [ ] **Step 3: Type-check and lint**

```bash
rm -rf .next
npx tsc --noEmit
npm run lint 2>&1 | grep problems
```

Expected: `tsc` silent; `✖ 3 problems (0 errors, 3 warnings)` (main's own; whatever part 3 added, 0 errors).

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/useCanvasDraft.ts lib/utils/download.ts
git commit -m "feat(arkademy): the draft's store, read after mount, and a text download"
```

---

### Task 7: The page — question editor, inspirations, paragraph, canvas, exports

**Files:**
- Create: `components/arkademy/QuestionSteps.tsx`, `QuestionEditor.tsx`, `InspirationList.tsx`, `StartOverDialog.tsx`, `CanvasToolbar.tsx`, `YourCanvas.tsx`, `StrandedDraft.tsx`, `StartYourOwnButton.tsx`
- Create: `app/arkademy/business-model-canvas/yours/page.tsx`
- Modify: `tests/app/arkademy-canvas.test.js`

- [ ] **Step 1: Write the render checks first**

Insert immediately above `cleanup();`:

```js
// --- the components, rendered on the server ------------------------------------------
// Through tests/app/load-arkademy-tsx.js (part 2's require hook). What the
// server sends before the stored draft is read, and the markup each piece's
// behaviour lives in.
{
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { requireTsx } = require("./load-arkademy-tsx");
  // YourCanvas takes ARKADEMY_SECTION_TITLE from ArkademyChrome.tsx, which
  // imports lib/fonts.ts; next/font only runs inside Next's compiler, so this
  // suite answers it with a font whose class is empty.
  const Module = require("module");
  const load = Module._load;
  Module._load = function loadWithFontStub(request, ...rest) {
    if (request === "next/font/google") return new Proxy({}, { get: () => () => ({ className: "", variable: "", style: {} }) });
    return load.call(this, request, ...rest);
  };
  const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
  const { YourCanvas } = requireTsx("components/arkademy/YourCanvas.tsx");
  const { StartYourOwnButton } = requireTsx("components/arkademy/StartYourOwnButton.tsx");
  const { QuestionEditor } = requireTsx("components/arkademy/QuestionEditor.tsx");
  const { QuestionSteps } = requireTsx("components/arkademy/QuestionSteps.tsx");
  const { InspirationList } = requireTsx("components/arkademy/InspirationList.tsx");
  const { CanvasToolbar } = requireTsx("components/arkademy/CanvasToolbar.tsx");
  const noop = () => {};

  const server = render(YourCanvas, {
    tool: { title: tool.title, questions: tool.questions },
    catalog: A.inspirationCatalog(index),
    documentVersion: 1,
    initialStep: null,
  });
  check("server: the skeleton, named for assistive technology", server.includes('aria-label="Loading your canvas"'));
  check("server: no draft in the HTML (it lives in the browser)", !server.includes("canvas-question-title") && !server.includes("canvas-name"));

  const start = render(StartYourOwnButton, {});
  check("cover action: the server says Start your own", start.includes(">Start your own</a>") && start.includes('href="/arkademy/business-model-canvas/yours"'));
  check("cover action: the stone button", start.includes("stone stone-primary"));

  const editorProps = (answers, step = 1, open = false) => ({
    question: tool.questions[step - 1],
    step,
    total: 9,
    answers,
    open,
    preview: null,
    onAdd: () => "added",
    onEdit: noop,
    onRemove: noop,
    onMove: noop,
    onSetOpen: noop,
    onBack: noop,
    onNext: noop,
  });
  const empty = render(QuestionEditor, editorProps([]));
  check("editor: kicker, question as the h2", empty.includes(">Question 1 of 9 · Customer segments</p>") && empty.includes(">Who is this for?</h2>"));
  check("editor: no answer, so it can be left open", empty.includes("Leave this open on purpose"));
  check("editor: Back disabled on the first question", /<button[^>]*disabled=""[^>]*>.*?Back<\/button>/.test(empty));
  const fiveAnswers = ["a", "b", "c", "d", "e"].map((text, i) => ({ id: `a${i + 1}`, question: "ka", text }));
  const five = render(QuestionEditor, editorProps(fiveAnswers, 7));
  check("editor: five answers disable the add field", /<textarea[^>]*id="canvas-add-answer"[^>]*disabled=""/.test(five));
  check("editor: and say why", five.includes("Five answers is the most a question takes."));
  check("editor: with answers, no open checkbox", !five.includes("Leave this open on purpose"));
  check("editor: the first cannot move up, the last cannot move down", /aria-label="Move answer 1 up" disabled=""/.test(five) && /aria-label="Move answer 5 down" disabled=""/.test(five));
  check("editor: the ninth question's Next reads the paragraph", render(QuestionEditor, editorProps([], 9)).includes("Read your paragraph"));
  check("editor: no keydown listener on window or document", !/(window|document)\.addEventListener\(\s*["']keydown/.test(fs.readFileSync(path.join(ROOT, "components/arkademy/QuestionEditor.tsx"), "utf8")));

  const steps = render(QuestionSteps, {
    questions: tool.questions,
    statuses: ["answered", "empty", "empty", "empty", "open", "empty", "empty", "empty", "empty"],
    current: 2,
    onSelect: noop,
  });
  check("steps: each named with its state", steps.includes('aria-label="Question 1: Customer segments, answered"') && steps.includes('aria-label="Question 5: Revenue streams, left open on purpose"') && steps.includes('aria-label="Question 2: Value propositions, not answered yet"'));
  same("steps: one current", (steps.match(/aria-current="step"/g) ?? []).length, 1);

  const many = Array.from({ length: 9 }, (_, i) => ({ entity: `e-${i}`, label: `label ${i}`, companies: [{ id: "c", name: "Crumb & Co" }] }));
  const list = render(InspirationList, { items: many, full: false, onAdd: noop });
  same("inspirations: six first", (list.match(/<li>/g) ?? []).length, 6);
  check("inspirations: then Show all", list.includes("Show all 9"));
  check("inspirations: each names its companies", list.includes('aria-label="Add “label 0”, used by Crumb &amp; Co"'));
  const fullList = render(InspirationList, { items: many.slice(0, 2), full: true, onAdd: noop });
  same("inspirations: disabled at five answers", (fullList.match(/<button[^>]*disabled=""/g) ?? []).length, 2);

  const bare = render(CanvasToolbar, { paragraph: "", markdown: "", hasContent: false, onDownload: noop, onStartOver: noop, focusAfterStartOver: "canvas-name" });
  same("toolbar: nothing to export or clear, every button disabled", (bare.match(/<button[^>]*disabled=""/g) ?? []).length, 4);
  const ready = render(CanvasToolbar, { paragraph: "It is.", markdown: "# x\n", hasContent: true, onDownload: noop, onStartOver: noop, focusAfterStartOver: "canvas-name" });
  same("toolbar: with a canvas, none disabled", (ready.match(/disabled=""/g) ?? []).length, 0);
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/app/arkademy-canvas.test.js 2>&1 | grep -m1 'Cannot find module'
```

Expected: `Error: Cannot find module '…/components/arkademy/YourCanvas.tsx'` (with this checkout's absolute path).

- [ ] **Step 3: `components/arkademy/QuestionSteps.tsx`**

```tsx
import type { QuestionStatus } from "@/lib/arkademy/canvas";
import type { BmcQuestion } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

interface QuestionStepsProps {
  questions: readonly Pick<BmcQuestion, "key" | "block">[];
  /** One per question, in the same order. */
  statuses: readonly QuestionStatus[];
  /** 1–9. */
  current: number;
  onSelect: (step: number) => void;
}

const STATUS_WORDS: Record<QuestionStatus, string> = {
  answered: "answered",
  open: "left open on purpose",
  empty: "not answered yet",
};

/**
 * Your own canvas's nine questions as a row of numbered buttons: filled when
 * answered, dashed when left open on purpose, plain when not answered yet;
 * the current one ringed. Nine 36px targets fit a 400px screen in one row.
 * No hooks; the screen passes the handler.
 */
export function QuestionSteps({ questions, statuses, current, onSelect }: QuestionStepsProps) {
  return (
    <nav aria-label="Questions">
      <ol className="flex flex-wrap gap-1 sm:gap-1.5">
        {questions.map((question, i) => {
          const status = statuses[i] ?? "empty";
          const step = i + 1;
          const isCurrent = step === current;
          return (
            <li key={question.key}>
              <button
                type="button"
                onClick={() => onSelect(step)}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Question ${step}: ${question.block}, ${STATUS_WORDS[status]}`}
                title={question.block}
                data-status={status}
                className={cn(
                  "flex size-9 cursor-pointer items-center justify-center rounded-full border font-mono text-xs tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  status === "answered" && "border-transparent bg-primary text-primary-foreground hover:bg-primary/85",
                  status === "open" && "border-dashed border-muted-foreground/60 text-muted-foreground hover:text-foreground",
                  status === "empty" && "bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  isCurrent && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
              >
                {step}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 4: `components/arkademy/QuestionEditor.tsx`**

```tsx
"use client";

import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";

import { ARKADEMY_KICKER } from "@/components/arkademy/QuestionCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { oneLine, type DraftAnswer } from "@/lib/arkademy/canvas";
import { ANSWER_MAX_LENGTH, MAX_ANSWERS_PER_QUESTION, type BmcQuestion } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

/** The ids the screen focuses: the question's heading and its add field. */
export const QUESTION_TITLE_ID = "canvas-question-title";
export const ADD_ANSWER_ID = "canvas-add-answer";
const NEXT_ID = "canvas-next";
const answerFieldId = (id: string) => `canvas-answer-${id}`;
const moveButtonId = (id: string, offset: -1 | 1) => `canvas-answer-${id}-${offset < 0 ? "up" : "down"}`;

export type AddResult = "added" | "duplicate" | "full";

interface QuestionEditorProps {
  question: BmcQuestion;
  /** 1–9. */
  step: number;
  total: number;
  /** This question's answers, in display order. */
  answers: readonly DraftAnswer[];
  /** Left open on purpose. */
  open: boolean;
  /** What this question adds to the paragraph, drawn by the screen. */
  preview: ReactNode;
  onAdd: (text: string) => AddResult;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  onSetOpen: (open: boolean) => void;
  onBack: () => void;
  /** `fromKeyboard`: Enter on the empty add field, or Next pressed from the keyboard; focus then lands in the next question's add field. */
  onNext: (fromKeyboard: boolean) => void;
}

/** A field that grows with its words and never takes a line break: an answer is one line of the paragraph. */
const FIELD = "min-h-9 resize-none py-1.5 [field-sizing:content]";

/** Enter, outside an input method's composition. */
function isEnter(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
}

function focusById(id: string) {
  document.getElementById(id)?.focus();
}

/**
 * The current question of your own canvas, in edit mode (spec § "Editing"):
 * "Question N of 9 · block", the question as the card's `h2`, its hint, one
 * field per answer (reword in place, reorder, remove), the add field, "Leave
 * this open on purpose" while there is no answer, the sentence this question
 * adds to the paragraph, and Back / Next.
 *
 * The screen keys it by question, so the add field's text starts empty on
 * every question. Keyboard handling lives on the fields themselves.
 */
export function QuestionEditor({
  question,
  step,
  total,
  answers,
  open,
  preview,
  onAdd,
  onEdit,
  onRemove,
  onMove,
  onSetOpen,
  onBack,
  onNext,
}: QuestionEditorProps) {
  const [text, setText] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const full = answers.length >= MAX_ANSWERS_PER_QUESTION;
  const left = ANSWER_MAX_LENGTH - text.length;

  function add() {
    if (text.trim() === "") {
      focusById(ADD_ANSWER_ID);
      return;
    }
    const result = onAdd(text);
    if (result === "duplicate") setDuplicate(true);
    if (result !== "added") return;
    setText("");
    // The fifth answer disables the add field, which would drop the keyboard's focus.
    if (answers.length + 1 >= MAX_ANSWERS_PER_QUESTION) focusById(NEXT_ID);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    add();
  }

  function onAddKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isEnter(event)) return;
    event.preventDefault();
    if (text.trim() === "") onNext(true);
    else add();
  }

  function remove(id: string, position: number) {
    const next = answers[position + 1] ?? answers[position - 1];
    flushSync(() => onRemove(id));
    focusById(next ? answerFieldId(next.id) : ADD_ANSWER_ID);
  }

  function move(id: string, offset: -1 | 1, from: "button" | "field") {
    flushSync(() => onMove(id, offset));
    const button = document.getElementById(moveButtonId(id, offset));
    if (from === "button" && button instanceof HTMLButtonElement && !button.disabled) button.focus();
    else focusById(answerFieldId(id));
  }

  function onAnswerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, id: string) {
    if (isEnter(event)) {
      event.preventDefault();
      focusById(ADD_ANSWER_ID);
    } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      move(id, event.key === "ArrowUp" ? -1 : 1, "field");
    }
  }

  const help = full
    ? "Five answers is the most a question takes."
    : duplicate
      ? "That answer is already here."
      : left <= 20
        ? `${left} ${left === 1 ? "character" : "characters"} left.`
        : answers.length === 0
          ? "Enter adds it. Enter on an empty field goes to the next question."
          : "Enter adds another. Enter on an empty field goes to the next question.";

  return (
    <Card className="min-w-0 gap-5 p-4 sm:p-6">
      <div>
        <p className={ARKADEMY_KICKER}>
          Question {step} of {total} · {question.block}
        </p>
        <h2
          id={QUESTION_TITLE_ID}
          tabIndex={-1}
          className="mt-2 text-xl font-semibold tracking-tight text-balance outline-none sm:text-2xl"
        >
          {question.prompt}
        </h2>
        {question.hint && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{question.hint}</p>}
      </div>

      {answers.length > 0 && (
        <ol aria-label="Your answers" className="flex flex-col gap-2">
          {answers.map((answer, i) => (
            <li key={answer.id} className="flex flex-wrap items-start gap-x-1.5 gap-y-1">
              <span aria-hidden="true" className="w-4 shrink-0 pt-2 font-mono text-[11px] text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <Textarea
                id={answerFieldId(answer.id)}
                rows={1}
                value={answer.text}
                maxLength={ANSWER_MAX_LENGTH}
                aria-label={`Answer ${i + 1} of ${answers.length}`}
                onChange={(event) => onEdit(answer.id, event.target.value)}
                onBlur={(event) => {
                  if (event.target.value.trim() === "") onRemove(answer.id);
                }}
                onKeyDown={(event) => onAnswerKeyDown(event, answer.id)}
                className={cn(FIELD, "min-w-60 flex-1")}
              />
              {/* Beside the field when it keeps 15rem, under it on a phone. */}
              <div className="ml-auto flex shrink-0">
                <Button
                  id={moveButtonId(answer.id, -1)}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground"
                  aria-label={`Move answer ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(answer.id, -1, "button")}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  id={moveButtonId(answer.id, 1)}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground"
                  aria-label={`Move answer ${i + 1} down`}
                  disabled={i === answers.length - 1}
                  onClick={() => move(answer.id, 1, "button")}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground"
                  aria-label={`Remove answer ${i + 1}`}
                  onClick={() => remove(answer.id, i)}
                >
                  <XIcon />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div>
        <form onSubmit={submit} className="flex items-start gap-2">
          <Textarea
            id={ADD_ANSWER_ID}
            rows={1}
            value={text}
            maxLength={ANSWER_MAX_LENGTH}
            disabled={full}
            placeholder={answers.length === 0 ? "Type an answer" : "Add another answer"}
            aria-label={answers.length === 0 ? "Your answer" : "Another answer"}
            aria-describedby="canvas-add-help"
            onChange={(event) => {
              setText(oneLine(event.target.value));
              setDuplicate(false);
            }}
            onKeyDown={onAddKeyDown}
            className={FIELD}
          />
          <Button type="submit" variant="outline" disabled={full} className="shrink-0">
            <PlusIcon aria-hidden="true" />
            Add
          </Button>
        </form>
        <p
          id="canvas-add-help"
          className={cn("mt-1.5 text-xs text-muted-foreground", (full || duplicate) && "text-foreground")}
        >
          {help}
        </p>
      </div>

      {answers.length === 0 && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3",
            open ? "border-dashed border-muted-foreground/45" : "border-transparent bg-muted/50",
          )}
        >
          <Checkbox
            id="canvas-open"
            checked={open}
            onCheckedChange={(checked) => onSetOpen(checked === true)}
            className="mt-0.5 cursor-pointer"
          />
          <div className="min-w-0">
            <Label htmlFor="canvas-open" className="cursor-pointer leading-snug">
              Leave this open on purpose
            </Label>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {open
                ? "Your paragraph says so. Untick it, or add an answer, to answer it after all."
                : "A model can choose not to answer a question yet. Your paragraph will say so."}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-muted/50 px-3 py-2.5">
        <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">In your paragraph</p>
        <div className="mt-1">{preview}</div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onBack} disabled={step === 1}>
          <ChevronLeftIcon aria-hidden="true" />
          Back
        </Button>
        <Button id={NEXT_ID} type="button" variant="outline" onClick={(event) => onNext(event.detail === 0)}>
          {step === total ? "Read your paragraph" : "Next question"}
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 5: `components/arkademy/InspirationList.tsx`**

```tsx
"use client";

import { useState, type MouseEvent } from "react";
import { LightbulbIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { companiesLine, INSPIRATIONS_SHOWN, type Inspiration } from "@/lib/arkademy/inspirations";
import { cn } from "@/lib/utils";

interface InspirationListProps {
  /** `availableInspirations` for the current question: not yet on the canvas. */
  items: readonly Inspiration[];
  /** The question holds five answers: every button is disabled. */
  full: boolean;
  /** The event tells a keyboard activation (`detail` 0) from a pointer click. */
  onAdd: (inspiration: Inspiration, event: MouseEvent<HTMLButtonElement>) => void;
  id?: string;
  className?: string;
}

/**
 * Beside the question (below it on narrow screens): what the examples
 * answered, as the library's neutral labels, most shared first, each naming
 * the examples that use it. One click adds it as an answer the visitor can
 * reword. Six first, then "Show all N". The screen renders it only for a
 * question some example answers, and keys it by question, so "Show all"
 * folds again on the next question.
 */
export function InspirationList({ items, full, onAdd, id, className }: InspirationListProps) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, INSPIRATIONS_SHOWN);
  return (
    <section id={id} aria-labelledby="canvas-inspirations-title" className={cn("min-w-0", className)}>
      <h2 id="canvas-inspirations-title" className="flex items-center gap-1.5 text-sm font-semibold">
        <LightbulbIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        Inspirations
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        What the examples answered. Add one, then make it yours.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Every inspiration for this question is on your canvas.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {shown.map((item) => {
            const users = companiesLine(item.companies);
            return (
              <li key={item.entity}>
                <button
                  type="button"
                  disabled={full}
                  onClick={(event) => onAdd(item, event)}
                  aria-label={`Add “${item.label}”, used by ${users}`}
                  className="flex w-full cursor-pointer items-start gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors outline-none hover:border-foreground/25 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PlusIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">
                    <span className="block text-sm leading-snug">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{users}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > INSPIRATIONS_SHOWN && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 text-muted-foreground"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      )}
      {full && items.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Remove an answer to add one of these.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 6: `components/arkademy/StartOverDialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface StartOverDialogProps {
  /** Nothing to clear: the button is disabled. */
  disabled: boolean;
  onConfirm: () => void;
  /** Where focus goes once the canvas is cleared (the button is disabled by then). */
  focusAfterConfirm: string;
}

/**
 * "Start over" and its confirmation, in the app's destructive style — the
 * shape of `DeleteConfirmDialog` (components/graph/DeleteConfirmDialog.tsx): a
 * title, one sentence, Cancel first (it takes the focus), then the red action.
 * The button is the dialog's trigger, so Cancel and Escape give it the focus
 * back; after a confirmed start over the focus goes to `focusAfterConfirm`.
 */
export function StartOverDialog({ disabled, onConfirm, focusAfterConfirm }: StartOverDialogProps) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setConfirmed(false);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="text-muted-foreground">
          <RotateCcwIcon aria-hidden="true" />
          Start over
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          if (!confirmed) return;
          event.preventDefault();
          document.getElementById(focusAfterConfirm)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Start over?</DialogTitle>
          <DialogDescription>
            Your product&apos;s name and every answer leave this browser. Download JSON first if you want to keep a
            copy.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmed(true);
              setOpen(false);
              onConfirm();
            }}
          >
            Start over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: `components/arkademy/CanvasToolbar.tsx`**

```tsx
"use client";

import { CopyIcon, DownloadIcon } from "lucide-react";

import { CopyButton } from "@/components/arkademy/CopyButton";
import { StartOverDialog } from "@/components/arkademy/StartOverDialog";
import { Button } from "@/components/ui/button";

interface CanvasToolbarProps {
  /** `canvasParagraphText`: empty until a question is answered. */
  paragraph: string;
  /** `canvasMarkdown`. */
  markdown: string;
  /** The draft holds something (a name, an answer, an open question). */
  hasContent: boolean;
  onDownload: () => void;
  onStartOver: () => void;
  /** The field that takes the focus once the canvas is cleared. */
  focusAfterStartOver: string;
}

/**
 * The paragraph card's actions: the three exports (spec § "Exports") and
 * Start over, which asks first in the app's destructive confirmation
 * (`StartOverDialog`: Cancel, then the red action). A copy button with
 * nothing to copy is drawn disabled rather than copying an empty string.
 */
export function CanvasToolbar({
  paragraph,
  markdown,
  hasContent,
  onDownload,
  onStartOver,
  focusAfterStartOver,
}: CanvasToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {paragraph ? (
        <CopyButton text={paragraph} label="Copy the paragraph" what="the paragraph" />
      ) : (
        <Button type="button" variant="outline" size="sm" disabled>
          <CopyIcon aria-hidden="true" />
          Copy the paragraph
        </Button>
      )}
      {hasContent ? (
        <CopyButton text={markdown} label="Copy as Markdown" what="the canvas as Markdown" />
      ) : (
        <Button type="button" variant="outline" size="sm" disabled>
          <CopyIcon aria-hidden="true" />
          Copy as Markdown
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" disabled={!hasContent} onClick={onDownload}>
        <DownloadIcon aria-hidden="true" />
        Download JSON
      </Button>
      <StartOverDialog disabled={!hasContent} onConfirm={onStartOver} focusAfterConfirm={focusAfterStartOver} />
    </div>
  );
}
```

- [ ] **Step 8: `components/arkademy/YourCanvas.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { ChevronDownIcon, DownloadIcon, InfoIcon, RotateCwIcon } from "lucide-react";

import { ARKADEMY_SECTION_TITLE } from "@/components/arkademy/ArkademyChrome";
import { CanvasGrid } from "@/components/arkademy/CanvasGrid";
import { CanvasLink } from "@/components/arkademy/CanvasLink";
import { CanvasToolbar } from "@/components/arkademy/CanvasToolbar";
import { InspirationList } from "@/components/arkademy/InspirationList";
import { ParagraphView } from "@/components/arkademy/ParagraphView";
import { ADD_ANSWER_ID, QUESTION_TITLE_ID, QuestionEditor, type AddResult } from "@/components/arkademy/QuestionEditor";
import { ARKADEMY_KICKER } from "@/components/arkademy/QuestionCard";
import { QuestionSteps } from "@/components/arkademy/QuestionSteps";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  answersOf,
  draftIsEmpty,
  draftState,
  hasAnswerText,
  NAME_MAX_LENGTH,
  questionStatus,
  yoursHref,
  type CanvasDraft,
} from "@/lib/arkademy/canvas";
import {
  canvasFilename,
  canvasJson,
  canvasJsonText,
  canvasMarkdown,
  canvasParagraphText,
  type CanvasTool,
} from "@/lib/arkademy/canvas-export";
import { UNREADABLE_DRAFT_FILENAME } from "@/lib/arkademy/canvas-storage";
import { availableInspirations, type Inspiration } from "@/lib/arkademy/inspirations";
import { composeParagraph, DEFAULT_SUBJECT, type CanvasQuestionState } from "@/lib/arkademy/paragraph";
import { BMC_TOOL_ID, MAX_ANSWERS_PER_QUESTION, type BmcQuestion, type BmcQuestionKey } from "@/lib/arkademy/schema";
import { ARKADEMY_TOOL_PATHS } from "@/lib/arkademy/tools";
import { dismissUnreadableDraft, dispatchDraft, useCanvasDraft, type DraftPersistence } from "@/lib/hooks/useCanvasDraft";
import { downloadTextFile } from "@/lib/utils/download";
import { cn } from "@/lib/utils";

interface YourCanvasProps {
  /** The tool's title and its nine questions. */
  tool: CanvasTool;
  /** `inspirationCatalog`, built on the server. */
  catalog: Record<BmcQuestionKey, Inspiration[]>;
  /** The library version this page was served with: kept on inspired answers and in the JSON export. */
  documentVersion: number;
  /** `?step=` as the server read it, or null. */
  initialStep: number | null;
}

const NAME_ID = "canvas-name";
const PARAGRAPH_TITLE_ID = "canvas-paragraph-title";
const QUESTION_CARD_ID = "canvas-question";
const INSPIRATIONS_ID = "canvas-inspirations";
const COVER_PATH = ARKADEMY_TOOL_PATHS[BMC_TOOL_ID];

/**
 * The current question's sentence, underlined in the paragraph. An underline,
 * not a tint: hovering a sentence or a block tints the sentence (`CanvasLink`),
 * and the two must never be mistaken for one another. Literal class names, so
 * Tailwind finds them.
 */
const CURRENT_SENTENCE: Record<BmcQuestionKey, string> = {
  seg: "[&_[data-kind=sentence][data-question=seg]]:underline",
  vp: "[&_[data-kind=sentence][data-question=vp]]:underline",
  ch: "[&_[data-kind=sentence][data-question=ch]]:underline",
  cr: "[&_[data-kind=sentence][data-question=cr]]:underline",
  rev: "[&_[data-kind=sentence][data-question=rev]]:underline",
  kr: "[&_[data-kind=sentence][data-question=kr]]:underline",
  ka: "[&_[data-kind=sentence][data-question=ka]]:underline",
  kp: "[&_[data-kind=sentence][data-question=kp]]:underline",
  cost: "[&_[data-kind=sentence][data-question=cost]]:underline",
};
/** How that underline looks; decoration colour and thickness are not inherited, so they go on the sentence itself. */
const UNDERLINE_STYLE =
  "[&_[data-kind=sentence]]:decoration-muted-foreground/60 [&_[data-kind=sentence]]:decoration-2 [&_[data-kind=sentence]]:underline-offset-[5px]";

/** A character no answer holds, standing in for the answer still to come. */
const BLANK = "";

/**
 * Your own canvas (spec § "Your own canvas"): the name, the nine questions one
 * at a time with their inspirations, the paragraph and the canvas building as
 * the visitor types, and the exports. The draft lives in this browser only
 * (`useCanvasDraft`). The server and the first client render draw a skeleton;
 * the editor mounts once the stored draft has been read.
 */
export function YourCanvas(props: YourCanvasProps) {
  const view = useCanvasDraft();
  if (view.phase === "loading") return <YourCanvasSkeleton />;
  return (
    <CanvasEditor
      {...props}
      draft={view.draft}
      startStep={view.startStep}
      persistence={view.persistence}
      unreadable={view.unreadable}
    />
  );
}

function CanvasEditor({
  tool,
  catalog,
  documentVersion,
  initialStep,
  draft,
  startStep,
  persistence,
  unreadable,
}: YourCanvasProps & {
  draft: CanvasDraft;
  startStep: number;
  persistence: DraftPersistence;
  unreadable: string | null;
}) {
  const [step, setStep] = useState(initialStep ?? startStep);
  const [inspirationsShown, setInspirationsShown] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const questions = tool.questions;
  const question = questions[step - 1];
  const state = draftState(draft);
  const statuses = state.map(questionStatus);
  const segments = composeParagraph({ questions, state, subject: draft.name });
  const paragraph = canvasParagraphText({ tool, name: draft.name, state });
  const answers = answersOf(draft, question.key);
  const open = answers.length === 0 && draft.open.includes(question.key);
  const full = answers.length >= MAX_ANSWERS_PER_QUESTION;
  const catalogForQuestion = catalog[question.key] ?? [];
  const inspirations = availableInspirations(catalogForQuestion, answers);
  const hasContent = !draftIsEmpty(draft);
  const answeredCount = statuses.filter((status) => status === "answered").length;
  const openCount = statuses.filter((status) => status === "open").length;
  const complete = statuses.every((status) => status !== "empty");

  /** Moves to a question. Focus follows: its add field for the keyboard flow, else its heading. */
  function goTo(target: number, focus: "add" | "heading") {
    const next = Math.min(Math.max(target, 1), questions.length);
    flushSync(() => setStep(next));
    window.history.replaceState(null, "", yoursHref(next));
    const field = document.getElementById(ADD_ANSWER_ID);
    if (focus === "add" && field instanceof HTMLTextAreaElement && !field.disabled) {
      field.focus();
      return;
    }
    document.getElementById(QUESTION_TITLE_ID)?.focus({ preventScroll: true });
    document.getElementById(QUESTION_CARD_ID)?.scrollIntoView({ block: "nearest" });
  }

  function goToQuestion(key: BmcQuestionKey) {
    goTo(questions.findIndex((entry) => entry.key === key) + 1, "heading");
  }

  function readParagraph() {
    const heading = document.getElementById(PARAGRAPH_TITLE_ID);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  }

  function next(fromKeyboard: boolean) {
    if (step === questions.length) readParagraph();
    else goTo(step + 1, fromKeyboard ? "add" : "heading");
  }

  function addAnswer(text: string): AddResult {
    if (full) return "full";
    if (hasAnswerText(draft, question.key, text)) return "duplicate";
    dispatchDraft({ type: "add", question: question.key, text });
    return "added";
  }

  function addInspiration(item: Inspiration, event: MouseEvent<HTMLButtonElement>) {
    flushSync(() =>
      dispatchDraft({
        type: "addInspiration",
        question: question.key,
        entity: item.entity,
        text: item.answer,
        documentVersion,
      }),
    );
    setAnnouncement(`Added: ${item.label}`);
    // From the keyboard, back to the add field to reword or go on; from a
    // pointer, the heading, without scrolling (a touch keyboard would hide the list).
    const field = document.getElementById(ADD_ANSWER_ID);
    if (event.detail === 0 && field instanceof HTMLTextAreaElement && !field.disabled) field.focus();
    else document.getElementById(QUESTION_TITLE_ID)?.focus({ preventScroll: true });
  }

  function download() {
    const filename = canvasFilename(draft.name);
    const exported = canvasJson({ tool, name: draft.name, state, documentVersion, exportedAt: new Date().toISOString() });
    downloadTextFile(filename, canvasJsonText(exported));
    toast.success(`Downloaded ${filename}.`);
  }

  function startOver() {
    flushSync(() => {
      dispatchDraft({ type: "reset" });
      setStep(1);
    });
    window.history.replaceState(null, "", yoursHref(1));
    setAnnouncement("Your canvas is empty again.");
    toast.success("Started over.");
  }

  return (
    <div className="flex flex-col gap-8">
      <Notices
        persistence={persistence}
        unreadable={unreadable}
        hasContent={hasContent}
        onDownload={download}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={NAME_ID}>Your product&apos;s name</Label>
        <Input
          id={NAME_ID}
          value={draft.name}
          maxLength={NAME_MAX_LENGTH}
          placeholder={DEFAULT_SUBJECT}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => dispatchDraft({ type: "rename", name: event.target.value })}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            document.getElementById(ADD_ANSWER_ID)?.focus();
          }}
          className="max-w-sm"
        />
        <p className="text-xs text-muted-foreground">
          It opens your paragraph. {persistence === "on" && "Saved in this browser only."}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <QuestionSteps questions={questions} statuses={statuses} current={step} onSelect={(n) => goTo(n, "heading")} />
          <p className={ARKADEMY_KICKER}>
            {answeredCount} of {questions.length} answered{openCount > 0 && ` · ${openCount} left open`}
          </p>
        </div>

        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
          <div id={QUESTION_CARD_ID} className="min-w-0 scroll-mt-4">
            <QuestionEditor
              key={question.key}
              question={question}
              step={step}
              total={questions.length}
              answers={answers}
              open={open}
              preview={<SentencePreview questions={questions} state={state} subject={draft.name} question={question} />}
              onAdd={addAnswer}
              onEdit={(id, text) => dispatchDraft({ type: "edit", id, text })}
              onRemove={(id) => dispatchDraft({ type: "remove", id })}
              onMove={(id, offset) => dispatchDraft({ type: "move", id, offset })}
              onSetOpen={(value) => dispatchDraft({ type: "setOpen", question: question.key, open: value })}
              onBack={() => goTo(step - 1, "heading")}
              onNext={next}
            />
          </div>
          {catalogForQuestion.length > 0 && (
            <div className="min-w-0">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between md:hidden"
                aria-expanded={inspirationsShown}
                aria-controls={INSPIRATIONS_ID}
                onClick={() => setInspirationsShown(!inspirationsShown)}
              >
                {inspirationsShown ? "Hide inspirations" : `Stuck? ${inspirations.length} inspirations`}
                <ChevronDownIcon aria-hidden="true" className={cn("transition-transform", inspirationsShown && "rotate-180")} />
              </Button>
              <InspirationList
                key={question.key}
                id={INSPIRATIONS_ID}
                items={inspirations}
                full={full}
                onAdd={addInspiration}
                className={cn("mt-3 md:mt-0 md:block", inspirationsShown ? "block" : "hidden")}
              />
            </div>
          )}
        </div>
      </div>

      {/* One CanvasLink around the paragraph and the canvas: a sentence and its block light each other up. */}
      <CanvasLink className="contents">
        <Card className="gap-4 p-4 sm:p-6">
          <div>
            <h2 id={PARAGRAPH_TITLE_ID} tabIndex={-1} className={cn(ARKADEMY_SECTION_TITLE, "scroll-mt-4 outline-none")}>
              Your paragraph
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              One sentence per answered question. A gap takes you to its question.
            </p>
          </div>
          <ParagraphView
            segments={segments}
            onSelectQuestion={goToQuestion}
            className={cn("max-w-[72ch]", UNDERLINE_STYLE, CURRENT_SENTENCE[question.key])}
          />
          <CanvasToolbar
            paragraph={paragraph}
            markdown={canvasMarkdown({ tool, name: draft.name, state })}
            hasContent={hasContent}
            onDownload={download}
            onStartOver={startOver}
            focusAfterStartOver={NAME_ID}
          />
          {complete && (
            <p className="border-t pt-4 text-sm leading-relaxed text-muted-foreground">
              Every question is answered or left open on purpose. Paste your paragraph into{" "}
              <Link href={`${COVER_PATH}#prompt-title`} className="text-foreground underline underline-offset-4">
                the baseline prompt
              </Link>
              , or download the canvas to keep it.
            </p>
          )}
        </Card>

        <section aria-labelledby="canvas-grid-title" className="flex flex-col gap-3">
          <div>
            <h2 id="canvas-grid-title" className={ARKADEMY_SECTION_TITLE}>
              The canvas
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">A block&apos;s title takes you to its question.</p>
          </div>
          <CanvasGrid
            questions={questions}
            state={state}
            density="full"
            idPrefix="yours"
            label="Your canvas"
            current={question.key}
            onSelectQuestion={goToQuestion}
          />
        </section>
      </CanvasLink>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

/**
 * What the current question adds to the paragraph: its sentence, its
 * "left open on purpose" pill, or — before any answer — its sentence with a
 * blank where the answer goes ("This product is for ___."), which is how a
 * first visit sees what the tool does.
 */
function SentencePreview({
  questions,
  state,
  subject,
  question,
}: {
  questions: readonly BmcQuestion[];
  state: readonly CanvasQuestionState[];
  subject: string;
  question: BmcQuestion;
}) {
  const own = composeParagraph({ questions, state, subject }).find((segment) => segment.question === question.key);
  if (own && (own.kind === "sentence" || own.open)) return <ParagraphView segments={[own]} />;

  const withBlank = state.map((entry) =>
    entry.key === question.key ? { key: entry.key, answers: [{ text: BLANK }], open: false } : entry,
  );
  const blank = composeParagraph({ questions, state: withBlank, subject }).find(
    (segment) => segment.question === question.key,
  );
  const [before, after = ""] = blank && blank.kind === "sentence" ? blank.text.split(BLANK) : [""];
  return (
    <p className="text-[15px] leading-7 text-muted-foreground">
      {before}
      <span className="inline-block w-16 translate-y-[3px] border-b-2 border-dashed border-muted-foreground/50">
        <span className="sr-only">your answer</span>
      </span>
      {after}
    </p>
  );
}

function Notices({
  persistence,
  unreadable,
  hasContent,
  onDownload,
}: {
  persistence: DraftPersistence;
  unreadable: string | null;
  hasContent: boolean;
  onDownload: () => void;
}) {
  if (persistence === "on" && unreadable === null) return null;
  return (
    <div role="status" className="flex flex-col gap-3">
      {persistence === "unavailable" && (
        <Notice
          text="This browser is not saving your canvas: its storage is off or full. Download JSON before you leave to keep a copy."
          action={
            <Button type="button" variant="outline" size="sm" disabled={!hasContent} onClick={onDownload}>
              <DownloadIcon aria-hidden="true" />
              Download JSON
            </Button>
          }
        />
      )}
      {persistence === "newer" && (
        <Notice
          text="A newer version of this page saved your canvas. Reload to keep working on it; changes made here are not saved."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
              <RotateCwIcon aria-hidden="true" />
              Reload
            </Button>
          }
        />
      )}
      {unreadable !== null && (
        <Notice
          text="A canvas saved here earlier could not be read, so this one starts empty. Its text is kept aside in this browser."
          action={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadTextFile(UNREADABLE_DRAFT_FILENAME, unreadable, "text/plain")}
              >
                <DownloadIcon aria-hidden="true" />
                Download the old text
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={dismissUnreadableDraft}>
                Dismiss
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

function Notice({ text, action }: { text: string; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-muted-foreground/45 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-sm leading-relaxed">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {text}
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">{action}</div>
    </div>
  );
}

/** The server render and the first client frame: the editor's shape, before the stored draft is read. */
function YourCanvasSkeleton() {
  return (
    <div role="status" aria-label="Loading your canvas" className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-full max-w-sm" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full max-w-sm" />
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="hidden h-72 rounded-xl md:block" />
        </div>
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
```

- [ ] **Step 9: `components/arkademy/StrandedDraft.tsx`**

```tsx
"use client";

import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useStoredDraftText } from "@/lib/hooks/useCanvasDraft";
import { downloadTextFile } from "@/lib/utils/download";

/**
 * Your own canvas without a library (spec § "States without a document"): when
 * this browser holds a saved canvas, it can still be downloaded as stored, so
 * nothing a visitor typed is stranded. Renders nothing otherwise.
 */
export function StrandedDraft() {
  const stored = useStoredDraftText();
  if (stored === null) return null;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm leading-relaxed">Your canvas is still saved in this browser. You can download it as it is.</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => downloadTextFile("business-model-canvas-draft.json", stored)}
      >
        <DownloadIcon aria-hidden="true" />
        Download your saved canvas
      </Button>
    </div>
  );
}
```

- [ ] **Step 10: `components/arkademy/StartYourOwnButton.tsx`**

```tsx
"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BMC_YOURS_PATH } from "@/lib/arkademy/tools";
import { useHasCanvasDraft } from "@/lib/hooks/useCanvasDraft";

/**
 * The page's one special action (the stone button), on the cover and on the
 * tour's end card: "Start your own", or "Continue your canvas" once this
 * browser holds one. The server renders "Start your own"; the label changes
 * after hydration, never during it.
 */
export function StartYourOwnButton({ size = "default" }: { size?: "default" | "lg" }) {
  const hasDraft = useHasCanvasDraft();
  return (
    <Button asChild variant="stone" size={size}>
      <Link href={BMC_YOURS_PATH}>{hasDraft ? "Continue your canvas" : "Start your own"}</Link>
    </Button>
  );
}
```

- [ ] **Step 11: `app/arkademy/business-model-canvas/yours/page.tsx`**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cache, Suspense } from "react";

import { ArkademyBreadcrumb } from "@/components/arkademy/ArkademyBreadcrumb";
import { ARKADEMY_COLUMN, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { LibraryPlaceholder } from "@/components/arkademy/LibraryPlaceholder";
import { StrandedDraft } from "@/components/arkademy/StrandedDraft";
import { YourCanvas } from "@/components/arkademy/YourCanvas";
import { ARKADEMY_HEAD_START_MS, settledWithin } from "@/lib/arkademy/head-start";
import { indexArkademy } from "@/lib/arkademy/index-document";
import { inspirationCatalog } from "@/lib/arkademy/inspirations";
import { BMC_FALLBACK_TITLE, bmcYoursMetadata } from "@/lib/arkademy/metadata";
import { BMC_TOOL_ID } from "@/lib/arkademy/schema";
import { parseStepParam } from "@/lib/arkademy/tour";
import { ARKADEMY_PATH, ARKADEMY_TOOL_PATHS } from "@/lib/arkademy/tools";
import { getArkademy, type ArkademyLookup } from "@/lib/services/arkademy";
import { cn } from "@/lib/utils";

/**
 * `/arkademy/business-model-canvas/yours[?step=1..9]` — your own canvas: the
 * nine questions answered for the visitor's own product, with inspirations
 * from the library. The draft lives in this browser only, so the server sends
 * the questions and the inspirations and the client draws the rest. Never
 * indexed (bmcYoursMetadata).
 *
 * Like the cover, the page gives the library a head start
 * (ARKADEMY_HEAD_START_MS) and renders in place when it answers in time;
 * otherwise the breadcrumb, the h1 and the intro go out at once and the
 * editor (or the message) streams in behind Suspense. One h1 in every state.
 */
export const dynamic = "force-dynamic";

/** One library read per request: generateMetadata and the page share it. */
const lookupArkademy = cache(getArkademy);

export async function generateMetadata(): Promise<Metadata> {
  const lookup = await lookupArkademy();
  return bmcYoursMetadata(lookup.status === "ready" ? lookup.document.tools[0] : null);
}

export default async function YourCanvasPage({ searchParams }: { searchParams: Promise<{ step?: string | string[] }> }) {
  const [{ step }, early] = await Promise.all([
    searchParams,
    settledWithin(lookupArkademy(), ARKADEMY_HEAD_START_MS),
  ]);
  const initialStep = parseStepParam(step);
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-6 pb-24")}>
      {early ? (
        <YoursFor lookup={early.value} initialStep={initialStep} />
      ) : (
        <Suspense fallback={<YoursHead toolTitle={BMC_FALLBACK_TITLE} after={<LibraryPlaceholder />} />}>
          <Yours initialStep={initialStep} />
        </Suspense>
      )}
    </div>
  );
}

/** The breadcrumb, the h1 and the intro: the same with or without the library. */
function YoursHead({ toolTitle, after }: { toolTitle: string; after: ReactNode }) {
  const coverPath = ARKADEMY_TOOL_PATHS[BMC_TOOL_ID];
  return (
    <>
      <ArkademyBreadcrumb
        trail={[
          { label: "Arkademy", href: ARKADEMY_PATH },
          { label: toolTitle, href: coverPath },
          { label: "Your canvas" },
        ]}
      />
      <header className="mt-8 max-w-3xl sm:mt-10">
        <h1 className={ARKADEMY_TITLE}>Your canvas</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Answer the nine questions for your own product, one at a time. Each answer becomes a sentence of your
          paragraph and a line of your canvas. Everything stays in this browser.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Not sure how an answer reads?{" "}
          <Link href={`${coverPath}#examples`} className="text-foreground underline underline-offset-4">
            Read an example first
          </Link>
          .
        </p>
      </header>
      <div className="mt-10">{after}</div>
    </>
  );
}

/** The part of the page that waits for the library, when it is slow. */
async function Yours({ initialStep }: { initialStep: number | null }) {
  return <YoursFor lookup={await lookupArkademy()} initialStep={initialStep} />;
}

/** The editor for a ready library; otherwise the message, and the saved draft to download. */
function YoursFor({ lookup, initialStep }: { lookup: ArkademyLookup; initialStep: number | null }) {
  if (lookup.status !== "ready") {
    return (
      <YoursHead
        toolTitle={BMC_FALLBACK_TITLE}
        after={
          <>
            <ArkademyMessage status={lookup.status} />
            <StrandedDraft />
          </>
        }
      />
    );
  }
  const tool = lookup.document.tools[0];
  return (
    <YoursHead
      toolTitle={tool.title}
      after={
        <YourCanvas
          tool={{ title: tool.title, questions: tool.questions }}
          catalog={inspirationCatalog(indexArkademy(lookup.document))}
          documentVersion={lookup.version}
          initialStep={initialStep}
        />
      }
    />
  );
}
```

- [ ] **Step 12: Run the suite, type-check, lint**

```bash
node tests/app/arkademy-canvas.test.js | grep -c '^PASS'
node tests/app/arkademy-canvas.test.js | tail -1
rm -rf .next
npx tsc --noEmit
npm run lint 2>&1 | grep problems
npm run test:keyboard-shortcuts | tail -1
```

Expected: `154` (147 when first committed, before `adf4f62e`); `All arkademy-canvas tests passed.`; `tsc` silent; `✖ 3 problems (0 errors, 3 warnings)`; `All keyboard shortcut tests passed`.

- [ ] **Step 13: Commit**

```bash
git add components/arkademy/QuestionSteps.tsx components/arkademy/QuestionEditor.tsx components/arkademy/InspirationList.tsx components/arkademy/StartOverDialog.tsx components/arkademy/CanvasToolbar.tsx components/arkademy/YourCanvas.tsx components/arkademy/StrandedDraft.tsx components/arkademy/StartYourOwnButton.tsx app/arkademy/business-model-canvas/yours/page.tsx tests/app/arkademy-canvas.test.js
git commit -m "feat(arkademy): your own canvas — one question at a time, inspirations, the paragraph and the canvas building as you type"
```

---

### Task 8: "Start your own" on the cover and at the end of every tour

**Files:**
- Modify: `tests/app/arkademy-tour.test.js` (part 3's suite: one check inverted, one added)
- Modify: `app/arkademy/business-model-canvas/page.tsx`, `app/arkademy/business-model-canvas/tour/[example]/page.tsx`

Part 3 left both places ready: `CoverHead`'s `actions` row and `CanvasWalk`'s `endActions`. Neither part 3 component changes.

- [ ] **Step 1: Invert part 3's check first**

In `tests/app/arkademy-tour.test.js`, replace the line

```js
  check("cover: no link to your own canvas yet (part 4)", !cover.includes("BMC_YOURS_PATH"));
```

with

```js
  // Inverted by part 4: the cover's actions row now leads with your own canvas.
  check(
    "cover: Start your own leads the hero's actions, before Play a tour (part 4)",
    /actions=\{\s*<>\s*<StartYourOwnButton \/>[\s\S]*Play a tour/.test(cover),
  );
  const tourPage = fs.readFileSync(path.join(ROOT, "app", "arkademy", "business-model-canvas", "tour", "[example]", "page.tsx"), "utf8");
  check("tour: the end card offers your own canvas (part 4)", tourPage.includes("endActions={<StartYourOwnButton />}"));
```

```bash
npm run test:arkademy-tour 2>&1 | grep -E "^FAIL|failed"
```

Expected:

```
FAIL: cover: Start your own leads the hero's actions, before Play a tour (part 4)
FAIL: tour: the end card offers your own canvas (part 4)
2 arkademy-tour test(s) failed
```

- [ ] **Step 2: The cover**

In `app/arkademy/business-model-canvas/page.tsx`, after `import { PromptBlock } from "@/components/arkademy/PromptBlock";`, add `import { StartYourOwnButton } from "@/components/arkademy/StartYourOwnButton";`. In `CoverFor`'s ready branch, replace

```tsx
      actions={
        <Button asChild variant="outline">
          <a href="#examples">
            <CirclePlayIcon aria-hidden="true" />
            Play a tour
          </a>
        </Button>
      }
```

with

```tsx
      actions={
        <>
          <StartYourOwnButton />
          <Button asChild variant="outline">
            <a href="#examples">
              <CirclePlayIcon aria-hidden="true" />
              Play a tour
            </a>
          </Button>
        </>
      }
```

- [ ] **Step 3: The tour's end card**

In `app/arkademy/business-model-canvas/tour/[example]/page.tsx`, after `import { CanvasWalk } from "@/components/arkademy/CanvasWalk";`, add `import { StartYourOwnButton } from "@/components/arkademy/StartYourOwnButton";`. In `TourBody`'s `<CanvasWalk …>`, after `examplesHref={`${COVER_PATH}#examples`}`, add the prop `endActions={<StartYourOwnButton />}`.

- [ ] **Step 4: Check and commit**

```bash
npm run test:arkademy-tour | tail -1
npm run test:arkademy-canvas | tail -1
npm run test:arkademy-paragraph | tail -1
npx tsc --noEmit
npm run lint 2>&1 | grep problems
git add app/arkademy/business-model-canvas/page.tsx "app/arkademy/business-model-canvas/tour/[example]/page.tsx" components/arkademy/StartYourOwnButton.tsx tests/app/arkademy-tour.test.js
git commit   # "feat(arkademy): Start your own on the cover and at the end of every tour", saying the tour check is inverted
```

Expected: the three suites pass; `tsc` silent; 0 errors. (The committed `StartYourOwnButton.tsx` lost a `variant` prop in this commit, and its default size became `default`; the file in Task 7 shows its final form.)

---

### Task 9: The folder map

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: The route**

In "App Router Structure", immediately before the line `  api/` that follows the `arkademy/` block (`:71` at part 2's tip; after part 3's `tour/` lines if any), insert:

```text
      yours/
        page.tsx        # Your own canvas (?step=1..9): the nine questions for your product, saved in this browser only; noindex
```

- [ ] **Step 2: The components**

In "Component Map", immediately before the line `  publik/                   # PublishDialog, ImportSnapshotButton` (`:192` at part 2's tip; the line that closes the `arkademy/` block, after part 3's lines if any), insert:

```text
    YourCanvas.tsx          # Your own canvas's screen: name, steps, question editor, inspirations, paragraph, canvas (useCanvasDraft)
    QuestionSteps.tsx       # The nine questions as numbered buttons: answered, left open, not answered yet
    QuestionEditor.tsx      # The current question in edit mode: answers (reword, reorder, remove), add, open on purpose
    InspirationList.tsx     # The library's entities for the current question, most shared first; one click adds one
    CanvasToolbar.tsx       # Copy the paragraph, Copy as Markdown, Download JSON, Start over
    StartOverDialog.tsx     # Start over and its destructive confirmation (the button is the dialog's trigger)
    StartYourOwnButton.tsx  # The cover's "Start your own" / "Continue your canvas"
    StrandedDraft.tsx       # Your own canvas without a library: download the saved draft as it is
```

- [ ] **Step 2b: Check that the docs suite still passes**

```bash
npm run test:docs-visibility | tail -1
```

Expected: `All docs-visibility tests passed`.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(arkademy): your own canvas in the folder map"
```

---

### Task 10: An inspiration that starts with a name keeps its capital

**Files:**
- Modify: `lib/arkademy/inspirations.ts`, `lib/arkademy/canvas.ts`, `components/arkademy/YourCanvas.tsx`, `tests/app/arkademy-canvas.test.js`

Found with the real library (§ "As built"). The tests and code shown in Tasks 2, 3 and 7 already hold this commit's changes:
- the `inspirationAnswer` checks, `item.answer`, and the catalog's key list `entity,label,answer,companies`;
- `addInspiration` with `text`;
- `YourCanvas` passing `text: item.answer`.

As committed:

- [ ] **Step 1:** The test changes went in first: the `inspirationAnswer` cases, a catalog answer for an invented name ("Brine & Sons for salt", whose wording "Brine & Sons, who sell the salt" capitalises it), and the reducer's actions carrying `text`. `node tests/app/arkademy-canvas.test.js` then printed `FAIL: catalog: an inspiration carries no note` and `TypeError: inspirationAnswer is not a function`.
- [ ] **Step 2:** `inspirations.ts` gained `bareWord`, `inspirationAnswer` and the catalog's `answer`; `availableInspirations` also compares answers; `canvas.ts` dropped its import of `answerFromLabel`; `YourCanvas` passes `text: item.answer`.
- [ ] **Step 3:** `154` PASS, `tsc` silent, lint 0 errors; commit `fix(arkademy): an inspiration that starts with a name keeps its capital`.

---

### Task 11: The whole part, as CI sees it, and the visual check

No new files. The scripts below live in your scratchpad, never in the repository. Never put source files or scripts in `arkademy-content/` either: TypeScript and eslint pick them up.

- [ ] **Step 1: The build job's gates**

```bash
rm -rf .next
actionlint
npm run lint 2>&1 | grep problems
npx tsc --noEmit
env -u DATABASE_URL npm run build 2>&1 | grep -E 'arkademy|Compiled'
npm run generate > /dev/null && git status --porcelain
npm run test:arkademy-canvas | tail -1
npm run test:arkademy-paragraph | tail -1
npm run test:arkademy-schema | tail -1
npm run test:keyboard-shortcuts | tail -1
npm run test:landing | tail -1
npm run test:docs-visibility | tail -1
```

Expected:
- `actionlint` silent;
- `✖ 3 problems (0 errors, 3 warnings)`;
- `tsc` silent;
- `✓ Compiled successfully` and the Arkademy routes, all `ƒ`, now including `ƒ /arkademy/business-model-canvas/yours` (and part 3's tour);
- `git status --porcelain` prints nothing;
- `All arkademy-canvas tests passed.`, `All arkademy-paragraph tests passed.`, `All arkademy-schema tests passed.`, `All keyboard shortcut tests passed`, `All landing tests passed.`, `All docs-visibility tests passed`.

With part 3 present, also `npm run test:arkademy-tour | tail -1`, which must pass. If a Node 20 binary is available, run `<node20> tests/app/arkademy-canvas.test.js | tail -1`: the same last line.

- [ ] **Step 2: The services job's gate**

With the scratch Postgres of § "Local Postgres and a dev server" up and migrated:

```bash
npm run test:arkademy-api | tail -1
npm run --silent arkademy -- publish tests/fixtures/arkademy/document.json > "$PGSCRATCH.publish.log" 2>&1; grep published "$PGSCRATCH.publish.log"
```

Expected: `All arkademy-api integration tests passed.` (it truncates the table), then `published v1 (10.1 KB, 1 warning)`.

- [ ] **Step 3: The dev server**

```bash
rm -rf .next
PORT=5847 npm run dev
```

Run it in the background, with `DATABASE_URL` set to the scratch database. Then:

```bash
for i in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code}' http://localhost:5847/arkademy/business-model-canvas/yours | grep -q 200 && break; sleep 2; done
curl -s http://localhost:5847/arkademy/business-model-canvas/yours | grep -o 'Loading your canvas\|noindex\|Your canvas</h1>' | sort -u
curl -s http://localhost:5847/arkademy/business-model-canvas | grep -o 'Start your own' | head -1
```

Expected: `Loading your canvas`, `Your canvas</h1>`, `noindex` (the server sends the skeleton, never a draft); then `Start your own`.

- [ ] **Step 4: Screenshots of the empty, a half-filled and a full canvas**

Use the Playwright install outside the repo; reuse one in your scratchpad, or `npm install playwright && npx playwright install chromium` in a scratchpad folder. Save these files in the scratchpad.

`shots.js`:

```js
// node shots.js <base> <outdir> <tag> <path> [draftJsonFile]   (PW=<folder holding node_modules/playwright>)
const fs = require("fs");
const { chromium } = require(process.env.PW + "/node_modules/playwright");
const [base, out, tag, p, draftFile] = process.argv.slice(2);
const stored = draftFile ? fs.readFileSync(draftFile, "utf8") : null;
(async () => {
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    for (const width of [400, 900, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
      if (stored) await ctx.addInitScript((v) => { try { localStorage.setItem("arkaik:arkademy:bmc", v); } catch {} }, stored);
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + p, { waitUntil: "networkidle" });
      await page.waitForSelector("#canvas-question-title, [role=status]");
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({
        hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        h1: document.querySelectorAll("h1").length,
        title: document.title,
        robots: document.querySelector("meta[name=robots]")?.content,
      }));
      const name = `${tag}-${width}-${scheme}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: true });
      console.log(name, JSON.stringify({ ...m, errors }));
      await ctx.close();
    }
  }
  await browser.close();
})();
```

`draft-half.json`:

```json
{"v":1,"draft":{"name":"Tidy Harbour","answers":[{"id":"a1","question":"seg","text":"people who fish from the shore"},{"id":"a2","question":"seg","text":"harbour masters who post the daily notices"},{"id":"a3","question":"vp","text":"tide times that work without signal, even at the end of the pier"},{"id":"a4","question":"ch","text":"word of mouth","inspiration":{"entity":"word-of-mouth","documentVersion":1}}],"open":["rev"],"updatedAt":"2026-11-12T10:00:00.000Z"}}
```

`draft-full.json` (a draft written by the keyboard run in Step 5; this is what it stored):

```json
{"v":1,"draft":{"name":"Tidy Harbour","answers":[{"id":"a1","question":"seg","text":"people who fish from the shore"},{"id":"a2","question":"seg","text":"harbour masters"},{"id":"a3","question":"vp","text":"tide times that work without signal"},{"id":"a4","question":"ch","text":"anglers swapping tips on the pier","inspiration":{"entity":"word-of-mouth","documentVersion":1}},{"id":"a5","question":"cr","text":"a help page inside the app"},{"id":"a6","question":"kr","text":"public tide data"},{"id":"a7","question":"ka","text":"updating the tables every season"},{"id":"a8","question":"ka","text":"answering emails"},{"id":"a9","question":"ka","text":"checking the harbours"},{"id":"a10","question":"ka","text":"fixing the clock"},{"id":"a11","question":"ka","text":"watching the moon"},{"id":"a12","question":"kp","text":"harbour offices that share local data"},{"id":"a13","question":"cost","text":"developer fees for the app stores"},{"id":"a14","question":"cost","text":"a server"}],"open":["rev"],"updatedAt":"2026-11-12T18:34:40.139Z"}}
```

```bash
PW=<playwright folder> node shots.js http://localhost:5847 <shots folder> empty /arkademy/business-model-canvas/yours
PW=<playwright folder> node shots.js http://localhost:5847 <shots folder> half "/arkademy/business-model-canvas/yours?step=3" draft-half.json
PW=<playwright folder> node shots.js http://localhost:5847 <shots folder> full "/arkademy/business-model-canvas/yours?step=7" draft-full.json
```

Expected, for each of the eighteen lines: `"hscroll":false`, `"h1":1`, `"title":"Your Business Model Canvas | arkaik Arkademy"`, `"robots":"noindex, nofollow"`, `"errors":[]`.

Open and read the screenshots. What they must show (as in the rehearsal):
- **empty, 1440:**
  - the breadcrumb "Arkademy › Business Model Canvas › Your canvas" and the handwritten `h1`;
  - the intro and "Read an example first";
  - the name field with the placeholder "This product" and "It opens your paragraph. Saved in this browser only.";
  - nine plain round steps, the first ringed, and "0 OF 9 ANSWERED" at the right;
  - the card "QUESTION 1 OF 9 · CUSTOMER SEGMENTS", "Who is this for?", its hint, the add field with Add, the help line, the "Leave this open on purpose" box, and "IN YOUR PARAGRAPH: This product is for ___." with a dashed blank;
  - Back disabled, then "Next question";
  - the Inspirations column: the three segment labels, each with its company;
  - "Your paragraph" with nine solid "open: …" chips and the four toolbar buttons disabled;
  - "The canvas" in the canonical arrangement, every block "Not answered yet.", Customer segments ringed.
- **empty, 400:** the same in one column; the steps in one row; "Stuck? 3 inspirations" under the card; the canvas one block per row.
- **half:**
  - steps 1–2 filled and 3 filled with its ring, 5 dashed;
  - "3 OF 9 ANSWERED · 1 LEFT OPEN";
  - question 3 with "word of mouth" and its ↑ ↓ × (↑ and ↓ disabled);
  - only "app stores" left in the inspirations;
  - the paragraph with "It reaches them through word of mouth." underlined and the dashed "left open on purpose: where the money comes from" pill with its dashed-circle icon;
  - the Channels block ringed and the Revenue streams block dashed.
- **full (step 7):**
  - five answers, the add field disabled, "Five answers is the most a question takes.", and no "Leave this open" box;
  - at 400 each answer's buttons under its field;
  - the paragraph card ending "Every question is answered or left open on purpose. Paste your paragraph into the baseline prompt, or download the canvas to keep it."
- **dark:** the same on the dark tokens; answered steps light on dark.

- [ ] **Step 5: Use the page for real**

`interact.js`, in the scratchpad (it writes `draft-full.json`, `download.json` and `copied.md` into the folder you give it):

```js
// node interact.js <base> <workdir>   (PW=<folder holding node_modules/playwright>)
// Uses your own canvas for real: a whole canvas by keyboard only, inspirations,
// open on purpose and undo, reorder and remove, the three exports, a reload,
// a corrupt and a newer stored value, blocked storage, and Start over.
const fs = require("fs");
const { chromium } = require(process.env.PW + "/node_modules/playwright");
const [base, work] = process.argv.slice(2);
const URL_ = base + "/arkademy/business-model-canvas/yours";
const KEY = "arkaik:arkademy:bmc";
const errors = [];
function watch(page) {
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning" || /hydrat/i.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
}
const log = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const active = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName);
const paragraph = (page) => page.locator("#canvas-paragraph-title").locator("xpath=../..").locator("p").nth(1).innerText();
async function typeAndEnter(page, text) { await page.keyboard.type(text); await page.keyboard.press("Enter"); }
async function tabTo(page, test, max = 40) {
  for (let i = 0; i < max; i++) { await page.keyboard.press("Tab"); if (test(await active(page))) return i + 1; }
  throw new Error("never reached");
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForSelector("#canvas-question-title");

  // --- a whole canvas by keyboard only ---
  log("tabs to the name field", await tabTo(page, (id) => id === "canvas-name"));
  await typeAndEnter(page, "Tidy Harbour");
  log("after Enter in the name", await active(page));
  await typeAndEnter(page, "people who fish from the shore");
  await typeAndEnter(page, "harbour masters");
  await typeAndEnter(page, "Harbour Masters");
  log("duplicate help", await page.locator("#canvas-add-help").innerText());
  await page.keyboard.press("Control+A"); await page.keyboard.press("Meta+A"); await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  log("after Enter on empty: url, focus", [page.url().replace(base, ""), await active(page)]);
  await typeAndEnter(page, "tide times that work without signal");
  await page.keyboard.press("Enter");
  // q3: an inspiration from the keyboard, then reword it
  log("tabs to the first inspiration", await tabTo(page, (id) => /^Add “/.test(id)));
  log("inspiration focused", await active(page));
  await page.keyboard.press("Enter");
  log("after the inspiration: focus, answer", [await active(page), await page.locator("ol[aria-label='Your answers'] textarea").first().inputValue()]);
  log("live region", await page.locator("p[aria-live=polite]").innerText());
  // Back past Remove; both move buttons are disabled with one answer, so Tab skips them.
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab");
  log("back on the answer", await active(page));
  await page.keyboard.press("Meta+A"); await page.keyboard.type("anglers swapping tips on the pier");
  await page.keyboard.press("Enter");
  log("Enter in an answer goes to", await active(page));
  await page.keyboard.press("Enter");
  await typeAndEnter(page, "a help page inside the app");
  await page.keyboard.press("Enter");
  // q5: leave it open on purpose, undo, leave it open again
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  log("on the checkbox", await active(page));
  await page.keyboard.press("Space");
  log("open: preview", await page.getByText("In your paragraph").locator("xpath=..").innerText());
  await page.keyboard.press("Space");
  log("undone: preview", await page.getByText("In your paragraph").locator("xpath=..").innerText());
  await page.keyboard.press("Space");
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  log("q6 at", page.url().replace(base, ""));
  await typeAndEnter(page, "public tide data");
  await page.keyboard.press("Enter");
  for (const t of ["updating the tables every season", "answering emails", "checking the harbours", "fixing the clock", "watching the moon"]) await typeAndEnter(page, t);
  log("five answers: focus, help, add disabled", [await active(page), await page.locator("#canvas-add-help").innerText(), await page.locator("#canvas-add-answer").isDisabled()]);
  await page.keyboard.press("Enter");
  log("q8 at", [page.url().replace(base, ""), await active(page)]);
  await typeAndEnter(page, "harbour offices that share local data");
  await page.keyboard.press("Enter");
  await typeAndEnter(page, "developer fees for the app stores");
  await typeAndEnter(page, "a server");
  await page.keyboard.press("Enter");
  log("after the ninth: focus", await active(page));
  log("progress", await page.locator("text=/of 9 answered/").innerText());
  log("paragraph", await paragraph(page));
  await page.waitForTimeout(400);
  fs.writeFileSync(`${work}/draft-full.json`, await page.evaluate((k) => localStorage.getItem(k), KEY));

  // --- reorder and remove, by pointer, from the canvas grid ---
  await page.getByRole("button", { name: "Key activities", exact: true }).click();
  log("grid click: url, focus", [page.url().replace(base, ""), await active(page)]);
  await page.getByRole("button", { name: "Move answer 3 up" }).click();
  log("moved: focus", await active(page));
  const fields = page.locator("ol[aria-label='Your answers'] textarea");
  await fields.nth(0).focus(); await page.keyboard.press("Alt+ArrowDown");
  log("alt-down: order", await fields.evaluateAll((els) => els.map((e) => e.value)));
  await page.getByRole("button", { name: "Remove answer 5" }).click();
  log("removed: count, focus", [await fields.count(), await active(page)]);
  await fields.nth(0).fill("");
  await page.locator("#canvas-question-title").click();
  log("emptied then blurred: count", await fields.count());

  // --- typing in the middle of an answer keeps the caret ---
  await fields.nth(0).click(); await fields.nth(0).evaluate((el) => el.setSelectionRange(0, 0)); await page.keyboard.type("so ");
  log("caret kept", await fields.nth(0).inputValue());
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  log("caret kept after deleting", await fields.nth(0).inputValue());

  // --- a gap in the paragraph goes to its question ---
  await page.getByRole("button", { name: "Key resources", exact: true }).click();
  await page.getByRole("button", { name: "Remove answer 1" }).click();
  await page.locator("button:has-text('open: what it needs')").click();
  log("gap click: url", page.url().replace(base, ""));
  await page.locator("#canvas-add-answer").fill("public tide data"); await page.keyboard.press("Enter");

  // --- exports ---
  await page.getByRole("button", { name: "Copy the paragraph" }).click(); await page.waitForTimeout(200);
  log("clipboard paragraph", await page.evaluate(() => navigator.clipboard.readText()));
  await page.getByRole("button", { name: "Copy as Markdown" }).click(); await page.waitForTimeout(200);
  fs.writeFileSync(`${work}/copied.md`, await page.evaluate(() => navigator.clipboard.readText()));
  log("clipboard markdown head", (await page.evaluate(() => navigator.clipboard.readText())).split("\n").slice(0, 8));
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download JSON" }).click()]);
  await download.saveAs(`${work}/download.json`);
  const exported = JSON.parse(fs.readFileSync(`${work}/download.json`, "utf8"));
  log("download", [download.suggestedFilename(), exported.format, exported.documentVersion, exported.questions.map((q) => q.state).join(",")]);
  log("download ch", exported.questions[2]);
  log("toast", await page.locator("[data-sonner-toast]").last().innerText());

  // --- reload: the draft is there ---
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#canvas-question-title");
  log("reloaded: url, name, step heading", [page.url().replace(base, ""), await page.locator("#canvas-name").inputValue(), await page.locator("#canvas-question-title").innerText()]);
  await page.goto(URL_, { waitUntil: "networkidle" }); await page.waitForSelector("#canvas-question-title");
  log("no step: lands on", await page.locator("#canvas-question-title").innerText());

  // --- the cover knows ---
  await page.goto(base + "/arkademy/business-model-canvas", { waitUntil: "networkidle" });
  log("cover action", await page.locator("a[href='/arkademy/business-model-canvas/yours']").innerText());
  await page.locator("a[href='/arkademy/business-model-canvas/yours']").click();
  await page.waitForSelector("#canvas-question-title");
  log("client navigation: name", await page.locator("#canvas-name").inputValue());

  // --- corrupt stored value ---
  await page.goto(base + "/arkademy/business-model-canvas", { waitUntil: "networkidle" });
  await page.evaluate((k) => localStorage.setItem(k, "{oops"), KEY);
  await page.goto(URL_, { waitUntil: "networkidle" }); await page.waitForSelector("#canvas-question-title");
  log("corrupt: notice", await page.getByText("could not be read").innerText());
  log("corrupt: kept aside", await page.evaluate(() => localStorage.getItem("arkaik:arkademy:bmc:unreadable")));
  log("corrupt: name empty", await page.locator("#canvas-name").inputValue());
  const [old] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download the old text" }).click()]);
  log("old text download", [old.suggestedFilename(), fs.readFileSync(await old.path(), "utf8")]);
  await page.getByRole("button", { name: "Dismiss" }).click();
  log("dismissed", await page.getByText("could not be read").count());

  // --- newer stored value ---
  await page.goto(base + "/arkademy/business-model-canvas", { waitUntil: "networkidle" });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({ v: 2, draft: { name: "From the future", answers: [] } })]);
  await page.reload({ waitUntil: "networkidle" });
  log("newer: cover action", await page.locator("a[href='/arkademy/business-model-canvas/yours']").innerText());
  await page.goto(URL_, { waitUntil: "networkidle" }); await page.waitForSelector("#canvas-question-title");
  log("newer: notice, name", [await page.getByText("A newer version").innerText(), await page.locator("#canvas-name").inputValue()]);
  await page.locator("#canvas-name").fill("Changed here"); await page.waitForTimeout(500);
  log("newer: not saved over", await page.evaluate((k) => localStorage.getItem(k), KEY));

  // --- start over ---
  await page.goto(base + "/arkademy/business-model-canvas", { waitUntil: "networkidle" });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, require_draft()]);
  await page.goto(URL_, { waitUntil: "networkidle" }); await page.waitForSelector("#canvas-question-title");
  await page.getByRole("button", { name: "Start over" }).click();
  log("dialog", await page.getByRole("dialog").innerText());
  log("dialog focus", await page.evaluate(() => document.activeElement.tagName + " " + document.activeElement.textContent.slice(0, 40)));
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  log("cancelled: focus back on", await page.evaluate(() => document.activeElement.tagName + " " + document.activeElement.textContent.slice(0, 40)));
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start over" }).click();
  await page.waitForTimeout(500);
  log("after start over: stored, name, paragraph, focus", [await page.evaluate((k) => localStorage.getItem(k), KEY), await page.locator("#canvas-name").inputValue(), await paragraph(page), await active(page)]);
  await page.goto(base + "/arkademy/business-model-canvas", { waitUntil: "networkidle" });
  log("cover action after start over", await page.locator("a[href='/arkademy/business-model-canvas/yours']").innerText());

  // --- blocked storage ---
  const blocked = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blocked.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } }); });
  const bp = await blocked.newPage(); watch(bp);
  await bp.goto(URL_, { waitUntil: "networkidle" }); await bp.waitForSelector("#canvas-question-title");
  log("blocked: notice", await bp.getByText("not saving your canvas").innerText());
  await bp.locator("#canvas-name").fill("Kept in memory");
  log("blocked: still works", await paragraph(bp).catch(() => "?"));
  await bp.goto(base + "/arkademy/business-model-canvas", { waitUntil: "networkidle" });
  log("blocked: cover action", await bp.locator("a[href='/arkademy/business-model-canvas/yours']").innerText());
  await blocked.close();

  log("console errors and warnings", errors);
  await browser.close();
  function require_draft() { return fs.readFileSync(`${work}/draft-full.json`, "utf8"); }
})();
```

```bash
PW=<playwright folder> node interact.js http://localhost:5847 <scratch folder>
```

Expected, exactly (long lines as printed):

```text
tabs to the name field: 7
after Enter in the name: canvas-add-answer
duplicate help: That answer is already here.
after Enter on empty: url, focus: ["/arkademy/business-model-canvas/yours?step=2","canvas-add-answer"]
tabs to the first inspiration: 5
inspiration focused: Add “word of mouth”, used by Crumb & Co, Tidewise and Inkwell
after the inspiration: focus, answer: ["canvas-add-answer","word of mouth"]
live region: Added: word of mouth
back on the answer: canvas-answer-a4
Enter in an answer goes to: canvas-add-answer
on the checkbox: canvas-open
open: preview: IN YOUR PARAGRAPH

left open on purpose: where the money comes from
undone: preview: IN YOUR PARAGRAPH

On money: 
your answer
.
q6 at: /arkademy/business-model-canvas/yours?step=6
five answers: focus, help, add disabled: ["canvas-next","Five answers is the most a question takes.",true]
q8 at: ["/arkademy/business-model-canvas/yours?step=8","canvas-add-answer"]
after the ninth: focus: canvas-paragraph-title
progress: 8 OF 9 ANSWERED · 1 LEFT OPEN
paragraph: Tidy Harbour is for people who fish from the shore and harbour masters. It offers tide times that work without signal. It reaches them through anglers swapping tips on the pier. It keeps them with a help page inside the app. left open on purpose: where the money comes from It relies on public tide data. It spends its days on updating the tables every season, answering emails, checking the harbours, fixing the clock and watching the moon. Its partners are harbour offices that share local data. The main costs are developer fees for the app stores and a server.
grid click: url, focus: ["/arkademy/business-model-canvas/yours?step=7","canvas-question-title"]
moved: focus: canvas-answer-a9-up
alt-down: order: ["checking the harbours","updating the tables every season","answering emails","fixing the clock","watching the moon"]
removed: count, focus: [4,"canvas-answer-a10"]
emptied then blurred: count: 3
caret kept: so updating the tables every season
caret kept after deleting: updating the tables every season
gap click: url: /arkademy/business-model-canvas/yours?step=6
clipboard paragraph: Tidy Harbour is for people who fish from the shore and harbour masters. It offers tide times that work without signal. It reaches them through anglers swapping tips on the pier. It keeps them with a help page inside the app. It relies on public tide data. It spends its days on updating the tables every season, answering emails and fixing the clock. Its partners are harbour offices that share local data. The main costs are developer fees for the app stores and a server.
clipboard markdown head: ["# Tidy Harbour: Business Model Canvas","","Tidy Harbour is for people who fish from the shore and harbour masters. It offers tide times that work without signal. It reaches them through anglers swapping tips on the pier. It keeps them with a help page inside the app. It relies on public tide data. It spends its days on updating the tables every season, answering emails and fixing the clock. Its partners are harbour offices that share local data. The main costs are developer fees for the app stores and a server.","","## Customer segments","","- people who fish from the shore","- harbour masters"]
download: ["tidy-harbour-business-model-canvas.json","arkaik.arkademy.canvas",1,"answered,answered,answered,answered,open,answered,answered,answered,answered"]
download ch: {"key":"ch","block":"Channels","prompt":"How do they find out about it, and how do they get it?","state":"answered","answers":[{"text":"anglers swapping tips on the pier","entity":"word-of-mouth"}]}
toast: Copied the paragraph
reloaded: url, name, step heading: ["/arkademy/business-model-canvas/yours?step=6","Tidy Harbour","What does it need to exist?"]
no step: lands on: Who is this for?
cover action: Continue your canvas
client navigation: name: Tidy Harbour
corrupt: notice: A canvas saved here earlier could not be read, so this one starts empty. Its text is kept aside in this browser.
corrupt: kept aside: {oops
corrupt: name empty: 
old text download: ["business-model-canvas-unreadable.txt","{oops"]
dismissed: 0
newer: cover action: Continue your canvas
newer: notice, name: ["A newer version of this page saved your canvas. Reload to keep working on it; changes made here are not saved.","From the future"]
newer: not saved over: {"v":2,"draft":{"name":"From the future","answers":[]}}
dialog: Start over?

Your product's name and every answer leave this browser. Download JSON first if you want to keep a copy.

Cancel
Start over
Close
dialog focus: BUTTON Cancel
cancelled: focus back on: BUTTON Start over
after start over: stored, name, paragraph, focus: [null,"","open: who it is for open: what it does for them open: how they find it open: how they stay open: where the money comes from open: what it needs open: what it keeps doing open: who it relies on open: what it costs","canvas-name"]
cover action after start over: Start your own
blocked: notice: This browser is not saving your canvas: its storage is off or full. Download JSON before you leave to keep a copy.
blocked: still works: open: who it is for open: what it does for them open: how they find it open: how they stay open: where the money comes from open: what it needs open: what it keeps doing open: who it relies on open: what it costs
blocked: cover action: Start your own
console errors and warnings: []
```

- [ ] **Step 6: The paragraph and the canvas, linked**

`link-check.js`:

```js
// Hover a block, then a sentence: the CanvasLink tint and outline, beside the current sentence's underline.
const fs = require("fs");
const { chromium } = require(process.env.PW + "/node_modules/playwright");
const [base, out, draftFile] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript((v) => localStorage.setItem("arkaik:arkademy:bmc", v), fs.readFileSync(draftFile, "utf8"));
  const page = await ctx.newPage();
  await page.goto(base + "/arkademy/business-model-canvas/yours?step=3", { waitUntil: "networkidle" });
  await page.waitForSelector("#canvas-question-title");
  const look = () => page.evaluate(() => {
    const s = (q) => document.querySelector(`[data-canvas-link] [data-kind=sentence][data-question=${q}]`);
    const b = (q) => document.querySelector(`[data-block][data-question=${q}]`);
    return {
      segBg: getComputedStyle(s("seg")).backgroundColor,
      segBlockOutline: getComputedStyle(b("seg")).outlineStyle,
      chUnderline: getComputedStyle(s("ch")).textDecorationLine,
      chBg: getComputedStyle(s("ch")).backgroundColor,
      chBlockOutline: getComputedStyle(b("ch")).outlineStyle,
    };
  });
  console.log("at rest", JSON.stringify(await look()));
  await page.locator("[data-block][data-question=seg]").hover();
  await page.waitForTimeout(200);
  console.log("hover seg block", JSON.stringify(await look()));
  await page.locator("[data-canvas-link] [data-kind=sentence][data-question=ch]").hover();
  await page.waitForTimeout(200);
  console.log("hover current sentence", JSON.stringify(await look()));
  await page.locator("[data-canvas-link] [data-kind=sentence][data-question=ch]").locator("xpath=ancestor::div[@data-slot='card']").screenshot({ path: `${out}/link-hover-current-1440-light.png` });
  await browser.close();
})();
```

```bash
PW=<playwright folder> node link-check.js http://localhost:5847 <shots folder> draft-half.json
```

Expected:

```
at rest {"segBg":"rgba(0, 0, 0, 0)","segBlockOutline":"none","chUnderline":"underline","chBg":"rgba(0, 0, 0, 0)","chBlockOutline":"none"}
hover seg block {"segBg":"rgb(244, 244, 245)","segBlockOutline":"solid","chUnderline":"underline","chBg":"rgba(0, 0, 0, 0)","chBlockOutline":"none"}
hover current sentence {"segBg":"rgba(0, 0, 0, 0)","segBlockOutline":"none","chUnderline":"underline","chBg":"rgb(244, 244, 245)","chBlockOutline":"none"}
```

(Hovering a block tints its sentence and outlines the block; the current sentence keeps its underline when tinted; the current block never takes the outline.)

- [ ] **Step 7: A larger fictional library**

`stress.js` builds a larger invented document from the fixture: eight more invented companies, about twenty entities per kind, a label of 125 characters, labels starting "GitHub", "AWS" and "A …". It is never real content.

```js
// Builds a larger fictional library from the test fixture: eight more invented
// companies and about twenty entities per kind, some labels near 140 characters.
const fs = require("fs");
const [src, out] = process.argv.slice(2);
const doc = JSON.parse(fs.readFileSync(src, "utf8"));
const tool = doc.tools[0];
const kinds = { seg: "segment", vp: "value-proposition", ch: "channel", cr: "relationship", rev: "revenue-stream", kr: "resource", ka: "activity", kp: "partner", cost: "cost" };
const words = ["harbour", "lantern", "pebble", "meadow", "copper", "willow", "orbit", "thistle", "cobalt", "saffron", "juniper", "quarry"];
const names = ["Lanternly", "Pebblework", "Meadowmail", "Copperpot", "Willow Desk", "Orbitry", "Thistle & Sons", "Cobalt Rooms"];
const long = "a weekly hand-written letter to every customer who has stayed for more than a year, delivered by bicycle in the old town only";
for (const [i, name] of names.entries()) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  doc.companies.push({ id, name, oneLiner: `An invented company number ${i + 1} for the stress test`, simulation: true });
  tool.examples.push(id);
}
const companyIds = tool.examples;
let n = 0;
for (const [q, kind] of Object.entries(kinds)) {
  for (let e = 0; e < 20; e++) {
    const id = `${q}-${words[e % words.length]}-${e}`;
    const label = e === 3 ? long.slice(0, 138) : `${words[e % words.length]} ${words[(e + 5) % words.length]} for ${q} number ${e}`;
    doc.entities.push({ id, kind, label: e === 0 ? `GitHub ${words[e]}` : e === 1 ? `AWS ${words[e]}` : e === 2 ? `A ${words[e]} that stays true` : label });
    // used by 1..min(8, 20-e) companies, so counts vary
    const users = companyIds.slice(3, 3 + ((e * 7) % 8) + 1);
    for (const company of users) {
      const existing = doc.uses.filter((u) => u.company === company && u.question === q);
      if (existing.length >= 5) continue;
      doc.uses.push({ tool: tool.id, company, question: q, entity: id, text: `their own wording ${++n}`, order: existing.length });
    }
  }
}
fs.writeFileSync(out, JSON.stringify(doc, null, 1));
```

`stress-shots.js`:

```js
const { chromium } = require(process.env.PW + "/node_modules/playwright");
const [base, out] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [width, scheme] of [[1440, "light"], [900, "dark"], [400, "light"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1100 }, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
    await page.goto(base + "/arkademy/business-model-canvas/yours?step=3", { waitUntil: "networkidle" });
    await page.waitForSelector("#canvas-question-title");
    if (width < 768) await page.getByRole("button", { name: /^Stuck\?/ }).click();
    const counts = await page.locator("#canvas-inspirations li").count();
    await page.getByRole("button", { name: /^Show all/ }).click();
    // add the long one, then reword it
    await page.locator("#canvas-inspirations button", { hasText: "hand-written" }).first().click();
    const answer = await page.locator("ol[aria-label='Your answers'] textarea").first().inputValue();
    const m = await page.evaluate(() => ({ hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth, listed: document.querySelectorAll("#canvas-inspirations li").length }));
    await page.screenshot({ path: `${out}/stress-${width}-${scheme}.png`, fullPage: true });
    console.log(width, scheme, JSON.stringify({ firstShown: counts, ...m, answerLength: answer.length, answer }));
    await ctx.close();
  }
  // two tabs converge on the last writer
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const a = await ctx.newPage(); const b = await ctx.newPage();
  for (const p of [a, b]) { await p.goto(base + "/arkademy/business-model-canvas/yours", { waitUntil: "networkidle" }); await p.waitForSelector("#canvas-name"); }
  await a.locator("#canvas-name").fill("Written in tab A"); await a.waitForTimeout(600);
  console.log("tab B sees", await b.locator("#canvas-name").inputValue());
  console.log("errors", JSON.stringify(errors));
  await browser.close();
})();
```

```bash
node stress.js tests/fixtures/arkademy/document.json <scratch folder>/stress.json
npm run --silent arkademy -- check <scratch folder>/stress.json 2>&1 | tail -1
npm run --silent arkademy -- publish <scratch folder>/stress.json > "$PGSCRATCH.publish.log" 2>&1; grep published "$PGSCRATCH.publish.log"
PW=<playwright folder> node stress-shots.js http://localhost:5847 <shots folder>
npm run --silent arkademy -- publish tests/fixtures/arkademy/document.json > "$PGSCRATCH.publish.log" 2>&1; grep published "$PGSCRATCH.publish.log"
```

Expected:
- `valid: … (72.0 KB; 11 examples, 210 entities, 375 uses, 100 warnings)` (the warnings are unused entities);
- `published v2 (72.0 KB, 100 warnings)`;
- three lines with `"firstShown":6`, `"hscroll":false`, `"listed":10`, `"answerLength":125`;
- `tab B sees Written in tab A`;
- `errors []`;
- `published v3 (10.1 KB, 1 warning)`.

Read the screenshots: "AWS lantern" first ("Lanternly, Pebblework and 6 more"), "A pebble that stays true" as a label, "Show fewer" under ten entries. The 125-character answer wraps in its field; at 400 px its buttons sit under it.

- [ ] **Step 8: The cover and the page without a library**

`cover-shots.js`:

```js
const fs = require("fs");
const { chromium } = require(process.env.PW + "/node_modules/playwright");
const [base, out, tag, p, draftFile] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  for (const [width, scheme, withDraft] of [[1440, "light", false], [400, "dark", true]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, colorScheme: scheme });
    if (withDraft) await ctx.addInitScript((v) => localStorage.setItem("arkaik:arkademy:bmc", v), fs.readFileSync(draftFile, "utf8"));
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
    await page.goto(base + p, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const action = await page.locator("a[href='/arkademy/business-model-canvas/yours']").allInnerTexts();
    await page.screenshot({ path: `${out}/${tag}-${width}-${scheme}.png` });
    console.log(tag, width, scheme, JSON.stringify({ action, h1: await page.locator("h1").count(), hscroll: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), errors }));
    await ctx.close();
  }
  await browser.close();
})();
```

```bash
PW=<playwright folder> node cover-shots.js http://localhost:5847 <shots folder> cover /arkademy/business-model-canvas draft-half.json
psql -q "$DATABASE_URL" -c "truncate arkademy_documents"
PW=<playwright folder> node cover-shots.js http://localhost:5847 <shots folder> nolibrary /arkademy/business-model-canvas/yours draft-half.json
curl -s http://localhost:5847/arkademy/business-model-canvas/yours | grep -o 'being stocked. Come back soon.' | head -1
npm run --silent arkademy -- publish tests/fixtures/arkademy/document.json > "$PGSCRATCH.publish.log" 2>&1; grep published "$PGSCRATCH.publish.log"
```

Expected:

```
cover 1440 light {"action":["Start your own"],"h1":1,"hscroll":false,"errors":[]}
cover 400 dark {"action":["Continue your canvas"],"h1":1,"hscroll":false,"errors":[]}
nolibrary 1440 light {"action":[],"h1":1,"hscroll":false,"errors":[]}
nolibrary 400 dark {"action":[],"h1":1,"hscroll":false,"errors":[]}
being stocked. Come back soon.
published v1 (10.1 KB, 1 warning)
```

Read `cover-1440-light.png`: the stone "Start your own" under the tagline. With part 3, "Play a tour" sits beside it, after it. Read `nolibrary-400-dark.png`: the dashed message, then "Your canvas is still saved in this browser. You can download it as it is." with "Download your saved canvas".

- [ ] **Step 8b: The tour's end card, and the real library**

`tour-end.js`:

```js
// The tour's last step, with and without a draft: the end card's actions, in order.
const fs = require("fs");
const { chromium } = require(process.env.PW + "/node_modules/playwright");
const [base, out, draftFile] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  for (const [tag, width, scheme, withDraft] of [["tour-end", 1440, "light", false], ["tour-end-draft", 400, "dark", true]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    if (withDraft) await ctx.addInitScript((v) => localStorage.setItem("arkaik:arkademy:bmc", v), fs.readFileSync(draftFile, "utf8"));
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/arkademy/business-model-canvas/tour/tidewise?step=9", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const card = page.getByText("End of the tour").locator("xpath=ancestor::*[.//a][1]");
    const actions = await card.locator("a").allInnerTexts();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${tag}-${width}-${scheme}.png` });
    console.log(tag, JSON.stringify({ actions, errors }));
    await ctx.close();
  }
  await browser.close();
})();
```

```bash
PW=<playwright folder> node tour-end.js http://localhost:5847 <shots folder> draft-half.json
```

Expected:

```
tour-end {"actions":["Start your own","Next example: Inkwell","All examples"],"errors":[]}
tour-end-draft {"actions":["Continue your canvas","Next example: Inkwell","All examples"],"errors":[]}
```

Optional, to judge the inspirations with real entities: publish the real library into the **scratch** database only (`npm run --silent arkademy -- publish arkademy-content/arkademy.json`). Then run `real-check.js` and republish the fixture before anything else.

```js
// The real library (scratch database only): key partners at 1440 and 400, every inspiration shown, one added.
const { chromium } = require(process.env.PW + "/node_modules/playwright");
const [base, out] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [width, scheme] of [[1440, "light"], [400, "dark"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/arkademy/business-model-canvas/yours?step=8", { waitUntil: "networkidle" });
    await page.waitForSelector("#canvas-question-title");
    if (width < 768) await page.getByRole("button", { name: /^Stuck\?/ }).click();
    await page.getByRole("button", { name: /^Show all/ }).click();
    await page.locator("#canvas-inspirations button", { hasText: "Apple App Store" }).click();
    await page.locator("#canvas-inspirations button", { hasText: "Third-party AI model providers" }).click();
    const answers = await page.locator("ol[aria-label='Your answers'] textarea").evaluateAll((els) => els.map((e) => e.value));
    const sentence = await page.locator("[data-canvas-link] [data-kind=sentence][data-question=kp]").innerText();
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await page.screenshot({ path: `${out}/real-kp-${width}-${scheme}.png`, fullPage: true });
    console.log(width, scheme, JSON.stringify({ answers, sentence, hscroll }));
    await ctx.close();
  }
  console.log("errors", JSON.stringify(errors));
  await browser.close();
})();
```

Expected (built run):

```
1440 light {"answers":["Apple App Store and Google Play","third-party AI model providers"],"sentence":"This product leans on Apple App Store and Google Play, and third-party AI model providers.","hscroll":false}
400 dark {"answers":["Apple App Store and Google Play","third-party AI model providers"],"sentence":"This product leans on Apple App Store and Google Play, and third-party AI model providers.","hscroll":false}
errors []
```

- [ ] **Step 9: Clean up**

```bash
lsof -nP -iTCP:5847 -sTCP:LISTEN     # note the PID; kill it and its parent `next dev --port 5847`
pg_ctl -D "$PGSCRATCH/data" stop
lsof -nP -iTCP:5847 -sTCP:LISTEN; lsof -nP -iTCP:6847 -sTCP:LISTEN
rm -rf .next
git status --porcelain
```

Expected: `server stopped`; both `lsof` print nothing; `git status --porcelain` prints nothing.

## Part done when

**After the review fixes** (`f259ff2a`, Node 26.7.0 | Node 20.19.5):

```
actionlint: clean
✖ 3 problems (0 errors, 3 warnings)
tsc: clean
arkademy-canvas: All arkademy-canvas tests passed. | node20: same                (221 PASS)
arkademy-draft-store: All arkademy-draft-store tests passed. | node20: same      (44 PASS)
arkademy-tour: All arkademy-tour tests passed. | node20: same                    (138 PASS)
arkademy-paragraph, arkademy-schema, keyboard-shortcuts, docs-visibility, landing: all passed | node20: same
arkademy-api: All arkademy-api integration tests passed. | node20: same          (scratch Postgres)
✓ Compiled successfully in 6.5s     # ƒ /arkademy/business-model-canvas/yours
generate: ok, git status --short prints nothing
```

**The browser run** (dev server; part 1's fixture, the larger fictional document, and in the scratch database the real library):
- Every Y by a concrete sequence, the live region read after each action. Highlights:
  - "Not added: bakers. is already an answer."
  - "Moved harbour masters to position 2 of 5."
  - "Removed the empty answer."
  - "Revenue streams left open on purpose."
- Two tabs typing 12 characters each at once: both tabs keep all 12 and converge.
- Y6 by dispatching an Enter with keyCode 229.
- Y14 by making `Storage.setItem` throw, then restoring it.
- Y1 with two unreadable values and the discard.
- The original keyboard run, the tour's end card, the cover and the hover link pass unchanged.
- At 400, 900 and 1440 px, light and dark: no sideways scroll and one `h1`.
- Zero console errors or warnings, and no hydration warning.

What follows is the first build's record.

Real results on `feat/arkademy-your-canvas` at `adf4f62e`, on top of parts 1–3 (Node 26.7.0 and Node 20.19.5):

```
actionlint: clean
✖ 3 problems (0 errors, 3 warnings)          # npm run lint: main's three img warnings
tsc: clean                                     # rm -rf .next && npx tsc --noEmit
arkademy-canvas: All arkademy-canvas tests passed. | node20: All arkademy-canvas tests passed.        # 154 PASS
arkademy-tour: All arkademy-tour tests passed. | node20: All arkademy-tour tests passed.              # 138 PASS
arkademy-paragraph: All arkademy-paragraph tests passed. | node20: All arkademy-paragraph tests passed.
arkademy-schema: All arkademy-schema tests passed. | node20: All arkademy-schema tests passed.
keyboard-shortcuts: All keyboard shortcut tests passed | node20: All keyboard shortcut tests passed
docs-visibility: All docs-visibility tests passed | node20: All docs-visibility tests passed
landing: All landing tests passed. | node20: All landing tests passed.
api: All arkademy-api integration tests passed. | node20: All arkademy-api integration tests passed.  # scratch Postgres 16
✓ Compiled successfully in 5.4s                # npm run build: ƒ /arkademy/business-model-canvas/yours, ƒ …/tour/[example]
generate: ok                                   # git status --short prints nothing after it
```

The browser run (Task 11, dev server, part 1's fixture and the larger fictional document) printed exactly the outputs given there. In particular:
- a canvas filled by keyboard alone;
- inspirations added and reworded;
- a question left open and undone;
- the five-answer cap, the duplicate refusal, reorder by button and by Alt+↓, remove, and blank-then-blur;
- the clipboard holding the paragraph and the Markdown, and the JSON download;
- reload with `?step`, and the landing step without it;
- corrupt, newer and blocked storage;
- Start over: Cancel returns focus to its button, and confirming focuses the name field;
- two tabs converging;
- the cover's button reading "Start your own", then "Continue your canvas" with a draft;
- the tour's end card offering "Start your own" ("Continue your canvas" with a draft) before "Next example" and "All examples";
- the hover link (a hovered block tints its sentence; the current sentence keeps its underline; the current block never takes the outline);
- 400, 900 and 1440 px, light and dark, every page with no sideways scroll and one `h1`;
- zero console errors or warnings, and no hydration warning.

`git diff --stat feat/arkademy-tour..HEAD` lists 23 files:
- `.github/workflows/ci.yml`, `package.json`, `docs/architecture.md`;
- the plan;
- `app/arkademy/business-model-canvas/page.tsx`, `app/arkademy/business-model-canvas/tour/[example]/page.tsx`, `app/arkademy/business-model-canvas/yours/page.tsx`;
- `components/arkademy/CanvasToolbar.tsx`, `InspirationList.tsx`, `QuestionEditor.tsx`, `QuestionSteps.tsx`, `StartOverDialog.tsx`, `StartYourOwnButton.tsx`, `StrandedDraft.tsx`, `YourCanvas.tsx`;
- `lib/arkademy/canvas-export.ts`, `canvas-storage.ts`, `canvas.ts`, `inspirations.ts`;
- `lib/hooks/useCanvasDraft.ts`, `lib/utils/download.ts`;
- `tests/app/arkademy-canvas.test.js`, `tests/app/arkademy-tour.test.js`.

**With the real library** (scratch database only):
- **Inspirations per question:** 30 segments, 39 value propositions, 21 channels, 17 relationships, 11 revenue streams, 27 resources, 21 activities, 20 partners and 8 costs.
- **Long tails:** most entities are used by one company. All but four segments and all but one value proposition are singletons, so the first six are the shared ones and "Show all" opens a long list.
- **How they read:** as answers mid-sentence ("This product leans on Apple App Store and Google Play, and third-party AI model providers."), with names kept since `adf4f62e`.
- **Awkward:**
  - with "Show all" on 20+ items, the inspirations column runs far below the question card at 1440 px;
  - "No revenue yet" is offered as a revenue stream;
  - most value propositions are one company's own promise rather than a shared pattern.

**PR:** not opened by this part's builder; the coordinator opens it with `gh stack submit --auto` and this body:

- Title: `feat(arkademy): your own canvas, with inspirations (part 4/4)`
- Body:
  - What the part adds: `/arkademy/business-model-canvas/yours`, one question at a time with the paragraph and the canvas building as you type, left open on purpose, inspirations from the library, the draft saved in this browser only, the three exports, Start over, and the cover's "Start your own".
  - The readings and deviations above, in one line each.
  - The screenshots' description from Task 11.
  - The adaptations to part 3's real code and the inspiration-answer fix (§ "As built").
  - Then the Lab Note: **this part carries the single note for the whole Arkademy**, so the body ends with exactly this section (reproduced from the spec's § "Lab Notes"; do not reword it, do not add `nodes:`), followed by the attribution lines your session's instructions give:

````markdown
## Lab Note

```yaml
en:
  title: "Meet the Arkademy: the Business Model Canvas, by example"
  summary: "A new corner for learning product thinking opens with its first tool: the Business Model Canvas as nine plain questions. Play a worked example step by step, then answer the questions for your own product, with inspirations from the examples when you are stuck. Find it at arkaik.app/arkademy."
fr:
  title: "Voici l'Arkademy : le Business Model Canvas, par l'exemple"
  summary: "Un nouvel espace pour apprendre à penser produit ouvre avec son premier outil : le Business Model Canvas en neuf questions simples. Regarde un exemple se construire pas à pas, puis réponds aux questions pour ton produit, en piochant des inspirations quand tu sèches. C'est par ici : arkaik.app/arkademy."
suggested:
  molecule: arkaik
  type: feature
  tags: [arkademy, business-model-canvas]
```
````

- No `no-lab-note` label on this PR (parts 1–3 carry it).
- After opening, read the PR's comments. The Lab Note reminder must not flag the note; if it does, fix the body (posting is idempotent). CI must be green, including the new "Arkademy canvas tests" step.

---

## For the owner

- **`DeleteConfirmDialog` drops focus.** It has no `DialogTrigger`, so after Cancel or Escape the focus lands on `<body>` in every place the app uses it (`SystemMap`, `JourneyMap`, `RawBundlePanel`, the maps page, project settings). `StartOverDialog` shows the fix: make the opening button the `DialogTrigger`, or pass `onCloseAutoFocus` and focus it by hand. That is a separate change outside the Arkademy.
- **Part 3 and part 4 have two step rows.** The tour's `StepRail` (part 3) and this part's `QuestionSteps` are built independently. When the design is enhanced, one shared component with a read and an edit mode is worth it.
- **Answers are cleaned in the exports.** The Markdown and the JSON carry answers as shown (`displayAnswers`), not as typed: a closing `.`, `!`, `?`, `…`, `;`, `:` or `,` is dropped everywhere.
- **The phone answer row.** Below about 30rem of card, every answer's ↑ ↓ × sit under its field, short answers included. It is consistent and readable; a later design may prefer a compact menu.
