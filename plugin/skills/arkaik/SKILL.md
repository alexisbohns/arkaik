---
name: arkaik
version: 2.0.0
description: >
  Maintain the Arkaik product graph map for {{PRODUCT_NAME}} — add, update, or
  remove nodes and edges in the ProjectBundle JSON that describes its screens,
  flows, data models, and API endpoints, and record every change as a journal
  event. Use this skill whenever you create, rename, move, or delete a
  view/screen, route, data model, or API endpoint in the codebase. Also use it
  when changing a feature's status (idea → development → live), adding a new user
  journey, or restructuring navigation. If your code change touches product
  architecture, this skill applies — even if no one explicitly asked you to
  update the map.
---

# Arkaik Map Maintenance

You are maintaining an **Arkaik ProjectBundle** — a JSON file that describes the
product architecture of {{PRODUCT_NAME}} as a graph of nodes (screens, flows,
data models, API endpoints) and edges (relationships between them) — plus a
**journal**, an append-only log of typed events recording how that graph changed
over time.

The map lives at `{{BUNDLE_PATH}}` in the repository. If it doesn't exist at
that path yet, check the project root and `docs/` for any `*arkaik*.json` file.
If you find one elsewhere, use it where it is — don't move files without the
user's approval.

The journal is a sidecar file next to the snapshot at `{{JOURNAL_PATH}}` —
append-only, one JSON event per line (JSONL), **never inside the snapshot**. If
the journal doesn't exist yet, the map is a plain snapshot with no history; start
one the first time you make a change (see [Dual-write](#dual-write-snapshot--journal)).

> **Template parameters.** This skill is *rendered*, not copied — `arkaik init`
> (and `arkaik init --update`, which reads the `version` stamp in the frontmatter
> above to upgrade cleanly instead of blind-overwriting local edits) substitutes
> these per project. If you are reading a raw, unrendered copy, treat the defaults
> in parentheses as the values:
>
> | Parameter | Meaning | Default |
> |---|---|---|
> | `{{PRODUCT_NAME}}` | The product this map describes | the current product |
> | `{{BUNDLE_PATH}}` | Path to the snapshot | `docs/arkaik/bundle.json` |
> | `{{JOURNAL_PATH}}` | Path to the journal sidecar | `docs/arkaik/journal.jsonl` |

## When to Update the Map

Update the map as a side-effect of your main work whenever you:

- **Add** a new screen, page, route, component, model, or endpoint
- **Remove** or deprecate a feature, screen, or endpoint
- **Rename** a view, model, or route
- **Change status** of a feature (e.g., moving from `idea` to `development`)
- **Restructure** navigation or user flows
- **Add or change** API contracts

Do NOT regenerate the entire map. Make **surgical patches** — touch only the
nodes and edges affected by your change. This keeps diffs reviewable and avoids
accidental regressions.

## Dual-write: snapshot + journal

The snapshot is authoritative for **current state**; the journal is authoritative
for **history**. Every change is a **dual-write**: in the *same* change you

1. patch the snapshot (`{{BUNDLE_PATH}}`) surgically, **and**
2. append the matching event(s) to the journal (`{{JOURNAL_PATH}}`).

Appending is a one-line addition to the JSONL sidecar — structurally incapable of
corrupting existing history or the snapshot, and safe under concurrent edits
(git's `merge=union` reorders lines; consumers order by `ts`, tiebreaking by `id`).

**Never re-project the snapshot from the journal, or vice versa.** If the two ever
disagree, that divergence is a signal to surface, not to launder — the validator
below is what catches it.

### Which events to append

Each graph operation has a matching event. Append one line per operation:

| Graph operation | Journal event |
|---|---|
| Add a node | `node.created` (`node_id`, `species`, `title`) |
| Add an edge | `edge.added` (`edge_id`, `source_id`, `target_id`, `edge_type`) |
| Change a node's `status` | `node.status_changed` (`node_id`, `from`, `to`; add `platform` when a per-platform view status moved) |
| Change any other node field (rename, description, playlist…) | `node.updated` (`node_id`, `fields[]`; `from`/`to` for short scalars like `title`) |
| Remove a node | `node.deleted` (`node_id`) — **implies** cascade removal of its edges; do NOT also emit `edge.removed` for those |
| Remove an edge on its own (node stays) | `edge.removed` (`edge_id`) |
| Attach / detach an external reference | `ref.added` / `ref.removed` |

Other event types you may append when the change warrants it: `release.tagged`
(a version shipped), `idea.proposed` (an idea, before or linked to a node),
`request.filed` (an external ask), `ref.status_changed` (a mirrored external
status moved). See the [event vocabulary](#event-vocabulary) for full payloads.

### Event envelope

Every event is one JSON object on its own line with these envelope fields, plus
the type-specific payload flat on the object:

```json
{ "id": "<ULID>", "ts": "<ISO 8601>", "actor": "claude-code", "type": "node.status_changed", "node_id": "V-home", "from": "development", "to": "live" }
```

- `id` — a ULID (sortable, collision-free). If you cannot generate a real ULID,
  any strictly increasing, unique, 26-char Crockford-base32 string works; order
  is recovered from `ts` first, `id` only as a tiebreak.
- `ts` — an ISO 8601 timestamp (the moment of the change).
- `actor` — who wrote it; use `"claude-code"` for your own writes.
- Events carry **no** `project_id`; scope is the file they live in.

## How to Update

### 1. Read the current map

Always read the snapshot first. Parse it and identify the relevant nodes/edges
before making changes. If a journal sidecar exists, you don't need to read all of
it — you only ever **append**.

### 2. Decide what to change

Map your code change to graph operations (and the events they pair with):

| Code change | Graph operation | Journal event(s) |
|---|---|---|
| New screen/page | Add a `V-` view node + `displays` edges to its data models + `calls` edges to its APIs | `node.created` + `edge.added` per edge |
| New route/endpoint | Add an `API-` node + `queries` edges to the data models it reads/writes | `node.created` + `edge.added` per edge |
| New model/table | Add a `DM-` node | `node.created` |
| New user journey | Add a `F-` flow node with a playlist + `composes` edges to all views/sub-flows in the playlist | `node.created` + `edge.added` per edge |
| Screen added to a flow | Add entry to the flow's playlist + a `composes` edge | `node.updated` (playlist) + `edge.added` |
| Feature removed | Remove the node + all edges referencing it + remove from any playlists | `node.deleted` (edges cascade — do not emit `edge.removed`) |
| Status change | Update the node's `status` field | `node.status_changed` |
| Rename (label only) | Update the node's `title`; keep the `id` stable so edges stay intact | `node.updated` (`fields: ["title"]`, with `from`/`to`) |
| Rename (id must change) | Update the `id`, then repoint every edge's `source_id`/`target_id` **and** the edge `id` (`e-{source}-{target}`), plus any playlist `view_id`/`flow_id` and `root_node_id` | `node.updated` + `edge.removed`/`edge.added` for each repointed edge |

### 3. Apply the change

Edit the snapshot JSON using the Edit tool for surgical changes, or Write for
larger restructuring. Follow these rules strictly:

**Node rules:**
- IDs are prefixed by species: `F-` (flow), `V-` (view), `DM-` (data-model), `API-` (api-endpoint)
- IDs use lowercase kebab-case after the prefix (e.g., `V-user-profile`)
- **IDs must be globally unique.** Derive each ID deterministically from the title,
  then check it against every existing node ID before adding — a duplicate ID
  breaks the entire graph render (elkjs/React Flow key nodes by ID).
- **Data-model IDs come in two flavors that must not collide:** conceptual models
  use a singular `DM-<concept>` (title "Bounce" → `DM-bounce`); physical tables/views
  use the exact identifier `DM-<table_name>` (title `bounces` → `DM-bounces`,
  `karma_events` → `DM-karma-events`). See the schema reference for the full table.
- **Every node must have a non-empty `title`.** Concepts/views/flows/APIs use 2–5
  capitalized words; physical tables/views use the exact DB identifier verbatim.
- Every `node.project_id` must match `project.id`
- `platforms` must contain at least one of: `"web"`, `"ios"`, `"android"`
- Flow nodes must have `metadata.playlist` with at least one entry

**Edge rules:**
- Edge IDs follow the pattern `e-{source_id}-{target_id}`
- Every `source_id` and `target_id` must reference existing node IDs
- Edge type semantics:
  - `composes`: flow -> view, flow -> flow (sub-flow), view -> flow (triggers)
  - `calls`: view -> api-endpoint, flow -> api-endpoint, api-endpoint -> api-endpoint (endpoint fan-out to internal/external APIs)
  - `displays`: view -> data-model
  - `queries`: api-endpoint -> data-model
- Every view/flow referenced in a playlist MUST also have a `composes` edge

**Playlist rules:**
- Entry types: `view` (with `view_id`), `flow` (with `flow_id`), `condition` (with `label`, `if_true`, `if_false`), `junction` (with `label`, `cases`)
- All `view_id` / `flow_id` values must reference existing nodes
- No cycles — a flow cannot contain itself directly or indirectly

### 4. Append the matching journal event

In the **same change**, append one line per graph operation to `{{JOURNAL_PATH}}`
(see [Dual-write](#dual-write-snapshot--journal)). Create the file if it doesn't
exist yet. This is not optional bookkeeping — the validator in the next step
cross-checks the two by value and **rejects a snapshot that its journal
contradicts** (e.g. a status the last `node.status_changed` never reached, or a
node with no `node.created`).

### 5. Validate — hard gate, not optional

After **every** change (surgical patch or full generation), run the validator:

```bash
node <skill-path>/scripts/validate-bundle.js <path-to-bundle.json>
```

The validator auto-discovers the `journal.jsonl` sidecar next to the bundle and
folds it into the check, so pointing it at the snapshot gates **both** the patch
and the appended event in one run.

**A non-zero exit code is a hard stop.** Do not commit, hand off, or declare the
task done until it exits 0 — and that includes fixing the journal, not just the
snapshot. The map that ships is the one the app imports, so run the validator
against *that* file (e.g. the seed the app loads), not just a local working copy.
Where possible, wire this script into the consuming repo's CI or a pre-commit hook
so a broken bundle cannot land regardless of who edits it.

The validator enforces the full [Validation Checklist](references/schema.md#validation-checklist).
Common issues it catches:
- Duplicate node IDs (e.g. a concept and its backing table both kebab-cased to the same `DM-` id)
- A node with a missing or empty `title`
- Forgetting to add a `composes` edge when adding a view to a playlist
- Stale edge IDs/references after renaming or removing a node
- Missing `project_id` on new nodes
- An invalid `view_card_variant` (the app's import throws on it)

**Snapshot ↔ journal cross-checks** (the dual-write gate). The validator compares
the two **by value, never by timestamp** (per-node timestamps don't exist and
clocks lie) and errors on any mismatch, naming both sides:
- The last project-level `node.status_changed.to` for a node must equal its
  current `status`. (Platform-scoped transitions — those carrying `platform` —
  move a per-platform view status, not `node.status`, and are excluded.)
- Every node in the snapshot must have a `node.created` event.
- No event may reference a node or edge that never existed. The `node.deleted`
  edge cascade is applied, so you never emit the cascaded `edge.removed` events.
- Each JSONL line must be one valid event object; a malformed line is reported by
  its line number and fails the run.

### 6. Update timestamps

Set `project.updated_at` to the current ISO 8601 timestamp.

## Full Schema Reference

For the complete TypeScript types, allowed values for `status`, `species`,
`edge_type`, `platform`, the journal event payloads, and detailed playlist
structures, read:

```
<skill-path>/references/schema.md
```

Consult this reference whenever you're unsure about a field's type or allowed
values. It is generated from `@arkaik/schema` and is the source of truth.

## Event Vocabulary

The v1 event types and their payloads (envelope fields `id`, `ts`, `type`,
optional `actor` are implied on every one). The vocabulary grows without version
bumps: an unknown `type` is preserved on rewrite and ignored on read, so append a
known type whenever one fits.

| Type | Payload | Meaning |
|---|---|---|
| `node.created` | `node_id`, `species`, `title` | Node added to the graph |
| `node.updated` | `node_id`, `fields[]`, optional `from`/`to` for scalars | Non-status fields changed |
| `node.status_changed` | `node_id`, `from`, `to`, `platform?` | Lifecycle transition; `platform` present when a per-platform view status moved |
| `node.deleted` | `node_id` | Node removed. **Implies** cascade removal of every edge referencing it — do not emit the cascaded `edge.removed` events |
| `edge.added` | `edge_id`, `source_id`, `target_id`, `edge_type` | Relationship created |
| `edge.removed` | `edge_id` | Relationship removed (non-cascade) |
| `release.tagged` | `version`, `notes?`, `platform?` | A version shipped. `platform` absent = project-wide; present = that platform's rhythm |
| `idea.proposed` | `title`, `description?`, `node_id?` | An idea, before (or linked to) any node |
| `request.filed` | `title`, `description?`, `source?`, `node_id?` | An external ask (user feedback, stakeholder request) |
| `ref.added` | `node_id`, `ref_id`, `ref_type`, `url` | External reference attached |
| `ref.removed` | `node_id`, `ref_id` | External reference detached |
| `ref.status_changed` | `node_id`, `ref_id`, `from?`, `to`, `synced_at` | Mirrored external status moved (issue closed, PR merged) |

## Bootstrap: Generating a Map from Scratch

If the project doesn't have a map yet and the user asks you to create one:

1. Scan the codebase for routes/pages, models, and API endpoints
2. Read any product specs or PRDs in the repo
3. Generate the full ProjectBundle following the schema reference. Keep a running
   registry of assigned IDs and assert each new ID is unique **as you emit it** —
   don't rely on the final validator to catch a collision after the fact. Watch
   especially for concept-vs-table `DM-` pairs (see Node rules) and give every
   node a non-empty title.
4. Seed the journal to match: emit a `node.created` for every node and an
   `edge.added` for every edge (and a `node.status_changed` for any node that
   isn't at its starting status), so the snapshot↔journal cross-check passes from
   the very first validation.
5. Validate with the bundled script and fix everything until it exits 0 (a large
   from-scratch bundle is exactly where duplicate IDs, missing titles, and
   snapshot↔journal gaps slip in)
6. Save the snapshot to `{{BUNDLE_PATH}}` and the journal to `{{JOURNAL_PATH}}`
   (or ask the user where they want them)

Full generation is the **only** sanctioned non-surgical case. For every
subsequent change, use a surgical patch paired with an appended event.
