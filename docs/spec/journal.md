---
title: "Spec: Journal & Events"
navTitle: "Journal & Events"
order: 2
---

# Journal & Events

> Status: **Draft specification** — describes the target format (Format Level 2, see [bundle-format.md](bundle-format.md)). Nothing in this document is implemented yet.
> The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119.

## Purpose

The journal turns status from a mutable field that forgets into a tracked evolution. It is an **append-only log of typed events** recording how the product graph changed: status transitions, releases, ideas, requests, reference updates. From it, consumers derive the features a static snapshot cannot offer — per-node timelines, changelogs, release notes, and a backlog of ideas and requests.

## Storage Shapes

### Canonical (repo): JSONL sidecar

In a repository (Kommit mode), the journal is a sidecar file next to the snapshot — never inside it. The snapshot stays small and the history cannot corrupt it.

```
docs/arkaik/
  bundle.json                     # snapshot (Levels 0–2)
  journal.jsonl                   # append-only, one event per line
  journal/
    archive-1.3.0.jsonl           # compacted history per release (optional)
  assets/                         # repo-hosted asset files
```

`arkaik init` configures `.gitattributes`:

```
docs/arkaik/journal.jsonl merge=union
```

JSONL is the one shape where git's union merge is sound: one line = one self-contained event, concurrent appends merge automatically, and order is recoverable from the events themselves. A malformed line invalidates exactly one event — the validator reports the line number — and can never damage existing history or the snapshot. This is the property that makes agent writes safe: appending is structurally incapable of the corrupt-the-whole-JSON failure that whole-file regeneration invites.

### Interchange: embedded `journal[]`

When a single file is needed (drag-in import to the app, Publik, LLM output), `arkaik pack` embeds the journal as the bundle's optional `journal` array. This is a *projection for transport*, not a storage recommendation. Publik publishes without the journal by default — history stays private unless explicitly included.

## Event Envelope

One event is one JSON object:

```ts
interface JournalEvent {
  id: string;      // ULID — sortable, collision-free without coordination
  ts: string;      // ISO 8601 timestamp
  actor?: string;  // who/what wrote it: "alexis", "claude-code", "arkaik-sync", "ci"
  type: string;    // vocabulary below
  // ...type-specific payload fields, flat on the object
}
```

| Rule | Detail |
|---|---|
| Ordering | Consumers MUST order events by `ts`, tiebreaking by `id`. Files MAY contain out-of-order lines (union merge reorders); consumers MUST tolerate this |
| Forward compatibility | Unknown `type` values and unknown fields MUST be preserved on rewrite and ignored on read. The vocabulary grows without version bumps; a per-event `v` field is reserved for the day an existing payload shape must change |
| Payload discipline | Events MUST NOT embed asset payloads (screenshots, images). `node.updated` records changed field *paths* (and old/new values only for short scalar fields like `title`), never blob contents |
| Project scope | Events carry no `project_id`; scope is implied by the file they live in / the bundle that embeds them |

## Event Vocabulary (v1)

| Type | Payload | Meaning |
|---|---|---|
| `node.created` | `node_id`, `species`, `title` | Node added to the graph |
| `node.updated` | `node_id`, `fields[]`, optional `from`/`to` for scalars | Non-status fields changed |
| `node.status_changed` | `node_id`, `from`, `to`, `platform?` | Lifecycle transition; `platform` present when a per-platform view status moved |
| `node.deleted` | `node_id` | Node removed. **Implies** cascade removal of every edge referencing it — writers do not emit the cascaded `edge.removed` events, and consumers/validators MUST apply the cascade |
| `edge.added` | `edge_id`, `source_id`, `target_id`, `edge_type` | Relationship created |
| `edge.removed` | `edge_id` | Relationship removed (non-cascade) |
| `release.tagged` | `version`, `notes?`, `platform?` | A version shipped. `platform` optional: absent = project-wide; present = that platform's release rhythm |
| `idea.proposed` | `title`, `description?`, `node_id?` | An idea, before (or linked to) any node |
| `request.filed` | `title`, `description?`, `source?`, `node_id?` | An external ask (user feedback, stakeholder request) |
| `ref.added` | `node_id`, `ref_id`, `ref_type`, `url` | External reference attached |
| `ref.removed` | `node_id`, `ref_id` | External reference detached |
| `ref.status_changed` | `node_id`, `ref_id`, `from?`, `to`, `synced_at` | Mirrored external status moved (issue closed, PR merged) |

## Authority & Consistency Model

The journal is **not** event sourcing, and v1 makes no replay promises. The rules:

1. **The snapshot is authoritative for current state. The journal is authoritative for history.**
2. Writers (the skill, the CLI, later the app) **dual-write**: patch the snapshot *and* append the matching event in the same change.
3. The validator cross-checks the two **by value, never by timestamp** (per-node timestamps don't exist and clocks lie): the last `node.status_changed.to` for a node must equal its current `status`; every node has a `node.created`; no event references a node or edge that never existed. Any mismatch is a validation error naming both sides.
4. Divergence is repaired **explicitly**: `arkaik doctor` appends corrective events to make history consistent with the snapshot (the snapshot wins). Consumers MUST NOT silently re-project the snapshot from the journal — that would launder drift instead of surfacing it.

## Releases, Compaction & Growth

- `release.tagged` events are the version markers. The changelog between two versions is the ordered slice of events between their markers; a release note is that slice summarized (by template or by an agent), filtered to the platforms of the affected nodes when `platform` is used.
- `arkaik release` tags the version, generates the release-note draft, and MAY **compact**: move the released slice from `journal.jsonl` to `journal/archive-{version}.jsonl`. Archives are part of history (projections may read them); the working journal stays small. Compaction differs from the changesets tool's model deliberately — changeset files are *consumed* at release, journal history is *kept*.
- The hosted app stores journals under a separate storage key from the snapshot store, so history growth never inflates every snapshot write. App-side event *emission* is gated on the IndexedDB migration for the same reason (see the roadmap in [vision.md](../vision.md)).

## Projections

Projections are pure functions over (snapshot, journal) — the same pattern as the existing status rollups in `lib/utils/platform-status.ts`. Planned module: `lib/utils/journal.ts`.

| Projection | Answers | Surface |
|---|---|---|
| Node timeline | "How did this view get to `live` on iOS?" | History section in the node detail panel |
| Changelog | "What changed between 1.2 and 1.3?" | Project-level journal/changelog view |
| Release notes | "What do we tell users shipped?" | Generated draft at `arkaik release` |
| Backlog | "Which ideas and requests are open?" | Ideas/requests list (an `idea.proposed` is *open* until a linked node exists or a resolving event closes it) |

A bundle without a journal simply renders none of these — the empty state, not an error. That is the whole backward-compatibility story.
