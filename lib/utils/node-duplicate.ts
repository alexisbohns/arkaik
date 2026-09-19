import type { Node } from "@/lib/data/types";

/**
 * A new node carrying everything this one says about itself, under a name and
 * an id the reader chose.
 *
 * **It names nothing.** It used to suffix the title with `(copy)` and take the
 * id it was handed; both now arrive from `DuplicateNodeDialog`, because a node's
 * id is minted from its title once and then lives forever in urls, chips and
 * bundles — a derived name is a permanent decision, and the dialog is where it
 * is cheapest to take deliberately. One object rather than two positional
 * strings: `id` and `title` are both strings, and a call site that swapped them
 * would type-check and write a node named `V-notes-2`.
 *
 * **It writes no edges of its own**, and the caller writes none. A duplicated
 * acceptance therefore covers nothing and lands unanchored in intake, which is
 * the honest state for a record whose anchors have not been chosen — and the
 * panel the copy opens into is the one place to choose them. Copying the
 * `covers` edges would assert that the copy belongs exactly where the original
 * does, which is the one thing "duplicate this" cannot know.
 *
 * **A flow is the exception, and deliberately so.** The playlist is metadata, so
 * it is copied; `applyOps` runs `synthesizeComposesEdges` on every
 * `create_node`, so the copy arrives with a `composes` edge to each node its
 * playlist plays. That is not a leak to be plugged: a flow holding a playlist
 * with no `composes` edges fails `playlist-composes-coherence`, so the only
 * alternatives are a copy that is invalid or a copy with an empty playlist —
 * i.e. not a copy. The consequence to know is that duplicating a flow gives
 * every view it plays a second parent, and any map drawn from `composes` that
 * reaches the copy will show that second branch.
 *
 * `structuredClone` of the whole node, not a spread: the panel patches metadata
 * by spreading it and every value editor writes arrays in place, so a shallow
 * copy would leave the two nodes sharing a `values` array — and, one level up,
 * the same `platforms` array — and let an edit to one silently rewrite the
 * other.
 *
 * What it keeps is not an oversight either: `status`, `refs` and the
 * per-platform evidence (`platformStatuses`, `platformNotes`,
 * `platformScreenshots`) all carry over, because a duplicate is a starting
 * point rather than a blank. This is the opposite of a split, where every piece
 * starts as an idea and inherits no evidence at all (`planAcceptanceSplit`) —
 * there the original is being divided, here it is being repeated.
 */
export function duplicateNodeDraft(node: Node, named: { id: string; title: string }): Node {
  const copy = structuredClone(node);
  copy.id = named.id;
  copy.title = named.title;
  return copy;
}
