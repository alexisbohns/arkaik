import type { Node } from "@/lib/data/types";

/**
 * A new node carrying everything this one says about itself, under a new id.
 *
 * **It copies no edges**, and the caller writes none. A duplicated acceptance
 * therefore covers nothing and lands unanchored in intake, which is the honest
 * state for a record whose anchors have not been chosen — and the panel the copy
 * opens into is the one place to choose them. Copying the `covers` edges would
 * assert that the copy belongs exactly where the original does, which is the one
 * thing "duplicate this" cannot know.
 *
 * `structuredClone` on the metadata, not a spread: the panel patches metadata by
 * spreading it and every value editor writes arrays in place, so a shallow copy
 * would leave the two nodes sharing a `values` array and let an edit to one
 * silently rewrite the other.
 *
 * The id is a parameter rather than minted here. Minting needs `generateNodeId`,
 * which imports `@arkaik/schema`, and this module is loaded in tests by
 * `loadUtil`, which rewrites nothing — so a value import here would fail at
 * `require`. The caller has the existing ids anyway; it is the only one that does.
 */
export function duplicateNodeDraft(node: Node, newId: string): Node {
  return {
    ...node,
    id: newId,
    title: `${node.title} (copy)`.trim(),
    metadata: node.metadata ? structuredClone(node.metadata) : node.metadata,
  };
}
