"use client";

import { useEffect, useRef, useState } from "react";
import { SplitIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Node, Edge, PlatformStatusMap } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { ValueId } from "@arkaik/schema";
import { STATUSES } from "@/lib/config/statuses";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";
import { productLabels, productsOfAcceptance } from "@/lib/utils/product-scope";
import { withProductMembership } from "@/lib/utils/product-editing";
import { attachEmptiesMembership } from "@/lib/utils/acceptance-intake";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { productOf } from "@arkaik/schema";
import { ProductPicker } from "@/components/panels/ProductPicker";
import { NodeSearchCombobox } from "@/components/panels/NodeSearchCombobox";
import { SplitAcceptanceDialog } from "@/components/panels/SplitAcceptanceDialog";
import { Button } from "@/components/ui/button";
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
  /**
   * The decompose gestures — attach, detach, create-and-attach, split.
   *
   * Absent on a surface whose panels are read-only, and then the Covers list is
   * exactly the list it has always been. Present, and this editor becomes the
   * place an idea filed with no anchor gets turned into one that has them.
   */
  intake?: AcceptanceIntake;
}

export function AcceptanceEditor({ node, allNodes, allEdges, scope, onUpdate, onNavigate, intake }: AcceptanceEditorProps) {
  const [gherkin, setGherkin] = useState(node.metadata?.gherkin ?? "");
  const [splitOpen, setSplitOpen] = useState(false);
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

  /**
   * Run one intake gesture, reporting a failure instead of swallowing it.
   *
   * Every one of them is a write to a store the panel does not own, and a
   * rejected batch otherwise leaves the list looking unchanged with nothing
   * saying why — the same treatment `AcceptancesSection` gives its create.
   */
  async function run(action: () => Promise<void>, failure: string) {
    try {
      await action();
    } catch (err) {
      toast.error(failure);
      console.error(err);
    }
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
  // `productLabels`, not an inline sort-and-title: the declaration ordering and
  // the title-falls-back-to-the-id rule are `product-scope`'s to hold, and a
  // second copy here is a copy that drifts. Not `productLabelsOfNode`, which
  // would re-enter `productsOfNode` and demand a `usageIndex` this editor has no
  // reason to build for a species that never consults one.
  const derivedLabels = productLabels(derivedProducts, scope).join(", ");
  const anchorNoun = `${anchorCount} node${anchorCount === 1 ? "" : "s"}`;
  /**
   * A stored key naming a product the project no longer declares — the stranded
   * remnant of a rename or a deletion. Only meaningful when nothing is anchored,
   * because with anchors the stored key is inert anyway and the hint already
   * says so.
   */
  const storedProductId = productOf(node);
  const staleProductId =
    anchorCount === 0 && storedProductId !== null && !scope.productsById.has(storedProductId)
      ? storedProductId
      : null;

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
                : staleProductId
                  // The stored key names a product the project no longer
                  // declares, so the picker degrades its trigger to
                  // "Unassigned" — and the id is about to be overwritten the
                  // moment the control is touched. Echoing it is the only trace
                  // left of the rename or deletion that stranded it, and it is
                  // what lets a reader recognise their own product rather than
                  // silently accept an unassignment they never asked for. Same
                  // sentence `NodeDetailPanel` uses, for the same state.
                  ? `Assigned to "${staleProductId}", which this project no longer declares — it appears under All products only.`
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
          <p className="text-xs text-muted-foreground">
            {intake
              ? "Unanchored — an idea in intake. Attach it to a view or a flow below."
              : "Unanchored (covers nothing)."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {coveredAnchors.map((anchor) => {
              const Icon = SPECIES_ICONS[anchor.species];
              return (
                <li key={anchor.id} className="flex items-center gap-1">
                  <button type="button" className="inline-flex flex-1 items-center gap-2 text-left text-sm hover:underline" onClick={() => onNavigate?.(anchor)}>
                    <Icon className="size-3.5 text-muted-foreground" /> {anchor.title}
                  </button>
                  {intake && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={`Stop covering ${anchor.title}`}
                      onClick={() => void run(() => intake.detach(node, anchor.id), "Couldn't detach that node.")}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {intake && (
          <AttachAnchorRow
            node={node}
            allNodes={allNodes}
            allEdges={allEdges}
            nodesById={nodesById}
            hasProducts={scope.productsById.size > 0}
            intake={intake}
            run={run}
          />
        )}
      </section>

      {intake && (
        <section className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Decompose</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setSplitOpen(true)}
          >
            <SplitIcon className="size-4" /> Split into several…
          </Button>
          <p className="text-xs text-muted-foreground">
            One acceptance states one thing. Split when the idea has grown into several.
          </p>
          <SplitAcceptanceDialog
            open={splitOpen}
            onOpenChange={setSplitOpen}
            title={node.title}
            anchorCount={anchorCount}
            // Not `run`: the dialog has to know whether the write landed, so
            // that a failure leaves the rows on screen instead of discarding
            // them. Reported here all the same, then rethrown.
            onSubmit={async (titles) => {
              try {
                await intake.split(node, titles);
              } catch (err) {
                toast.error("Couldn't split the acceptance.");
                console.error(err);
                throw err;
              }
            }}
          />
        </section>
      )}
    </div>
  );
}

interface AttachAnchorRowProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  nodesById: Map<string, Node>;
  /**
   * Whether the project declares any product at all. The triage warning below
   * is gated on it rather than on the membership computation alone: a project
   * that has never heard of products can still carry a stray `metadata.product`
   * from an import, and a toast naming "All products" there would introduce a
   * word the whole feature promises such a project never sees.
   */
  hasProducts: boolean;
  intake: AcceptanceIntake;
  run: (action: () => Promise<void>, failure: string) => Promise<void>;
}

/**
 * Attach this acceptance to a view or a flow — one that exists, or one created
 * in the same gesture.
 *
 * The species select plus `NodeSearchCombobox` is the shape the playlist editor
 * and the insert dialog already use for "an existing node, or a new one by that
 * name", and reusing it means the create affordance appears under exactly the
 * same rule everywhere: only once something is typed that no node of that
 * species already answers to.
 *
 * **Attaching an unassigned anchor is allowed and announced.** An acceptance
 * anchored only to unassigned views derives an empty membership, so this gesture
 * can move an idea filed under one app back into the "All products" inbox
 * (§ Decision 5, the interaction the spec left open). Blocking it would be
 * wrong — the anchor is the truth and triage is the honest place for an
 * acceptance whose anchors are themselves in triage — but letting it happen in
 * silence means watching the acceptance vanish from the scope you were standing
 * in. So it is written, and then said. A node created here inherits the
 * acceptance's product precisely so the common path never trips this.
 */
function AttachAnchorRow({ node, allNodes, allEdges, nodesById, hasProducts, intake, run }: AttachAnchorRowProps) {
  const [species, setSpecies] = useState<"view" | "flow">("view");

  function announceTriage(anchor: Pick<Node, "id" | "species" | "title" | "metadata">) {
    if (!hasProducts) return;
    // Evaluated against the edges as they were BEFORE the write — the predicate
    // asks what this attach did, and the answer needs the graph it acted on.
    if (!attachEmptiesMembership(node, anchor, allEdges, nodesById)) return;
    toast.warning(`"${anchor.title}" has no product, so this acceptance now appears under All products only.`);
  }

  return (
    <div className="mt-1 grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-center">
      <Select value={species} onValueChange={(value) => setSpecies(value as "view" | "flow")}>
        <SelectTrigger aria-label="Anchor species">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="view">View</SelectItem>
          <SelectItem value="flow">Flow</SelectItem>
        </SelectContent>
      </Select>
      <NodeSearchCombobox
        species={species}
        allNodes={allNodes}
        onSelect={(anchorId) => {
          const anchor = nodesById.get(anchorId);
          if (!anchor) return;
          void run(async () => {
            await intake.attach(node, anchor);
            announceTriage(anchor);
          }, "Couldn't attach that node.");
        }}
        onCreate={(title) =>
          run(async () => {
            const created = await intake.createAnchor(node, species, title);
            if (created) toast.success(`Created "${created.title}" and attached it.`);
          }, `Couldn't create the ${species}.`)
        }
      />
    </div>
  );
}
