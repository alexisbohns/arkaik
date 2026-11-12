# Arkademy — Part 2: the shell and the Business Model Canvas cover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first visible Arkademy: `/arkademy` (a card per tool) and `/arkademy/business-model-canvas` (the tool's name and tagline, the pitch, a gallery of every example with its paragraph and mini canvas, and the baseline prompt with a copy button), with their chrome, the states without a library, each page's own canonical URL, and two sitemap entries. No action buttons yet: "Play a tour" arrives with part 3, "Start your own" with part 4.

**Architecture:** Pure rules go into `lib/arkademy/` beside part 1's modules — `paragraph.ts` (the paragraph rule), `examples.ts` (an example's canvas), `prompt.ts`, `tools.ts` (paths and the shell's cards), `metadata.ts` (each page's `Metadata`) — and are tested from Node by one new suite through part 1's loader. React lives in `components/arkademy/`: server components with no hooks (`ParagraphView`, `CanvasGrid`, `ExampleCard`, …) that a server page renders as they are and a client screen (parts 3 and 4) renders with handlers; one client component, `CopyButton`. The pages are server components under `app/arkademy/`, `force-dynamic`, reading the library in-process through part 1's `getArkademy()` wrapped in React's `cache()`; `app/arkademy/layout.tsx` draws the chrome once for every page under it.

**Tech Stack:** Next.js 16.2 App Router (server components, `generateMetadata`, `cache()`), React 19, Tailwind CSS 4 (container queries `@container`, `@xs:`, `@lg:`, `@3xl:`), the app's shadcn primitives and tokens, plain Node test scripts that transpile `.ts` through `tests/app/load-arkademy.js`, GitHub Actions on Node 20.

**Spec:** `docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md` as of `0b0a22b` ("what the real library taught the spec") and later — in particular rule 2 of § "The paragraph" (the semicolon join on a comma, `and` as a word, or a note). Where this plan and the spec differ, § "Readings and deviations" says why, and this plan wins.

**Branch:** `feat/arkademy-cover`, created by Task 1 with `gh stack add` on top of part 1's branch `feat/arkademy-content`, in the worktree `/Users/alexis/code/arkaik-arkademy`. Part 1's tip was `60bb56f` when this plan was written and may move while part 1 is reviewed; stack on whatever its tip is. This part changes nothing part 1 owns and uses only part 1's exported names.

**Position in the stack:** part 2 of 4. Part 3 (`feat/arkademy-tour`) and part 4 (`feat/arkademy-your-canvas`) stack on top and reuse the names in § "Components for parts 3 and 4".

**Rehearsed:** every task below was executed in order in a detached worktree of part 1 at `73cce63`, then re-checked on part 1's later tip `11e8c90` (lint, `tsc`, build, generate, every suite; the commits between touch only part 1's own validator, upload script and suites). A scratch Postgres 16 held the part 1 fixture; a dev server served the pages; Playwright screenshots at 400, 900 and 1440 px in light and dark, with the fixture, with a stress document (a 140-character wording in every slot, five answers per question, five notes), with an empty table, with an unreadable row and with no `DATABASE_URL`, were opened and read. Every expected output in this plan is what that run printed. The suites also ran under a real Node 20.19.5 binary.

---

## Readings and deviations

The spec fixes names and shapes; these are the places it was silent, ambiguous or wrong, and what the code below does.

1. **The join rule takes the notes into account through a flag** (spec rule 2 as of `0b0a22b`). `joinsWithSemicolons(answers: readonly { text: string; note?: UseNote }[]): boolean` is the rule: true when any (already cleaned) answer contains a comma, contains `and` as a word (`/(?:^|\s)and(?:\s|$)/`, so `sandwiches` and `black-and-white` do not count), or carries a note; it never reads the note's text. `joinAnswers(texts: readonly string[], semicolon = joinsWithSemicolons(texts.map((text) => ({ text })))): string` joins plain texts and takes the flag when a caller's answers carry notes. `composeParagraph` calls `joinsWithSemicolons` on the cleaned answers with their notes. The part 1 fixture already holds one `and` case: Crumb & Co's costs read "The main costs are flour and butter; and night-shift wages."
2. **An answer that cleans to nothing is no answer.** `composeParagraph` drops answers whose `cleanAnswer` is empty (`"..."`) before choosing between a sentence and a gap, so your own canvas (part 4) never prints "It offers ." The spec was silent.
3. **`composeParagraph` matches `state` to the questions by key**, not by position; a key missing from `state` reads as unanswered and not open. `through` slices the questions (`through: 0` gives no segment).
4. **Extra exports, nothing renamed.** `paragraph.ts` also exports `CanvasAnswer` (the answer type), `joinsWithSemicolons` and `noteDate(note)` (the date as printed: the date, or `read on …`). `examples.ts` exports `ExampleCanvas`. `prompt.ts` exports `promptLines(text)`. `tools.ts` exports `ARKADEMY_PATH`, `BMC_YOURS_PATH`, `bmcTourPath(companyId)`, `ArkademyToolCard` and `arkademyToolCards(document)` beside the spec's `ARKADEMY_TOOL_PATHS`. `metadata.ts` exports `ARKADEMY_SITE_URL`, `ARKADEMY_INTRO` (the shell's line of copy and its description) and `BMC_FALLBACK_TITLE`. Part 1's loader throws when two modules export one name; none of these collides with part 1's names (checked at `11e8c90`).
5. **The metadata helpers' signatures** (the spec named them only): `arkademyShellMetadata()`, `bmcCoverMetadata(tool: BmcTool | null)`, `bmcTourMetadata(companyId: string, found: { tool: BmcTool; company: Company } | null)`, `bmcYoursMetadata(tool: BmcTool | null)`. **All four** set `openGraph` (title, description, `url` = the canonical, `siteName: "arkaik"`, `type: "website"`, `locale: "en_US"`) and `twitter` (`card: "summary"`); the spec asked it of the shell and the cover only, but a tour link is meant to be shared ("a link to a step is a citation"), and without it the shared card would carry the home page's URL. Tour and yours return `robots: { index: false, follow: false }`; shell and cover return no `robots` key (the root's `index, follow` applies — rehearsed: the cover serves `<meta name="robots" content="index, follow"/>` and its own canonical). Next replaces a top-level metadata key whole, so a page's `openGraph` drops the root's `url` with the rest.
6. **The cover's metadata without a library** uses `BMC_FALLBACK_TITLE` ("Business Model Canvas") and a fixed description, and so does its `h1`: a page always has exactly one `h1`, and the cover's is the tool's name or that fallback.
7. **The sitemap test reads the sitemap's source text**, as the spec says, so the two entries are literal template strings like their neighbours (`` `${base}/arkademy` ``), not built from `ARKADEMY_TOOL_PATHS`.
8. **"+N more" is plain text in the mini density.** The spec's notes section mentions "the cover's canvas block when expanded"; this part has no expansion. Every answer and every note is in the card's paragraph, which is the reading surface; the mini canvas is its picture. The `full` density (parts 3 and 4) lists every answer with its note under it.
9. **Notes in the gallery are rendered in full**, inside the paragraph, as the spec's rule 5 writes them: the note's text, the source's name as a link (`target="_blank"`, `rel="noopener noreferrer nofollow"`), the date — in smaller muted type, the parentheses at the paragraph's size. No disclosure: a crawler gets every fact with its source, and the copy text (`paragraphText`) is exactly what is on screen. Rehearsed with a stress card far longer than the real library's longest (about 6,500 characters of paragraph with five notes): it wraps at 400 px with no sideways scroll, and the notes stay readable.
10. **The mini density goes to two columns from a 20rem container** (`@xs:`), not from 32rem: a phone-width card is 336 px wide, and nine blocks stacked one per row made each example about twice as tall. The full density keeps the spec's one column below 32rem. Ten columns in the canonical arrangement from 48rem, in both densities.
11. **`useCopyId(text, what = text)`** gains an optional second argument: the toast says `Copied ${what}`. The hook's toast printed the copied text whole, which for a prompt is a paragraph of toast. The two existing callers pass one argument and are unchanged. `CopyButton` passes `what` ("the prompt" → "Copied the prompt").
12. **`CodeBlock` gains `wrap?: boolean`** (default `false`, so the landing's blocks are unchanged): wrapped lines instead of a sideways scroll inside the block. The prompt is read, and a phone would otherwise scroll it sideways line by line. Its 11 px mono size is kept — it is the landing's prompt-excerpt look.
13. **Two components the spec did not list:** `ArkademyBreadcrumb` (the trail; the chrome sits in the layout, which cannot know the page) and `SourcedNote` (a note's inline rendering, shared by `ParagraphView` and `CanvasGrid`'s full density). `PromptBlock` owns the prompt section's `h2` so the copy button sits beside it.
14. **The chrome is drawn by `app/arkademy/layout.tsx`** and holds the page's `<main>`; pages render their own column inside it (`ARKADEMY_COLUMN`) and their own `h1` (`ARKADEMY_TITLE`, Gochi Hand). `app/arkademy/not-found.tsx` is therefore inside the chrome. Nothing in this part calls `notFound()`; the rehearsal checked the file through a temporary page that did (not committed).
15. **The shell's headings.** The tool list is a section titled by a small mono "Tools" `h2` (the landing's kicker style), and each card's title is an `h2` too, so the outline reads `h1` Arkademy, then `h2` Tools and `h2` Business Model Canvas side by side. With one tool that reads fine; with several, the owner may prefer the cards' titles as `h3` (a one-word change in `ToolCard.tsx`).
16. **No `.gitignore` line:** the new suite builds into part 1's `tests/app/.test-build-arkademy/`, already ignored (`.gitignore:58`). The spec's "each new suite gets … a `.gitignore` line" has nothing new to ignore.

## Repo traps that apply

- **CI runs Node 20; this machine runs Node 26, which strips TypeScript.** Never `require` a `.ts` file from a test. The new suite goes through `tests/app/load-arkademy.js` (transpiles with the `typescript` package). Run every suite under Node 20 as well if a Node 20 binary is at hand (`/private/tmp/claude-503/-Users-alexis-code-arkaik/6c13545b-ad9c-48df-8d3e-f15018c9bdc0/scratchpad/node20/node-v20.19.5-darwin-arm64/bin/node` was used in the rehearsal).
- **`lib/arkademy/` never imports `@/…`.** `tests/app/load-arkademy.js:52-56` and `scripts/arkademy/load-arkademy-lib.js` refuse it by name. The new modules import only `./schema`, `./paragraph`, `./index-document`, `./tools` — and `import type { Metadata } from "next"` in `metadata.ts`, which `import type` erases. React, `next/link` and hooks stay in `components/` and `app/`.
- **One merged export namespace.** The loader merges every `lib/arkademy/*.ts` module's exports into one object and throws `"X" is exported by both …` (`tests/app/load-arkademy.js:67`) on a repeat. Keep export names unique across the folder; parts 3 and 4 must check theirs against the list in § "Components for parts 3 and 4".
- **Alias tables elsewhere.** `tests/services/load-arkademy-api.js` copies the whole `lib/arkademy/` folder too and checks it for leftover `@/` imports; the new modules have none, so it needs no line. No other loader compiles a file this part touches.
- **eslint gates the build job, with the React Compiler rules** (`eslint-config-next`). The components here have no effects and no refs; `CopyButton`'s state lives in `useCopyId`. `npm run lint` on the rehearsed tree: `✖ 3 problems (0 errors, 3 warnings)` — the three `@next/next/no-img-element` warnings `main` already has. `prefer-const` bites destructuring: `paragraph.ts` destructures with `const` and copies into a `let`.
- **actionlint gates the build job** (all workflows). The CI edit is one plain step; run `actionlint` after it (silent).
- **Generated files.** CI runs `npm run generate` and fails on a diff. A lucide icon the repo has never imported dirties `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css`; this part imports only `CopyIcon`, `CheckIcon` and `ChevronRightIcon`, all registered (`lib/wobble/wobble-registry.generated.ts:32`, `:35`, `:61`). Do not add `ArrowRightIcon` (not registered). Rehearsed: `npm run generate` leaves the tree clean.
- **Suites that read source text.** `tests/app/keyboard-shortcuts.test.js:189-201` walks `app/`, `components/`, `lib/` and fails on a `window.`/`document.addEventListener("keydown"` — none here. `tests/app/panel-semantics.test.js` checks `PageShell`'s single `h1`; the Arkademy does not use `PageShell`, and every page here has exactly one `h1` (rehearsed: one in every state). The new suite reads `app/sitemap.ts`'s text (deviation 7). `tests/landing/landing.test.js` passes with `CodeBlock`'s new prop. `tests/app/docs-visibility.test.js` passes with the doc edits.
- **A stale `.next/` breaks `tsc`.** `tsconfig.json:30` includes `.next/types/**/*.ts`; a build from part 1 or from a later part leaves validators naming pages this branch may not have (`TS2307 … page.js`). `rm -rf .next` before `npx tsc --noEmit` after switching branches.
- **The dev server did not see file edits in the rehearsal** (a worktree under `/private/tmp`): pages kept serving the old markup after an edit. Before trusting a screenshot, stop the server, `rm -rf .next/dev`, start it again, and `curl` the page for a class you just added (Task 7 does).
- **Turbopack and `node_modules`.** Run the dev server in a checkout with a real `node_modules` (`npm ci`), never a symlinked one (Turbopack panics).
- **Production caches the library** (part 1's data cache, `ARKADEMY_CACHE_SECONDS`; its length was under review when this plan was written). Use `npm run dev` for visual checks: development reads Postgres on every request.
- **Dev-only console noise on a `notFound()` page:** in `next dev`, a page under `/arkademy` that calls `notFound()` logs "Encountered a script tag while rendering React component" (the root layout's inline scripts, re-rendered on the client). `next start` does not (rehearsed: only the document's own 404 is logged, as on any unknown URL). Part 3 meets this with its unknown-example tour.
- **The worktree is shared.** `/Users/alexis/code/arkaik-arkademy` may carry another agent's uncommitted part 1 fixes. Start Task 1 only when `git status --short` on `feat/arkademy-content` prints nothing.

## Local Postgres and a dev server, for the visual check

Task 7 needs a migrated Postgres with the fixture published, and a dev server. Homebrew's Postgres 16 binaries are on the PATH. Use a directory **outside the repository** and free ports (check with `lsof -nP -iTCP:<port> -sTCP:LISTEN`, which prints nothing when free; the rehearsal used 5861 and 4861):

```bash
export PGSCRATCH=/path/to/your/scratchpad/pg-arkademy-p2     # outside the repo
initdb -D "$PGSCRATCH/data" -U arkaik --auth=trust > "$PGSCRATCH.initdb.log"
pg_ctl -D "$PGSCRATCH/data" -l "$PGSCRATCH.log" -o "-p 5861 -c listen_addresses=localhost -c unix_socket_directories=''" start
createdb -h localhost -p 5861 -U arkaik arkademy_p2
export DATABASE_URL=postgres://arkaik@localhost:5861/arkademy_p2
npm run --silent db:migrate | tail -1
npm run --silent arkademy -- publish tests/fixtures/arkademy/document.json | tail -1
```

Expected: `server started`; `[db:migrate] done — applied 13 migration(s).`; a line starting `published v1 (10.1 KB, 1 warning)` (part 1 owns the rest of its wording).

---

## Verified facts

Read at part 1's `11e8c90` (identical to `60bb56f` for every file below).

- `app/layout.tsx:16-46` root metadata: `openGraph` at `:20` with `url: "https://arkaik.app"`, `robots` at `:33`, `alternates.canonical: "https://arkaik.app"` at `:39`; `:96-108` `ThemeProvider` → `QueryProvider` → `{children}`, `AppToaster` (sonner, so a toast needs nothing more), `SyncProvider`. `title` is a plain string, so a page's `title` is used as written.
- `app/p/[id]/page.tsx:44` `const lookupSnapshot = cache(async …)` — the per-request dedupe the cover copies; `:75` `robots: { index: false, follow: false }`; `:87-99` `PageChrome`: `ArkaikLogo className="w-20"` in a `Link href="/" aria-label="Go to arkaik home"`, `ThemeToggle`, `border-b px-6 py-3`.
- `components/branding/ArkaikLogo.tsx` — `ArkaikLogo({ className })`, an `svg` with `role="img" aria-label="Arkaik"`. `components/theme-toggle.tsx` — `ThemeToggle()`, a client `Button variant="outline" size="icon"`.
- `lib/fonts.ts:11` `export const gochiHand = Gochi_Hand(…)`; `components/docs/DocsArticle.tsx:35-40` uses it for the docs `h1`.
- `components/ui/button.tsx:26-27` `stone` / `stone-secondary` variants (unused here; part 4's "Start your own"); `components/ui/card.tsx` `Card` (`bg-card … rounded-xl border py-6`, `div` props spread); `components/ui/badge.tsx` `Badge` with `variant="outline"`; `components/ui/breadcrumb.tsx:95-103` exports `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink` (a plain `<a>`, no `asChild`), `BreadcrumbPage`, `BreadcrumbSeparator` (`ChevronRightIcon`); `components/ui/empty-state.tsx:30` `EmptyState({ message, action, size, className })`, a dashed card whose `message` is a node inside a `<p>`.
- `lib/hooks/useCopyId.ts:23` `useCopyId(id: string)`, `:42` `toast.success(\`Copied ${id}\`)`. Its callers: `components/graph/nodes/EntityRow.tsx`, `components/graph/nodes/EntityBadges.tsx` (one argument each).
- `components/landing/previews/CodeBlock.tsx:28` `CodeBlock({ title, lines, className })`; `:32` `<pre className="[overflow:auto] … text-[11px] leading-5">`; `:34` each line `whitespace-pre`.
- `app/sitemap.ts:1-18`: `const base = "https://arkaik.app"`, ten literal entries, the last at `:17` (`/docs/vision`).
- `public/robots.txt` allows everything and points at the sitemap; unchanged.
- `lib/services/arkademy.ts:24-29` `ArkademyLookup` (five statuses); `:98-106` `getArkademy()` never throws, `unconfigured` without `DATABASE_URL`, and in development (`:101`) reads Postgres on every call.
- `lib/arkademy/index-document.ts:27` `indexArkademy(document)` → `ArkademyIndex` with `tool`, `company(id)`, `uses(company, question)` (sorted by `order`, a fresh array), `isOpen(company, question)`.
- `lib/arkademy/schema.ts` exports used here: `BMC_QUESTION_KEYS`, `BMC_TOOL_ID`, `PROMPT_TOKEN`, `SUBJECT_TOKEN` (`"{S}"`), `LIST_TOKEN` (`"{L}"`), and the types `ArkademyDocument`, `BmcTool`, `BmcQuestion`, `BmcQuestionKey`, `Company`, `ToolId`, `UseNote`.
- `tests/app/load-arkademy.js` discovers `lib/arkademy/*.ts`, transpiles into `tests/app/.test-build-arkademy/` (`.gitignore:58`), refuses `@/` (`:52-56`), throws on a name exported twice (`:67`).
- The fixture `tests/fixtures/arkademy/document.json`: examples `crumb-and-co`, `tidewise`, `inkwell`; Crumb & Co is the `simulation` with a company `note` and five `ka` uses; its two `cost` uses are `flour and butter` and `night-shift wages`; Tidewise's `ch` uses are stored with `order` 1 then 0, it leaves `rev` open, and its `kr` use has a `published` note; Inkwell's `rev` use has an `accessed` note. Its `prompt.text` holds `{{paragraph}}` on its own line.
- `package.json:40-41` `test:arkademy-schema`, `test:arkademy-api`; `.github/workflows/ci.yml:29` Node 20 (build job), `:217-218` the "Arkademy library tests" step.
- `app/globals.css:126-132` gives `.overflow-x-auto` and friends `overscroll-behavior: contain` (the wheel trap); nothing here scrolls sideways, and `CodeBlock`'s `[overflow:auto]` is an arbitrary property, not the trapped class.
- `docs/architecture.md:62-64` the `p/[id]` block in "App Router Structure", `:173` the `publik/` line in "Component Map"; `docs/conventions.md:22` (`publik/ sync/ auth/`), `:38` (`services/`); `README.md:55` (`p/[id]/`), `:70` (`publik/ sync/ settings/`), `:76` (`hooks/`).
- Tailwind 4 (`package.json` `"tailwindcss": "^4"`): container queries are built in (`@container`, `@xs` = 20rem, `@lg` = 32rem, `@3xl` = 48rem); an `_` in an arbitrary value is a space, so `[grid-template-areas:'kp_kp_…']` writes the areas.

## Components for parts 3 and 4

Every name below is exported by this part. "Reuse" means import it as it is; extend a component only by adding an optional prop.

**Pure (`lib/arkademy/`), importable from anywhere, tested by `test:arkademy-paragraph`:**

| File | Names | For |
|---|---|---|
| `paragraph.ts` | `CanvasAnswer` `{ text; entity?; note? }`, `CanvasQuestionState` `{ key; answers: CanvasAnswer[]; open }`, `ParagraphPart`, `ParagraphSegment`, `SUBJECT_PRONOUN`, `DEFAULT_SUBJECT`, `cleanAnswer(text)`, `joinsWithSemicolons(answers)`, `joinAnswers(texts, semicolon?)`, `noteDate(note)`, `noteText(note)`, `composeParagraph({ questions, state, subject, through? })`, `paragraphText(segments)` | 3: the tour's paragraph with `through`; 4: `draftState` returns `CanvasQuestionState[]`, the exports call `composeParagraph` + `paragraphText` |
| `examples.ts` | `ExampleCanvas` `{ company; questions }`, `exampleCanvas(index, companyId)` (`null` for a non-example) | 3: the tour page's data |
| `prompt.ts` | `PROMPT_PLACEHOLDER`, `promptForDisplay(text)`, `promptLines(text)` | — |
| `tools.ts` | `ARKADEMY_PATH`, `ARKADEMY_TOOL_PATHS`, `BMC_YOURS_PATH`, `bmcTourPath(companyId)`, `ArkademyToolCard`, `arkademyToolCards(document)` | 3: `tourHref(companyId, step?)` builds on `bmcTourPath`; 4: links to `BMC_YOURS_PATH` |
| `metadata.ts` | `ARKADEMY_SITE_URL`, `ARKADEMY_INTRO`, `BMC_FALLBACK_TITLE`, `arkademyShellMetadata()`, `bmcCoverMetadata(tool \| null)`, `bmcTourMetadata(companyId, { tool, company } \| null)`, `bmcYoursMetadata(tool \| null)` | 3: the tour's `generateMetadata`; 4: the yours page's |

Names parts 3 and 4 must not reuse in `lib/arkademy/` (the loader would throw): every name above, and part 1's.

**Components (`components/arkademy/`):**

| Component (file) | Props | Kind | For |
|---|---|---|---|
| `ArkademyChrome` (`ArkademyChrome.tsx`) | `{ children: ReactNode }` | server; drawn by `app/arkademy/layout.tsx`, so every page under `/arkademy` has it — parts 3 and 4 do nothing | — |
| `ARKADEMY_COLUMN`, `ARKADEMY_TITLE`, `ARKADEMY_SECTION_TITLE` (`ArkademyChrome.tsx`) | class strings: the page column, the page's `h1` (Gochi Hand), a section `h2` | — | 3, 4: every page's column and `h1` |
| `ArkademyBreadcrumb` (`ArkademyBreadcrumb.tsx`) | `{ trail: readonly ArkademyCrumb[] }`, `ArkademyCrumb = { label: string; href?: string }` (the last, without `href`, is the page) | server | 3: Arkademy › Business Model Canvas › {company}; 4: … › Your canvas |
| `ArkademyMessage` (`ArkademyMessage.tsx`) | `{ status: ArkademyMessageStatus }` (`Exclude<ArkademyLookup["status"], "ready">`) | no hooks: server or client | 3, 4: the states without a library (4 adds its raw-draft download beside it) |
| `ToolCard` (`ToolCard.tsx`) | `{ href; title; tagline; exampleCount }` | server | — |
| `ExampleCard` (`ExampleCard.tsx`) | `{ company; questions: readonly BmcQuestion[]; state: readonly CanvasQuestionState[]; actions?: ReactNode }` | server | 3: passes `actions={<Button asChild variant="outline" size="sm"><Link href={tourHref(id)}>Play the tour</Link></Button>}` from the cover |
| `ParagraphView` (`ParagraphView.tsx`) | `{ segments: readonly ParagraphSegment[]; onSelectQuestion?: (key: BmcQuestionKey) => void; className? }` — with `onSelectQuestion`, gaps are buttons | no hooks: server or client | 3: the tour's paragraph (add an optional `highlight?: BmcQuestionKey` for the new sentence's fade); 4: gaps that go to their question |
| `CanvasGrid` (`CanvasGrid.tsx`) | `{ questions: readonly Pick<BmcQuestion, "key" \| "block">[]; state; density: "full" \| "mini"; idPrefix: string; label: string; headingLevel?: 3 \| 4; current?: BmcQuestionKey; through?: number; onSelectQuestion? }`; also `CANVAS_MINI_ANSWERS = 3` | no hooks: server or client | 3: `density="full" current={key} through={step}`; 4: `density="full" current={key} onSelectQuestion={go}` |
| `SourcedNote` (`SourcedNote.tsx`) | `{ note: UseNote }` — inline: text; source link; date (text content = `noteText(note)`) | server or client | 3: notes under the tour's answers |
| `CopyButton` (`CopyButton.tsx`) | `{ text; label; what; variant?: "outline" \| "ghost" \| "secondary" \| "default"; size?: "sm" \| "default"; className? }` | **client** | 4: Copy the paragraph (`what="the paragraph"`), Copy as Markdown |
| `PromptBlock` (`PromptBlock.tsx`) | `{ label; text }` — the section with its `h2` (`id="prompt-title"`), copy button and block | server (renders the client `CopyButton`) | — |

`ParagraphView`, `CanvasGrid`, `ArkademyMessage`, `SourcedNote` carry no `"use client"` and no hooks: a server page passes no function props; a client screen (part 3's `CanvasWalk`) imports them and passes handlers. Do not add hooks to them; wrap them instead.

## File map

- Create `lib/arkademy/paragraph.ts`, `lib/arkademy/examples.ts`, `lib/arkademy/prompt.ts`, `lib/arkademy/tools.ts`, `lib/arkademy/metadata.ts`.
- Create `tests/app/arkademy-paragraph.test.js`.
- Create `components/arkademy/ArkademyChrome.tsx`, `ArkademyBreadcrumb.tsx`, `ArkademyMessage.tsx`, `ToolCard.tsx`, `ExampleCard.tsx`, `CanvasGrid.tsx`, `ParagraphView.tsx`, `SourcedNote.tsx`, `PromptBlock.tsx`, `CopyButton.tsx`.
- Create `app/arkademy/layout.tsx`, `app/arkademy/page.tsx`, `app/arkademy/not-found.tsx`, `app/arkademy/business-model-canvas/page.tsx`.
- Modify `app/sitemap.ts`, `lib/hooks/useCopyId.ts`, `components/landing/previews/CodeBlock.tsx`, `package.json`, `.github/workflows/ci.yml`, `docs/architecture.md`, `docs/conventions.md`, `README.md`.
- Must not touch: `lib/arkademy/schema.ts`, `validate.ts`, `index-document.ts`, `lib/services/arkademy.ts`, `app/api/arkademy/route.ts`, `db/migrations/**`, `scripts/arkademy/**`, the fixture, `packages/**`, any generated file, `public/robots.txt`.

---

### Task 1: The branch

**Files:** none.

- [ ] **Step 1: Start from part 1's clean tip**

```bash
cd /Users/alexis/code/arkaik-arkademy
git checkout feat/arkademy-content
git status --short
git log --oneline -1
```

Expected: `git status --short` prints nothing (if it prints anything, stop: another agent is working on part 1). The log line is part 1's tip.

- [ ] **Step 2: Stack the branch**

```bash
gh stack view
```

If it reports that the current branch is not part of a stack, adopt part 1 first: `gh stack init --base main feat/arkademy-content`. Then:

```bash
gh stack add feat/arkademy-cover
git branch --show-current
rm -rf .next
```

Expected: `feat/arkademy-cover`. (`rm -rf .next` clears validators a build from another branch left behind.)

---

### Task 2: The paragraph rule and an example's canvas

**Files:**
- Create: `tests/app/arkademy-paragraph.test.js`, `lib/arkademy/paragraph.ts`, `lib/arkademy/examples.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Write the test**

Create `tests/app/arkademy-paragraph.test.js`:

```js
#!/usr/bin/env node

/**
 * The cover's pure side (lib/arkademy/): the paragraph rule, an example's
 * canvas, the baseline prompt's display form, the tool paths and cards, each
 * page's metadata, and the sitemap's two Arkademy URLs. DB-free, so it runs in
 * CI's `build` job.
 *
 * Cases that the fictional fixture (tests/fixtures/arkademy/document.json)
 * does not hold are built in memory; the fixture itself is never edited.
 */

const fs = require("fs");
const path = require("path");
const { loadArkademy, cleanup } = require("./load-arkademy");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");

const {
  BMC_QUESTION_KEYS,
  PROMPT_TOKEN,
  indexArkademy,
  validateArkademyDocument,
  SUBJECT_PRONOUN,
  DEFAULT_SUBJECT,
  cleanAnswer,
  joinAnswers,
  joinsWithSemicolons,
  noteDate,
  noteText,
  composeParagraph,
  paragraphText,
  exampleCanvas,
} = loadArkademy();

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
const validation = validateArkademyDocument(document, { now: new Date("2026-11-12T00:00:00Z") });
check("the fixture validates", validation.ok, JSON.stringify(validation.errors));
const tool = document.tools[0];
const questions = tool.questions;
const index = indexArkademy(validation.document);

/** Nine questions, every one empty, with `answers` and `open` set per key. */
function state(answers = {}, open = []) {
  return BMC_QUESTION_KEYS.map((key) => ({
    key,
    answers: (answers[key] ?? []).map((answer) => (typeof answer === "string" ? { text: answer } : answer)),
    open: open.includes(key),
  }));
}
const sentences = (segments) => segments.filter((s) => s.kind === "sentence").map((s) => s.text);
const NOTE = {
  text: "about 40 tonnes a year",
  source: { name: "Example Mill, annual report", url: "https://mill.example/report", date: "2026-02-01", dateKind: "published" },
};
const UNDATED = {
  text: "listed as a partner",
  source: { name: "Example Mill, partners page", url: "https://mill.example/partners", date: "2026-10-01", dateKind: "accessed" },
};

// --- cleanAnswer -------------------------------------------------------------
same("clean: trims", cleanAnswer("  bread  "), "bread");
same("clean: drops a trailing full stop", cleanAnswer("bread."), "bread");
same("clean: drops dots and spaces mixed", cleanAnswer("bread . . "), "bread");
same("clean: keeps other punctuation", cleanAnswer("bread!"), "bread!");
same("clean: keeps an inner full stop", cleanAnswer("v2.0 maps"), "v2.0 maps");
same("clean: only dots becomes empty", cleanAnswer("..."), "");

// --- joinAnswers and the semicolon triggers ------------------------------------
same("join: none", joinAnswers([]), "");
same("join: one", joinAnswers(["a"]), "a");
same("join: two", joinAnswers(["a", "b"]), "a and b");
same("join: three", joinAnswers(["a", "b", "c"]), "a, b and c");
same("join: four", joinAnswers(["a", "b", "c", "d"]), "a, b, c and d");
same("join: five", joinAnswers(["a", "b", "c", "d", "e"]), "a, b, c, d and e");
same("join: one item with a comma reads as itself", joinAnswers(["a, still"]), "a, still");
same("join: two, a comma inside", joinAnswers(["a, still", "b"]), "a, still; and b");
same("join: three, a comma inside", joinAnswers(["a", "b, still", "c"]), "a; b, still; and c");
same("join: five, a comma inside", joinAnswers(["a", "b", "c", "d", "e, f"]), "a; b; c; d; and e, f");
same("join: two, an 'and' inside", joinAnswers(["flour and butter", "wages"]), "flour and butter; and wages");
same("join: three, an 'and' inside", joinAnswers(["a", "rock and roll", "c"]), "a; rock and roll; and c");
same("join: 'and' inside a word is not 'and'", joinAnswers(["sandwiches", "brandy", "candles"]), "sandwiches, brandy and candles");
same("join: a hyphenated 'and' is not 'and'", joinAnswers(["black-and-white prints", "posters"]), "black-and-white prints and posters");
same("join: an explicit semicolon flag wins", joinAnswers(["a", "b"], true), "a; and b");
same("join: an explicit comma flag wins", joinAnswers(["a, b", "c"], false), "a, b and c");
check("semicolons: a plain list joins with commas", !joinsWithSemicolons([{ text: "a" }, { text: "b" }]));
check("semicolons: a comma triggers them", joinsWithSemicolons([{ text: "a, b" }, { text: "c" }]));
check("semicolons: 'and' as a word triggers them", joinsWithSemicolons([{ text: "a and b" }, { text: "c" }]));
check("semicolons: a note triggers them", joinsWithSemicolons([{ text: "a", note: NOTE }, { text: "c" }]));
check(
  "semicolons: a note's own commas and 'and' are not looked at",
  !joinsWithSemicolons([{ text: "a" }, { text: "c" }]) &&
    joinsWithSemicolons([{ text: "a", note: { ...NOTE, text: "plain" } }, { text: "c" }]),
);

// --- notes -------------------------------------------------------------------
same("noteDate: published", noteDate(NOTE), "2026-02-01");
same("noteDate: accessed", noteDate(UNDATED), "read on 2026-10-01");
same("noteText: published", noteText(NOTE), "about 40 tonnes a year; Example Mill, annual report, 2026-02-01");
same("noteText: accessed", noteText(UNDATED), "listed as a partner; Example Mill, partners page, read on 2026-10-01");

// --- composeParagraph: subject, pronoun, templates ------------------------------
{
  const all = state({
    seg: ["neighbours"],
    vp: ["warm bread."],
    ch: ["word of mouth"],
    cr: ["a newsletter"],
    rev: ["subscriptions"],
    kr: ["bakers"],
    ka: ["baking"],
    kp: ["millers"],
    cost: ["flour"],
  });
  const segments = composeParagraph({ questions, state: all, subject: "Crumb & Co" });
  same("compose: nine sentences in canonical order", segments.map((s) => s.question), BMC_QUESTION_KEYS);
  same("compose: the subject opens the first sentence", segments[0].text, "Crumb & Co is for neighbours.");
  same("compose: the pronoun after it, the answer cleaned", segments[1].text, `${SUBJECT_PRONOUN} offers warm bread.`);
  same("compose: a template without {S}", segments[4].text, "On money: subscriptions.");
  same("compose: the singular cost template at one answer", segments[8].text, "The main cost is flour.");
  same(
    "compose: a sentence with no note is one text part",
    segments[0].parts,
    [{ kind: "text", text: "Crumb & Co is for neighbours." }],
  );
}
{
  const segments = composeParagraph({ questions, state: state({ rev: ["fees"], kr: ["bakers"], ka: ["baking"] }), subject: "Crumb & Co" });
  same(
    "compose: a no-subject template first leaves the name for the next",
    sentences(segments),
    ["On money: fees.", "Crumb & Co relies on bakers.", "It spends its days on baking."],
  );
}
{
  const segments = composeParagraph({ questions, state: state({ seg: ["people"] }), subject: "   " });
  same("compose: an empty subject becomes the default", segments[0].text, `${DEFAULT_SUBJECT} is for people.`);
  const named = composeParagraph({ questions, state: state({ seg: ["people"] }), subject: "  Tidewise " });
  same("compose: the subject is trimmed", named[0].text, "Tidewise is for people.");
}
{
  const two = composeParagraph({ questions, state: state({ cost: ["flour", "wages"] }), subject: "X" });
  same("compose: sentencePlural at two answers", two[8].text, "The main costs are flour and wages.");
  const vp = composeParagraph({ questions, state: state({ vp: ["a", "b"] }), subject: "X" });
  same("compose: no sentencePlural keeps the sentence at two answers", vp[1].text, "X offers a and b.");
}

// --- gaps ----------------------------------------------------------------------
{
  const segments = composeParagraph({ questions, state: state({ seg: ["people"] }, ["rev"]), subject: "X" });
  same(
    "gap: open on purpose",
    segments[4],
    { kind: "gap", question: "rev", open: true, text: "left open on purpose: where the money comes from" },
  );
  same("gap: not answered", segments[1], { kind: "gap", question: "vp", open: false, text: "open: what it does for them" });
  const answered = composeParagraph({ questions, state: state({ rev: ["fees"] }, ["rev"]), subject: "X" });
  same("gap: answers win over an open flag", answered[4].kind, "sentence");
  const dots = composeParagraph({ questions, state: state({ seg: ["..."] }), subject: "X" });
  same("gap: an answer that cleans to nothing is no answer", dots[0].kind, "gap");
  const gapFirst = composeParagraph({ questions, state: state({ vp: ["bread"] }), subject: "X" });
  same("gap: a gap does not consume the subject", gapFirst[1].text, "X offers bread.");
}

// --- through --------------------------------------------------------------------
{
  const full = state({ seg: ["a"], vp: ["b"], ch: ["c"], cr: ["d"], rev: ["e"], kr: ["f"], ka: ["g"], kp: ["h"], cost: ["i"] });
  same("through 1: one segment", composeParagraph({ questions, state: full, subject: "X", through: 1 }).map((s) => s.question), ["seg"]);
  same(
    "through 4: four segments",
    composeParagraph({ questions, state: full, subject: "X", through: 4 }).map((s) => s.question),
    ["seg", "vp", "ch", "cr"],
  );
  same("through 9: all nine", composeParagraph({ questions, state: full, subject: "X", through: 9 }).length, 9);
  same("through omitted: all nine", composeParagraph({ questions, state: full, subject: "X" }).length, 9);
}

// --- notes in a sentence ---------------------------------------------------------
{
  const segments = composeParagraph({
    questions,
    state: state({ kp: [{ text: "two millers.", note: NOTE }, { text: "a co-op", note: UNDATED }] }),
    subject: "X",
  });
  const kp = segments[7];
  same(
    "notes: text puts each note in parentheses after its answer, joined with semicolons",
    kp.text,
    "Its partners are two millers (about 40 tonnes a year; Example Mill, annual report, 2026-02-01); and a co-op (listed as a partner; Example Mill, partners page, read on 2026-10-01).",
  );
  same(
    "notes: parts cut the sentence at each note",
    kp.parts,
    [
      { kind: "text", text: "Its partners are two millers (" },
      { kind: "note", note: NOTE },
      { kind: "text", text: "); and a co-op (" },
      { kind: "note", note: UNDATED },
      { kind: "text", text: ")." },
    ],
  );
  const rebuilt = kp.parts.map((part) => (part.kind === "text" ? part.text : noteText(part.note))).join("");
  same("notes: the parts concatenate to the text", rebuilt, kp.text);
  const one = composeParagraph({ questions, state: state({ kp: [{ text: "millers", note: NOTE }] }), subject: "X" });
  same("notes: a single noted answer", one[7].text, "Its partners are millers (about 40 tonnes a year; Example Mill, annual report, 2026-02-01).");
}

// --- paragraphText --------------------------------------------------------------
{
  const segments = composeParagraph({ questions, state: state({ seg: ["people"], ch: ["ads"] }, ["vp"]), subject: "X" });
  same("text: sentences only, single spaces", paragraphText(segments), "X is for people. It reaches them through ads.");
  same("text: nothing answered is empty", paragraphText(composeParagraph({ questions, state: state(), subject: "X" })), "");
}

// --- exampleCanvas on the fixture ------------------------------------------------
{
  const crumb = exampleCanvas(index, "crumb-and-co");
  check("example: a known example", crumb !== null);
  same("example: the company", crumb.company.id, "crumb-and-co");
  same("example: nine questions in canonical order", crumb.questions.map((q) => q.key), BMC_QUESTION_KEYS);
  same(
    "example: answers in order with their entity ids",
    crumb.questions.find((q) => q.key === "ka").answers.map((a) => a.entity),
    ["overnight-baking", "delivery-rounds", "flour-sourcing", "order-packing", "order-taking"],
  );
  const tide = exampleCanvas(index, "tidewise");
  same(
    "example: uses stored out of order come back in order",
    tide.questions.find((q) => q.key === "ch").answers.map((a) => a.text),
    ["anglers swapping tips on the pier", "app store search"],
  );
  same("example: the open question", tide.questions.filter((q) => q.open).map((q) => q.key), ["rev"]);
  same("example: no other open question", crumb.questions.filter((q) => q.open).length, 0);
  const kr = tide.questions.find((q) => q.key === "kr").answers[0];
  same("example: a note travels with its answer", kr.note && kr.note.source.dateKind, "published");
  check("example: an answer without a note has no note key", !("note" in crumb.questions[0].answers[0]));
  same("example: an unknown company is null", exampleCanvas(index, "nobody"), null);

  const tidePara = composeParagraph({ questions, state: tide.questions, subject: tide.company.name });
  same(
    "example: Tidewise's paragraph",
    paragraphText(tidePara),
    "Tidewise is for people who fish from the shore. It offers tide times that work without signal. It reaches them through anglers swapping tips on the pier and app store search. It keeps them with a help page inside the app. It relies on public tide data (predictions for 412 harbours, refreshed every season; Tidewise, product page, 2026-03-02). It spends its days on updating the tables every season. Its partners are harbour offices that share local data. The main cost is developer fees for the app stores.",
  );
  same("example: Tidewise's open question is a gap", tidePara[4].text, "left open on purpose: where the money comes from");
  const crumbPara = composeParagraph({ questions, state: crumb.questions, subject: crumb.company.name });
  same(
    "example: Crumb & Co's costs join with a semicolon ('flour and butter')",
    crumbPara[8].text,
    "The main costs are flour and butter; and night-shift wages.",
  );
  same(
    "example: Crumb & Co's five activities join with commas",
    crumbPara[6].text,
    "It spends its days on baking through the night, planning the delivery round, sourcing flour from nearby mills, packing each order by hand and taking orders by text message.",
  );
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-paragraph test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-paragraph tests passed.");
```

- [ ] **Step 2: Add the npm script**

In `package.json`, after the line `    "test:arkademy-api": "node tests/services/arkademy-api.test.js",` add:

```json
    "test:arkademy-paragraph": "node tests/app/arkademy-paragraph.test.js",
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npm run test:arkademy-paragraph
```

Expected: `PASS: the fixture validates`, then `TypeError: cleanAnswer is not a function` and a non-zero exit (the modules do not exist yet).

- [ ] **Step 4: Write the paragraph rule**

Create `lib/arkademy/paragraph.ts`:

```ts
import { LIST_TOKEN, SUBJECT_TOKEN } from "./schema";
import type { BmcQuestion, BmcQuestionKey, UseNote } from "./schema";

/**
 * The paragraph rule (docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md
 * § "The paragraph"): a canvas read back as one paragraph, a sentence per
 * answered question, a gap per question without answers. Pure — the cover,
 * the tour and your own canvas all render what this returns, and every copy
 * or export uses `paragraphText`.
 *
 * The words live in the document (each question's `sentence`, its optional
 * `sentencePlural`, its `gap`); only the joining and the subject rule live
 * here. Imports only its siblings, like every module in lib/arkademy/.
 */

export interface CanvasAnswer {
  text: string;
  entity?: string;
  /** A sourced fact about this example's case. Examples only; your own canvas has none. */
  note?: UseNote;
}

/** One question of a canvas, an example's or the visitor's own. */
export interface CanvasQuestionState {
  key: BmcQuestionKey;
  answers: CanvasAnswer[]; // in display order
  open: boolean; // left open on purpose; ignored when answers is non-empty
}

/** A sentence in pieces, so a page can render a note's source as a link. */
export type ParagraphPart = { kind: "text"; text: string } | { kind: "note"; note: UseNote };

export type ParagraphSegment =
  | { kind: "sentence"; question: BmcQuestionKey; text: string; parts: ParagraphPart[] }
  | { kind: "gap"; question: BmcQuestionKey; open: boolean; text: string };

/** Every sentence after the first one that names the subject. */
export const SUBJECT_PRONOUN = "It";
/** The subject when the name is empty. */
export const DEFAULT_SUBJECT = "This product";

/** Trims and drops trailing full stops and whitespace; other punctuation stays. */
export function cleanAnswer(text: string): string {
  return text.trim().replace(/[.\s]+$/, "");
}

/** The separator placed before item `i` (1 ≤ i < count) of a joined list. */
function separatorBefore(i: number, count: number, semicolon: boolean): string {
  if (i < count - 1) return semicolon ? "; " : ", ";
  return semicolon ? "; and " : " and ";
}

/** " and " as a word: an item holding it cannot be told apart from the list's own last "and". */
const AND_WORD = /(?:^|\s)and(?:\s|$)/;

/**
 * Whether a list of answers joins with semicolons: when any cleaned answer
 * contains a comma or "and" as a word, or carries a note. A comma-joined list
 * of such items cannot be read back into its items. Looks at whether an
 * answer has a note, never at the note's own text.
 */
export function joinsWithSemicolons(answers: readonly { text: string; note?: UseNote }[]): boolean {
  return answers.some((answer) => answer.note !== undefined || answer.text.includes(",") || AND_WORD.test(answer.text));
}

/**
 * `a`, `a and b`, `a, b and c`; in the semicolon case (`joinsWithSemicolons`)
 * `a; and b`, `a; b; and c`. The texts are taken as given (clean them first).
 * Pass `semicolon` when the answers carry notes, which plain texts cannot show.
 */
export function joinAnswers(
  texts: readonly string[],
  semicolon: boolean = joinsWithSemicolons(texts.map((text) => ({ text }))),
): string {
  return texts.map((text, i) => (i === 0 ? text : separatorBefore(i, texts.length, semicolon) + text)).join("");
}

/** A note's date as the pages print it: the source's own date, or "read on …" for an undated page. */
export function noteDate(note: UseNote): string {
  return note.source.dateKind === "accessed" ? `read on ${note.source.date}` : note.source.date;
}

/** The plain form of what goes inside a note's parentheses: `text; source, date`. */
export function noteText(note: UseNote): string {
  return `${note.text}; ${note.source.name}, ${noteDate(note)}`;
}

function pushText(parts: ParagraphPart[], text: string): void {
  if (text === "") return;
  const last = parts[parts.length - 1];
  if (last && last.kind === "text") last.text += text;
  else parts.push({ kind: "text", text });
}

function partsText(parts: readonly ParagraphPart[]): string {
  return parts.map((part) => (part.kind === "text" ? part.text : noteText(part.note))).join("");
}

export function composeParagraph(input: {
  questions: readonly BmcQuestion[]; // the document's nine, canonical order
  state: readonly CanvasQuestionState[]; // nine, canonical order (matched by key)
  subject: string; // company name, or the visitor's product name
  through?: number; // 1–9, default 9: questions after it are omitted
}): ParagraphSegment[] {
  const byKey = new Map(input.state.map((question) => [question.key, question]));
  const subject = input.subject.trim() || DEFAULT_SUBJECT;
  const through = input.through ?? input.questions.length;
  let subjectUsed = false;
  const segments: ParagraphSegment[] = [];

  for (const question of input.questions.slice(0, Math.max(0, through))) {
    const state = byKey.get(question.key);
    // An answer that cleans to nothing ("...") reads as no answer at all.
    const answers = (state?.answers ?? [])
      .map((answer) => ({ text: cleanAnswer(answer.text), note: answer.note }))
      .filter((answer) => answer.text !== "");

    if (answers.length === 0) {
      const open = state?.open === true;
      segments.push({
        kind: "gap",
        question: question.key,
        open,
        text: `${open ? "left open on purpose: " : "open: "}${question.gap}`,
      });
      continue;
    }

    const template =
      answers.length >= 2 && question.sentencePlural !== undefined ? question.sentencePlural : question.sentence;
    // A valid template holds {L} once and {S}, if at all, at its very start.
    const [head, after = ""] = template.split(LIST_TOKEN);
    let before = head;
    if (before.includes(SUBJECT_TOKEN)) {
      before = before.replace(SUBJECT_TOKEN, subjectUsed ? SUBJECT_PRONOUN : subject);
      subjectUsed = true;
    }

    const semicolon = joinsWithSemicolons(answers);
    const parts: ParagraphPart[] = [];
    pushText(parts, before);
    answers.forEach((answer, i) => {
      if (i > 0) pushText(parts, separatorBefore(i, answers.length, semicolon));
      pushText(parts, answer.text);
      if (answer.note) {
        pushText(parts, " (");
        parts.push({ kind: "note", note: answer.note });
        pushText(parts, ")");
      }
    });
    pushText(parts, after);
    segments.push({ kind: "sentence", question: question.key, text: partsText(parts), parts });
  }
  return segments;
}

/** The paragraph as plain text: the sentences joined by single spaces, gaps left out. */
export function paragraphText(segments: readonly ParagraphSegment[]): string {
  return segments
    .filter((segment) => segment.kind === "sentence")
    .map((segment) => segment.text)
    .join(" ");
}
```

- [ ] **Step 5: Write an example's canvas**

Create `lib/arkademy/examples.ts`:

```ts
import type { ArkademyIndex } from "./index-document";
import type { CanvasQuestionState } from "./paragraph";
import { BMC_QUESTION_KEYS } from "./schema";
import type { Company } from "./schema";

/** One example as the pages draw it: the company and its nine questions. */
export interface ExampleCanvas {
  company: Company;
  questions: CanvasQuestionState[]; // nine, canonical order
}

/**
 * An example's canvas, from its uses in `order`, each answer carrying its
 * entity id and its note when it has one. `null` for an id that is not one
 * of the tool's examples — a company outside `tool.examples` has no tour.
 */
export function exampleCanvas(index: ArkademyIndex, companyId: string): ExampleCanvas | null {
  if (!index.tool.examples.includes(companyId)) return null;
  const company = index.company(companyId);
  if (!company) return null;
  return {
    company,
    questions: BMC_QUESTION_KEYS.map((key) => ({
      key,
      answers: index.uses(companyId, key).map((use) =>
        use.note ? { text: use.text, entity: use.entity, note: use.note } : { text: use.text, entity: use.entity },
      ),
      open: index.isOpen(companyId, key),
    })),
  };
}
```

- [ ] **Step 6: Run it and watch it pass**

```bash
npm run test:arkademy-paragraph | tail -1
npm run --silent test:arkademy-paragraph | grep -c '^PASS'
npm run test:arkademy-schema | tail -1
```

Expected: `All arkademy-paragraph tests passed.`; `72`; `All arkademy-schema tests passed.` (part 1's suite loads the same folder, so it now also loads the new modules).

- [ ] **Step 7: The CI step**

In `.github/workflows/ci.yml`, after the step

```yaml
      - name: Arkademy library tests (schema, referential rules, index, upload check)
        run: npm run test:arkademy-schema
```

add (one blank line before it, as between its neighbours):

```yaml

      # The Arkademy cover's pure side (lib/arkademy/): the paragraph rule,
      # an example's canvas, the prompt's display form, the tool paths, each
      # page's metadata, and the sitemap's two Arkademy URLs.
      - name: Arkademy cover tests (paragraph rule, examples, prompt, metadata, sitemap)
        run: npm run test:arkademy-paragraph
```

Then:

```bash
actionlint
npx tsc --noEmit
```

Expected: both silent.

- [ ] **Step 8: Commit**

```bash
git add tests/app/arkademy-paragraph.test.js lib/arkademy/paragraph.ts lib/arkademy/examples.ts package.json .github/workflows/ci.yml
git commit -m "feat(arkademy): the paragraph rule and an example's canvas"
```

---

### Task 3: The prompt, the tool paths, each page's metadata and the sitemap

**Files:**
- Create: `lib/arkademy/prompt.ts`, `lib/arkademy/tools.ts`, `lib/arkademy/metadata.ts`
- Modify: `tests/app/arkademy-paragraph.test.js`, `app/sitemap.ts`

- [ ] **Step 1: Extend the test — the names**

In `tests/app/arkademy-paragraph.test.js`, replace

```js
  exampleCanvas,
} = loadArkademy();
```

with

```js
  exampleCanvas,
  PROMPT_PLACEHOLDER,
  promptForDisplay,
  promptLines,
  ARKADEMY_PATH,
  ARKADEMY_TOOL_PATHS,
  BMC_YOURS_PATH,
  bmcTourPath,
  arkademyToolCards,
  ARKADEMY_SITE_URL,
  ARKADEMY_INTRO,
  BMC_FALLBACK_TITLE,
  arkademyShellMetadata,
  bmcCoverMetadata,
  bmcTourMetadata,
  bmcYoursMetadata,
} = loadArkademy();
```

- [ ] **Step 2: Extend the test — the cases**

In the same file, replace

```js
cleanup();
if (failures > 0) {
```

with

```js
// --- the baseline prompt ----------------------------------------------------------
same("prompt: the placeholder", PROMPT_PLACEHOLDER, "[your paragraph]");
same("prompt: the token is shown as the placeholder", promptForDisplay(`Read ${PROMPT_TOKEN} now`), "Read [your paragraph] now");
same("prompt: a prompt without the token is unchanged", promptForDisplay("No token here"), "No token here");
same(
  "prompt: the fixture's lines",
  promptLines(tool.prompt.text),
  [
    "You are helping me think about a product.",
    "Here is its business model in one paragraph:",
    "",
    "[your paragraph]",
    "",
    "Ask me the one question that would change it most.",
  ],
);
same("prompt: CRLF lines", promptLines("a\r\nb"), ["a", "b"]);

// --- paths and the shell's cards ----------------------------------------------------
same("paths: the shell", ARKADEMY_PATH, "/arkademy");
same("paths: the cover", ARKADEMY_TOOL_PATHS["business-model-canvas"], "/arkademy/business-model-canvas");
same("paths: your own canvas", BMC_YOURS_PATH, "/arkademy/business-model-canvas/yours");
same("paths: a tour", bmcTourPath("crumb-and-co"), "/arkademy/business-model-canvas/tour/crumb-and-co");
same(
  "cards: one per tool with a path",
  arkademyToolCards(document),
  [
    {
      id: "business-model-canvas",
      href: "/arkademy/business-model-canvas",
      title: "Business Model Canvas",
      tagline: tool.tagline,
      exampleCount: 3,
    },
  ],
);
same(
  "cards: a tool without a path gets none",
  arkademyToolCards({ ...document, tools: [{ ...tool, id: "porter-five-forces" }] }),
  [],
);

// --- metadata -------------------------------------------------------------------
{
  same("site: the origin", ARKADEMY_SITE_URL, "https://arkaik.app");
  const shell = arkademyShellMetadata();
  same("shell: title", shell.title, "Arkademy | arkaik");
  same("shell: description", shell.description, ARKADEMY_INTRO);
  same("shell: canonical", shell.alternates.canonical, "https://arkaik.app/arkademy");
  same("shell: Open Graph URL is the canonical", shell.openGraph.url, "https://arkaik.app/arkademy");
  same("shell: Open Graph type and site", [shell.openGraph.type, shell.openGraph.siteName], ["website", "arkaik"]);
  same("shell: twitter card", shell.twitter.card, "summary");
  check("shell: indexed (no robots override)", !("robots" in shell));

  const cover = bmcCoverMetadata(tool);
  same("cover: title", cover.title, "Business Model Canvas | arkaik Arkademy");
  same("cover: description is the tagline", cover.description, tool.tagline);
  same("cover: canonical", cover.alternates.canonical, "https://arkaik.app/arkademy/business-model-canvas");
  same("cover: Open Graph URL", cover.openGraph.url, "https://arkaik.app/arkademy/business-model-canvas");
  check("cover: indexed (no robots override)", !("robots" in cover));
  const coverless = bmcCoverMetadata(null);
  same("cover without a document: fixed title", coverless.title, `${BMC_FALLBACK_TITLE} | arkaik Arkademy`);
  check("cover without a document: a fixed description", typeof coverless.description === "string" && coverless.description.length > 0);
  same("cover without a document: same canonical", coverless.alternates.canonical, cover.alternates.canonical);

  const company = document.companies.find((c) => c.id === "tidewise");
  const tour = bmcTourMetadata("tidewise", { tool, company });
  same("tour: title", tour.title, "Tidewise: Business Model Canvas tour | arkaik Arkademy");
  same("tour: description is the one-liner", tour.description, company.oneLiner);
  same("tour: canonical, without a step", tour.alternates.canonical, "https://arkaik.app/arkademy/business-model-canvas/tour/tidewise");
  same("tour: never indexed", tour.robots, { index: false, follow: false });
  const tourless = bmcTourMetadata("tidewise", null);
  same("tour without a document: fixed title", tourless.title, "Business Model Canvas tour | arkaik Arkademy");
  same("tour without a document: still not indexed", tourless.robots, { index: false, follow: false });
  same(
    "tour: an id is encoded into the canonical",
    bmcTourMetadata("a b", null).alternates.canonical,
    "https://arkaik.app/arkademy/business-model-canvas/tour/a%20b",
  );

  const yours = bmcYoursMetadata(tool);
  same("yours: title", yours.title, "Your Business Model Canvas | arkaik Arkademy");
  same("yours: canonical", yours.alternates.canonical, "https://arkaik.app/arkademy/business-model-canvas/yours");
  same("yours: never indexed", yours.robots, { index: false, follow: false });
  same("yours without a document: fixed title", bmcYoursMetadata(null).title, "Your Business Model Canvas | arkaik Arkademy");
}

// --- the sitemap's source -----------------------------------------------------------
{
  const sitemap = fs.readFileSync(path.join(ROOT, "app", "sitemap.ts"), "utf8");
  check("sitemap: names the shell", sitemap.includes("`${base}/arkademy`"));
  check("sitemap: names the cover", sitemap.includes("`${base}/arkademy/business-model-canvas`"));
  check("sitemap: names no tour", !sitemap.includes("/tour/"));
  check("sitemap: names no canvas of your own", !sitemap.includes("/yours"));
}

cleanup();
if (failures > 0) {
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npm run test:arkademy-paragraph 2>&1 | grep -E '^FAIL|Error' | head -2
```

Expected:

```
FAIL: prompt: the placeholder — expected "[your paragraph]", got undefined
TypeError: promptForDisplay is not a function
```

- [ ] **Step 4: The prompt's display form**

Create `lib/arkademy/prompt.ts`:

```ts
import { PROMPT_TOKEN } from "./schema";

/** What the cover shows, and the copy button copies, where the paragraph goes. */
export const PROMPT_PLACEHOLDER = "[your paragraph]";

/** The baseline prompt with `PROMPT_TOKEN` shown as `PROMPT_PLACEHOLDER`. */
export function promptForDisplay(text: string): string {
  return text.split(PROMPT_TOKEN).join(PROMPT_PLACEHOLDER);
}

/** `promptForDisplay`, one entry per line, for a block that draws lines. */
export function promptLines(text: string): string[] {
  return promptForDisplay(text).split(/\r?\n/);
}
```

- [ ] **Step 5: The tool paths and the shell's cards**

Create `lib/arkademy/tools.ts`:

```ts
import { BMC_TOOL_ID } from "./schema";
import type { ArkademyDocument, ToolId } from "./schema";

/** The Arkademy's own pages. Every tool has a folder of its own under it. */
export const ARKADEMY_PATH = "/arkademy";

/** The cover of each tool the app has pages for. A tool without a path gets no card. */
export const ARKADEMY_TOOL_PATHS: Record<ToolId, string> = {
  [BMC_TOOL_ID]: "/arkademy/business-model-canvas",
};

/** Where a visitor answers the Business Model Canvas for their own product (part 4). */
export const BMC_YOURS_PATH = `${ARKADEMY_TOOL_PATHS[BMC_TOOL_ID]}/yours`;

/** An example's tour, without a step (part 3's `tourHref` adds `?step=`). */
export function bmcTourPath(companyId: string): string {
  return `${ARKADEMY_TOOL_PATHS[BMC_TOOL_ID]}/tour/${encodeURIComponent(companyId)}`;
}

export interface ArkademyToolCard {
  id: ToolId;
  href: string;
  title: string;
  tagline: string;
  exampleCount: number;
}

/** The shell's cards: every tool in the document that has pages, in document order. */
export function arkademyToolCards(document: ArkademyDocument): ArkademyToolCard[] {
  return document.tools
    .filter((tool) => Object.prototype.hasOwnProperty.call(ARKADEMY_TOOL_PATHS, tool.id))
    .map((tool) => ({
      id: tool.id,
      href: ARKADEMY_TOOL_PATHS[tool.id],
      title: tool.title,
      tagline: tool.tagline,
      exampleCount: tool.examples.length,
    }));
}
```

- [ ] **Step 6: Each page's metadata**

Create `lib/arkademy/metadata.ts`:

```ts
import type { Metadata } from "next";

import { BMC_TOOL_ID } from "./schema";
import type { BmcTool, Company } from "./schema";
import { ARKADEMY_PATH, ARKADEMY_TOOL_PATHS, BMC_YOURS_PATH, bmcTourPath } from "./tools";

/**
 * Each Arkademy page's metadata, pure so it is tested (spec § "Metadata,
 * robots and sitemap"). Every page sets its own canonical URL and Open Graph
 * URL: the root layout's point at the home page, and a page inheriting them
 * tells search engines it is a duplicate of `/`. Next replaces a top-level
 * key (`robots`, `openGraph`) whole, so nothing of the root's leaks through.
 */

export const ARKADEMY_SITE_URL = "https://arkaik.app";

/** The shell's line of UI copy, and its meta description. */
export const ARKADEMY_INTRO =
  "Thinking tools for product builders, learned by watching each one applied to real products, then used on your own.";

/** The Business Model Canvas's name when no document can be read. */
export const BMC_FALLBACK_TITLE = "Business Model Canvas";
const BMC_FALLBACK_DESCRIPTION =
  "The Business Model Canvas as nine plain questions, answered by example, then by you.";
const BMC_YOURS_DESCRIPTION =
  "Answer the Business Model Canvas's nine questions for your own product. Your canvas stays in this browser.";

const NOINDEX = { index: false, follow: false };

function arkademyPageMetadata(page: {
  title: string;
  socialTitle: string;
  description: string;
  path: string;
  indexed: boolean;
}): Metadata {
  const url = `${ARKADEMY_SITE_URL}${page.path}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      title: page.socialTitle,
      description: page.description,
      url,
      siteName: "arkaik",
      type: "website",
      locale: "en_US",
    },
    twitter: { card: "summary", title: page.socialTitle, description: page.description },
    ...(page.indexed ? {} : { robots: NOINDEX }),
  };
}

/** `/arkademy`: indexable, fixed copy. */
export function arkademyShellMetadata(): Metadata {
  return arkademyPageMetadata({
    title: "Arkademy | arkaik",
    socialTitle: "Arkademy",
    description: ARKADEMY_INTRO,
    path: ARKADEMY_PATH,
    indexed: true,
  });
}

/** `/arkademy/business-model-canvas`: indexable; fixed copy when no document can be read. */
export function bmcCoverMetadata(tool: BmcTool | null): Metadata {
  const title = tool?.title ?? BMC_FALLBACK_TITLE;
  return arkademyPageMetadata({
    title: `${title} | arkaik Arkademy`,
    socialTitle: title,
    description: tool?.tagline ?? BMC_FALLBACK_DESCRIPTION,
    path: ARKADEMY_TOOL_PATHS[BMC_TOOL_ID],
    indexed: true,
  });
}

/**
 * A tour (part 3): never indexed; the canonical URL drops `?step=`.
 * `found` is null when there is no document or no such example.
 */
export function bmcTourMetadata(companyId: string, found: { tool: BmcTool; company: Company } | null): Metadata {
  const toolTitle = found?.tool.title ?? BMC_FALLBACK_TITLE;
  const socialTitle = found ? `${found.company.name}: ${toolTitle} tour` : `${toolTitle} tour`;
  return arkademyPageMetadata({
    title: `${socialTitle} | arkaik Arkademy`,
    socialTitle,
    description: found?.company.oneLiner ?? BMC_FALLBACK_DESCRIPTION,
    path: bmcTourPath(companyId),
    indexed: false,
  });
}

/** Your own canvas (part 4): never indexed — its server HTML holds nothing but the questions. */
export function bmcYoursMetadata(tool: BmcTool | null): Metadata {
  const socialTitle = `Your ${tool?.title ?? BMC_FALLBACK_TITLE}`;
  return arkademyPageMetadata({
    title: `${socialTitle} | arkaik Arkademy`,
    socialTitle,
    description: BMC_YOURS_DESCRIPTION,
    path: BMC_YOURS_PATH,
    indexed: false,
  });
}
```

- [ ] **Step 7: Run it — only the sitemap is left**

```bash
npm run test:arkademy-paragraph | grep -E '^FAIL|failed'
```

Expected:

```
FAIL: sitemap: names the shell
FAIL: sitemap: names the cover
2 arkademy-paragraph test(s) failed
```

- [ ] **Step 8: The sitemap**

In `app/sitemap.ts`, after the line

```ts
    { url: `${base}/docs/vision`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
```

add:

```ts
    // The Arkademy: the shell and the cover only. Tours and your own canvas are
    // noindex pages (lib/arkademy/metadata.ts) and stay out of the sitemap.
    { url: `${base}/arkademy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/arkademy/business-model-canvas`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
```

- [ ] **Step 9: Run it and watch it pass**

```bash
npm run test:arkademy-paragraph | tail -1
npm run --silent test:arkademy-paragraph | grep -c '^PASS'
npm run test:arkademy-schema | tail -1
npx tsc --noEmit
```

Expected: `All arkademy-paragraph tests passed.`; `114`; `All arkademy-schema tests passed.`; `tsc` silent.

- [ ] **Step 10: Commit**

```bash
git add lib/arkademy/prompt.ts lib/arkademy/tools.ts lib/arkademy/metadata.ts tests/app/arkademy-paragraph.test.js app/sitemap.ts
git commit -m "feat(arkademy): the prompt's display form, the tool paths, each page's metadata and the sitemap"
```

---

### Task 4: The shared pieces — copy, note, paragraph view, canvas grid

No React test runner exists in this repo; these are checked by `tsc`, eslint, the landing suite (for `CodeBlock`) and the visual check of Task 7.

**Files:**
- Modify: `lib/hooks/useCopyId.ts`, `components/landing/previews/CodeBlock.tsx`
- Create: `components/arkademy/CopyButton.tsx`, `components/arkademy/SourcedNote.tsx`, `components/arkademy/ParagraphView.tsx`, `components/arkademy/CanvasGrid.tsx`

- [ ] **Step 1: `useCopyId` names what it copied**

In `lib/hooks/useCopyId.ts`, replace

```ts
 * after the fact.
 */
export function useCopyId(id: string): { copied: boolean; copy: () => void } {
```

with

```ts
 * after the fact.
 *
 * `what` names the copied text in the toast when the text itself is too long
 * to print there — the Arkademy's prompt, a paragraph. It defaults to the text,
 * which is what an id chip wants.
 */
export function useCopyId(id: string, what: string = id): { copied: boolean; copy: () => void } {
```

and replace

```ts
      toast.success(`Copied ${id}`);
```

with

```ts
      toast.success(`Copied ${what}`);
```

- [ ] **Step 2: `CodeBlock` can wrap**

In `components/landing/previews/CodeBlock.tsx`, replace

```tsx
  lines: readonly CodeLine[];
  className?: string;
}
```

with

```tsx
  lines: readonly CodeLine[];
  /** Wrap long lines instead of scrolling sideways (the Arkademy's prompt, which is read rather than skimmed). */
  wrap?: boolean;
  className?: string;
}
```

replace

```tsx
export function CodeBlock({ title, lines, className }: CodeBlockProps) {
```

with

```tsx
export function CodeBlock({ title, lines, wrap = false, className }: CodeBlockProps) {
```

and replace

```tsx
          <div key={i} className={cn("-mx-3 px-3 whitespace-pre", line.kind && LINE_STYLES[line.kind])}>
```

with

```tsx
          <div
            key={i}
            className={cn("-mx-3 px-3", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre", line.kind && LINE_STYLES[line.kind])}
          >
```

- [ ] **Step 3: The copy button**

Create `components/arkademy/CopyButton.tsx`:

```tsx
"use client";

import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCopyId } from "@/lib/hooks/useCopyId";

interface CopyButtonProps {
  /** What goes on the clipboard. */
  text: string;
  /** The button's words, which do not change: "Copy the prompt". */
  label: string;
  /** Names the text in the toast, which would otherwise print it whole: "the prompt" → "Copied the prompt". */
  what: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "sm" | "default";
  className?: string;
}

/**
 * Every Arkademy copy action (the baseline prompt here; the paragraph and the
 * Markdown in part 4). `useCopyId` does the copying: the icon turns to a check
 * for a moment and a toast names what was copied, or says the copy failed.
 */
export function CopyButton({ text, label, what, variant = "outline", size = "sm", className }: CopyButtonProps) {
  const { copied, copy } = useCopyId(text, what);
  return (
    <Button type="button" variant={variant} size={size} onClick={copy} className={className}>
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      {label}
    </Button>
  );
}
```

- [ ] **Step 4: A note, inline**

Create `components/arkademy/SourcedNote.tsx`:

```tsx
import { noteDate } from "@/lib/arkademy/paragraph";
import type { UseNote } from "@/lib/arkademy/schema";

/**
 * A note's content, inline: its text, the source's name as a link, the date —
 * `text; Source, 2026-03-02` or `…, read on 2026-10-01`. Its text content is
 * exactly `noteText(note)`. The paragraph sets it inside parentheses; the
 * canvas grid's full density puts it under its answer.
 */
export function SourcedNote({ note }: { note: UseNote }) {
  return (
    <>
      {note.text};{" "}
      <a
        href={note.source.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="rounded-sm underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {note.source.name}
      </a>
      , {noteDate(note)}
    </>
  );
}
```

- [ ] **Step 5: The paragraph view**

Create `components/arkademy/ParagraphView.tsx`:

```tsx
import { Fragment } from "react";

import { SourcedNote } from "@/components/arkademy/SourcedNote";
import type { ParagraphSegment } from "@/lib/arkademy/paragraph";
import type { BmcQuestionKey } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

interface ParagraphViewProps {
  /** From `composeParagraph`. */
  segments: readonly ParagraphSegment[];
  /**
   * Your own canvas (part 4): each gap becomes a button that goes to its
   * question. Without it gaps are plain text, as on the cover and the tour.
   */
  onSelectQuestion?: (question: BmcQuestionKey) => void;
  className?: string;
}

const GAP =
  "rounded-md border border-dashed border-muted-foreground/45 px-1.5 text-[0.875em] text-muted-foreground box-decoration-clone";

/**
 * A canvas read back as one paragraph: sentences as inline text, each note in
 * smaller muted type inside its parentheses with the source as a link, and
 * each question without answers as an inline dashed pill — "left open on
 * purpose: …" plain, "open: …" on a muted fill.
 *
 * No hooks and no "use client": the cover renders it on the server; a client
 * screen (the tour, your own canvas) renders it with handlers.
 */
export function ParagraphView({ segments, onSelectQuestion, className }: ParagraphViewProps) {
  return (
    <p className={cn("text-[15px] leading-7 break-words text-foreground", className)}>
      {segments.map((segment, i) => (
        <Fragment key={segment.question}>
          {i > 0 && " "}
          {segment.kind === "sentence" ? (
            <span data-question={segment.question}>
              {segment.parts.map((part, j) =>
                part.kind === "text" ? (
                  <Fragment key={j}>{part.text}</Fragment>
                ) : (
                  <span key={j} className="text-[0.875em] text-muted-foreground">
                    <SourcedNote note={part.note} />
                  </span>
                ),
              )}
            </span>
          ) : onSelectQuestion ? (
            <button
              type="button"
              data-question={segment.question}
              onClick={() => onSelectQuestion(segment.question)}
              className={cn(
                GAP,
                !segment.open && "bg-muted",
                "cursor-pointer text-left outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              {segment.text}
            </button>
          ) : (
            <span data-question={segment.question} className={cn(GAP, !segment.open && "bg-muted")}>
              {segment.text}
            </span>
          )}
        </Fragment>
      ))}
    </p>
  );
}
```

- [ ] **Step 6: The canvas grid**

Create `components/arkademy/CanvasGrid.tsx`:

```tsx
import { SourcedNote } from "@/components/arkademy/SourcedNote";
import type { CanvasQuestionState } from "@/lib/arkademy/paragraph";
import type { BmcQuestion, BmcQuestionKey } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

/**
 * Where each block sits in the canonical canvas arrangement, at a container
 * width of 48rem or more. Literal class names, so Tailwind finds them.
 */
const AREA: Record<BmcQuestionKey, string> = {
  seg: "@3xl:[grid-area:seg]",
  vp: "@3xl:[grid-area:vp]",
  ch: "@3xl:[grid-area:ch]",
  cr: "@3xl:[grid-area:cr]",
  rev: "@3xl:[grid-area:rev]",
  kr: "@3xl:[grid-area:kr]",
  ka: "@3xl:[grid-area:ka]",
  kp: "@3xl:[grid-area:kp]",
  cost: "@3xl:[grid-area:cost]",
};

/** The canonical arrangement (the prototype's): kp ka vp cr seg over kr ch, cost beside rev. */
const CANONICAL =
  "@3xl:grid-cols-10 @3xl:[grid-template-areas:'kp_kp_ka_ka_vp_vp_cr_cr_seg_seg'_'kp_kp_kr_kr_vp_vp_ch_ch_seg_seg'_'cost_cost_cost_cost_cost_rev_rev_rev_rev_rev']";

/** How many answers a mini block lists before "+N more". */
export const CANVAS_MINI_ANSWERS = 3;

export interface CanvasGridProps {
  /** The document's nine questions, canonical order: each block's title and number. */
  questions: readonly Pick<BmcQuestion, "key" | "block">[];
  /** Nine, canonical order, matched by key. */
  state: readonly CanvasQuestionState[];
  /** `full` (tour, your canvas): every answer and its note. `mini` (cover cards): three, then "+N more". */
  density: "full" | "mini";
  /** Unique on the page: block headings get the ids `${idPrefix}-${key}`. */
  idPrefix: string;
  /** Names the grid for assistive technology: "Tidewise's canvas". */
  label: string;
  /** 3 under a page's `h2`; 4 inside a card titled by an `h3` (the cover). Default 3. */
  headingLevel?: 3 | 4;
  /** The block that carries a ring: the current question (tour, your canvas). */
  current?: BmcQuestionKey;
  /** 1–9 (tour): blocks after it are drawn faint with only their title. Default 9. */
  through?: number;
  /** Your own canvas (part 4): block titles become buttons that go to the question. */
  onSelectQuestion?: (question: BmcQuestionKey) => void;
}

/**
 * The nine blocks of a canvas. The grid adapts to its container, not the
 * window, so a cover card and a full page both read well: ten columns in the
 * canonical arrangement from 48rem, two in question order from 32rem (from
 * 20rem in the mini density, so a phone-width gallery card is half as tall),
 * one below. Nothing scrolls sideways. Source order is question order, which is
 * what a screen reader follows whatever the arrangement.
 *
 * No hooks and no "use client", like ParagraphView.
 */
export function CanvasGrid({
  questions,
  state,
  density,
  idPrefix,
  label,
  headingLevel = 3,
  current,
  through,
  onSelectQuestion,
}: CanvasGridProps) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const byKey = new Map(state.map((question) => [question.key, question]));
  const mini = density === "mini";
  const shown = through ?? questions.length;

  return (
    <div role="group" aria-label={label} className="@container">
      <div className={cn("grid grid-cols-1 gap-2 @lg:grid-cols-2", mini && "@xs:grid-cols-2", CANONICAL)}>
        {questions.map((question, i) => {
          const entry = byKey.get(question.key);
          const answers = entry?.answers ?? [];
          const open = answers.length === 0 && entry?.open === true;
          const faint = i >= shown;
          const listed = mini ? answers.slice(0, CANVAS_MINI_ANSWERS) : answers;
          const headingId = `${idPrefix}-${question.key}`;
          return (
            <div
              key={question.key}
              role="group"
              aria-labelledby={headingId}
              data-question={question.key}
              className={cn(
                "flex min-w-0 flex-col rounded-lg border bg-background",
                mini ? "gap-1.5 p-2.5" : "gap-2 p-3",
                AREA[question.key],
                open && "border-dashed border-muted-foreground/45",
                faint && "opacity-40",
                question.key === current && "ring-2 ring-ring",
              )}
            >
              <Heading
                id={headingId}
                className={cn("flex items-baseline gap-1.5 font-semibold", mini ? "text-xs" : "text-sm")}
              >
                <span className="font-mono text-[10px] font-normal text-muted-foreground tabular-nums">{i + 1}</span>
                {onSelectQuestion ? (
                  <button
                    type="button"
                    onClick={() => onSelectQuestion(question.key)}
                    className="cursor-pointer rounded-sm text-left outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {question.block}
                  </button>
                ) : (
                  question.block
                )}
              </Heading>
              {faint ? null : answers.length > 0 ? (
                <>
                  <ul
                    className={cn(
                      "flex list-disc flex-col pl-4 break-words marker:text-muted-foreground",
                      mini ? "gap-1 text-xs leading-snug" : "gap-1.5 text-sm leading-snug",
                    )}
                  >
                    {listed.map((answer, j) => (
                      <li key={j}>
                        {answer.text}
                        {!mini && answer.note && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            <SourcedNote note={answer.note} />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {answers.length > listed.length && (
                    <p className="pl-4 text-[11px] text-muted-foreground">+{answers.length - listed.length} more</p>
                  )}
                </>
              ) : (
                <p className={cn("text-muted-foreground", mini ? "text-xs" : "text-sm")}>
                  {open ? "Left open on purpose." : "Not answered yet."}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Check**

```bash
npx tsc --noEmit
npx eslint components/arkademy lib/hooks/useCopyId.ts components/landing/previews/CodeBlock.tsx
npm run test:landing | tail -1
```

Expected: `tsc` and eslint silent; `All landing tests passed.`

- [ ] **Step 8: Commit**

```bash
git add lib/hooks/useCopyId.ts components/landing/previews/CodeBlock.tsx components/arkademy/CopyButton.tsx components/arkademy/SourcedNote.tsx components/arkademy/ParagraphView.tsx components/arkademy/CanvasGrid.tsx
git commit -m "feat(arkademy): the canvas grid, the paragraph view and the copy button"
```

---

### Task 5: The chrome, the shell and the cover

**Files:**
- Create: `components/arkademy/ArkademyChrome.tsx`, `ArkademyBreadcrumb.tsx`, `ArkademyMessage.tsx`, `ToolCard.tsx`, `ExampleCard.tsx`, `PromptBlock.tsx`
- Create: `app/arkademy/layout.tsx`, `app/arkademy/page.tsx`, `app/arkademy/not-found.tsx`, `app/arkademy/business-model-canvas/page.tsx`

- [ ] **Step 1: The chrome**

Create `components/arkademy/ArkademyChrome.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { ARKADEMY_PATH } from "@/lib/arkademy/tools";
import { gochiHand } from "@/lib/fonts";
import { cn } from "@/lib/utils";

/** Every Arkademy page's content column, so the header and the pages line up. */
export const ARKADEMY_COLUMN = "mx-auto w-full max-w-6xl px-4 sm:px-6";

/** Each page's one `h1`, in the handwritten face (the docs and the landing use it the same way). */
export const ARKADEMY_TITLE = cn(gochiHand.className, "text-[2.75rem] leading-[1.05] text-foreground md:text-[3.5rem]");

/** A section's `h2` on an Arkademy page. */
export const ARKADEMY_SECTION_TITLE = "text-2xl font-semibold tracking-tight text-balance";

/**
 * The Arkademy's chrome, rendered once by app/arkademy/layout.tsx around every
 * page under it: the `/p/[id]` header pattern — the arkaik mark home, the word
 * "Arkademy" to the shell, the theme toggle — and the page's `main`.
 *
 * It holds no `h1`; each page renders exactly one. A server component: the
 * only client piece is ThemeToggle.
 */
export function ArkademyChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background font-sans">
      <header className="border-b">
        <div className={cn(ARKADEMY_COLUMN, "flex items-center justify-between gap-4 py-3")}>
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="Go to arkaik home"
              className="inline-flex shrink-0 items-center rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ArkaikLogo className="w-20" />
            </Link>
            <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
            <Link
              href={ARKADEMY_PATH}
              className={cn(
                gochiHand.className,
                "rounded-sm text-[1.6rem] leading-none text-foreground outline-none hover:text-foreground/80 focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              Arkademy
            </Link>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: The breadcrumb**

Create `components/arkademy/ArkademyBreadcrumb.tsx`:

```tsx
import Link from "next/link";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface ArkademyCrumb {
  label: string;
  /** Omitted on the last crumb: the page itself. */
  href?: string;
}

/**
 * The trail above a page deeper than the shell: "Arkademy › Business Model
 * Canvas" on the cover, one more crumb on a tour. Crumbs with an `href` are
 * Next links (client navigation); the one without is the current page.
 */
export function ArkademyBreadcrumb({ trail }: { trail: readonly ArkademyCrumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {trail.map((crumb, i) => (
          <Fragment key={`${i}:${crumb.label}`}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="rounded-sm transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {crumb.label}
                </Link>
              ) : (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
```

- [ ] **Step 3: The states without a library**

Create `components/arkademy/ArkademyMessage.tsx`:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import type { ArkademyLookup } from "@/lib/services/arkademy";

/** Every lookup but `ready`: the reasons a page has no library to show. */
export type ArkademyMessageStatus = Exclude<ArkademyLookup["status"], "ready">;

const MESSAGES: Record<ArkademyMessageStatus, string> = {
  unconfigured: "The Arkademy's library lives in this deployment's database, which is not configured here.",
  empty: "The library is being stocked. Come back soon.",
  invalid: "The Arkademy could not be loaded right now. Please try again shortly.",
  error: "The Arkademy could not be loaded right now. Please try again shortly.",
};

/**
 * What a page shows in place of the library when there is none (spec § "States
 * without a document"). The page keeps its own `h1`; this is the body. In
 * development an empty table also names the command that fills it.
 *
 * No hooks, so a server page or a client screen can render it.
 */
export function ArkademyMessage({ status }: { status: ArkademyMessageStatus }) {
  const showCommand = status === "empty" && process.env.NODE_ENV !== "production";
  return (
    <EmptyState
      message={
        <>
          {MESSAGES[status]}
          {showCommand && (
            <span className="mt-2 block">
              Publish one with <code className="font-mono text-xs text-foreground">npm run arkademy -- publish</code>.
            </span>
          )}
        </>
      }
    />
  );
}
```

- [ ] **Step 4: The shell's card**

Create `components/arkademy/ToolCard.tsx`:

```tsx
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { Card } from "@/components/ui/card";

interface ToolCardProps {
  href: string;
  title: string;
  tagline: string;
  exampleCount: number;
}

/** One tool on the shell (`/arkademy`): the whole card links to the tool's cover. */
export function ToolCard({ href, title, tagline, exampleCount }: ToolCardProps) {
  return (
    <Link
      href={href}
      className="group block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-3 p-5 transition-colors group-hover:border-foreground/25">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{tagline}</p>
        <p className="mt-auto flex items-center gap-1 pt-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          {exampleCount} {exampleCount === 1 ? "example" : "examples"}
          <ChevronRightIcon aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </p>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 5: An example on the cover**

Create `components/arkademy/ExampleCard.tsx`:

```tsx
import type { ReactNode } from "react";

import { CanvasGrid } from "@/components/arkademy/CanvasGrid";
import { ParagraphView } from "@/components/arkademy/ParagraphView";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { composeParagraph, type CanvasQuestionState } from "@/lib/arkademy/paragraph";
import type { BmcQuestion, Company } from "@/lib/arkademy/schema";

interface ExampleCardProps {
  company: Company;
  /** The document's nine questions. */
  questions: readonly BmcQuestion[];
  /** The example's canvas, from `exampleCanvas`. */
  state: readonly CanvasQuestionState[];
  /** Part 3 puts "Play the tour" here. */
  actions?: ReactNode;
}

/**
 * One example in the cover's gallery: the company's name, a "Simulation"
 * badge when it is one, its one-liner, its whole paragraph (notes and their
 * sources included), its mini canvas and its note. Server-rendered, so a
 * crawler reads every word.
 */
export function ExampleCard({ company, questions, state, actions }: ExampleCardProps) {
  const segments = composeParagraph({ questions, state, subject: company.name });
  const headingId = `example-${company.id}`;
  return (
    <Card role="article" aria-labelledby={headingId} className="min-w-0 gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 id={headingId} className="text-xl font-semibold tracking-tight">
              {company.name}
            </h3>
            {company.simulation && <Badge variant="outline">Simulation</Badge>}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{company.oneLiner}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      <ParagraphView segments={segments} className="max-w-[72ch]" />
      <CanvasGrid
        questions={questions}
        state={state}
        density="mini"
        headingLevel={4}
        idPrefix={headingId}
        label={`${company.name}'s canvas`}
      />
      {company.note && <p className="text-xs leading-relaxed text-muted-foreground">{company.note}</p>}
    </Card>
  );
}
```

- [ ] **Step 6: The baseline prompt**

Create `components/arkademy/PromptBlock.tsx`:

```tsx
import { ARKADEMY_SECTION_TITLE } from "@/components/arkademy/ArkademyChrome";
import { CopyButton } from "@/components/arkademy/CopyButton";
import { CodeBlock } from "@/components/landing/previews/CodeBlock";
import { promptForDisplay, promptLines } from "@/lib/arkademy/prompt";

interface PromptBlockProps {
  /** `tool.prompt.label`, the section's `h2`. */
  label: string;
  /** `tool.prompt.text`, PROMPT_TOKEN included. */
  text: string;
}

/**
 * The cover's baseline prompt section: its label as an `h2` beside a copy
 * button, then the text in the landing's mono block, a line per line,
 * wrapped, with the paragraph's place shown as `[your paragraph]`. The button
 * copies exactly what is shown.
 */
export function PromptBlock({ label, text }: PromptBlockProps) {
  return (
    <section aria-labelledby="prompt-title" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="prompt-title" className={ARKADEMY_SECTION_TITLE}>
          {label}
        </h2>
        <CopyButton text={promptForDisplay(text)} label="Copy the prompt" what="the prompt" />
      </div>
      <CodeBlock lines={promptLines(text).map((line) => ({ text: line }))} wrap className="mt-4 bg-card" />
    </section>
  );
}
```

- [ ] **Step 7: The layout**

Create `app/arkademy/layout.tsx`:

```tsx
import type { ReactNode } from "react";

import { ArkademyChrome } from "@/components/arkademy/ArkademyChrome";

/**
 * Every page under /arkademy: the Arkademy's header around the page. The
 * pages read Postgres through lib/services/arkademy.ts, so the segment runs
 * on Node; each page is also `force-dynamic`, so the build never touches the
 * database.
 */
export const runtime = "nodejs";

export default function ArkademyLayout({ children }: { children: ReactNode }) {
  return <ArkademyChrome>{children}</ArkademyChrome>;
}
```

- [ ] **Step 8: The not-found page**

Create `app/arkademy/not-found.tsx`:

```tsx
import Link from "next/link";

import { ARKADEMY_COLUMN, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ARKADEMY_PATH } from "@/lib/arkademy/tools";
import { cn } from "@/lib/utils";

/**
 * What `notFound()` renders under /arkademy (an unknown example's tour, from
 * part 3), inside the Arkademy's chrome: app/arkademy/layout.tsx wraps it.
 */
export default function ArkademyNotFound() {
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-10 pb-24")}>
      <h1 className={ARKADEMY_TITLE}>Not in the library</h1>
      <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-muted-foreground">
        Nothing in the Arkademy answers to this address. The example may have been renamed or removed.
      </p>
      <Link href={ARKADEMY_PATH} className="mt-6 inline-block text-sm underline underline-offset-4 hover:text-foreground">
        Back to the Arkademy
      </Link>
    </div>
  );
}
```

- [ ] **Step 9: The shell**

Create `app/arkademy/page.tsx`:

```tsx
import { ARKADEMY_COLUMN, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { ToolCard } from "@/components/arkademy/ToolCard";
import { ARKADEMY_INTRO, arkademyShellMetadata } from "@/lib/arkademy/metadata";
import { arkademyToolCards } from "@/lib/arkademy/tools";
import { getArkademy } from "@/lib/services/arkademy";
import { cn } from "@/lib/utils";

/**
 * `/arkademy` — the shell: the Arkademy's name, one line on what it is, and a
 * card per tool. The cards are the only part that reads the library.
 * force-dynamic: the library is a runtime fact; the build never reads it.
 */
export const dynamic = "force-dynamic";

export const metadata = arkademyShellMetadata();

export default async function ArkademyShellPage() {
  const lookup = await getArkademy();
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-10 pb-24 sm:pt-14")}>
      <h1 className={ARKADEMY_TITLE}>Arkademy</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">{ARKADEMY_INTRO}</p>
      <section aria-labelledby="arkademy-tools" className="mt-12">
        <h2 id="arkademy-tools" className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Tools
        </h2>
        <div className="mt-4">
          {lookup.status === "ready" ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {arkademyToolCards(lookup.document).map((card) => (
                <li key={card.id}>
                  <ToolCard
                    href={card.href}
                    title={card.title}
                    tagline={card.tagline}
                    exampleCount={card.exampleCount}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ArkademyMessage status={lookup.status} />
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 10: The cover**

Create `app/arkademy/business-model-canvas/page.tsx`:

```tsx
import type { Metadata } from "next";
import { cache } from "react";

import { ArkademyBreadcrumb } from "@/components/arkademy/ArkademyBreadcrumb";
import { ARKADEMY_COLUMN, ARKADEMY_SECTION_TITLE, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { ExampleCard } from "@/components/arkademy/ExampleCard";
import { PromptBlock } from "@/components/arkademy/PromptBlock";
import { exampleCanvas, type ExampleCanvas } from "@/lib/arkademy/examples";
import { indexArkademy } from "@/lib/arkademy/index-document";
import { BMC_FALLBACK_TITLE, bmcCoverMetadata } from "@/lib/arkademy/metadata";
import type { ArkademyDocument } from "@/lib/arkademy/schema";
import { ARKADEMY_PATH } from "@/lib/arkademy/tools";
import { getArkademy } from "@/lib/services/arkademy";
import { cn } from "@/lib/utils";

/**
 * `/arkademy/business-model-canvas` — the cover: the tool's name and tagline,
 * the pitch, the gallery of examples (each with its paragraph and mini
 * canvas), and the baseline prompt to copy. Everything is server-rendered
 * from the library, so a crawler reads it all.
 *
 * The hero's two actions arrive with the pages they lead to: "Play a tour"
 * with part 3, "Start your own" with part 4.
 */
export const dynamic = "force-dynamic";

/** One library read per request: generateMetadata and the page share it. */
const lookupArkademy = cache(getArkademy);

export async function generateMetadata(): Promise<Metadata> {
  const lookup = await lookupArkademy();
  return bmcCoverMetadata(lookup.status === "ready" ? lookup.document.tools[0] : null);
}

export default async function BusinessModelCanvasCoverPage() {
  const lookup = await lookupArkademy();
  const tool = lookup.status === "ready" ? lookup.document.tools[0] : null;
  const title = tool?.title ?? BMC_FALLBACK_TITLE;
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-6 pb-24")}>
      <ArkademyBreadcrumb trail={[{ label: "Arkademy", href: ARKADEMY_PATH }, { label: title }]} />
      <header className="mt-8 max-w-3xl sm:mt-10">
        <h1 className={ARKADEMY_TITLE}>{title}</h1>
        {tool && <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{tool.tagline}</p>}
      </header>
      {lookup.status === "ready" ? (
        <CoverBody document={lookup.document} />
      ) : (
        <div className="mt-10">
          <ArkademyMessage status={lookup.status} />
        </div>
      )}
    </div>
  );
}

function CoverBody({ document }: { document: ArkademyDocument }) {
  const index = indexArkademy(document);
  const { tool } = index;
  const examples = tool.examples
    .map((id) => exampleCanvas(index, id))
    .filter((example): example is ExampleCanvas => example !== null);
  return (
    <>
      <section aria-labelledby="why" className="mt-14 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
        <h2 id="why" className={ARKADEMY_SECTION_TITLE}>
          {tool.pitch.headline}
        </h2>
        <div className="flex max-w-prose flex-col gap-4 text-[15px] leading-relaxed">
          {tool.pitch.body.map((paragraph, i) => (
            <p key={i} className="whitespace-pre-line">
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      <section id="examples" aria-labelledby="examples-title" className="mt-20 scroll-mt-6">
        <h2 id="examples-title" className={ARKADEMY_SECTION_TITLE}>
          Examples
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Examples marked Simulation are built from public information, not from the companies&apos; own records.
        </p>
        <ul className="mt-8 flex flex-col gap-6">
          {examples.map((example) => (
            <li key={example.company.id}>
              <ExampleCard company={example.company} questions={tool.questions} state={example.questions} />
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-20 max-w-3xl">
        <PromptBlock label={tool.prompt.label} text={tool.prompt.text} />
      </div>
    </>
  );
}
```

- [ ] **Step 11: Check**

```bash
npx tsc --noEmit
npx eslint app/arkademy components/arkademy
npm run test:keyboard-shortcuts | tail -1
env -u DATABASE_URL npm run build 2>&1 | grep -E 'arkademy|Compiled'
```

Expected: `tsc` and eslint silent; `All keyboard shortcut tests passed`; the build prints `✓ Compiled successfully` and the routes `├ ƒ /api/arkademy`, `├ ƒ /arkademy`, `├ ƒ /arkademy/business-model-canvas` (`ƒ`: dynamic — the build never reads the database).

- [ ] **Step 12: Commit**

```bash
git add components/arkademy/ArkademyChrome.tsx components/arkademy/ArkademyBreadcrumb.tsx components/arkademy/ArkademyMessage.tsx components/arkademy/ToolCard.tsx components/arkademy/ExampleCard.tsx components/arkademy/PromptBlock.tsx app/arkademy/layout.tsx app/arkademy/page.tsx app/arkademy/not-found.tsx app/arkademy/business-model-canvas/page.tsx
git commit -m "feat(arkademy): the shell and the Business Model Canvas cover"
```

---

### Task 6: The folder maps

**Files:** Modify `docs/architecture.md`, `docs/conventions.md`, `README.md`.

- [ ] **Step 1: `docs/architecture.md`, App Router Structure**

After the lines

```
  p/
    [id]/
      page.tsx          # Publik snapshot preview (server-rendered)
```

add:

```
  arkademy/
    layout.tsx          # The Arkademy's chrome (components/arkademy/ArkademyChrome.tsx); Node runtime
    page.tsx            # /arkademy — the shell: one card per tool in the library
    not-found.tsx       # notFound() under /arkademy, inside the chrome
    business-model-canvas/
      page.tsx          # The cover: pitch, gallery of examples (paragraph + mini canvas), baseline prompt
```

- [ ] **Step 2: `docs/architecture.md`, Component Map**

Before the line `  publik/                   # PublishDialog, ImportSnapshotButton` add:

```
  arkademy/                 # The Arkademy's pages (/arkademy): server-rendered from the library (lib/services/arkademy.ts)
    ArkademyChrome.tsx      # Header (arkaik mark, "Arkademy", theme toggle) + main; the page column and title classes
    ArkademyBreadcrumb.tsx  # The trail above pages deeper than the shell
    ArkademyMessage.tsx     # What a page shows when the library is unconfigured, empty, invalid or unreadable
    ToolCard.tsx            # One tool on the shell
    ExampleCard.tsx         # One example on the cover: name, Simulation badge, paragraph, mini canvas, note
    ParagraphView.tsx       # A canvas as one paragraph (lib/arkademy/paragraph.ts): sentences, sourced notes, gap pills
    CanvasGrid.tsx          # The nine blocks, full or mini, laid out by container queries
    SourcedNote.tsx         # A use's note: its text, the source as a link, the date
    PromptBlock.tsx         # The baseline prompt with its copy button
    CopyButton.tsx          # Every Arkademy copy action (useCopyId)
```

- [ ] **Step 3: `docs/conventions.md`, File Organization**

After the line `  publik/ sync/ auth/   # Share, Synk backup, sign-in surfaces` add:

```
  arkademy/             # The Arkademy's pages: chrome, cards, paragraph, canvas grid, prompt
```

Before the line `  services/             # Server-only: hosted graph store, publik, synk, auth, GitHub App` add:

```
  arkademy/             # The Arkademy library: schema, validation, paragraph rule, metadata — pure, imports only zod and its siblings (never `@/`)
```

- [ ] **Step 4: `README.md`, Folder Structure**

After the line `  p/[id]/                     # Publik snapshot preview` add:

```
  arkademy/                   # The Arkademy: thinking tools by example (/arkademy, the Business Model Canvas cover)
```

After the line `  publik/ sync/ settings/     # Share dialog, Synk status, product/repo/token managers` add:

```
  arkademy/                   # The Arkademy's chrome, example cards, paragraph, canvas grid, prompt block
```

Before the line `  hooks/                      # useNodes, useEdges, useProject, useJournal, etc.` add:

```
  arkademy/                   # The Arkademy library's schema, validation, paragraph rule and metadata (pure)
```

- [ ] **Step 5: Check and commit**

```bash
npm run test:docs-visibility | tail -1
git add docs/architecture.md docs/conventions.md README.md
git commit -m "docs(arkademy): the shell, the cover and their components in the folder maps"
```

Expected: `All docs-visibility tests passed`.

---

### Task 7: The whole part, as CI sees it, and the visual check

No new files.

- [ ] **Step 1: The build job's gates**

```bash
rm -rf .next
actionlint
npm run lint 2>&1 | grep problems
npx tsc --noEmit
env -u DATABASE_URL npm run build 2>&1 | grep -E 'arkademy|Compiled'
npm run generate > /dev/null && git status --porcelain
npm run test:arkademy-paragraph | tail -1
npm run test:arkademy-schema | tail -1
npm run test:keyboard-shortcuts | tail -1
npm run test:landing | tail -1
npm run test:docs-visibility | tail -1
```

Expected: `actionlint` silent; `✖ 3 problems (0 errors, 3 warnings)` (main's own); `tsc` silent; the three `ƒ` Arkademy routes; `git status --porcelain` prints nothing; `All arkademy-paragraph tests passed.`; `All arkademy-schema tests passed.`; `All keyboard shortcut tests passed`; `All landing tests passed.`; `All docs-visibility tests passed`.

If a Node 20 binary is available, run the two Arkademy suites with it too (`<node20> tests/app/arkademy-paragraph.test.js | tail -1`, same for `arkademy-schema`): the same two lines.

- [ ] **Step 2: The services job's gate**

With the scratch Postgres of § "Local Postgres and a dev server" up and migrated:

```bash
npm run test:arkademy-api | tail -1
npm run --silent arkademy -- publish tests/fixtures/arkademy/document.json | tail -1
```

Expected: `All arkademy-api integration tests passed.` (it truncates the table), then a line starting `published v1 (10.1 KB, 1 warning)` (part 1 owns the rest of its wording).

- [ ] **Step 3: The dev server**

```bash
rm -rf .next
PORT=4861 npm run dev
```

Run it in the background (the Bash tool's `run_in_background`), with `DATABASE_URL` set to the scratch database. Then:

```bash
for i in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code}' http://localhost:4861/arkademy | grep -q 200 && break; sleep 2; done
curl -s http://localhost:4861/arkademy/business-model-canvas | grep -o 'border-muted-foreground/45' | head -1
```

Expected: `border-muted-foreground/45` (the served page carries this part's classes; if not, see the stale-server trap).

- [ ] **Step 4: Screenshots, metadata, scroll, console**

Use a Playwright install outside the repo (reuse one in your scratchpad if it exists; otherwise `npm install playwright && npx playwright install chromium` in a scratchpad folder, never in the repo). Save as `shots.js` in the scratchpad:

```js
// node shots.js <base> <outdir> <tag> <path>[,<path>…]   (PW=<folder holding node_modules/playwright>)
const { chromium } = require(process.env.PW + "/node_modules/playwright");
const [base, out, tag, pathsArg] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    for (const width of [400, 900, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
      for (const p of pathsArg.split(",")) {
        const page = await ctx.newPage();
        const errors = [];
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(base + p, { waitUntil: "networkidle" });
        const m = await page.evaluate(() => ({
          hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          h1: document.querySelectorAll("h1").length,
          title: document.title,
          canonical: document.querySelector("link[rel=canonical]")?.href,
          robots: document.querySelector("meta[name=robots]")?.content,
        }));
        const name = `${tag}${p.replace(/\//g, "_")}-${width}-${scheme}.png`;
        await page.screenshot({ path: `${out}/${name}`, fullPage: true });
        console.log(name, JSON.stringify({ ...m, errors }));
        await page.close();
      }
      await ctx.close();
    }
  }
  await browser.close();
})();
```

```bash
PW=<playwright folder> node shots.js http://localhost:4861 <shots folder> fixture /arkademy,/arkademy/business-model-canvas
```

Expected, for each of the twelve lines: `"hscroll":false`, `"h1":1`, `"errors":[]`; the shell's title `Arkademy | arkaik` and canonical `https://arkaik.app/arkademy`; the cover's `Business Model Canvas | arkaik Arkademy` and `https://arkaik.app/arkademy/business-model-canvas`; `robots` `index, follow` on both.

Open and read the screenshots. What they must show (as in the rehearsal):
- the header: the arkaik mark, a thin rule, "Arkademy" in the handwritten face, the theme toggle at the right; the cover's breadcrumb "Arkademy › Business Model Canvas";
- the shell: the handwritten "Arkademy" `h1`, one line of copy, a small mono "TOOLS", one card "Business Model Canvas" with its tagline and "3 EXAMPLES ›";
- the cover: the handwritten title, the tagline; the pitch headline beside its two paragraphs at 1440 (stacked at 400 and 900); "Examples" with its Simulation line; three cards, Crumb & Co with a "Simulation" badge and its note at the bottom; Tidewise's paragraph with a dashed pill "left open on purpose: where the money comes from" and the note "(predictions for 412 harbours, refreshed every season; Tidewise, product page, 2026-03-02)" in smaller muted type with the source underlined; Inkwell's note ending "read on 2026-10-01"; each mini canvas in the canonical arrangement at 900 and 1440 (Key partners left, Customer segments right, Cost structure and Revenue streams along the bottom), two columns in question order at 400; Crumb & Co's Key activities showing three answers and "+2 more"; Tidewise's Revenue streams block dashed with "Left open on purpose."; "A baseline prompt" with "Copy the prompt" beside it, and the prompt in the mono block with `[your paragraph]` on its own line;
- dark mode: the same on the dark tokens, blocks darker than their card.

- [ ] **Step 5: The copy button and the keyboard**

Save as `interact.js` in the scratchpad and run it (`PW=<playwright folder> node interact.js http://localhost:4861`):

```js
const { chromium } = require(process.env.PW + "/node_modules/playwright");
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await page.goto(process.argv[2] + "/arkademy/business-model-canvas", { waitUntil: "networkidle" });
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    console.log(await page.evaluate(() => {
      const el = document.activeElement;
      return `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim()}"`;
    }));
  }
  const button = page.getByRole("button", { name: "Copy the prompt" });
  await button.click();
  await page.waitForTimeout(200);
  console.log(JSON.stringify(await page.evaluate(() => navigator.clipboard.readText())));
  console.log(await page.locator("[data-sonner-toast]").first().textContent());
  console.log(await button.locator("svg").getAttribute("class"));
  await page.waitForTimeout(1700);
  console.log(await button.locator("svg").getAttribute("class"));
  await browser.close();
})();
```

Expected:

```
a "Go to arkaik home"
a "Arkademy"
button "Toggle theme"
a "Arkademy"
a "Tidewise, product page"
a "Inkwell, pricing page"
button "Copy the prompt"
"You are helping me think about a product.\nHere is its business model in one paragraph:\n\n[your paragraph]\n\nAsk me the one question that would change it most."
Copied the prompt
lucide lucide-check
lucide lucide-copy
```

- [ ] **Step 6: The states without a library**

Each needs the page reloaded, not the server restarted (development reads Postgres per request):

```bash
psql -q "$DATABASE_URL" -c "insert into arkademy_documents (version, format_version, document, sha256, size_bytes) values (99, 99, '{}'::jsonb, 'x', 2)"
curl -s http://localhost:4861/arkademy/business-model-canvas | grep -o 'could not be loaded right now. Please try again shortly.' | head -1
psql -q "$DATABASE_URL" -c "truncate arkademy_documents"
curl -s http://localhost:4861/arkademy | grep -o 'being stocked. Come back soon.' | head -1
curl -s http://localhost:4861/arkademy | grep -o 'npm run arkademy -- publish' | head -1
```

Expected: the three phrases. Screenshot both pages in this state with `shots.js` (tag `empty`): a dashed card under the page's own `h1`, "The library is being stocked. Come back soon." and "Publish one with `npm run arkademy -- publish`."

Then stop the dev server (kill only its `next dev --port 4861` process and its `next-server` child), and start it again **without** `DATABASE_URL` (`env -u DATABASE_URL PORT=4861 npm run dev`, background; make sure no `.env.local` sets it). Expected: `/arkademy` and the cover show "The Arkademy's library lives in this deployment's database, which is not configured here." (screenshot tag `nodb`); twelve lines with `"hscroll":false`, `"h1":1`, `"errors":[]`.

- [ ] **Step 7: Clean up**

```bash
lsof -nP -iTCP:4861 -sTCP:LISTEN          # note the PID; kill it and its parent `next dev --port 4861`
pg_ctl -D "$PGSCRATCH/data" stop
lsof -nP -iTCP:4861 -sTCP:LISTEN; lsof -nP -iTCP:5861 -sTCP:LISTEN
rm -rf .next
git status --porcelain
```

Expected: `server stopped`; both `lsof` print nothing; `git status --porcelain` prints nothing.

## Part done when

On `feat/arkademy-cover`, alone (without parts 3 and 4), each of these passes:

```bash
actionlint                                   # no output
npm run lint                                 # 0 errors (main's 3 warnings stay)
npx tsc --noEmit                             # no output (rm -rf .next first after a branch switch)
npm run build                                # succeeds; ƒ /arkademy, ƒ /arkademy/business-model-canvas
npm run generate && git status --porcelain   # prints nothing
npm run test:arkademy-paragraph              # 114 PASS, "All arkademy-paragraph tests passed."
npm run test:arkademy-schema                 # passes (loads the new modules too)
npm run test:keyboard-shortcuts              # passes
npm run test:landing                         # passes
npm run test:docs-visibility                 # passes
DATABASE_URL=… npm run test:arkademy-api     # passes (local Postgres, migrated)
```

and the visual check of Task 7 shows the pages described there at 400, 900 and 1440 px, light and dark, with no sideways scroll, one `h1`, no console error, the copy button putting the displayed prompt on the clipboard, and the keyboard reaching the header links, the breadcrumb, each note's source and the copy button in that order.

`git diff --stat <part 1 tip>..HEAD` lists exactly 28 files: `.github/workflows/ci.yml`, `README.md`, `app/arkademy/business-model-canvas/page.tsx`, `app/arkademy/layout.tsx`, `app/arkademy/not-found.tsx`, `app/arkademy/page.tsx`, `app/sitemap.ts`, `components/arkademy/ArkademyBreadcrumb.tsx`, `components/arkademy/ArkademyChrome.tsx`, `components/arkademy/ArkademyMessage.tsx`, `components/arkademy/CanvasGrid.tsx`, `components/arkademy/CopyButton.tsx`, `components/arkademy/ExampleCard.tsx`, `components/arkademy/ParagraphView.tsx`, `components/arkademy/PromptBlock.tsx`, `components/arkademy/SourcedNote.tsx`, `components/arkademy/ToolCard.tsx`, `components/landing/previews/CodeBlock.tsx`, `docs/architecture.md`, `docs/conventions.md`, `lib/arkademy/examples.ts`, `lib/arkademy/metadata.ts`, `lib/arkademy/paragraph.ts`, `lib/arkademy/prompt.ts`, `lib/arkademy/tools.ts`, `lib/hooks/useCopyId.ts`, `package.json`, `tests/app/arkademy-paragraph.test.js`. `git log --oneline <part 1 tip>..HEAD` shows the five commits of Tasks 2–6.

**PR:** push with `gh stack submit --auto` (draft PRs; part 1's PR is created too if it does not exist yet), then set this part's PR:

- Title: `feat(arkademy): the shell and the Business Model Canvas cover (part 2/4)`
- Body: what the part adds (the `/arkademy` shell, the cover with its pitch, gallery and baseline prompt, the chrome and the states without a library, each page's canonical URL, two sitemap entries); that the cover has no action buttons until parts 3 and 4; that `useCopyId` and `CodeBlock` each gained one optional argument; the screenshots' description from Task 7. **No `## Lab Note` section** — the single note ships with part 4. End the body with the attribution lines your session's instructions give.
- Label: `gh pr edit <number> --add-label no-lab-note`.
- After opening, read the PR's comments: the Lab Note reminder must be satisfied by the label, and CI must be green, including the new "Arkademy cover tests" step.

---

## For the planners of parts 3 and 4

What these parts need that the spec does not say. Each was seen in this part's rehearsal.

- **The layout draws the chrome.** A page under `app/arkademy/` renders only its column: `<div className={cn(ARKADEMY_COLUMN, "pt-6 pb-24")}>`, an `ArkademyBreadcrumb`, one `h1` with `ARKADEMY_TITLE`. Do not render `ArkademyChrome` again.
- **Read the library once per request** with `const lookupArkademy = cache(getArkademy);` at module level, called by both `generateMetadata` and the page (the cover does exactly this). Narrow on `lookup.status === "ready"` in the JSX and hand the other four statuses to `ArkademyMessage`, keeping the page's `h1` (`BMC_FALLBACK_TITLE` when there is no tool).
- **Server components with handlers.** `ParagraphView` and `CanvasGrid` take `onSelectQuestion`; pass it only from a client component. They have no hooks on purpose; a client screen wraps them.
- **Ids must be unique on a page.** `CanvasGrid` needs `idPrefix` (its block headings' ids are `${idPrefix}-${key}`); on a page with one grid any constant works.
- **The tour's canonical** is `bmcTourMetadata(companyId, …)`, i.e. `bmcTourPath(companyId)` on `https://arkaik.app`; `tourHref(companyId, step?)` should return `bmcTourPath(companyId)` plus `?step=N`, so the two agree. Part 3 adds "Play the tour" through `ExampleCard`'s `actions` and "Play a tour" (to `#examples`) in the cover's `<header>`, after the tagline.
- **`notFound()` in `next dev`** logs one extra console error (a script tag re-rendered on the client); `next start` does not. A "zero console errors" check of an unknown tour must use a production server, or allow that one line.
- **The dev server may not see edits** in a worktree under `/private/tmp`: restart it and `rm -rf .next/dev` before each screenshot round, and `curl` the page for a class you just added.
- **A long paragraph is fine.** The gallery was checked with a stress example of about 6,500 characters and five notes at 400 px: it wraps, nothing scrolls sideways. A tour's paragraph grows by one sentence per step; give it the same `ParagraphView`.
- **The mini density is two columns from 20rem; the full density one column below 32rem**, as the spec says. Part 3's tour on a phone shows the full grid in one column.
