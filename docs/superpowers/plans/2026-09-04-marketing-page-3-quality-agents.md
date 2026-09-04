# Marketing Page — Part 3: Quality and Agents Chapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append the `quality` chapter (C1 quality matrix, C2 findings board) and the `agents` chapter (D1 agent skill, D2 MCP server, D3 prompt builder) to the landing page, over a hand-authored Kritik section and real generated CLI/MCP samples.

**Architecture:** Same page-as-data model as Part 2 (`docs/superpowers/plans/2026-09-04-marketing-page-2-maps-truth.md`, spec `docs/superpowers/specs/2026-09-03-marketing-page-design.md`). Each task adds one preview end to end — catalogue id, fixture, section copy, registry entry, component — so every commit typechecks and `npm run test:landing` stays green. A third seed source, `pilot-audit`, is the Pebbles bundle carrying an illustrative quality section (neither shipped seed has one). Quality previews are server components handing pre-derived rows to the real quality leaves; D1/D2/D3 are tailored previews over a shared `CodeBlock` primitive and generated JSON samples produced by running the real CLI and the real MCP server.

> **Status (2026-09-04):** executed; PR #417 on stack #415. Deviations: schema test build path, `npx tsc --noEmit -p .` (no `typecheck` script), MCP protocol `2025-06-18`, `depth: "detailed"`, `hsl(var(--…))` for SVG tokens, write-path figure on two rows, `McpServerPreview` zero-arg.

**Tech Stack:** Next.js 16 App Router (RSC), React 19, `@arkaik/schema` quality projections (`resolveKritikLibrary`, `deriveQualityMatrix`), `lib/utils/quality` (`buildFindingRows`, `buildSurfaceGauges`, `buildCellCriteria`, `buildSurfaceTitles`), Tailwind 4 zinc tokens, plain-node test loader (`tests/landing/load-landing.js`), the `scripts/generate` family.

---

## Ground rules (read before every task)

- **Branch:** `marketing-3-quality-agents`, stacked on `marketing-2-maps-truth` with `gh stack add marketing-3-quality-agents` (run from the `marketing-2-maps-truth` checkout). Commit with `git add <paths>` + `git commit`; every message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Verification per task:** `npm run typecheck`, `npm run lint` (0 errors; 3 pre-existing warnings are fine), `npm run test:landing`. Tasks that touch generated artifacts also run `npm run generate` and `git status` must show only the files the task names.
- **Test loader rule:** any runtime `@/…` import in a module loaded by `tests/landing/load-landing.js` must be added to both `MODULES` and `SPECIFIER_MAP` there, or the loader throws. Type-only imports are erased and need nothing.
- **Preview contract (spec § Preview contract):** previews are server components unless they need interaction; a leaf that *requires* a handler gets a thin `previews/client/ReadOnly*.tsx` wrapper supplying the no-op; no marketing copy inside previews; never set the outer size (the frame owns it). Use `[overflow-x:auto]` / `[overflow:auto]` arbitrary properties, never `.overflow-x-auto` (globals.css wheel trap).
- **Dev server:** never run `npm run build` while `npm run dev` is up on 4242 (it clobbers `.next`); never pipe `npm run dev` through `head`.
- The wheel trap is also why C1 does not use `QualityGallery` (its root is `.overflow-x-auto`); three `SurfaceScoreCard`s fit a frame without scrolling.

---

### Task 1: The `pilot-audit` source and the quality fixture

**Files:**
- Create: `components/landing/quality-fixture.ts`
- Modify: `components/landing/previews/ids.ts` (the `PreviewSource` union only)
- Modify: `lib/landing/seeds.ts`
- Modify: `components/landing/content.ts` (`SOURCE_CAPTION` only)
- Modify: `tests/landing/load-landing.js`, `tests/landing/landing.test.js`

- [x] **Step 1: Extend the test loader and write the failing assertions**

In `tests/landing/load-landing.js` add to `MODULES`:

```js
  ["components/landing/quality-fixture.ts", "quality-fixture"],
```

and to the returned object:

```js
    ...require(path.join(BUILD_DIR, "quality-fixture.js")),
```

(`quality-fixture.ts` imports only types, so `SPECIFIER_MAP` needs no entry.)

In `tests/landing/landing.test.js` replace the destructuring line with:

```js
const { PREVIEW_IDS, PREVIEW_META, PARTS, SECTIONS, FIXTURES, sliceBundle, prepareBundle, LANDING_QUALITY, LANDING_QUALITY_EVENTS } = loadLanding();
const { QualitySectionSchema, resolveKritikLibrary, deriveQualityMatrix, KnownJournalEventSchema } = require(path.join(__dirname, "..", "schema", ".test-build", "index.js"));
```

> If the schema test build lives elsewhere, read `tests/schema/load-schema.js` for `BUILD_DIR` and use `require("../schema/load-schema").BUILD_DIR` instead of the literal path.

Replace the `SEEDS` block with:

```js
const pebbles = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8"));
const SEEDS = {
  "self-map": JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "arkaik-self-map.json"), "utf8")),
  pebbles,
  // Mirrors lib/landing/seeds.ts: Pebbles plus the illustrative audit.
  "pilot-audit": { ...pebbles, quality: LANDING_QUALITY, journal: [...(pebbles.journal ?? []), ...LANDING_QUALITY_EVENTS] },
};
```

Update the catalogue source assertion to accept the third source:

```js
  assert(meta && ["self-map", "pebbles", "pilot-audit"].includes(meta.source), `${id}: names a seed source`);
```

Append, before the final failure summary:

```js
// Quality fixture: parses, resolves a library, derives a grade per surface, names real nodes
{
  const parsed = QualitySectionSchema.safeParse(LANDING_QUALITY);
  assert(parsed.success, `quality fixture parses (${parsed.success ? "ok" : JSON.stringify(parsed.error.issues[0])})`);
  const library = resolveKritikLibrary(LANDING_QUALITY);
  assert(library && library.criteria.length > 0, "quality fixture carries its own library");
  const matrix = deriveQualityMatrix({ quality: LANDING_QUALITY }, library);
  for (const surface of LANDING_QUALITY.profile.surfaces) {
    assert(typeof matrix.overall[surface.id] === "number", `quality fixture scores surface ${surface.id}`);
  }
  assert(LANDING_QUALITY.findings.some((f) => f.status === "open"), "quality fixture has an open finding");
  assert(LANDING_QUALITY.findings.some((f) => f.status === "resolved"), "quality fixture has a resolved finding");
  for (const f of LANDING_QUALITY.findings) {
    for (const id of f.node_ids ?? []) assert(nodeIds.pebbles.has(id), `finding ${f.id} names node ${id} in pebbles`);
  }
  for (const e of LANDING_QUALITY_EVENTS) {
    const ok = KnownJournalEventSchema.safeParse(e);
    assert(ok.success, `quality event ${e.type} is a known journal event`);
  }
  assert(LANDING_QUALITY_EVENTS.some((e) => e.type === "quality.signal.tripped"), "quality events include a tripped signal");
}
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm run test:landing`
Expected: throws `Cannot find module …quality-fixture` (or `LANDING_QUALITY is not defined`).

- [x] **Step 3: Write the fixture**

Create `components/landing/quality-fixture.ts`:

```ts
import type { JournalEvent, QualitySection } from "@arkaik/schema";

/**
 * The quality section the landing page renders — ILLUSTRATIVE, not an audit.
 *
 * Neither shipped seed carries Kritik data, so the `quality` chapter reads the
 * Pebbles bundle with this section attached (`lib/landing/seeds.ts`,
 * source `pilot-audit`). Shapes, ids and criteria are lifted from the real
 * Pebbles pilot audit (`tests/fixtures/quality/pilot-2026-08.json` and
 * `packages/kritik-library/framework.json`); the levels, evidence and
 * findings are invented to show every state the UI has. Replacing it with a
 * real audit is a fixture swap. `tests/landing/landing.test.js` parses it with
 * the schema and derives the matrix from it, so it cannot drift silently.
 */
const AUDIT_ID = "2026-08";
const TS = "2026-08-26T00:00:00.000Z";
const COMMIT = "9f2c1e4d";

export const LANDING_QUALITY: QualitySection = {
  framework_version: "0.1.0",
  library: {
    version: "0.1.0",
    domains: [
      { code: "SEC", name: "Security" },
      { code: "A11Y", name: "Accessibility & Inclusion" },
      { code: "TST", name: "Testing & Verification" },
      { code: "REL", name: "Reliability & Observability" },
    ],
    criteria: [
      { id: "SEC-01", domain: "SEC", name: "Authentication and session lifecycle integrity", weight: 3,
        question: "Do all authentication flows and session lifecycles go through the vetted auth SDK and behave consistently on every client surface?" },
      { id: "SEC-03", domain: "SEC", name: "Security-definer RPC and privileged-role hygiene", weight: 3,
        question: "Does every security-definer function pin its search_path and verify caller ownership inside the function body?" },
      { id: "A11Y-01", domain: "A11Y", name: "Keyboard operability and accessible semantics", weight: 3,
        question: "Can every interactive flow be completed with a keyboard alone, with a visible focus indicator at every step?" },
      { id: "TST-01", domain: "TST", name: "Core user paths have automated tests", weight: 3,
        question: "Is every core user path exercised by at least one automated test that would fail if the path broke?" },
      { id: "REL-01", domain: "REL", name: "Failure states distinct from empty states", weight: 3,
        question: "Does every data load distinguish failure from emptiness, with a recoverable error state?" },
    ],
  },
  profile: {
    surfaces: [
      { id: "web", title: "Web app", platform: "web", path: "apps/web" },
      { id: "ios", title: "iOS", platform: "ios", path: "apps/ios" },
      { id: "android", title: "Android", platform: "android", path: "apps/android" },
    ],
    domain_weights: { SEC: 2, A11Y: 1, TST: 1, REL: 1 },
  },
  assessments: [
    // web
    a("SEC-01", "web", 3, "Sign-in, refresh and sign-out all go through the SDK; one shared sign-out helper."),
    a("SEC-03", "web", 1, "Two definer functions read `select *` across user rows; search_path unpinned on one."),
    a("A11Y-01", "web", 2, "Overlays are accessible primitives; three custom controls lack a focus ring."),
    a("TST-01", "web", 3, "Every core path has a Playwright spec; CI runs them on each PR."),
    a("REL-01", "web", 2, "Lists distinguish failure from empty; the pebble detail swallows one fetch error."),
    // ios
    a("SEC-01", "ios", 3, "Keychain-backed session via the SDK; refresh handled centrally."),
    a("SEC-03", "ios", 4, "No privileged calls from the client; every RPC is allowlisted server side."),
    a("A11Y-01", "ios", 3, "VoiceOver labels on every control; Dynamic Type verified at the largest size."),
    a("TST-01", "ios", 2, "Unit tests on the domain layer; no UI test covers the draw flow."),
    a("REL-01", "ios", 3, "Every screen has an error state with retry; errors logged with cause."),
    // android
    a("SEC-01", "android", 2, "Session refresh implemented twice; one path bypasses the SDK."),
    a("SEC-03", "android", 4, "No privileged calls from the client; every RPC is allowlisted server side."),
    a("A11Y-01", "android", 1, "TalkBack reads unlabeled icons on the timeline; no focus order defined."),
    a("TST-01", "android", 1, "One smoke test; no CI job runs the Android test command."),
    a("REL-01", "android", 2, "Empty and failed loads share one placeholder on two screens."),
  ],
  findings: [
    {
      id: "F-2026-08-SEC-web-01",
      criterion_id: "SEC-03",
      surface: "web",
      title: "Two security-definer functions return whole rows across user boundaries",
      detail: "`pebble_feed` and `soul_lookup` are definer functions that `select *` from tables holding other users' rows, so any caller reads columns the RLS policies were written to hide.",
      evidence: "supabase/migrations/20260411000001_core_tables.sql:159-188",
      impact: 4,
      likelihood: 4,
      cost: "S",
      status: "open",
      remediation: "Return an explicit column allowlist and pin `search_path` on both functions.",
      node_ids: ["V-pebble-detail", "V-souls-list"],
      verification: { verdict: "CONFIRMED" },
    },
    {
      id: "F-2026-08-A11Y-android-01",
      criterion_id: "A11Y-01",
      surface: "android",
      title: "Timeline icon buttons have no content description",
      detail: "TalkBack announces the emotion glyphs on the timeline as \"button\" with no label, so the primary navigation is unusable without sight.",
      evidence: "apps/android/app/src/main/java/timeline/TimelineRow.kt:41-58",
      impact: 3,
      likelihood: 4,
      cost: "S",
      status: "resolved",
      node_ids: ["V-timeline"],
      verification: { verdict: "CONFIRMED" },
    },
    {
      id: "F-2026-08-TST-android-01",
      criterion_id: "TST-01",
      surface: "android",
      title: "No CI job runs the Android test command",
      detail: "The Android workspace has a test target but no workflow invokes it, so a broken draw flow ships unnoticed.",
      evidence: ".github/workflows/*.yml — no `gradlew test` step",
      impact: 3,
      likelihood: 3,
      cost: "M",
      status: "open",
      node_ids: ["V-home"],
      verification: { verdict: "CONFIRMED" },
    },
  ],
};

/**
 * The journal facts the findings board's feed row shows: a CI-tripped signal
 * (the prompt to go look, not a finding) and the resolution of the A11Y
 * finding above. Appended to the Pebbles journal by `lib/landing/seeds.ts`.
 */
export const LANDING_QUALITY_EVENTS: JournalEvent[] = [
  {
    id: "01K3Y0000000000000000QF001",
    ts: "2026-08-27T09:12:00.000Z",
    actor: "github-app",
    type: "quality.finding.resolved",
    finding_id: "F-2026-08-A11Y-android-01",
    resolved_by: "https://github.com/pebbles/pebbles/pull/745",
    node_ids: ["V-timeline"],
  },
  {
    id: "01K3Y0000000000000000QS001",
    ts: "2026-08-28T14:03:00.000Z",
    actor: "ci",
    type: "quality.signal.tripped",
    criterion_id: "TST-01",
    surface: "android",
    signal: "CI workflow exists per surface that runs its test command",
    commit: COMMIT,
    detail: "android.yml removed its `gradlew test` step in #751.",
  },
];

function a(criterion_id: string, surface: string, level: 0 | 1 | 2 | 3 | 4, evidence: string) {
  return { criterion_id, surface, level, evidence, audit_id: AUDIT_ID, commit: COMMIT, ts: TS };
}
```

> `JournalEvent` and `QualitySection` are exported from `@arkaik/schema`; if `JournalEvent` is not (check `packages/schema/src/index.ts`), import it from `@/lib/data/types` instead — that import is type-only and erased by the test loader.

- [x] **Step 4: Add the source, seed and caption**

`components/landing/previews/ids.ts`:

```ts
/**
 * `pilot-audit` is Pebbles with the illustrative quality section attached
 * (`components/landing/quality-fixture.ts`): the two Kritik previews need a
 * `bundle.quality` and neither shipped seed has one.
 */
export type PreviewSource = "self-map" | "pebbles" | "pilot-audit";
```

`lib/landing/seeds.ts`:

```ts
import arkaikSelfMap from "@/seed/arkaik-self-map.json";
import pebbles from "@/seed/pebbles.json";
import { LANDING_QUALITY, LANDING_QUALITY_EVENTS } from "@/components/landing/quality-fixture";
import type { ProjectBundle } from "@/lib/data/types";
import type { PreviewSource } from "@/components/landing/previews/ids";

/**
 * The seeds as the landing page reads them: build-time JSON imports, typed
 * through the same cast `lib/data/arkaik-seed.ts` uses. Not the seed provider —
 * that module drags the client data layer into a server tree. `pilot-audit` is
 * Pebbles carrying the illustrative Kritik section and its two journal facts.
 */
export function loadLandingSeeds(): Record<PreviewSource, ProjectBundle> {
  const pebblesBundle = pebbles as unknown as ProjectBundle;
  return {
    "self-map": arkaikSelfMap as unknown as ProjectBundle,
    pebbles: pebblesBundle,
    "pilot-audit": {
      ...pebblesBundle,
      quality: LANDING_QUALITY,
      journal: [...(pebblesBundle.journal ?? []), ...LANDING_QUALITY_EVENTS],
    },
  };
}
```

`components/landing/content.ts`, `SOURCE_CAPTION`:

```ts
export const SOURCE_CAPTION: Record<PreviewSource, string> = {
  "self-map": "Rendered from Arkaik's own map, right now.",
  pebbles: "Rendered from the built-in Pebbles example, right now.",
  "pilot-audit": "Rendered from an illustrative Kritik audit of the Pebbles example, right now.",
};
```

- [x] **Step 5: Verify**

Run: `npm run test:landing && npm run typecheck && npm run lint`
Expected: all landing assertions PASS (including the new quality block); typecheck clean; lint 0 errors.

- [x] **Step 6: Commit**

```bash
git add components/landing/quality-fixture.ts components/landing/previews/ids.ts lib/landing/seeds.ts components/landing/content.ts tests/landing/load-landing.js tests/landing/landing.test.js
git commit -m "landing: the pilot-audit source and the illustrative quality fixture"
```

---

### Task 2: Describe quality events in the journal feed

**Files:**
- Modify: `components/journal/describe-event.ts`
- Regenerated: `lib/wobble/wobble-registry.generated.ts`, `app/wobble.generated.css` (new lucide icons)

`FeedRow` renders `describeJournalEvent(event)`, which has no case for the five `quality.*` event types and falls back to the raw type string. C2 shows a `quality.signal.tripped` row, so the describer learns them. This is a real app improvement (the changelog and node history pages get it too).

- [x] **Step 1: Add icons and cases**

In the lucide import add `ClipboardCheck, TriangleAlert, CircleCheck, ShieldCheck, Radar`. In `EVENT_ICONS` add:

```ts
  "quality.audit.completed": ClipboardCheck,
  "quality.finding.opened": TriangleAlert,
  "quality.finding.resolved": CircleCheck,
  "quality.finding.accepted": ShieldCheck,
  "quality.signal.tripped": Radar,
```

In the `switch`, before `default:`:

```ts
    case "quality.audit.completed": {
      const audit = str(event.audit_id) ?? "?";
      const framework = str(event.framework_version);
      return { icon, text: `Audit ${audit} completed`, meta: framework ? `Kritik ${framework}` : undefined };
    }
    case "quality.finding.opened": {
      const severity = str(event.severity);
      const where = `${str(event.criterion_id) ?? "?"} on ${str(event.surface) ?? "?"}`;
      return { icon, text: str(event.title) ?? `Finding ${str(event.finding_id) ?? "?"} opened`, meta: severity ? `${severity} · ${where}` : where };
    }
    case "quality.finding.resolved": {
      const by = str(event.resolved_by);
      return { icon, text: `Finding ${str(event.finding_id) ?? "?"} resolved`, meta: by ? `by ${by}` : undefined };
    }
    case "quality.finding.accepted":
      return { icon, text: `Finding ${str(event.finding_id) ?? "?"} accepted as a risk`, meta: str(event.reason) };
    case "quality.signal.tripped": {
      const where = `${str(event.criterion_id) ?? "?"} on ${str(event.surface) ?? "?"}`;
      const commit = str(event.commit);
      return { icon, text: `Signal tripped: ${where}`, meta: [str(event.signal), commit ? `at ${commit.slice(0, 7)}` : undefined].filter(Boolean).join(" · ") };
    }
```

- [x] **Step 2: Regenerate the icon registry and verify**

Run: `npm run generate && git status --short`
Expected: only `components/journal/describe-event.ts` plus (possibly) `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css` are modified. Then `npm run typecheck && npm run lint`.

- [x] **Step 3: Commit**

```bash
git add components/journal/describe-event.ts lib/wobble/wobble-registry.generated.ts app/wobble.generated.css
git commit -m "journal: describe the five quality.* events in the feed"
```

---

### Task 3: C1 — the quality matrix preview and the `quality` chapter

**Files:**
- Create: `components/landing/previews/QualityMatrixPreview.tsx`
- Modify: `components/landing/previews/ids.ts`, `components/landing/fixtures.ts`, `components/landing/content.ts`, `components/landing/previews/registry.tsx`

- [x] **Step 1: Catalogue, fixture, copy**

`ids.ts` — append to `PREVIEW_IDS`:

```ts
  "quality-matrix",
```

and to `PREVIEW_META`:

```ts
  "quality-matrix":    { source: "pilot-audit", height: 380, breadcrumb: ["Quality", "Matrix"],  journal: false },
```

`fixtures.ts` — add:

```ts
  "quality-matrix": { source: "pilot-audit", nodeIds: [] }, // reads bundle.quality; the criteria list is pinned in the preview
```

`content.ts` — append to `PARTS`:

```ts
  { id: "quality", title: "Keep it honest", intro: "A map says what exists. Kritik says how good it is, surface by surface, and what to fix first." },
```

and to `SECTIONS`:

```ts
  {
    id: "quality-matrix", part: "quality", title: "Quality matrix", preview: "quality-matrix",
    why: "\"How good is each surface, and what do we fix first\" deserves one comparable answer, not a folder of audit PDFs.",
    what: "Criteria scored 0 to 4 per surface, weighted into domain scores and rolled up to a grade. An open critical finding caps the grade.",
    how: "Scores and findings are data files in the repo; severity, priority and grade are derived, never stored, so two readers cannot disagree.",
  },
```

- [x] **Step 2: The preview**

Create `components/landing/previews/QualityMatrixPreview.tsx`:

```tsx
import { deriveQualityMatrix, resolveKritikLibrary, type QualityMatrixCell } from "@arkaik/schema";
import { LevelMeter } from "@/components/quality/LevelMeter";
import { SurfaceScoreCard } from "@/components/quality/SurfaceScoreCard";
import type { PreviewProps } from "@/components/landing/previews/types";
import { buildCellCriteria, buildSurfaceGauges } from "@/lib/utils/quality";

/** The cell whose criteria are listed under the cards: the weakest web domain. */
const DETAIL_DOMAIN = "SEC";
const DETAIL_SURFACE = "web";

/**
 * One score card per surface, then the criteria behind one cell with the
 * level each was scored at. Every number comes from the schema's own
 * projections over `bundle.quality`; the cards are the app's, rendered inert
 * (no `onClick`). A server component: only rendered props cross to the client.
 */
export function QualityMatrixPreview({ bundle }: PreviewProps) {
  const section = bundle.quality;
  const library = resolveKritikLibrary(section);
  const matrix = deriveQualityMatrix({ quality: section }, library);
  const gauges = buildSurfaceGauges(matrix, section, library);
  const criteria = buildCellCriteria(section, library, DETAIL_DOMAIN, DETAIL_SURFACE);
  const domainName = library?.domains.find((d) => d.code === DETAIL_DOMAIN)?.name ?? DETAIL_DOMAIN;
  const surfaceTitle = gauges.find((g) => g.surface === DETAIL_SURFACE)?.title ?? DETAIL_SURFACE;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      <div className="flex flex-wrap gap-2">
        {gauges.map((gauge) => (
          <SurfaceScoreCard
            key={gauge.surface}
            title={gauge.title}
            score={gauge.score}
            grade={gauge.grade}
            findings={sumFindings(matrix.matrix, gauge.surface)}
            meta={`${gauge.openFindings} open`}
            label={`${gauge.title}: ${gauge.score === null ? "not scored" : `${gauge.score} (${gauge.grade})`}`}
          />
        ))}
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {domainName} · {surfaceTitle}
        </p>
        <ul className="divide-y">
          {criteria.map((row) => (
            <li key={row.criterionId} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="font-mono text-[11px] text-muted-foreground">{row.criterionId}</span>
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <LevelMeter level={row.level} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Open findings by severity across every domain of one surface, for the card's dots. */
function sumFindings(
  cells: Record<string, Record<string, QualityMatrixCell | null>>,
  surface: string,
): QualityMatrixCell["findings"] {
  const total = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of Object.values(cells)) {
    const cell = row[surface];
    if (!cell) continue;
    total.critical += cell.findings.critical;
    total.high += cell.findings.high;
    total.medium += cell.findings.medium;
    total.low += cell.findings.low;
  }
  return total;
}
```

`registry.tsx` — import and add `"quality-matrix": QualityMatrixPreview,`.

- [x] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run test:landing`
Expected: green. Note `SurfaceScoreCard` is `"use client"` with an optional `onClick`; rendering it from a server component without a handler is fine.

- [x] **Step 4: Commit**

```bash
git add components/landing/previews/QualityMatrixPreview.tsx components/landing/previews/ids.ts components/landing/fixtures.ts components/landing/content.ts components/landing/previews/registry.tsx
git commit -m "landing: the quality chapter opens with the matrix preview"
```

---

### Task 4: C2 — the findings board preview

**Files:**
- Create: `components/landing/previews/FindingsBoardPreview.tsx`, `components/landing/previews/client/ReadOnlyFindingsBoard.tsx`
- Modify: `ids.ts`, `fixtures.ts`, `content.ts`, `registry.tsx`

- [x] **Step 1: Catalogue, fixture, copy**

`PREVIEW_IDS` += `"findings-board"`; `PREVIEW_META`:

```ts
  "findings-board":    { source: "pilot-audit", height: 420, breadcrumb: ["Quality", "Findings"], journal: true },
```

`FIXTURES`:

```ts
  "findings-board": { source: "pilot-audit", nodeIds: ["V-pebble-detail", "V-souls-list", "V-timeline", "V-home"] },
```

`SECTIONS` (after `quality-matrix`):

```ts
  {
    id: "findings-board", part: "quality", title: "Findings and signals", preview: "findings-board",
    why: "An audit is a snapshot. Regressions happen between audits, when nobody is looking.",
    what: "Findings with a lifecycle: open, resolved, refuted, accepted risk. Signals that trip on regression. A board that opens on the open work.",
    how: "CI trips signals over HTTP; agents open and resolve findings through MCP tools. Both are journal events, so the board is never stale.",
  },
```

- [x] **Step 2: The client wrapper**

Create `components/landing/previews/client/ReadOnlyFindingsBoard.tsx`:

```tsx
"use client";

import { FindingsBoard } from "@/components/quality/FindingsBoard";
import type { ComponentProps } from "react";

/**
 * `FindingsBoard` requires `onOpenNode`, and a function cannot cross the RSC
 * boundary, so the no-op is supplied here. `onOpenCriterion` is left out on
 * purpose: without it `FindingCard` drops the criterion chip's button.
 */
export function ReadOnlyFindingsBoard(props: Omit<ComponentProps<typeof FindingsBoard>, "onOpenNode" | "onOpenCriterion">) {
  return <FindingsBoard {...props} onOpenNode={() => {}} />;
}
```

- [x] **Step 3: The preview**

Create `components/landing/previews/FindingsBoardPreview.tsx`:

```tsx
import { resolveKritikLibrary } from "@arkaik/schema";
import { FeedRow } from "@/components/journal/FeedRow";
import { ReadOnlyFindingsBoard } from "@/components/landing/previews/client/ReadOnlyFindingsBoard";
import type { PreviewProps } from "@/components/landing/previews/types";
import type { Node } from "@/lib/data/types";
import { buildFindingRows, buildSurfaceTitles } from "@/lib/utils/quality";

/**
 * The real board over the fixture's findings, worst first, then the quality
 * facts from the journal as feed rows — a signal a CI run tripped and a
 * finding a merged PR resolved. A server component; the map that crosses to
 * the client holds only the nodes the findings name.
 */
export function FindingsBoardPreview({ bundle }: PreviewProps) {
  const section = bundle.quality;
  const library = resolveKritikLibrary(section);
  const rows = buildFindingRows(section, library);
  const surfaceTitles = buildSurfaceTitles(section);
  const events = (bundle.journal ?? []).filter((event) => event.type.startsWith("quality."));

  const referenced = new Map<string, Node>();
  const byId = new Map(bundle.nodes.map((node) => [node.id, node]));
  for (const row of rows) for (const id of row.nodeIds) {
    const node = byId.get(id);
    if (node) referenced.set(id, node);
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="min-h-0 flex-1 [overflow:auto]">
        <ReadOnlyFindingsBoard rows={rows} nodesById={referenced} surfaceTitles={surfaceTitles} />
      </div>
      <ul className="divide-y border-t pt-1">
        {events.map((event) => <li key={event.id}><FeedRow event={event} nodesById={referenced} /></li>)}
      </ul>
    </div>
  );
}
```

`registry.tsx` — import and add `"findings-board": FindingsBoardPreview,`.

- [x] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run lint && npm run test:landing` — green.

```bash
git add components/landing/previews/FindingsBoardPreview.tsx components/landing/previews/client/ReadOnlyFindingsBoard.tsx components/landing/previews/ids.ts components/landing/fixtures.ts components/landing/content.ts components/landing/previews/registry.tsx
git commit -m "landing: the findings board preview with its journal facts"
```

---

### Task 5: Generated samples — real CLI and MCP output

**Files:**
- Create: `scripts/generate/generate-landing-samples.js`, `lib/landing/generated/cli-validate.json`, `lib/landing/generated/mcp-call.json`
- Modify: `scripts/generate/index.js`, `.github/workflows/ci.yml` (drift diff paths), `tests/landing/landing.test.js`

The spec wants D1's validator output and D2's tool response to be real. The script builds the CLI and the MCP server (their `dist/` is git-ignored, and CI runs `npm run generate` right after `npm ci`), runs `arkaik validate` over the self-map, and drives the MCP server over stdio exactly as `tests/mcp/run-mcp-tests.js` does.

- [x] **Step 1: Failing test**

Append to `tests/landing/landing.test.js`:

```js
// Generated samples: present, shaped, and about the self-map
{
  const gen = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "landing", "generated", name), "utf8"));
  const cli = gen("cli-validate.json");
  assert(cli.command.startsWith("arkaik validate"), "cli sample records its command");
  assert(/Result: VALID/.test(cli.output), "cli sample is a VALID run");
  assert(cli.output.includes(`Nodes: ${SEEDS["self-map"].nodes.length}`), "cli sample counts the self-map's nodes");
  const mcp = gen("mcp-call.json");
  assert(mcp.tool === "list_nodes" && mcp.arguments && typeof mcp.arguments === "object", "mcp sample is a list_nodes call");
  assert(Array.isArray(mcp.result.nodes) && mcp.result.nodes.length > 0 && mcp.result.nodes.length <= mcp.arguments.limit, "mcp sample result is bounded by its limit");
  assert(mcp.result.nodes.every((n) => nodeIds["self-map"].has(n.id)), "mcp sample nodes exist in the self-map");
}
```

Run: `npm run test:landing` → fails with `ENOENT … cli-validate.json`.

- [x] **Step 2: The generator**

Create `scripts/generate/generate-landing-samples.js`:

```js
#!/usr/bin/env node

/**
 * Regenerates lib/landing/generated/*.json — the landing page's "agents"
 * chapter shows real tool output, not prose. Runs the built CLI over the
 * self-map and drives the built MCP server over stdio (the harness pattern of
 * tests/mcp/run-mcp-tests.js). Both packages are built first because their
 * dist/ is git-ignored and CI generates right after `npm ci`. Output is
 * deterministic (no timestamps, no absolute paths), so the CI drift gate
 * diffs it like every other generated artifact.
 */

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "lib", "landing", "generated");
const BUNDLE = path.join(ROOT, "seed", "arkaik-self-map.json");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const MCP = path.join(ROOT, "packages", "mcp", "dist", "index.js");

/** The one call D2 shows. Fixed here so the sample cannot wander between runs. */
const MCP_CALL = { tool: "list_nodes", arguments: { species: "view", status: "live", query: "map", limit: 3 } };

function build() {
  execFileSync("npm", ["run", "build", "-w", "arkaik", "-w", "arkaik-mcp"], { cwd: ROOT, stdio: "inherit" });
}

function cliValidate() {
  const output = execFileSync(process.execPath, [CLI, "validate", "seed/arkaik-self-map.json"], { cwd: ROOT, encoding: "utf8" });
  return { command: "arkaik validate seed/arkaik-self-map.json", output: output.trimEnd() };
}

function mcpCall() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP, "--bundle", BUNDLE], { stdio: ["pipe", "pipe", "inherit"] });
    const lines = readline.createInterface({ input: child.stdout });
    const pending = new Map();
    let nextId = 1;
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const waiter = pending.get(message.id);
      if (waiter) { pending.delete(message.id); waiter(message); }
    });
    const request = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error(`Timed out waiting for ${method}`)); }, 15000);
      pending.set(id, (m) => { clearTimeout(timer); res(m); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);

    (async () => {
      await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "generate-landing-samples", version: "0" } });
      notify("notifications/initialized", {});
      const response = await request("tools/call", { name: MCP_CALL.tool, arguments: MCP_CALL.arguments });
      if (response.error) throw new Error(JSON.stringify(response.error));
      const text = response.result.content?.[0]?.text ?? "";
      resolve({ ...MCP_CALL, result: JSON.parse(text) });
    })().catch(reject).finally(() => child.stdin.end());
  });
}

async function main() {
  build();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cli = cliValidate();
  const mcp = await mcpCall();
  for (const [name, data] of [["cli-validate.json", cli], ["mcp-call.json", mcp]]) {
    fs.writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
    console.log(`generated lib/landing/generated/${name}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
```

> Copy the `initialize` handshake the MCP tests use (`grep -n initialize tests/mcp/run-mcp-tests.js`) if the protocol version or method names differ from the above. If `list_nodes` with these arguments returns fewer than one node, change `query` to a word that matches live views of the self-map (`node -e` over the seed to find one) — the point is three real view summaries.

Append `"generate-landing-samples.js",` to `STEPS` in `scripts/generate/index.js` with the comment `// Landing page samples: runs the built CLI and MCP server over the self-map.`

In `.github/workflows/ci.yml`, add `lib/landing/generated` to the `git diff --exit-code --` path list of the "Fail on generated-artifact drift" step.

- [x] **Step 3: Generate and verify**

Run: `node scripts/generate/generate-landing-samples.js && npm run test:landing && git status --short`
Expected: two JSON files created, test green, and `git status` shows only the files this task names (run `npm run generate` once too — it must be a no-op on the second run: `npm run generate && git diff --stat lib/landing/generated` prints nothing).

- [x] **Step 4: Commit**

```bash
git add scripts/generate/generate-landing-samples.js scripts/generate/index.js lib/landing/generated .github/workflows/ci.yml tests/landing/landing.test.js
git commit -m "landing: generate real CLI and MCP samples for the agents chapter"
```

---

### Task 6: D1 — the agent skill preview and the `agents` chapter

**Files:**
- Create: `components/landing/previews/CodeBlock.tsx`, `components/landing/previews/samples/agent-skill.ts`, `components/landing/previews/AgentSkillDiffPreview.tsx`
- Modify: `ids.ts`, `fixtures.ts`, `content.ts`, `registry.tsx`

- [x] **Step 1: Catalogue, fixture, copy**

`PREVIEW_IDS` += `"agent-skill-diff"`; `PREVIEW_META`:

```ts
  "agent-skill-diff":  { source: "self-map", height: 400, breadcrumb: ["Repo", "docs/arkaik"],  journal: false },
```

`FIXTURES`:

```ts
  "agent-skill-diff": { source: "self-map", nodeIds: ["V-journey-map"] },
```

`PARTS` += :

```ts
  { id: "agents", title: "Maintained by agents", intro: "Nobody maintains a map by hand for long. Arkaik is built to be read and written by the agents that already write the code." },
```

`SECTIONS` += :

```ts
  {
    id: "agent-skill-diff", part: "agents", title: "The agent skill", preview: "agent-skill-diff",
    why: "Documentation rots because updating it is a second task. A map that lives in the repo can be patched in the same commit as the code.",
    what: "A Claude Code skill that knows the schema, patches the affected nodes surgically, and appends the matching journal event.",
    how: "npx arkaik init scaffolds it into any repo; the bundled validator is a hard gate, so a snapshot its journal contradicts never lands.",
  },
```

- [x] **Step 2: The shared code block**

Create `components/landing/previews/CodeBlock.tsx`:

```tsx
import { cn } from "@/lib/utils";

export type CodeLineKind = "add" | "del" | "muted";

export interface CodeLine {
  text: string;
  kind?: CodeLineKind;
}

interface CodeBlockProps {
  /** Small mono label above the block, e.g. a filename or a command. */
  title?: string;
  lines: readonly CodeLine[];
  className?: string;
}

const LINE_STYLES: Record<CodeLineKind, string> = {
  add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  del: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  muted: "text-muted-foreground",
};

/**
 * The one mono block the tailored agent previews share: a diff, a validator
 * run, a tool call, a prompt excerpt. Lines are data, so a preview never
 * embeds markup; the block never sets its own outer height.
 */
export function CodeBlock({ title, lines, className }: CodeBlockProps) {
  return (
    <div className={cn("min-w-0 rounded-md border bg-muted/30", className)}>
      {title && <div className="border-b px-3 py-1 font-mono text-[10px] text-muted-foreground">{title}</div>}
      <pre className="[overflow:auto] px-3 py-2 font-mono text-[11px] leading-5">
        {lines.map((line, i) => (
          <div key={i} className={cn("-mx-3 px-3 whitespace-pre", line.kind && LINE_STYLES[line.kind])}>
            {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
```

- [x] **Step 3: The sample data**

Create `components/landing/previews/samples/agent-skill.ts`:

```ts
import type { CodeLine } from "@/components/landing/previews/CodeBlock";

/**
 * D1's left pane: the code change an agent made. Illustrative — the file and
 * hunk are a plausible Arkaik change, not a real commit; the node patch and
 * journal event on the right are what the skill writes for it, and the
 * validator output is real (`lib/landing/generated/cli-validate.json`).
 */
export const CODE_DIFF: CodeLine[] = [
  { text: "components/maps/JourneyMap.tsx", kind: "muted" },
  { text: "@@ -41,6 +41,9 @@ export function JourneyMap({ projectId }: JourneyMapProps) {", kind: "muted" },
  { text: "   const params = useJourneyGraphParams(projectId);" },
  { text: "+  const handleNodeClick = useCallback(" },
  { text: "+    (id: string) => openNode(id), [openNode]," },
  { text: "+  );" },
  { text: "   return <JourneyCanvas {...params} onNodeClick={handleNodeClick} />;" },
];

/** The snapshot patch the skill makes for that change: one field, one node. */
export function nodePatch(nodeId: string, from: string, to: string): CodeLine[] {
  return [
    { text: "docs/arkaik/bundle.json", kind: "muted" },
    { text: `   "id": "${nodeId}",` },
    { text: `-  "status": "${from}",`, kind: "del" },
    { text: `+  "status": "${to}",`, kind: "add" },
  ];
}

/** The journal line appended in the same commit. */
export function journalLine(nodeId: string, from: string, to: string): CodeLine[] {
  return [
    { text: "docs/arkaik/journal.jsonl", kind: "muted" },
    {
      kind: "add",
      text: `+{"id":"01K4…","ts":"2026-09-04T10:12:00Z","actor":"claude-code","type":"node.status_changed","node_id":"${nodeId}","from":"${from}","to":"${to}"}`,
    },
  ];
}
```

- [x] **Step 4: The preview**

Create `components/landing/previews/AgentSkillDiffPreview.tsx`:

```tsx
import cliValidate from "@/lib/landing/generated/cli-validate.json";
import { CodeBlock } from "@/components/landing/previews/CodeBlock";
import { FIXTURES } from "@/components/landing/fixtures";
import { CODE_DIFF, journalLine, nodePatch } from "@/components/landing/previews/samples/agent-skill";
import type { PreviewProps } from "@/components/landing/previews/types";

const [NODE_ID] = FIXTURES["agent-skill-diff"].nodeIds!;

/**
 * Left: the code change. Right: the node patch and journal event the skill
 * wrote for it, then the validator's real verdict over the self-map. The node
 * is real and its current status is read from the bundle; the transition is
 * shown as `development → <current>`.
 */
export function AgentSkillDiffPreview({ bundle }: PreviewProps) {
  const node = bundle.nodes.find((n) => n.id === NODE_ID);
  const to = node?.status ?? "live";
  const from = to === "development" ? "idea" : "development";
  const validator = [
    { text: `$ ${cliValidate.command}`, kind: "muted" as const },
    ...cliValidate.output.split("\n").map((text) => ({ text })),
  ];
  return (
    <div className="grid h-full gap-3 overflow-hidden p-4 lg:grid-cols-2">
      <CodeBlock title="The change" lines={CODE_DIFF} />
      <div className="flex min-w-0 flex-col gap-3">
        <CodeBlock title="What the skill wrote" lines={[...nodePatch(NODE_ID, from, to), { text: "" }, ...journalLine(NODE_ID, from, to)]} />
        <CodeBlock title="The gate" lines={validator} />
      </div>
    </div>
  );
}
```

`registry.tsx` — import and add `"agent-skill-diff": AgentSkillDiffPreview,`.

> JSON imports: `tsconfig.json` already has `resolveJsonModule` (the seeds import the same way). If `cliValidate.output` types as `string` but lint complains about the `as const`, drop it and type `validator` as `CodeLine[]`.

- [x] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run lint && npm run test:landing` — green.

```bash
git add components/landing/previews/CodeBlock.tsx components/landing/previews/samples/agent-skill.ts components/landing/previews/AgentSkillDiffPreview.tsx components/landing/previews/ids.ts components/landing/fixtures.ts components/landing/content.ts components/landing/previews/registry.tsx
git commit -m "landing: the agents chapter opens with the skill diff preview"
```

---

### Task 7: D2 — the MCP diagram and the tool call

**Files:**
- Create: `components/landing/previews/McpDiagram.tsx`, `components/landing/previews/McpServerPreview.tsx`
- Modify: `ids.ts`, `fixtures.ts`, `content.ts`, `registry.tsx`

- [x] **Step 1: Catalogue, fixture, copy**

`PREVIEW_IDS` += `"mcp-server"`; `PREVIEW_META`:

```ts
  "mcp-server":        { source: "self-map", height: 460, breadcrumb: ["arkaik-mcp"],            journal: false },
```

`FIXTURES`:

```ts
  "mcp-server": { source: "self-map" }, // the call and its response are generated; nothing to pin
```

`SECTIONS` += :

```ts
  {
    id: "mcp-server", part: "agents", title: "The MCP server", preview: "mcp-server",
    why: "An agent should not parse a 4,000-line JSON into its context to answer \"what is live on the web\".",
    what: "arkaik-mcp: read tools that are the pages' own projections, write tools gated by the validator, Kritik tools for findings and signals.",
    how: "One tool catalog over two stores, a repo bundle or the hosted API. Clients send operations, not graphs, and every write is a journal event.",
  },
```

- [x] **Step 2: The diagram**

Create `components/landing/previews/McpDiagram.tsx`. Spec § Diagrams: node cards (card fill, radius 8, species-coloured left rail, title + muted subtitle), curved edges with small arrowheads, on the canvas dot grid, theme through CSS variables. Two figures: audience symmetry, and the write path.

```tsx
import type { ReactNode } from "react";

type Rail = "violet" | "teal" | "amber" | "green" | "blue" | "zinc";

const RAIL: Record<Rail, string> = {
  violet: "#8b5cf6",
  teal: "#14b8a6",
  amber: "#f59e0b",
  green: "#22c55e",
  blue: "#3b82f6",
  zinc: "#71717a",
};

const CARD_W = 108;
const CARD_H = 40;

interface CardProps { x: number; y: number; title: string; subtitle: string; rail: Rail }

/** An Arkaik node card, in SVG: card ground, border, coloured left rail, title, muted subtitle. */
function Card({ x, y, title, subtitle, rail }: CardProps) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={CARD_W} height={CARD_H} rx="8" fill="var(--card)" stroke="var(--border)" />
      <path d={`M8 0h3v${CARD_H}h-3a8 8 0 0 1 -8 -8v-${CARD_H - 16}a8 8 0 0 1 8 -8z`} fill={RAIL[rail]} />
      <text x="18" y="17" fontSize="9.5" fontWeight="600" fill="currentColor">{title}</text>
      <text x="18" y="30" fontSize="8" fill="var(--muted-foreground)">{subtitle}</text>
    </g>
  );
}

/** A curved compose-style edge from the right edge of one card to the left edge of another. */
function Edge({ from, to }: { from: [number, number]; to: [number, number] }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = Math.max(24, (x2 - x1) / 2);
  return (
    <path
      d={`M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
      fill="none"
      stroke="var(--muted-foreground)"
      strokeWidth="1.2"
      markerEnd="url(#mcp-arrow)"
    />
  );
}

function Figure({ viewBox, label, children }: { viewBox: string; label: string; children: ReactNode }) {
  return (
    <figure className="m-0 min-w-0">
      <svg viewBox={viewBox} className="block w-full text-foreground" role="img" aria-label={label}>
        <defs>
          <pattern id="mcp-dots" width="12" height="12" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="var(--border)" />
          </pattern>
          <marker id="mcp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L8 4L0 8z" fill="var(--muted-foreground)" />
          </marker>
        </defs>
        <rect width="100%" height="100%" rx="6" fill="url(#mcp-dots)" />
        {children}
      </svg>
      <figcaption className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/** Right-edge and left-edge anchor points of a card at (x, y). */
const right = (x: number, y: number): [number, number] => [x + CARD_W, y + CARD_H / 2];
const left = (x: number, y: number): [number, number] => [x, y + CARD_H / 2];

/**
 * Two figures in the canvas's own vocabulary (spec § D2 diagram). Figure 1:
 * one schema projection, three consumers, the same result. Figure 2: the
 * write path from an agent host to the journal. Pure SVG, theme through the
 * app's CSS variables; only the rails are literal colours.
 */
export function McpDiagram() {
  // Figure 1 — audience symmetry. Projection left, consumers right.
  const P: [number, number] = [16, 64];
  const C1: [number, number] = [236, 12];
  const C2: [number, number] = [236, 64];
  const C3: [number, number] = [236, 116];
  // Figure 2 — the write path, left to right.
  const W = [16, 132, 248, 364, 480].map((x) => [x, 14] as [number, number]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Figure viewBox="0 0 360 168" label="One projection, three readers">
        <Card x={P[0]} y={P[1]} title="@arkaik/schema" subtitle="computeDeliveryItems" rail="zinc" />
        <Card x={C1[0]} y={C1[1]} title="Delivery page" subtitle="the board" rail="blue" />
        <Card x={C2[0]} y={C2[1]} title="arkaik CLI" subtitle="arkaik log" rail="amber" />
        <Card x={C3[0]} y={C3[1]} title="MCP tool" subtitle="get_backlog" rail="teal" />
        <Edge from={right(...P)} to={left(...C1)} />
        <Edge from={right(...P)} to={left(...C2)} />
        <Edge from={right(...P)} to={left(...C3)} />
      </Figure>
      <Figure viewBox="0 0 604 68" label="The write path">
        <Card x={W[0][0]} y={W[0][1]} title="Agent host" subtitle="Claude Code" rail="violet" />
        <Card x={W[1][0]} y={W[1][1]} title="arkaik-mcp" subtitle="update_node" rail="teal" />
        <Card x={W[2][0]} y={W[2][1]} title="Store" subtitle="repo · hosted" rail="amber" />
        <Card x={W[3][0]} y={W[3][1]} title="Validator" subtitle="hard gate" rail="green" />
        <Card x={W[4][0]} y={W[4][1]} title="Journal" subtitle="append only" rail="blue" />
        {W.slice(0, -1).map((from, i) => <Edge key={i} from={right(...from)} to={left(...W[i + 1])} />)}
      </Figure>
    </div>
  );
}
```

- [x] **Step 3: The preview**

Create `components/landing/previews/McpServerPreview.tsx`:

```tsx
import mcpCall from "@/lib/landing/generated/mcp-call.json";
import { CodeBlock, type CodeLine } from "@/components/landing/previews/CodeBlock";
import { McpDiagram } from "@/components/landing/previews/McpDiagram";

/** Keys of each returned node summary worth the frame's width. */
const SHOWN_KEYS = ["id", "title", "species", "status"] as const;

/**
 * The diagram on the left; on the right the one real tool call
 * `scripts/generate/generate-landing-samples.js` made against the self-map
 * and the response the server returned, trimmed to the fields that read.
 */
export function McpServerPreview() {
  const request: CodeLine[] = [
    { text: `tools/call ${mcpCall.tool}`, kind: "muted" },
    ...JSON.stringify(mcpCall.arguments, null, 2).split("\n").map((text) => ({ text })),
  ];
  const nodes = (mcpCall.result.nodes as Array<Record<string, unknown>>).map((node) =>
    Object.fromEntries(SHOWN_KEYS.filter((key) => key in node).map((key) => [key, node[key]])),
  );
  const response: CodeLine[] = [
    { text: `${mcpCall.result.total} matching · ${nodes.length} returned`, kind: "muted" },
    ...JSON.stringify(nodes, null, 2).split("\n").map((text) => ({ text })),
  ];
  return (
    <div className="grid h-full gap-4 overflow-hidden p-4 lg:grid-cols-[1.2fr_1fr]">
      <McpDiagram />
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <CodeBlock title="request" lines={request} />
        <CodeBlock title="response" lines={response} className="min-h-0 flex-1" />
      </div>
    </div>
  );
}
```

`registry.tsx` — import and add `"mcp-server": McpServerPreview,` (a component that ignores `bundle` is still a valid `ComponentType<PreviewProps>`).

> If `mcpCall.result.total` is not a field of the generated response, read the sample and use whatever count it carries, or drop that line.

- [x] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run lint && npm run test:landing` — green.

```bash
git add components/landing/previews/McpDiagram.tsx components/landing/previews/McpServerPreview.tsx components/landing/previews/ids.ts components/landing/fixtures.ts components/landing/content.ts components/landing/previews/registry.tsx
git commit -m "landing: the MCP diagram and a real tool call"
```

---

### Task 8: D3 — the prompt builder preview

**Files:**
- Create: `components/landing/previews/client/ReadOnlyUseCasePicker.tsx`, `components/landing/previews/PromptBuilderPreview.tsx`
- Modify: `ids.ts`, `fixtures.ts`, `content.ts`, `registry.tsx`

- [x] **Step 1: Catalogue, fixture, copy**

`PREVIEW_IDS` += `"prompt-builder"`; `PREVIEW_META`:

```ts
  "prompt-builder":    { source: "pebbles",  height: 440, breadcrumb: ["Generate"],              journal: false },
```

`FIXTURES`:

```ts
  "prompt-builder": { source: "pebbles" }, // reads only the project title
```

`SECTIONS` += :

```ts
  {
    id: "prompt-builder", part: "agents", title: "Start from a prompt", preview: "prompt-builder",
    why: "An empty map is the hardest one to start.",
    what: "A prompt builder that turns a pitch, an existing plan or a map you already have into a first bundle, for whichever model you use.",
    how: "The generated output goes through the same schema validation as everything else before it is imported, so a hallucinated field never lands.",
  },
```

- [x] **Step 2: The client wrapper**

Create `components/landing/previews/client/ReadOnlyUseCasePicker.tsx`:

```tsx
"use client";

import { UseCasePicker } from "@/components/generate/UseCasePicker";
import type { ComponentProps } from "react";

/** `UseCasePicker` requires `onSelect`; the no-op lives on the client side of the RSC boundary. */
export function ReadOnlyUseCasePicker(props: Omit<ComponentProps<typeof UseCasePicker>, "onSelect">) {
  return <UseCasePicker {...props} onSelect={() => {}} />;
}
```

- [x] **Step 3: The preview**

Create `components/landing/previews/PromptBuilderPreview.tsx`:

```tsx
import { CodeBlock } from "@/components/landing/previews/CodeBlock";
import { ReadOnlyUseCasePicker } from "@/components/landing/previews/client/ReadOnlyUseCasePicker";
import type { PreviewProps } from "@/components/landing/previews/types";
import { assemblePrompt } from "@/lib/prompts/assemble";
import type { UseCase } from "@/lib/prompts/types";

const SELECTED: UseCase = "from-pitch";
/** How much of the assembled prompt the frame shows before it fades. */
const EXCERPT_LINES = 16;

/**
 * The generate page's use-case picker with one case selected, and the head of
 * the prompt `assemblePrompt` really builds for it. The pitch is the Pebbles
 * project's own description; nothing here is marketing copy.
 */
export function PromptBuilderPreview({ bundle }: PreviewProps) {
  const prompt = assemblePrompt({
    useCase: SELECTED,
    projectTitle: bundle.project.title,
    projectDescription: bundle.project.description,
    platforms: ["ios", "web", "android"],
    defaultStatus: "idea",
    pitch: bundle.project.description ?? bundle.project.title,
    depth: "standard",
    includeSchema: false,
    includeExample: false,
  });
  const lines = prompt.split("\n").slice(0, EXCERPT_LINES).map((text) => ({ text }));
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      <ReadOnlyUseCasePicker selected={SELECTED} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <CodeBlock title="prompt" lines={lines} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
      </div>
    </div>
  );
}
```

> Read `lib/prompts/types.ts` before writing: use the real `Depth` value (`DEPTH_OPTIONS`) and the real `PromptConfig` flag names for skipping the schema and example blocks (`includeSchema` / `includeExample` per `lib/prompts/assemble.ts`). `bundle.project.description` may be optional on `ProjectRecord`; if the field is named differently, use the right one.

`registry.tsx` — import and add `"prompt-builder": PromptBuilderPreview,`.

- [x] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run lint && npm run test:landing` — green.

```bash
git add components/landing/previews/client/ReadOnlyUseCasePicker.tsx components/landing/previews/PromptBuilderPreview.tsx components/landing/previews/ids.ts components/landing/fixtures.ts components/landing/content.ts components/landing/previews/registry.tsx
git commit -m "landing: the prompt builder preview closes the agents chapter"
```

---

### Task 9: Visual verification, docs, PR

**Files:**
- Modify: `docs/architecture.md` (landing section, if Part 2 added one: list the new previews and the `pilot-audit` source), `README.md` component map if it lists landing previews.
- Scratchpad: `smoke-landing.mjs` (exists; extend the expected frame count).

- [x] **Step 1: Smoke run**

With the dev server on 4242 (`nohup npm run dev > <scratchpad>/dev.log 2>&1 &` if not running; never pipe through `head`), run the scratchpad `smoke-landing.mjs`. Expected: `frames=14`, `unavailable=0`, `page errors: 0`, no horizontal scroll at 390. Open the three screenshots and check: C1 shows three score cards and five criteria rows with level meters; C2 shows three finding cards (one resolved with the check glyph) and two feed rows with real text (not `quality.signal.tripped`); D1 three code blocks with coloured +/- lines and `Result: VALID`; D2 the two diagrams on the dot grid, dark mode too; D3 the picker with the first card pressed and a prompt excerpt fading out.

Fix anything off, commit as `landing: polish after smoke`.

- [x] **Step 2: Docs**

Add the five previews, `CodeBlock`, `McpDiagram`, the `pilot-audit` source, the quality fixture and `scripts/generate/generate-landing-samples.js` to wherever Part 2 documented the landing architecture. Commit `docs: landing quality and agents chapters`.

- [x] **Step 3: Full gates, push, PR**

Run: `npm run generate && git status --short` (clean apart from nothing), `npm run typecheck && npm run lint && npm run test:landing && npm run test:root-redirect`.

```bash
gh stack push
gh stack submit --auto
gh stack view --json
```

Then edit the new PR: title "Marketing page 3: quality and agents chapters", body summarising the five previews, the illustrative fixture, the generated samples and the describer change; add the `no-lab-note` label (the Lab Note ships with Part 4). Read the PR comments after a minute; watch CI (`gh pr checks <n> --watch`).

---

## Self-review

- **Spec coverage.** C1 `QualityGallery` → replaced by a flex row (wheel trap; noted in Ground rules). C2 `FindingsBoard` + tripped-signal `FeedRow` ✔ (Task 2 makes the row readable). D1 diff-styled block with code left, patch + event right ✔ plus the real validator run. D2 diagram in canvas vocabulary + real tool call ✔ (`mcp-diagram`/`mcp-call` merged into one preview id `mcp-server`, since a section has one preview). D3 picker + truncated `assemblePrompt` ✔. Generated samples script joins the `generate` family and the CI drift diff ✔. Quality fixture parsed by the schema in the landing test ✔. Error handling: fixture ids pinned, frame boundary already exists ✔.
- **Types.** `PreviewSource` gains `pilot-audit`; every `Record<PreviewSource, …>` (`SOURCE_CAPTION`, `loadLandingSeeds`) is updated in Task 1. `PREVIEW_IDS` grows by one per task with matching `PREVIEW_META`, `FIXTURES`, registry entries, so tsc stays green per commit. `CodeLine`/`CodeBlock` defined in Task 6, consumed in 7 and 8.
- **Loader.** Only `quality-fixture.ts` joins the plain-node loader; it has no runtime `@/` imports.
