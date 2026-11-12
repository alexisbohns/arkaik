# Arkademy and the Business Model Canvas — design

**Date:** 2026-11-12
**Status:** decisions taken with the product owner; this document checks them
against `main` at `eff7386` and settles everything the code decides. The open
questions at the end each carry a recommendation the plan can follow if the
owner does not answer.
**Prototype:** the "Nine questions" page of the tool lab (`bmc-b.html`, its
data contract `schemas/bmc-questions.md`, its examples in `companies.js`),
kept outside the repository. It pictures the intent: the nine questions as
worded, the paragraph rule, the mini canvas, "left open on purpose". Its
stylesheet (`lab.css`), its record-derived suggestions and its `source` ids
are not carried over.

## Goal

Give product builders a place outside their projects where they learn a
thinking method by watching it applied, then apply it themselves. The
**Arkademy** is that place; its first tool is the **Business Model Canvas as
nine plain questions**. The tool has a cover page that pitches it and shows a
gallery of example canvases with their paragraphs, an animated tour that
fills one example's canvas step by step, and a screen where a visitor answers
the same nine questions for their own product, with inspirations drawn from
a shared library of typed entities.

The library is data, not code: one versioned JSON document in Postgres,
uploaded by a script from a folder that git ignores, read by the app through
one server module and one public route, and validated against a schema that
lives in the repository.

## Non-goals

- Accounts, or saving a visitor's canvas anywhere but their own browser.
- Any model-generated help (suggestions, rewording, scoring).
- Links between an answer and an Arkaik project's acceptances, decisions,
  deliverables or findings (the prototype's `source`), and suggestions derived
  from a project's records.
- A second tool (Elements of Value, Porter's forces, …). § "What a later tool
  adds" says what the format leaves room for, without designing it.
- French, or any locale but English.
- Editing the library inside the app. The owner edits JSON and uploads it.
- An entry point: no sidebar row, no landing-page link, no ⌘K command.
- Moving an answer from one question to another (the prototype had it). In
  your own canvas, remove it and add it again.
- Pruning old library versions, and pushing a cache purge from the upload
  script.

## Decisions restated

These were taken with the owner and are not reopened here. Where the code
complicates one, the complication is in § "Verified facts" and, if it needs
the owner, in § "Settled questions".

- **D1 Access.** Public, no sign-in, for everything in this release.
- **D2 Your canvas** is saved in this browser only. No user data in the
  database.
- **D3 Content is never committed.** The library JSON stays in a gitignored
  folder on the owner's machine; a repository script uploads it; the app reads
  it from the database only, in development as in production.
- **D4 Storage.** One table holding the library as one versioned JSON
  document, one public read route, a schema in the repository. Each upload
  replaces the whole document and keeps the previous ones for rollback.
- **D5 Model.** `tools` (the BMC: its nine questions, the pitch, the baseline
  prompt), `companies` (id, name, one-liner, a simulation note), `entities`
  (id, kind, neutral label) and `uses` (company, question, entity, the
  company's own wording, order). Nine entity kinds, one per question.
- **D6 Inspirations** are computed: entities of the question's kind, most
  shared first, each naming its companies; one click adds it as an answer
  the visitor can reword.
- **D7** No `source` links, no project-derived suggestions.
- **D8 Library at launch:** eleven examples (Arkaik, Pebbles, Notion, Figma,
  Linear, Cal.com, PayFit, Livestorm, teale, Anthropic, Oxymore), simulations
  except the owner's own projects.
- **D9 Pages:** `/arkademy` (shell), `/arkademy/business-model-canvas`
  (cover), the tour, your own canvas.
- **D10 Search engines:** shell and cover indexable; per-company tour pages
  not.
- **D11 Entry point:** by URL only in the first release.
- **D12 Stack:** four parts — (1) schema, table, route, upload script;
  (2) shell and cover; (3) tour; (4) your own canvas with inspirations.
- **D13 Out of scope:** see Non-goals.

## Verified facts

Every claim was read in the worktree at `eff7386`. **Complication** marks a
fact that changes how a decision is carried out; the change this spec makes
follows it.

### F1 — How public pages outside a project are built

- The root layout (`app/layout.tsx:71-110`) wraps every route in
  `ThemeProvider`, `QueryProvider`, `AppToaster` and `SyncProvider`, loads
  Geist Sans and Mono (`:2-3`, `:79`), and applies the reader's stone skins
  before first paint (`:81-86`, `lib/stones/preferences.ts`). `app/globals.css:1-4`
  imports the stone and wobble CSS globally. Any page under `app/arkademy/`
  therefore inherits theme, fonts, tokens and stones with no work.
- There is no shared "public page" shell. `/p/[id]` defines its own
  `PageChrome` inline — `ArkaikLogo` linking to `/`, `ThemeToggle`, a bordered
  header (`app/p/[id]/page.tsx:87-99`), repeated in `app/p/[id]/not-found.tsx:12-31`.
  `/docs` uses the shadcn sidebar (`app/docs/layout.tsx:20-31`). The landing
  page builds its own header and footer (`app/page.tsx:38-79`).
- The handwritten face for page titles is `gochiHand` from `lib/fonts.ts`,
  used by `DocsArticle` (`components/docs/DocsArticle.tsx:35-40`) and the
  landing hero (`app/page.tsx:58`).
- Primitives available in `components/ui/`: badge, breadcrumb, button (with
  `stone` and `stone-secondary` variants, `components/ui/button.tsx:23-27`),
  card, checkbox, collapsible, dialog, empty-state, input, label, separator,
  skeleton, textarea, tooltip, among others. `useCopyId(text)`
  (`lib/hooks/useCopyId.ts`) copies any string with a confirmation mark and a
  toast, despite its name.
- `components/landing/previews/CodeBlock.tsx` renders a titled mono block from
  lines of text; the landing uses it for prompt excerpts.

### F2 — The root metadata leaks a canonical URL into every page

- `app/layout.tsx:16-46` sets `alternates.canonical: "https://arkaik.app"` and
  `openGraph.url: "https://arkaik.app"` at the root. No docs page overrides
  them (`app/docs/page.tsx:8-15`, `app/docs/[...slug]/page.tsx:20-28`), so
  every docs page declares the home page as its canonical.
- **Complication (D10).** A cover that inherits that canonical tells search
  engines it is a duplicate of the home page, which defeats "indexable".
  **Change:** every Arkademy page sets its own `alternates.canonical` and
  `openGraph.url`.
- `noindex` precedent: `/p/[id]` returns `robots: { index: false, follow: false }`
  from `generateMetadata` (`app/p/[id]/page.tsx:73-75`); `app/auth/error/page.tsx:23`
  sets `robots: { index: false }`.
- `public/robots.txt` is a static file allowing everything; there is no
  `app/robots.ts`. `app/sitemap.ts:4-18` lists ten fixed URLs.

### F3 — Postgres, migrations and the production run

- Server code reaches Postgres through `lib/services/db.ts`: a lazy `pg` pool
  (`:72-84`), `query()` with parameters only (`:91-96`), `withTransaction`
  (`:140-153`), `servicesConfigured()` = `DATABASE_URL` is set (`:22-24`), and
  `servicesUnavailable(name)` = a 503 JSON body (`:34-42`). The app builds and
  serves with no `DATABASE_URL`.
- Migrations are `db/migrations/NNN_name.sql`, applied in filename order, each
  in a transaction, recorded in `_migrations` (`db/migrate.mjs:41-97`). Files
  use `create table if not exists` so they also serve as self-hosting scripts
  (`db/migrations/001_publik_snapshots.sql:1-9`). The last one is
  `012_graph_events_time_index.sql`; no remote branch carries a `013_`.
- `.github/workflows/migrate-prod.yml` runs `npm run db:migrate` against
  `secrets.PROD_DATABASE_URL` on every push to `main` that touches
  `db/migrations/**` (`:22-25`). Merging part 1 therefore creates the table in
  production with no manual step.
- Hand-run scripts that write production data exist:
  `scripts/migrate/status-vocabulary.js` reads `DATABASE_URL` from the
  environment, loads TypeScript through
  `scripts/generate/load-schema-package.js` (transpile into a build directory
  inside the repo so `require("zod")` resolves), and takes `--dry-run`.

### F4 — The closest public read routes, and caching

- `GET /api/publik/{id}` (`app/api/publik/[id]/route.ts:19-37`) is public,
  `force-dynamic`, reads Postgres on every request, sets no cache header and
  is not rate-limited. Rate limiting exists only on Publik's writes
  (`app/api/publik/route.ts:43-52`), and it is a Postgres transaction per
  request (`lib/services/publik.ts:283-322`).
- The only route that sets `Cache-Control` is `app/llms-full.txt/route.ts:76`
  (`public, max-age=3600, s-maxage=86400`).
- Weak ETags and `If-None-Match` handling exist for hosted reads:
  `formatReadEtag` and `ifNoneMatchSatisfied` (`lib/services/graph/etag.ts:32`,
  `:147`).
- Nothing in `app/`, `lib/` or `components/` uses `unstable_cache`,
  `revalidate`, `"use cache"` or `revalidateTag`. `next.config.ts` does not
  enable `cacheComponents`. Next 16's own docs
  (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md`)
  mark `unstable_cache` as replaced by `"use cache"` but it remains the
  documented path without Cache Components
  (`…/02-guides/caching-without-cache-components.md`).
- `lib/services/db.ts:99-107` warns against putting a database probe on a hot
  path because it keeps a scale-to-zero database awake. Production is Neon
  (`lib/services/db.ts:9-14`).
- **Complication (D3, D4).** A public page that reads Postgres on every view
  costs database wake-ups and transfer for every anonymous visitor and
  crawler. **Change:** one cached loader (§ "Server loader and caching");
  the route adds HTTP caching on top.
- **Complication (D3).** "The app reads it only through a route": the
  repository's server pages read Postgres in-process rather than calling their
  own HTTP routes (`app/p/[id]/page.tsx:22-24`, "same process, no HTTP
  self-call"). **Change:** pages and route share one server loader; the route
  is the public contract for everything that is not a page. Settled question 1.
- Not verified from the repository: whether the production CDN caches a route
  handler's response on `s-maxage`. Part 1 checks it after deploy
  (§ "The read route").

### F5 — Where the schema can live

- `@arkaik/schema` (`packages/schema`) is workspace-private TypeScript that
  the published `arkaik` CLI and `arkaik-mcp` server bundle with esbuild
  (`packages/cli/build.js:6-15`, `:90`, `:105`; `packages/mcp/build.js:5-9`),
  is MIT-licensed as the format's adoption channel (`CONTRIBUTING.md:7`), and
  feeds generated artifacts that CI diff-checks (`.github/workflows/ci.yml:38-39`).
  The app, `lib/` and `app/api/` are AGPL (`CONTRIBUTING.md:8`).
- `zod` 4.4.3 is declared only by `packages/schema/package.json`; the root
  `package.json` does not declare it, and no file under `app/`, `lib/` or
  `components/` imports it today. It resolves from the workspace's hoisted
  `node_modules`.

### F6 — Tests, loaders and CI

- CI's `build` job runs Node 20 (`.github/workflows/ci.yml:29`) and every
  DB-free suite; the `services` job runs Postgres 16, migrates twice (the
  second run is the idempotency gate) and runs the DB-backed suites
  (`:372-429`).
- TypeScript reaches Node tests through loaders that transpile with the
  `typescript` package into gitignored `.test-build-*` directories, rewriting
  `@/…` specifiers through hand-maintained tables
  (`tests/services/load-publik-api.js:41-122`,
  `tests/app/load-screen-wall.js:20-55`). A new `@/` import that a table does
  not know fails the suite at load, before any check prints. `server-only` is
  stubbed (`tests/services/load-publik-api.js:66-70`).
- `tests/fixtures/run-fixture-tests.js:19-32` lists its fixtures explicitly, so
  a new JSON file under `tests/fixtures/` is not picked up by it.
- `tests/app/keyboard-shortcuts.test.js:189-201` fails on any
  `window.addEventListener("keydown"` or `document.addEventListener("keydown"`
  outside two allowlisted files; every global shortcut is a row in
  `lib/utils/keyboard-shortcuts.ts` registered through `useShortcut`. The ⌘?
  sheet is mounted only in the project layout and the docs search
  (`app/project/[id]/layout.tsx`, `components/docs/DocsSearch.tsx`).
- A lucide icon the repo has never used dirties generated artifacts
  (`lib/wobble/wobble-registry.generated.ts`, `app/wobble.generated.css`), so
  every UI part runs `npm run generate` before its PR.

### F7 — Browser storage and URLs

- Per-viewer preferences are written to `localStorage` directly by their
  hooks under `arkaik:`-prefixed keys: `arkaik:stones`
  (`lib/stones/preferences.ts:17`), `arkaik:display-prefs:`
  (`lib/hooks/useDisplayPreferences.ts:47`), `arkaik:overview-layout`
  (`lib/hooks/useOverviewLayout.ts:8`). `useStonePreferences` follows the
  `storage` event (`lib/hooks/useStonePreferences.ts:46`).
- `docs/conventions.md:199` forbids writing project data to `localStorage` or
  IndexedDB outside the `DataProvider`. A canvas is not project data, so the
  rule does not apply; the canvas still gets exactly one writer
  (§ "Your own canvas").
- Cosmetic URL changes use `window.history.replaceState`, not
  `router.replace` (`app/projects/page.tsx:341-348`); Next 16 syncs it with
  `useSearchParams` (`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md:340-411`).
- Reduced motion is read with
  `window.matchMedia("(prefers-reduced-motion: reduce)")`
  (`components/graph/WallCamera.tsx:57`).

### F8 — The prototype's data

- The Arkaik and Pebbles entries live inline in `bmc-b.html`; the other nine
  are in `companies.js`. Together they hold 247 answers (224 + 12 + 11), at
  most 82 characters each, plus about 140 "suggestions" that this design
  replaces with inspirations.
- **Complication (D5).** Five examples leave a question open on purpose
  (Notion, Cal.com and teale leave `cost` open; Oxymore and Pebbles leave
  `rev` open). The decided model has no place for that, and the tour must show
  it. **Change:** the document gains an `open` list (§ "Types").
- The prototype's paragraph needs, per question, a sentence template, a
  "gap" phrase for unanswered questions, the canvas block's title and a hint
  (`bmc-b.html`, the `Q` array). These are words, so they live in the
  document with the question, not in code.

### F9 — The self-map

`seed/arkaik-self-map.json` has 231 nodes and none for the Arkademy, the
Business Model Canvas or anything they touch. The Lab Notes below therefore
omit `nodes:`; adding Arkademy views and flows to the self-map is a separate
seed change.

## The library document

### Where the schema lives

In the app, as `lib/arkademy/schema.ts`, not in `@arkaik/schema`.

- The package is the portable product-graph format: MIT, bundled into two
  published npm packages, mirrored into generated artifacts that CI
  diff-checks (F5). The Arkademy model is none of that. It is app content, it
  is expected to break with each new tool, and nothing outside the app reads
  it except over the public route.
- Putting it in the package would version every Arkademy change through the
  CLI and MCP releases and the generated JSON Schema for no reader's benefit.
- Part 1 adds `"zod": "^4.4.3"` to the root `package.json` dependencies, so the
  app declares what it imports (F5).

`lib/arkademy/` holds only modules with no `@/` imports — they import each
other by relative path (`./schema`) and `zod` — so one test loader can
transpile the folder by discovery with no alias table (§ "Testing"). React and
server code live elsewhere.

### Types

The shape below is the contract. The zod schema implements it with
`z.strictObject` everywhere, so an unknown key is an error at upload (a typo
must not silently drop data).

```ts
// lib/arkademy/schema.ts
export const ARKADEMY_FORMAT_VERSION = 1;
export const BMC_TOOL_ID = "business-model-canvas";
export type ToolId = typeof BMC_TOOL_ID;

/** Canonical order: the order the questions are asked and the paragraph reads. */
export const BMC_QUESTION_KEYS = ["seg", "vp", "ch", "cr", "rev", "kr", "ka", "kp", "cost"] as const;
export type BmcQuestionKey = (typeof BMC_QUESTION_KEYS)[number];

export const ENTITY_KINDS = [
  "segment", "value-proposition", "channel", "relationship", "revenue-stream",
  "resource", "activity", "partner", "cost",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const BMC_QUESTION_KIND = {
  seg: "segment", vp: "value-proposition", ch: "channel", cr: "relationship",
  rev: "revenue-stream", kr: "resource", ka: "activity", kp: "partner", cost: "cost",
} as const satisfies Record<BmcQuestionKey, EntityKind>;

export const ANSWER_MAX_LENGTH = 140;
export const MAX_ANSWERS_PER_QUESTION = 5;
export const MAX_DOCUMENT_BYTES = 1_048_576; // 1 MiB of JSON text
export const PROMPT_TOKEN = "{{paragraph}}";

export interface ArkademyDocument {
  formatVersion: 1;
  tools: [BmcTool];          // format 1 holds exactly one tool
  companies: Company[];      // 1–100
  entities: Entity[];        // 0–5000
  uses: Use[];               // 0–10000
  open: OpenQuestion[];      // questions an example leaves open on purpose
}

export interface BmcTool {
  id: "business-model-canvas";
  title: string;             // 1–60, e.g. "Business Model Canvas"
  tagline: string;           // 1–160, the shell card and the meta description
  pitch: {
    headline: string;        // 1–120
    body: string[];          // 1–6 paragraphs, each 1–800
  };
  prompt: {
    label: string;           // 1–60, the block's title on the cover
    text: string;            // 1–4000, newlines allowed, PROMPT_TOKEN at most once
  };
  questions: BmcQuestion[];  // exactly nine, keys in BMC_QUESTION_KEYS order
  examples: string[];        // company ids, 1–24, unique: gallery and tour order
}

export interface BmcQuestion {
  key: BmcQuestionKey;
  block: string;             // 1–40, the canvas block title, "Customer segments"
  prompt: string;            // 1–160, the question, "Who is this for?"
  hint: string;              // 0–300, shown under the question
  gap: string;               // 1–60, completes "open: …", "who it is for"
  sentence: string;          // 1–160, template, see § "The paragraph"
  sentencePlural?: string;   // 1–160, used when the question has two answers or more
}

export interface Company {
  id: string;                // slug
  name: string;              // 1–40, opens sentences: "Notion is for …"
  oneLiner: string;          // 1–200
  simulation: boolean;       // true: built from public information, not the company's records
  note?: string;             // 1–400, shown wherever the example is shown
}

export interface Entity {
  id: string;                // slug, permanent once published
  kind: EntityKind;
  label: string;             // neutral wording, the wording rules below
}

export interface Use {
  tool: ToolId;
  company: string;           // Company.id
  question: BmcQuestionKey;
  entity: string;            // Entity.id
  text: string;              // this company's own wording, the wording rules below
  order: number;             // integer ≥ 0, ascending within (tool, company, question)
  note?: UseNote;            // a sourced fact about this company's case, § "Notes on a use"
}

export const NOTE_MAX_LENGTH = 200;

export interface UseNote {
  text: string;              // 1–200, the fact, "about $5.6B in the second quarter of 2026"
  source: {
    name: string;            // 1–80, who says so, "Anthropic, press release"
    url: string;             // https only, the page that states it
    date: string;            // YYYY-MM-DD
    dateKind: "published" | "accessed";  // the page's own date, or the day an undated page was read
  };
}

export interface OpenQuestion {
  tool: ToolId;
  company: string;
  question: BmcQuestionKey;
}
```

Two refinements of D5 are in this shape, both forced by the data: `open` (F8),
and `tool` on uses and open questions, because question keys are only unique
within a tool. `simulation` is a boolean beside the free-text `note` so the
pages can show a consistent "Simulation" badge without parsing prose.

### Notes on a use

Added on 2026-11-12 at the owner's request. Three things are kept apart: what
the thing is (the entity, neutral and shareable), how this company words it
(the use's `text`), and a fact about this company's case (the use's `note`).
A figure, a date, a named supplier or anything a reader could ask "says who?"
about belongs in a note, never in `text` or in a label. So "compute and
infrastructure" stays an entity several companies can share, and a company's
reported spend on it is a note on that company's use.

- A note always has a source: a name, an `https` link and a date. The date is
  the one the source carries (`dateKind: "published"`: a filing, a press
  release, a dated article); for a page that shows no date (a pricing page, an
  About page) it is the day the page was read (`dateKind: "accessed"`), and
  the pages say "read on" before it. A fact with no source a reader can open is left out of the
  library; there is no unsourced note.
- A note belongs to one use. It is never shown on an entity, in the
  inspirations, or on another company's use of the same entity, and adding an
  inspiration to your own canvas copies the entity and its label only.
- Your own canvas has no notes in this MVP; `CanvasQuestionState` carries them
  only for examples.
- Where an example's answer is shown with room (the tour's answer list, the
  cover's canvas block when expanded), the note sits under the answer in
  smaller text, followed by the source's name as a link and its date. In the
  paragraph it follows the answer in parentheses, § "The paragraph". Links to
  sources open in a new tab with `rel="noopener noreferrer nofollow"`.

### Field constraints

- **Notes** (`Use.note`): `text` is 1–200 characters (`NOTE_MAX_LENGTH`),
  single line, trimmed, with no parentheses and no trailing punctuation
  (it is set inside parentheses); `source.name` is 1–80 characters, single
  line; `source.url` parses as a URL with the `https:` protocol and is at most
  500 characters; `source.dateKind` is required and is one of the two values;
  `source.date` matches `YYYY-MM-DD`, is a real calendar date
  and is not in the future at upload time (a warning, not an error, since the
  check depends on the clock).

- **Slugs** (`Company.id`, `Entity.id`): `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1–64
  characters. Company ids are URL segments (`/tour/{id}`).
- **Text fields** are trimmed (no leading or trailing whitespace) and, except
  `pitch.body[]` and `prompt.text`, single-line (no `\n` or `\r`).
- **Wordings** (`Use.text`, `Entity.label`): 1–140 characters
  (`ANSWER_MAX_LENGTH`, the prototype input's own limit), single line,
  trimmed, not ending in `.`, `!`, `?`, `;`, `:` or `,`.
- **Templates** (`sentence`, `sentencePlural`): contain `{L}` exactly once;
  contain `{S}` at most once and, when present, at the very start; do not start
  with `{L}`; contain no other `{…}` token; `sentencePlural`, when present,
  uses `{S}` if and only if `sentence` does.
- **Prompt:** `PROMPT_TOKEN` appears at most once in `prompt.text`.

### Referential rules

`validateArkademyDocument` (`lib/arkademy/validate.ts`) runs the zod parse,
then these rules. Each finding names a JSON path (`uses[12].entity`).

Errors (the upload is refused):

1. Ids are unique within `companies` and within `entities`.
2. `tools[0].questions` lists the nine keys once each, in canonical order.
3. Every `examples[]` entry names a company, with no duplicates.
4. Every use names an existing tool, a company listed in that tool's
   `examples`, a question key, and an existing entity whose `kind` equals
   `BMC_QUESTION_KIND[question]`.
5. Within one `(tool, company, question)`: at most `MAX_ANSWERS_PER_QUESTION`
   uses, distinct `order` values, distinct entities.
6. Every open question names an existing tool, a listed example and a key; no
   duplicates; never a question that also has uses for that company.
7. The document's JSON text is at most `MAX_DOCUMENT_BYTES`.

Warnings (printed, the upload proceeds):

- An example covers neither by uses nor by `open` some question. The pages
  cope (the paragraph shows "open: …"), but a tour reads better complete.
- An entity has no use. It never appears as an inspiration.
- A wording (`Use.text` or `Entity.label`) contains a digit followed by `%`, a
  currency sign or code (`$`, `€`, `£`, `USD`, `EUR`), or the words
  `reported`, `reportedly` or `according to`: such a fact probably belongs in
  a sourced note.
- A note's `source.date` is in the future.
- Two entities of one kind share a label, compared case-insensitively.
- A wording starts with a capitalised opener (`The`, `A`, `An`, `We`, `It`,
  `Our`, `Nothing`, `Free`), contains a first-person pronoun (`we`, `our`,
  `us`, `I`, `my`) as a word, or starts with `and`, `or` or `but`. These come
  from the prototype's validator; a wording can only be judged by reading the
  paragraph.

```ts
export type ArkademyFinding = { level: "error" | "warning"; path: string; message: string };
export type ArkademyValidation =
  | { ok: true; document: ArkademyDocument; warnings: ArkademyFinding[] }
  | { ok: false; errors: ArkademyFinding[]; warnings: ArkademyFinding[] };
export function validateArkademyDocument(input: unknown): ArkademyValidation;
```

Content rules that no validator can check, for whoever writes the library:
an entity id is permanent once uploaded (a visitor's browser may hold it,
§ "Your own canvas"); relabelling is free. Two companies share an entity by
pointing at the same id with their own `text`.

### The index

Pages need lookups the arrays do not give. `lib/arkademy/index-document.ts`
(part 1, because validation builds the same maps):

```ts
export interface ArkademyIndex {
  document: ArkademyDocument;
  tool: BmcTool;
  company(id: string): Company | undefined;
  entity(id: string): Entity | undefined;
  /** Uses of one example's question, sorted by `order`. */
  uses(company: string, question: BmcQuestionKey): Use[];
  isOpen(company: string, question: BmcQuestionKey): boolean;
  /** Ids of the examples using an entity, in `tool.examples` order. */
  usersOf(entity: string): string[];
}
export function indexArkademy(document: ArkademyDocument): ArkademyIndex;
```

The index never crosses to the client; server pages project it to plain
props (§ "Pages").

### Format version and upgrades

`formatVersion` is a literal. The app reads exactly the formats it has an
upgrade path for, and the upload script writes only the current one. A
breaking change to the shape ships, in the same PR, the new schema, an
upgrade function from the previous format (`upgradeArkademyDocument`), and
the bump; the loader upgrades a stored older document on read. The deployed
app is therefore never left with a stored document it cannot show, whichever
of "deploy" and "upload" happens first.

### What a later tool adds

Without designing it: `tools` becomes a union discriminated on `id`; the new
tool brings its own question keys and its `…_QUESTION_KIND` map; new entity
kinds join `ENTITY_KINDS` if its questions need them; uses and open questions
already carry `tool`; companies are shared across tools as they are. The
factorisation the owner anticipates — a partner in the canvas being a
supplier in Porter's forces, a value proposition matching an Elements of
Value entry — is one entity id used by two tools' uses, which this format
already allows once two tools share a kind. Expect the BMC tool's own shape to
move when that happens; the version bump and upgrade function exist for it.
The table, the route and the upload script do not change.

## Storage, route and upload

### The table

`db/migrations/013_arkademy_documents.sql`, plain Postgres, idempotent like
its siblings:

```sql
create table if not exists arkademy_documents (
  version        int         primary key check (version > 0),
  format_version int         not null,
  document       jsonb       not null,
  sha256         text        not null,   -- of the canonical JSON text uploaded
  size_bytes     int         not null,
  note           text,
  restored_from  int         references arkademy_documents (version),
  uploaded_at    timestamptz not null default now()
);
```

The current document is the row with the highest `version`. History is
append-only: an upload and a rollback both insert a row. The primary key is
the only index needed (`order by version desc limit 1`). Every version is
kept; at the size the prototype's data suggests (estimated 100–250 KB per
version, unverified until the content exists) that is not worth pruning in
this release.

### Server loader and caching

`lib/services/arkademy.ts` (server-only, beside `publik.ts`):

```ts
export type ArkademyLookup =
  | { status: "unconfigured" }                     // no DATABASE_URL
  | { status: "empty" }                            // table has no row
  | { status: "invalid"; version: number }         // stored row fails today's schema
  | { status: "error" }                            // Postgres failed
  | { status: "ready"; version: number; uploadedAt: string; document: ArkademyDocument };

export const ARKADEMY_CACHE_SECONDS = 300;
export async function readCurrentArkademy(): Promise<StoredArkademyRow | null>; // one query, uncached
export async function getArkademy(): Promise<ArkademyLookup>;
export function arkademyEtag(version: number): string; // formatReadEtag(["arkademy", String(version)])
```

- `getArkademy` returns `unconfigured` before touching anything when
  `servicesConfigured()` is false.
- In production it reads through
  `unstable_cache(fn, ["arkademy-current"], { revalidate: ARKADEMY_CACHE_SECONDS, tags: ["arkademy"] })`.
  The cached function reads the row, upgrades and validates the document, and
  returns plain JSON (`uploadedAt` as an ISO string, since the cache
  serialises). A thrown error is not cached; `getArkademy` catches it outside
  the cache, logs the message (never the document), and returns `error`.
- In development (`NODE_ENV !== "production"`) it reads Postgres directly, so
  an upload shows on the next reload.
- A new upload is therefore live in production within five minutes. Nothing
  calls `revalidateTag`: the upload script runs outside the app, and a purge
  endpoint would need a secret this release does not want.
- Pages wrap it in React's `cache()` per request, as `/p/[id]` does
  (`app/p/[id]/page.tsx:44-53`), so `generateMetadata` and the page share one
  call.

One cache refill reads the document once per five minutes, whatever the
traffic. That is why there is no rate limit: a limiter in Postgres
(the Publik pattern, F4) would put a database write on every anonymous read,
which is exactly the cost the cache removes.

### The read route

`GET /api/arkademy` (`app/api/arkademy/route.ts`, `runtime = "nodejs"`,
`dynamic = "force-dynamic"`), public, no parameters:

| Lookup | Status | Body | `Cache-Control` |
|---|---|---|---|
| `ready` | 200 | `{ "version": 7, "uploaded_at": "…", "format_version": 1, "document": { … } }` | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| `ready`, `If-None-Match` matches | 304 | none | same |
| `empty` | 404 | `{ "error": "no_document", "message": "No Arkademy document has been uploaded yet." }` | `public, max-age=60, s-maxage=60` |
| `unconfigured` | 503 | `servicesUnavailable("Arkademy")` | `no-store` |
| `invalid` | 500 | `{ "error": "document_invalid", "message": "…" }` | `no-store` |
| `error` | 500 | `{ "error": "internal_error", "message": "Failed to load the Arkademy." }` | `no-store` |

Every 200 and 304 carries `ETag: W/"arkademy.<version>"`, compared with
`ifNoneMatchSatisfied` (`lib/services/graph/etag.ts:147`). The document is the
validated one (after upgrade), not the stored bytes. JSON keys follow the
repository's API style (`uploaded_at`, `format_version`); the document keeps
its own camelCase.

The route is the contract for agents, scripts and anything outside the
pages; the pages read `getArkademy` in-process (F4, settled question 1). After
part 1 deploys, check `curl -sI https://arkaik.app/api/arkademy` twice: a
second response served from the CDN cache confirms `s-maxage` is honoured;
if it is not, the `unstable_cache` layer alone still protects the database.

### The upload script

`scripts/arkademy/upload.js`, CommonJS like `scripts/migrate/status-vocabulary.js`,
run by hand by the owner. It loads `lib/arkademy/*.ts` through
`scripts/arkademy/load-arkademy-lib.js`, a copy of the
`scripts/generate/load-schema-package.js` technique that transpiles the folder
into `scripts/arkademy/.build/` (gitignored) so `require("zod")` resolves from
the workspace. The npm script is `"arkademy": "node scripts/arkademy/upload.js"`.

```
npm run arkademy -- check   [file]                  validate only, no database
npm run arkademy -- publish [file] [--note "…"] [--yes]
npm run arkademy -- status                           the last ten versions
npm run arkademy -- rollback [--to N] [--yes]
```

`file` defaults to `$ARKADEMY_CONTENT`, then `arkademy-content/arkademy.json`
under the repository root.

**Authentication.** The script reads `DATABASE_URL` from the environment, as
`db/migrate.mjs` does, and exits with a clear message when it is unset. For
production that is the production connection string (the value behind
Vercel's production `DATABASE_URL` and the `PROD_DATABASE_URL` Actions
secret). Pass it inline or with Node's `--env-file` pointing at a
`.env.*.local` file, which `.gitignore` already covers (`.env*`). Before
writing, the script prints the target host and database name (never the
password) and, when the host is not `localhost` or `127.0.0.1`, refuses to
write without `--yes`.

**`publish`, in order.** Read the file; refuse above `MAX_DOCUMENT_BYTES`;
parse JSON; run `validateArkademyDocument`; print every warning; on any error
print the errors and exit 1 with nothing written. Serialise the validated
document with `JSON.stringify` (the schema's key order, so the text is
canonical for one schema version) and hash it with SHA-256. In one
transaction, read the current version and hash; if the hash is equal, print
`unchanged (vN)` and exit 0; otherwise insert `version = current + 1` with
`format_version`, the size and the note. Two concurrent publishes collide on
the primary key and the loser exits 1. Print
`published vN (… KB, W warnings) — live within 5 minutes`.

**`rollback`.** The target is `--to N`, or by default the newest version below
the current one whose hash differs from the current hash. The script
re-validates the target's document against today's schema (refusing if it no
longer passes), then inserts it as a new version with
`restored_from = N` and `note = "rollback to vN"`. A rollback is itself
undoable the same way.

**`status`.** Prints version, `uploaded_at`, size, the first 8 characters of
the hash, `restored_from` and the note, newest first.

For tests the script exports `publishDocument(client, document, { note })`,
`rollbackDocument(client, { to })` and `listVersions(client, limit)`, each
taking a connected `pg.Client`; `main()` runs only when
`require.main === module`.

### The content folder

`arkademy-content/` at the repository root, with `/arkademy-content/` added to
`.gitignore`. It holds `arkademy.json` and whatever drafts the owner keeps
beside it; the script reads one file. A gitignored folder belongs to one
checkout — a git worktree does not see the main checkout's ignored files — so
the owner keeps the content in his main checkout and, from anywhere else,
passes its path or sets `ARKADEMY_CONTENT`.

Local development runs the same path as production: `npm run db:migrate`
against the local Postgres in `.env.local`, then `npm run arkademy -- publish`.

## Pages

### Routes

```
app/arkademy/layout.tsx                                  chrome; runtime "nodejs"
app/arkademy/page.tsx                                    the shell                 /arkademy
app/arkademy/not-found.tsx                               unknown example, inside the chrome
app/arkademy/business-model-canvas/page.tsx              the cover                 /arkademy/business-model-canvas
app/arkademy/business-model-canvas/tour/[example]/page.tsx   a tour                /arkademy/business-model-canvas/tour/{companyId}[?step=1..9]
app/arkademy/business-model-canvas/yours/page.tsx        your own canvas           /arkademy/business-model-canvas/yours[?step=1..9]
app/api/arkademy/route.ts                                the read route            /api/arkademy
```

Every page is a server component with `dynamic = "force-dynamic"` that calls
`getArkademy` through `cache()`: the build never touches the database, and the
data cache makes each request cheap. The tool's folder is static, not a
`[tool]` segment; a second tool adds its own folder. `lib/arkademy/tools.ts`
maps tool ids to their paths for the shell's cards
(`ARKADEMY_TOOL_PATHS: Record<ToolId, string>`).

### Chrome, and what is reused

`components/arkademy/ArkademyChrome.tsx` is the `/p/[id]` header pattern
(F1): `ArkaikLogo` linking to `/`, then the word "Arkademy" linking to
`/arkademy`, `ThemeToggle` at the right, a bottom border; below it a
`Breadcrumb` (`components/ui/breadcrumb.tsx`) on pages deeper than the shell.
The chrome holds no `h1`; each page has exactly one.

Reused as they are: the root layout's theme, fonts, tokens and stones;
`gochiHand` for each page's `h1`; `Button` (the `stone` variant on the one
special action per page, "Start your own", plain variants elsewhere), `Card`,
`Badge` ("Simulation"), `Input`, `Checkbox` (stone when checked, through the
stone skins), `Dialog` (start over), `Skeleton`, `EmptyState`, `Tooltip`;
`useCopyId` for every copy button; `CodeBlock` for the baseline prompt.
Colours come from the theme tokens (`bg-background`, `bg-card`, `border`,
`text-muted-foreground`, `ring`); none of `lab.css`'s variables (`--good`,
`--warn`, `--accent`) is carried over. "Open on purpose" is drawn with a
dashed border and muted text, not a warning colour.

New: everything under `components/arkademy/` and `lib/arkademy/`, the hooks
named in the parts, and the page files.

### States without a document

`components/arkademy/ArkademyMessage.tsx` renders inside the chrome:

| Lookup | Shell, cover, tour, yours |
|---|---|
| `unconfigured` | "The Arkademy's library lives in this deployment's database, which is not configured here." |
| `empty` | "The library is being stocked. Come back soon." In development only, a second line names `npm run arkademy -- publish`. |
| `invalid`, `error` | "The Arkademy could not be loaded right now. Please try again shortly." |

An unknown `[example]` calls `notFound()`. Your own canvas without a document
still offers to download a saved draft's raw JSON when one exists in the
browser, so nothing a visitor typed is stranded.

### The shell

`/arkademy`: `h1` "Arkademy"; one line of UI copy (code, like the landing's
copy) saying it gathers thinking tools learned through worked examples; one
`Card` per tool in the document that also has a path in
`ARKADEMY_TOOL_PATHS`, showing `title`, `tagline` and "N examples", linking to
the cover. The card list is the only part that reads the document.

### The cover

`/arkademy/business-model-canvas`, top to bottom:

1. **Hero.** `h1` = `tool.title`; `tool.tagline`; the two actions, which the
   parts add as their pages exist: "Play a tour" (part 3, an in-page link to
   `#examples`) and "Start your own" (part 4, `stone` variant, labelled
   "Continue your canvas" when a draft exists in this browser).
2. **Why.** `pitch.headline` as an `h2`, `pitch.body` as paragraphs.
3. **Examples** (`id="examples"`). One standing line of UI copy: examples
   marked Simulation are built from public information, not from the
   companies' own records. Then one card per `tool.examples` entry, in that
   order: the company's `name` as an `h3`, a "Simulation" badge when
   `simulation`, the `oneLiner`, the full paragraph (§ "The paragraph"), the
   mini canvas (§ "The canvas grid"), the `note` in small muted text, and — from
   part 3 — "Play the tour" linking to its tour.
4. **The baseline prompt.** `prompt.label` as an `h2`, `prompt.text` in a
   `CodeBlock`, one line per text line, with `PROMPT_TOKEN` shown as
   `[your paragraph]`; a copy button copies the same text with that
   placeholder. Its role, stated by the pitch: the paragraph a canvas produces
   is a baseline any agent prompt can start from. The words are content.

Everything on the cover is server-rendered from the document, so the pitch,
the examples and their paragraphs are in the HTML a crawler receives.

### Metadata, robots and sitemap

Built by pure helpers in `lib/arkademy/metadata.ts` (types only from
`next`), so they are testable:

| Page | `title` | `description` | `robots` | `alternates.canonical` |
|---|---|---|---|---|
| Shell | `Arkademy \| arkaik` | fixed UI copy | inherited (index) | `https://arkaik.app/arkademy` |
| Cover | `{tool.title} \| arkaik Arkademy` | `tool.tagline` | inherited (index) | `https://arkaik.app/arkademy/business-model-canvas` |
| Tour | `{company.name}: {tool.title} tour \| arkaik Arkademy` | `company.oneLiner` | `{ index: false, follow: false }` | the tour URL without `step` |
| Yours | `Your {tool.title} \| arkaik Arkademy` | fixed UI copy | `{ index: false, follow: false }` | the page URL |

Shell and cover also set `openGraph` (`title`, `description`, `url` = the
canonical, `type: "website"`, `siteName: "arkaik"`) and `twitter`
(`card: "summary"`), overriding the root's home-page values (F2). There is no
share image in this release; the root has none either. When the document is
missing, the cover falls back to fixed copy. Your own canvas is not indexed:
its server HTML holds nothing but the questions.

`app/sitemap.ts` gains `/arkademy` (monthly, 0.6) and
`/arkademy/business-model-canvas` (monthly, 0.7), in part 2. `public/robots.txt`
is unchanged: tour pages are kept out with the `noindex` meta, which a
`Disallow` would hide from crawlers.

## The paragraph

`lib/arkademy/paragraph.ts`, pure, from the prototype's `renderStmt`, with
the sentence words moved into the document:

```ts
export interface CanvasQuestionState {
  key: BmcQuestionKey;
  answers: { text: string; entity?: string; note?: UseNote }[];  // in display order
  open: boolean;                                   // ignored when answers is non-empty
}
/** A sentence in pieces, so a page can render a note's source as a link. */
export type ParagraphPart =
  | { kind: "text"; text: string }
  | { kind: "note"; note: UseNote };
export type ParagraphSegment =
  | { kind: "sentence"; question: BmcQuestionKey; text: string; parts: ParagraphPart[] }
  | { kind: "gap"; question: BmcQuestionKey; open: boolean; text: string };

export const SUBJECT_PRONOUN = "It";
export const DEFAULT_SUBJECT = "This product";
export function cleanAnswer(text: string): string;
export function joinAnswers(texts: readonly string[]): string;
export function composeParagraph(input: {
  questions: readonly BmcQuestion[];          // the document's nine, canonical order
  state: readonly CanvasQuestionState[];      // nine, canonical order
  subject: string;                            // company name, or the visitor's product name
  through?: number;                           // 1–9, default 9: questions after it are omitted
}): ParagraphSegment[];
export function noteText(note: UseNote): string;
export function paragraphText(segments: readonly ParagraphSegment[]): string;
```

The rule:

1. **Clean.** `cleanAnswer` trims and removes trailing full stops and
   whitespace: `text.trim().replace(/[.\s]+$/, "")`.
2. **Join.** One item reads as itself. With two or more, the separator is
   `"; "` if any item contains a comma, else `", "`; all but the last are
   joined with the separator, then `" and "` (comma case) or `"; and "`
   (semicolon case) precedes the last. So `a and b`, `a, b and c`,
   `a; and b`, `a; b; and c`.
3. **Subject.** `subject` is trimmed; if empty it becomes `DEFAULT_SUBJECT`.
   The first sentence whose template contains `{S}` uses the subject; every
   later one uses `SUBJECT_PRONOUN`. A template without `{S}` does not consume
   the subject.
4. **Each question, in canonical order, up to `through`:**
   - with answers: the template is `sentencePlural` when there are two answers
     or more and it exists, else `sentence`; `{S}` and `{L}` are replaced
     (the joined, cleaned answers); the segment is a `sentence`.
   - without answers: a `gap` segment whose text is
     `"left open on purpose: " + gap` when `open`, else `"open: " + gap`.
5. **Notes.** An answer with a note reads as the cleaned answer, a space, then
   the note in parentheses. `noteText(note)` is the plain form of what goes
   inside them: `note.text + "; " + note.source.name + ", " + date`, where `date` is
   `note.source.date` when `dateKind` is `"published"` and
   `"read on " + note.source.date` when it is `"accessed"`
   (so `compute and infrastructure (about $5.6B in the second quarter of 2026;
   Example Source, 2026-08-14)`). The join rule (2) chooses its separator from
   the cleaned answers alone, never from note text. A sentence segment's
   `parts` hold the same sentence cut at each note: `text` parts for the
   words, including the parentheses, and one `note` part where each note's
   content goes, so a page renders the note's text followed by the source's
   name as a link and its date. Concatenating the parts, with each `note` part
   rendered by `noteText`, gives the segment's `text` exactly. A sentence with
   no note has a single `text` part.
6. **Text.** `paragraphText` joins the `sentence` segments with single spaces
   and leaves the gaps out. It is what every copy and export uses.

On screen, sentences are inline text and gaps are inline dashed pills (buttons
that go to that question in your own canvas; plain text elsewhere). With the
prototype's words in the document — `"{S} is for {L}."`,
`"On money: {L}."`, `"The main cost is {L}."` with plural
`"The main costs are {L}."` — this reproduces the prototype's paragraph
exactly.

`lib/arkademy/examples.ts` (part 2) turns an example into the same state:
`exampleCanvas(index, companyId): { company: Company; questions: CanvasQuestionState[] } | null`,
answers taken from its uses in `order`, each carrying its entity id and its note when it has one.

## The canvas grid

`components/arkademy/CanvasGrid.tsx` renders nine blocks from
`CanvasQuestionState[]` and the document's block titles, with two densities:

- **`full`** (tour, your canvas): every answer; each block an element labelled
  by its `h3`, answers as a list; empty blocks say "Left open on purpose." or
  "Not answered yet."; in the tour, blocks after the current step are drawn
  faint with only their title.
- **`mini`** (cover cards): smaller type; at most three answers per block, then
  "+N more".

Layout uses Tailwind's container queries, so the grid adapts to its card as
well as to the window: at a container width of 48rem or more, ten columns in
the canonical canvas arrangement —
`"kp kp ka ka vp vp cr cr seg seg" / "kp kp kr kr vp vp ch ch seg seg" / "cost cost cost cost cost rev rev rev rev rev"`
— from the prototype; from 32rem, two columns in question order; below, one
column. Nothing scrolls sideways (the global `overscroll-behavior` on
horizontal scrollers traps the wheel). The current question's block carries a
`ring`.

## The tour

### URL and arrival

`/arkademy/business-model-canvas/tour/{companyId}`, optionally `?step=N`,
`N` an integer 1–9 (`parseStepParam(raw: string | string[] | undefined): number | null`;
anything else reads as absent). `tourHref(companyId, step?)` builds it.

- **No `step`:** the server renders step 1 at its first phase (the question,
  no answers yet); on the client the tour starts playing. Under reduced motion
  it shows step 1 complete and paused instead.
- **`?step=N`:** step N complete and paused. A link to a step is a citation.
- Every step change rewrites the URL to `?step=N` with
  `window.history.replaceState` (F7) — autoplay included, so a reload or a
  shared link lands on the step being watched. `replaceState`, not
  `pushState`: nine history entries would make Back useless.

The page passes the client the example's `CanvasQuestionState[]`, the nine
questions, the company and the initial state. The gallery's "Play the tour"
is the chooser; there is no separate picker route.

### State and timing

`lib/arkademy/tour.ts`, pure:

```ts
export const TOUR_TIMING = { questionMs: 900, answerMs: 700, sentenceMs: 900, dwellMs: 2200 } as const;
export function stepTimeline(answerCount: number): {
  answersAt: number[];   // questionMs + i * answerMs, for each answer
  sentenceAt: number;    // questionMs + answerCount * answerMs
  dwellAt: number;       // sentenceAt + sentenceMs
  total: number;         // dwellAt + dwellMs
};
export function stepView(answerCount: number, elapsed: number): {
  visibleAnswers: number; sentenceShown: boolean; complete: boolean;
};

export interface TourState { step: number; playing: boolean; elapsed: number; ended: boolean }
export type TourAction =
  | { type: "play" } | { type: "pause" } | { type: "next" } | { type: "back" }
  | { type: "goto"; step: number } | { type: "tick"; ms: number } | { type: "hidden" };
export function createTourReducer(answerCounts: readonly number[]): (s: TourState, a: TourAction) => TourState;
export function stepAnnouncement(input: { step: number; question: BmcQuestion; company: Company; state: CanvasQuestionState }): string;
```

A step with three answers lasts 900 + 3·700 + 900 + 2200 = 6.1 s; an open
question 4 s; a whole tour about 50 s. The phases: the question appears; its
answers arrive one by one in the question card; the paragraph gains the
step's sentence (or its "left open on purpose" pill) and the canvas block
fills at the same moment; then the step holds for reading.

Transitions:

- `tick` advances `elapsed` while playing. Past `total`, it moves to the next
  step at `elapsed = 0`; past the last step's `total`, it sets
  `playing = false, ended = true`.
- `next`, `back`, `goto`: while playing, the target step starts from
  `elapsed = 0` and keeps playing; while paused, the target shows complete
  (`elapsed = total`). `back` on step 1 and `next` on step 9 do nothing.
  `ended` clears.
- `play`: when `ended`, restart at step 1; when the current step is complete,
  start the next one; otherwise resume.
- `pause` and `hidden` (the page became hidden) stop playing and keep
  `elapsed`. The tour does not resume by itself.

`lib/hooks/useTourPlayer.ts` binds the reducer: one `setTimeout` to the next
phase boundary rather than a frame loop, the `visibilitychange` listener, the
`replaceState` call, and the reduced-motion check (`matchMedia`, as F7).

When the last step completes, an end card under the question offers "Choose
another example" (back to `#examples`) and, once part 4 has shipped, "Start
your own".

### Keyboard

The controls are buttons and links, reachable with Tab. The player region
(the element holding the steps, the question card and the controls) handles,
in its own React `onKeyDown`: ← back, → next, Home step 1, End step 9, and
Space or K to play or pause when the event target is the region itself rather
than a button (a focused button keeps its own Space). No window or document
listener, so `tests/app/keyboard-shortcuts.test.js` is unaffected and no
registry row is needed; the ⌘? sheet is not mounted in the Arkademy (F6).

### Screen readers

- The steps are a `nav` labelled "Tour steps" holding an ordered list of
  links (`?step=N`, intercepted on click), each named
  "Step 3: Channels, answered" (or "left open on purpose"), the current one
  with `aria-current="step"`.
- One visually hidden `aria-live="polite"` region receives
  `stepAnnouncement` once per step, when the step starts — never per answer:
  "Step 3 of 9, Channels. How do they find out about it, and how do they get
  it? Notion's answers: …" (or "Notion leaves this open on purpose.").
- The play button's name toggles between "Play the tour" and "Pause the tour".
- Answers that have not arrived are absent from the DOM, not hidden, so a
  reader never meets them early.

### Motion

Arrivals are opacity and a short translate under `motion-safe:`; a new
sentence's background fades once. With reduced motion the tour starts paused,
every step renders complete, and nothing transitions; Play still advances
step by step, each step shown whole for its `total`. Autoplay always has a
visible pause control (WCAG 2.2.2).

### Small screens

Below 768px: one column — the step rail (nine 28px targets in one row, no
horizontal scroll), the question card, the paragraph, then the grid in one
column. Back, Play/Pause and Next sit in a bar fixed to the bottom with 44px
targets. The page does not scroll by itself during autoplay; manual
navigation scrolls the question card into view only when it is off screen.

## Your own canvas

`/arkademy/business-model-canvas/yours`, optionally `?step=N` (same parser;
absent means the first question neither answered nor open, else step 1). The
same screen as the tour — step rail, question card, paragraph, full grid —
with the question card in edit mode and no autoplay.

### Editing

- **Name** above the steps: "Your product's name", at most 60 characters,
  empty allowed (the paragraph then uses `DEFAULT_SUBJECT`).
- **Question card:** "Question N of 9 · {block}", the `prompt` as an `h2`, the
  `hint`; one `Input` per answer (`maxLength` 140, single line; emptying one
  removes it) with a Remove button; an add form (Enter adds); at five answers
  the add form is disabled with "Five answers is the most a question takes."
- **"Leave this open on purpose"** (`Checkbox`) shows only while the question
  has no answers. Adding an answer clears the flag.
- **Inspirations** beside the question (below it on narrow screens):
  § "Inspirations".
- **Back / Next**, and the step rail, as in the tour.
- **Paragraph:** sentences as text, gaps as buttons that go to their question.
- **Toolbar** on the paragraph card: Copy the paragraph, Copy as Markdown,
  Download JSON; and "Start over", which opens a confirmation `Dialog` and
  then clears the draft.

`lib/arkademy/canvas.ts` holds the draft and its pure reducer:

```ts
export interface DraftAnswer {
  id: string;                                       // random, for keys and edits
  question: BmcQuestionKey;
  text: string;                                     // as typed, trimmed, ≤ 140
  inspiration?: { entity: string; documentVersion: number };
}
export interface CanvasDraft {
  name: string;                                     // ≤ 60
  answers: DraftAnswer[];                           // per question, in display order
  open: BmcQuestionKey[];                           // never a question with answers
  updatedAt: string;                                // ISO 8601
}
export type DraftAction =
  | { type: "rename"; name: string }
  | { type: "add"; question: BmcQuestionKey; text: string }
  | { type: "addInspiration"; question: BmcQuestionKey; entity: string; label: string; documentVersion: number }
  | { type: "edit"; id: string; text: string }       // empty text removes
  | { type: "remove"; id: string }
  | { type: "setOpen"; question: BmcQuestionKey; open: boolean }
  | { type: "reset" }
  | { type: "replace"; draft: CanvasDraft };         // another tab wrote
export function draftReducer(draft: CanvasDraft, action: DraftAction): CanvasDraft;
export function draftState(draft: CanvasDraft): CanvasQuestionState[];
```

An inspired answer keeps its `inspiration` after the visitor rewords it: it
records what was chosen, which is what a later release wants to learn from.

### Inspirations

`lib/arkademy/inspirations.ts`:

```ts
export interface Inspiration {
  entity: string;
  label: string;
  companies: { id: string; name: string }[];        // in tool.examples order
}
export function inspirationCatalog(index: ArkademyIndex): Record<BmcQuestionKey, Inspiration[]>;
export function availableInspirations(list: readonly Inspiration[], answers: readonly DraftAnswer[]): Inspiration[];
```

- The catalog (server, passed as props) holds, per question, the entities of
  `BMC_QUESTION_KIND[key]` that at least one example uses, sorted by number of
  companies descending, then label (`localeCompare(…, "en", { sensitivity: "base" })`),
  then id.
- `availableInspirations` (client) drops entities already chosen in this
  question (by `inspiration.entity`) and any whose label equals an answer's
  text, compared case-insensitively.
- The card shows the first six, then "Show all N". Each is a button: the label,
  and under it "Notion, Figma and 2 more". One click dispatches
  `addInspiration` with the label as text; focus returns to the add field and
  the live region says "Added: {label}". At five answers the buttons are
  disabled.
- Hidden when the catalog for that question is empty.

### Browser storage

`lib/arkademy/canvas-storage.ts` (pure parse and serialise) and
`lib/hooks/useCanvasDraft.ts` (the only reader and writer of the key):

- **Key** `arkaik:arkademy:bmc`, following the `arkaik:` prefix (F7). **Value**
  `{ "v": 1, "draft": CanvasDraft }` as JSON.
- **One draft, not a list.** A list needs naming, switching and deleting — a
  second screen this release does not need. Download JSON keeps a copy of a
  canvas before starting over, and the `v` envelope lets a later release move
  to a list with one upgrade step.
- **Reading** (`readStoredDraft(raw: string | null)`) answers
  `{ status: "none" }`, `{ status: "ok", draft }`,
  `{ status: "unreadable", raw }` or `{ status: "newer", v, raw }`. It applies
  the upgrade chain (`DRAFT_UPGRADES: Record<number, (old: unknown) => unknown>`,
  empty at v1) for any `v` below `DRAFT_FORMAT = 1`, and repairs tolerantly:
  answers with an unknown key or a non-string text are dropped, texts are cut
  to 140 characters, a question keeps its first five answers, `open` is
  deduplicated and loses keys that have answers.
- **Unreadable** (not JSON, or no usable shape): the raw string is copied to
  `arkaik:arkademy:bmc:unreadable` before anything is written, the canvas
  starts empty, and a notice offers to download the raw text.
- **Newer** (`v` above what this build knows, from a newer tab or deploy): the
  canvas is shown but not saved, with a notice to reload.
- **Writing:** debounced 300 ms after a change and flushed on `pagehide`.
  The hook follows the `storage` event and adopts another tab's draft
  (`replace`), so two tabs converge on the last writer.
- **Storage unavailable** (private mode, a throwing accessor, quota): the canvas
  works in memory and a notice says it is not being saved and suggests
  Download JSON.
- The server renders a `Skeleton` in place of the editor; the draft loads
  after mount, so there is no flash of an empty canvas.
- The cover's "Start your own" reads the same key, through the same parser, to
  choose between "Start your own" and "Continue your canvas".

### Exports

`lib/arkademy/canvas-export.ts`, pure:

- **Copy the paragraph:** `paragraphText(composeParagraph(…))`.
- **Copy as Markdown:** `canvasMarkdown({ tool, name, state })`, exactly:

  ```
  # {name or DEFAULT_SUBJECT}: {tool.title}

  {paragraph text — this line and the blank after it omitted when empty}

  ## {block}

  - {answer text}
  - {answer text}

  ## {block}

  _Left open on purpose._

  ## {block}

  _Not answered yet._
  ```

  Nine `##` sections in canonical order, one blank line between blocks, a
  single trailing newline. Answers are written as typed (trimmed).
- **Download JSON:** `canvasJson(…)` serialised with two-space indentation and
  a trailing newline, file name from `canvasFilename(name)`: the name
  slugified plus `-business-model-canvas.json`, or
  `business-model-canvas.json` when the slug is empty. The download uses a
  Blob and an object URL, as `downloadJson` does (`lib/utils/export.ts:153-169`).

  ```ts
  export interface CanvasExport {
    format: "arkaik.arkademy.canvas";
    formatVersion: 1;
    tool: "business-model-canvas";
    name: string;
    exportedAt: string;                  // ISO 8601
    documentVersion: number;             // the library version this page was served with
    paragraph: string;
    questions: {                         // nine, canonical order
      key: BmcQuestionKey;
      block: string;
      prompt: string;
      state: "answered" | "open" | "empty";
      answers: { text: string; entity?: string }[];
    }[];
  }
  ```

  The block titles and questions travel with the answers, so the file reads on
  its own when handed to an agent.

Importing a file back is not in this release.

## Testing

No browser tests run in CI, so every rule above that can be pure is pure and
reached from Node.

- **One loader for `lib/arkademy/`.** `tests/app/load-arkademy.js` transpiles
  every `lib/arkademy/*.ts`, discovered by reading the folder, into
  `tests/app/.test-build-arkademy/` (inside the repo, so `require("zod")`
  resolves). Because those modules import only each other by relative path and
  `zod`, there is no alias table to maintain; the loader fails with the file's
  name if any output still contains `require("@/`. Parts 2–4 add modules to
  the folder and never touch the loader.
- **One loader for the server side.** `tests/services/load-arkademy-api.js`
  transpiles `lib/services/db.ts`, `lib/services/graph/etag.ts`,
  `lib/services/arkademy.ts`, `app/api/arkademy/route.ts` and the
  `lib/arkademy/` folder into `tests/services/.test-build-arkademy/`, with its
  own table: `@/lib/services/db`, `@/lib/services/graph/etag`,
  `@/lib/services/arkademy` and each `@/lib/arkademy/<name>` used, plus stubs
  for `server-only` (empty module) and `next/cache`
  (`unstable_cache: (fn) => fn`). A new `@/` import in any of these files needs
  a line here, and only here.
- **Fixture.** `tests/fixtures/arkademy/document.json`, fictional only, never
  the real library: three invented companies (for example a neighbourhood
  bakery, a tide-tables app, a team writing tool), one marked `simulation`
  with a `note`; the BMC tool with prototype-style templates (one
  `sentencePlural`, three templates without `{S}`); every question covered;
  one open question; one question with five uses; one wording containing a
  comma; two entities shared by two companies, one by all three; one entity
  with no use (a warning case). Tests derive invalid documents by mutating
  copies in memory.
- Each new suite gets an npm script, a CI step, and a `.gitignore` line for its
  build directory.

## The stack

Four parts, one branch and PR each, chained with `gh stack`. Each part passes
`npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run generate` with a
clean tree after, and its own suites, without the parts above it. UI parts are
also checked visually (Playwright from a scratchpad, at 1440, 900 and 390
pixels, light and dark, with a fixture document published to a local
Postgres) — a manual check, not CI.

### Part 1 — the library store (`feat/arkademy-content`)

This branch; this spec is its first commit. Nothing visible.

- **Adds:** `lib/arkademy/schema.ts`, `lib/arkademy/validate.ts`,
  `lib/arkademy/index-document.ts`; `lib/services/arkademy.ts`;
  `app/api/arkademy/route.ts`; `db/migrations/013_arkademy_documents.sql`;
  `scripts/arkademy/upload.js`, `scripts/arkademy/load-arkademy-lib.js`;
  `tests/fixtures/arkademy/document.json`; `tests/app/load-arkademy.js`,
  `tests/app/arkademy-schema.test.js`; `tests/services/load-arkademy-api.js`,
  `tests/services/arkademy-api.test.js`; `docs/arkademy.md` (operator guide:
  the document, the table, the route, publish, status, rollback, the content
  folder).
- **Changes:** `package.json` (`zod` dependency; scripts `arkademy`,
  `test:arkademy-schema`, `test:arkademy-api`); `.github/workflows/ci.yml`
  (build job: `test:arkademy-schema`; services job: `test:arkademy-api`);
  `.gitignore` (`/arkademy-content/`, `/scripts/arkademy/.build/`,
  `/tests/app/.test-build-arkademy/`, `/tests/services/.test-build-arkademy/`);
  `docs/architecture.md` (the route), `docs/spec/services.md` (an Arkademy
  section beside Publik: the route's contract and the table).
- **Exports relied on above:** every name in `lib/arkademy/schema.ts` above
  (`ARKADEMY_FORMAT_VERSION`, `BMC_TOOL_ID`, `ToolId`, `BMC_QUESTION_KEYS`,
  `BmcQuestionKey`, `ENTITY_KINDS`, `EntityKind`, `BMC_QUESTION_KIND`,
  `ANSWER_MAX_LENGTH`, `MAX_ANSWERS_PER_QUESTION`, `MAX_DOCUMENT_BYTES`,
  `PROMPT_TOKEN`, `ArkademyDocument`, `BmcTool`, `BmcQuestion`, `Company`,
  `Entity`, `Use`, `OpenQuestion`, `arkademyDocumentSchema`);
  `validateArkademyDocument`, `ArkademyFinding`, `ArkademyValidation`,
  `upgradeArkademyDocument`; `indexArkademy`, `ArkademyIndex`;
  `getArkademy`, `ArkademyLookup`, `arkademyEtag`, `ARKADEMY_CACHE_SECONDS`.
- **Tests.** `test:arkademy-schema` (build job): the fixture validates with
  exactly its expected warnings; each error rule fails on a minimal mutation
  with the right path; every field constraint at its bounds (140 and 141
  characters, a newline, each trailing punctuation mark); every template rule
  (`{L}` missing or twice, `{S}` not first, an unknown token, plural
  disagreeing on `{S}`); a second `PROMPT_TOKEN`; `formatVersion: 2` refused;
  a document over `MAX_DOCUMENT_BYTES` refused; `upload.js check` on the
  fixture exits 0 and on a broken copy exits 1 (spawned, no database).
  `test:arkademy-api` (services job): with `DATABASE_URL` removed, the route
  answers 503; on an empty table, 404 `no_document`; `publishDocument` with the
  fixture, then 200 with `version: 1` and `ETag: W/"arkademy.1"`; the same tag
  in `If-None-Match` gives 304 with no body; publishing again unchanged writes
  nothing; a changed document becomes version 2; `rollbackDocument` writes
  version 3 with version 1's hash and `restored_from = 1`; a row inserted by
  hand with an invalid document or `format_version` 99 answers 500
  `document_invalid`; `getArkademy` answers each lookup status.
- **Must not touch:** `packages/**`, generated artifacts, any page or
  component.
- **Lab Note:** none — nothing a user notices. Label `no-lab-note`.
- **After merge:** `migrate-prod` creates the table; the owner publishes the
  library; `curl` the route to confirm 200 and the CDN behaviour.

### Part 2 — the shell and the cover (`feat/arkademy-cover`)

- **Adds:** `app/arkademy/layout.tsx`, `app/arkademy/page.tsx`,
  `app/arkademy/not-found.tsx`, `app/arkademy/business-model-canvas/page.tsx`;
  `components/arkademy/ArkademyChrome.tsx`, `ArkademyMessage.tsx`,
  `ToolCard.tsx`, `ExampleCard.tsx`, `CanvasGrid.tsx`, `ParagraphView.tsx`,
  `PromptBlock.tsx`, `CopyButton.tsx`; `lib/arkademy/paragraph.ts`,
  `lib/arkademy/examples.ts`, `lib/arkademy/prompt.ts`
  (`promptForDisplay`, `PROMPT_PLACEHOLDER = "[your paragraph]"`),
  `lib/arkademy/metadata.ts`, `lib/arkademy/tools.ts`;
  `tests/app/arkademy-paragraph.test.js`.
- **Changes:** `app/sitemap.ts` (two URLs); `package.json`
  (`test:arkademy-paragraph`); `ci.yml` (its step); `docs/architecture.md`
  (routes, components), `docs/conventions.md` and `README.md` (the
  `components/arkademy/` and `lib/arkademy/` folders).
- **Exports relied on above:** `composeParagraph`, `paragraphText`,
  `joinAnswers`, `cleanAnswer`, `SUBJECT_PRONOUN`, `DEFAULT_SUBJECT`,
  `ParagraphSegment`, `CanvasQuestionState`; `exampleCanvas`;
  `promptForDisplay`, `PROMPT_PLACEHOLDER`; the metadata helpers
  (`arkademyShellMetadata`, `bmcCoverMetadata`, `bmcTourMetadata`,
  `bmcYoursMetadata` — the last two are used by parts 3 and 4 but tested
  here); `ARKADEMY_TOOL_PATHS`; components `ArkademyChrome`, `ArkademyMessage`,
  `CanvasGrid`, `ParagraphView`, `CopyButton`.
- **The cover in this part** has no action buttons yet: "Play a tour" arrives
  with part 3, "Start your own" with part 4, so no link points at a page that
  does not exist.
- **Tests.** `test:arkademy-paragraph`: `cleanAnswer` (trailing dots and
  spaces, other punctuation kept); `joinAnswers` for one to five items, with
  and without commas; subject first, pronoun after, a no-subject template
  before the first subject sentence leaving the name for the next;
  `sentencePlural` at one and two answers; `open` versus unanswered gaps;
  answers winning over an `open` flag; `through` 1, 4 and 9; an empty subject;
  `paragraphText` leaving gaps out; `exampleCanvas` on the fixture (order,
  entity ids, open flags, unknown company → `null`); the metadata helpers
  (canonical URLs, `robots` on tour and yours, fallback without a document);
  the sitemap source names both URLs and no `/tour/`.
- **Must not touch:** `lib/arkademy/schema.ts`'s shape, the route, the
  migration.

### Part 3 — the tour (`feat/arkademy-tour`)

- **Adds:** `app/arkademy/business-model-canvas/tour/[example]/page.tsx`;
  `components/arkademy/CanvasWalk.tsx` (the shared screen, `mode: "tour"`),
  `StepRail.tsx`, `QuestionCard.tsx` (read mode), `TourControls.tsx`,
  `TourEndCard.tsx`; `lib/arkademy/tour.ts`; `lib/hooks/useTourPlayer.ts`,
  `lib/hooks/usePrefersReducedMotion.ts`; `tests/app/arkademy-tour.test.js`.
- **Changes:** the cover gains "Play a tour" (to `#examples`) and each example
  card "Play the tour"; `package.json` (`test:arkademy-tour`); `ci.yml`;
  `docs/architecture.md`.
- **Exports relied on above:** `CanvasWalk` (its props accept a `mode`, so
  part 4 adds `"edit"` without reshaping it), `StepRail`, `QuestionCard`;
  `parseStepParam`, `tourHref`, `TOUR_TIMING`.
- **Tests.** `test:arkademy-tour`: `stepTimeline` for 0 to 5 answers (each
  boundary and the total); `stepView` just before and at each boundary;
  the reducer — `tick` across a boundary, across the last step (`ended`),
  `next`/`back`/`goto` while playing and while paused, `back` on 1 and `next`
  on 9, `play` when ended, when complete and mid-step, `hidden`;
  `parseStepParam` for "1", "9", "0", "10", "3abc", "", an array and
  `undefined`; `tourHref` with and without a step; `stepAnnouncement` for an
  answered and an open step. Visual check of a whole tour at the three widths
  and with reduced motion emulated.
- **Must not touch:** the paragraph rule, the schema, the storage key.

### Part 4 — your own canvas (`feat/arkademy-your-canvas`)

- **Adds:** `app/arkademy/business-model-canvas/yours/page.tsx`;
  `components/arkademy/QuestionEditor.tsx`, `InspirationList.tsx`,
  `CanvasToolbar.tsx`, `StartOverDialog.tsx`, `StartYourOwnButton.tsx`;
  `lib/arkademy/canvas.ts`, `lib/arkademy/canvas-storage.ts`,
  `lib/arkademy/inspirations.ts`, `lib/arkademy/canvas-export.ts`;
  `lib/hooks/useCanvasDraft.ts`; `tests/app/arkademy-canvas.test.js`.
- **Changes:** `CanvasWalk` gains `mode: "edit"`; the cover and the tour's end
  card gain "Start your own" / "Continue your canvas"; `package.json`
  (`test:arkademy-canvas`); `ci.yml`; `docs/architecture.md`.
- **Tests.** `test:arkademy-canvas`: the reducer (add, the five-answer cap,
  edit to empty removes, `setOpen` refused with answers, add clears `open`,
  `addInspiration` storing entity and version, rewording keeping it, `reset`,
  `replace`); `readStoredDraft` for `null`, a valid v1, broken JSON, a wrong
  shape, `v: 2`, an unknown question key, a 200-character text, six answers,
  an `open` key that has answers; `serializeDraft` round trip;
  `inspirationCatalog` on the fixture (kind filter, most shared first, label
  then id ties, unused entities absent, companies in example order);
  `availableInspirations` (by entity, by case-insensitive text);
  `canvasMarkdown` byte-exact for an answered, an open and an empty question,
  with and without a name; `canvasJson` shape; `canvasFilename` for a name,
  accents, punctuation only and empty.
- **Lab Note:** the single note for the whole tool, below.

## Lab Notes

Molecule `arkaik`. The owner chose to announce the Arkademy once, with the last
part. Parts 1, 2 and 3 therefore carry no note and the label `no-lab-note`
(part 1 changes nothing a user sees; parts 2 and 3 are user-facing but stay
quiet on purpose). Part 4 carries one note for the whole tool. `nodes:` is
omitted because the self-map has no Arkademy node yet (F9). After opening each
PR, read its comments for the reminder's verdict.

Part 4:

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

## Settled questions

The three questions this spec first left open were answered by the owner on
2026-11-12.

1. **"Reads it only through a route."** Settled: the pages read the library
   in-process through `getArkademy`, the same cached loader the public route
   uses (F4). Both read only the database, never a file.
2. **Lab Notes for a URL-only area.** Settled: announce once, with the last
   part. Parts 1 to 3 are labelled `no-lab-note`; part 4 carries the single
   note above.
3. **"Copy as prompt" on your own canvas.** Settled: not in this MVP. Your own
   canvas has three exports only (copy the paragraph, copy as Markdown,
   download JSON); the baseline prompt stays on the cover as a text to copy.
   No `fillPrompt` function is added.
