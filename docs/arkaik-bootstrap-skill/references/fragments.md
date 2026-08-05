# The fragment contract

A fragment is the one file a bootstrap agent writes: one JSON object at
`.arkaik/bootstrap/fragments/<unit>.json`, where `<unit>` is your work-unit
id from `.arkaik/bootstrap/manifest.json`. The filename **is** the unit id —
`arkaik bootstrap merge` derives the path from the id and ignores the
manifest's `fragment` field. A missing fragment just means the unit hasn't
run yet (the run is resumable); invalid JSON, a top-level array, or a
non-array value under any of the keys below fails the merge loudly, naming
your unit.

The top level:

```jsonc
{
  "unit": "<your unit id>",
  "wave": 1,
  // then one or more of the six keys below, each an array of objects:
  "nodes": [], "edges": [],                // greenfield anatomy / acceptances
  "add": [], "update": [], "retire": [],   // brownfield reconcile
  "events": []                             // story (wave 3)
}
```

Merge reads **only** those six keys and ignores everything else. Two
consequences:

- You may have seen sketches of the wave-3 shape with `deliverables`,
  `releases`, or `decisions` keys — **they do not exist in the contract**,
  and anything written under them is silently lost. Deliverables and
  releases are entries in `events` (`deliverable.shipped`, `release.tagged`);
  the decisions unit's `DEC-` nodes go in `nodes` (or `add`) with their edges
  in `edges`, like any other node. Merge never branches on `wave` — every key
  works in every fragment.
- One ignored key is used on purpose: **`notes`**, a free-text string where
  you record judgment calls (e.g. why a PR was judged not user-visible).
  Merge skips it; the wave reviewer reads it.

## Nodes — `nodes` and `add`

A node as an agent writes it: the bundle's node fields **minus `project_id`**
(merge stamps it), plus an optional `created_ts`.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Species-prefixed kebab-case id (`F-`, `V-`, `DM-`, `API-`, `AC-`, `DEC-`) |
| `species` | yes | `flow`, `view`, `data-model`, `api-endpoint`, `acceptance`, `decision` |
| `title` | yes | Non-empty; concept titles capitalized, table titles the exact identifier |
| `created_ts` | no | When this surface first shipped — becomes the `node.created` event's timestamp |
| anything else | no | `status`, `platforms`, `metadata` (playlists, gherkin, values…) as the species requires |

`created_ts` should be the merge instant of the PR that first shipped the
surface, straight from your slice. It is consumed, not stored: merge uses it
to synthesize the `node.created` event and drops it from the node. Absent,
merge falls back to `project.created_at`. A malformed timestamp fails your
unit loudly rather than minting a wrong event.

`add` (brownfield) takes exactly the same node shape. Re-declaring a node
that already exists with the **same title** is a safe no-op — no duplicate
node, no duplicate `node.created`. The same id with a **different title** is
a collision, and merge fails naming both titles and both units. That is the
whole coordination model: ids are derived deterministically from titles, so
independent agents converge on the same id for the same thing and collide
loudly on different things.

## Edges — `edges`

| Field | Required | Meaning |
|---|---|---|
| `source_id` | yes | A node id — from this fragment, another unit's fragment, or the existing map |
| `target_id` | yes | Same |
| `kind` | yes | `composes`, `calls`, `displays`, `queries`, or `covers` (semantics: the `arkaik` skill) |

No edge `id` — merge mints the canonical `e-{source}-{target}`. Endpoints
resolve across fragments, so you never coordinate with another agent; an
endpoint **nobody** created is a loud merge error. Two fragments disagreeing
on one edge's kind is an error naming both; agreeing is a silent no-op.

## Reconcile ops — `update` and `retire` (brownfield)

```jsonc
"update": [{ "id": "V-x", "patch": { ... }, "changed_ts": "<ISO instant>" }],
"retire": [{ "id": "V-y", "reason": "why", "changed_ts": "<ISO instant>" }]
```

- **`update`** — `patch` fields replace the node's. `metadata` is special:
  its **top-level keys merge** — keys you don't name survive — but a key you
  **do** name is **replaced whole**, not merged recursively. Patching one
  nested field means writing the key's full value: all of `platformStatuses`,
  the whole `playlist`. When the patch **changes** `status` (or
  `metadata.decision_status`), merge emits the matching `node.status_changed`
  (or `decision.status_changed`) event at `changed_ts`; a patch restating the
  same value emits nothing.
- **`retire`** — never a delete. Merge sets `status: "archived"`, records
  `metadata.retired_reason`, and emits the status event. The node count is
  unchanged; a human decides actual removal.
- Both ops must target a node that exists — an unknown id fails the merge.

**The `changed_ts` one-shot rule.** When a status-changing op omits
`changed_ts`, merge substitutes one constant fallback timestamp for the whole
run. One such op per node is safe; a **second** status-changing op for the
**same node** in the same run that also omits it lands on the identical
timestamp, and merge refuses rather than guess an order. Give every
status-changing op past the first, for the same node, its own explicit
`changed_ts`.

## Story events — `events`

Plain journal event objects: `type`, the type's payload fields, and a real
`ts`. **No `id`, no `actor`** — merge mints deterministic ids, which is what
makes a re-run over unchanged fragments byte-identical. The story types:

| Type | Payload |
|---|---|
| `deliverable.shipped` | `deliverable_id`, `title`, `summary?`, `url?`, `node_ids?`, `platform?` |
| `release.tagged` | `version`, `notes?`, `platform?` |
| `node.status_changed` | `node_id`, `from`, `to`, `platform?` |
| `decision.status_changed` | `node_id`, `from`, `to` |
| `idea.proposed` | `title`, `description?`, `node_id?` |

The full vocabulary is the `arkaik` skill's event table. Timestamps come from
the corpus — PR merge instants, not invented dates. Two **unscoped**
`node.status_changed` for **one node at the identical `ts`** that disagree on
`to` are refused (read-back order between them would be undefined);
platform-scoped events — those carrying `platform` — are exempt. Real merge
timestamps are full instants, so distinct instants are free — use them.

## Examples

Each example below is a fixture from the CLI's own test suite, copied
verbatim so the docs and the tested contract cannot drift. If a fixture
changes, change it here too.

**Greenfield anatomy** (`tests/cli/bootstrap-e2e.test.js`, the `w1-home`
fragment — note the playlist ↔ `composes` agreement and `created_ts`):

```json
{
  "unit": "w1-home",
  "wave": 1,
  "nodes": [
    {
      "id": "F-notes",
      "species": "flow",
      "title": "Notes",
      "status": "live",
      "platforms": ["web"],
      "created_ts": "2026-01-05T10:00:00.000Z",
      "metadata": { "playlist": { "entries": [{ "type": "view", "view_id": "V-home" }] } }
    },
    {
      "id": "V-home",
      "species": "view",
      "title": "Home",
      "status": "live",
      "platforms": ["web"],
      "created_ts": "2026-01-05T10:00:00.000Z"
    }
  ],
  "edges": [{ "source_id": "F-notes", "target_id": "V-home", "kind": "composes" }]
}
```

**Brownfield `add`** (`tests/cli/bootstrap-merge.test.js`, the "node.created
is not duplicated" probe — `V-home` already exists in the map and is a no-op;
`V-new` is genuinely new):

```json
{
  "unit": "w1-a",
  "wave": 1,
  "add": [
    { "id": "V-home", "species": "view", "title": "Home", "status": "live", "platforms": ["web"] },
    { "id": "V-new", "species": "view", "title": "New", "status": "live", "platforms": ["web"], "created_ts": "2026-03-01T00:00:00.000Z" }
  ]
}
```

**Brownfield `update` + `retire`** (`tests/cli/bootstrap-merge.test.js`, the
combined reconcile fixture):

```json
{
  "unit": "w1-a",
  "wave": 1,
  "update": [{ "id": "V-home", "patch": { "status": "live" }, "changed_ts": "2026-02-01T00:00:00.000Z" }],
  "retire": [{ "id": "V-legacy", "reason": "replaced by V-home", "changed_ts": "2026-02-02T00:00:00.000Z" }]
}
```

**Wave-3 story** (`tests/cli/bootstrap-merge.test.js`, the journal de-dup
fixture — `V-home` is a node that already exists in the map):

```json
{
  "unit": "w3-decisions",
  "wave": 3,
  "events": [
    { "type": "deliverable.shipped", "deliverable_id": "pr-1", "title": "Ship it", "ts": "2026-01-05T00:00:00.000Z" },
    { "type": "node.status_changed", "node_id": "V-home", "from": "backlog", "to": "live", "ts": "2026-01-05T00:00:00.000Z" }
  ]
}
```
