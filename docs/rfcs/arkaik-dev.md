---
title: "RFC: arkaik dev (local viewer)"
navTitle: "RFC: arkaik dev"
order: 90
---

# RFC: `arkaik dev` — local viewer over the repo's bundle

> Status: **Open decision.** This RFC evaluates feasibility and trade-offs and makes a recommendation. It does **not** commit `arkaik dev` to a build.
> Source issue: milestone M3 (`docs/spec/toolchain.md` § `arkaik dev`; `docs/vision.md` § Roadmap Phase 3). The toolchain spec is explicit that `arkaik dev` is *"Not committed: requires the app's `/project/[id]` routing to become static-export compatible first; decided on its own merits in Phase 3"* (`toolchain.md:59`, `vision.md:290`).

## Summary

`arkaik dev` would be a Storybook-style local viewer: a developer runs it in a repo that has a `docs/arkaik/bundle.json`, and a browser opens the arkaik graph over that bundle — no account, no hosted app, no manual import. Its natural implementation is a **static export** of the existing app (`next build` with `output: 'export'`) served locally by the CLI.

The blocker the spec names is real but narrow: **`/project/[id]` cannot be statically exported today**. The deeper, less obvious blocker is **data ingestion** — the viewer must feed the graph from a repo file, but every graph route reads from browser `localStorage`. Neither blocker is fundamental; both are addressable with changes that are individually small and low-risk.

**Recommendation: DEFER the build past M3, but land the two cheap enabling refactors opportunistically.** The routing fixes (`generateStaticParams` + a client-side index redirect) are independently harmless and de-risk the decision; the data-ingestion provider is the real work and deserves its own issue when `arkaik dev` is prioritized. `arkaik open` (#223) already covers the "see it in the app" need in the interim (validate → pack → hand off to arkaik.app import), which lowers the urgency.

## Why it isn't buildable today

### 1. `/project/[id]` is not static-export compatible

- `app/project/[id]/page.tsx` (lines 1–10) is a **server component** that `await`s `params` and calls `redirect(`/project/${id}/canvas`)`. `redirect()` is a runtime/dynamic feature that a fully static export cannot execute.
- The `[id]` dynamic segment has **no `generateStaticParams`**, so the exporter cannot enumerate which `[id]` pages to emit and the export build errors. (`app/docs/[...slug]/page.tsx:10-18` is the in-repo precedent for the fix — it declares `generateStaticParams` over a build-time-known set — but doc slugs are knowable from the filesystem at build time, whereas project ids are only known at runtime from `localStorage`.)
- The four leaf routes (`layout`, `canvas`, `library`, `changelog` under `app/project/[id]/`) are all `'use client'` and use only client hooks (`useParams`, `usePathname`, `useSearchParams`, xyflow, ELK). At the component level they are export-compatible; the blocker is param enumeration + where their data comes from, not the components themselves.

### 2. Data ingestion is the deeper gap

Every graph route reads through client hooks (`useProject`/`useNodes`/`useEdges`/`useJournal`) that import the module-level `localStorage` singleton `lib/data/local-provider.ts` directly (key `arkaik:store`). A statically-exported page would render, but there is **no path for a repo bundle** (`docs/arkaik/bundle.json`) to reach it — the only ingestion today is `importProject`, which *writes into* `localStorage` rather than serving a read-only repo bundle. So even after the routing is fixed, the viewer has nothing to show until a repo-backed data source exists.

### 3. The app has runtime `cwd`/filesystem dependencies that cannot ship in a static export

`lib/utils/docs.ts` (`import 'server-only'`, `process.cwd()` + `fs.readFile` at runtime) and `app/llms-full.txt/route.ts` (reads `docs/` and `public/schema` from `process.cwd()` at request time) are server-only, filesystem-backed surfaces. A single Next app cannot be **both** the cwd-reading SSR docs/marketing site **and** a fully static export. `next.config.ts` sets no `output` today, so the app builds as the default hybrid target.

## Options

### A. Routing — where does `generateStaticParams` get its id set?

1. **Single fixed id** (e.g. `dev`): the viewer serves exactly one project (the repo's `docs/arkaik/bundle.json`). Simplest; matches the one-bundle-per-repo reality of Kommit. *Recommended.*
2. **Ids read from the repo bundle(s) at build**: supports multiple bundles in a repo, at the cost of a build-time bundle scan.
3. **Catch-all client-routed shell**: a single exported shell that resolves `[id]` purely client-side. Avoids `generateStaticParams` but changes the routing model.

The server `redirect()` in `app/project/[id]/page.tsx` is replaced by a **client-side redirect** (or a static index page) so the index route needs no server runtime. This change is also harmless in the current hosted app.

### B. Data ingestion — how does a repo bundle reach the client pages?

1. **A read-only repo/bundle `DataProvider` selected by a build flag**: implement the `DataProvider` interface (`lib/data/data-provider.ts`) against a bundle injected at build/hydration time instead of `localStorage`. Cleanest fit — the interface already exists precisely so the backend can change without touching hooks/UI (`docs/data-layer.md:199-204`, `docs/architecture.md:164`). The one obstacle is that the hooks import the `localProvider` singleton *directly*; a small **provider-injection seam** (a `getProvider()` or React context) is needed so the viewer build can swap it. (Note: the IndexedDB migration, #217, contemplates the same seam — the two share this refactor.)
2. **Seed `localStorage` from the bundle before hydration**: a bootstrap script writes the repo bundle into `arkaik:store` on first load. Least invasive, but conflates "view this repo" with the user's local sandbox and muddies read-only semantics.
3. **Provider injection via context**: same as (1) but threaded through React context rather than a module swap.

(1) with the injection seam is recommended and composes with #217.

### C. Build strategy — one app can't be both SSR-with-cwd-reads and static export

1. **A separate export target / second build** that includes only the viewer routes (`/project/[id]/*`) and excludes the cwd-reading docs/LLM routes. *Recommended* — keeps the hosted app untouched.
2. **Route-subset export**: mark the cwd-reading routes `force-static` (executed once at build) or exclude them, and export the whole app. Riskier — every route must simultaneously satisfy export constraints.
3. **A different bundler for the viewer** (e.g. Vite over the graph components): most isolation, most duplication.

### D. Scope — viewer or editor?

The canvas/library pages **mutate** data (create/update/delete nodes/edges, raw-JSON edit). A static repo viewer should be **read-only** in v1 (or write back to disk via a separate, explicit mechanism). Recommendation: ship read-only first; a repo-write-back editor is a distinct, larger decision (it overlaps the CLI's ownership of the on-disk bundle/journal).

## Recommendation

**Defer the `arkaik dev` build to a post-M3 phase, on its own merits, with a phased path:**

1. **Now / cheap, independently valuable (can land anytime):**
   - Add `generateStaticParams` to `/project/[id]` (fixed `dev` id) and replace the server `redirect()` in `app/project/[id]/page.tsx` with a client-side redirect / static index. Harmless to the hosted app; removes blocker #1.
2. **When `arkaik dev` is prioritized (its own issue):**
   - Introduce the provider-injection seam and a **read-only repo-bundle `DataProvider`** (shared with the #217 IndexedDB work). This is the substantive work (blocker #2).
   - Add a **separate static-export build target** for the viewer routes that excludes `lib/utils/docs.ts` / `app/llms-full.txt` (blocker #3), and an `arkaik dev` CLI command that runs that build (or a prebuilt viewer) and serves it locally over the repo's bundle.
3. **Explicitly out of scope for v1:** editing / write-back from the viewer.

**Why defer rather than proceed now:** the substantive piece (the repo-bundle provider + injection seam) is entangled with the IndexedDB migration (#217) and is best done once, after that lands, rather than twice. And `arkaik open` (#223) already gives Kommit users a working "see it in the app" path today, so `arkaik dev` is a convenience, not a blocker for the milestone. **Why not drop it:** the enabling refactors are small and the feature is a natural fit for the Kommit persona — keeping the door open (via step 1) costs almost nothing.

## References

- `docs/spec/toolchain.md:59` (`arkaik dev` row), `:18` (app-stays-at-root / cwd reads)
- `docs/vision.md:290` (Roadmap Phase 3 — decided on its own merits)
- `app/project/[id]/page.tsx`, `app/project/[id]/{layout,canvas,library,changelog}/page.tsx`
- `app/docs/[...slug]/page.tsx:10-18` (the `generateStaticParams` precedent)
- `lib/data/local-provider.ts`, `lib/data/data-provider.ts`, `lib/hooks/use{Project,Nodes,Edges,Journal}.ts`
- `lib/utils/docs.ts`, `app/llms-full.txt/route.ts`, `next.config.ts`
- Related: IndexedDB (Dexie) migration (#217) — shares the provider-injection seam
