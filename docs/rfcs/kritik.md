---
title: "RFC: Kritik (quality layer)"
navTitle: "RFC: Kritik"
order: 91
---

# RFC: Kritik — a quality audit layer for the Arkaik graph

> Status: **Open proposal with a working pilot.** This RFC proposes Kritik as a first-class Arkaik capability and an installable per-project plugin. It is not committed to a build; it makes a recommendation and hands the implementation off in a companion issue.
>
> Evidence: the framework in this RFC was authored and run as a real audit of the [Pebbles](https://github.com/alexisbohns/pbbls) monorepo (five surfaces, 88 criteria, 338 assessments, 246 findings). The design below was validated against the real `@arkaik/schema` (`packages/schema/src/`, bundle format v3) and the real Pebbles bundle (`docs/arkaik/bundle.json`, 460 nodes / 1001 edges). See [`kritik/pilot-pbbls.md`](./kritik/pilot-pbbls.md).

## Summary

Kritik turns a quality audit framework into an Arkaik capability. A product declares a **profile** (its surfaces and domain weights), pins a versioned **criteria library**, and records **assessments** (a maturity level per criterion per surface, with evidence) and **findings** (defects with risk and cost). Arkaik renders the comparative matrix, tracks findings through a lifecycle, and accumulates quality history from `quality.*` **journal events** — the same append-only spine every other Arkaik feature derives from. It ships two ways, matching the toolchain's existing dual channel: a **marketplace plugin** (`kritik@arkaik`) that an agent installs into any repo, and a first-class **app feature** (a Quality page beside Delivery and Acceptances).

The one-line reason this belongs in Arkaik: **an acceptance is a testable promise with a per-platform status; a criterion assessment is a testable quality promise with a per-surface score.** Kritik is the acceptance machinery pointed at the code's health instead of its behavior.

## Base material in this PR

This RFC ships with everything a fresh implementer needs. Read them in this order:

| File | What it is |
| --- | --- |
| [`kritik.md`](./kritik.md) (this file) | The integration design: vocabulary, the two lanes, the data model, the plugin, the UI, the CLI/MCP surface |
| [`packages/kritik-library/SPEC.md`](../../packages/kritik-library/SPEC.md) (MIT) | The reusable meta-model: entities, the 0-4 maturity scale, risk = impact x likelihood, cost, priority, roll-up and cap rules |
| [`packages/kritik-library/framework.json`](../../packages/kritik-library/framework.json) (MIT) | The reference criteria pack: 88 criteria across 11 domains, the seed pack the plugin ships (Pebbles-authored, product-agnostic wording) |
| [`kritik/pilot-pbbls.md`](./kritik/pilot-pbbls.md) | The proof: the Pebbles audit results (the matrix, the headline findings), evidence the framework produces real signal on a real project |

The implementation handoff (scope, milestones, acceptance) is the companion issue this PR links.

## 1. Why Arkaik is the right home

Three structural facts make this a graft, not a bolt-on:

1. **The acceptance species is Kritik's structural twin.** An acceptance is a testable promise (one Given/When/Then) with per-platform status, linked by `covers` edges to the views and flows it proves. A criterion assessment is a testable quality promise with a per-surface score. The acceptance matrix page, the platform-status rollup machinery (`lib/utils/platform-status.ts`), and the delivery board's `(node x platform)` projection are all precedents Kritik reuses, with `(criterion x surface)` cells instead.
2. **The journal is forward-compatible by design.** `JournalEventSchema.type` is an open string ("the v1 vocabulary ... or an unknown forward-compatible value", `packages/schema/src/journal-events.ts`), so `quality.*` events parse, round-trip, and archive correctly in today's Arkaik without any change. Monitoring can start shipping events before any UI exists to render them.
3. **Metadata round-trips unknown keys.** `ProjectMetadata` and `NodeMetadata` are `catchall(unknown)` (`packages/schema/src/bundle.ts`), so a `kritik` key survives import, export, Synk, and Publik in current Arkaik untouched. Lane 1 rides entirely on these two guarantees.

## 2. Vocabulary: surfaces are not platforms

Arkaik `PLATFORM_IDS = ["web", "ios", "android"]` names where a view ships. Kritik audits **surfaces**: independently assessable bodies of code. Pebbles has five (`web`, `ios`, `android`, `admin`, `supabase`); the first three map onto Arkaik platforms, the last two (an operator back-office, a database contract) do not, because they are audit targets, not user platforms.

**Decision: surfaces are a Kritik-local vocabulary declared in the project's profile, with an optional `platform` mapping per surface.** `PLATFORM_IDS` is not extended: polluting the view-shipping vocabulary with `supabase` would corrupt delivery boards and platform rollups. Where a surface maps to a platform, Kritik UI can cross-link (a `SEC` finding on `ios` decorating iOS view variants); unmapped surfaces render only on Kritik pages.

```jsonc
"surfaces": [
  { "id": "web",      "title": "Web app",  "platform": "web" },
  { "id": "ios",      "title": "iOS",      "platform": "ios" },
  { "id": "android",  "title": "Android",  "platform": "android" },
  { "id": "admin",    "title": "Admin back-office" },
  { "id": "supabase", "title": "Database contract" }
]
```

This surface list is per-project, chosen at install time. A single-surface web app declares one surface; a monorepo declares many. **Surface selection is the plugin's first install decision** (see §6).

## 3. Lane 1: today, zero schema change

Everything here works against current Arkaik. Pebbles adopts it in [pbbls#738](https://github.com/alexisbohns/pbbls/pull/738).

### 3.1 The library sidecar

The criteria library (scales, domains, criteria, profiles) lives as a repo file and is referenced from, not embedded in, the bundle:

```jsonc
// project.metadata (catchall-preserved today)
"kritik": {
  "framework": "docs/quality/library/framework.json",
  "framework_version": "0.1.0",
  "last_audit": { "id": "2026-08", "commit": "<sha>", "path": "docs/quality/audits/2026-08/" }
}
```

### 3.2 Journal events (forward-compatible `quality.*` vocabulary)

Envelope identical to every other event (`id` ULID, `ts`, optional `actor`). Proposed v1 grammar:

| Event | Payload (beyond envelope) | Emitted when |
| --- | --- | --- |
| `quality.audit.completed` | `audit_id`, `framework_version`, `commit`, `scores: {surface: {domain: score0to100}}`, `counts: {critical, high, medium, low}` | An audit run lands |
| `quality.finding.opened` | `finding_id`, `criterion_id`, `surface`, `severity`, `priority`, `title`, `node_ids?`, `issue_url?` | A finding is retained (post-verification) |
| `quality.finding.resolved` | `finding_id`, `resolved_by` (PR/commit URL), `node_ids?` | The fix merges |
| `quality.signal.tripped` | `criterion_id`, `surface`, `signal`, `detail` | A monitoring signal fails between audits |

Design rules match the existing grammar: events are facts, not state (current state is a projection: latest `audit.completed` plus open-minus-resolved findings); `node_ids` ties a finding to the product graph exactly as `deliverable.shipped` already does; payloads stay small (full evidence lives in the audit files, the event carries identity and severity).

### 3.3 Graph linkage without new species

A finding about a mappable feature attaches to its node(s) two existing ways: `node_ids` on the events above, and, once filed as a GitHub issue, a `refs` entry (`type: "github-issue"`) on the node. Both are fully supported today. The rendered effect in current Arkaik: the issue appears on the node's references; the quality events sit in the raw history. Silent, lossless, upgrade-ready.

### 3.4 Monitoring loop (works with today's tooling)

1. **Per-audit:** an agent (or an agent army, as in the pilot) runs the framework, writes `scores.json` and `findings.json`, appends `quality.audit.completed` plus one `quality.finding.opened` per retained finding to `docs/arkaik/journal.jsonl`, and files issues from the templates.
2. **Between audits:** each criterion's `signals[]` is mechanically checkable (greps that must return nothing, CI jobs that must exist). A scheduled job (CI cron or a Claude routine) runs the signal pack and appends `quality.signal.tripped` on regressions.
3. **On merge:** the existing Arkaik GitHub App webhook already appends `deliverable.shipped` per merged PR; a PR closing a quality issue appends `quality.finding.resolved` (lane 1: a small workflow step greps the PR body for `finding_id`; lane 2: the webhook grows native support).

## 4. Lane 2: first-class Kritik (the app feature)

### 4.1 Data model: a `quality` bundle section, not a seventh species

Criteria and assessments must not become graph nodes: 88 criteria x surfaces would drown a 460-node product graph, and criteria are library content (project-independent). The bundle already models this precedent, `maps` and `products` live in `project.metadata`, not as nodes. Following it, plus one top-level section for project-owned quality state:

```ts
// packages/schema/src/quality.ts (new, additive; schema_version stays 3,
// older readers preserve the key via catchall)
interface QualityAssessment {
  criterion_id: string;          // "SEC-01", resolved against the imported library
  surface: string;               // profile surface id
  level: 0 | 1 | 2 | 3 | 4;      // maturity; N/A = row absent
  evidence: string;              // file:line / config citations, markdown
  audit_id: string;              // "2026-08"
  commit?: string;
  ts: string;                    // ISO 8601
}
interface QualityFinding {
  id: string;                    // "F-2026-08-SEC-web-01"
  criterion_id: string; surface: string;
  title: string; detail: string; evidence: string;
  impact: 1|2|3|4|5; likelihood: 1|2|3|4|5;   // severity/priority are DERIVED
  cost: "S"|"M"|"L"|"XL";
  status: "open" | "resolved" | "refuted" | "accepted-risk";
  node_ids?: string[]; issue_url?: string;
  verification?: { verdict: "CONFIRMED"|"REFUTED"|"DOWNGRADED"; note: string };
}
interface QualitySection {
  framework_version: string;
  library?: KritikLibrary;       // embedded on export; repos may keep it as a sidecar
  profile: { surfaces: SurfaceDef[]; domain_weights: Record<string, number> };
  assessments: QualityAssessment[];   // latest per (criterion x surface); history in journal
  findings: QualityFinding[];
}
// ProjectBundle gains: quality?: QualitySection
```

Derived values (severity buckets, P0-P3, domain scores, grades, caps) are **projections in `@arkaik/schema`** (`deriveQualityMatrix(bundle)`), exactly as delivery and backlog are journal projections today. Stored data stays minimal and un-fake-able. The pilot ships a reference implementation of these projections as `docs/quality/scripts/compute-matrix.mjs`; porting it into `@arkaik/schema` is most of the schema work.

### 4.2 The library as a distributable pack

The criteria library ships like the seed example ships: a versioned JSON pack. The pack in [`packages/kritik-library/framework.json`](../../packages/kritik-library/framework.json), 11 domains, product-agnostic wording, calibrated to the Next.js / SwiftUI / Compose / Supabase stack class, is the first pack. Projects pin a pack version; criteria are append-and-supersede (`superseded_by`), so matrices stay comparable across audits. **Projects may add their own criteria** on top of the pinned pack (custom domains, custom criteria, custom issue skeletons); see §6.

### 4.3 UI

- **Quality page** (sibling of Delivery and Acceptances): the comparative matrix, rows domains, columns profile surfaces, cells `score (grade)` colored by band, cap asterisks, trend arrows versus the previous `quality.audit.completed`. Click a cell to get the criterion list with per-criterion levels; click a criterion for a detail panel (question, anchors, references, checklist, evidence), the same panel-stack pattern as node details. The pilot ships a standalone reference rendering of exactly this (`docs/quality/audits/2026-08/dashboard.html`).
- **Findings board**: findings by priority lane (P0-P3), severity chips, linked nodes, issue refs; `accepted-risk` requires a note (rendered like a decision-log entry).
- **Node decoration**: a node with open findings shows a severity badge (as `blocked_by` badges do today); the overview dashboard gains a quality gauge per surface beside the existing coverage gauges.

### 4.4 CLI / MCP (the agent loop)

```
arkaik kritik score   <criterion> <surface> <level> --evidence <text|file>
arkaik kritik finding open|resolve|accept ...
arkaik kritik matrix  [--json]          # derived matrix, CI-friendly
arkaik kritik signals [--surface s]     # run the library's signal pack, exit code
arkaik kritik issue   <criterion> --surface s   # emit prefilled issue markdown
arkaik kritik criterion add             # scaffold a custom criterion + issue skeleton
```

MCP tools mirror these (`kritik_score`, `kritik_open_finding`, ...) through the same validated mutation path as existing tools, which is what makes **scheduled agent audits** a first-class monitoring feature: a routine wakes, runs `kritik signals`, audits deltas since the last audited commit, scores through MCP, and the journal accumulates the quality history the UI renders as trends.

### 4.5 Validation rules (additive)

`validateBundle` gains warnings (never import-blocking, per Arkaik's leniency doctrine): unknown `criterion_id` against the pinned library; assessment surface absent from the profile; finding with `status: open` older than N audits; a `quality.*` event whose `finding_id` never appeared in a `finding.opened`.

## 5. Distribution: the marketplace plugin

Kritik follows the exact pattern the `arkaik` skill already uses (`plugin/README.md`): a second marketplace entry alongside the graph-map plugin.

```
.claude-plugin/marketplace.json     # gains a second entry: { name: "kritik", source: "./plugin-kritik" }
plugin-kritik/
  .claude-plugin/plugin.json          # generated
  skills/kritik/SKILL.md              # the audit + scoring skill (generated from docs/kritik-skill/)
  skills/kritik/references/
    framework.md                        # the meta-model (generated from packages/kritik-library/SPEC.md)
    library.json                        # the seed criteria pack (generated from the canonical pack)
  scripts/
    compute-matrix.js                   # roll-up projection (generated from @arkaik/schema)
    scaffold-criterion.js               # custom-criterion + issue-skeleton generator
```

Install mirrors the existing skill exactly:

```
/plugin marketplace add alexisbohns/arkaik
/plugin install kritik@arkaik
```

Same single-source-of-truth discipline: nothing under `plugin-kritik/` is hand-edited; `npm run generate` regenerates it from canonical `docs/` sources, and CI fails on drift, exactly as it does for the `arkaik` plugin today.

## 6. Per-project install: surface selection and custom criteria

The two capabilities the handoff must deliver, and how they fit the model above.

**Surface selection.** Installing Kritik into a repo writes a project-local profile (`docs/quality/profile.json`, or the `quality.profile` bundle section in lane 2): the surface list with optional `platform` mappings, plus domain weights. This is the `arkaik init` render pattern applied to Kritik: the plugin ships the generic pack, and install localizes the profile. A single-surface app selects one surface and every `(criterion x surface)` cell collapses to one column; a monorepo selects many. `applies_to` on each criterion intersects with the selected surfaces to produce the audit's cell set.

**Custom criteria with custom issue skeletons.** A project extends the pinned pack with its own criteria in a project-local overlay (`docs/quality/criteria.custom.json`), merged over the pack at load. A custom criterion carries the same shape as a pack criterion (id in a project-reserved namespace, e.g. `X-...`; definition; 0-4 anchors; `applies_to`; references; checklist; signals; and its own `issue` skeleton). `arkaik kritik criterion add` scaffolds one interactively and writes both the criterion and its issue skeleton. Custom criteria roll up into their domain (or a project-defined domain) exactly like pack criteria; they are never overwritten by a pack upgrade because they live in the overlay, not the pinned pack.

This keeps the pack canonical and upgradeable while making every project's Kritik genuinely its own.

## 7. Adoption path

| Step | Where | What |
| --- | --- | --- |
| 1 (done) | pbbls | Library + first audit + templates under `docs/quality/`; the framework proven on a real product ([pbbls#738](https://github.com/alexisbohns/pbbls/pull/738)) |
| 2 (this PR) | arkaik | This RFC + the reference pack + the pilot evidence land as base material; the handoff issue scopes the build |
| 3 | arkaik | `quality.ts` + `deriveQualityMatrix` projections in `@arkaik/schema` (additive); `quality.*` journal events in the vocabulary |
| 4 | arkaik | The `kritik` marketplace plugin: skill + seed pack + scaffold script; surface-selection install; custom-criteria overlay |
| 5 | arkaik | Quality page + findings board reading the section; webhook grows `quality.finding.resolved`; the signal-pack runner |
| 6 | pbbls | Switch from sidecar-only to the first-class section; delete nothing (the journal already carries the history) |

## 8. Open questions

1. **Library governance**: one canonical pack evolving by PR, or per-org forks? Recommendation: canonical pack plus the project-local overlay of §6, mirroring how `products` stay project-local.
2. **Score authority**: should MCP-written scores require an `actor` distinguishing human / agent / CI, so trends can be filtered by assessor kind? Recommendation: yes; the envelope's `actor` field already exists.
3. **Publik exposure**: are quality matrices part of a public snapshot? Recommendation: excluded by default (a security matrix is a roadmap for attackers); needs an explicit opt-in flag.
4. **Cross-project rollup**: Ariko-level aggregation (a portfolio quality pulse over the pollen feed) is attractive but out of scope for v1; `quality.audit.completed` is deliberately shaped to be feed-summarizable later.
