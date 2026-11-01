# Screenshots as events: `screenshot.recorded`, the shot door and the resolver

**Issue:** none yet · **Date:** 2026-11-01 · **Status:** draft, awaiting review

## Problem

A node carries one screenshot per platform in `metadata.platformScreenshots`.
That slot is a mutable field that forgets: nothing says when a shot was taken,
from which commit, or by whom, so a stale shot looks exactly like a current one
and two CI runs landing out of order leave the older shot winning. Both failures
are silent, which is the kind the map exists to prevent.

The first consumer (pbbls) wants shots produced automatically by its screenshot
test suites, per platform, per *intention* and not only per view: the same view
renders differently with or without a picture, with a level-6 ripple or none.
Those render variants are already acceptances (`Given` encodes them), so the
combinatorial question is answered by the graph: a case gets a shot when it has
an acceptance, and views keep one shot per platform as the "what we have" entry.

What is missing is history, provenance and a safe write path. People must still
be able to record a shot from the UI; a merged pull request is not the only
proof.

## Settled decisions

1. **A screenshot is an event, the slot is its projection.** New journal types:

   | Type | Payload | Meaning |
   |---|---|---|
   | `screenshot.recorded` | `node_id`, `platform`, `source` (`ci` \| `manual`), `form` (`url` \| `path` \| `data`), `url?`, `commit?`, `order?`, `detail?` | A shot of this node on this platform exists at `url` |
   | `screenshot.removed` | `node_id`, `platform` | The slot was cleared on purpose |

   `url` is present for the `url` and `path` forms and absent for `data`: the
   journal keeps its rule that events never embed asset payloads
   (`docs/spec/journal.md`), so a data-URI shot is recorded as "a manual shot
   was taken" and the bytes live in the snapshot only. `commit` is the sha the
   shot was taken from and `order` its height on the default branch, both CI
   only. `detail` is free text (the test name, the device). Envelope `actor` is
   `arkaik-ci`, `arkaik-app` or `arkaik-mcp` as elsewhere.

   The resolver writes the current shot into `metadata.platformScreenshots`
   unchanged, so `images: true` maps, `ViewNode`, `ShotPreviewDialog` and the
   doc-health indicator need no change, and adds
   `metadata.platformScreenshotMeta[platform] = { ts, source, commit?, order?, event_id }`
   so a card can say "iOS, from CI, 3 days ago".

   Rejected: a `refs[]` entry of type `screenshot` (refs mirror external
   status, a shot has none, and the per-platform slot is the display contract);
   a gallery of several current shots per slot (cases are acceptances, one
   current shot per `(node, platform)` is enough).

2. **One narrow op, never `update_node`.** A mutation op `record_screenshot`
   `{ node_id, platform, source, form, url?, commit?, order?, detail? }` and its
   twin `remove_screenshot`. They run through `applyMutation` (lock, validators,
   version bump) and derive the events above. They touch one platform slot and
   nothing else, which removes the wipe-the-metadata hazard of a full
   `update_node` from a CI job. `update_node` may still change
   `platformScreenshots` (the legacy path keeps deriving a path-only
   `node.updated`), and `validateBundle` warns `screenshot-untracked` when a
   slot's value is not what the last `screenshot.recorded` event says.

   Surfaces: the UI (`PlatformVariants` keeps its drop zone, `form: data`, and
   gains a URL field, `form: url`; both post the op with `source: manual`), the
   MCP tools `record_screenshot` / `remove_screenshot`, the CLI verb
   `arkaik shot`, and the door below.

3. **A door for CI, `POST /api/graph/projects/{id}/screenshots`.** Same posture
   as the live door (`lib/services/graph/live.ts`): a batch
   `{ entries: [{ node_id, platform, url, commit, order, detail? }] }`,
   `source` forced to `ci`, `form` forced to `url`, behind `graph:write` or a
   new append-only scope `screenshot:append` for tokens living in a public
   repository's CI secrets. All-or-nothing 422 refusals: `unknown_node`,
   `not_shot_bearing` (views and acceptances only), `platform_not_applicable`,
   `invalid_url` (https only). Two 200 skips: `stale_order` and `unchanged`.
   A leaked token can post a picture, nothing else; the app renders shots under
   an `img-src` policy and never fetches them server-side.

4. **Precedence is decided at ingest, not at read.** For one `(node, platform)`:
   - a `manual` shot is always accepted and becomes current. A person said so;
   - a `ci` shot is accepted only if `order` is at least the last accepted CI
     `order` for that slot. A re-run or a rebase arriving late is a
     `stale_order` skip, never a late overwrite;
   - among accepted events, the latest by `(ts, id)` is current. CI after a
     manual shot replaces it, manual after CI replaces that.

   No pin flag: a slot curated by hand is in practice one no merge refreshes,
   and the reverse. Rejected: "latest by timestamp" alone (wrong for CI), and
   "latest by order" alone (manual shots have no order).

5. **Staleness is derived, never stored.** The app flags a shot as *may be
   stale* when the node has a later `node.status_changed` on that platform or a
   later `ref.status_changed` to `merged`. A derived read costs nothing to be
   wrong about and nothing to repair.

6. **Bytes stay with the consumer.** The door takes URLs; hosting is the M5
   asset bucket, unchanged. pbbls uploads its renders to its own bucket keyed
   by commit and node, writes a manifest `[{ node_id, platform, url }]` and a
   reusable workflow `record-screenshots.yml` calls `arkaik shot --manifest`
   with the sha and the height it computes. Which test feeds which node is the
   consumer's naming convention (a test name carrying `AC-…` or `V-…`), not a
   schema concern.

## Format and projection

- `@arkaik/schema`: the two event types, the two ops, `platformScreenshotMeta`
  on `NodeMetadata`, `reduceScreenshots(events)` in `projections.ts` returning
  the current slot map and meta, and the validator cross-check
  (`screenshot-untracked`, warning) in `validate.ts`.
- Kommit mode: `arkaik shot` dual-writes (append the event, patch the slot and
  meta); `validate-bundle.js` runs the same reducer.
- Hosted mode: the store derives the events from the op and runs the reducer
  inside the lock, so the projection is never computed from a stale read.
- The node panel shows the slot's history as a strip from `screenshot.*` events
  in `ShotPreviewDialog`'s existing gallery; removed shots stay in history.

## Out of scope

Hosting bytes, image diffing, auto-capture tooling in consumers, flows or data
models bearing shots, migrating existing data-URI shots (they stay valid as the
legacy `data` form with no event behind them).

## Testing

- Reducer: manual-after-ci, ci-after-manual, stale order skip, equal order
  accepted, unchanged skip, removed then recorded, data form without url.
- Validator: slot equals last event (pass), slot differs (warning), slot with
  no event (no diagnostic, legacy).
- Door: each refusal, each skip, batch atomicity, scope check for
  `screenshot:append`, re-run idempotence.
- UI: URL field and drop zone both post the op; the legacy `update_node` path
  is no longer reachable from `PlatformVariants`.
