---
title: "Spec: Bundle Format v2"
navTitle: "Bundle Format"
order: 1
icon: package
---

# Bundle Format v2

> Status: **Implemented** — v2 is the published contract at `public/schema/project-bundle.json`, generated from the canonical zod source in `packages/schema` ([toolchain.md](toolchain.md)). Implemented behavior is documented in [data-layer.md](../data-layer.md). This document remains the normative contract.
> The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119.

## Overview

A **ProjectBundle** is the interchange unit of the arkaik format: one JSON document carrying a project, its nodes, and its edges. Version 2 makes the format *versioned* and *extensible* while keeping every v1 bundle valid.

```ts
interface ProjectBundle {
  schema_version?: number;   // v2: contract version; absent means 1
  project: Project;
  nodes: Node[];
  edges: Edge[];
  journal?: JournalEvent[];  // v2: embedded interchange projection only — see spec/journal.md
}
```

Node, Edge, Project, playlist, platform, and status semantics are unchanged from v1 — see [graph-model.md](../graph-model.md) and the type definitions in `lib/data/types.ts`. v2 is strictly additive.

## Schema Versioning

| Rule | Detail |
|---|---|
| Field | `schema_version` (integer) at the bundle root |
| Absent | Consumers MUST treat a missing `schema_version` as `1` — every existing bundle remains valid |
| Reading newer | A consumer encountering a version above what it supports SHOULD import what it understands and MUST preserve unknown fields on re-export (no silent stripping) |
| Reading older | Consumers MUST migrate older versions through an explicit chain (today's implicit legacy handling in `normalizeBundle()`, `lib/data/local-provider.ts`, becomes step one of that chain) |
| Bumping | The version increments only for changes that alter how existing fields must be interpreted. Purely additive optional fields do not require a bump — with one exception below |

**Why v2 requires an explicit bump even though it is additive:** the published v1 JSON Schema declares `additionalProperties: false` on the bundle root and on `Project`. Any bundle carrying `schema_version`, `journal`, or `project.version` is *non-conformant to v1 by construction*. The v2 JSON Schema (generated from the canonical source, see [toolchain.md](toolchain.md)) relaxes this to "unknown fields are allowed and preserved."

**v3: status vocabulary overhaul** (`discovery` added; `prioritized`/`blocked` removed; `blocked_by` metadata; old `backlog` → `idea`). Migration stamps `schema_version: 3`.

**Known consumer defect to fix before v2 ships:** `rewriteBundleProjectId` (`lib/utils/export.ts`) reconstructs imported bundles as `{ project, nodes, edges }` and silently drops any other top-level key when an imported project's ID collides locally. All import paths MUST round-trip unknown fields.

## Project Additions

```ts
interface Project {
  // ... unchanged v1 fields (id, title, description?, root_node_id?, metadata?, timestamps)
  version?: string;          // v2, Level 1: current version label, e.g. "1.4.0" or "2026-07"
}
```

`project.version` is the *current* version label of the mapped product (free-form string; semver recommended, not required). Version *history* lives in the journal as `release.tagged` events — a Level 1 bundle carries only the label.

## Products

A project describes a *family* of apps sharing one graph — an end-user app, a web-only back office, a public API — not a single product with three platforms. A **product** names one app in that family and the platforms it can ship on:

```ts
interface ProductDefinition extends Record<string, unknown> {
  id: string;                // kebab-case, unique within the project
  title: string;
  description?: string;
  platforms: PlatformId[];   // the menu this product may ship on; MAY be []
  root_node_id?: string;     // this product's journey anchor
}
```

Definitions live at **`project.metadata.products: ProductDefinition[]`**, following the `project.metadata.maps` precedent ([maps.md](maps.md) § Storage) exactly: a purely additive optional field in an already-`catchall` object, so it requires **no `schema_version` bump**, and unknown fields on a definition are preserved and ignored.

A definition **declares** a product when its `id` is a non-blank string; `resolveProducts` drops everything else, and a dropped entry declares nothing. The two dropped shapes are reported in different places, by design. An `id` that is **missing or not a string** is a shape fault — `id` is required, so the parser rejects such a bundle and `validateBundle()` stays silent rather than repeating the rejection. An `id` that parses as a string but is **blank or whitespace-only** is well-shaped and reaches the validator, which reports it as `product-invalid-id` (§ Validation below). Duplicate ids resolve **first-wins**, so every projection stays deterministic on a bundle the validator has already warned about.

### Membership

| Species | Membership |
|---|---|
| `flow`, `view`, `acceptance` | **Stored** in `node.metadata.product` — one product `id` |
| `data-model`, `api-endpoint` | **Derived** from consumers; producers MUST NOT store `metadata.product` |

Shared substrate is the norm, so the system layer never claims a product of its own. Derived membership walks outward from **every node that stores membership** along `calls` / `displays` / `queries` edges, following each edge **in its stored direction** and hopping only into `data-model` and `api-endpoint` targets; every node so reached is used by that product. (In practice the walk starts at flows and views: `edge-semantics` admits none of those three edge types out of an acceptance, so an acceptance seeds nothing.) `productsUsingNode` (`@arkaik/schema`) is a lookup into an index built once per snapshot, never a per-card traversal.

Both restrictions are load-bearing. Following each edge in its stored direction keeps the walk pointed *down* into the system layer: the Journey renderer projects a `calls` edge sourced at an api-endpoint as a View's inbound/read affordance ([graph-model.md](../graph-model.md) § Edge Types), and a direction-blind walk would follow exactly that shape back up into another product's views. And any *undirected* formulation is all-pairs within a connected component, which would make a data model that only Admin touches report as used by the end-user app merely because the two products share some other model.

A node reached by no consumer belongs to no product. Consumers scoping by product MUST still show such orphans under every scope rather than hiding them — burying the nodes that most need attention is the failure mode this format exists to end ([maps.md](maps.md) § Orphans).

### Platforms

`node.platforms` stays authoritative; every existing projection keeps reading it unchanged. A product's `platforms` is a **menu**, and a node's list SHOULD be a subset of its product's. A violation is a **warning, never an error**, because the menu is edited independently of the node: narrowing Admin from `[web, ios]` to `[web]` is a product decision, and it MUST NOT fail CI on nodes nobody touched.

Readers intersect rather than trust: `effectiveNodePlatforms(node, product)` returns `node.platforms ∩ product.platforms` in `PLATFORM_IDS` order, so an out-of-menu platform drops out of the display instead of corrupting it — which is exactly why an error would buy no safety the intersection does not already provide.

`platforms: []` means availability is not a tracked dimension for this product (a CLI, a public API). Such a product carries a **single lifecycle status**: the intersection above is empty for every node in it, so there is no per-platform breakdown to render.

### The degenerate case

A bundle with **no `products` key behaves exactly as it did before products existed**: one implicit product spanning `PLATFORM_IDS`, every node in it, no warnings, and no migration. `productPlatforms(project, productId)` states the whole rule — a project declaring no products returns `PLATFORM_IDS`; `null` (All products) returns the union of every declared menu; a product id returns that product's own menu; and an unknown id resolves like `null`, because a stale scope MUST degrade rather than throw.

`MapDefinition.product` scopes a stored map to one product ([maps.md](maps.md) § MapDefinition), so "the therapist app map" is data rather than a parallel mechanism.

### Validation

Product findings are reported by `validateBundle()` at **warning severity only**, matching stored maps ([maps.md](maps.md) § Validation): a stale definition or a dangling membership must never fail an import or a CI gate. `validateBundle().valid` stays `true` for every finding below.

| Rule id | Severity | Fires when |
|---|---|---|
| `product-duplicate-id` | `warning` | Two stored definitions share an `id`; resolution is first-wins. Read from the stored array itself, so it needs no valid declaration |
| `product-invalid-id` | `warning` | A stored `id` is not kebab-case. A blank id is reported here and does **not** count as a declaration — it must not switch the gated rules on and bury the real problem |
| `product-unknown-reference` | `warning` | `node.metadata.product` names no declared product — **regardless of whether the project declares any** |
| `product-membership-wrong-species` | `warning` | `metadata.product` on any species other than flow, view, or acceptance — **regardless of whether the project declares any** |
| `product-platform-not-in-menu` | `warning` | `node.platforms ⊄ product.platforms`, for a node whose membership names a declared product |
| `unassigned-membership` | `warning` | A flow or view carries no membership, in a project that declares products |
| `acceptance-product-unassigned` | `warning` | An acceptance covers nothing *and* names no product, in a project that declares products. An acceptance that covers something derives its membership from the anchor |
| `acceptance-covers-span-products` | `warning` | An acceptance's `covers` anchors sit in two or more products, in a project that declares products |

**Four of the eight are ungated**, for two different reasons. `product-duplicate-id` and `product-invalid-id` read the stored array itself, so they fire wherever `project.metadata.products` exists at all — which is precisely what keeps a blank id visible instead of swallowing it. `product-unknown-reference` and `product-membership-wrong-species` are statements about a single node's own stored field, true or false regardless of project state — the same posture that leaves `gherkin-species` and `values-species` ungated. The motivating case for the latter pair is the author who writes `metadata.product` on a handful of nodes before adding `project.metadata.products`; gating them would make exactly that mistake invisible.

**The other four require at least one declared product**, because "out of menu", "unassigned", and "spans two products" say nothing until something is declared.

The invariant that holds either way, and that the test suite asserts across every species: a bundle with no `products` key and no `metadata.product` on any node raises **zero** product findings.

Absent membership is a **triage state**, not "applies everywhere" — an unassigned flow, view, or anchorless acceptance appears under "All products" only, so the warnings above read as an inbox rather than as noise duplicated into every scope. Shape faults (`products` not an array, a definition missing `title`) stay where they belong, in the parser and the JSON Schema.

## Quality (Kritik)

A project MAY carry a `quality` section: the Kritik quality layer's own state (docs/rfcs/kritik.md § 4.1). It is a top-level bundle section rather than a seventh species — 88 criteria times a handful of surfaces would drown a product graph, and criteria are library content, not product anatomy.

```ts
interface ProjectBundle {
  // ... unchanged
  quality?: QualitySection;   // additive; schema_version stays 3
}

interface QualitySection extends Record<string, unknown> {
  framework_version: string;      // the pinned criteria pack
  library?: KritikLibrary;        // embedded on export; repos may pin it as a sidecar instead
  profile: { surfaces: SurfaceDef[]; domain_weights?: Record<string, number> };
  assessments: QualityAssessment[];   // latest per (criterion x surface)
  findings: QualityFinding[];
}
```

**The section is an interchange projection, not a stored file.** The sidecars under `docs/quality/` — `profile.json`, the `criteria.custom.json` overlay, and one `audits/<id>/` directory per run — are canonical in a repository, exactly as `journal.jsonl` is canonical while `journal[]` is only what `arkaik pack` embeds for transport ([journal.md](journal.md) § Interchange). `arkaik pack` and `arkaik restore` fold those sidecars into this key while they assemble a bundle (`arkaik open` inherits `pack`'s defaults), and **`docs/arkaik/bundle.json` is never rewritten to carry it** — a `quality` section is always a projection of the tree that produced it, never a second copy to keep in step. `--no-quality` opts out on either verb; `arkaik push` opts out by default, for the reason below. The flags are in [toolchain.md](toolchain.md) § the CLI.

The fold embeds the **effective** library — the pinned pack ⊕ this project's overlay — in `library`, because a consumer has no other source for the weights it must grade with: a section without one falls back to a synthesized library where every criterion weighs 1, and renders a matrix that silently disagrees with the project's own `matrix.json`. It also drops `severity` and `priority` from every finding, since both are derived (below) and storing either is a warning.

**What is folded is current state, not one audit.** `assessments` is latest-wins per (criterion × surface) across *every* audit on disk, and `findings` pools every audit's findings — so this section answers *where does the product stand*, while `docs/quality/audits/<id>/matrix.json` and `arkaik kritik matrix` answer *how did that audit go*. The two are meant to disagree: an open Critical from an earlier audit still caps its cell here even if the newest audit never re-scored that criterion, and a partial re-audit does not empty the matrix of everything it left alone. `arkaik pack --audit <id>` pins one audit's snapshot when the roll-up's question is the one you want.

**Surfaces are not platforms.** `PLATFORM_IDS` names where a *view* ships; a Kritik **surface** is any independently assessable body of code — a database contract and an admin back-office are audit targets, not user platforms. The surface list is per-project, chosen at install, and a surface MAY carry an optional `platform` mapping where the two coincide. The reserved id `cross-surface` is the contract lens between surfaces: it holds findings only, never assessments, and never becomes a matrix column.

**Derived values are never stored.** Severity, priority, domain scores, grades, and the anti-averaging caps are projections in `@arkaik/schema` (`deriveQualityMatrix`), exactly as delivery and backlog are journal projections. A finding stores `impact`, `likelihood`, and `cost`; storing a `severity` beside them is a warning, because it lets the label drift from the numbers behind it.

**Validation is warnings only** (never import-blocking, per the leniency doctrine): an unknown or retired `criterion_id`, a surface absent from the profile, a duplicate score for one cell, an assessment with no evidence, a risk value outside 1-5, a `quality.*` event with no `actor`, a `quality.finding.resolved` or `quality.finding.accepted` for a finding nothing ever opened.

**Publik withholds it by default.** A quality section lists open, unfixed findings with the file paths to reach them, so `POST /api/publik` strips it exactly as it strips the journal, and for a sharper reason. `?include_quality=true` opts in; opting into the journal never implies it.


## Weighing

A project MAY carry a `weighing` section: the weighing layer's own state ([docs/rfcs/weighing.md](../rfcs/weighing.md)) — how much each promise is worth, according to whom, and how sure. It is a top-level section for the reason `quality` is: criteria are library content, not product anatomy, and 30 elements times every acceptance would drown a product graph.

```ts
interface ProjectBundle {
  // ... unchanged
  weighing?: WeighingSection;   // additive; schema_version stays 3
}

interface WeighingSection extends Record<string, unknown> {
  sets?: WeighingCriteriaSet[];          // the project's OWN sets — its positioning. The built-in value set is library content, not stored. Absent = []
  matrices?: WeighingMatrix[];           // the project's own matrices; empty in slice 1 (the built-in `value` matrix is not stored). Absent = []
  assessments?: WeighingAssessment[];    // latest per (matrix × subject × criterion × scorer kind). Absent = []
}

interface WeighingAssessment extends Record<string, unknown> {
  matrix: string;               // "value"
  subject: string;              // an acceptance id
  criterion: string;            // an element of value, e.g. "reduces-anxiety"
  level: number;                // -3..+3, whole numbers. 0 = weighed and unrelated. A blank cell is the ABSENCE of the row
  scorer?: { kind: "human" | "agent" | "rule"; id: string; model?: string; on_behalf_of?: string };  // absent on a hand-edited row: it wins no cell, and the validator warns
  confidence: 0 | 1 | 2 | 3;    // guess · inferred · evidenced · verified
  evidence?: string;            // markdown
  refs?: string[];
  basis?: { fingerprint?: string; commit?: string; set_version: string };
  run?: string;
  ts: string;
}
```

**The built-in library.** `value-contribution` (the 30 elements of value in their four tiers, each level −3..+3 described in words) and the `value` matrix (every acceptance against that set) ship in `@arkaik/schema` and are pinned by version, as Kritik's pack is. A project cannot redefine them (`validateBundle` warns).

**Signed, never netted.** +3 is core, +2 supports clearly, +1 touches, 0 is unrelated (weighed, and found to have nothing to do with it — no row at all means nobody has weighed it yet), −1 a small friction, −2 works against it, −3 costs it at its core. A promise's *served* (sum of positive levels ÷ 3) and *cost* (sum of |negative levels| ÷ 3) are derived separately and never combined: "serves 1.0 · costs 0.67", never "0.33".

**Who judged.** A human's level beats an agent's, which beats a rule's; the latest wins within a kind. The section keeps one row per cell *per scorer kind*, so both sit side by side. A `rule` is the **seeding rule** — the first claimed value in `metadata.values` reads +3, the second +2, every other +1, confidence 0, negatives never — and it is computed on read, never stored (a stored `rule` row is a warning). `scorer.on_behalf_of` is optional and says whom the scorer acts for: an opaque user id or handle, never an email, because sidecars are committed to repos. A hosted token write stamps the token owner's id; a writer that does not know stamps nothing.

**Staleness is computed, never stored.** An assessment records what its scorer looked at: `basis.fingerprint` is a hash of the acceptance's title, Gherkin and values (whitespace-normalised) — **not its status**, which is joined at read time — and `basis.set_version` the set's full version. A cell is stale when the fingerprint no longer matches or the set's major moved. Staleness flags a cell; it never changes which scorer wins.

**The positioning is a criteria set.** In slice 1 its id is fixed: `sets` may hold one set with `id: "positioning"`, `role: "positioning"`, `extends: "value-contribution@1"` and `status?: "draft" | "active"` (absent = active). Each criterion is `{ id, weight?, anchors? }`: how much the product stands on the element (absent = 1) and what each level means in the product's own words. A **draft feeds no roll-up**.

**Storage follows Kritik's rule exactly.** In a repository the sidecars under `docs/weighing/` — `sets/<set-id>.json` and `assessments/<matrix-id>.json` (`{ "matrix", "assessments": [] }`) — are canonical, and `arkaik pack` / `arkaik restore` fold them into this key; `docs/arkaik/bundle.json` is never rewritten to carry it. On a hosted project, and in a browser project, an assessment is a journal event (`weighing.assessment.recorded`) and a saved positioning is `weighing.set.saved`; every read folds them over the stored section latest-wins ([journal.md](journal.md)). `--no-weighing` opts out of the fold on `pack` and `restore`.

**Import never blocks, and the shapes are looser than Kritik's on purpose.** `QualitySectionSchema` refuses a malformed quality record; `WeighingSectionSchema` does not. A weighing section is filled at scale by agents and scorers, so one bad cell must never block importing a project. **Only the containers are strict: `weighing` must be an object, and each of `sets`, `matrices` and `assessments` — if present — must be an array.** Everything inside parses, whatever it holds:

- an item in a list may be anything (a `null` row, a number) and is skipped by every reader;
- every leaf is accepted as any value: a level of `"2"` or 3.5, a confidence of 4, a scorer that is a string or has no kind or id, a numeric `evidence`, `refs` that is a string, a `set_version` that is a number, a weight that is a string, a scale with no anchors, a status of `"Draft"`, a mistyped `role`;
- the keys a row is addressed by (`matrix`, `subject`, `criterion`, `ts` on an assessment; `id`, `version`, `subject` on a set; `id`, `set`, `subjects` on a matrix) are optional too — a record that lacks them **cannot be addressed**, which means the readers skip it and the validator warns, never that the import is refused;
- values survive a round trip untouched: nothing is coerced, stripped or defaulted.

The validator warns on each of these (`weighing-assessment-shape`, `-assessment-ts`, `-level-range`, `-confidence-range`, `-scorer-missing`, `-evidence-type`, `-refs-type`, `-basis-shape`, `-set-shape`, `-matrix-shape`, `-scale-shape`, `-criterion-shape`, `-section-shape`, …). **A reader goes through `resolveWeighing` (sets and matrices that pass their shape guard) and `readWeighingAssessments` (rows with string keys)** instead of reading the stored lists directly; both skip rather than throw.

**Status.** `status` on a set or matrix is any value in storage. Readers follow one rule: **absent or `"active"` is active, and any other present value — `"draft"`, `"Draft"`, `"archived"`, a non-string — counts as a draft**, so a draft feeds no roll-up even if its status is mistyped (`isActiveWeighingSet`). The validator warns on anything but `draft` and `active` (`weighing-set-status`).

**A positioning may have no `scale`.** It then uses its `extends` ruler's scale (`weighingScaleOf`); every other set needs one. A set needs a string `id` and `version` and a `criteria` array to be used at all.

**"The first wins" is true.** For two sets (or matrices) with one id, the first *well-formed* one wins and the later one is ignored with a `weighing-duplicate-set` (`-matrix`) warning; a malformed earlier entry never shadows a good later one, and is not counted as a duplicate.

**Validation is warnings only** (never import-blocking, per the leniency doctrine): an unknown or retired `criterion_id`, a surface absent from the profile, a duplicate score for one cell, an assessment with no evidence, a risk value outside 1-5, a `quality.*` event with no `actor`, a `quality.finding.resolved` or `quality.finding.accepted` for a finding nothing ever opened.

**Publik withholds it by default.** A quality section lists open, unfixed findings with the file paths to reach them, so `POST /api/publik` strips it exactly as it strips the journal, and for a sharper reason. `?include_quality=true` opts in; opting into the journal never implies it.


## Weighing

A project MAY carry a `weighing` section: the weighing layer's own state ([docs/rfcs/weighing.md](../rfcs/weighing.md)) — how much each promise is worth, according to whom, and how sure. It is a top-level section for the reason `quality` is: criteria are library content, not product anatomy, and 30 elements times every acceptance would drown a product graph.

```ts
interface ProjectBundle {
  // ... unchanged
  weighing?: WeighingSection;   // additive; schema_version stays 3
}

interface WeighingSection extends Record<string, unknown> {
  sets?: WeighingCriteriaSet[];          // the project's OWN sets — its positioning. The built-in value set is library content, not stored. Absent = []
  matrices?: WeighingMatrix[];           // the project's own matrices; empty in slice 1 (the built-in `value` matrix is not stored). Absent = []
  assessments?: WeighingAssessment[];    // latest per (matrix × subject × criterion × scorer kind). Absent = []
}

interface WeighingAssessment extends Record<string, unknown> {
  matrix: string;               // "value"
  subject: string;              // an acceptance id
  criterion: string;            // an element of value, e.g. "reduces-anxiety"
  level: number;                // -3..+3, whole numbers. 0 = weighed and unrelated. A blank cell is the ABSENCE of the row
  scorer?: { kind: "human" | "agent" | "rule"; id: string; model?: string; on_behalf_of?: string };  // absent on a hand-edited row: it wins no cell, and the validator warns
  confidence: 0 | 1 | 2 | 3;    // guess · inferred · evidenced · verified
  evidence?: string;            // markdown
  refs?: string[];
  basis?: { fingerprint?: string; commit?: string; set_version: string };
  run?: string;
  ts: string;
}
```

**The built-in library.** `value-contribution` (the 30 elements of value in their four tiers, each level −3..+3 described in words) and the `value` matrix (every acceptance against that set) ship in `@arkaik/schema` and are pinned by version, as Kritik's pack is. A project cannot redefine them (`validateBundle` warns).

**Signed, never netted.** +3 is core, +2 supports clearly, +1 touches, 0 is unrelated (weighed, and found to have nothing to do with it — no row at all means nobody has weighed it yet), −1 a small friction, −2 works against it, −3 costs it at its core. A promise's *served* (sum of positive levels ÷ 3) and *cost* (sum of |negative levels| ÷ 3) are derived separately and never combined: "serves 1.0 · costs 0.67", never "0.33".

**Who judged.** A human's level beats an agent's, which beats a rule's; the latest wins within a kind. The section keeps one row per cell *per scorer kind*, so both sit side by side. A `rule` is the **seeding rule** — the first claimed value in `metadata.values` reads +3, the second +2, every other +1, confidence 0, negatives never — and it is computed on read, never stored (a stored `rule` row is a warning). `scorer.on_behalf_of` is optional and says whom the scorer acts for: an opaque user id or handle, never an email, because sidecars are committed to repos. A hosted token write stamps the token owner's id; a writer that does not know stamps nothing.

**Staleness is computed, never stored.** An assessment records what its scorer looked at: `basis.fingerprint` is a hash of the acceptance's title, Gherkin and values (whitespace-normalised) — **not its status**, which is joined at read time — and `basis.set_version` the set's full version. A cell is stale when the fingerprint no longer matches or the set's major moved. Staleness flags a cell; it never changes which scorer wins.

**The positioning is a criteria set.** In slice 1 its id is fixed: `sets` may hold one set with `id: "positioning"`, `role: "positioning"`, `extends: "value-contribution@1"` and `status?: "draft" | "active"` (absent = active). Each criterion is `{ id, weight?, anchors? }`: how much the product stands on the element (absent = 1) and what each level means in the product's own words. A **draft feeds no roll-up**.

**Storage follows Kritik's rule exactly.** In a repository the sidecars under `docs/weighing/` — `sets/<set-id>.json` and `assessments/<matrix-id>.json` (`{ "matrix", "assessments": [] }`) — are canonical, and `arkaik pack` / `arkaik restore` fold them into this key; `docs/arkaik/bundle.json` is never rewritten to carry it. On a hosted project, and in a browser project, an assessment is a journal event (`weighing.assessment.recorded`) and a saved positioning is `weighing.set.saved`; every read folds them over the stored section latest-wins ([journal.md](journal.md)). `--no-weighing` opts out of the fold on `pack` and `restore`.

**Import never blocks, and the shapes are looser than Kritik's on purpose.** `QualitySectionSchema` refuses a malformed quality record; `WeighingSectionSchema` does not. A weighing section is filled at scale by agents and scorers, so one bad cell must never block importing a project: a level of 3.5, a confidence of 4, a scorer with an unknown kind or no id (or none at all), a matrix with no set, a set with no criteria or scale, and a section with some of its lists absent (read as empty) all parse, and the validator warns about each. Only what a record cannot be addressed without stays required (`matrix`, `subject`, `criterion`, `ts` on an assessment; `id` on a set or matrix). A reader must still tolerate a value the validator warned about: `resolveWeighing` skips a set or matrix it cannot use rather than throwing on it.

**Validation is warnings only** (never import-blocking): an unknown or retired criterion, an unknown matrix or set, a set ref at another major than the set (`weighing-set-ref-major`), a set or matrix too malformed to use (`weighing-set-shape`, `weighing-matrix-shape`), a level off the set's scale, a confidence outside 0–3, a missing scorer, an unknown scorer kind, a stored `rule` row, a subject that is not an acceptance of this bundle, confidence 2–3 with no evidence, two rows for one cell and scorer kind, a score taken against another major of the set, a positioning naming a non-element or a weight at or below 0, a positioning under an id other than `positioning` (or a set called `positioning` with no role), a positioning whose `extends` is missing, unknown or itself a positioning, a `weighing.*` event with no `actor`.

**Publik withholds it by default.** A weighing section holds what a product scores its own promises against its own values, and the costs it has admitted. `POST /api/publik` strips it as it strips the journal and the quality section; `?include_weighing=true` opts in, and opting into either of the others never implies it.

## References

v2 adds typed external references to nodes, under `metadata.refs` (placed in `NodeMetadata` alongside `platformStatuses` and friends):

```ts
interface Ref {
  id: string;                // unique within the node, kebab-case, e.g. "gh-142"
  type: "figma" | "github-issue" | "gitlab-issue" | "linear-issue"
      | "github-pr" | "gitlab-mr" | "url";
  url: string;               // canonical external URL
  title?: string;            // display label
  external_status?: string;  // mirrored external state, verbatim (e.g. "open", "merged", "In Progress")
  status_mapped?: StatusId;  // optional mapping of external_status into the arkaik lifecycle
  platform?: PlatformId;     // optional scoping to one platform variant
  synced_at?: string;        // ISO 8601 — when external_status was last mirrored
}
```

| Rule | Detail |
|---|---|
| Mirroring | `external_status` is a *mirror*, never authoritative. Sync tooling (`arkaik sync`, server-side integrations) updates it and records `ref.status_changed` journal events |
| Mapping | `status_mapped` never overwrites `node.status` automatically; it is advisory display data. Promoting it to the node's status is a deliberate act that produces a normal `node.status_changed` event |
| Promotion policy | A project MAY opt in to automatic promotion by declaring `project.metadata.ref_policy` — a map of ref type → external status → `StatusId` (or `null` for "recognised, moves nothing"). `ref_policy: true` selects the defaults (`github-pr`: open → `development`, merged → `releasing`, closed → nothing). **Absent `ref_policy`, nothing is promoted** — the advisory rule above is unchanged for every bundle that predates this. A promotion is scoped to `ref.platform` when the ref carries one, moving `metadata.platformStatuses[platform]` rather than `node.status`, so shipping on one platform never claims parity across all of them. Archived nodes are never promoted, and neither is a scope that already reads `live` — live is kept, not re-earned (issue #424); a node already at the target is skipped, making re-runs no-ops. Implemented once in `computeRefPromotions` (`@arkaik/schema`) and shared by `arkaik sync --promote` and the hosted GitHub App |
| Multiple scopes per url | A node MAY carry several refs sharing one `url`, each scoped to a different `platform` — one pull request can ship the same acceptance on iOS and Android, and one ref cannot say so. Producers MUST NOT write a **promotable** mix: for one url on one node, a producer that is actively mirroring must leave either exactly one **unscoped** ref or a set of **scoped** ones, because an unscoped ref promotes the base status and would subsume the platform claims sitting beside it. A mix MAY nonetheless exist in a stored bundle, where a producer has stopped mirroring a ref it can no longer justify and left it at its last truthful state rather than deleting it — the hosted GitHub App does exactly this. Such a ref is inert only for as long as its `external_status` maps to nothing under the project's `ref_policy`; consumers MUST NOT assume a mix is unreachable, and a producer that resumes mirroring one MUST first resolve the set back to a homogeneous one. The hosted GitHub App names these refs `gh-pr-<number>` and `gh-pr-<number>-<platform>`, and appends a `-2`, `-3`, … disambiguator when either shape is already taken on that node — ref ids are unique per node, PR numbers are per-repo, and one project may link several repositories, so two different pull requests can both reach `#42`. **The `platform` FIELD is authoritative for scope, never the id**: a ref id is an opaque identifier, consumers MUST NOT parse a platform out of it, and refs written by earlier versions are stored as `gh-pr-<number>` while carrying a `platform` |
| Unknown types | Consumers MUST preserve refs with unrecognized `type` values and SHOULD render them as generic links |

## Asset Values

Anywhere the format carries an asset (today: `metadata.platformScreenshots`, a per-platform map), the value MUST be one of three forms:

| Form | Detection | Where the bytes live | Intended mode |
|---|---|---|---|
| Relative path | No URI scheme, no leading `/` | Resolved against the bundle file's directory (e.g. `assets/web/home.png` next to `docs/arkaik/bundle.json`) | Kommit (repo-hosted) |
| Absolute URL | `https://` | Figma, arkaik bucket, user-owned Supabase bucket | Hosted modes |
| Data URI | `data:` | Inline in the bundle | Lokal / legacy only — discouraged; subject to import size caps |

Consumers that cannot resolve a form (the hosted app receiving a relative path, for instance) MUST degrade to a placeholder, never fail the import. `arkaik pack` converts between forms (inline or upload) when producing a self-contained interchange file. Journal events MUST NOT embed asset payloads.

**Size-bomb guidance:** a `data:` value SHOULD stay under 2MB decoded — the same cap the app's own screenshot upload enforces. `validateBundle()` (`@arkaik/schema`) emits a `screenshot-data-uri-size` **warning** (never an error) above that threshold: data URIs are a legitimate legacy form and MUST NOT be rejected on size alone, only flagged so producers can migrate to a hosted or relative-path form.

**Provenance.** `metadata.platformScreenshotMeta[platform]` records how the current slot value got there — `ts`, `source` (`ci` | `manual`), `form`, `commit?`, `order?` — and `ci_order`, the highest CI `order` ever accepted for the slot, which survives a manual shot and a removal (a slot that was removed keeps `{ ci_order }` alone). It is written only by the `record_screenshot` / `remove_screenshot` mutation ops; a producer that patches `platformScreenshots` through `update_node` leaves it stale, and `validateBundle()` warns `screenshot-untracked` when the slot disagrees with the journal.

### Acceptance Nodes

An `acceptance` node (id prefix `AC-`) is a testable promise: `title` is the
What, `metadata.gherkin` holds exactly one Given/When/Then scenario (the How),
`metadata.values` holds 1..n elements of the core value enum (the Why — Bain
B2C pyramid, see the generated JSON Schema `Value` enum). Per-platform status
uses the same `metadata.platformStatuses` mechanic as views; `platforms` lists
the platforms where the behavior is expected ("availability").

`covers` edges (acceptance → view | flow) anchor the promise to surfaces. Zero
covers edges is legal, and it is **intake**, not "applies everywhere": an idea
filed before the flows and views exist, carrying `metadata.product` from day one
and waiting to be decomposed (§ Products). It is anchorless, and the app calls
it that. Stored per-platform status
lives on acceptances; covered views compute theirs (validator: missing
`gherkin`/`values` on an acceptance are warnings; unknown value ids are errors;
`gherkin`/`values` on other species are warnings).

### Decision Nodes

A `decision` node (id prefix `DEC-`) is an ADR-style record: `title` +
`description` hold the Decision/What, `metadata.context` (markdown) holds the
Context/Why, `metadata.consequences` (markdown) holds the Consequences/How.
Four metadata fields are meaningful on decision nodes only:

```ts
interface NodeMetadata {
  // ... unchanged fields
  decision_status?: DecisionStatus;  // decision nodes only — see below
  context?: string;                  // decision nodes only — markdown, the Why
  consequences?: string;             // decision nodes only — markdown, the How
  decided_at?: string;               // decision nodes only — ISO 8601 date
}
```

`decided_at` is optional and exists for historical backfill: a bulk-imported
`node.created` journal event carries the backfill run's timestamp, not the
day the decision was actually made, so `decided_at` is the only place the
real date lives.

`metadata.decision_status` is its own enum, distinct from the node lifecycle
`status` (the `metadata.platformStatuses` precedent, not a species-specific
`status` vocabulary):

```ts
type DecisionStatus =
  | "proposed" | "approved" | "enacted"
  | "rejected" | "deprecated" | "superseded";  // last three are terminal
```

The node's global `status` is kept in sync at write time via
`lifecycleStatusForDecision` (`@arkaik/schema`), so every status-driven
surface keeps working without branching by species:

| `decision_status` | Synced `status` |
|---|---|
| `proposed` | `discovery` |
| `approved` | `backlog` |
| `enacted` | `live` |
| `rejected` / `deprecated` / `superseded` | `archived` |

`validateBundle()` cross-checks the mapping as a **warning**
(`decision-lifecycle-mismatch`), never an error — a hand-edited bundle must
not brick on a stale sync. `decision_status` present on a non-`decision` node
is also a warning (`decision-status-wrong-species`); an unknown
`decision_status` value is rejected at the schema-parse boundary, same
posture as an unknown lifecycle status.

Three edge types are decision-only:

| Edge type | Legal pairs | Meaning |
|---|---|---|
| `supersedes` | `decision → decision` | Source replaces target; recording it also moves the target to `decision_status: superseded` |
| `generates` | `decision → acceptance` | The decision produced this testable promise |
| `impacts` | `decision → flow \| view \| data-model \| api-endpoint` | The decision affects this existing node (or spawned it) |

`generates` and `impacts` are deliberately disjoint: an acceptance is
*generated* by a decision, never merely *impacted*, so `impacts` does not
admit an `acceptance` target — consumers MUST NOT infer an edge's meaning
from its endpoints.

Decisions legitimately carry an empty `platforms` array — they are
platform-agnostic records, not something that ships. `platforms-non-empty`
exempts the `decision` species for exactly this reason, the same way the
Products section's rules gate on species.

**All of the above is additive: no `schema_version` bump.** Every field is
optional metadata, every enum member and edge type is new vocabulary, and the
one new journal event (`decision.status_changed`, [journal.md](journal.md) §
Event Vocabulary) follows the forward-compatibility rule in the Event
Envelope — this is the same posture as the Products addition earlier in this
document. Old bundles parse unchanged; a bundle with no `decision` nodes
renders empty states.

## Identifier Conventions

IDs are deterministic and human-readable. This subsumes and canonicalizes the rules in `docs/arkaik-skill/references/schema.md`.

| Entity | Convention | Example |
|---|---|---|
| Flow | `F-` + kebab-case of title | `F-onboarding` |
| View | `V-` + kebab-case of title | `V-set-intensity` |
| Data model | `DM-` + kebab-case of title | `DM-bounce` |
| API endpoint | `API-` + kebab-case of title | `API-create-bounce` |
| Edge | `e-{source_id}-{target_id}` | `e-V-home-API-list-bounces` |
| Ref | free kebab-case, unique per node | `gh-142` |
| Journal event | ULID | `01J9ZK4E4NVQ9K4YB2Q6WPXC1T` |

| Rule | Detail |
|---|---|
| Collisions | When two titles kebab-case identically, disambiguate deterministically with a short semantic suffix or `-2`, `-3` counters. The known real-world case: conceptual model *Bounce* (`DM-bounce`) vs physical table *bounces* — both must never resolve to the same ID (a duplicate node ID breaks the graph render; the import guard must reject it) |
| Renames | Changing a title does not require changing the ID. Changing an ID requires repointing every edge endpoint, the edge IDs themselves, playlist references, and `root_node_id` in the same change |
| App divergence (defect) | The app currently violates these conventions: `lib/utils/id.ts` generates random UUID suffixes for nodes, and canvas-created edges use raw `crypto.randomUUID()`. Any repo bundle round-tripped through the app comes back non-conformant. Roadmap Phase 3 adopts deterministic IDs in the app |

## Canonical Serialization

So that bundles diff and merge cleanly in git, writers SHOULD emit canonical form; `arkaik validate --fix-format` (toolchain) normalizes it:

- UTF-8, LF line endings, 2-space indentation, trailing newline
- Top-level key order: `schema_version`, `project`, `nodes`, `edges`, `journal`
- `nodes` and `edges` sorted by `id` (codepoint ascending)
- Object keys in the field order defined by the schema

Canonical form localizes concurrent edits to the same region only when they genuinely touch the same entity. It does not make snapshot merges conflict-free — concurrent edits to the same node still conflict, by design (see the authority model in [journal.md](journal.md)).

## Conformance Levels

| Level | Requirements |
|---|---|
| **0 — Static snapshot** | Valid `project`/`nodes`/`edges`; all v1 semantic rules (unique IDs, valid references, playlist coherence, no flow cycles) |
| **1 — Versioned snapshot** | Level 0 + `schema_version` present + optional `project.version` |
| **2 — Snapshot + journal** | Level 1 + a journal ([journal.md](journal.md)) whose latest state agrees with the snapshot under the cross-check rules |

Every consumer MUST accept all three levels. Producers choose the level that fits their workflow.
