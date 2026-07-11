---
title: "Spec: Bundle Format v2"
navTitle: "Bundle Format"
order: 1
---

# Bundle Format v2

> Status: **Draft specification** — describes the target format. Implemented behavior is documented in [data-layer.md](../data-layer.md); the currently published contract is v1 at `public/schema/project-bundle.json`.
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

**Known consumer defect to fix before v2 ships:** `rewriteBundleProjectId` (`lib/utils/export.ts`) reconstructs imported bundles as `{ project, nodes, edges }` and silently drops any other top-level key when an imported project's ID collides locally. All import paths MUST round-trip unknown fields.

## Project Additions

```ts
interface Project {
  // ... unchanged v1 fields (id, title, description?, root_node_id?, metadata?, timestamps)
  version?: string;          // v2, Level 1: current version label, e.g. "1.4.0" or "2026-07"
}
```

`project.version` is the *current* version label of the mapped product (free-form string; semver recommended, not required). Version *history* lives in the journal as `release.tagged` events — a Level 1 bundle carries only the label.

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
| Mapping | `status_mapped` never overwrites `node.status` automatically; it is advisory display data. Promoting it to the node's status is a deliberate (human or agent) act that produces a normal `node.status_changed` event |
| Unknown types | Consumers MUST preserve refs with unrecognized `type` values and SHOULD render them as generic links |

## Asset Values

Anywhere the format carries an asset (today: `metadata.platformScreenshots`, a per-platform map — currently missing from the published schema and validator, a known drift to fix), the value MUST be one of three forms:

| Form | Detection | Where the bytes live | Intended mode |
|---|---|---|---|
| Relative path | No URI scheme, no leading `/` | Resolved against the bundle file's directory (e.g. `assets/web/home.png` next to `docs/arkaik/bundle.json`) | Kommit (repo-hosted) |
| Absolute URL | `https://` | Figma, arkaik bucket, user-owned Supabase bucket | Hosted modes |
| Data URI | `data:` | Inline in the bundle | Lokal / legacy only — discouraged; subject to import size caps |

Consumers that cannot resolve a form (the hosted app receiving a relative path, for instance) MUST degrade to a placeholder, never fail the import. `arkaik pack` converts between forms (inline or upload) when producing a self-contained interchange file. Journal events MUST NOT embed asset payloads.

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
