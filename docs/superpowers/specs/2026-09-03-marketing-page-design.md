# Marketing page: live feature sections below the hero

**Date:** 2026-09-03 · **Status:** approved (design + visual), pending spec review

## Problem

`app/page.tsx` is a hero and nothing else. A visitor learns the name and the
tagline and has to open the app to find out what Arkaik does. A conventional
fix (screenshots under headings) rots within days in a product that ships
weekly. The page must present the main features with **actual bits of
interface**, each with a short rationale, and stay true without anyone
re-capturing anything.

## Settled decisions

1. **The hero is untouched.** Everything in this spec is appended below it.
   The signed-in redirect stays as it is.
2. **Previews are components, never images.** Every preview renders a real
   or tailored React component over real data. A schema change that breaks a
   preview breaks the build, which is the maintenance model.
3. **The data is Arkaik's own map.** Previews read slices of
   `seed/arkaik-self-map.json` (231 nodes, 436 edges, 809 journal events).
   One exception: the self-map has no `quality` section, so the two Kritik
   previews read a small hand-authored quality fixture typed by
   `@arkaik/schema`'s quality types and parsed through it in a test.
4. **The page is data.** Order, grouping, copy, layout variant and preview
   choice for every section live in one typed array. Reordering the page is
   moving array entries.
5. **Hybrid previews, uniformly componentified.** Where the real page layout
   is the message, the preview wraps the real component. Where a composed
   slice reads better, a tailored preview composes the real leaf primitives.
   Both kinds obey the same contract (§ Preview contract). No preview
   contains copy, project hooks, or the data provider.
6. **Copy is separated from layout.** Section components receive text as
   props and never contain literal marketing text.

## Page structure

Five parts, in this order (the order is a data decision, not a code one):

| Part | Title | Sections |
|---|---|---|
| `maps` | Read your product | A1 Journey map · A2 System map · A3 Delivery board · A4 Overview |
| `truth` | Track truth, not fields | B1 Platform statuses · B2 Acceptances and parity · B3 Value pyramid · B4 Decisions · B5 Journal and changelog |
| `quality` | Keep it honest | C1 Quality matrix · C2 Findings and signals |
| `agents` | Maintained by agents | D1 The agent skill · D2 The MCP server · D3 Start from a prompt (the AI assistant) |
| `run` | Run it your way | E1 Lokal / Publik / Synk / Inkognito · E2 Arkaik maps itself · E3 Footer CTA |

Each section carries **why** (outcome and intention), **what** (the feature)
and **how** (how it works and how it is maintained), one or two sentences
each. The copy direction per section is in the appendix; the final wording
lives in `components/landing/content.ts`.

### Preview per section

| Section | Preview id | Kind | Renders |
|---|---|---|---|
| A1 | `journey-map` | real | `JourneyCanvas` (see § Refactors) scoped to one flow, four or five view cards, hover and drill-down only |
| A2 | `system-map` | real | `SystemCanvas` scoped around one data model, three tiers |
| A3 | `delivery-board` | real | `DeliveryBoard` with three status columns, six or seven `PlatformItemCard`s |
| A4 | `overview-cards` | real | `PlatformGaugesCard` and `ReleasePulseCard` side by side |
| B1 | `platform-statuses` | tailored | one view's platform chip row with the rollup `StatusBadge` above it, built from `PlatformList`, `StatusMark`, `StatusRing` |
| B2 | `acceptance-matrix` | real | `AcceptanceMatrix` for one flow, one row a parity gap |
| B3 | `value-pyramid` | tailored | one `PyramidTierGroup` with three `PyramidElementCard`s |
| B4 | `decision-chain` | tailored | two decision cards, one superseding the other, with an `impacts` link; built from the `DecisionLog` row primitives |
| B5 | `journal-changelog` | real | node timeline (`FeedRow`s) left, changelog excerpt between two real releases right |
| C1 | `quality-matrix` | real | `QualityGallery` of `SurfaceScoreCard`s with `LevelMeter`s |
| C2 | `findings-board` | real | `FindingsBoard` with two `FindingCard`s plus one `quality.signal.tripped` `FeedRow` |
| D1 | `agent-skill-diff` | tailored | a diff-styled block: a code change left, the node patch and journal event it produced right |
| D2 | `mcp-diagram` + `mcp-call` | tailored | an inline SVG diagram (§ D2 diagram) and a tool call with its real JSON response |
| D3 | `prompt-builder` | tailored | the use-case picker (`PromptBuilderForm`'s picker primitive) and a truncated generated prompt from `assemblePrompt` |
| E1 | `none` | — | four static cards |
| E2 | `journey-map` (full) | real | full-width read-only Arkaik journey, link to the public self-map |
| E3 | `none` | — | CTA row |

### D2 diagram

Inline, theme-aware SVG in its own component. Two figures:

1. **Audience symmetry.** One `@arkaik/schema` projection in the center,
   three consumers around it: the Delivery page, the CLI, the MCP tool. Each
   shows the same result.
2. **The write path.** Agent host → `arkaik-mcp` → store (repo bundle or
   hosted API) → validator → journal.

## Visual design

Decided with mockups (`.superpowers/brainstorm/89163-*/content/`, kept
locally). The page stays inside the app's existing language: zinc shadcn
tokens, Geist Sans and Geist Mono, the hero's Gochi Hand accent, the six
species colours from `components/graph/nodes/node-styles.ts`.

### Rhythm: chapters

Each part is a chapter. A two-column grid: the **chapter column** on the left
is `position: sticky` for the chapter's full height; the **section column**
on the right scrolls its sections. Column ratio about 1 : 1.7, max content
width 1200px, chapter gap large enough that one chapter never bleeds into the
next while its title is pinned.

The ASCII terrain background belongs to the hero and fades out at the hero's
bottom edge. Chapters sit on the plain `--background`.

### Chapter column

- Kicker in Geist Mono, uppercase, tracked: `PART 01 · OF 05`.
- Title in Gochi Hand, about 40px, the same accent the hero uses.
- One-line intro in Geist Sans, muted foreground, max 260px.
- A **section index**: one line per section, a short rule before each. The
  section currently in view is foreground-coloured with a longer rule. Driven
  by an `IntersectionObserver` on the section elements. Each line is an
  anchor link to its section.

### Section unit

Order inside each section, top to bottom: title (Geist Sans 600, about
20px), the **why** paragraph in foreground colour, the **preview** in its
frame, then **what** and **how** as two columns under it with mono uppercase
labels. Why is the only text above the preview: intention leads, the
interface proves it, the mechanism closes.

`layout` variants map onto this unit: `preview-full` spans the section
column; `text-only` skips the frame. `preview-left` and `preview-right` are
kept in the type for future sections but every section in this spec uses the
stacked unit.

### Preview frame: app chrome

`PreviewFrame` draws a slim title bar over the preview: two muted dots, a
breadcrumb naming the in-app path (`Arkaik › Project › Delivery`), and a
`LIVE` pill in foreground-on-background at the right. Body has the app's
`--radius` plus 2px, a border, and a soft shadow. The breadcrumb comes from
the section's content entry so the frame holds no text of its own.

Frames have fixed heights per preview id so the page does not shift while
canvases mount. Canvases fit their viewport on mount and are pan-only.

### Diagrams: the canvas's own vocabulary

The two MCP figures are drawn as Arkaik node cards (white card, radius 8,
species-coloured left rail, title plus muted subtitle) connected by curved
compose-style edges with small arrowheads, on the canvas dot grid. Colours:
agent host violet, `arkaik-mcp` teal, stores amber, validator green, journal
blue. Inline SVG, `currentColor` and CSS variables for theme.

### Theme, responsive, motion

- Dark mode through the existing tokens only. Frames, cards and the dot
  grid use `--card`, `--border`, `--muted-foreground`. No hard-coded greys
  outside the SVG's species rails.
- Below 900px the chapter column stops being sticky and becomes a header
  above its sections; the index becomes a horizontal chip row. Frames keep
  their aspect but scroll horizontally inside the frame, never the page.
- Motion is limited to the index highlight transition and the canvases'
  fit-view on mount. No scroll-driven animation, no parallax.

## Architecture

```
components/landing/
  content.ts              # PARTS and SECTIONS: all order, grouping, copy, layout, preview ids
  fixtures.ts             # node/edge/event id lists into the self-map, per preview
  quality-fixture.ts      # the hand-authored Kritik section for C1/C2
  LandingPage.tsx         # loops PARTS → sections; no text, no data logic
  LandingPart.tsx         # part heading + intro + its sections
  LandingSection.tsx      # why/what/how column + PreviewFrame, honours `layout`
  PreviewFrame.tsx        # fixed-height frame, "live" badge, overflow handling, theme ground
  previews/
    registry.ts           # Record<PreviewId, ComponentType<PreviewProps>>
    JourneyMapPreview.tsx
    SystemMapPreview.tsx
    DeliveryBoardPreview.tsx
    OverviewCardsPreview.tsx
    PlatformStatusesPreview.tsx
    AcceptanceMatrixPreview.tsx
    ValuePyramidPreview.tsx
    DecisionChainPreview.tsx
    JournalChangelogPreview.tsx
    QualityMatrixPreview.tsx
    FindingsBoardPreview.tsx
    AgentSkillDiffPreview.tsx
    McpDiagram.tsx
    McpCallPreview.tsx
    PromptBuilderPreview.tsx
lib/landing/
  slice.ts                # pure: (bundle, fixture) → the sub-bundle a preview needs
  generated/
    cli-output.json       # generated: real CLI output blocks (D1)
    mcp-call.json         # generated: the D2 tool call and its response
scripts/
  generate-landing-samples.ts   # regenerates lib/landing/generated/*
```

### Content model

```ts
type PartId = "maps" | "truth" | "quality" | "agents" | "run";
type Layout = "preview-right" | "preview-left" | "preview-full" | "text-only";

interface Part { id: PartId; title: string; intro: string }

interface Section {
  id: string;                // "delivery-board"
  part: PartId;
  title: string;
  why: string;
  what: string;
  how: string;
  preview: PreviewId | "none";
  layout: Layout;
}

export const PARTS: Part[];        // page order of parts
export const SECTIONS: Section[];  // page order within a part
```

`PreviewId` is the union of the registry's keys, so an unregistered id in
`SECTIONS` is a type error.

### Preview contract

```ts
interface PreviewProps {
  bundle: ProjectBundle;   // the self-map, loaded once by LandingPage
  quality?: QualitySection; // only the two Kritik previews read it
}
```

Rules every preview obeys, real or tailored:

- Reads its ids from `fixtures.ts`, slices through `lib/landing/slice.ts`,
  and passes plain props to the components it renders. No `useNodes`,
  `useProject`, `useJournal`, no `DataProvider`, no panel context.
- Is a client component only if it needs interaction (the two canvases). The
  rest are server-renderable.
- Renders inside `PreviewFrame` and nowhere else. The frame owns height,
  overflow, the "live" badge and the background, so previews never set their
  own outer size.
- Contains no marketing text. Labels shown are the product's own labels.
- Handlers that would edit are no-ops. Selection handlers may open nothing.

### Refactors this requires

The two map components are hook-driven (`JourneyMap({ projectId })`
constructs its own data through `useNodes`, `useEdges`, `useProject`,
`useJournal`, panel context). Each is split in two:

- `JourneyMap` keeps the hooks, panels and editing and becomes the
  controller.
- `JourneyCanvas` is the new presentational component: props are the
  constructed graph (from `lib/utils/journey-graph.ts`), display settings,
  `readOnly`, and callbacks. The controller renders it. The preview renders it
  with the fixture slice.

Same split for `SystemMap` → `SystemCanvas`.

`DeliveryBoard`, `AcceptanceMatrix`, `DecisionLog`, `FeedRow`,
`FindingsBoard`, `QualityGallery`, `PlatformGaugesCard` are already
props-driven and need no change beyond, where missing, a `readOnly` prop that
hides edit affordances.

The prompt builder's use-case picker is extracted from `PromptBuilderForm`
into its own primitive so D3 can render it without the form state.

### Data flow

1. `app/page.tsx` renders the hero, then `<LandingPage />`.
2. `LandingPage` loads the self-map through the existing seed loader in
   `lib/data/arkaik-seed.ts` (server side, once), loads the quality fixture,
   and loops `PARTS` → `SECTIONS`.
3. `LandingSection` renders the text column and looks up
   `registry[section.preview]`, rendering it inside `PreviewFrame`.
4. Each preview slices the bundle and renders.

The self-map is already shipped to the client for the seed project, so the
page adds no new payload class. The canvases are lazy-loaded so React Flow
does not block first paint.

### Generated samples

`scripts/generate-landing-samples.ts` runs the real CLI (`arkaik validate`,
`arkaik log`) and the real MCP server (`list_nodes` with a fixed input)
against the self-map and writes `lib/landing/generated/*.json`. The script
joins the existing `generate` npm script family, so CI's generated-artifact
diff catches drift exactly as it does for the schema.

## Error handling

- A fixture id missing from the seed is a test failure, not a runtime
  fallback. `tests/landing/fixtures.test` asserts every id in `fixtures.ts`
  resolves in the seed and every `Section.preview` has a registry entry.
- The quality fixture is parsed by the schema's quality parser in the same
  test.
- `PreviewFrame` wraps its child in an error boundary that renders the
  frame empty with a small "preview unavailable" line. This is a safety net
  for production only. The test above is the real gate.

## Testing

- `tests/landing/fixtures.test`: id resolution, registry coverage, quality
  fixture parses.
- `tests/landing/content.test`: every section has non-empty why/what/how,
  every part in `PARTS` has at least one section, no section references an
  unknown part.
- `lib/landing/slice.ts` unit tests: a slice contains exactly the requested
  nodes, their induced edges, and the journal events that mention them.
- Canvas split: existing map tests keep passing against the controllers.
- Visual check via playwright in the scratchpad against `npm run dev`, light
  and dark, at 1280 and 390 wide.

## Non-goals

- No change to the hero, the signed-in redirect, or `/docs`.
- No CMS, no MDX, no i18n. One `content.ts` in English.
- No analytics, no forms, no pricing table.
- No editing inside previews.
- No Kritik audit of Arkaik itself. The quality fixture is illustrative and
  says so in a code comment. Replacing it with a real audit later is a
  fixture swap.

## Shipping

Larger than one PR. Proposed stack (`docs/conventions.md` § Shipping larger
work):

1. Canvas split (`JourneyCanvas`, `SystemCanvas`) and the picker extraction.
   No user-visible change, no Lab Note.
2. Content model, fixtures, slice, `PreviewFrame`, `LandingPage` scaffold,
   parts `maps` and `truth`.
3. Parts `quality` and `agents`, the generated samples script, the diagram.
4. Part `run`, footer, responsive and theme pass. Lab Note on this one.

## Appendix: copy direction per section

One line each. Final wording is tuned in `content.ts`; the intent here is
binding.

| Section | Why | What | How |
|---|---|---|---|
| A1 Journey | Navigation is how users experience a product | Flows as ordered playlists of views and sub-flows, conditions and junctions | Compose edges are synthesized from the playlist, so a flow cannot lie about its screens |
| A2 System | Every backend change starts with "which screens render this" | Views, endpoints, data models as tiers with cross-layer edges | ELK-layered by species tier, scoped by root anchor; custom maps are saved JSON |
| A3 Delivery | "What is in flight on Android" has no answer in a task tracker | A board of (node × platform) items by status; one view can sit in two columns | Same projection the MCP `list_nodes` tool serves |
| A4 Overview | A strategist wants one screen that says where the product stands | Gauges, release pulse, backlog, inventory, parity, quality grade | Every card is a pure projection over snapshot plus journal |
| B1 Platform statuses | One status per feature hides that Web shipped and iOS didn't | Seven lifecycle statuses per platform, plus a blocked-by flag | Acceptances store the values, views and flows roll them up with one shared function |
| B2 Acceptances | "Live" is a claim; an acceptance is a testable promise | Given/When/Then, `covers` edges, one status column per platform, parity gaps in one click | Merged PRs promote acceptances through the GitHub App, scoped per platform |
| B3 Pyramid | Features should answer "what value does this create" | Thirty value elements in four tiers, each with a delivery gauge | Acceptances tagged with values; the pyramid aggregates them and links back to the matrix |
| B4 Decisions | A map without its reasons is archaeology | ADR-style decisions with their own status and three edges: supersedes, generates, impacts | Decision status maps onto lifecycle at write time; the validator flags mismatches |
| B5 Journal | "What changed between versions" needs history that never bloats the snapshot | Append-only events; timelines, changelogs, release notes and backlog derived from them | Snapshot authoritative for now, journal for history, cross-checked by the validator |
| C1 Matrix | "How good is each surface, and what do we fix first" deserves one comparable answer | Criteria scored 0 to 4 per surface, rolled up to grades with caps | Scores and findings are data files; severity is derived, never stored |
| C2 Findings | An audit is a snapshot; regressions happen between audits | Findings with lifecycle, signals that trip on regression, a board that opens on open work | CI trips signals over HTTP, agents open and resolve findings through MCP tools |
| D1 Skill | Nobody maintains a map by hand for long | A Claude Code skill that patches the map in the same commit as the code | `npx arkaik init` scaffolds it; the validator is a hard gate |
| D2 MCP | An agent should not parse a 4,000-line JSON into context | `arkaik-mcp`: read tools are the pages' projections, write tools are validator-gated | One tool catalog over two stores, repo or hosted; clients send operations, not graphs |
| D3 Assistant | An empty map is the hardest one to start | A prompt builder that generates a map from a pitch, a plan, or an existing map | Output validates through the same schema before import |
| E1 Modes | No account to start, no lock-in to stay | Lokal, Publik, Synk, Inkognito | One bundle format under all of them, MIT schema and toolchain |
| E2 Self-map | The strongest proof | Arkaik's own map, live | The same seed the app ships |
