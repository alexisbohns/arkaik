"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { PanelSection } from "@/components/panels/PanelSection";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import type { Node, Edge, JournalEvent } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { SPECIES } from "@/lib/config/species";
import { SpeciesBadge, EntityId } from "@/components/graph/nodes/EntityBadges";
import { RefList } from "@/components/graph/nodes/RefBadges";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { PlaylistEditor } from "@/components/panels/PlaylistEditor";
import { AcceptanceEditor } from "@/components/panels/AcceptanceEditor";
import { AcceptancesSection } from "@/components/panels/AcceptancesSection";
import { DecisionEditor } from "@/components/panels/DecisionEditor";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import {
  computeFlowPlatformRollup,
  getEditablePlatformStatuses,
  scopedRollupPlatforms,
} from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";
import { ProductPicker } from "@/components/panels/ProductPicker";
import { withProductMembership } from "@/lib/utils/product-editing";
import { normalizeBlockedBy, withBlockedBy } from "@/lib/utils/blocked";
import { productOf } from "@arkaik/schema";
import { findWhereUsed } from "@/lib/utils/where-used";
import { computeNodeTimeline } from "@/lib/utils/journal";
import { FeedRow } from "@/components/journal/FeedRow";

interface NodeDetailPanelProps {
  node: Node;
  /**
   * The surface's product scope. Every platform-bearing section below reads its
   * shape from this — tabs at two or more effective platforms, a single status
   * at one or zero — so the panel says the same thing the Pyramid and the
   * Acceptances matrix say about the same node.
   */
  scope: ProductScope;
  /** Platform tab the variants section opens on (e.g. the clicked Delivery item's platform). */
  initialPlatform?: PlatformId;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  allNodes?: Node[];
  allEdges?: Edge[];
  journal?: JournalEvent[];
  onNavigate?: (node: Node) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  /** The acceptance decompose gestures, on surfaces whose panels can write. */
  intake?: AcceptanceIntake;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
}

interface NodeFieldsProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /** For resolving `blocked_by` to a node title/link; the panel's own node-link affordance. */
  allNodes?: Node[];
  onNavigate?: (node: Node) => void;
}

function NodeFields({ node, onUpdate, allNodes, onNavigate }: NodeFieldsProps) {
  const AUTOSAVE_DELAY_MS = 350;
  // Per-mount, because the panel stack keeps hidden panels mounted: two nodes
  // open at once means two "Status" fields in one document, and a hand-written
  // id would point both labels at the first one's select.
  const fieldId = useId();
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [status, setStatus] = useState<StatusId>(node.status);
  const [blockedBy, setBlockedBy] = useState(node.metadata?.blocked_by ?? "");
  const lastSavedTitleRef = useRef(node.title);
  const lastSavedDescriptionRef = useRef(node.description ?? "");
  const lastSavedBlockedByRef = useRef(normalizeBlockedBy(node.metadata?.blocked_by) ?? "");
  const titleEditRef = useRef<HTMLDivElement>(null);
  const descriptionEditRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (titleEditRef.current) titleEditRef.current.textContent = node.title;
    if (descriptionEditRef.current) descriptionEditRef.current.textContent = node.description ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const usesSingleStatusField = node.species === "data-model" || node.species === "api-endpoint";

  useEffect(() => {
    if (title === lastSavedTitleRef.current) {
      return;
    }

    const timeout = setTimeout(() => {
      lastSavedTitleRef.current = title;
      void onUpdate?.(node.id, { title });
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [title, node.id, onUpdate]);

  useEffect(() => {
    if (description === lastSavedDescriptionRef.current) {
      return;
    }

    const timeout = setTimeout(() => {
      const trimmed = description.trim();
      const normalized = trimmed.length > 0 ? trimmed : "";
      lastSavedDescriptionRef.current = normalized;
      void onUpdate?.(node.id, { description: normalized || undefined });
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [description, node.id, onUpdate]);

  // Same debounced autosave as the description above, compared on the
  // NORMALIZED value so whitespace-only edits never fire a no-op wholesale
  // metadata write. `withBlockedBy` owns the "empty means *absent*, never
  // `blocked_by: \"\"`" rule and carries the rest of the metadata through
  // untouched — a patch replaces `metadata` wholesale.
  useEffect(() => {
    const normalized = normalizeBlockedBy(blockedBy) ?? "";
    if (normalized === lastSavedBlockedByRef.current) {
      return;
    }

    const timeout = setTimeout(() => {
      lastSavedBlockedByRef.current = normalized;
      void onUpdate?.(node.id, { metadata: withBlockedBy(node.metadata, normalized || null) });
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [blockedBy, node.id, node.metadata, onUpdate]);

  // When the value names a node this panel can see, surface its title — and
  // navigate through the same affordance every other node link here uses.
  const blockedNode = allNodes?.find((n) => n.id === normalizeBlockedBy(blockedBy));

  function handleStatusChange(value: StatusId) {
    setStatus(value);
    onUpdate?.(node.id, { status: value });
  }

  function handleTitlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function handleDescriptionPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  return (
    <div className="px-6 flex flex-col gap-5">
      <div className="flex flex-col">
        <div
          ref={titleEditRef}
          contentEditable
          suppressContentEditableWarning
          onPaste={handleTitlePaste}
          onInput={(e) => {
            setTitle(e.currentTarget.textContent || "");
          }}
          className="text-lg font-semibold text-foreground outline-none empty:before:text-muted-foreground empty:before:content-['Node_title'] whitespace-pre-wrap break-words"
          aria-label="Node title (editable)"
        />
        <div
          ref={descriptionEditRef}
          contentEditable
          suppressContentEditableWarning
          onPaste={handleDescriptionPaste}
          onInput={(e) => {
            setDescription(e.currentTarget.textContent || "");
          }}
          className="text-sm text-foreground leading-relaxed outline-none empty:before:text-muted-foreground empty:before:content-['Add_a_description...'] whitespace-pre-wrap break-words"
          aria-label="Description (editable)"
        />
      </div>
      {usesSingleStatusField && (
        <Field label="Status" htmlFor={`${fieldId}-status`}>
          <Select value={status} onValueChange={(v) => handleStatusChange(v as StatusId)}>
            <SelectTrigger id={`${fieldId}-status`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <StatusSelectItems />
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label="Blocked by" htmlFor={`${fieldId}-blocked-by`}>
        <Input
          id={`${fieldId}-blocked-by`}
          value={blockedBy}
          onChange={(event) => setBlockedBy(event.target.value)}
          placeholder="Node id or free text — empty means not blocked"
        />
        {blockedNode && (
          onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate(blockedNode)}
              className="self-start text-xs text-muted-foreground hover:text-foreground hover:underline text-left"
            >
              {blockedNode.title}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">{blockedNode.title}</span>
          )
        )}
      </Field>
    </div>
  );
}

interface ProductSectionProps {
  node: Node;
  scope: ProductScope;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
}

/**
 * Which product this node belongs to — the edit path for the key the read
 * surfaces already scope on.
 *
 * **Renders nothing at all in a project that declares no products.** Not a
 * disabled field, not an empty select, not the word "product": `productsById` is
 * empty exactly when the project has never heard of the concept, and the whole
 * feature's guarantee is that such a project looks byte-identical to how it did
 * before products existed. The guard lives here rather than inside
 * `ProductPicker` because only the call site knows which layout to omit.
 *
 * **Flows and views only, though `PRODUCT_MEMBERSHIP_SPECIES` also lists
 * acceptances.** An acceptance already gets a picker from `AcceptanceEditor`,
 * which is the only place that can say the true thing about it — its membership
 * is derived from its `covers` anchors (§ D5) and this control cannot express
 * that. Testing `PRODUCT_MEMBERSHIP_SPECIES` here, as the plan's sketch did,
 * would put two pickers on the same acceptance panel disagreeing about the same
 * node. Data models and API endpoints derive membership from their consumers and
 * are excluded for the original reason: a stored key on one is a value every read
 * surface ignores and the validator warns about
 * (`product-membership-wrong-species`).
 *
 * Without `onUpdate` there is no save path, so the control does not render —
 * showing an assignment that silently fails to persist is worse than showing
 * none. The species-scoped read-only surfaces (the Library card, the graph node)
 * already report membership for panels opened that way.
 */
function ProductSection({ node, scope, onUpdate }: ProductSectionProps) {
  if (scope.productsById.size === 0) return null;
  if (node.species !== "flow" && node.species !== "view") return null;
  if (!onUpdate) return null;

  const stored = productOf(node);
  // Whether the membership RESOLVES, not merely whether one is stored. A key
  // naming a product the project no longer declares degrades to "Unassigned" in
  // the trigger (`ProductPicker` displays it, deliberately, rather than healing
  // it), so keying the hint off `stored === null` would suppress the explanation
  // in exactly the case that needs one most: the trigger says Unassigned and
  // nothing on screen says why.
  const resolved = stored !== null && scope.productsById.has(stored);
  // The two unresolved cases get different sentences because they are different
  // situations and have different fixes. Never-assigned is a normal state — the
  // node is in triage and the hint just says where to find it. A stale key is a
  // fault: something named a product that no longer exists, the id is the only
  // trace of it left, and echoing it back is what lets a reader recognise a
  // rename or a deletion they can undo. Collapsing both into one sentence would
  // throw that id away, and it is unrecoverable from the UI once the select is
  // touched.
  const hint = resolved
    ? undefined
    : stored === null
      ? "Unassigned nodes appear under All products only."
      : `Assigned to "${stored}", which this project no longer declares — it appears under All products only.`;

  return (
    <div className="px-6">
      <ProductPicker
        products={[...scope.productsById.values()]}
        value={stored}
        // Routed through `withProductMembership`, never assembled here: it owns
        // the "unassigned means *absent*, never `product: \"\"`" rule and it
        // carries the rest of the metadata (platformStatuses, notes,
        // screenshots) through untouched — a patch replaces `metadata` wholesale.
        onChange={(nextProduct) =>
          void onUpdate(node.id, { metadata: withProductMembership(node.metadata, nextProduct) })
        }
        hint={hint}
      />
    </div>
  );
}

interface InvocationSectionProps {
  node: Node;
  allNodes: Node[];
  onNavigate: (node: Node) => void;
}

function InvocationSection({ node, allNodes, onNavigate }: InvocationSectionProps) {
  const usages = findWhereUsed(node.id, allNodes);

  if (usages.length === 0) {
    return null;
  }

  return (
    <PanelSection title="Invocation">
      <div className="flex flex-col gap-0.5">
        {usages.map((flow) => (
          <ConnectionItem
            key={flow.id}
            badge={flow.id}
            node={flow}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </PanelSection>
  );
}

function RefsSection({ node }: { node: Node }) {
  const refs = node.metadata?.refs;

  if (!refs || refs.length === 0) {
    return null;
  }

  return (
    <PanelSection title="References">
      <RefList refs={refs} />
    </PanelSection>
  );
}

interface ConnectionsSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  onNavigate: (node: Node) => void;
}

function ConnectionsSection({ node, allNodes, allEdges, onNavigate }: ConnectionsSectionProps) {
  // DecisionEditor owns decision-typed edges (supersedes/generates/impacts) for
  // a decision node itself — its "Decision links" section already lists both
  // directions (supersedes/supersededBy/generates/impacts). This section shows
  // them only from the OTHER endpoint's side, so a non-decision node can see
  // which decisions impact/generate it ("decided by") without a decision node
  // double-listing its own edges.
  const isDecisionEdge = (e: Edge) =>
    e.edge_type === "supersedes" || e.edge_type === "generates" || e.edge_type === "impacts";
  const crossLayerNodes = allEdges
    .filter((e) => e.edge_type !== "composes" && (e.source_id === node.id || e.target_id === node.id))
    .filter((e) => !(node.species === "decision" && isDecisionEdge(e)))
    .map((e) => {
      const otherId = e.source_id === node.id ? e.target_id : e.source_id;
      return allNodes.find((n) => n.id === otherId);
    })
    .filter((n): n is Node => !!n && (n.species === "data-model" || n.species === "api-endpoint" || n.species === "decision"));

  const uniqueCrossLayerNodes = [...new Map(crossLayerNodes.map((n) => [n.id, n])).values()];

  if (uniqueCrossLayerNodes.length === 0) {
    return null;
  }

  return (
    <PanelSection title="Connections">
      <div className="flex flex-col gap-0.5">
        {uniqueCrossLayerNodes.map((n) => (
          <ConnectionItem
            key={n.id}
            badge={SPECIES.find((s) => s.id === n.species)?.label ?? n.species}
            node={n}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </PanelSection>
  );
}

function ConnectionItem({
  badge,
  node,
  onNavigate,
}: {
  badge: string;
  node: Node;
  onNavigate: (node: Node) => void;
}) {
  const speciesConfig = SPECIES.find((s) => s.id === node.species);
  return (
    <button
      type="button"
      onClick={() => onNavigate(node)}
      className="flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 hover:bg-muted transition-colors w-full"
    >
      <span className="text-xs text-muted-foreground shrink-0 w-20 truncate">{badge}</span>
      <span className="flex-1 truncate">{node.title}</span>
      <span className="text-xs text-muted-foreground ml-auto shrink-0">{speciesConfig?.label ?? node.species}</span>
    </button>
  );
}

interface HistorySectionProps {
  node: Node;
  journal: JournalEvent[];
  allNodes: Node[];
}

function HistorySection({ node, journal, allNodes }: HistorySectionProps) {
  const timeline = computeNodeTimeline(journal, node.id);

  if (timeline.length === 0) {
    return null;
  }

  const nodesById = new Map(allNodes.map((n) => [n.id, n]));

  return (
    <PanelSection title="History">
      <div className="flex flex-col gap-0.5">
        {[...timeline].reverse().map((event) => (
          // No `onOpen`: this list is already inside the node's own panel, so a
          // row that navigated would navigate to where the reader is standing.
          <FeedRow key={event.id} event={event} nodesById={nodesById} />
        ))}
      </div>
    </PanelSection>
  );
}

interface PlatformVariantsSectionProps {
  node: Node;
  scope: ProductScope;
  initialPlatform?: PlatformId;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onZoomShot?: (platform: PlatformId) => void;
}

function PlatformVariantsSection({ node, scope, initialPlatform, onUpdate, onZoomShot }: PlatformVariantsSectionProps) {
  const rawNotes = (node.metadata?.platformNotes ?? {}) as Partial<Record<PlatformId, string>>;
  const rawStatuses = getEditablePlatformStatuses(node);
  const rawScreenshots = (node.metadata?.platformScreenshots ?? {}) as Partial<Record<PlatformId, string>>;
  // Seeded from the FULL stored maps, not the scoped ones: a note or screenshot
  // for a platform outside the effective set is not rendered and not deleted —
  // every handler below patches by spreading these, so it round-trips untouched.
  const [notes, setNotes] = useState<Partial<Record<PlatformId, string>>>(rawNotes);
  const [statuses, setStatuses] = useState(rawStatuses);
  const [screenshots, setScreenshots] = useState<Partial<Record<PlatformId, string>>>(rawScreenshots);

  function handleNotesChange(platform: PlatformId, value: string) {
    const next = { ...notes, [platform]: value };
    setNotes(next);
    onUpdate?.(node.id, {
      metadata: { ...node.metadata, platformNotes: next, platformStatuses: statuses, platformScreenshots: screenshots },
    });
  }

  function handleStatusChange(platform: PlatformId, value: StatusId | undefined) {
    let next: Partial<Record<PlatformId, StatusId>>;
    if (value === undefined) {
      // Unset - remove the status for this platform
      const rest = { ...statuses };
      delete rest[platform];
      next = rest;
    } else {
      next = { ...statuses, [platform]: value };
    }
    setStatuses(next);
    onUpdate?.(node.id, {
      metadata: { ...node.metadata, platformStatuses: next, platformNotes: notes, platformScreenshots: screenshots },
    });
  }

  function handleScreenshotChange(platform: PlatformId, value: string | undefined) {
    const next = { ...screenshots };
    if (value === undefined) {
      delete next[platform];
    } else {
      next[platform] = value;
    }
    setScreenshots(next);
    onUpdate?.(node.id, {
      metadata: { ...node.metadata, platformScreenshots: next, platformNotes: notes, platformStatuses: statuses },
    });
  }

  return (
    // `gap-3` rather than the section default: this one wraps a whole embedded
    // editor, not a field.
    <PanelSection title="Platform Variants" className="gap-3">
      {/* The scope's MENU, not `scopedPlatforms(node, scope)`. How many platform
          columns a surface shows is a shape decision, and shape decisions are the
          scope's — same input the Acceptances matrix and the Pyramid read. Per-node
          `scopedPlatforms` would answer the node's own array whenever no product is
          declared, so a web-only view would lose two tabs in a project that has
          never heard of products (§ Degenerate case guarantee).

          A caveat inherited, not introduced: a status written for a platform outside
          `node.platforms` is invisible everywhere, because `getNodePlatformStatuses`
          iterates the node's own list. The strip could always do that; it is not
          this scope's to fix. */}
      <PlatformVariants
        platforms={scope.platforms}
        statuses={statuses}
        notes={notes}
        screenshots={screenshots}
        initialPlatform={initialPlatform}
        onStatusChange={handleStatusChange}
        onNotesChange={handleNotesChange}
        onScreenshotChange={handleScreenshotChange}
        onZoomShot={onZoomShot}
      />
    </PanelSection>
  );
}

function ComputedPlatformStatusSection({
  node,
  scope,
  allNodes,
  allEdges,
}: { node: Node; scope: ProductScope; allNodes: Node[]; allEdges: Edge[] }) {
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const rollup = computeFlowPlatformRollup(node, nodesById, allNodes, allEdges);

  return (
    <PanelSection title="Computed Platform Statuses" className="gap-3">
      {/* Clamped, not replaced: a flow's rollup can count a platform the flow
          never declares (the seed's `F-swap-glyph`), and under All products that
          bar must survive. See `scopedRollupPlatforms`. */}
      <PlatformGaugeList
        rollup={rollup}
        platforms={scopedRollupPlatforms(node.platforms, rollup, scope.platforms)}
        showLabels
      />
    </PanelSection>
  );
}

/**
 * What identifies the panel, for the stack's per-panel header — species badge
 * and entity id, the chrome the `SheetHeader` used to carry. The close button
 * belongs to `PanelStack`, which owns every panel's frame.
 */
export function NodeDetailPanelHeader({ node }: { node: Node }) {
  const speciesConfig = SPECIES.find((s) => s.id === node.species);
  const speciesLabel = speciesConfig?.label ?? node.species;

  return (
    <>
      <SpeciesBadge
        species={node.species}
        label={speciesLabel}
        description={speciesConfig?.description}
        showLabel
      />
      <EntityId id={node.id} />
    </>
  );
}

/**
 * The body of one panel in the stack: every section that describes a node.
 * It renders a column inside whatever frame it is given — the stack owns the
 * chrome, the address, and the keyboard.
 */
export function NodeDetailPanel({
  node,
  scope,
  initialPlatform,
  onUpdate,
  onDelete,
  allNodes,
  allEdges,
  journal,
  onNavigate,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  intake,
  onZoomShot,
}: NodeDetailPanelProps) {
  void onDelete;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-4 pb-6">
      <NodeFields key={node.id} node={node} onUpdate={onUpdate} allNodes={allNodes} onNavigate={onNavigate} />
      <ProductSection key={`product-${node.id}`} node={node} scope={scope} onUpdate={onUpdate} />
      <RefsSection key={`refs-${node.id}`} node={node} />
      {(node.species === "view" || node.species === "flow") && allNodes && allEdges && (
        <AcceptancesSection
          key={`acceptances-${node.id}`}
          node={node}
          scope={scope}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
          onCreate={onCreateAcceptanceForAnchor}
        />
      )}
      {node.species === "acceptance" && allNodes && allEdges && onUpdate && (
        <AcceptanceEditor
          key={`acceptance-${node.id}`}
          node={node}
          scope={scope}
          allNodes={allNodes}
          allEdges={allEdges}
          onUpdate={onUpdate}
          onNavigate={onNavigate}
          intake={intake}
        />
      )}
      {node.species === "decision" && allNodes && allEdges && onUpdate && (
        <DecisionEditor
          key={`decision-${node.id}`}
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          onUpdate={onUpdate}
          onNavigate={onNavigate}
        />
      )}
      {node.species === "view" && (
        <PlatformVariantsSection
          key={`pv-${node.id}-${initialPlatform ?? ""}`}
          node={node}
          scope={scope}
          initialPlatform={initialPlatform}
          onUpdate={onUpdate}
          onZoomShot={onZoomShot ? (platform) => onZoomShot(node, platform) : undefined}
        />
      )}
      {node.species === "flow" && allNodes && allEdges && (
        <ComputedPlatformStatusSection
          key={`computed-${node.id}`}
          node={node}
          scope={scope}
          allNodes={allNodes}
          allEdges={allEdges}
        />
      )}
      {node.species === "flow" && allNodes && (
        <PlaylistEditor
          key={`playlist-${node.id}`}
          node={node}
          allNodes={allNodes}
          onUpdate={onUpdate}
          onCreateNode={onCreateNode}
        />
      )}
      {(node.species === "view" || node.species === "flow") && allNodes && onNavigate && (
        <InvocationSection
          key={`inv-${node.id}`}
          node={node}
          allNodes={allNodes}
          onNavigate={onNavigate}
        />
      )}
      {allNodes && allEdges && onNavigate && (
        <ConnectionsSection
          key={`conn-${node.id}`}
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
        />
      )}
      {journal && (
        <HistorySection
          key={`history-${node.id}`}
          node={node}
          journal={journal}
          allNodes={allNodes ?? []}
        />
      )}
    </div>
  );
}

