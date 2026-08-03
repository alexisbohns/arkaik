/**
 * The rules for **acceptance-first intake**, as pure functions over plain data.
 *
 * An acceptance with zero `covers` edges is not a cross-cutting NFR floating
 * above every app — it is an *idea in intake*, filed by a PM before the flows
 * and views exist, waiting to be decomposed (§ Decision 5). The model has
 * supported that since products landed: an acceptance can carry
 * `metadata.product` before it carries a single edge, and the stored key is read
 * only when it covers nothing. What was missing is the workflow — attaching an
 * idea to views and flows once they exist, and splitting one idea into several.
 *
 * Every operation returns **mutation ops** rather than performing itself, for
 * the same reason `product-editing.ts` returns plans: attaching an idea to a
 * view it created in the same gesture is two writes that must commit as one,
 * and a rule living inside a dialog is a rule this repo has no runner to assert.
 *
 * Deliberately React-free and provider-free.
 */

import type { Edge, Node } from "@/lib/data/types";
import {
  deriveNodeId,
  edgeId,
  productOf,
  VALID_EDGE_SEMANTICS,
  type MutationOp,
  type SpeciesId,
} from "@arkaik/schema";
import { coveredAnchorIds, productsOfAcceptance } from "@/lib/utils/product-scope";
import { withProductMembership } from "@/lib/utils/product-editing";

/** The species a `covers` edge may point at, read from the grammar rather than restated. */
const ANCHOR_SPECIES: readonly SpeciesId[] = VALID_EDGE_SEMANTICS.covers.map(([, target]) => target);

/** Whether this node can be the target of a `covers` edge — a view or a flow. */
export function isAnchorSpecies(species: SpeciesId): species is "view" | "flow" {
  return ANCHOR_SPECIES.includes(species);
}

/** The minimum shape these rules need of a node — never the whole thing. */
type NodeLike = Pick<Node, "id" | "species" | "metadata">;

/**
 * Attach an acceptance to an anchor it does not cover yet.
 *
 * **Empty is a real answer, and the caller must be able to tell.** Three
 * distinct situations produce no ops: the edge already exists (a second click on
 * the same candidate, or a combobox selection racing a sync), the anchor is not
 * a view or a flow (the `covers` grammar admits nothing else, and a bundle can
 * hold ids of any species), and an acceptance pointed at itself. None of them is
 * an error worth surfacing, and all three are a write that must not happen.
 */
export function planAcceptanceAttach(
  acceptance: Pick<Node, "id">,
  anchor: NodeLike,
  projectId: string,
  edges: readonly Edge[],
): MutationOp[] {
  if (anchor.id === acceptance.id) return [];
  if (!isAnchorSpecies(anchor.species)) return [];
  if (coveredAnchorIds(acceptance.id, edges).includes(anchor.id)) return [];

  return [
    {
      op: "create_edge",
      edge: {
        id: edgeId(acceptance.id, anchor.id),
        project_id: projectId,
        source_id: acceptance.id,
        target_id: anchor.id,
        edge_type: "covers",
      },
    },
  ];
}

/**
 * Detach an acceptance from one anchor.
 *
 * **Every** matching edge is deleted, not the first: `e-{source}-{target}` makes
 * a duplicate pair impossible to mint through the app, but a hand-edited or
 * half-synced bundle can carry two edges with different ids and the same
 * endpoints. Deleting one would leave the anchor on screen after the user
 * detached it, with no way to tell why.
 */
export function planAcceptanceDetach(
  acceptanceId: string,
  anchorId: string,
  edges: readonly Edge[],
): MutationOp[] {
  return edges
    .filter(
      (edge) =>
        edge.edge_type === "covers" && edge.source_id === acceptanceId && edge.target_id === anchorId,
    )
    .map((edge) => ({ op: "delete_edge", edge_id: edge.id }));
}

/**
 * The product a node created *for* this acceptance should be born into.
 *
 * The one answer that keeps an idea where its author filed it. Anchors govern
 * membership, so a view created with no product would derive an empty membership
 * for the acceptance covering it and drop the whole thing back into triage — the
 * user watches the idea they just decomposed leave the scope they were standing
 * in, which is the exact failure `NewAcceptanceForm` was built to stop.
 *
 * `null` when the acceptance resolves to no product (it is in triage already, so
 * there is nothing to inherit) **or to several** (an acceptance spanning two apps
 * is a warning state, not a mandate to pick one of them for a node the user has
 * not been asked about).
 */
export function inheritedProductFor(
  acceptance: NodeLike,
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): string | null {
  const products = productsOfAcceptance(acceptance, edges, nodesById);
  if (products.size !== 1) return null;
  return [...products][0];
}

/** A new anchor and the edge attaching it — the node is returned so a caller can navigate to it. */
export interface AnchorCreationPlan {
  node: Node;
  ops: MutationOp[];
}

/**
 * Create a view or flow and attach this acceptance to it, as one write.
 *
 * `platforms: []` matches the other create-from-a-panel path (`onCreateNode`):
 * a node minted mid-gesture states no platform availability it has not been
 * asked about, and the panel that opens next is where that gets said.
 *
 * Returns `null` for a blank title rather than minting a hash-suffixed id for an
 * untitled node — the combobox only offers the action when something is typed,
 * and a whitespace-only title reaching here is a mis-click, not an intent.
 */
export function planAnchorForAcceptance(
  acceptance: Node,
  species: "view" | "flow",
  title: string,
  projectId: string,
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): AnchorCreationPlan | null {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const product = inheritedProductFor(acceptance, edges, nodesById);
  const metadata = withProductMembership(undefined, product);

  const node: Node = {
    id: deriveNodeId(species, trimmed, nodesById.keys()),
    project_id: projectId,
    species,
    title: trimmed,
    status: "idea",
    platforms: [],
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };

  return {
    node,
    ops: [
      { op: "create_node", node },
      ...planAcceptanceAttach(acceptance, node, projectId, edges),
    ],
  };
}

/**
 * Whether attaching this anchor would move the acceptance *into* triage.
 *
 * The interaction the spec flagged as worth designing around: an acceptance
 * anchored only to unassigned views or flows derives an empty membership and
 * lands under "All products" whatever its own stored key says. That falls
 * straight out of anchors-first and is deliberate — but it means "attach to a
 * view" can quietly undo the product the idea was filed under, so the surface
 * says so rather than letting the user discover it in a list that no longer
 * holds their acceptance.
 *
 * It is true in exactly one situation, which is why it is three tests and not a
 * simulated re-derivation: the acceptance has no resolvable anchor yet (so its
 * membership is the stored key), that key names a product, and the anchor
 * arriving names none. Once an acceptance *does* have an anchor carrying a
 * product, adding an unassigned one cannot empty the union — and if its current
 * membership is already empty there is nothing left to lose. A project
 * declaring no products answers `false` throughout, since nothing there names a
 * product at all.
 */
export function attachEmptiesMembership(
  acceptance: NodeLike,
  anchor: NodeLike,
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): boolean {
  if (productOf(anchor) !== null) return false;
  if (coveredAnchorIds(acceptance.id, edges).some((id) => nodesById.has(id))) return false;
  return productsOfAcceptance(acceptance, edges, nodesById).size > 0;
}

/**
 * The pieces a split will actually produce: trimmed, blank-free, duplicate-free.
 *
 * Duplicates are dropped case-insensitively because two pieces with the same
 * title are two acceptances the reader cannot tell apart, and `deriveNodeId`
 * would hand the second one a `-2` suffix that reads as an accident. The first
 * spelling wins, so the row the user typed first is the one that survives.
 */
export function splitPieces(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  const pieces: string[] = [];
  for (const title of titles) {
    const trimmed = title.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pieces.push(trimmed);
  }
  return pieces;
}

/**
 * Split one acceptance into several, preserving the product across the split.
 *
 * **The first piece renames the original in place.** The alternative — creating
 * n new acceptances and leaving or deleting the original — either strands a
 * parent that now says the same thing as its children, or throws away the node's
 * id, its journal, and every edge pointing at it. Renaming keeps the split
 * *inside* the thing being split: one of the pieces is the acceptance the user
 * started from, and the rest are new.
 *
 * **Both halves of membership are carried, because only carrying both preserves
 * it.** The stored `metadata.product` goes onto every new piece — that is the
 * answer for an idea still in intake — *and* so do the original's `covers`
 * edges, because anchors govern the moment they exist. Copying the key alone
 * would split an anchored acceptance into pieces that all land in triage;
 * copying the anchors alone would split an intake idea into pieces that lose the
 * product it was filed under. The issue asks for the product to survive the
 * split, and in this model that is two things, not one.
 *
 * **What is deliberately not copied.** Gherkin — the How is the one field that
 * is *about* the specific piece, and duplicating it would assert the same
 * scenario n times. Per-platform statuses, notes and screenshots — evidence a
 * new piece has not earned. And status: every acceptance in this app is born an
 * idea, whatever it was split out of, so a split of a live acceptance yields
 * pieces that still have to be verified.
 *
 * Fewer than two pieces returns no ops. A "split" into one is a rename, and the
 * title field already does that.
 */
export function planAcceptanceSplit(
  original: Node,
  titles: readonly string[],
  projectId: string,
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): MutationOp[] {
  const pieces = splitPieces(titles);
  if (pieces.length < 2) return [];

  const [first, ...rest] = pieces;
  const ops: MutationOp[] = [];

  if (first !== original.title) {
    ops.push({ op: "update_node", node_id: original.id, patch: { title: first } });
  }

  // Ids minted in this batch are added as they are taken. `deriveNodeId` can
  // only disambiguate against what it is given, and two pieces whose titles
  // kebab-case identically — "Export as PDF" and "Export as pdf" survive
  // `splitPieces` only if they differ, but "Export/PDF" and "Export PDF" do not —
  // would otherwise both claim the same id and the batch would fail as a
  // duplicate_node.
  const taken = new Set(nodesById.keys());
  // Resolvable anchors only, the same filter `productsOfAcceptance` and
  // `groupAcceptancesByAnchor` apply. Copying a dangling `covers` edge onto each
  // new piece would multiply one broken reference by the number of pieces —
  // `applyOps` does not check that an edge's endpoints exist, so nothing
  // downstream would refuse it.
  const anchorIds = coveredAnchorIds(original.id, edges).filter(
    (id) => id !== original.id && nodesById.has(id),
  );
  const storedProduct = productOf(original);
  const values = original.metadata?.values;

  for (const title of rest) {
    const id = deriveNodeId("acceptance", title, taken);
    taken.add(id);

    const metadata = withProductMembership(values && values.length > 0 ? { values } : undefined, storedProduct);
    const node: Node = {
      id,
      project_id: projectId,
      species: "acceptance",
      title,
      status: "idea",
      platforms: [...original.platforms],
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };

    ops.push({ op: "create_node", node });
    for (const anchorId of anchorIds) {
      ops.push({
        op: "create_edge",
        edge: {
          id: edgeId(id, anchorId),
          project_id: projectId,
          source_id: id,
          target_id: anchorId,
          edge_type: "covers",
        },
      });
    }
  }

  return ops;
}
