"use client";

import { useEffect, useRef, useState } from "react";
import type { Node, Edge, PlatformStatusMap } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { ValueId } from "@arkaik/schema";
import { STATUSES } from "@/lib/config/statuses";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";
import { productsOfAcceptance } from "@/lib/utils/product-scope";
import { withProductMembership } from "@/lib/utils/product-editing";
import { productOf } from "@arkaik/schema";
import { ProductPicker } from "@/components/panels/ProductPicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_ICONS, STATUS_STYLES, SPECIES_ICONS } from "@/components/graph/nodes/node-styles";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { ValuePicker } from "@/components/values/ValuePicker";

interface AcceptanceEditorProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  /** The surface's product scope — decides how many platform tabs this editor has. */
  scope: ProductScope;
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onNavigate?: (node: Node) => void;
}

export function AcceptanceEditor({ node, allNodes, allEdges, scope, onUpdate, onNavigate }: AcceptanceEditorProps) {
  const [gherkin, setGherkin] = useState(node.metadata?.gherkin ?? "");
  const nodeRef = useRef(node);
  useEffect(() => { nodeRef.current = node; }, [node]);
  // Debounce-save gherkin. The effect reschedules on every keystroke and clears
  // its timer on rechange/unmount, so the save closure is always fresh. It reads
  // the LATEST node via nodeRef at fire time, so a concurrent values/status edit
  // isn't clobbered by the provider's shallow metadata merge (mirrors NodeFields).
  useEffect(() => {
    if (gherkin === (nodeRef.current.metadata?.gherkin ?? "")) return;
    const t = setTimeout(() => {
      onUpdate(nodeRef.current.id, { metadata: { ...nodeRef.current.metadata, gherkin } });
    }, 350);
    return () => clearTimeout(t);
  }, [gherkin, onUpdate]);

  const statuses: PlatformStatusMap = getEditablePlatformStatuses(node);
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const coveredAnchors = allEdges
    .filter((e) => e.edge_type === "covers" && e.source_id === node.id)
    .map((e) => nodesById.get(e.target_id))
    .filter((n): n is Node => Boolean(n));

  function patchMetadata(next: Record<string, unknown>) {
    onUpdate(node.id, { metadata: { ...node.metadata, ...next } });
  }

  /* --- Product (§ D5) ------------------------------------------------------
   *
   * The control is **always** shown once the project declares products, but what
   * it displays depends on whether this acceptance covers anything.
   *
   * `productsOfAcceptance` is the authority and is asked rather than
   * re-implemented: anchors govern when there are any, and the stored key is the
   * answer only for an acceptance that covers nothing — the intake case, where a
   * PM files an idea knowing which app it is for long before they know which
   * screens it needs. Reading the stored value first would let a stale key
   * out-vote the graph it is attached to.
   *
   * So when anchors exist the trigger shows the **derived** product(s) — the live
   * answer every read surface already agrees on — via `displayOverride`, while
   * the select still edits and reports the stored fallback. The two rejected
   * alternatives are recorded in the spec: hiding the control the moment a
   * `covers` edge appears makes a field materialise and vanish as edges change,
   * and treating it as a plain editable field lets a user set a value the graph
   * silently ignores.
   *
   * `anchorCount` counts *resolvable* anchors, not `covers` edges, because that
   * is what the derivation counts: a dangling edge to a node this snapshot does
   * not hold is skipped by `productsOfAcceptance`, and a hint promising "the 2
   * nodes it covers" decide the answer when only one of them exists would be
   * telling the reader something false about their own graph.
   */
  const anchorCount = coveredAnchors.length;
  const derivedProducts = productsOfAcceptance(node, allEdges, nodesById);
  // Declaration order, then ids the project no longer declares — the ordering
  // `productLabelsOfNode` applies, for the same reason: a Set iterates in
  // insertion order, which here is whatever the anchor list happened to hit
  // first, and a label pair that flips between renders of an unchanged graph
  // reads as a change.
  const derivedLabels = [
    ...[...scope.productsById.keys()].filter((id) => derivedProducts.has(id)),
    ...[...derivedProducts].filter((id) => !scope.productsById.has(id)),
  ]
    .map((id) => {
      const title = scope.productsById.get(id)?.title;
      return typeof title === "string" && title.trim() !== "" ? title : id;
    })
    .join(", ");
  const anchorNoun = `${anchorCount} node${anchorCount === 1 ? "" : "s"}`;

  return (
    <div className="px-6 flex flex-col gap-5">
      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Status</span>
        <Select value={node.status} onValueChange={(v) => onUpdate(node.id, { status: v as StatusId })}>
          <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => {
              const Icon = STATUS_ICONS[s.id];
              return <SelectItem key={s.id} value={s.id}><span className="inline-flex items-center gap-2"><Icon className={`size-3.5 ${STATUS_STYLES[s.id].badge}`} />{s.label}</span></SelectItem>;
            })}
          </SelectContent>
        </Select>
      </section>

      {scope.productsById.size > 0 && (
        <section>
          <ProductPicker
            products={[...scope.productsById.values()]}
            value={productOf(node)}
            // `onUpdate` directly rather than `patchMetadata`: unassigning must
            // *remove* the key (`withProductMembership` owns that rule — a stored
            // `product: ""` names a product that cannot exist), and a spread
            // merge can only ever add or overwrite one. The rest of the metadata
            // — gherkin, values, platformStatuses — is carried through by
            // `withProductMembership` itself, which is what `patchMetadata`
            // would otherwise have been here for.
            onChange={(nextProduct) =>
              void onUpdate(node.id, { metadata: withProductMembership(node.metadata, nextProduct) })
            }
            label={anchorCount > 0 ? "Product (from what it covers)" : "Product"}
            // Only when anchored: unanchored, the stored value *is* the answer,
            // and overriding its display with itself would be a lie by ceremony.
            displayOverride={
              anchorCount > 0 ? { text: derivedLabels || "Unassigned" } : undefined
            }
            hint={
              anchorCount > 0
                ? derivedLabels
                  ? `This acceptance belongs to ${derivedLabels}, taken from the ${anchorNoun} it covers. The value you set here applies only if it stops covering anything.`
                  : `The ${anchorNoun} this covers have no product yet, so it appears under All products. The value you set here applies only if it stops covering anything.`
                : "This acceptance covers nothing, so its product is whatever you set here."
            }
          />
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Gherkin — the How (one Given/When/Then)</span>
        <textarea
          value={gherkin}
          onChange={(e) => setGherkin(e.target.value)}
          rows={3}
          placeholder="When I'm on …, Then …"
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Values — the Why</span>
        <ValuePicker selected={node.metadata?.values ?? []} onChange={(values: ValueId[]) => patchMetadata({ values })} />
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Per-platform status</span>
        {/* The scope's MENU, not `scopedPlatforms(node, scope)` — see
            `NodeDetailPanel`'s `PlatformVariantsSection`. Shape decisions read
            `scope.platforms`; per-node facts read `scopedPlatforms`. */}
        <PlatformVariants
          platforms={scope.platforms}
          statuses={statuses}
          notes={node.metadata?.platformNotes}
          screenshots={node.metadata?.platformScreenshots}
          onStatusChange={(platform: PlatformId, value) => {
            const next = { ...statuses };
            if (value) next[platform] = value; else delete next[platform];
            patchMetadata({ platformStatuses: next });
          }}
          onNotesChange={(platform: PlatformId, value) => patchMetadata({ platformNotes: { ...node.metadata?.platformNotes, [platform]: value } })}
          onScreenshotChange={(platform: PlatformId, value) => patchMetadata({ platformScreenshots: { ...node.metadata?.platformScreenshots, [platform]: value } })}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Covers</span>
        {coveredAnchors.length === 0 ? (
          <p className="text-xs text-muted-foreground">Unanchored (covers nothing).</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {coveredAnchors.map((anchor) => {
              const Icon = SPECIES_ICONS[anchor.species];
              return (
                <li key={anchor.id}>
                  <button type="button" className="inline-flex items-center gap-2 text-sm hover:underline" onClick={() => onNavigate?.(anchor)}>
                    <Icon className="size-3.5 text-muted-foreground" /> {anchor.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
