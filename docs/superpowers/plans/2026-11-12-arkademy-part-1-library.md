# Arkademy — Part 1: the library store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the Arkademy library — one versioned JSON document — in Postgres, validate it against a schema in the repository, read it through one cached server loader with a thin public route over it, and upload it with a hand-run script (check, publish, status, rollback). Nothing a user sees.

**Architecture:** `lib/arkademy/` holds pure, isomorphic modules that import only `zod` and each other by relative path: `schema.ts` (types, constants, the strict zod schema), `validate.ts` (the zod parse, the referential rules, the warnings, the format upgrade), `index-document.ts` (the lookups the pages need). `db/migrations/013_arkademy_documents.sql` adds an append-only table. `lib/services/arkademy.ts` is the server loader and **the contract**: `getArkademy()` reads the newest row, upgrades and validates it, and in production goes through Next's data cache (`unstable_cache`, 300 s). The pages of parts 2–4 call it in-process; `app/api/arkademy/route.ts` is a thin HTTP wrapper over it with an ETag and CDN headers. `scripts/arkademy/upload.js` (CommonJS, run by hand) validates a file and inserts versions; its database functions are exported so the integration suite drives them.

**Tech Stack:** TypeScript (strict, `tsc --noEmit`), zod 4.4.3, `pg`, Next.js 16.2 route handlers, plain Node test scripts that transpile `.ts` with `ts.transpileModule` into gitignored build directories, GitHub Actions on Node 20 with a Postgres 16 service.

**Spec:** `docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md` **at commit `faa0411`** (the version with notes on a use, a source's `dateKind`, and the settled questions). Where this plan and the spec differ, § "Readings and deviations" says why, and this plan wins.

**Branch:** `feat/arkademy-content`, which already carries the spec's four commits (`991f7e2`, `89f110f`, `5cbe361`, `faa0411`) on top of `main` at `eff7386`. Work on that branch; do not create a new one.

**Position in the stack:** part 1 of 4, the bottom. Parts 2 (`feat/arkademy-cover`), 3 (`feat/arkademy-tour`) and 4 (`feat/arkademy-your-canvas`) stack on top. They never change `lib/arkademy/schema.ts`'s shape, the route or the migration; they add modules to `lib/arkademy/` and call `getArkademy()`.

**Rehearsed:** every task below was executed in order in a detached worktree of this branch at `faa0411`, with a scratch Postgres 16 cluster, and every command's expected output in this plan is what that run printed. The suites were also run under a real Node 20.19.5 binary. `next build` + `next start` against the scratch database confirmed the route's headers, the 304 and the data cache in a production server.

---

## Readings and deviations

The spec fixes names and shapes; these are the places it was silent, ambiguous or wrong, and what the code below does. Parts 2–4 may rely on every one of them.

1. **The loader is the contract** (spec § "Settled questions" 1). Pages call `getArkademy()` wrapped in React's `cache()`; nothing calls `/api/arkademy` from the server. The route only maps a lookup to HTTP.
2. **`upgradeArkademyDocument(document: unknown, fromFormat: number): ArkademyUpgrade`** where `ArkademyUpgrade = { ok: true; document: unknown } | { ok: false; message: string }`. It never validates. `ARKADEMY_UPGRADES` (keyed by the format a step upgrades *from*) is empty at format 1. A stored `format_version` above the build's format, below 1 or not an integer is refused, which the loader reports as `invalid`. The spec named the function only.
3. **`validateArkademyDocument(input, options?: { now?: Date })`.** The optional second argument exists for the one clock-dependent rule (a note dated in the future is a warning); every caller in this part omits it.
4. **Finding paths:** `uses[12].entity` style; the document itself is `$` (an unknown top-level key, the size rule).
5. **The size rule (7)** measures the UTF-8 bytes of `JSON.stringify(input)` — the compact text, which is what is stored and hashed — and runs before the zod parse. The upload script separately refuses to *read* a file above `4 × MAX_DOCUMENT_BYTES`. The spec said the script refuses a file above `MAX_DOCUMENT_BYTES`, which would refuse a pretty-printed file whose document fits.
6. **The figure warning** (spec § "Referential rules"): a wording warns on `\d\s?%`, on any of `$ € £` anywhere, on the words `USD`/`EUR`, and on `reported`, `reportedly`, `according to` (case-insensitive). "A digit followed by `%`, a currency sign or code" is read as three alternatives, so `$5` warns although the sign precedes the digit. A digit alone (`a 3-step setup`) does not warn.
7. **A note dated in the future** compares `YYYY-MM-DD` strings against today's UTC date; a note dated today does not warn.
8. **Notes** are strict objects (an unknown key in `note` or `source` is an error). `source.url` is trimmed, single-line, 1–500 characters and `new URL(url).protocol === "https:"`. `source.dateKind` is required and is `"published"` or `"accessed"` (`NOTE_DATE_KINDS`); a missing or unknown value is an error at `uses[i].note.source.dateKind`. The future-date warning applies to both kinds. A figure inside a note is fine — the figure warning applies to wordings only.
9. **Object-level rules run only on a clean object.** zod 4 skips a `superRefine` on an object whose fields already failed, so "`sentencePlural` uses `{S}` iff `sentence` does" is reported only once the question's other errors are fixed. Upload error lists can therefore grow by one after a fix; that is expected.
10. **`docs/arkademy.md` must be classified.** `tests/app/docs-visibility.test.js:100-108` fails on any unclassified top-level area of `docs/`. The spec did not list `lib/utils/docs-visibility.ts`; this plan adds `"arkademy"` to `INTERNAL_DOC_AREAS` (the operator guide is how the owner writes to production — delivery process, not product docs). The public contract goes in `docs/spec/services.md`, which is published.
11. **Upload script outcomes the spec left open:** exit 0 done or nothing to do, 1 refused or failed, 2 a usage mistake (unknown command or option, `--to` not a positive integer). `rollback` with no version, or with no earlier differing version, exits 1. `rollback --to N` where N already holds the current document prints `unchanged (vM already holds vN's document)` and exits 0. A relative `file` resolves against `INIT_CWD` (where the owner typed the command; `npm run` itself runs in the repo root).
12. **The test stub for `next/cache`** returns the function itself, as the spec says, and also records each wrapping and each call, so the suite proves the production path goes through the data cache with key `["arkademy-current"]`, `revalidate: 300`, `tags: ["arkademy"]`.
13. **An empty table is cached too.** In production the `empty` lookup is a cache entry like any other: the first publish after a cached 404 is served after the next refill, up to five minutes later. Rehearsed with `next start`: a publish after a 404 kept the 404; a v2 publish kept serving v1.
14. **Extra exports, nothing renamed:** `NOTE_MAX_LENGTH`, `UseNote`, `NOTE_DATE_KINDS`, `NoteDateKind`, `SUBJECT_TOKEN` (`"{S}"`), `LIST_TOKEN` (`"{L}"`), `templateProblems`, `isCalendarDate`, `SchemaMatchesTypes` (a compile-time check) from `schema.ts`; `formatFindingPath`, `documentByteLength`, `wordingWarnings`, `ARKADEMY_UPGRADES`, `ArkademyUpgrade` from `validate.ts`; `readCurrentArkademy`, `StoredArkademyRow` from `lib/services/arkademy.ts`; `parseArgs`, `main` from `upload.js`.

## Repo traps that apply

- **CI runs Node 20; this machine runs a newer Node that strips TypeScript.** A test that `require`s a `.ts` file passes locally and is a `SyntaxError` in CI. No test here does: `tests/app/load-arkademy.js`, `tests/services/load-arkademy-api.js` and `scripts/arkademy/load-arkademy-lib.js` transpile with the `typescript` package. No code here uses an API newer than Node 20 (`Object.hasOwn`, `??`, `?.` and `node --env-file` are all in Node 20).
- **Alias tables.** `lib/arkademy/*.ts` must never import `@/…` — both lib loaders refuse it by name. `tests/services/load-arkademy-api.js` has the only alias table this part adds (`REWRITES`): a new `@/` import in `lib/services/arkademy.ts` or `app/api/arkademy/route.ts` needs a line there and nowhere else. No existing loader compiles any file this part touches: `db.ts` and `etag.ts` are read, not changed, and nothing else imports the new modules.
- **eslint and actionlint gate the build job** (`.github/workflows/ci.yml:21-24`, `:41-42`). eslint ignores `tests/**`, `scripts/**` and `db/**` (`eslint.config.mjs:17-20`); the app files here lint clean. The two workflow edits are plain steps; run `actionlint` (installed with Homebrew) after each.
- **CI diffs generated files** (`ci.yml:35-39`). Nothing here touches `packages/**`, imports a lucide icon or changes a generator input. Adding `"zod": "^4.4.3"` to the root `package.json` changes **`package-lock.json` by exactly one line** (the root package's dependency list, `package-lock.json:52-53`) and no generated artifact; `npm run generate` leaves the tree clean. Commit the lockfile, or CI's `npm ci` fails on the mismatch.
- **Suites that assert on source text:** `tests/app/docs-visibility.test.js` walks the real `docs/` tree (Task 7 handles it). No other suite reads files this part adds.
- **New npm scripts reach CI only through a step.** There is no aggregate `npm test`: `test:arkademy-schema` gets a step in the `build` job (Task 2), `test:arkademy-api` one in the `services` job (Task 6). The `services` job already sets `DATABASE_URL` (`ci.yml:391`) and migrates twice (`:406-410`) before its suites, so migration 013 is applied before `test:arkademy-api` runs.
- **A stale `.next/` breaks `tsc`.** `tsconfig.json:30` includes `.next/types/**/*.ts`; a build from another branch (or from a later task of this one, then reset) leaves validators that import route files that may not exist. If `npx tsc --noEmit` reports `TS2307 Cannot find module '../../app/api/…/route.js'` from `.next/types/validator.ts`, run `rm -rf .next` and re-run it.
- **`test:arkademy-api` truncates `arkademy_documents`.** It refuses any `DATABASE_URL` host but `localhost`, `127.0.0.1` or `::1`. Never point it, or the upload script without reading what it prints, at production.

## Local Postgres for this part

Tasks 4–6 and 8 need a migrated Postgres. Homebrew's Postgres 16 binaries (`initdb`, `pg_ctl`, `createdb`, `psql`) are on the PATH. Use a directory **outside the repository** (the session's scratchpad), connect over TCP and keep the socket directory empty (a scratchpad path is longer than a unix socket allows). Pick a free port above 5500 (`lsof -nP -iTCP:5547 -sTCP:LISTEN` prints nothing when it is free):

```bash
export PGSCRATCH=/path/to/your/scratchpad/pg-arkademy     # outside the repo
initdb -D "$PGSCRATCH/data" -U arkaik --auth=trust > "$PGSCRATCH.initdb.log"
pg_ctl -D "$PGSCRATCH/data" -l "$PGSCRATCH.log" -o "-p 5547 -c listen_addresses=localhost -c unix_socket_directories=''" start
createdb -h localhost -p 5547 -U arkaik arkaik_test
export DATABASE_URL=postgres://arkaik@localhost:5547/arkaik_test
```

Expected: `server started`, then nothing from `createdb`. Stop it in Task 8:

```bash
pg_ctl -D "$PGSCRATCH/data" stop
lsof -nP -iTCP:5547 -sTCP:LISTEN     # prints nothing
```

---

## Verified facts

Read at `faa0411` (app code identical to `main` at `eff7386`).

- `lib/services/db.ts:1` imports `server-only`; `:22-24` `servicesConfigured()` is `Boolean(process.env.DATABASE_URL)` read per call; `:34-42` `servicesUnavailable(service)` returns a 503 `{ error: "services_unavailable", message: "arkaik services (<service>) are not configured on this deployment." }` built with `Response.json`, whose headers are mutable; `:72-84` `getPool()` creates the pool lazily; `:91-96` `query(text, params)` reads `getPool()` per call. Transpiled to CommonJS, `query` is read off the module object at call time, so a test can replace `api.db.query` as a spy.
- `lib/services/graph/etag.ts:1` has only `import type`, which transpiles away; `:32-34` `formatReadEtag(parts)` → `W/"a.b"`; `:147-157` `ifNoneMatchSatisfied(header, etag)` compares weakly, `null` never matches.
- `app/api/publik/[id]/route.ts:14-15` exports `runtime = "nodejs"` and `dynamic = "force-dynamic"` — the pattern the route copies.
- `app/p/[id]/page.tsx:44-53` wraps its lookup in React's `cache()`; `:22-24` documents "same process, no HTTP self-call".
- `db/migrate.mjs:51` applies `db/migrations/*.sql` in filename order; `:78-97` each file in its own transaction, recorded in `_migrations`. The last migration is `db/migrations/012_graph_events_time_index.sql`.
- `.github/workflows/migrate-prod.yml:22-25` runs `npm run db:migrate` against production on a push to `main` touching `db/migrations/**`.
- `scripts/generate/load-schema-package.js:15-58` transpiles a TypeScript folder into a build directory inside the repo so `require("zod")` resolves — the technique both lib loaders copy.
- `tests/services/load-publik-api.js:66-70` stubs `server-only` with an empty module.
- `.github/workflows/ci.yml:29` Node 20 (build job; `:400` services job); `:35-39` generate + drift gate; `:41-42` lint; `:44-45` build; `:210-211` the "Screenshot staleness tests" step; `:391` `DATABASE_URL` in the services job; `:406-410` migrate twice; `:420-421` the "Pollen feed integration tests" step.
- `package.json:14` `"db:migrate"`; `:38` `"test:screenshot-staleness"`; `:146` `pg`; `:154-155` `"tailwind-merge"` then `"yaml": "^2.8.3"` closing `dependencies`; `:167` `typescript` (dev). The root does not declare `zod`.
- `package-lock.json:52-53` close the root package's `dependencies`; `node_modules/zod` is locked at `4.4.3` (`package-lock.json:11149-11150`), hoisted from `packages/schema`.
- `.gitignore:38` `/tests/services/.test-build-once-changed-files/`; `:56` `/tests/app/.test-build-screen-inspector/`; `:97` `.env*` (so `.env.production.local` is ignored); `:116` `/tests/landing/.test-build-landing/` is the last line.
- `eslint.config.mjs:17-20` ignores `tests/**`, `scripts/**`, `db/**`.
- `tsconfig.json:30` includes `.next/types/**/*.ts`.
- `lib/utils/docs-visibility.ts:66-74` `INTERNAL_DOC_AREAS` starts with `"arkaik-bootstrap-skill"`; `tests/app/docs-visibility.test.js:100-108` fails on an unclassified area.
- `docs/architecture.md:65-66` the `api/` block opens with `graph/`; `docs/spec/services.md:216` `## Pollen Feed`, `:261` `## Tier Enforcement Points`.
- `next` is `16.2.0` (`package.json:143`); `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md` documents `unstable_cache(fn, keyParts, { tags, revalidate })` without Cache Components; `next.config.ts` does not enable `cacheComponents`.
- `tests/fixtures/run-fixture-tests.js` lists its fixtures explicitly, so `tests/fixtures/arkademy/document.json` does not join `test:fixtures`.
- zod 4.4.3: `z.strictObject` reports an unknown key as `Unrecognized key: "…"` on the object's path; `.refine` returns the same schema type; a `superRefine` on an object is skipped when its fields already failed.

## File map

- Create `lib/arkademy/schema.ts`, `lib/arkademy/validate.ts`, `lib/arkademy/index-document.ts`.
- Create `lib/services/arkademy.ts`, `app/api/arkademy/route.ts`.
- Create `db/migrations/013_arkademy_documents.sql`.
- Create `scripts/arkademy/upload.js`, `scripts/arkademy/load-arkademy-lib.js`.
- Create `tests/fixtures/arkademy/document.json` (fictional companies only).
- Create `tests/app/load-arkademy.js`, `tests/app/arkademy-schema.test.js`, `tests/services/load-arkademy-api.js`, `tests/services/arkademy-api.test.js`.
- Create `docs/arkademy.md`.
- Modify `package.json`, `package-lock.json`, `.gitignore`, `.github/workflows/ci.yml`, `docs/architecture.md`, `docs/spec/services.md`, `lib/utils/docs-visibility.ts`.
- Must not touch: `packages/**`, any generated artifact, any page or component, `arkademy-content/` (gitignored; never commit or reference real library content).

---

### Task 1: Declare zod at the root and ignore the content folder and build directories

**Files:**
- Modify: `package.json`, `package-lock.json`, `.gitignore`

- [ ] **Step 1: Add the dependency**

In `package.json`, replace

```json
    "tailwind-merge": "^3.5.0",
    "yaml": "^2.8.3"
  },
```

with

```json
    "tailwind-merge": "^3.5.0",
    "yaml": "^2.8.3",
    "zod": "^4.4.3"
  },
```

Run: `npm install`
Expected: exits 0 (an `npm audit` summary is normal). Then run `git diff package-lock.json` and expect exactly this hunk and nothing else:

```diff
@@ -50,7 +50,8 @@
         "server-only": "^0.0.1",
         "sonner": "^2.0.7",
         "tailwind-merge": "^3.5.0",
-        "yaml": "^2.8.3"
+        "yaml": "^2.8.3",
+        "zod": "^4.4.3"
       },
```

If the lockfile changed anywhere else, run `git checkout package-lock.json` and `npm install` again; do not commit a lockfile that moved other packages.

- [ ] **Step 2: Ignore the build directories and the content folder**

In `.gitignore`, replace the line `/tests/services/.test-build-once-changed-files/` with:

```
/tests/services/.test-build-once-changed-files/
/tests/services/.test-build-arkademy/
```

Replace the line `/tests/app/.test-build-screen-inspector/` with:

```
/tests/app/.test-build-screen-inspector/
/tests/app/.test-build-arkademy/
```

Then append at the end of the file, after the last line `/tests/landing/.test-build-landing/`, one blank line and:

```
# The Arkademy library's content: never committed, uploaded with
# `npm run arkademy -- publish` (docs/arkademy.md)
/arkademy-content/
# transient CJS build of lib/arkademy/ emitted by scripts/arkademy/upload.js
/scripts/arkademy/.build/
```

- [ ] **Step 3: Verify**

Run: `npm ci && node -p "require('zod/package.json').version" && npm run generate > /dev/null && git status --porcelain`
Expected: `npm ci` exits 0; `4.4.3`; `generate` may print one `arkaik-mcp v0.10.0 — bundle: …` line on stderr; then exactly three modified files:

```
 M .gitignore
 M package-lock.json
 M package.json
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore(arkademy): declare zod at the root, ignore the content folder and build dirs"
```

---

### Task 2: The library document's schema and validation

**Files:**
- Create: `tests/fixtures/arkademy/document.json`, `tests/app/load-arkademy.js`, `tests/app/arkademy-schema.test.js`
- Create: `lib/arkademy/schema.ts`, `lib/arkademy/validate.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`

The fixture is the only valid document the suites know. It is fictional: a neighbourhood bakery (Crumb & Co, marked `simulation` with a note), a tide-tables app (Tidewise) and a team writing tool (Inkwell). It has prototype-style templates (one `sentencePlural`, three templates without `{S}`), every question covered, one open question (Tidewise `rev`), one question with five uses (Crumb & Co `ka`), wordings with commas, `word-of-mouth` used by all three, `app-stores` and `subscriptions` shared by two, one unused entity (`pop-up-stalls`, its only warning), and two uses with a sourced note on reserved `.example` domains: Tidewise `kr` (`dateKind: "published"`) and Inkwell `rev` (`dateKind: "accessed"`, a pricing page), so part 2 can test both renderings. The two Tidewise `ch` uses are stored out of `order` on purpose.

- [ ] **Step 1: Write the fixture**

Create `tests/fixtures/arkademy/document.json`:

````json
{
  "formatVersion": 1,
  "tools": [
    {
      "id": "business-model-canvas",
      "title": "Business Model Canvas",
      "tagline": "Nine plain questions about how a product lives, answered by example.",
      "pitch": {
        "headline": "A business model is nine answers that agree with each other",
        "body": [
          "Each example answers the same nine questions and reads them back as one paragraph.",
          "Read a few, then answer them for your own product.\nThe paragraph is a baseline any agent prompt can start from."
        ]
      },
      "prompt": {
        "label": "A baseline prompt",
        "text": "You are helping me think about a product.\nHere is its business model in one paragraph:\n\n{{paragraph}}\n\nAsk me the one question that would change it most."
      },
      "questions": [
        {"key": "seg", "block": "Customer segments", "prompt": "Who is this for?", "hint": "Name the people who would miss it most.", "gap": "who it is for", "sentence": "{S} is for {L}."},
        {"key": "vp", "block": "Value propositions", "prompt": "What does it do for them?", "hint": "Say what changes for them, not what it is.", "gap": "what it does for them", "sentence": "{S} offers {L}."},
        {"key": "ch", "block": "Channels", "prompt": "How do they find out about it, and how do they get it?", "hint": "Think of the first time someone hears of it.", "gap": "how they find it", "sentence": "{S} reaches them through {L}."},
        {"key": "cr", "block": "Customer relationships", "prompt": "How does it keep them?", "hint": "What happens after the first visit?", "gap": "how they stay", "sentence": "{S} keeps them with {L}."},
        {"key": "rev", "block": "Revenue streams", "prompt": "Where does the money come from?", "hint": "Who pays, and for what?", "gap": "where the money comes from", "sentence": "On money: {L}."},
        {"key": "kr", "block": "Key resources", "prompt": "What does it need to exist?", "hint": "People, data, tools, places.", "gap": "what it needs", "sentence": "{S} relies on {L}."},
        {"key": "ka", "block": "Key activities", "prompt": "What must it keep doing well?", "hint": "The work that stops everything when it stops.", "gap": "what it keeps doing", "sentence": "{S} spends its days on {L}."},
        {"key": "kp", "block": "Key partners", "prompt": "Who does it rely on?", "hint": "", "gap": "who it relies on", "sentence": "Its partners are {L}."},
        {"key": "cost", "block": "Cost structure", "prompt": "What costs the most?", "hint": "Name the two or three biggest lines.", "gap": "what it costs", "sentence": "The main cost is {L}.", "sentencePlural": "The main costs are {L}."}
      ],
      "examples": ["crumb-and-co", "tidewise", "inkwell"]
    }
  ],
  "companies": [
    {"id": "crumb-and-co", "name": "Crumb & Co", "oneLiner": "A neighbourhood bakery that sells bread by subscription", "simulation": true, "note": "A simulation: every number behind it is invented for the test suite."},
    {"id": "tidewise", "name": "Tidewise", "oneLiner": "Tide tables for people who fish from the shore", "simulation": false},
    {"id": "inkwell", "name": "Inkwell", "oneLiner": "A shared notebook for teams that write together", "simulation": false}
  ],
  "entities": [
    {"id": "local-households", "kind": "segment", "label": "households within walking distance"},
    {"id": "shore-anglers", "kind": "segment", "label": "people who fish from the shore"},
    {"id": "writing-teams", "kind": "segment", "label": "small teams that write together"},
    {"id": "fresh-bread-delivered", "kind": "value-proposition", "label": "fresh bread delivered before breakfast"},
    {"id": "tide-times-offline", "kind": "value-proposition", "label": "tide times that work offline"},
    {"id": "one-shared-draft", "kind": "value-proposition", "label": "one draft everybody edits at once"},
    {"id": "word-of-mouth", "kind": "channel", "label": "word of mouth"},
    {"id": "app-stores", "kind": "channel", "label": "app stores"},
    {"id": "pop-up-stalls", "kind": "channel", "label": "pop-up market stalls"},
    {"id": "weekly-newsletter", "kind": "relationship", "label": "a weekly newsletter"},
    {"id": "in-app-help", "kind": "relationship", "label": "help inside the product"},
    {"id": "onboarding-calls", "kind": "relationship", "label": "onboarding calls"},
    {"id": "subscriptions", "kind": "revenue-stream", "label": "monthly subscriptions"},
    {"id": "skilled-bakers", "kind": "resource", "label": "skilled bakers"},
    {"id": "tide-data", "kind": "resource", "label": "public tide data"},
    {"id": "editing-engine", "kind": "resource", "label": "a real-time editing engine"},
    {"id": "overnight-baking", "kind": "activity", "label": "baking overnight"},
    {"id": "delivery-rounds", "kind": "activity", "label": "planning delivery rounds"},
    {"id": "flour-sourcing", "kind": "activity", "label": "sourcing flour"},
    {"id": "order-packing", "kind": "activity", "label": "packing orders"},
    {"id": "order-taking", "kind": "activity", "label": "taking orders"},
    {"id": "table-updates", "kind": "activity", "label": "updating the tables every season"},
    {"id": "weekly-releases", "kind": "activity", "label": "shipping small improvements"},
    {"id": "local-millers", "kind": "partner", "label": "local millers"},
    {"id": "harbour-offices", "kind": "partner", "label": "harbour offices"},
    {"id": "cloud-host", "kind": "partner", "label": "a cloud host"},
    {"id": "ingredients", "kind": "cost", "label": "ingredients"},
    {"id": "night-wages", "kind": "cost", "label": "night-shift wages"},
    {"id": "store-fees", "kind": "cost", "label": "app store fees"},
    {"id": "hosting", "kind": "cost", "label": "hosting"}
  ],
  "uses": [
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "seg", "entity": "local-households", "text": "households within a ten-minute walk", "order": 0},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "vp", "entity": "fresh-bread-delivered", "text": "bread, still warm, at the door before breakfast", "order": 0},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "ch", "entity": "word-of-mouth", "text": "neighbours telling neighbours", "order": 0},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "cr", "entity": "weekly-newsletter", "text": "a weekly note about what is in the oven", "order": 0},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "rev", "entity": "subscriptions", "text": "a monthly bread subscription", "order": 0},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "kr", "entity": "skilled-bakers", "text": "two skilled bakers", "order": 0},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "ka", "entity": "overnight-baking", "text": "baking through the night", "order": 0},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "ka", "entity": "delivery-rounds", "text": "planning the delivery round", "order": 1},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "ka", "entity": "flour-sourcing", "text": "sourcing flour from nearby mills", "order": 2},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "ka", "entity": "order-packing", "text": "packing each order by hand", "order": 3},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "ka", "entity": "order-taking", "text": "taking orders by text message", "order": 4},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "kp", "entity": "local-millers", "text": "two local millers", "order": 0},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "cost", "entity": "ingredients", "text": "flour and butter", "order": 0},
    {"tool": "business-model-canvas", "company": "crumb-and-co", "question": "cost", "entity": "night-wages", "text": "night-shift wages", "order": 1},
    {"tool": "business-model-canvas", "company": "tidewise", "question": "seg", "entity": "shore-anglers", "text": "people who fish from the shore", "order": 0},
    {"tool": "business-model-canvas", "company": "tidewise", "question": "vp", "entity": "tide-times-offline", "text": "tide times that work without signal", "order": 0},
    {"tool": "business-model-canvas", "company": "tidewise", "question": "ch", "entity": "app-stores", "text": "app store search", "order": 1},
    {"tool": "business-model-canvas", "company": "tidewise", "question": "ch", "entity": "word-of-mouth", "text": "anglers swapping tips on the pier", "order": 0},
    {"tool": "business-model-canvas", "company": "tidewise", "question": "cr", "entity": "in-app-help", "text": "a help page inside the app", "order": 0},
    {"tool": "business-model-canvas", "company": "tidewise", "question": "kr", "entity": "tide-data", "text": "public tide data", "order": 0, "note": {"text": "predictions for 412 harbours, refreshed every season", "source": {"name": "Tidewise, product page", "url": "https://tidewise.example/harbours", "date": "2026-03-02", "dateKind": "published"}}},
    {"tool": "business-model-canvas", "company": "tidewise", "question": "ka", "entity": "table-updates", "text": "updating the tables every season", "order": 0},
    {"tool": "business-model-canvas", "company": "tidewise", "question": "kp", "entity": "harbour-offices", "text": "harbour offices that share local data", "order": 0},
    {"tool": "business-model-canvas", "company": "tidewise", "question": "cost", "entity": "store-fees", "text": "developer fees for the app stores", "order": 0},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "seg", "entity": "writing-teams", "text": "small teams that write together", "order": 0},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "vp", "entity": "one-shared-draft", "text": "one draft everybody edits at once", "order": 0},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "ch", "entity": "word-of-mouth", "text": "writers recommending it to writers", "order": 0},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "ch", "entity": "app-stores", "text": "desktop app stores", "order": 1},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "cr", "entity": "onboarding-calls", "text": "a call to set up each new team", "order": 0},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "rev", "entity": "subscriptions", "text": "a subscription per seat", "order": 0, "note": {"text": "eight euros per seat a month, billed yearly", "source": {"name": "Inkwell, pricing page", "url": "https://inkwell.example/pricing", "date": "2026-10-01", "dateKind": "accessed"}}},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "kr", "entity": "editing-engine", "text": "a real-time editing engine", "order": 0},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "ka", "entity": "weekly-releases", "text": "shipping small improvements every week", "order": 0},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "kp", "entity": "cloud-host", "text": "a cloud host", "order": 0},
    {"tool": "business-model-canvas", "company": "inkwell", "question": "cost", "entity": "hosting", "text": "hosting the shared drafts", "order": 0}
  ],
  "open": [
    {"tool": "business-model-canvas", "company": "tidewise", "question": "rev"}
  ]
}
````

- [ ] **Step 2: Write the loader**

Create `tests/app/load-arkademy.js`:

````js
/**
 * Loads every lib/arkademy/*.ts module into Node without a bundler, for the
 * test:arkademy-* suites (CI runs Node 20, which cannot `require` a `.ts`
 * file; never require one directly from a test).
 *
 * The folder is discovered, not listed, and there is NO alias table: the
 * modules in lib/arkademy/ import only each other by relative path (`./schema`)
 * and `zod`. A module that imports `@/…` breaks that contract, so the loader
 * refuses it by name instead of failing later with `Cannot find module`.
 * Parts that add modules to the folder never touch this file.
 *
 * The build directory is inside the repo so `require("zod")` resolves against
 * the workspace's node_modules.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const SRC_DIR = path.join(ROOT, "lib", "arkademy");
const BUILD_DIR = path.join(__dirname, ".test-build-arkademy");

function arkademyModules() {
  return fs
    .readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .map((name) => name.slice(0, -3))
    .sort();
}

/**
 * Transpiles the folder and returns every module's exports merged into one
 * object. A name exported by two modules is an error, not a silent overwrite.
 */
function loadArkademy() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const modules = arkademyModules();
  for (const name of modules) {
    const source = fs.readFileSync(path.join(SRC_DIR, `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    if (/require\((['"])@\//.test(outputText)) {
      throw new Error(
        `lib/arkademy/${name}.ts imports an "@/" module; lib/arkademy/ modules import only each other by relative path and zod`,
      );
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${name}.js`), outputText);
  }

  for (const name of modules) delete require.cache[path.join(BUILD_DIR, `${name}.js`)];

  const merged = {};
  const owner = {};
  for (const name of modules) {
    const exported = require(path.join(BUILD_DIR, `${name}.js`));
    for (const key of Object.keys(exported)) {
      if (key in merged) throw new Error(`"${key}" is exported by both lib/arkademy/${owner[key]}.ts and ${name}.ts`);
      merged[key] = exported[key];
      owner[key] = name;
    }
  }
  return merged;
}

function cleanup() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

module.exports = { loadArkademy, cleanup, BUILD_DIR };
````

- [ ] **Step 3: Write the failing suite**

Create `tests/app/arkademy-schema.test.js`:

````js
#!/usr/bin/env node

/**
 * The Arkademy library document (lib/arkademy/): the schema's field rules,
 * the referential rules and warnings of validateArkademyDocument, the format
 * upgrade, and the index the pages read. DB-free, so it runs in CI's `build`
 * job.
 *
 * Every invalid case is the fictional fixture (tests/fixtures/arkademy/
 * document.json) mutated in memory, so each one breaks exactly one rule and
 * the fixture itself stays the single valid example.
 */

const fs = require("fs");
const path = require("path");
const { loadArkademy, cleanup } = require("./load-arkademy");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");

const ark = loadArkademy();
const {
  ARKADEMY_FORMAT_VERSION,
  BMC_TOOL_ID,
  BMC_QUESTION_KEYS,
  ENTITY_KINDS,
  BMC_QUESTION_KIND,
  ANSWER_MAX_LENGTH,
  MAX_ANSWERS_PER_QUESTION,
  MAX_DOCUMENT_BYTES,
  PROMPT_TOKEN,
  NOTE_MAX_LENGTH,
  NOTE_DATE_KINDS,
  arkademyDocumentSchema,
  validateArkademyDocument,
  upgradeArkademyDocument,
  formatFindingPath,
  documentByteLength,
  wordingWarnings,
  templateProblems,
} = ark;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const doc0 = fixture();
const useIndex = (company, question, order) =>
  doc0.uses.findIndex((use) => use.company === company && use.question === question && use.order === order);
const entityIndex = (id) => doc0.entities.findIndex((entity) => entity.id === id);

function mutate(fn) {
  const doc = fixture();
  fn(doc);
  return validateArkademyDocument(doc);
}
const show = (result) => JSON.stringify(result.ok ? { ok: true, warnings: result.warnings } : result.errors);
function expectError(name, fn, findingPath) {
  const result = mutate(fn);
  check(name, !result.ok && result.errors.some((finding) => finding.path === findingPath), show(result));
}
function expectOk(name, fn) {
  const result = mutate(fn);
  check(name, result.ok === true, show(result));
}
function expectWarning(name, fn, findingPath) {
  const result = mutate(fn);
  check(name, result.ok === true && result.warnings.some((finding) => finding.path === findingPath), show(result));
}

// --- The contract's names ----------------------------------------------------
check("the format is version 1", ARKADEMY_FORMAT_VERSION === 1);
check("the BMC tool id", BMC_TOOL_ID === "business-model-canvas");
check(
  "the nine question keys in canonical order",
  JSON.stringify(BMC_QUESTION_KEYS) === JSON.stringify(["seg", "vp", "ch", "cr", "rev", "kr", "ka", "kp", "cost"]),
);
check("nine entity kinds", ENTITY_KINDS.length === 9);
check(
  "each question names its kind, and each kind is used once",
  BMC_QUESTION_KEYS.every((key) => ENTITY_KINDS.includes(BMC_QUESTION_KIND[key])) &&
    new Set(BMC_QUESTION_KEYS.map((key) => BMC_QUESTION_KIND[key])).size === 9,
);
check(
  "the limits",
  ANSWER_MAX_LENGTH === 140 && MAX_ANSWERS_PER_QUESTION === 5 && MAX_DOCUMENT_BYTES === 1048576,
);
check("the prompt token", PROMPT_TOKEN === "{{paragraph}}");
check("the zod schema is exported", typeof arkademyDocumentSchema.safeParse === "function");

// --- The fixture -------------------------------------------------------------
const valid = validateArkademyDocument(fixture());
check("the fixture validates", valid.ok === true, show(valid));
check(
  "the fixture's only warning is its unused entity",
  valid.ok &&
    valid.warnings.length === 1 &&
    valid.warnings[0].level === "warning" &&
    valid.warnings[0].path === `entities[${entityIndex("pop-up-stalls")}]`,
  show(valid),
);
check(
  "the parse keeps the fixture's content and key order",
  valid.ok && JSON.stringify(valid.document) === JSON.stringify(doc0),
);
{
  const shuffled = fixture();
  const company = shuffled.companies[0];
  shuffled.companies[0] = Object.fromEntries(Object.entries(company).reverse());
  shuffled.tools[0] = Object.fromEntries(Object.entries(shuffled.tools[0]).reverse());
  const result = validateArkademyDocument(shuffled);
  check(
    "the parse puts keys in the schema's order, so the text is canonical",
    JSON.stringify(shuffled) !== JSON.stringify(doc0) && result.ok && JSON.stringify(result.document) === JSON.stringify(doc0),
  );
}

// --- Paths and sizes ---------------------------------------------------------
check("a path with indices", formatFindingPath(["uses", 12, "entity"]) === "uses[12].entity");
check("a nested path", formatFindingPath(["tools", 0, "questions", 3, "key"]) === "tools[0].questions[3].key");
check("the document's own path", formatFindingPath([]) === "$");
check(
  "the size is the UTF-8 length of the compact JSON",
  documentByteLength(doc0) === Buffer.byteLength(JSON.stringify(doc0), "utf8"),
);

// --- Structure ---------------------------------------------------------------
expectError("formatVersion 2 is refused", (doc) => (doc.formatVersion = 2), "formatVersion");
expectError("an unknown top-level key is refused", (doc) => (doc.extra = true), "$");
expectError("an unknown key in a use is refused", (doc) => (doc.uses[0].weight = 1), "uses[0]");
expectError("an unknown key in a question is refused", (doc) => (doc.tools[0].questions[2].hints = "x"), "tools[0].questions[2]");
expectError("two tools are refused in format 1", (doc) => doc.tools.push(doc.tools[0]), "tools");
expectError("a document with no company is refused", (doc) => (doc.companies = []), "companies");
expectError("a tool with no example is refused", (doc) => (doc.tools[0].examples = []), "tools[0].examples");
expectError("a missing open list is refused", (doc) => delete doc.open, "open");

// --- Field constraints at their bounds -----------------------------------------
const pad = (length) => "x".repeat(length);
expectOk("a use's text of 140 characters passes", (doc) => (doc.uses[0].text = pad(140)));
expectError("a use's text of 141 characters fails", (doc) => (doc.uses[0].text = pad(141)), "uses[0].text");
expectError("an empty use text fails", (doc) => (doc.uses[0].text = ""), "uses[0].text");
expectOk("an entity label of 140 characters passes", (doc) => (doc.entities[0].label = pad(140)));
expectError("an entity label of 141 characters fails", (doc) => (doc.entities[0].label = pad(141)), "entities[0].label");
expectError("a newline in a use's text fails", (doc) => (doc.uses[0].text = "two\nlines"), "uses[0].text");
expectError("a carriage return in a label fails", (doc) => (doc.entities[0].label = "two\rlines"), "entities[0].label");
expectError("a leading space fails", (doc) => (doc.uses[0].text = " households"), "uses[0].text");
expectError("a trailing space fails", (doc) => (doc.companies[0].name = "Crumb & Co "), "companies[0].name");
for (const mark of [".", "!", "?", ";", ":", ","]) {
  expectError(`a wording ending in "${mark}" fails`, (doc) => (doc.uses[0].text = `households nearby${mark}`), "uses[0].text");
  expectError(`a label ending in "${mark}" fails`, (doc) => (doc.entities[0].label = `households nearby${mark}`), "entities[0].label");
}
expectOk("a comma inside a wording passes", (doc) => (doc.uses[0].text = "bread, still warm"));
expectOk("a company name of 40 characters passes", (doc) => (doc.companies[0].name = pad(40)));
expectError("a company name of 41 characters fails", (doc) => (doc.companies[0].name = pad(41)), "companies[0].name");
expectError("an empty note fails", (doc) => (doc.companies[1].note = ""), "companies[1].note");
expectError("a note of 401 characters fails", (doc) => (doc.companies[0].note = pad(401)), "companies[0].note");
expectError("a non-boolean simulation fails", (doc) => (doc.companies[0].simulation = "yes"), "companies[0].simulation");
const unused = entityIndex("pop-up-stalls");
expectOk("a slug of 64 characters passes", (doc) => (doc.entities[unused].id = pad(64)));
expectError("a slug of 65 characters fails", (doc) => (doc.entities[unused].id = pad(65)), `entities[${unused}].id`);
expectError("a slug with a capital fails", (doc) => (doc.entities[unused].id = "Pop-up"), `entities[${unused}].id`);
expectError("a slug with a double hyphen fails", (doc) => (doc.entities[unused].id = "pop--up"), `entities[${unused}].id`);
expectError("a slug ending in a hyphen fails", (doc) => (doc.entities[unused].id = "pop-up-"), `entities[${unused}].id`);
expectError("an unknown entity kind fails", (doc) => (doc.entities[unused].kind = "competitor"), `entities[${unused}].kind`);
expectError("a negative order fails", (doc) => (doc.uses[0].order = -1), "uses[0].order");
expectError("a fractional order fails", (doc) => (doc.uses[0].order = 1.5), "uses[0].order");
expectOk("an empty hint passes", (doc) => (doc.tools[0].questions[0].hint = ""));
expectError("a hint of 301 characters fails", (doc) => (doc.tools[0].questions[0].hint = pad(301)), "tools[0].questions[0].hint");
expectError("a block title of 41 characters fails", (doc) => (doc.tools[0].questions[0].block = pad(41)), "tools[0].questions[0].block");
expectError("a gap of 61 characters fails", (doc) => (doc.tools[0].questions[0].gap = pad(61)), "tools[0].questions[0].gap");
expectError("a title of 61 characters fails", (doc) => (doc.tools[0].title = pad(61)), "tools[0].title");
expectError("a tagline of 161 characters fails", (doc) => (doc.tools[0].tagline = pad(161)), "tools[0].tagline");
expectError("a headline of 121 characters fails", (doc) => (doc.tools[0].pitch.headline = pad(121)), "tools[0].pitch.headline");
expectError(
  "seven pitch paragraphs fail",
  (doc) => (doc.tools[0].pitch.body = Array.from({ length: 7 }, () => "A paragraph.")),
  "tools[0].pitch.body",
);
expectError("a pitch paragraph of 801 characters fails", (doc) => (doc.tools[0].pitch.body[0] = pad(801)), "tools[0].pitch.body[0]");
expectOk("a newline inside a pitch paragraph passes", (doc) => (doc.tools[0].pitch.body[0] = "one\ntwo"));
expectError("a newline in the headline fails", (doc) => (doc.tools[0].pitch.headline = "one\ntwo"), "tools[0].pitch.headline");
expectOk("a prompt without the token passes", (doc) => (doc.tools[0].prompt.text = "Just a prompt."));
expectError(
  "a second prompt token fails",
  (doc) => (doc.tools[0].prompt.text = `${PROMPT_TOKEN}\n\n${PROMPT_TOKEN}`),
  "tools[0].prompt.text",
);
expectError("a prompt of 4001 characters fails", (doc) => (doc.tools[0].prompt.text = pad(4001)), "tools[0].prompt.text");

// --- Templates ---------------------------------------------------------------
const SENTENCE = "tools[0].questions[0].sentence";
expectError("a template without {L} fails", (doc) => (doc.tools[0].questions[0].sentence = "{S} is for people."), SENTENCE);
expectError("a template with {L} twice fails", (doc) => (doc.tools[0].questions[0].sentence = "{S} is for {L} and {L}."), SENTENCE);
expectError("{S} twice fails", (doc) => (doc.tools[0].questions[0].sentence = "{S} and {S} are for {L}."), SENTENCE);
expectError("{S} anywhere but the start fails", (doc) => (doc.tools[0].questions[0].sentence = "Made for {L}, says {S}."), SENTENCE);
expectError("a template opening with {L} fails", (doc) => (doc.tools[0].questions[4].sentence = "{L} pays."), "tools[0].questions[4].sentence");
expectError("an unknown token fails", (doc) => (doc.tools[0].questions[0].sentence = "{S} is for {X} and {L}."), SENTENCE);
expectError(
  "a plural that adds {S} fails",
  (doc) => (doc.tools[0].questions[8].sentencePlural = "{S} spends most on {L}."),
  "tools[0].questions[8].sentencePlural",
);
expectError(
  "a plural that drops {S} fails",
  (doc) => (doc.tools[0].questions[0].sentencePlural = "It is for {L}."),
  "tools[0].questions[0].sentencePlural",
);
expectOk("a plural that keeps {S} passes", (doc) => (doc.tools[0].questions[0].sentencePlural = "{S} is for {L} alike."));
expectError(
  "a plural template is checked like a sentence",
  (doc) => (doc.tools[0].questions[8].sentencePlural = "The main costs are many."),
  "tools[0].questions[8].sentencePlural",
);
check("templateProblems passes a sound template", templateProblems("{S} is for {L}.").length === 0);
check("templateProblems names every broken rule", templateProblems("{X} {S}").length === 3, JSON.stringify(templateProblems("{X} {S}")));

// --- Notes on a use ----------------------------------------------------------
const noted = doc0.uses.findIndex((use) => use.note !== undefined);
const NOTE = `uses[${noted}].note`;
check("the fixture has a use with a sourced note", noted >= 0 && doc0.uses[noted].note.source.url.startsWith("https://"));
check("the note limit", NOTE_MAX_LENGTH === 200);
check("the two date kinds", JSON.stringify(NOTE_DATE_KINDS) === JSON.stringify(["published", "accessed"]));
const accessed = doc0.uses.findIndex((use) => use.note !== undefined && use.note.source.dateKind === "accessed");
check(
  "the fixture has a note of each date kind",
  doc0.uses[noted].note.source.dateKind === "published" && accessed >= 0,
);
expectOk("a note text of 200 characters passes", (doc) => (doc.uses[noted].note.text = pad(200)));
expectError("a note text of 201 characters fails", (doc) => (doc.uses[noted].note.text = pad(201)), `${NOTE}.text`);
expectError("an empty note text fails", (doc) => (doc.uses[noted].note.text = ""), `${NOTE}.text`);
expectError("a newline in a note fails", (doc) => (doc.uses[noted].note.text = "two\nlines"), `${NOTE}.text`);
expectError("parentheses in a note fail", (doc) => (doc.uses[noted].note.text = "412 harbours (and counting)"), `${NOTE}.text`);
for (const mark of [".", "!", "?", ";", ":", ","]) {
  expectError(`a note ending in "${mark}" fails`, (doc) => (doc.uses[noted].note.text = `412 harbours${mark}`), `${NOTE}.text`);
}
expectOk("a figure inside a note passes", (doc) => (doc.uses[noted].note.text = "about $5.6B, up 40% in a year"));
expectError("a note without a source fails", (doc) => delete doc.uses[noted].note.source, `${NOTE}.source`);
expectError("an unknown key in a note fails", (doc) => (doc.uses[noted].note.author = "x"), NOTE);
expectError("an unknown key in a source fails", (doc) => (doc.uses[noted].note.source.page = 3), `${NOTE}.source`);
expectError("a source without a dateKind fails", (doc) => delete doc.uses[noted].note.source.dateKind, `${NOTE}.source.dateKind`);
expectError(
  "an unknown dateKind fails",
  (doc) => (doc.uses[noted].note.source.dateKind = "retrieved"),
  `${NOTE}.source.dateKind`,
);
expectOk("an accessed date passes", (doc) => (doc.uses[noted].note.source.dateKind = "accessed"));
expectOk("a source name of 80 characters passes", (doc) => (doc.uses[noted].note.source.name = pad(80)));
expectError("a source name of 81 characters fails", (doc) => (doc.uses[noted].note.source.name = pad(81)), `${NOTE}.source.name`);
expectError("an http source fails", (doc) => (doc.uses[noted].note.source.url = "http://tidewise.example/harbours"), `${NOTE}.source.url`);
expectError("a source that is not a URL fails", (doc) => (doc.uses[noted].note.source.url = "tidewise harbours"), `${NOTE}.source.url`);
expectOk("a source URL of 500 characters passes", (doc) => (doc.uses[noted].note.source.url = `https://tidewise.example/${pad(475)}`));
expectError(
  "a source URL of 501 characters fails",
  (doc) => (doc.uses[noted].note.source.url = `https://tidewise.example/${pad(476)}`),
  `${NOTE}.source.url`,
);
expectError("a date in another format fails", (doc) => (doc.uses[noted].note.source.date = "02/03/2026"), `${NOTE}.source.date`);
expectError("a date that does not exist fails", (doc) => (doc.uses[noted].note.source.date = "2026-02-30"), `${NOTE}.source.date`);
expectOk("the 29th of February of a leap year passes", (doc) => (doc.uses[noted].note.source.date = "2028-02-29"));
{
  const doc = fixture();
  const date = doc.uses[noted].note.source.date;
  const sameDay = validateArkademyDocument(doc, { now: new Date(`${date}T12:00:00Z`) });
  check(
    "a note dated today is not in the future",
    sameDay.ok && !sameDay.warnings.some((finding) => finding.path === `${NOTE}.source.date`),
    show(sameDay),
  );
  const early = validateArkademyDocument(doc, { now: new Date("2026-01-01T12:00:00Z") });
  check(
    "a note dated after today is a warning, not an error",
    early.ok && early.warnings.some((finding) => finding.path === `${NOTE}.source.date`),
    show(early),
  );
}
expectWarning("a note dated far ahead warns on today's clock", (doc) => (doc.uses[noted].note.source.date = "2999-01-01"), `${NOTE}.source.date`);
expectWarning(
  "an accessed date in the future warns too",
  (doc) => (doc.uses[accessed].note.source.date = "2999-01-01"),
  `uses[${accessed}].note.source.date`,
);

// --- Referential errors ------------------------------------------------------
expectError(
  "rule 1: a repeated company id",
  (doc) => doc.companies.push({ ...doc.companies[2], name: "Inkwell again" }),
  "companies[3].id",
);
expectError(
  "rule 1: a repeated entity id",
  (doc) => doc.entities.push({ id: "word-of-mouth", kind: "channel", label: "recommendations" }),
  `entities[${doc0.entities.length}].id`,
);
expectError(
  "rule 2: questions out of canonical order",
  (doc) => {
    const [first, second] = doc.tools[0].questions;
    doc.tools[0].questions[0] = second;
    doc.tools[0].questions[1] = first;
  },
  "tools[0].questions[0].key",
);
expectError("rule 2: eight questions", (doc) => doc.tools[0].questions.pop(), "tools[0].questions");
expectError("rule 3: an example naming no company", (doc) => doc.tools[0].examples.push("nobody"), "tools[0].examples[3]");
expectError("rule 3: a repeated example", (doc) => doc.tools[0].examples.push("tidewise"), "tools[0].examples[3]");
expectError(
  "rule 4: a use by a company that is not an example",
  (doc) => {
    doc.companies.push({ id: "spare", name: "Spare", oneLiner: "Not an example", simulation: false });
    doc.uses[0].company = "spare";
  },
  "uses[0].company",
);
expectError("rule 4: a use naming no entity", (doc) => (doc.uses[0].entity = "nothing-here"), "uses[0].entity");
expectError(
  "rule 4: a use whose entity is of another kind",
  (doc) => (doc.uses[useIndex("crumb-and-co", "seg", 0)].entity = "word-of-mouth"),
  `uses[${useIndex("crumb-and-co", "seg", 0)}].entity`,
);
expectError(
  "rule 5: a sixth answer to one question",
  (doc) => {
    doc.entities.push({ id: "oven-cleaning", kind: "activity", label: "cleaning the ovens" });
    doc.uses.push({ tool: BMC_TOOL_ID, company: "crumb-and-co", question: "ka", entity: "oven-cleaning", text: "cleaning the ovens", order: 5 });
  },
  `uses[${doc0.uses.length}]`,
);
expectError(
  "rule 5: a repeated order",
  (doc) => (doc.uses[useIndex("crumb-and-co", "ka", 1)].order = 0),
  `uses[${useIndex("crumb-and-co", "ka", 1)}].order`,
);
expectError(
  "rule 5: a repeated entity",
  (doc) => (doc.uses[useIndex("crumb-and-co", "ka", 1)].entity = "overnight-baking"),
  `uses[${useIndex("crumb-and-co", "ka", 1)}].entity`,
);
expectError(
  "rule 6: an open question by a company that is not an example",
  (doc) => (doc.open[0].company = "nobody"),
  "open[0].company",
);
expectError("rule 6: a repeated open question", (doc) => doc.open.push({ ...doc.open[0] }), "open[1]");
expectError(
  "rule 6: an open question the company also answers",
  (doc) => doc.open.push({ tool: BMC_TOOL_ID, company: "crumb-and-co", question: "seg" }),
  "open[1]",
);
expectError("rule 6: an unknown question key", (doc) => (doc.open[0].question = "risk"), "open[0].question");
{
  const result = mutate((doc) => (doc.tools[0].pitch.body[0] = "x".repeat(MAX_DOCUMENT_BYTES)));
  check(
    "rule 7: a document over the size limit is refused before it is parsed",
    !result.ok && result.errors.length === 1 && result.errors[0].path === "$" && /limit/.test(result.errors[0].message),
    show(result),
  );
}

// --- Warnings ----------------------------------------------------------------
expectWarning(
  "an example that neither answers nor leaves open a question",
  (doc) => (doc.open = []),
  "tools[0].examples[1]",
);
expectWarning(
  "two entities of one kind sharing a label, whatever the case",
  (doc) => (doc.entities[unused].label = "Word of Mouth"),
  `entities[${unused}].label`,
);
expectWarning("a wording opening with The", (doc) => (doc.uses[0].text = "The households nearby"), "uses[0].text");
expectWarning("a wording in the first person", (doc) => (doc.uses[0].text = "households near our shop"), "uses[0].text");
expectWarning("a wording opening with and", (doc) => (doc.uses[0].text = "and the households nearby"), "uses[0].text");
expectWarning("a label opening with We", (doc) => (doc.entities[0].label = "We deliver"), "entities[0].label");
expectWarning("a wording holding a percentage", (doc) => (doc.uses[0].text = "40% of households nearby"), "uses[0].text");
expectWarning("a wording holding a currency sign", (doc) => (doc.uses[0].text = "households paying $5 a week"), "uses[0].text");
expectWarning("a label holding a currency code", (doc) => (doc.entities[0].label = "households spending EUR 20"), "entities[0].label");
expectWarning("a wording holding a press claim", (doc) => (doc.uses[0].text = "reportedly the most loyal households"), "uses[0].text");
expectWarning("a wording quoting a source", (doc) => (doc.uses[0].text = "households, according to the survey"), "uses[0].text");
check("a digit alone is not a figure", wordingWarnings("a 3-step setup").length === 0);
check("a pound sign is a currency", wordingWarnings("bread at £2").length === 1);
check("the opener rule is case-sensitive", wordingWarnings("the households nearby").length === 0);
check("US is not a pronoun", wordingWarnings("households across the US").length === 0);
check("I is a pronoun", wordingWarnings("what I bake").length === 1);
check("a pronoun must be a whole word", wordingWarnings("business users").length === 0);

// --- Format upgrades ---------------------------------------------------------
{
  const doc = fixture();
  const same = upgradeArkademyDocument(doc, 1);
  check("format 1 needs no upgrade", same.ok === true && same.document === doc);
  const newer = upgradeArkademyDocument(doc, 2);
  check("a newer format is refused", newer.ok === false && /newer/.test(newer.message), JSON.stringify(newer));
  check("format 99 is refused", upgradeArkademyDocument(doc, 99).ok === false);
  check("format 0 is refused", upgradeArkademyDocument(doc, 0).ok === false);
  check("a fractional format is refused", upgradeArkademyDocument(doc, 1.5).ok === false);
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-schema test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-schema tests passed.");
````

- [ ] **Step 4: Register the suite in npm and CI**

In `package.json`, replace

```json
    "test:screenshot-staleness": "node tests/app/screenshot-staleness.test.js",
```

with

```json
    "test:screenshot-staleness": "node tests/app/screenshot-staleness.test.js",
    "test:arkademy-schema": "node tests/app/arkademy-schema.test.js",
```

In `.github/workflows/ci.yml`, replace

```yaml
      - name: Screenshot staleness tests (derived from the journal, never stored)
        run: npm run test:screenshot-staleness
```

with

```yaml
      - name: Screenshot staleness tests (derived from the journal, never stored)
        run: npm run test:screenshot-staleness

      # The Arkademy library document's rules (lib/arkademy/): field bounds,
      # referential rules, warnings, the index, and the upload script's `check`
      # spawned with no database. Pure, so it gates here rather than only in
      # the Postgres job below.
      - name: Arkademy library tests (schema, referential rules, index, upload check)
        run: npm run test:arkademy-schema
```

Run: `actionlint`
Expected: no output, exit 0.

- [ ] **Step 5: Run the suite to verify it fails**

Run: `npm run test:arkademy-schema`
Expected: exit 1 before any check prints, with `Error: ENOENT: no such file or directory, scandir '…/lib/arkademy'`.

- [ ] **Step 6: Write the schema**

Create `lib/arkademy/schema.ts`:

````ts
import { z } from "zod";

/**
 * The Arkademy library document: one versioned JSON document that holds every
 * tool, example company, entity and use (docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md
 * § "The library document"). The owner edits it outside the repository and
 * uploads it with `npm run arkademy -- publish`; the app reads it back from
 * Postgres through lib/services/arkademy.ts.
 *
 * Every module in lib/arkademy/ imports only `zod` and its siblings by
 * relative path — never `@/…` — so tests/app/load-arkademy.js can transpile
 * the folder by discovery with no alias table. Keep it that way: an `@/`
 * import here fails that loader on purpose.
 *
 * The interfaces below are the contract; the zod schema implements them with
 * `z.strictObject` everywhere, so an unknown key is an error at upload (a typo
 * must not silently drop data). `SchemaMatchesTypes` at the end makes `tsc`
 * fail if the two ever disagree.
 */

export const ARKADEMY_FORMAT_VERSION = 1;
export const BMC_TOOL_ID = "business-model-canvas";
export type ToolId = typeof BMC_TOOL_ID;

/** Canonical order: the order the questions are asked and the paragraph reads. */
export const BMC_QUESTION_KEYS = ["seg", "vp", "ch", "cr", "rev", "kr", "ka", "kp", "cost"] as const;
export type BmcQuestionKey = (typeof BMC_QUESTION_KEYS)[number];

export const ENTITY_KINDS = [
  "segment",
  "value-proposition",
  "channel",
  "relationship",
  "revenue-stream",
  "resource",
  "activity",
  "partner",
  "cost",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const BMC_QUESTION_KIND = {
  seg: "segment",
  vp: "value-proposition",
  ch: "channel",
  cr: "relationship",
  rev: "revenue-stream",
  kr: "resource",
  ka: "activity",
  kp: "partner",
  cost: "cost",
} as const satisfies Record<BmcQuestionKey, EntityKind>;

export const ANSWER_MAX_LENGTH = 140;
export const MAX_ANSWERS_PER_QUESTION = 5;
export const MAX_DOCUMENT_BYTES = 1_048_576; // 1 MiB of JSON text
export const PROMPT_TOKEN = "{{paragraph}}";
export const NOTE_MAX_LENGTH = 200;
/** A note's date is the one its source carries, or the day an undated page was read. */
export const NOTE_DATE_KINDS = ["published", "accessed"] as const;
export type NoteDateKind = (typeof NOTE_DATE_KINDS)[number];

/** The two tokens a sentence template may hold: the subject, and the joined answers. */
export const SUBJECT_TOKEN = "{S}";
export const LIST_TOKEN = "{L}";

export interface ArkademyDocument {
  formatVersion: 1;
  tools: [BmcTool]; // format 1 holds exactly one tool
  companies: Company[]; // 1–100
  entities: Entity[]; // 0–5000
  uses: Use[]; // 0–10000
  open: OpenQuestion[]; // questions an example leaves open on purpose
}

export interface BmcTool {
  id: "business-model-canvas";
  title: string; // 1–60, e.g. "Business Model Canvas"
  tagline: string; // 1–160, the shell card and the meta description
  pitch: {
    headline: string; // 1–120
    body: string[]; // 1–6 paragraphs, each 1–800
  };
  prompt: {
    label: string; // 1–60, the block's title on the cover
    text: string; // 1–4000, newlines allowed, PROMPT_TOKEN at most once
  };
  questions: BmcQuestion[]; // exactly nine, keys in BMC_QUESTION_KEYS order
  examples: string[]; // company ids, 1–24, unique: gallery and tour order
}

export interface BmcQuestion {
  key: BmcQuestionKey;
  block: string; // 1–40, the canvas block title, "Customer segments"
  prompt: string; // 1–160, the question, "Who is this for?"
  hint: string; // 0–300, shown under the question
  gap: string; // 1–60, completes "open: …", "who it is for"
  sentence: string; // 1–160, template, see the spec's § "The paragraph"
  sentencePlural?: string; // 1–160, used when the question has two answers or more
}

export interface Company {
  id: string; // slug
  name: string; // 1–40, opens sentences: "Notion is for …"
  oneLiner: string; // 1–200
  simulation: boolean; // true: built from public information, not the company's records
  note?: string; // 1–400, shown wherever the example is shown
}

export interface Entity {
  id: string; // slug, permanent once published
  kind: EntityKind;
  label: string; // neutral wording
}

export interface Use {
  tool: ToolId;
  company: string; // Company.id
  question: BmcQuestionKey;
  entity: string; // Entity.id
  text: string; // this company's own wording
  order: number; // integer ≥ 0, ascending within (tool, company, question)
  note?: UseNote; // a sourced fact about this company's case
}

/**
 * A fact about one company's use, never about the entity: a figure, a date, a
 * named supplier — anything a reader could ask "says who?" about. It always
 * has a source a reader can open.
 */
export interface UseNote {
  text: string; // 1–200, the fact, "about $5.6B in the second quarter of 2026"
  source: {
    name: string; // 1–80, who says so, "Anthropic, press release"
    url: string; // https only, the page that states it
    date: string; // YYYY-MM-DD
    dateKind: NoteDateKind; // the page's own date, or the day an undated page was read
  };
}

export interface OpenQuestion {
  tool: ToolId;
  company: string;
  question: BmcQuestionKey;
}

// ---------------------------------------------------------------------------
// Field rules
// ---------------------------------------------------------------------------

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WORDING_BAD_ENDING = /[.!?;:,]$/;

/**
 * A trimmed text field of `min`–`max` characters. Single-line unless
 * `multiline` (only `pitch.body[]` and `prompt.text` are).
 */
function text(min: number, max: number, options: { multiline?: boolean } = {}) {
  const base = z
    .string()
    .min(min)
    .max(max)
    .refine((value) => value === value.trim(), { message: "must not start or end with whitespace" });
  return options.multiline
    ? base
    : base.refine((value) => !/[\r\n]/.test(value), { message: "must be a single line" });
}

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(SLUG, { message: "must be a slug: lowercase letters and digits, words joined by single hyphens" });

/** `Use.text` and `Entity.label`: the wording rules. */
const wording = text(1, ANSWER_MAX_LENGTH).refine((value) => !WORDING_BAD_ENDING.test(value), {
  message: "must not end with . ! ? ; : or ,",
});

/** Whether `value` is a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Every rule a sentence template breaks, as messages. Empty when it is sound. */
export function templateProblems(template: string): string[] {
  const problems: string[] = [];
  const lists = count(template, LIST_TOKEN);
  const subjects = count(template, SUBJECT_TOKEN);
  if (lists !== 1) problems.push(`must contain ${LIST_TOKEN} exactly once (found ${lists})`);
  if (subjects > 1) problems.push(`must contain ${SUBJECT_TOKEN} at most once (found ${subjects})`);
  if (subjects === 1 && !template.startsWith(SUBJECT_TOKEN)) {
    problems.push(`${SUBJECT_TOKEN} must open the template`);
  }
  if (template.startsWith(LIST_TOKEN)) problems.push(`must not start with ${LIST_TOKEN}`);
  const unknown = (template.match(/\{[^{}]*\}/g) ?? []).filter(
    (token) => token !== LIST_TOKEN && token !== SUBJECT_TOKEN,
  );
  if (unknown.length > 0) problems.push(`unknown token ${unknown[0]}`);
  return problems;
}

const template = text(1, 160).superRefine((value, ctx) => {
  for (const message of templateProblems(value)) ctx.addIssue({ code: "custom", message });
});

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

const bmcQuestionSchema = z
  .strictObject({
    key: z.enum(BMC_QUESTION_KEYS),
    block: text(1, 40),
    prompt: text(1, 160),
    hint: text(0, 300),
    gap: text(1, 60),
    sentence: template,
    sentencePlural: template.optional(),
  })
  .superRefine((question, ctx) => {
    if (question.sentencePlural === undefined) return;
    const singular = question.sentence.includes(SUBJECT_TOKEN);
    const plural = question.sentencePlural.includes(SUBJECT_TOKEN);
    if (singular !== plural) {
      ctx.addIssue({
        code: "custom",
        path: ["sentencePlural"],
        message: `must use ${SUBJECT_TOKEN} if and only if sentence does`,
      });
    }
  });

const bmcToolSchema = z.strictObject({
  id: z.literal(BMC_TOOL_ID),
  title: text(1, 60),
  tagline: text(1, 160),
  pitch: z.strictObject({
    headline: text(1, 120),
    body: z.array(text(1, 800, { multiline: true })).min(1).max(6),
  }),
  prompt: z.strictObject({
    label: text(1, 60),
    text: text(1, 4000, { multiline: true }).refine((value) => count(value, PROMPT_TOKEN) <= 1, {
      message: `must contain ${PROMPT_TOKEN} at most once`,
    }),
  }),
  questions: z.array(bmcQuestionSchema).length(BMC_QUESTION_KEYS.length),
  examples: z.array(slug).min(1).max(24),
});

const companySchema = z.strictObject({
  id: slug,
  name: text(1, 40),
  oneLiner: text(1, 200),
  simulation: z.boolean(),
  note: text(1, 400).optional(),
});

const entitySchema = z.strictObject({
  id: slug,
  kind: z.enum(ENTITY_KINDS),
  label: wording,
});

/**
 * A note is set inside parentheses after its answer, so it holds none of its
 * own and does not end in punctuation. Whether its date is in the future is a
 * warning in validate.ts: it depends on the clock.
 */
const useNoteSchema = z.strictObject({
  text: text(1, NOTE_MAX_LENGTH)
    .refine((value) => !/[()]/.test(value), { message: "must not contain parentheses" })
    .refine((value) => !WORDING_BAD_ENDING.test(value), { message: "must not end with . ! ? ; : or ," }),
  source: z.strictObject({
    name: text(1, 80),
    url: text(1, 500).refine(isHttpsUrl, { message: "must be an https URL" }),
    date: z.string().refine(isCalendarDate, { message: "must be a real date written YYYY-MM-DD" }),
    dateKind: z.enum(NOTE_DATE_KINDS),
  }),
});

const useSchema = z.strictObject({
  tool: z.literal(BMC_TOOL_ID),
  company: slug,
  question: z.enum(BMC_QUESTION_KEYS),
  entity: slug,
  text: wording,
  order: z.number().int().min(0),
  note: useNoteSchema.optional(),
});

const openQuestionSchema = z.strictObject({
  tool: z.literal(BMC_TOOL_ID),
  company: slug,
  question: z.enum(BMC_QUESTION_KEYS),
});

export const arkademyDocumentSchema = z.strictObject({
  formatVersion: z.literal(ARKADEMY_FORMAT_VERSION),
  tools: z.tuple([bmcToolSchema]),
  companies: z.array(companySchema).min(1).max(100),
  entities: z.array(entitySchema).max(5000),
  uses: z.array(useSchema).max(10000),
  open: z.array(openQuestionSchema),
});

// Compile-time only: `tsc` fails on this line if the interfaces above and the
// schema stop describing the same shape. Nothing reads it at runtime.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type SchemaMatchesTypes = Assert<Same<z.infer<typeof arkademyDocumentSchema>, ArkademyDocument>>;
````

- [ ] **Step 7: Write the validator**

Create `lib/arkademy/validate.ts`:

````ts
import {
  ARKADEMY_FORMAT_VERSION,
  BMC_QUESTION_KEYS,
  BMC_QUESTION_KIND,
  MAX_ANSWERS_PER_QUESTION,
  MAX_DOCUMENT_BYTES,
  arkademyDocumentSchema,
  type ArkademyDocument,
} from "./schema";

/**
 * Validation of an Arkademy library document (the spec's § "Referential
 * rules"): the zod parse first, then the rules no field-level schema can see.
 * Errors refuse the upload; warnings are printed and the upload proceeds.
 * Every finding names a JSON path such as `uses[12].entity`; `$` is the
 * document itself.
 *
 * Pure and isomorphic: no Node API, no `@/` import (see schema.ts).
 */

export type ArkademyFinding = { level: "error" | "warning"; path: string; message: string };
export type ArkademyValidation =
  | { ok: true; document: ArkademyDocument; warnings: ArkademyFinding[] }
  | { ok: false; errors: ArkademyFinding[]; warnings: ArkademyFinding[] };

/** `["uses", 12, "entity"]` → `uses[12].entity`; the empty path → `$`. */
export function formatFindingPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out === "" ? String(part) : `.${String(part)}`;
  }
  return out === "" ? "$" : out;
}

/** The size rule's measure: UTF-8 bytes of the document's compact JSON text. */
export function documentByteLength(input: unknown): number | null {
  let json: string | undefined;
  try {
    json = JSON.stringify(input);
  } catch {
    return null;
  }
  return json === undefined ? null : new TextEncoder().encode(json).length;
}

/**
 * A wording that looks like it holds a figure or a press claim: a digit
 * followed by `%`, a currency sign or code, or "reported", "reportedly",
 * "according to". Such a fact probably belongs in a sourced note.
 */
const FIGURE_OR_CLAIM = /\d\s?%|[$€£]|\b(?:USD|EUR)\b|\breported(?:ly)?\b|\baccording to\b/i;

const OPENERS = new Set(["The", "A", "An", "We", "It", "Our", "Nothing", "Free"]);
const PRONOUNS = new Set(["we", "our", "us", "my"]);
const CONJUNCTIONS = new Set(["and", "or", "but"]);

/**
 * The prototype validator's wording heuristics, as warning messages. A
 * wording can only be judged by reading the paragraph it lands in, so these
 * never refuse an upload.
 */
export function wordingWarnings(wording: string): string[] {
  const words = wording.split(/[^A-Za-z']+/).filter((word) => word.length > 0);
  const messages: string[] = [];
  const first = words[0] ?? "";
  if (OPENERS.has(first)) messages.push(`opens with "${first}"; the paragraph reads better without it`);
  if (CONJUNCTIONS.has(first.toLowerCase())) messages.push(`opens with "${first}"`);
  if (FIGURE_OR_CLAIM.test(wording)) messages.push("looks like a figure or a claim; put it in a sourced note");
  const pronoun = words.find((word) => word === "I" || (PRONOUNS.has(word.toLowerCase()) && word !== "US"));
  if (pronoun !== undefined) messages.push(`speaks in the first person ("${pronoun}")`);
  return messages;
}

/**
 * Upgrade steps, keyed by the format they upgrade FROM: step N turns a
 * format-N document into a format-(N+1) one. Empty at format 1. A breaking
 * change to the shape adds its step here in the same PR as the bump.
 */
export const ARKADEMY_UPGRADES: Readonly<Record<number, (previous: unknown) => unknown>> = {};

export type ArkademyUpgrade = { ok: true; document: unknown } | { ok: false; message: string };

/**
 * Brings a stored document from `fromFormat` (its row's `format_version`) up
 * to {@link ARKADEMY_FORMAT_VERSION}. It never validates: the caller runs
 * {@link validateArkademyDocument} on the result.
 */
export function upgradeArkademyDocument(document: unknown, fromFormat: number): ArkademyUpgrade {
  if (!Number.isInteger(fromFormat) || fromFormat < 1) {
    return { ok: false, message: `format ${fromFormat} is not a format version` };
  }
  if (fromFormat > ARKADEMY_FORMAT_VERSION) {
    return {
      ok: false,
      message: `format ${fromFormat} is newer than this build reads (format ${ARKADEMY_FORMAT_VERSION})`,
    };
  }
  let current = document;
  for (let format = fromFormat; format < ARKADEMY_FORMAT_VERSION; format += 1) {
    const step = ARKADEMY_UPGRADES[format];
    if (!step) return { ok: false, message: `no upgrade from format ${format}` };
    current = step(current);
  }
  return { ok: true, document: current };
}

function groupKey(tool: string, company: string, question: string): string {
  return `${tool}\u0000${company}\u0000${question}`;
}

/**
 * `now` is only for the one clock-dependent rule (a note dated in the future
 * is a warning); tests pass a fixed date.
 */
export function validateArkademyDocument(input: unknown, options: { now?: Date } = {}): ArkademyValidation {
  const errors: ArkademyFinding[] = [];
  const warnings: ArkademyFinding[] = [];
  const error = (path: string, message: string) => errors.push({ level: "error", path, message });
  const warn = (path: string, message: string) => warnings.push({ level: "warning", path, message });

  // Rule 7 first: a document over the limit is refused before it is parsed.
  const bytes = documentByteLength(input);
  if (bytes === null) {
    error("$", "is not a JSON value");
    return { ok: false, errors, warnings };
  }
  if (bytes > MAX_DOCUMENT_BYTES) {
    error("$", `is ${bytes} bytes of JSON; the limit is ${MAX_DOCUMENT_BYTES}`);
    return { ok: false, errors, warnings };
  }

  const parsed = arkademyDocumentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) error(formatFindingPath(issue.path), issue.message);
    return { ok: false, errors, warnings };
  }
  const document: ArkademyDocument = parsed.data;

  // Rule 1: ids are unique within companies and within entities.
  const companyIndex = new Map<string, number>();
  document.companies.forEach((company, index) => {
    const first = companyIndex.get(company.id);
    if (first !== undefined) error(`companies[${index}].id`, `repeats the id "${company.id}" of companies[${first}]`);
    else companyIndex.set(company.id, index);
  });
  const entityIndex = new Map<string, number>();
  document.entities.forEach((entity, index) => {
    const first = entityIndex.get(entity.id);
    if (first !== undefined) error(`entities[${index}].id`, `repeats the id "${entity.id}" of entities[${first}]`);
    else entityIndex.set(entity.id, index);
  });

  const tools = new Map(document.tools.map((tool, index) => [tool.id as string, { tool, index }]));

  document.tools.forEach((tool, toolIndex) => {
    // Rule 2: the nine keys once each, in canonical order (zod pins the count).
    tool.questions.forEach((question, index) => {
      const expected = BMC_QUESTION_KEYS[index];
      if (question.key !== expected) {
        error(
          `tools[${toolIndex}].questions[${index}].key`,
          `must be "${expected}": the questions follow the order ${BMC_QUESTION_KEYS.join(", ")}`,
        );
      }
    });
    // Rule 3: every example names a company, once.
    const seen = new Map<string, number>();
    tool.examples.forEach((id, index) => {
      const path = `tools[${toolIndex}].examples[${index}]`;
      if (!companyIndex.has(id)) error(path, `names no company ("${id}")`);
      const first = seen.get(id);
      if (first !== undefined) error(path, `repeats "${id}" of examples[${first}]`);
      else seen.set(id, index);
    });
  });

  // Rule 4 and rule 5: each use, then each (tool, company, question) group.
  const groups = new Map<
    string,
    { first: number; count: number; orders: Map<number, number>; entities: Map<string, number> }
  >();
  const usedEntities = new Set<string>();
  document.uses.forEach((use, index) => {
    const path = `uses[${index}]`;
    const found = tools.get(use.tool);
    if (!found) {
      error(`${path}.tool`, `names no tool ("${use.tool}")`);
      return;
    }
    if (!found.tool.examples.includes(use.company)) {
      error(`${path}.company`, `"${use.company}" is not one of the tool's examples`);
    }
    const entityAt = entityIndex.get(use.entity);
    if (entityAt === undefined) {
      error(`${path}.entity`, `names no entity ("${use.entity}")`);
    } else {
      usedEntities.add(use.entity);
      const kind = document.entities[entityAt].kind;
      const expected = BMC_QUESTION_KIND[use.question];
      if (kind !== expected) {
        error(`${path}.entity`, `"${use.entity}" is a ${kind}; question ${use.question} takes a ${expected}`);
      }
    }

    const key = groupKey(use.tool, use.company, use.question);
    let group = groups.get(key);
    if (!group) {
      group = { first: index, count: 0, orders: new Map(), entities: new Map() };
      groups.set(key, group);
    }
    group.count += 1;
    if (group.count > MAX_ANSWERS_PER_QUESTION) {
      error(
        path,
        `is answer ${group.count} to ${use.question} for "${use.company}"; a question takes at most ${MAX_ANSWERS_PER_QUESTION}`,
      );
    }
    const orderAt = group.orders.get(use.order);
    if (orderAt !== undefined) error(`${path}.order`, `repeats order ${use.order} of uses[${orderAt}]`);
    else group.orders.set(use.order, index);
    const sameEntityAt = group.entities.get(use.entity);
    if (sameEntityAt !== undefined) error(`${path}.entity`, `repeats entity "${use.entity}" of uses[${sameEntityAt}]`);
    else group.entities.set(use.entity, index);
  });

  // Rule 6: open questions.
  const openIndex = new Map<string, number>();
  document.open.forEach((open, index) => {
    const path = `open[${index}]`;
    const found = tools.get(open.tool);
    if (!found) {
      error(`${path}.tool`, `names no tool ("${open.tool}")`);
      return;
    }
    if (!found.tool.examples.includes(open.company)) {
      error(`${path}.company`, `"${open.company}" is not one of the tool's examples`);
    }
    const key = groupKey(open.tool, open.company, open.question);
    const first = openIndex.get(key);
    if (first !== undefined) error(path, `repeats open[${first}]`);
    else openIndex.set(key, index);
    const group = groups.get(key);
    if (group) {
      error(path, `"${open.company}" answers ${open.question} (uses[${group.first}]), so it cannot leave it open`);
    }
  });

  // Warnings. Dates compare as YYYY-MM-DD strings, in UTC.
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  document.tools.forEach((tool, toolIndex) => {
    tool.examples.forEach((id, index) => {
      if (!companyIndex.has(id)) return;
      for (const key of BMC_QUESTION_KEYS) {
        const k = groupKey(tool.id, id, key);
        if (!groups.has(k) && !openIndex.has(k)) {
          warn(`tools[${toolIndex}].examples[${index}]`, `"${id}" neither answers nor leaves open ${key}`);
        }
      }
    });
  });

  const labels = new Map<string, number>();
  document.entities.forEach((entity, index) => {
    if (!usedEntities.has(entity.id)) {
      warn(`entities[${index}]`, `"${entity.id}" has no use, so it never appears as an inspiration`);
    }
    const labelKey = `${entity.kind}\u0000${entity.label.toLowerCase()}`;
    const first = labels.get(labelKey);
    if (first !== undefined) warn(`entities[${index}].label`, `repeats the ${entity.kind} label of entities[${first}]`);
    else labels.set(labelKey, index);
    for (const message of wordingWarnings(entity.label)) warn(`entities[${index}].label`, message);
  });
  document.uses.forEach((use, index) => {
    for (const message of wordingWarnings(use.text)) warn(`uses[${index}].text`, message);
    if (use.note && use.note.source.date > today) {
      warn(`uses[${index}].note.source.date`, `${use.note.source.date} is in the future`);
    }
  });

  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, document, warnings };
}
````

- [ ] **Step 8: Run the suite to verify it passes**

Run: `npm run test:arkademy-schema`
Expected: 159 `PASS:` lines, no `FAIL:`, last line `All arkademy-schema tests passed.`, exit 0. Afterwards `tests/app/.test-build-arkademy/` does not exist (the suite cleans it).

Run: `npx tsc --noEmit && npx eslint lib/arkademy`
Expected: no output from either. (`SchemaMatchesTypes` makes `tsc` fail with `TS2344: Type 'false' does not satisfy the constraint 'true'` if the interfaces and the zod schema ever disagree.) If `tsc` reports `TS2307` from `.next/types/validator.ts`, see the stale `.next/` trap.

- [ ] **Step 9: Commit**

```bash
git add lib/arkademy/schema.ts lib/arkademy/validate.ts tests/fixtures/arkademy/document.json tests/app/load-arkademy.js tests/app/arkademy-schema.test.js package.json .github/workflows/ci.yml
git commit -m "feat(arkademy): the library document's schema and validation"
```

---

### Task 3: The index the pages read

**Files:**
- Create: `lib/arkademy/index-document.ts`
- Modify: `tests/app/arkademy-schema.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/app/arkademy-schema.test.js`, insert the block below directly above the line `cleanup();` (the line just before `if (failures > 0) {` near the end of the file). Keep the blank line that ends the block.

````js
// --- The index -----------------------------------------------------------------
{
  const { indexArkademy } = ark;
  const document = fixture();
  const index = indexArkademy(document);
  check("index: the document and its tool", index.document === document && index.tool === document.tools[0]);
  check("index: a company by id", index.company("tidewise")?.name === "Tidewise");
  check("index: an unknown company", index.company("nobody") === undefined);
  check("index: an entity by id", index.entity("word-of-mouth")?.kind === "channel");
  check("index: an unknown entity", index.entity("nothing-here") === undefined);
  check(
    "index: uses come back sorted by order, not file order",
    JSON.stringify(index.uses("tidewise", "ch").map((use) => use.text)) ===
      JSON.stringify(["anglers swapping tips on the pier", "app store search"]),
    JSON.stringify(index.uses("tidewise", "ch").map((use) => use.text)),
  );
  check(
    "index: all five answers of a full question",
    JSON.stringify(index.uses("crumb-and-co", "ka").map((use) => use.order)) === JSON.stringify([0, 1, 2, 3, 4]),
  );
  const copy = index.uses("tidewise", "ch");
  copy.pop();
  check("index: uses returns a fresh array each call", index.uses("tidewise", "ch").length === 2);
  check("index: an unanswered question has no uses", index.uses("tidewise", "rev").length === 0);
  check("index: an open question", index.isOpen("tidewise", "rev") === true);
  check("index: an answered question is not open", index.isOpen("crumb-and-co", "rev") === false);
  check(
    "index: an entity every example uses",
    JSON.stringify(index.usersOf("word-of-mouth")) === JSON.stringify(["crumb-and-co", "tidewise", "inkwell"]),
  );
  check("index: an entity two examples share", JSON.stringify(index.usersOf("app-stores")) === JSON.stringify(["tidewise", "inkwell"]));
  check("index: the other shared entity", JSON.stringify(index.usersOf("subscriptions")) === JSON.stringify(["crumb-and-co", "inkwell"]));
  check("index: an unused entity has no users", index.usersOf("pop-up-stalls").length === 0);
  const reordered = fixture();
  reordered.tools[0].examples = ["inkwell", "tidewise", "crumb-and-co"];
  check(
    "index: users follow the tool's example order",
    JSON.stringify(indexArkademy(reordered).usersOf("word-of-mouth")) === JSON.stringify(["inkwell", "tidewise", "crumb-and-co"]),
  );
}

````

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:arkademy-schema`
Expected: the 159 earlier checks PASS, then `TypeError: indexArkademy is not a function`, exit 1.

- [ ] **Step 3: Write the index**

Create `lib/arkademy/index-document.ts`:

````ts
import type { ArkademyDocument, BmcQuestionKey, BmcTool, Company, Entity, Use } from "./schema";

/**
 * The lookups the pages need and the arrays do not give (the spec's § "The
 * index"). Built once per validated document, on the server; it never
 * crosses to the client — server pages project it to plain props.
 *
 * It assumes a document that passed validateArkademyDocument: lookups on a
 * broken one answer, but not meaningfully.
 */
export interface ArkademyIndex {
  document: ArkademyDocument;
  tool: BmcTool;
  company(id: string): Company | undefined;
  entity(id: string): Entity | undefined;
  /** Uses of one example's question, sorted by `order`. A fresh array per call. */
  uses(company: string, question: BmcQuestionKey): Use[];
  isOpen(company: string, question: BmcQuestionKey): boolean;
  /** Ids of the examples using an entity, in `tool.examples` order. */
  usersOf(entity: string): string[];
}

function groupKey(company: string, question: string): string {
  return `${company}\u0000${question}`;
}

export function indexArkademy(document: ArkademyDocument): ArkademyIndex {
  const tool = document.tools[0];
  const companies = new Map(document.companies.map((company) => [company.id, company]));
  const entities = new Map(document.entities.map((entity) => [entity.id, entity]));

  const groups = new Map<string, Use[]>();
  const users = new Map<string, Set<string>>();
  for (const use of document.uses) {
    if (use.tool !== tool.id) continue;
    const key = groupKey(use.company, use.question);
    const group = groups.get(key);
    if (group) group.push(use);
    else groups.set(key, [use]);
    const companiesUsing = users.get(use.entity);
    if (companiesUsing) companiesUsing.add(use.company);
    else users.set(use.entity, new Set([use.company]));
  }
  for (const group of groups.values()) group.sort((a, b) => a.order - b.order);

  const open = new Set(
    document.open.filter((entry) => entry.tool === tool.id).map((entry) => groupKey(entry.company, entry.question)),
  );

  return {
    document,
    tool,
    company: (id) => companies.get(id),
    entity: (id) => entities.get(id),
    uses: (company, question) => (groups.get(groupKey(company, question)) ?? []).slice(),
    isOpen: (company, question) => open.has(groupKey(company, question)),
    usersOf: (entity) => {
      const using = users.get(entity);
      return using ? tool.examples.filter((id) => using.has(id)) : [];
    },
  };
}
````

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:arkademy-schema && npx tsc --noEmit && npx eslint lib/arkademy`
Expected: 175 `PASS:` lines, no `FAIL:`, `All arkademy-schema tests passed.`; no output from `tsc` or `eslint`.

- [ ] **Step 5: Commit**

```bash
git add lib/arkademy/index-document.ts tests/app/arkademy-schema.test.js
git commit -m "feat(arkademy): index the library for the pages' lookups"
```

---

### Task 4: The table that keeps every version

**Files:**
- Create: `db/migrations/013_arkademy_documents.sql`

Start the scratch Postgres first (§ "Local Postgres for this part"); `DATABASE_URL` must point at it in this shell.

- [ ] **Step 1: Confirm the table does not exist yet**

Run: `npm run db:migrate && psql "$DATABASE_URL" -c '\d arkademy_documents'`
Expected: the runner applies (or skips) `001_…` to `012_…` and ends with `done — applied 12 migration(s).` or `up to date`; then `Did not find any relation named "arkademy_documents".` (psql exits 1 here; that is the expected answer).

- [ ] **Step 2: Write the migration**

Create `db/migrations/013_arkademy_documents.sql`:

````sql
-- 013_arkademy_documents.sql
--
-- The Arkademy library: one JSON document, versioned
-- (docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md § "The table",
-- docs/spec/services.md § Arkademy). The owner uploads it with
-- `npm run arkademy -- publish`; the app reads the newest row through
-- lib/services/arkademy.ts and serves it at GET /api/arkademy.
--
-- APPEND-ONLY. The current document is the row with the highest `version`.
-- A publish and a rollback both insert a row; nothing updates or deletes one,
-- so every earlier version stays available to roll back to. The primary key
-- is the only index `order by version desc limit 1` needs.
--
-- `sha256` hashes the canonical JSON text the script uploaded (the validated
-- document re-serialised in the schema's key order), not the jsonb column,
-- which does not keep key order. Equal hashes mean an unchanged document.
--
-- IDEMPOTENT like its siblings: safe to re-run by hand outside the runner.
create table if not exists arkademy_documents (
  version        int         primary key check (version > 0),
  format_version int         not null,
  document       jsonb       not null,
  sha256         text        not null,
  size_bytes     int         not null,
  note           text,
  restored_from  int         references arkademy_documents (version),
  uploaded_at    timestamptz not null default now()
);
````

- [ ] **Step 3: Apply it twice, and once by hand**

Run: `npm run db:migrate && npm run db:migrate && psql "$DATABASE_URL" -c '\d arkademy_documents' && psql -q "$DATABASE_URL" -f db/migrations/013_arkademy_documents.sql`
Expected: the first run prints `[db:migrate] applied 013_arkademy_documents.sql`; the second `[db:migrate] skip    013_arkademy_documents.sql (already applied)` and `up to date — no pending migrations.`; `\d` lists the eight columns `version | integer | not null`, `format_version`, `document | jsonb`, `sha256`, `size_bytes`, `note`, `restored_from`, `uploaded_at | timestamp with time zone | not null | now()`, the primary key `arkademy_documents_pkey`, the check `arkademy_documents_version_check` and the self-referencing foreign key `arkademy_documents_restored_from_fkey`; the hand run prints `NOTICE:  relation "arkademy_documents" already exists, skipping` and exits 0.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/013_arkademy_documents.sql
git commit -m "feat(arkademy): the table that keeps every library version"
```

---

### Task 5: The upload script — check, publish, status, rollback

**Files:**
- Create: `scripts/arkademy/load-arkademy-lib.js`, `scripts/arkademy/upload.js`
- Modify: `package.json`, `tests/app/arkademy-schema.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/app/arkademy-schema.test.js`, insert the block below directly above the line `cleanup();` (after the index block from Task 3). Keep the blank line that ends the block.

````js
// --- The upload script's check, spawned with no database ---------------------
{
  const { spawnSync } = require("child_process");
  const os = require("os");
  const UPLOAD = path.join(ROOT, "scripts", "arkademy", "upload.js");
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.ARKADEMY_CONTENT;
  const run = (...args) => spawnSync(process.execPath, [UPLOAD, ...args], { encoding: "utf8", env });

  const ok = run("check", FIXTURE);
  check("upload check: the fixture exits 0", ok.status === 0, ok.stderr || ok.stdout);
  check("upload check: it prints the fixture's warning", /entities\[\d+\]/.test(ok.stdout), ok.stdout);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arkademy-check-"));
  try {
    const brokenFile = path.join(dir, "broken.json");
    const broken = fixture();
    broken.uses[0].entity = "nothing-here";
    fs.writeFileSync(brokenFile, JSON.stringify(broken));
    const bad = run("check", brokenFile);
    check("upload check: a broken copy exits 1", bad.status === 1, `${bad.status} ${bad.stderr}`);
    check("upload check: it names the path", bad.stderr.includes("uses[0].entity"), bad.stderr);

    const notJson = path.join(dir, "not-json.json");
    fs.writeFileSync(notJson, "{ nope");
    check("upload check: a file that is not JSON exits 1", run("check", notJson).status === 1);
    check("upload check: a missing file exits 1", run("check", path.join(dir, "missing.json")).status === 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  check("upload: no command prints the usage and exits 2", run().status === 2);
  check("upload: an option a command does not take exits 2", run("check", "--yes").status === 2);
  check("upload: the script cleans up its build directory", !fs.existsSync(path.join(ROOT, "scripts", "arkademy", ".build")));
}

````

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:arkademy-schema`
Expected: exit 1 with these five failures (each followed by a `Cannot find module '…/scripts/arkademy/upload.js'` excerpt), every other check PASS:

```
FAIL: upload check: the fixture exits 0
FAIL: upload check: it prints the fixture's warning
FAIL: upload check: it names the path
FAIL: upload: no command prints the usage and exits 2
FAIL: upload: an option a command does not take exits 2
```

- [ ] **Step 3: Write the lib loader**

Create `scripts/arkademy/load-arkademy-lib.js`:

````js
/**
 * Loads lib/arkademy/*.ts into a running Node process for the upload script —
 * the scripts/generate/load-schema-package.js technique, kept as its own copy
 * so the script has no dependency on tests/. Every module in the folder is
 * transpiled to CommonJS into scripts/arkademy/.build/ (gitignored), inside
 * the repo so `require("zod")` resolves against the workspace's node_modules.
 *
 * lib/arkademy/ modules import only each other by relative path and zod, so
 * there is no alias table here; an `@/` import is refused by name.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const SRC_DIR = path.join(__dirname, "..", "..", "lib", "arkademy");
const BUILD_DIR = path.join(__dirname, ".build");

function loadArkademyLib() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const modules = fs
    .readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .map((name) => name.slice(0, -3));

  for (const name of modules) {
    const source = fs.readFileSync(path.join(SRC_DIR, `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    if (/require\((['"])@\//.test(outputText)) {
      throw new Error(`lib/arkademy/${name}.ts imports an "@/" module, which the upload script cannot load`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${name}.js`), outputText);
  }

  for (const name of modules) delete require.cache[path.join(BUILD_DIR, `${name}.js`)];
  return {
    ...require(path.join(BUILD_DIR, "schema.js")),
    ...require(path.join(BUILD_DIR, "validate.js")),
  };
}

function cleanup() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

module.exports = { loadArkademyLib, cleanup, BUILD_DIR };
````

- [ ] **Step 4: Write the script**

Create `scripts/arkademy/upload.js`:

````js
#!/usr/bin/env node

/**
 * The Arkademy library's upload script (docs/arkademy.md). Run by hand:
 *
 *   npm run arkademy -- check    [file]                    validate only, no database
 *   npm run arkademy -- publish  [file] [--note "…"] [--yes]
 *   npm run arkademy -- status                            the last ten versions
 *   npm run arkademy -- rollback [--to N] [--yes]
 *
 * `file` defaults to $ARKADEMY_CONTENT, then arkademy-content/arkademy.json
 * under the repository root; a relative path is read from the directory the
 * command was started in. The database is DATABASE_URL, as for
 * `npm run db:migrate`. A write to any host but localhost needs --yes.
 *
 * Every write inserts a row into arkademy_documents (db/migrations/
 * 013_arkademy_documents.sql); nothing is ever updated or deleted. The app
 * serves a new version within ARKADEMY_CACHE_SECONDS (five minutes).
 *
 * lib/arkademy/*.ts is loaded through ./load-arkademy-lib.js, so this runs
 * from a checkout with dev dependencies installed (`typescript`).
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadArkademyLib, cleanup } = require("./load-arkademy-lib");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_FILE = path.join(ROOT, "arkademy-content", "arkademy.json");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const STATUS_LIMIT = 10;
/** A pretty-printed file may be larger than its compact JSON; past this it is not read at all. */
const MAX_FILE_FACTOR = 4;

const USAGE = `usage:
  npm run arkademy -- check    [file]
  npm run arkademy -- publish  [file] [--note "…"] [--yes]
  npm run arkademy -- status
  npm run arkademy -- rollback [--to N] [--yes]`;

class ScriptExit extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

let lib;
function arkademy() {
  if (!lib) lib = loadArkademyLib();
  return lib;
}

/** The canonical text of a validated document, its SHA-256 and its size. */
function canonical(document) {
  const text = JSON.stringify(document);
  return {
    text,
    sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
    sizeBytes: Buffer.byteLength(text, "utf8"),
  };
}

async function readCurrent(client) {
  const { rows } = await client.query(
    "select version, sha256 from arkademy_documents order by version desc limit 1",
  );
  return rows[0] ? { version: rows[0].version, sha256: rows[0].sha256 } : null;
}

async function inTransaction(client, fn) {
  await client.query("begin");
  try {
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Validates `document` and inserts it as the next version, unless it is
 * byte-for-byte the current one. `client` is a connected pg.Client.
 *
 * → { status: "invalid", errors, warnings }
 * → { status: "unchanged", version, warnings }
 * → { status: "published", version, sha256, sizeBytes, warnings }
 */
async function publishDocument(client, document, { note = null } = {}) {
  const { validateArkademyDocument, ARKADEMY_FORMAT_VERSION } = arkademy();
  const result = validateArkademyDocument(document);
  if (!result.ok) return { status: "invalid", errors: result.errors, warnings: result.warnings };
  const { text, sha256, sizeBytes } = canonical(result.document);

  return inTransaction(client, async () => {
    const current = await readCurrent(client);
    if (current && current.sha256 === sha256) {
      return { status: "unchanged", version: current.version, warnings: result.warnings };
    }
    const version = current ? current.version + 1 : 1;
    // Two concurrent publishes both compute this version; the second insert
    // fails on the primary key and its caller exits 1. Nothing is lost.
    await client.query(
      `insert into arkademy_documents (version, format_version, document, sha256, size_bytes, note)
       values ($1, $2, $3::jsonb, $4, $5, $6)`,
      [version, ARKADEMY_FORMAT_VERSION, text, sha256, sizeBytes, note],
    );
    return { status: "published", version, sha256, sizeBytes, warnings: result.warnings };
  });
}

/**
 * Re-publishes an earlier version as a new one, with `restored_from` set.
 * The target is `to`, or the newest version below the current one whose
 * hash differs from the current hash. It is re-validated against today's
 * schema first (after the format upgrade), and refused if it fails.
 *
 * → { status: "empty" }                     no version at all
 * → { status: "nothing" }                   no earlier version differs from the current one
 * → { status: "missing", to }               `to` names no version
 * → { status: "invalid", to, errors, warnings }
 * → { status: "unchanged", version, to }    `to` holds the current document already
 * → { status: "rolled-back", version, to, sha256, sizeBytes, warnings }
 */
async function rollbackDocument(client, { to } = {}) {
  const { validateArkademyDocument, upgradeArkademyDocument, ARKADEMY_FORMAT_VERSION } = arkademy();
  return inTransaction(client, async () => {
    const current = await readCurrent(client);
    if (!current) return { status: "empty" };

    const columns = "version, format_version, document";
    const { rows } =
      to === undefined
        ? await client.query(
            `select ${columns} from arkademy_documents
             where version < $1 and sha256 <> $2 order by version desc limit 1`,
            [current.version, current.sha256],
          )
        : await client.query(`select ${columns} from arkademy_documents where version = $1`, [to]);
    const target = rows[0];
    if (!target) return to === undefined ? { status: "nothing" } : { status: "missing", to };

    const upgraded = upgradeArkademyDocument(target.document, target.format_version);
    if (!upgraded.ok) {
      return {
        status: "invalid",
        to: target.version,
        errors: [{ level: "error", path: "$", message: upgraded.message }],
        warnings: [],
      };
    }
    const result = validateArkademyDocument(upgraded.document);
    if (!result.ok) {
      return { status: "invalid", to: target.version, errors: result.errors, warnings: result.warnings };
    }
    const { text, sha256, sizeBytes } = canonical(result.document);
    if (sha256 === current.sha256) return { status: "unchanged", version: current.version, to: target.version };

    const version = current.version + 1;
    await client.query(
      `insert into arkademy_documents (version, format_version, document, sha256, size_bytes, note, restored_from)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
      [version, ARKADEMY_FORMAT_VERSION, text, sha256, sizeBytes, `rollback to v${target.version}`, target.version],
    );
    return { status: "rolled-back", version, to: target.version, sha256, sizeBytes, warnings: result.warnings };
  });
}

/** The newest `limit` versions, newest first, without their documents. */
async function listVersions(client, limit = STATUS_LIMIT) {
  const { rows } = await client.query(
    `select version, format_version, sha256, size_bytes, note, restored_from, uploaded_at
     from arkademy_documents order by version desc limit $1`,
    [limit],
  );
  return rows.map((row) => ({
    version: row.version,
    formatVersion: row.format_version,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    note: row.note,
    restoredFrom: row.restored_from,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

const OPTIONS = {
  check: [],
  publish: ["note", "yes"],
  status: [],
  rollback: ["to", "yes"],
};
const TAKES_FILE = new Set(["check", "publish"]);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") throw new ScriptExit(USAGE, 2);
  if (!Object.hasOwn(OPTIONS, command)) throw new ScriptExit(`unknown command "${command}"\n${USAGE}`, 2);
  const args = { command, file: null, note: null, yes: false, to: undefined };
  const allowed = OPTIONS[command];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const [flag, inline] = arg.startsWith("--") ? arg.slice(2).split(/=(.*)/s) : [null, undefined];
    if (flag === null) {
      if (!TAKES_FILE.has(command) || args.file !== null) throw new ScriptExit(`unexpected argument "${arg}"\n${USAGE}`, 2);
      args.file = arg;
      continue;
    }
    if (!allowed.includes(flag)) throw new ScriptExit(`"${command}" takes no --${flag}\n${USAGE}`, 2);
    if (flag === "yes") {
      args.yes = true;
      continue;
    }
    const value = inline !== undefined ? inline : rest[++index];
    if (value === undefined) throw new ScriptExit(`--${flag} needs a value`, 2);
    if (flag === "note") args.note = value;
    if (flag === "to") {
      if (!/^[1-9][0-9]*$/.test(value)) throw new ScriptExit(`--to takes a version number, not "${value}"`, 2);
      args.to = Number(value);
    }
  }
  return args;
}

function resolveFile(fileArg) {
  const chosen = fileArg ?? process.env.ARKADEMY_CONTENT ?? DEFAULT_FILE;
  // `npm run` starts scripts in the repository root; INIT_CWD is where the
  // owner typed the command, which is what a relative path means to them.
  return path.resolve(process.env.INIT_CWD || process.cwd(), chosen);
}

function readDocumentFile(file, maxBytes) {
  if (!fs.existsSync(file)) {
    throw new ScriptExit(
      `no file at ${file}\nPass a path, set ARKADEMY_CONTENT, or keep the library at arkademy-content/arkademy.json.`,
    );
  }
  const size = fs.statSync(file).size;
  if (size > maxBytes * MAX_FILE_FACTOR) {
    throw new ScriptExit(`${file} is ${size} bytes; the document may hold at most ${maxBytes} bytes of JSON`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new ScriptExit(`${file} is not JSON: ${err.message}`);
  }
}

function printFindings({ errors = [], warnings = [] }) {
  for (const finding of warnings) console.log(`warning  ${finding.path}  ${finding.message}`);
  for (const finding of errors) console.error(`error    ${finding.path}  ${finding.message}`);
}

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/** Host and database name of DATABASE_URL — never the password. */
function databaseTarget() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new ScriptExit(
      "DATABASE_URL is not set. Pass it inline (DATABASE_URL=… npm run arkademy -- …) or with " +
        "node --env-file=.env.production.local scripts/arkademy/upload.js …",
    );
  }
  try {
    const url = new URL(connectionString);
    return {
      connectionString,
      host: url.hostname || "localhost",
      database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "(default)",
      local: LOCAL_HOSTS.has(url.hostname || "localhost"),
    };
  } catch {
    return { connectionString, host: "(unparsed)", database: "(unparsed)", local: false };
  }
}

async function withClient(target, fn) {
  const { Client } = require("pg");
  const client = new Client({ connectionString: target.connectionString });
  try {
    await client.connect();
  } catch (err) {
    throw new ScriptExit(`could not connect to ${target.host}: ${err.message}`);
  }
  try {
    return await fn(client);
  } catch (err) {
    if (err && err.code === "42P01") {
      throw new ScriptExit(`${err.message}: run npm run db:migrate against ${target.host} first`);
    }
    throw err;
  } finally {
    await client.end();
  }
}

function announce(target, { writes, yes }) {
  console.log(`database: ${target.database} on ${target.host}`);
  if (writes && !target.local && !yes) {
    throw new ScriptExit(`${target.host} is not this machine; add --yes to write to it`);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const { validateArkademyDocument, MAX_DOCUMENT_BYTES } = arkademy();

  if (args.command === "check" || args.command === "publish") {
    const file = resolveFile(args.file);
    const input = readDocumentFile(file, MAX_DOCUMENT_BYTES);
    const result = validateArkademyDocument(input);
    printFindings(result);
    if (!result.ok) throw new ScriptExit(`${plural(result.errors.length, "error")} in ${file}; nothing written`);
    const { document } = result;
    const { sizeBytes } = canonical(document);
    console.log(
      `valid: ${file} (${kilobytes(sizeBytes)}; ${plural(document.tools[0].examples.length, "example")}, ` +
        `${plural(document.entities.length, "entity", "entities")}, ${plural(document.uses.length, "use")}, ` +
        `${plural(result.warnings.length, "warning")})`,
    );
    if (args.command === "check") return 0;

    const target = databaseTarget();
    announce(target, { writes: true, yes: args.yes });
    const outcome = await withClient(target, (client) => publishDocument(client, input, { note: args.note }));
    if (outcome.status === "unchanged") {
      console.log(`unchanged (v${outcome.version})`);
      return 0;
    }
    if (outcome.status !== "published") {
      printFindings(outcome);
      throw new ScriptExit("the document did not validate; nothing written");
    }
    console.log(
      `published v${outcome.version} (${kilobytes(outcome.sizeBytes)}, ${plural(outcome.warnings.length, "warning")}) — live within 5 minutes`,
    );
    return 0;
  }

  const target = databaseTarget();
  if (args.command === "status") {
    announce(target, { writes: false });
    const versions = await withClient(target, (client) => listVersions(client, STATUS_LIMIT));
    if (versions.length === 0) {
      console.log("no version uploaded yet");
      return 0;
    }
    console.log("version  uploaded_at               size       sha256    from  note");
    for (const row of versions) {
      console.log(
        [
          `v${row.version}`.padEnd(7),
          row.uploadedAt.padEnd(24),
          kilobytes(row.sizeBytes).padStart(9),
          row.sha256.slice(0, 8),
          (row.restoredFrom === null ? "" : `v${row.restoredFrom}`).padEnd(4),
          row.note ?? "",
        ].join("  "),
      );
    }
    return 0;
  }

  // rollback
  announce(target, { writes: true, yes: args.yes });
  const outcome = await withClient(target, (client) => rollbackDocument(client, { to: args.to }));
  switch (outcome.status) {
    case "empty":
      throw new ScriptExit("nothing to roll back: no version has been uploaded");
    case "nothing":
      throw new ScriptExit("nothing to roll back to: no earlier version differs from the current one");
    case "missing":
      throw new ScriptExit(`there is no v${outcome.to}`);
    case "invalid":
      printFindings(outcome);
      throw new ScriptExit(`v${outcome.to} no longer passes today's schema; nothing written`);
    case "unchanged":
      console.log(`unchanged (v${outcome.version} already holds v${outcome.to}'s document)`);
      return 0;
    default:
      console.log(`rolled back: v${outcome.version} restores v${outcome.to} — live within 5 minutes`);
      return 0;
  }
}

module.exports = { publishDocument, rollbackDocument, listVersions, parseArgs, main };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      cleanup();
      process.exitCode = code;
    },
    (err) => {
      cleanup();
      if (err instanceof ScriptExit) {
        console.error(`[arkademy] ${err.message}`);
        process.exitCode = err.code;
      } else {
        console.error(`[arkademy] ${err && err.stack ? err.stack : err}`);
        process.exitCode = 1;
      }
    },
  );
}
````

In `package.json`, replace

```json
    "db:migrate": "node db/migrate.mjs",
```

with

```json
    "db:migrate": "node db/migrate.mjs",
    "arkademy": "node scripts/arkademy/upload.js",
```

- [ ] **Step 5: Run the suite to verify it passes**

Run: `npm run test:arkademy-schema`
Expected: 184 `PASS:` lines, no `FAIL:`, `All arkademy-schema tests passed.`, exit 0. `scripts/arkademy/.build/` does not exist afterwards.

- [ ] **Step 6: Run the commands once against the scratch Postgres**

With `DATABASE_URL` pointing at the scratch cluster (Task 4 migrated it):

```bash
F=tests/fixtures/arkademy/document.json
npm run --silent arkademy -- check "$F"
npm run --silent arkademy -- publish "$F" --note "rehearsal v1"
npm run --silent arkademy -- publish "$F"
sed 's/Tide tables for people who fish from the shore/Tide tables for shore anglers/' "$F" > "$PGSCRATCH.changed.json"
npm run --silent arkademy -- publish "$PGSCRATCH.changed.json" --note "rehearsal v2"
npm run --silent arkademy -- rollback
npm run --silent arkademy -- status
DATABASE_URL='postgres://u:secret@db.example.com/prod' npm run --silent arkademy -- rollback; echo "exit $?"
psql -q "$DATABASE_URL" -c 'truncate arkademy_documents'
```

Expected, in order (paths shortened):
- `warning  entities[8]  "pop-up-stalls" has no use, so it never appears as an inspiration` then `valid: …/document.json (10.1 KB; 3 examples, 30 entities, 33 uses, 1 warning)`.
- the same two lines, `database: arkaik_test on localhost`, `published v1 (10.1 KB, 1 warning) — live within 5 minutes`.
- the same two lines, `database: arkaik_test on localhost`, `unchanged (v1)`.
- …`published v2 (10.1 KB, 1 warning) — live within 5 minutes`.
- `database: arkaik_test on localhost`, `rolled back: v3 restores v1 — live within 5 minutes`.
- a header `version  uploaded_at               size       sha256    from  note` and three rows, newest first: `v3 … v1    rollback to v1`, `v2 … rehearsal v2`, `v1 … rehearsal v1`, where v3 and v1 show the same 8-character hash.
- `database: prod on db.example.com`, `[arkademy] db.example.com is not this machine; add --yes to write to it`, `exit 1` — the password never printed, nothing connected.

- [ ] **Step 7: Commit**

```bash
git status --porcelain     # expect only: M package.json, M tests/app/arkademy-schema.test.js, ?? scripts/arkademy/
git add scripts/arkademy/upload.js scripts/arkademy/load-arkademy-lib.js package.json tests/app/arkademy-schema.test.js
git commit -m "feat(arkademy): the upload script — check, publish, status, rollback"
```

---

### Task 6: The cached loader and the public read route

**Files:**
- Create: `tests/services/load-arkademy-api.js`, `tests/services/arkademy-api.test.js`
- Create: `lib/services/arkademy.ts`, `app/api/arkademy/route.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`

`DATABASE_URL` must point at the migrated scratch cluster.

- [ ] **Step 1: Write the loader**

Create `tests/services/load-arkademy-api.js`:

````js
/**
 * Loads the Arkademy read side — app/api/arkademy/route.ts, lib/services/
 * arkademy.ts and what they import — into a running Node process without a
 * bundler (the load-publik-api.js technique), for tests/services/
 * arkademy-api.test.js.
 *
 * The transpiled files go into tests/services/.test-build-arkademy/, inside
 * the repo so bare requires (`pg`, `zod`) resolve against the workspace's
 * node_modules. lib/arkademy/*.ts is copied whole into its `arkademy/`
 * subfolder, discovered rather than listed, so its relative imports keep
 * working.
 *
 * THE ALIAS TABLE. A new `@/…` import in lib/services/arkademy.ts or the route
 * needs a line in REWRITES below — here and nowhere else. `@/lib/arkademy/<name>`
 * is rewritten by rule. Anything left over fails the load by name.
 *
 * Stubs: `server-only` is an empty module (it throws outside React Server
 * Components); `next/cache`'s `unstable_cache` returns the function itself and
 * records each wrapping and each call in `nextCache.created` / `nextCache.calls`,
 * so the suite can prove which path `getArkademy` takes.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-arkademy");
const ARKADEMY_SRC = path.join(ROOT, "lib", "arkademy");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

const REWRITES = [
  ["server-only", "./server-only-stub.js"],
  ["next/cache", "./next-cache-stub.js"],
  ["@/lib/services/db", "./db.js"],
  ["@/lib/services/graph/etag", "./etag.js"],
  ["@/lib/services/arkademy", "./services-arkademy.js"],
];

const NEXT_CACHE_STUB = `
const created = [];
const calls = [];
function unstable_cache(fn, keyParts, options) {
  created.push({ keyParts, options });
  return (...args) => {
    calls.push({ keyParts, options });
    return fn(...args);
  };
}
module.exports = { unstable_cache, created, calls };
`;

function transpile(srcAbsPath) {
  const source = fs.readFileSync(srcAbsPath, "utf8");
  let { outputText } = ts.transpileModule(source, {
    fileName: path.basename(srcAbsPath),
    compilerOptions: COMPILER_OPTIONS,
  });
  for (const [specifier, replacement] of REWRITES) {
    outputText = outputText.split(`require("${specifier}")`).join(`require("${replacement}")`);
  }
  outputText = outputText.replace(/require\("@\/lib\/arkademy\/([a-z0-9-]+)"\)/g, 'require("./arkademy/$1.js")');
  const leftover = /require\("(@\/[^"]+)"\)/.exec(outputText);
  if (leftover) {
    throw new Error(
      `${path.relative(ROOT, srcAbsPath)} imports ${leftover[1]}, which tests/services/load-arkademy-api.js does not map`,
    );
  }
  return outputText;
}

function loadArkademyApi() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(BUILD_DIR, "arkademy"), { recursive: true });
  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);
  write("package.json", JSON.stringify({ type: "commonjs" }));
  write("server-only-stub.js", "module.exports = {};\n");
  write("next-cache-stub.js", NEXT_CACHE_STUB);

  for (const name of fs.readdirSync(ARKADEMY_SRC)) {
    if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
    write(path.join("arkademy", name.replace(/\.ts$/, ".js")), transpile(path.join(ARKADEMY_SRC, name)));
  }
  write("db.js", transpile(path.join(ROOT, "lib", "services", "db.ts")));
  write("etag.js", transpile(path.join(ROOT, "lib", "services", "graph", "etag.ts")));
  write("services-arkademy.js", transpile(path.join(ROOT, "lib", "services", "arkademy.ts")));
  write("route.js", transpile(path.join(ROOT, "app", "api", "arkademy", "route.ts")));

  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(BUILD_DIR)) delete require.cache[key];
  }
  const route = require(path.join(BUILD_DIR, "route.js"));
  return {
    GET: route.GET,
    route,
    arkademy: require(path.join(BUILD_DIR, "services-arkademy.js")),
    db: require(path.join(BUILD_DIR, "db.js")),
    nextCache: require(path.join(BUILD_DIR, "next-cache-stub.js")),
  };
}

function cleanup() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

module.exports = { loadArkademyApi, cleanup, BUILD_DIR };
````

- [ ] **Step 2: Write the failing suite**

Create `tests/services/arkademy-api.test.js`:

````js
#!/usr/bin/env node

/**
 * Integration tests for the Arkademy read side and the upload script's
 * database half (docs/spec/services.md § Arkademy): GET /api/arkademy and
 * getArkademy against a real, migrated Postgres, with versions written by
 * scripts/arkademy/upload.js's publishDocument and rollbackDocument.
 *
 * Needs DATABASE_URL (the CI services job sets it; locally, a scratch cluster
 * migrated with `npm run db:migrate`). It TRUNCATES arkademy_documents, so it
 * refuses any host but this machine.
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { loadArkademyApi, cleanup } = require("./load-arkademy-api");
const { cleanup: cleanupUploadBuild } = require("../../scripts/arkademy/load-arkademy-lib");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");
const ORIGIN = "https://arkademy.test";
const READY_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const request = (headers = {}) => new Request(`${ORIGIN}/api/arkademy`, { headers });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "\n[arkademy-api.test] DATABASE_URL is not set. These integration tests need a migrated Postgres " +
        "(the CI services job sets it; locally, start one and run `npm run db:migrate` first). Refusing to pass silently.",
    );
    process.exit(1);
  }
  if (!LOCAL_HOSTS.has(new URL(connectionString).hostname)) {
    console.error("\n[arkademy-api.test] this suite truncates arkademy_documents; it runs against localhost only.");
    process.exit(1);
  }

  const api = loadArkademyApi();
  const { GET } = api;
  const { getArkademy, arkademyEtag, ARKADEMY_CACHE_SECONDS } = api.arkademy;
  const upload = require("../../scripts/arkademy/upload.js");
  const client = new Client({ connectionString });
  await client.connect();
  const rowCount = async () => (await client.query("select count(*)::int as n from arkademy_documents")).rows[0].n;

  // Collects what the loader logs, so a check can prove no document text leaks into a log line.
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(" "));

  try {
    await client.query("truncate arkademy_documents");

    check("the cache window is five minutes", ARKADEMY_CACHE_SECONDS === 300);
    check("the validator names the version", arkademyEtag(7) === 'W/"arkademy.7"');

    // --- Not configured ----------------------------------------------------
    delete process.env.DATABASE_URL;
    try {
      const lookup = await getArkademy();
      check("unconfigured: getArkademy says so", lookup.status === "unconfigured", JSON.stringify(lookup));
      const res = await GET(request());
      const body = await res.json();
      check("unconfigured: 503", res.status === 503, `status ${res.status}`);
      check("unconfigured: the services_unavailable body", body.error === "services_unavailable" && /Arkademy/.test(body.message), JSON.stringify(body));
      check("unconfigured: never cached", res.headers.get("cache-control") === "no-store", res.headers.get("cache-control"));
    } finally {
      process.env.DATABASE_URL = connectionString;
    }

    // --- Empty table -------------------------------------------------------
    {
      const lookup = await getArkademy();
      check("empty: getArkademy says so", lookup.status === "empty", JSON.stringify(lookup));
      const res = await GET(request());
      const body = await res.json();
      check("empty: 404 no_document", res.status === 404 && body.error === "no_document", `${res.status} ${JSON.stringify(body)}`);
      check("empty: cached for a minute", res.headers.get("cache-control") === "public, max-age=60, s-maxage=60", res.headers.get("cache-control"));
      check("empty: no ETag", res.headers.get("etag") === null);
    }

    // --- Publish v1 --------------------------------------------------------
    const v1 = await upload.publishDocument(client, fixture(), { note: "first" });
    check("publish: the fixture becomes v1", v1.status === "published" && v1.version === 1, JSON.stringify(v1));
    check("publish: one row", (await rowCount()) === 1);
    {
      const lookup = await getArkademy();
      check(
        "ready: getArkademy returns the validated document",
        lookup.status === "ready" && lookup.version === 1 && JSON.stringify(lookup.document) === JSON.stringify(fixture()),
        JSON.stringify(lookup).slice(0, 200),
      );
      check("ready: uploadedAt is an ISO string", lookup.status === "ready" && new Date(lookup.uploadedAt).toISOString() === lookup.uploadedAt);

      const res = await GET(request());
      const body = await res.json();
      check("ready: 200", res.status === 200, `status ${res.status}`);
      check("ready: version 1, format 1", body.version === 1 && body.format_version === 1, JSON.stringify({ ...body, document: undefined }));
      check("ready: uploaded_at is ISO 8601", new Date(body.uploaded_at).toISOString() === body.uploaded_at, body.uploaded_at);
      check("ready: the document as validated", JSON.stringify(body.document) === JSON.stringify(fixture()));
      check("ready: ETag W/\"arkademy.1\"", res.headers.get("etag") === 'W/"arkademy.1"', res.headers.get("etag"));
      check("ready: CDN-cacheable", res.headers.get("cache-control") === READY_CACHE, res.headers.get("cache-control"));
    }
    {
      const res = await GET(request({ "if-none-match": 'W/"arkademy.1"' }));
      check("conditional: a matching tag gets 304", res.status === 304, `status ${res.status}`);
      check("conditional: with no body", (await res.text()) === "");
      check("conditional: the same validator and caching", res.headers.get("etag") === 'W/"arkademy.1"' && res.headers.get("cache-control") === READY_CACHE);
      const stale = await GET(request({ "if-none-match": 'W/"arkademy.0"' }));
      check("conditional: another tag gets the body", stale.status === 200, `status ${stale.status}`);
    }

    // --- Publishing again --------------------------------------------------
    {
      const same = await upload.publishDocument(client, fixture(), { note: "again" });
      check("unchanged: nothing is written", same.status === "unchanged" && same.version === 1 && (await rowCount()) === 1, JSON.stringify(same));
      const reordered = fixture();
      reordered.companies[0] = Object.fromEntries(Object.entries(reordered.companies[0]).reverse());
      const again = await upload.publishDocument(client, reordered, {});
      check("unchanged: key order does not count as a change", again.status === "unchanged" && (await rowCount()) === 1, JSON.stringify(again));

      const broken = fixture();
      broken.uses[0].entity = "nothing-here";
      const refused = await upload.publishDocument(client, broken, {});
      check(
        "invalid: refused with the path, nothing written",
        refused.status === "invalid" && refused.errors.some((finding) => finding.path === "uses[0].entity") && (await rowCount()) === 1,
        JSON.stringify(refused),
      );

      const changed = fixture();
      changed.companies[1].oneLiner = "Tide tables for shore anglers";
      const v2 = await upload.publishDocument(client, changed, { note: "second" });
      check("changed: becomes v2", v2.status === "published" && v2.version === 2, JSON.stringify(v2));
      const res = await GET(request({ "if-none-match": 'W/"arkademy.1"' }));
      const body = await res.json();
      check("changed: the old tag no longer matches", res.status === 200 && res.headers.get("etag") === 'W/"arkademy.2"', `${res.status} ${res.headers.get("etag")}`);
      check("changed: the route serves v2", body.version === 2 && body.document.companies[1].oneLiner === "Tide tables for shore anglers");
    }

    // --- Rollback ------------------------------------------------------------
    {
      const v3 = await upload.rollbackDocument(client, {});
      check("rollback: writes v3 from v1", v3.status === "rolled-back" && v3.version === 3 && v3.to === 1, JSON.stringify(v3));
      const { rows } = await client.query("select version, sha256, restored_from, note from arkademy_documents order by version");
      check("rollback: v3 carries v1's hash", rows[2].sha256 === rows[0].sha256 && rows[2].sha256 !== rows[1].sha256);
      check("rollback: restored_from = 1, with a note", rows[2].restored_from === 1 && rows[2].note === "rollback to v1", JSON.stringify(rows[2]));
      const res = await GET(request());
      const body = await res.json();
      check("rollback: the route serves v1's document as v3", body.version === 3 && JSON.stringify(body.document) === JSON.stringify(fixture()));

      const same = await upload.rollbackDocument(client, { to: 1 });
      check("rollback: to a version holding the current document changes nothing", same.status === "unchanged" && (await rowCount()) === 3, JSON.stringify(same));
      const missing = await upload.rollbackDocument(client, { to: 99 });
      check("rollback: to a version that does not exist", missing.status === "missing" && missing.to === 99, JSON.stringify(missing));
      const v4 = await upload.rollbackDocument(client, {});
      check("rollback: is itself undoable — the default target skips v1's twin", v4.status === "rolled-back" && v4.version === 4 && v4.to === 2, JSON.stringify(v4));

      const versions = await upload.listVersions(client, 10);
      check(
        "status: newest first, with restored_from",
        JSON.stringify(versions.map((row) => [row.version, row.restoredFrom])) === JSON.stringify([[4, 2], [3, 1], [2, null], [1, null]]),
        JSON.stringify(versions.map((row) => [row.version, row.restoredFrom])),
      );
      check("status: the limit is honoured", (await upload.listVersions(client, 2)).length === 2);
    }

    // --- A stored row today's schema refuses -----------------------------------
    {
      await client.query(
        `insert into arkademy_documents (version, format_version, document, sha256, size_bytes)
         values (5, 1, '{"formatVersion": 1, "tools": []}'::jsonb, 'by-hand', 33)`,
      );
      logged.length = 0;
      const lookup = await getArkademy();
      check("invalid: getArkademy names the version", lookup.status === "invalid" && lookup.version === 5, JSON.stringify(lookup));
      const res = await GET(request());
      const body = await res.json();
      check("invalid: 500 document_invalid", res.status === 500 && body.error === "document_invalid", `${res.status} ${JSON.stringify(body)}`);
      check("invalid: never cached", res.headers.get("cache-control") === "no-store");
      check("invalid: the log names the version", logged.some((line) => line.includes("v5")), JSON.stringify(logged));
      const refused = await upload.rollbackDocument(client, { to: 5 });
      check("rollback: refuses a version today's schema refuses", refused.status === "invalid" && (await rowCount()) === 5, JSON.stringify(refused).slice(0, 200));

      await client.query(
        `insert into arkademy_documents (version, format_version, document, sha256, size_bytes)
         values (6, 99, $1::jsonb, 'by-hand', 1)`,
        [JSON.stringify(fixture())],
      );
      logged.length = 0;
      const future = await getArkademy();
      check("format 99: getArkademy refuses it", future.status === "invalid" && future.version === 6, JSON.stringify(future));
      const futureRes = await GET(request());
      check("format 99: 500 document_invalid", futureRes.status === 500 && (await futureRes.json()).error === "document_invalid");
      check("format 99: the log holds no document text", logged.length > 0 && logged.every((line) => !line.includes("Tidewise")), JSON.stringify(logged));
    }

    // --- Postgres fails ------------------------------------------------------
    {
      const realQuery = api.db.query;
      api.db.query = async () => {
        throw new Error("connection terminated");
      };
      try {
        const lookup = await getArkademy();
        check("error: getArkademy catches it", lookup.status === "error", JSON.stringify(lookup));
        const res = await GET(request());
        const body = await res.json();
        check("error: 500 internal_error", res.status === 500 && body.error === "internal_error", JSON.stringify(body));
        check("error: never cached", res.headers.get("cache-control") === "no-store");
      } finally {
        api.db.query = realQuery;
      }
    }

    // --- Which path getArkademy takes ------------------------------------------
    {
      const { created, calls } = api.nextCache;
      check(
        "cache: one wrapper, keyed and tagged as specified",
        created.length === 1 &&
          JSON.stringify(created[0].keyParts) === JSON.stringify(["arkademy-current"]) &&
          created[0].options.revalidate === 300 &&
          JSON.stringify(created[0].options.tags) === JSON.stringify(["arkademy"]),
        JSON.stringify(created),
      );
      const before = calls.length;
      await getArkademy();
      check("cache: development reads Postgres directly", calls.length === before);
      const savedEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        await getArkademy();
        check("cache: production reads through the data cache", calls.length === before + 1);
      } finally {
        if (savedEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = savedEnv;
      }
    }
  } finally {
    console.error = realError;
    await client.query("truncate arkademy_documents").catch(() => {});
    await client.end();
    await api.db.getPool().end();
    cleanup();
    cleanupUploadBuild();
  }

  if (failures > 0) {
    console.log(`\n${failures} arkademy-api test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll arkademy-api integration tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
````

- [ ] **Step 3: Register it in npm and in CI's services job**

In `package.json`, replace

```json
    "test:arkademy-schema": "node tests/app/arkademy-schema.test.js",
```

with

```json
    "test:arkademy-schema": "node tests/app/arkademy-schema.test.js",
    "test:arkademy-api": "node tests/services/arkademy-api.test.js",
```

In `.github/workflows/ci.yml`, replace

```yaml
      - name: Pollen feed integration tests (opt-in, cursor paging, 410 reset)
        run: npm run test:pollen-feed
```

with

```yaml
      - name: Pollen feed integration tests (opt-in, cursor paging, 410 reset)
        run: npm run test:pollen-feed
      - name: Arkademy read route + upload integration tests (publish, 304, rollback)
        run: npm run test:arkademy-api
```

Run: `actionlint`
Expected: no output.

- [ ] **Step 4: Run the suite to verify it fails**

Run: `npm run test:arkademy-api`
Expected: exit 1 before any check prints, with `Error: ENOENT: no such file or directory, open '…/lib/services/arkademy.ts'`.

- [ ] **Step 5: Write the loader module**

Create `lib/services/arkademy.ts`:

````ts
import "server-only";

import { unstable_cache } from "next/cache";

import type { ArkademyDocument } from "@/lib/arkademy/schema";
import { upgradeArkademyDocument, validateArkademyDocument } from "@/lib/arkademy/validate";
import { query, servicesConfigured } from "@/lib/services/db";
import { formatReadEtag } from "@/lib/services/graph/etag";

/**
 * The Arkademy library, read from Postgres (docs/spec/services.md § Arkademy).
 *
 * `getArkademy` is THE contract: the Arkademy pages call it in-process (wrapped
 * in React's `cache()` per request, like `/p/[id]`), and `GET /api/arkademy`
 * is a thin HTTP wrapper over it for everything that is not a page. Nothing
 * reads the library any other way, and nothing reads it from a file.
 *
 * In production one cache entry holds the validated document for
 * ARKADEMY_CACHE_SECONDS, whatever the traffic, so anonymous readers and
 * crawlers never wake the (scale-to-zero) database per view. In development
 * it reads Postgres directly, so an upload shows on the next reload.
 */

export type ArkademyLookup =
  | { status: "unconfigured" } // no DATABASE_URL
  | { status: "empty" } // the table has no row
  | { status: "invalid"; version: number } // the stored row fails today's schema
  | { status: "error" } // Postgres failed
  | { status: "ready"; version: number; uploadedAt: string; document: ArkademyDocument };

/** The newest row of arkademy_documents, as stored. */
export interface StoredArkademyRow {
  version: number;
  formatVersion: number;
  document: unknown;
  sha256: string;
  uploadedAt: string; // ISO 8601
}

export const ARKADEMY_CACHE_SECONDS = 300;

/** One query, uncached: the newest version, or null on an empty table. */
export async function readCurrentArkademy(): Promise<StoredArkademyRow | null> {
  const { rows } = await query<{
    version: number;
    format_version: number;
    document: unknown;
    sha256: string;
    uploaded_at: Date;
  }>(
    `select version, format_version, document, sha256, uploaded_at
     from arkademy_documents order by version desc limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    version: row.version,
    formatVersion: row.format_version,
    document: row.document,
    sha256: row.sha256,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  };
}

type LoadedArkademy = Extract<ArkademyLookup, { status: "empty" | "invalid" | "ready" }>;

/**
 * Reads, upgrades and validates the newest row. Returns plain JSON only — the
 * data cache serialises it. Throws when Postgres fails, so a failure is
 * never cached.
 */
async function loadArkademy(): Promise<LoadedArkademy> {
  const row = await readCurrentArkademy();
  if (!row) return { status: "empty" };
  const upgraded = upgradeArkademyDocument(row.document, row.formatVersion);
  if (!upgraded.ok) {
    console.error(`[arkademy] v${row.version} cannot be read: ${upgraded.message}`);
    return { status: "invalid", version: row.version };
  }
  const result = validateArkademyDocument(upgraded.document);
  if (!result.ok) {
    // Paths and messages only: a message names a rule, never the document's text.
    const first = result.errors[0];
    console.error(
      `[arkademy] v${row.version} fails this build's schema (${result.errors.length} errors; first: ${first.path} ${first.message})`,
    );
    return { status: "invalid", version: row.version };
  }
  return { status: "ready", version: row.version, uploadedAt: row.uploadedAt, document: result.document };
}

const loadArkademyCached = unstable_cache(loadArkademy, ["arkademy-current"], {
  revalidate: ARKADEMY_CACHE_SECONDS,
  tags: ["arkademy"],
});

/** The library, or why there is none. Never throws. */
export async function getArkademy(): Promise<ArkademyLookup> {
  if (!servicesConfigured()) return { status: "unconfigured" };
  try {
    return process.env.NODE_ENV === "production" ? await loadArkademyCached() : await loadArkademy();
  } catch (err) {
    console.error("[arkademy] load failed:", err instanceof Error ? err.message : "unknown error");
    return { status: "error" };
  }
}

/** The weak validator of a version: `W/"arkademy.<version>"`. */
export function arkademyEtag(version: number): string {
  return formatReadEtag(["arkademy", String(version)]);
}
````

- [ ] **Step 6: Write the route**

Create `app/api/arkademy/route.ts`:

````ts
import { arkademyEtag, getArkademy } from "@/lib/services/arkademy";
import { servicesUnavailable } from "@/lib/services/db";
import { ifNoneMatchSatisfied } from "@/lib/services/graph/etag";

/**
 * GET /api/arkademy — the Arkademy library, public, no parameters
 * (docs/spec/services.md § Arkademy). A thin wrapper over `getArkademy`, the
 * cached loader the pages call in-process; this route is the contract for
 * agents, scripts and anything else that is not a page.
 *
 * Node runtime for the `pg` driver; force-dynamic so the build never touches
 * the database. The data cache behind `getArkademy` and the CDN headers below
 * are what keep a read cheap.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READY_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";
const EMPTY_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
const NO_STORE = "no-store";

export async function GET(req: Request): Promise<Response> {
  const lookup = await getArkademy();
  switch (lookup.status) {
    case "ready": {
      const etag = arkademyEtag(lookup.version);
      const headers = { ETag: etag, "Cache-Control": READY_CACHE_CONTROL };
      if (ifNoneMatchSatisfied(req.headers.get("if-none-match"), etag)) {
        return new Response(null, { status: 304, headers });
      }
      return Response.json(
        {
          version: lookup.version,
          uploaded_at: lookup.uploadedAt,
          format_version: lookup.document.formatVersion,
          document: lookup.document,
        },
        { status: 200, headers },
      );
    }
    case "empty":
      return Response.json(
        { error: "no_document", message: "No Arkademy document has been uploaded yet." },
        { status: 404, headers: { "Cache-Control": EMPTY_CACHE_CONTROL } },
      );
    case "unconfigured": {
      const response = servicesUnavailable("Arkademy");
      response.headers.set("Cache-Control", NO_STORE);
      return response;
    }
    case "invalid":
      return Response.json(
        {
          error: "document_invalid",
          message: `The stored Arkademy document (v${lookup.version}) does not pass this deployment's schema.`,
        },
        { status: 500, headers: { "Cache-Control": NO_STORE } },
      );
    case "error":
      return Response.json(
        { error: "internal_error", message: "Failed to load the Arkademy." },
        { status: 500, headers: { "Cache-Control": NO_STORE } },
      );
  }
}
````

- [ ] **Step 7: Run the suite to verify it passes**

Run: `npm run test:arkademy-api`
Expected: 53 `PASS:` lines, no `FAIL:`, `All arkademy-api integration tests passed.`, exit 0. Afterwards neither `tests/services/.test-build-arkademy/` nor `scripts/arkademy/.build/` exists, and the table is empty again.

Run each guard once:
- `env -u DATABASE_URL npm run test:arkademy-api` → `[arkademy-api.test] DATABASE_URL is not set. … Refusing to pass silently.`, exit 1.
- `DATABASE_URL=postgres://arkaik@db.example.com/x npm run test:arkademy-api` → `[arkademy-api.test] this suite truncates arkademy_documents; it runs against localhost only.`, exit 1.
- `node -e "const l=require('./tests/services/load-arkademy-api.js'); l.loadArkademyApi(); l.cleanup(); console.log('loads without a database')"` → `loads without a database` (the alias table is complete).

Run: `npx tsc --noEmit && npx eslint lib/services/arkademy.ts app/api/arkademy && actionlint`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add lib/services/arkademy.ts app/api/arkademy/route.ts tests/services/load-arkademy-api.js tests/services/arkademy-api.test.js package.json .github/workflows/ci.yml
git commit -m "feat(arkademy): the cached loader and the public read route"
```

---

### Task 7: The operator guide, the route's contract and the table in the docs

**Files:**
- Create: `docs/arkademy.md`
- Modify: `lib/utils/docs-visibility.ts`, `docs/architecture.md`, `docs/spec/services.md`

- [ ] **Step 1: Write the operator guide**

Create `docs/arkademy.md`:

````markdown
# The Arkademy library — operator guide

The Arkademy's pages read one JSON document, the **library**: its tools (today
the Business Model Canvas), the example companies, the entities they share and
each company's own wording. The library is data, not code. It is never
committed: the owner keeps it in a gitignored folder, uploads it with a script,
and the app reads it back from Postgres only — in development as in
production. The design is
`docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md`.

This area of `docs/` is internal (`lib/utils/docs-visibility.ts`); the public
contract of the route and the table is
[spec/services.md § Arkademy](spec/services.md).

## The document

The shape and its rules live in `lib/arkademy/schema.ts`; the rules across
fields (unknown ids, kinds that do not match, more than five answers, an
open question that is also answered) in `lib/arkademy/validate.ts`. A finding
names a JSON path such as `uses[12].entity`. Errors refuse the upload;
warnings are printed and the upload goes ahead.

Two content rules no validator can check:

- **An entity id is permanent once uploaded.** A visitor's browser may hold
  it. Relabelling an entity is free; renaming its id is not.
- Two companies share an entity by pointing at the same id, each with its own
  `text`.
- **A fact goes in a note, never in a wording.** A figure, a date, a named
  supplier — anything a reader could ask "says who?" about — is a use's
  `note`, with its source: a name, an `https` link and a date — the date the
  source carries (`dateKind: "published"`), or for an undated page such as a
  pricing page the day it was read (`dateKind: "accessed"`). A fact with no
  source a reader can open stays out of the library.
  `check` warns on a wording that looks like a figure or a press claim, and on
  a note dated in the future.

`tests/fixtures/arkademy/document.json` is a small, fictional, valid document
to copy the shape from.

## The content folder

`arkademy-content/` at the repository root is gitignored. It holds
`arkademy.json` and whatever drafts sit beside it; the script reads one file.
A gitignored folder belongs to one checkout — a git worktree does not see the
main checkout's ignored files — so keep the content in the main checkout and,
from anywhere else, pass its path or set `ARKADEMY_CONTENT`.

## The commands

```
npm run arkademy -- check    [file]                     validate only, no database
npm run arkademy -- publish  [file] [--note "…"] [--yes]
npm run arkademy -- status                             the last ten versions
npm run arkademy -- rollback [--to N] [--yes]
```

`file` defaults to `$ARKADEMY_CONTENT`, then `arkademy-content/arkademy.json`.
A relative path is read from the directory you typed the command in.

The database is `DATABASE_URL`, as for `npm run db:migrate`. Before a write the
script prints the database name and host (never the password) and refuses any
host but `localhost`, `127.0.0.1` or `::1` without `--yes`. Exit codes: 0 done
(or nothing to do), 1 refused or failed, 2 a usage mistake.

- **check** validates the file and prints its findings. Nothing else.
- **publish** validates, then inserts the document as the next version — or
  prints `unchanged (vN)` when it is the current document already (compared by
  the SHA-256 of its canonical JSON, so key order and whitespace in the file
  do not count). Two publishes at once collide on the version; the loser exits
  1 and writes nothing.
- **status** lists the last ten versions: version, upload time, size, the hash's
  first eight characters, the version a rollback restored, the note.
- **rollback** re-publishes an earlier version as a new one, with
  `restored_from` set and the note `rollback to vN`. The default target is the
  newest earlier version whose content differs from the current one; `--to N`
  names one. The target is re-validated against today's schema first and
  refused if it no longer passes. A rollback is undone the same way.

Nothing is ever updated or deleted: every version stays in the table.

## Local development

```
npm run db:migrate                                   # once, against the Postgres in .env.local
node --env-file=.env.local scripts/arkademy/upload.js publish
```

or `DATABASE_URL=postgres://… npm run arkademy -- publish`. In development
the app reads Postgres on every request, so the next reload shows the upload.

## Production

The table is created by `migrate-prod` when the migration lands on `main`.
Publish with the production connection string — the value behind Vercel's
production `DATABASE_URL` and the `PROD_DATABASE_URL` Actions secret — kept in
a `.env.production.local` file (gitignored by `.env*`):

```
node --env-file=.env.production.local scripts/arkademy/upload.js publish --note "…" --yes
```

The app caches the validated library for five minutes
(`ARKADEMY_CACHE_SECONDS`), so a publish or a rollback is live after the
first request more than five minutes after the previous refill. Nothing purges
the cache from the script. Check with:

```
curl -s https://arkaik.app/api/arkademy | head -c 200
curl -sI https://arkaik.app/api/arkademy        # twice: the CDN should answer the second
```

## When the app cannot show it

| `GET /api/arkademy` | Meaning | Fix |
|---|---|---|
| 503 `services_unavailable` | No `DATABASE_URL` on this deployment | Configure the database |
| 404 `no_document` | The table is empty | `publish` |
| 500 `document_invalid` | The newest row fails this deployment's schema (the server log names the version and the first finding) | `rollback`, or publish a fixed document |
| 500 `internal_error` | Postgres failed | Check the database |
````

- [ ] **Step 2: See the docs boundary fail**

Run: `npm run test:docs-visibility`
Expected: `FAIL: every area in docs/ is classified (unclassified: arkademy)`, `1 docs-visibility test(s) failed`, exit 1.

- [ ] **Step 3: Classify the guide as internal**

In `lib/utils/docs-visibility.ts`, replace

```ts
 * - `arkaik-skill`, `arkaik-bootstrap-skill`, `kritik-skill` — packaged skill
 *   sources, not pages; they ship as plugins and carry scripts rather than prose.
 */
export const INTERNAL_DOC_AREAS: readonly string[] = [
  "arkaik-bootstrap-skill",
```

with

```ts
 * - `arkaik-skill`, `arkaik-bootstrap-skill`, `kritik-skill` — packaged skill
 *   sources, not pages; they ship as plugins and carry scripts rather than prose.
 * - `arkademy` — the operator guide for uploading the Arkademy library: how the
 *   owner runs the upload script against production. Its public contract (the
 *   route and the table) is in `spec/services.md`.
 */
export const INTERNAL_DOC_AREAS: readonly string[] = [
  "arkademy",
  "arkaik-bootstrap-skill",
```

Run: `npm run test:docs-visibility && npx eslint lib/utils/docs-visibility.ts`
Expected: `All docs-visibility tests passed`; no eslint output.

- [ ] **Step 4: The route in the architecture map**

In `docs/architecture.md`, replace

```
  api/
    graph/              # Hosted projects: CRUD + the validated `mutations` write path
```

with

```
  api/
    arkademy/           # GET the Arkademy library: public, cached (spec/services.md § Arkademy)
    graph/              # Hosted projects: CRUD + the validated `mutations` write path
```

- [ ] **Step 5: The contract in the services spec**

In `docs/spec/services.md`, insert the section below directly above the line `## Tier Enforcement Points` (after the Pollen Feed section), keeping the blank line that ends it:

````markdown
## Arkademy

The Arkademy's library — its tools, example companies, entities and uses — is
one versioned JSON document in Postgres, uploaded by hand with
`npm run arkademy -- publish` from a folder git ignores. The shape is
`lib/arkademy/schema.ts` (zod, strict: an unknown key is an error), checked
with `validateArkademyDocument` (`lib/arkademy/validate.ts`); the operator
guide is `docs/arkademy.md`.

### Storage

```sql
arkademy_documents (
  version        int  primary key check (version > 0),
  format_version int  not null,
  document       jsonb not null,
  sha256         text not null,            -- of the canonical JSON text uploaded
  size_bytes     int  not null,
  note           text,
  restored_from  int  references arkademy_documents (version),
  uploaded_at    timestamptz not null default now()
)
```

Append-only (migration 013): the current document is the highest `version`;
a publish and a rollback each insert a row, and every version is kept.

### Protocol

`GET /api/arkademy` — public, no parameters, not rate-limited.

| Lookup | Status | Body | `Cache-Control` |
|---|---|---|---|
| ready | 200 | `{ "version", "uploaded_at", "format_version", "document" }` | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| ready, `If-None-Match` matches | 304 | none | same |
| empty table | 404 | `{ "error": "no_document", "message" }` | `public, max-age=60, s-maxage=60` |
| no `DATABASE_URL` | 503 | `services_unavailable` | `no-store` |
| newest row fails this build's schema | 500 | `{ "error": "document_invalid", "message" }` | `no-store` |
| Postgres failed | 500 | `{ "error": "internal_error", "message" }` | `no-store` |

- Every 200 and 304 carries `ETag: W/"arkademy.<version>"`; `If-None-Match` is
  compared weakly (`ifNoneMatchSatisfied`, as for the hosted reads).
- The body's `document` is the validated document — upgraded to the current
  format when the row is older — not the stored bytes. Response keys are
  snake_case; the document keeps its own camelCase.
- **One loader, two readers.** `getArkademy` (`lib/services/arkademy.ts`) is the
  contract: the Arkademy pages call it in-process and the route wraps it. In
  production it reads through Next's data cache (`unstable_cache`, key
  `arkademy-current`, tag `arkademy`, 300 s), so one refill per five minutes
  reaches the database whatever the traffic — which is why there is no rate
  limiter, whose Postgres write per request would cost exactly what the cache
  saves. A thrown error is never cached. In development it reads Postgres
  directly. Nothing calls `revalidateTag`: a publish is live within five
  minutes.

````

Run: `git diff --stat`
Expected: `docs/architecture.md | 1 +`, `docs/spec/services.md | 55 +++…`, `lib/utils/docs-visibility.ts | 4 ++++`, plus the new `docs/arkademy.md` as untracked.

- [ ] **Step 6: Commit**

```bash
git add docs/arkademy.md docs/architecture.md docs/spec/services.md lib/utils/docs-visibility.ts
git commit -m "docs(arkademy): the operator guide, the route's contract and the table"
```

---

### Task 8: The whole part, as CI sees it

No new files. Run everything with the scratch cluster still up and `DATABASE_URL` set to it, then stop it.

- [ ] **Step 1: The build job's gates**

```bash
actionlint
npm run lint
npx tsc --noEmit
env -u DATABASE_URL npm run build
npm run generate && git status --porcelain
npm run test:arkademy-schema
npm run test:docs-visibility
npm run test:fixtures
```

Expected: `actionlint` silent; lint `✖ 3 problems (0 errors, 3 warnings)` — the three `@next/next/no-img-element` warnings in `components/panels/PlatformVariants.tsx` and `components/panels/ShotPreviewDialog.tsx` that `main` already has; `tsc` silent; the build succeeds and its route list contains `├ ƒ /api/arkademy` (dynamic — the build never touches the database); `generate` exits 0 and `git status --porcelain` prints nothing; `All arkademy-schema tests passed.` (184); `All docs-visibility tests passed`; `All 14 fixture tests passed.`

- [ ] **Step 2: The services job's gates**

```bash
npm run db:migrate && npm run db:migrate
npm run test:arkademy-api
npm run test:publik
```

Expected: the second migrate is `up to date`; `All arkademy-api integration tests passed.` (53); `All publik-api integration tests passed.` (the shared `db.ts` and `etag.ts` are unchanged).

- [ ] **Step 3 (optional, recommended): the route in a production server**

This is the only check of the real `unstable_cache` and of the headers Next sends. With the build from Step 1 and a free port (5548 here):

```bash
rm -rf .next/cache/fetch-cache
npm run --silent arkademy -- publish tests/fixtures/arkademy/document.json
(npx next start -p 5548 > "$PGSCRATCH.next.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:5548/api/arkademy && break; sleep 1; done
curl -sI http://localhost:5548/api/arkademy | grep -iE '^HTTP|^etag|^cache-control'
curl -s -o /dev/null -w '%{http_code}\n' -H 'If-None-Match: W/"arkademy.1"' http://localhost:5548/api/arkademy
npm run --silent arkademy -- publish "$PGSCRATCH.changed.json"
curl -s http://localhost:5548/api/arkademy | head -c 14; echo
pkill -f "next start -p 5548"
psql -q "$DATABASE_URL" -c 'truncate arkademy_documents'
rm -rf .next/cache/fetch-cache
```

Expected: `HTTP/1.1 200 OK`, `cache-control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400`, `etag: W/"arkademy.1"`; then `304`; then `published v2 …`; then `{"version":1,"` — the data cache still serves v1, as designed. `lsof -nP -iTCP:5548 -sTCP:LISTEN` prints nothing afterwards.

- [ ] **Step 4: Stop the scratch Postgres**

```bash
pg_ctl -D "$PGSCRATCH/data" stop
lsof -nP -iTCP:5547 -sTCP:LISTEN
```

Expected: `server stopped`; `lsof` prints nothing.

## Part done when

On `feat/arkademy-content`, alone, each of these passes:

```bash
actionlint                                   # no output
npm run lint                                 # 0 errors (main's 3 warnings stay)
npx tsc --noEmit                             # no output
npm run build                                # succeeds; ƒ /api/arkademy
npm run generate && git status --porcelain   # prints nothing
npm run test:arkademy-schema                 # 184 PASS, exit 0
npm run test:docs-visibility                 # passes
DATABASE_URL=… npm run test:arkademy-api     # 53 PASS, exit 0 (local Postgres, migrated)
```

`git diff --stat faa0411..HEAD` lists exactly 21 files: `.github/workflows/ci.yml`, `.gitignore`, `app/api/arkademy/route.ts`, `db/migrations/013_arkademy_documents.sql`, `docs/architecture.md`, `docs/arkademy.md`, `docs/spec/services.md`, `lib/arkademy/index-document.ts`, `lib/arkademy/schema.ts`, `lib/arkademy/validate.ts`, `lib/services/arkademy.ts`, `lib/utils/docs-visibility.ts`, `package-lock.json`, `package.json`, `scripts/arkademy/load-arkademy-lib.js`, `scripts/arkademy/upload.js`, `tests/app/arkademy-schema.test.js`, `tests/app/load-arkademy.js`, `tests/fixtures/arkademy/document.json`, `tests/services/arkademy-api.test.js`, `tests/services/load-arkademy-api.js`. `git log --oneline faa0411..HEAD` shows the seven commits of Tasks 1–7.

**PR:** open it as the bottom of the stack with `gh stack` (the `gh-stack` skill drives the commands).

- Title: `feat(arkademy): the library store — schema, table, loader, route and upload script (part 1/4)`
- Body: what the part adds (the document's schema and validation, the append-only table, the cached loader the pages will call, `GET /api/arkademy`, the upload script), that nothing visible changes, and that merging runs `migrate-prod`, which creates the table in production. **No `## Lab Note` section.**
- Label: `no-lab-note`.
- After opening, read the PR's comments: the Lab Note reminder must be satisfied by the label, and CI must be green on "Arkademy library tests" (build job) and "Arkademy read route + upload integration tests" (services job).

**After merge (the owner, not this plan):** confirm `migrate-prod` applied `013_arkademy_documents.sql`; publish the library from the main checkout with the production connection string and `--yes` (`docs/arkademy.md` § Production); `curl -s https://arkaik.app/api/arkademy | head -c 200` shows version 1; `curl -sI https://arkaik.app/api/arkademy` twice — a second answer from the CDN (an `age` or `x-vercel-cache: HIT` header) confirms `s-maxage` is honoured; if not, the data cache alone still protects the database.

---

## For the planners of parts 2–4

What these parts need to know that the spec does not say. Each was seen in this part's rehearsal.

- **The loader is the only way in.** Pages call `getArkademy()` from `lib/services/arkademy.ts` in-process, wrapped in React's `cache()` per request (the `/p/[id]` pattern, `app/p/[id]/page.tsx:44-53`). Never fetch `/api/arkademy` from a server component. `ArkademyLookup` has five statuses (`unconfigured`, `empty`, `invalid`, `error`, `ready`); `ArkademyMessage` must cover the first four.
- **Production caches every lookup, `empty` included.** A 404-style `empty` result is a cache entry for up to 300 s like a document is, so the first publish after a cached empty page also waits up to five minutes; so does every later publish. For visual checks use `npm run dev` (development reads Postgres on every request) or delete `.next/cache/fetch-cache` and restart `next start`.
- **`lib/arkademy/` modules import only `zod` and each other by relative path.** `tests/app/load-arkademy.js` and `scripts/arkademy/load-arkademy-lib.js` refuse an `@/` import by name, and that refusal is what lets parts 2–4 add modules there without touching any loader. React, hooks and server code live elsewhere. The test loader returns every module's exports merged into one object and throws if two modules export the same name — keep export names unique across the folder.
- **A new `@/` import in `lib/services/arkademy.ts` or `app/api/arkademy/route.ts`** needs a line in `REWRITES` in `tests/services/load-arkademy-api.js`, or `test:arkademy-api` fails at load.
- **A stale `.next/` breaks `tsc`.** `tsconfig.json` includes `.next/types/**/*.ts`; a build from another branch of the stack leaves validators that import pages which may not exist on the branch being checked (`TS2307 … route.js` / `page.js`). `rm -rf .next` before `npx tsc --noEmit` when switching parts.
- **The ETag ignores the format version.** It is `W/"arkademy.<version>"`, as the spec says. The PR that bumps `ARKADEMY_FORMAT_VERSION` should add the format to the tag, or a client holding the old tag gets 304s for a body whose shape changed.
- **The fixture, for the suites of parts 2 and 4** (`tests/fixtures/arkademy/document.json`, fictional, never the real library):
  - examples in order `crumb-and-co`, `tidewise`, `inkwell`; Crumb & Co is the one `simulation` with a company `note`;
  - Tidewise's two `ch` uses are stored out of `order` (`order` 1 then 0);
  - Crumb & Co `ka` has five uses (`order` 0–4);
  - Tidewise leaves `rev` open; every other (example, question) is answered;
  - `cost` is the only question with a `sentencePlural`, and Crumb & Co answers it twice; `rev`, `kp` and `cost` are the three templates without `{S}`; `kp` has an empty `hint`;
  - `word-of-mouth` is used by all three examples, `app-stores` (Tidewise, Inkwell) and `subscriptions` (Crumb & Co, Inkwell) by two, `pop-up-stalls` by none (the fixture's only warning);
  - Crumb & Co's `vp` wording contains commas (`bread, still warm, at the door before breakfast`), but it is that question's only answer, so it reads as itself; a test of the join rule's `; ` separator needs a second answer added in memory;
  - two use notes: Tidewise `kr` with `dateKind: "published"` (2026-03-02) and Inkwell `rev` with `dateKind: "accessed"` (2026-10-01).
- **Validation is clock-dependent in one place.** `validateArkademyDocument(input, { now })` takes an optional date for the future-note warning; a suite that asserts an exact warning list should pass a fixed `now`.
- **The upload script cleans up after itself.** `test:arkademy-schema` spawns `scripts/arkademy/upload.js check` with no database and asserts `scripts/arkademy/.build/` is gone afterwards; a suite that requires `upload.js` directly must call `load-arkademy-lib.js`'s `cleanup()` itself.
- **Lab Notes:** parts 2 and 3 carry the `no-lab-note` label too (spec § "Lab Notes"); part 4 carries the single note.
