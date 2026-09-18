import type { Node } from "@/lib/data/types";

/**
 * A new node carrying everything this one says about itself, under a new id.
 *
 * **It writes no edges of its own**, and the caller writes none either. A
 * duplicated acceptance therefore covers nothing and lands unanchored in
 * intake, which is the honest state for a record whose anchors have not been
 * chosen — and the panel the copy opens into is the one place to choose them.
 * Copying the `covers` edges would assert that the copy belongs exactly where
 * the original does, which is the one thing "duplicate this" cannot know.
 *
 * **A flow is the exception, and deliberately so.** The playlist is metadata,
 * so it is copied; `applyOps` runs `synthesizeComposesEdges` on every
 * `create_node`, so the copy arrives with a `composes` edge to each node its
 * playlist plays. That is not a leak to be plugged: a flow holding a playlist
 * with no `composes` edges fails `playlist-composes-coherence`, so the only
 * alternatives are a copy that is invalid or a copy with an empty playlist —
 * i.e. not a copy. The consequence to know is that duplicating a flow gives
 * every view it plays a second parent, and any map drawn from `composes` will
 * show that second branch immediately.
 *
 * `structuredClone` of the whole node, not a spread: the panel patches metadata
 * by spreading it and every value editor writes arrays in place, so a shallow
 * copy would leave the two nodes sharing a `values` array — and, one level up,
 * the same `platforms` array — and let an edit to one silently rewrite the
 * other.
 *
 * What it keeps is not an oversight either: `status`, `refs` and the
 * per-platform evidence (`platformStatuses`, `platformNotes`,
 * `platformScreenshots`) all carry over, because a duplicate is a copy of a
 * record that exists. This is the opposite of a split, where every piece starts
 * as an idea and inherits no evidence at all (`planAcceptanceSplit`) — there
 * the original is being divided, here it is being repeated.
 *
 * The id is a parameter rather than minted here. Minting needs `generateNodeId`,
 * which imports `@arkaik/schema`, and this module is loaded in tests by
 * `loadUtil`, which rewrites nothing — so a value import here would fail at
 * `require`. The caller has the existing ids anyway; it is the only one that does.
 */
export function duplicateNodeDraft(node: Node, newId: string): Node {
  const copy = structuredClone(node);
  copy.id = newId;
  copy.title = `${node.title} (copy)`.trim();
  return copy;
}
