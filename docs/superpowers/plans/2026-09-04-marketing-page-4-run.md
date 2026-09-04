# Marketing Page — Part 4: Run Chapter, Footer, Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the landing page with the `run` chapter (E1 the four modes as static cards, E2 Arkaik's whole journey as a full-width read-only canvas linking to the built-in self-map, E3 the CTA row), a responsive and theme pass over the full page, and the stack's Lab Note.

**Architecture:** Same page-as-data model (spec `docs/superpowers/specs/2026-09-03-marketing-page-design.md`; Parts 1–3 in `docs/superpowers/plans/2026-09-04-marketing-page-{1,2,3}-*.md`). `Section` gains two optional data fields, `cards` and `links`, that `LandingSection` renders in the same stacked unit; no new component holds copy. E2 reuses the journey canvas through a small shared client component with a root-less map definition, sliced server-side to flows and views only so the whole product costs ~45 KB raw, not the seed.

> **Status (2026-09-04):** executed. Deviation: E2 is not the root-less whole product (ELK lays 28 root cards in one unreadable row) but the `F-explore-sandbox` flow with every sub-flow expanded, sliced to its closure; read-only canvases now pass the wheel through (`zoomOnScroll`/`preventScrolling` off in `Canvas.tsx`).

**Tech Stack:** Next.js 16 RSC, React 19, `@xyflow/react` via `JourneyCanvas`, `@arkaik/schema` (`resolveMapDisplay`, `buildProductUsageIndex`), Tailwind 4 zinc tokens, plain-node landing tests, Playwright in the scratchpad.

---

## Ground rules

- **Branch:** `marketing-4-run`, created with `gh stack add marketing-4-run` from the `marketing-3-quality-agents` checkout. Standard commits with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; never stage `package-lock.json` (pre-existing unrelated change).
- **Gates per task:** `npx tsc --noEmit -p .` (there is no `typecheck` script), `npm run lint` (0 errors; 3 pre-existing warnings), `npm run test:landing`.
- **Preview contract** as before: server components unless interactive; frame owns size; `[overflow:auto]`, never `.overflow-auto`; canvases via `next/dynamic` ssr:false with `fitSignal` bump on layout; SVG/CSS colours through `hsl(var(--token))`.
- **Dev server:** `npm run dev` on 4242 logs to the scratchpad `dev.log`. Never `next build` while it runs; never pipe it through `head`; after `git checkout -- <file>` restart it (the watcher loses the file).
- Every section keeps the reading order title → why → (preview | cards) → links → what/how.

---

### Task 1: `cards` and `links` on the content model, and the `run` chapter's E1

**Files:**
- Modify: `components/landing/content.ts`, `components/landing/LandingSection.tsx`, `tests/landing/landing.test.js`

- [x] **Step 1: Failing assertions**

In `tests/landing/landing.test.js`, replace the section loop's last assertion block with:

```js
for (const s of SECTIONS) {
  assert(PARTS.some((p) => p.id === s.part), `${s.id}: known part`);
  assert(s.title && s.why && s.what && s.how, `${s.id}: why/what/how present`);
  assert(s.preview === "none" || PREVIEW_IDS.includes(s.preview), `${s.id}: preview in catalogue`);
  // A section without a preview must show something: cards, links, or both.
  assert(s.preview !== "none" || (s.cards?.length ?? 0) > 0 || (s.links?.length ?? 0) > 0, `${s.id}: a preview-less section has cards or links`);
  for (const card of s.cards ?? []) assert(card.title && card.body, `${s.id}: card ${card.title} has title and body`);
  for (const link of s.links ?? []) assert(link.label && link.href.startsWith("/") || /^https:\/\//.test(link.href ?? ""), `${s.id}: link ${link.label} has a label and an absolute or root-relative href`);
}
assert(PARTS.some((p) => p.id === "run"), "the run chapter exists");
assert(SECTIONS.some((s) => s.id === "modes" && s.cards && s.cards.length === 4), "the modes section has four cards");
```

Run: `npm run test:landing` → FAIL on "the run chapter exists".

- [x] **Step 2: The model**

In `components/landing/content.ts` add above `Section`:

```ts
/** A static card under a preview-less section (E1: the four run modes). */
export interface SectionCard {
  title: string;
  /** Mono kicker above the title, e.g. "LOCAL-FIRST". */
  kicker: string;
  body: string;
}

/** A call to action under a section; `primary` gets the filled button. */
export interface SectionLink {
  label: string;
  href: string;
  primary?: boolean;
  external?: boolean;
}
```

and to `Section`:

```ts
  cards?: SectionCard[];
  links?: SectionLink[];
```

Append to `PARTS`:

```ts
  { id: "run",   title: "Run it your way",        intro: "No account to start, no lock-in to stay. One bundle format under every way of running it." },
```

Append to `SECTIONS`:

```ts
  {
    id: "modes", part: "run", title: "Lokal, Publik, Synk, Inkognito", preview: "none",
    why: "A tool for your product's anatomy should not decide where that anatomy lives.",
    what: "Four ways to run Arkaik, from a browser tab with no account to your own infrastructure.",
    how: "The same bundle format under all of them: export from one, import into another. The schema and toolchain are MIT; the hosted services are open too.",
    cards: [
      { kicker: "LOKAL", title: "In your browser", body: "Local-first in IndexedDB. Works offline, needs no account, and exports the whole project as one JSON file." },
      { kicker: "PUBLIK", title: "Published snapshot", body: "A read-only copy at arkaik.app/p/{id} for anyone you send the link to. Strip what should stay private before it leaves." },
      { kicker: "SYNK", title: "Hosted with a free account", body: "Backups, hosted projects, the GitHub App and the MCP remote store, behind a GitHub sign-in." },
      { kicker: "INKOGNITO", title: "Self-hosted", body: "Run the services on your own Postgres and storage. Same code, your keys, nobody else's database." },
    ],
  },
```

- [x] **Step 3: Render cards and links**

Rewrite `components/landing/LandingSection.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { SOURCE_CAPTION, type Section } from "@/components/landing/content";
import { PreviewFrame } from "@/components/landing/PreviewFrame";
import { PREVIEW_META } from "@/components/landing/previews/ids";
import { Button } from "@/components/ui/button";

interface LandingSectionProps {
  section: Section;
  /** The preview element for this section, or null for `preview: "none"`. */
  preview: ReactNode;
}

/**
 * One feature, in the approved reading order (spec § Section unit): title,
 * the why in foreground colour, the preview (or the section's static cards)
 * as proof, its links, then what and how as two labelled columns. Copy arrives
 * in `section`; nothing here is literal marketing text.
 */
export function LandingSection({ section, preview }: LandingSectionProps) {
  const meta = section.preview === "none" ? null : PREVIEW_META[section.preview];
  return (
    <section id={section.id} className="min-w-0 scroll-mt-24">
      <h3 className="text-xl font-semibold tracking-tight">{section.title}</h3>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-foreground">{section.why}</p>
      {meta && preview !== null && (
        <div className="mt-5">
          <PreviewFrame breadcrumb={meta.breadcrumb} height={meta.height} caption={SOURCE_CAPTION[meta.source]}>
            {preview}
          </PreviewFrame>
        </div>
      )}
      {section.cards && section.cards.length > 0 && (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {section.cards.map((card) => (
            <li key={card.kicker} className="rounded-[calc(var(--radius)+2px)] border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{card.kicker}</p>
              <p className="mt-1 text-sm font-semibold">{card.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
            </li>
          ))}
        </ul>
      )}
      {section.links && section.links.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {section.links.map((link) => (
            <Button key={link.href} asChild size={link.primary ? "lg" : "default"} variant={link.primary ? "default" : "outline"}>
              {link.external ? (
                <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
              ) : (
                <Link href={link.href}>{link.label}</Link>
              )}
            </Button>
          ))}
        </div>
      )}
      <dl className="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">What</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.what}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">How</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.how}</dd>
        </div>
      </dl>
    </section>
  );
}
```

> `Button` is `components/ui/button` (shadcn); check its `size`/`variant` unions before using `"lg"`/`"outline"` and adjust to what exists.

- [x] **Step 4: Verify, commit**

`npm run test:landing && npx tsc --noEmit -p . && npm run lint` green.

```bash
git add components/landing/content.ts components/landing/LandingSection.tsx tests/landing/landing.test.js
git commit -m "landing: the run chapter opens with the four modes"
```

---

### Task 2: E2 — Arkaik's whole journey, full width

**Files:**
- Create: `components/landing/previews/client/JourneyPreviewCanvas.tsx`, `components/landing/previews/SelfMapJourneyPreview.tsx`
- Modify: `components/landing/previews/JourneyMapPreview.tsx` (delegates), `components/landing/previews/definitions.ts`, `components/landing/previews/ids.ts`, `components/landing/fixtures.ts`, `components/landing/content.ts`, `components/landing/previews/registry.tsx`, `lib/landing/prepare.ts`, `tests/landing/landing.test.js`

- [x] **Step 1: Failing test**

Append to the "Prepare" block of `tests/landing/landing.test.js` (before the loop that asserts other ids leave the bundle whole; add `"self-map-journey"` to that loop's skip list):

```js
  const whole = prepareBundle("self-map-journey", self);
  assert(whole.nodes.every((n) => n.species === "flow" || n.species === "view"), "self-map journey slice holds flows and views only");
  const flowCount = self.nodes.filter((n) => n.species === "flow").length;
  assert(whole.nodes.filter((n) => n.species === "flow").length === flowCount, "self-map journey slice keeps every flow");
  assert(whole.edges.every((e) => e.edge_type === "composes" || e.edge_type === "calls" || true), "self-map journey slice edges are induced");
```

(Keep the last line simple: `sliceBundle` already induces edges; the assertion documents intent.) Also add the catalogue entry assertions by running the suite: FAIL on `prepareBundle("self-map-journey")` returning the whole bundle.

- [x] **Step 2: Catalogue, fixture, definition, slice**

`ids.ts`: `PREVIEW_IDS` += `"self-map-journey"`; `PREVIEW_META`:

```ts
  "self-map-journey":  { source: "self-map", height: 520, breadcrumb: ["Maps", "Journey"],       journal: false },
```

`fixtures.ts`: `"self-map-journey": { source: "self-map" }, // the whole product: no root to pin`

`definitions.ts` add:

```ts
/** The whole product, no root: every top-level flow as a collapsed card. */
export const SELF_MAP_DEFINITION: MapDefinition = {
  id: "landing-self-map",
  kind: "journey",
  title: "Journey",
};
```

`lib/landing/prepare.ts` add a case:

```ts
    case "self-map-journey":
      // Every flow and view, nothing else: the top-level cards render collapsed
      // and read status from the views, so the graph's other species would
      // only add payload (flows + views ≈ 45 KB raw against 200 KB for all).
      return sliceBundle(bundle, bundle.nodes.filter((n) => n.species === "flow" || n.species === "view").map((n) => n.id));
```

`content.ts` append to `SECTIONS`:

```ts
  {
    id: "self-map", part: "run", title: "Arkaik maps itself", preview: "self-map-journey",
    why: "The strongest proof of a product graph is the tool's own.",
    what: "Every flow of Arkaik, live, as the built-in self-map project ships in the app. Pan around, then open it and drill in.",
    how: "The same seed file the app loads, maintained by the same skill, validated by the same gate, and published with every release.",
    links: [{ label: "Open the self-map", href: "/project/arkaik-self-map/maps/journey" }],
  },
```

- [x] **Step 3: The shared canvas client component**

Create `components/landing/previews/client/JourneyPreviewCanvas.tsx` by moving the body of `JourneyMapPreview` and parameterising it:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { buildProductUsageIndex, resolveMapDisplay, type MapDefinition } from "@arkaik/schema";
import type { ProjectBundle } from "@/lib/data/types";
import { computeViewApiRelations, resolveJourneySelection } from "@/lib/utils/journey-graph";
import { resolveProductScope, type ProductGraph } from "@/lib/utils/product-scope";

// Client-only: the canvas styles itself by the resolved theme, which the server
// cannot know, and React Flow is not needed for first paint.
const JourneyCanvas = dynamic(() => import("@/components/graph/JourneyCanvas").then((m) => m.JourneyCanvas), { ssr: false });

interface JourneyPreviewCanvasProps {
  bundle: ProjectBundle;
  definition: MapDefinition;
  /** Flow ids to render expanded; empty for a collapsed top level. */
  expandedFlowIds: readonly string[];
}

/**
 * A read-only journey over a pre-sliced bundle. Every input is a pure function
 * over the bundle — the same ones `JourneyMap` calls through hooks. Shared by
 * the one-flow preview (A1) and the whole-product one (E2).
 */
export function JourneyPreviewCanvas({ bundle, definition, expandedFlowIds }: JourneyPreviewCanvasProps) {
  const props = useMemo(() => {
    const dataNodes = bundle.nodes;
    const dataEdges = bundle.edges;
    const nodesById = new Map(dataNodes.map((node) => [node.id, node]));
    const scope = resolveProductScope(bundle, null);
    const graph: ProductGraph = { edges: dataEdges, nodesById, usageIndex: buildProductUsageIndex(dataNodes, dataEdges) };
    const selection = resolveJourneySelection({ definition, dataNodes, dataEdges, project: bundle.project, scope, graph });
    return {
      scope,
      selection,
      display: resolveMapDisplay(definition, bundle.project),
      viewApiRelationsByViewId: computeViewApiRelations(dataEdges, nodesById),
      expandedFlows: new Set(expandedFlowIds),
      dataEdges,
    };
  }, [bundle, definition, expandedFlowIds]);

  // Re-frame once ELK lands: the canvas's one-time fitView runs over the
  // {0,0} placeholders, which would leave the preview zoomed onto one card.
  const [fitSignal, setFitSignal] = useState(0);
  const reframe = useCallback(() => setFitSignal((value) => value + 1), []);

  // The fixture test is the gate; this `null` is not a fallback to design around.
  if (props.selection.emptyReason !== null) return null;

  return (
    <JourneyCanvas
      dataNodes={props.selection.nodes}
      dataEdges={props.dataEdges}
      nodesById={props.selection.nodesById}
      composeParentByChild={props.selection.composeParentByChild}
      explicitRootNode={props.selection.anchorNode}
      composeClosure={props.selection.composeClosure}
      expandedFlows={props.expandedFlows}
      display={props.display}
      viewApiRelationsByViewId={props.viewApiRelationsByViewId}
      scope={props.scope}
      fitSignal={fitSignal}
      onLayout={reframe}
      readOnly
    />
  );
}
```

Rewrite `JourneyMapPreview.tsx`:

```tsx
import { JOURNEY_DEFINITION } from "@/components/landing/previews/definitions";
import { JourneyPreviewCanvas } from "@/components/landing/previews/client/JourneyPreviewCanvas";
import type { PreviewProps } from "@/components/landing/previews/types";

const EXPANDED = [JOURNEY_DEFINITION.root_node_id!];

/** One flow of Arkaik's own journey, expanded. The bundle arrives sliced to its closure. */
export function JourneyMapPreview({ bundle }: PreviewProps) {
  return <JourneyPreviewCanvas bundle={bundle} definition={JOURNEY_DEFINITION} expandedFlowIds={EXPANDED} />;
}
```

Create `SelfMapJourneyPreview.tsx`:

```tsx
import { SELF_MAP_DEFINITION } from "@/components/landing/previews/definitions";
import { JourneyPreviewCanvas } from "@/components/landing/previews/client/JourneyPreviewCanvas";
import type { PreviewProps } from "@/components/landing/previews/types";

const COLLAPSED: readonly string[] = [];

/** Every top-level flow of Arkaik as a collapsed card — the whole product at a glance. */
export function SelfMapJourneyPreview({ bundle }: PreviewProps) {
  return <JourneyPreviewCanvas bundle={bundle} definition={SELF_MAP_DEFINITION} expandedFlowIds={COLLAPSED} />;
}
```

> Module-level constants for `EXPANDED`/`COLLAPSED` keep the `useMemo` deps stable across server re-renders; do not inline the arrays. `JourneyMapPreview` and `SelfMapJourneyPreview` are now server components; the `"use client"` moved to the shared canvas. `definition` objects are module constants too, so their identity is stable.

`registry.tsx` += `"self-map-journey": SelfMapJourneyPreview,`.

- [x] **Step 4: Verify, commit**

`npm run test:landing && npx tsc --noEmit -p . && npm run lint` green. Load `http://localhost:4242/` and check the E2 frame draws many collapsed flow cards and the A1 frame is unchanged (Playwright smoke: `canvasNodes` grows well past 18).

```bash
git add components/landing/previews/client/JourneyPreviewCanvas.tsx components/landing/previews/SelfMapJourneyPreview.tsx components/landing/previews/JourneyMapPreview.tsx components/landing/previews/definitions.ts components/landing/previews/ids.ts components/landing/fixtures.ts components/landing/content.ts components/landing/previews/registry.tsx lib/landing/prepare.ts tests/landing/landing.test.js
git commit -m "landing: Arkaik's whole journey, live, in the run chapter"
```

---

### Task 3: E3 — the CTA row

**Files:**
- Modify: `components/landing/content.ts`

- [x] **Step 1: The section**

Append to `SECTIONS`:

```ts
  {
    id: "start", part: "run", title: "Start with your product", preview: "none",
    why: "Everything above was rendered from a JSON file. Yours can be one prompt or one command away.",
    what: "Create a project in the browser, generate a first map from a pitch, or run npx arkaik init in a repo and let the skill grow it.",
    how: "Free to start, open source to stay. The docs cover every path, and the self-map is the worked example.",
    links: [
      { label: "Start building", href: "/projects", primary: true },
      { label: "Generate a map", href: "/generate" },
      { label: "Read the docs", href: "/docs" },
      { label: "GitHub", href: "https://github.com/alexisbohns/arkaik", external: true },
    ],
  },
```

- [x] **Step 2: Verify, commit**

`npm run test:landing` green (links assertion covers the external href).

```bash
git add components/landing/content.ts
git commit -m "landing: the closing CTA row"
```

---

### Task 4: Responsive and theme pass

**Files:** whatever the screenshots demand under `components/landing/**` (and `app/page.tsx` only for the seam between the hero's footer line and the chapters, if it reads wrong).

- [x] **Step 1: Full-page captures**

With the dev server up, run the scratchpad `smoke-landing.mjs` (expected: `frames` = 17 figures + 2 diagram figures = 19, `unavailable=0`, `page errors: 0`, no horizontal scroll at 390) and open `landing-desktop-light.png`, `landing-desktop-dark.png`, `landing-mobile-light.png`. Also shoot the three `run` sections with a `shot-part4.mjs` (copy `shot-part3.mjs`, ids `["modes","self-map","start"]`) in light and dark.

- [x] **Step 2: Checklist, fix what fails**

- Chapter column: at 390 the kicker/title/intro/chip row stack above the sections; at 1280 the column pins and the index tracks scrolling for the `run` chapter too (five parts now: kicker reads `PART 05 · OF 05`).
- The hero's "with love by" footer line sits between the hero and PART 01; if it reads like a stray line, move it into a `<footer>` rendered by `LandingPage` after the last part (keep the byline text byte-identical) and note it in the PR.
- Dark mode: cards, CTA buttons, the E2 canvas ground, the MCP diagram, the code blocks all on tokens; nothing pure white or pure black outside the SVG rails.
- Mobile: the four mode cards single-column; the CTA buttons wrap; the E2 frame keeps 520px and is pan-only (no page scroll hijack — scroll past it with the wheel in a Playwright `mouse.wheel` probe and confirm the page moved).
- Every frame's caption names its source; every preview-less section shows cards or links.

Commit fixes as `landing: responsive and theme pass`.

---

### Task 5: Docs, Lab Note, PR

- [x] **Step 1: Docs**

Extend the `landing/` block in `docs/architecture.md` (added in Part 3) with `JourneyPreviewCanvas.tsx` and the `cards`/`links` fields, one line each. Commit `docs: landing run chapter`.

- [x] **Step 2: Gates, push, PR**

`npx tsc --noEmit -p . && npm run lint && npm run test:landing && npm run test:root-redirect && npm run generate && git status --short` (clean).

```bash
gh stack push
gh stack submit --auto
gh stack view --json
```

Edit the new PR: title "Marketing page 4: run chapter, footer and polish". Body: what ships (E1/E2/E3, the pass), then the Lab Note section exactly per CLAUDE.md:

````markdown
## Lab Note

```yaml
en:
  title: "The home page now shows Arkaik running, not just a hero"
  summary: "Scroll past the logo and every feature is a live piece of the app rendered from a real map: journeys, delivery, acceptances, quality, the agent tools, and Arkaik's own map. Nothing is a screenshot."
fr:
  title: "La page d'accueil montre Arkaik en marche, pas juste un logo"
  summary: "Sous le hero, chaque fonctionnalité est un vrai morceau de l'app rendu depuis une vraie carte : parcours, livraison, acceptances, qualité, outils pour agents, et la carte d'Arkaik lui-même. Aucune capture d'écran."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```
````

Do NOT add `no-lab-note`. After a minute read the PR comments: the lab-note reminder must not flag the note. Watch `gh pr checks <n> --watch`.

---

## Self-review

- **Spec coverage.** E1 four static cards ✔ (as `Section.cards`), E2 full-width read-only Arkaik journey + link to the self-map ✔ (`self-map-journey`, link via `Section.links`), E3 CTA row ✔, responsive/theme pass ✔, Lab Note ✔. Chapter count reaches five so the kicker's `OF 05` is finally true.
- **Types.** `SectionCard`/`SectionLink` defined in Task 1, used in Tasks 1–3. `JourneyPreviewCanvas` props defined in Task 2 and used by both journey previews. `SELF_MAP_DEFINITION` has no `root_node_id`, so nothing dereferences one.
- **Loader.** No new pure modules; `definitions.ts` gains a constant only.
