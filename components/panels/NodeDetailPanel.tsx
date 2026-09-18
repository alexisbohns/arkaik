"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { BlockedByField } from "@/components/panels/BlockedByField";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { PanelGroup } from "@/components/panels/PanelGroup";
import { RelationsGroup } from "@/components/panels/RelationsGroup";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import type { Node, Edge } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { SPECIES } from "@/lib/config/species";
import { SpeciesBadge, PanelHeaderEntityId } from "@/components/graph/nodes/EntityBadges";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { PlaylistEditor } from "@/components/panels/PlaylistEditor";
import { AcceptanceMembershipField } from "@/components/panels/AcceptanceMembershipField";
import { AcceptanceAuthoredFields } from "@/components/panels/AcceptanceAuthoredFields";
import { AcceptancePlatformsSection } from "@/components/panels/AcceptancePlatformsSection";
import { DecisionEditor } from "@/components/panels/DecisionEditor";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { useJournal } from "@/lib/hooks/useJournal";
import { useProjectId } from "@/lib/hooks/useProjectId";
import {
  computeFlowPlatformRollup,
  getEditablePlatformStatuses,
  scopedRollupPlatforms,
} from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";
import { ProductPicker } from "@/components/panels/ProductPicker";
import { withProductMembership } from "@/lib/utils/product-editing";
import { productOf } from "@arkaik/schema";
import { computeNodeTimeline } from "@/lib/utils/journal";
import { FeedRow } from "@/components/journal/FeedRow";
import type { FindingRow } from "@/lib/utils/quality";
import { cn } from "@/lib/utils";

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
  /**
   * Mount the History section. The section fetches the journal itself (one
   * cached read shared by every open panel), so this is only the surface's say
   * on whether the panel has a history to show at all.
   */
  history?: boolean;
  onNavigate?: (node: Node) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  /** The acceptance decompose gestures, on surfaces whose panels can write. */
  intake?: AcceptanceIntake;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
  /**
   * Every finding in the project, denormalized once by `buildFindingRows` — the
   * Findings section picks out this node's own. The whole list rather than a
   * pre-filtered one because the caller builds it once for a whole panel stack,
   * and re-filtering it per open panel is what a panel is for.
   *
   * Optional with `onOpenCriterion`, and the section is absent without both: a
   * list of findings nothing can open is a dead end.
   */
  findings?: FindingRow[];
  onOpenCriterion?: (criterionId: string, surface: string) => void;
}

interface NodeFieldsProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /** For resolving `blocked_by` to a node title/link; the panel's own node-link affordance. */
  allNodes?: Node[];
  onNavigate?: (node: Node) => void;
  /**
   * Species-specific intro fields, in the two places a species needs one.
   *
   * They sit in the intro block rather than in a group because they are what the
   * record *is*, not what it is attached to; they were only ever in a separate
   * component because that component also held four sections that have since
   * moved out to Relations and Platforms.
   *
   * Both render straight into this component's gutter and `gap-5` column, so
   * neither may carry a gutter of its own.
   */
  /** Between Status and Blocked by — the Product picker. */
  membership?: ReactNode;
  /** After Blocked by — the species' own authored fields (Gherkin, Values). */
  authored?: ReactNode;
}

function NodeFields({ node, onUpdate, allNodes, onNavigate, membership, authored }: NodeFieldsProps) {
  const AUTOSAVE_DELAY_MS = 350;
  // Per-mount, because the panel stack keeps hidden panels mounted: two nodes
  // open at once means two "Status" fields in one document, and a hand-written
  // id would point both labels at the first one's select.
  const fieldId = useId();
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [status, setStatus] = useState<StatusId>(node.status);
  const lastSavedTitleRef = useRef(node.title);
  const lastSavedDescriptionRef = useRef(node.description ?? "");
  const titleEditRef = useRef<HTMLDivElement>(null);
  const descriptionEditRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (titleEditRef.current) titleEditRef.current.textContent = node.title;
    if (descriptionEditRef.current) descriptionEditRef.current.textContent = node.description ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Views and flows are absent on purpose: they have no single status. Theirs is
  // per-platform and lives in the Platforms group, and a select here would be a
  // second answer to a question the rollup already answers.
  const usesSingleStatusField =
    node.species === "data-model" ||
    node.species === "api-endpoint" ||
    node.species === "acceptance";

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
    <div className={cn(PANEL_GUTTER, "flex flex-col gap-5")}>
      {/* `gap-1.5`, not flush: the title and the description are two different
          registers, and with no gap the description read as a second line of the
          title rather than as prose about it. They stay in one block — closer to
          each other than to anything below — which is what the outer `gap-5`
          is for. */}
      <div className="flex flex-col gap-1.5">
        <div
          ref={titleEditRef}
          contentEditable
          suppressContentEditableWarning
          onPaste={handleTitlePaste}
          onInput={(e) => {
            setTitle(e.currentTarget.textContent || "");
          }}
          className="arkaik-keep-font-size text-lg font-semibold text-foreground outline-none empty:before:text-muted-foreground empty:before:content-['Node_title'] whitespace-pre-wrap break-words"
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
      {membership}
      {/* Absent on a decision, which renders its own under "Context — why":
          see `BlockedByField`. */}
      {node.species !== "decision" && (
        <BlockedByField node={node} onUpdate={onUpdate} allNodes={allNodes} onNavigate={onNavigate} />
      )}
      {authored}
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
 * `ProductPicker` because only the call site knows which layout to omit — and it
 * stays here, not in the `membership` slot that renders this, so that all three
 * refusals below are read in one place by anyone asking "when is there no
 * Product field?".
 *
 * **Flows and views only, though `PRODUCT_MEMBERSHIP_SPECIES` also lists
 * acceptances.** An acceptance already gets a picker from
 * `AcceptanceMembershipField`, which is the only place that can say the true
 * thing about it — its membership is derived from its `covers` anchors (§ D5)
 * and this control cannot express that. Testing `PRODUCT_MEMBERSHIP_SPECIES` here, as the plan's sketch did,
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

  // No gutter of its own: this renders into `NodeFields`' `membership` slot,
  // which is already inside that component's gutter and `gap-5` column. The
  // `PANEL_GUTTER` wrapper it used to carry — from when it was a standalone
  // block in the panel body — would double-indent it against every field
  // around it.
  return (
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
  );
}

interface HistorySectionProps {
  node: Node;
  allNodes: Node[];
}

// Module-level so a panel with no node list hands the section the same empty
// array every render, and the `nodesById` memo keyed on it stays quiet.
const NO_NODES: Node[] = [];

/**
 * The node's own timeline, read from the journal by the section itself rather
 * than handed down from the page. Most pages that open node panels (the maps,
 * Library, Delivery, Acceptances) read nothing else from the journal, so
 * fetching it up there meant paying for the whole journal on every navigation
 * for a section that only shows once a panel opens. Reading here defers that
 * request to the first panel, and because every mount observes the same
 * cached query, a stack of open panels still costs one read.
 *
 * Absent only when the journal has been read and says nothing about this
 * node: while the read is in flight the section stays mounted with a one-line
 * pending state, so a panel does not grow a History section a moment after it
 * opened.
 *
 * The journal is read by the route's id, never `node.project_id`. A hosted
 * project stores the imported bundle verbatim under a server-minted `prj_…`
 * row, so its nodes keep the bundle's own project id ("pebbles", "gp"); that
 * id would route to the local provider and read an empty — or, worse, some
 * other local project's — journal. The panel only ever mounts under
 * `app/project/[id]/`, the same assumption `ProjectPanels` makes.
 */
function HistorySection({ node, allNodes }: HistorySectionProps) {
  const projectId = useProjectId();
  const { journal, loading, error } = useJournal(projectId);
  const timeline = useMemo(() => computeNodeTimeline(journal, node.id), [journal, node.id]);
  const nodesById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);

  // The group is the section's own, not the caller's, because emptiness is only
  // knowable once the journal has arrived and a bar over nothing is worse than
  // no bar.
  //
  // Nothing at all while it loads. Drawing a bar here was the obvious reading of
  // "don't let the panel jump", and it is backwards: the group opens shut, so
  // "Loading history…" is never on screen anyway, and the branch's only visible
  // effect is the bar itself — which then VANISHES on a node whose timeline
  // resolves empty. That is the jump, and it is the worse direction. A bar
  // arriving late at the foot of a panel is something appearing; a bar
  // disappearing from under a reader is something breaking.
  if (loading) {
    return null;
  }

  // An error keeps its bar, unlike loading: it is terminal rather than
  // transient, so nothing will pull it back out from under the reader, and it
  // is the one state with something to say that is worth opening the group for.
  if (error) {
    return (
      <PanelGroup title="History" defaultOpen={false}>
        <p className={cn(PANEL_GUTTER, "text-xs text-muted-foreground")}>{error}</p>
      </PanelGroup>
    );
  }

  if (timeline.length === 0) {
    return null;
  }

  return (
    <PanelGroup title="History" defaultOpen={false}>
      <div className={cn(PANEL_GUTTER, "flex flex-col gap-0.5")}>
        {[...timeline].reverse().map((event) => (
          // No `onOpen`: this list is already inside the node's own panel, so a
          // row that navigated would navigate to where the reader is standing.
          <FeedRow key={event.id} event={event} nodesById={nodesById} />
        ))}
      </div>
    </PanelGroup>
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
    <PanelGroup title="Platforms">
      {/* The group does not gutter its children the way `PanelSection` did, so
          the editor carries its own — otherwise it would sit flush against the
          panel's edges while the prose above it stays indented. */}
      <div className={PANEL_GUTTER}>
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
      </div>
    </PanelGroup>
  );
}

/**
 * A flow's platform statuses, rolled up from what it plays.
 *
 * Shares the title "Platforms" with the acceptance's and the view's editors,
 * though this one is read-only. The group is an outline entry, and three names
 * for one shelf would make a reader walking three panels learn three words for
 * the same place. That this one is derived is said by its contents — gauges, no
 * controls — rather than by its heading.
 */
function ComputedPlatformStatusSection({
  node,
  scope,
  allNodes,
  allEdges,
}: { node: Node; scope: ProductScope; allNodes: Node[]; allEdges: Edge[] }) {
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const rollup = computeFlowPlatformRollup(node, nodesById, allNodes, allEdges);

  return (
    <PanelGroup title="Platforms">
      {/* The gutter is the child's own here — see `PlatformVariantsSection`. */}
      <div className={PANEL_GUTTER}>
        {/* Clamped, not replaced: a flow's rollup can count a platform the flow
            never declares (the seed's `F-swap-glyph`), and under All products that
            bar must survive. See `scopedRollupPlatforms`. */}
        <PlatformGaugeList
          rollup={rollup}
          platforms={scopedRollupPlatforms(node.platforms, rollup, scope.platforms)}
          showLabels
        />
      </div>
    </PanelGroup>
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
      <PanelHeaderEntityId id={node.id} />
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
  history,
  onNavigate,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  intake,
  onZoomShot,
  findings,
  onOpenCriterion,
}: NodeDetailPanelProps) {
  void onDelete;

  return (
    // The top padding is not decoration: without it the title sat flush against
    // the header's bottom border, which is the one panel body that read as
    // clipped rather than as laid out. It tracks the gutter's own step down
    // below `lg`.
    <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-4 py-5 lg:py-6">
      <NodeFields
        key={node.id}
        node={node}
        onUpdate={onUpdate}
        allNodes={allNodes}
        onNavigate={onNavigate}
        // Whichever membership control this species has — the two are
        // alternatives, not a fallback chain. An acceptance's product is
        // derived from the anchors it covers (§ D5), which only
        // `AcceptanceMembershipField` can say; every other species' is the
        // stored key itself, which is `ProductSection`'s. Neither is asked
        // whether it should render: each keeps its own refusals, and
        // `ProductSection` is the one that answers "not on a data model, not
        // without products, not without a save path".
        membership={
          node.species === "acceptance" ? (
            allNodes && allEdges && onUpdate ? (
              <AcceptanceMembershipField
                node={node}
                scope={scope}
                allNodes={allNodes}
                allEdges={allEdges}
                onUpdate={onUpdate}
              />
            ) : undefined
          ) : (
            <ProductSection node={node} scope={scope} onUpdate={onUpdate} />
          )
        }
        authored={
          node.species === "acceptance" && allNodes && allEdges && onUpdate ? (
            <AcceptanceAuthoredFields
              node={node}
              allNodes={allNodes}
              allEdges={allEdges}
              onUpdate={onUpdate}
              intake={intake}
            />
          ) : undefined
        }
      />
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
      {/* Groups live in a column of their own. `-space-y-px` overlaps each
          bar's `border-y` with the one above so a run of shut groups reads as
          one ruled list; the body's `gap-4` would open a four-unit trench
          between every pair. */}
      <div className="flex flex-col -space-y-px">
        {/* The only one of the three platform regions whose bar is opened out
            here rather than by the section itself. `AcceptancePlatformsSection`
            is the `Field` body lifted verbatim out of the old `AcceptanceEditor` and
            nothing more — it renders one `PlatformVariants` and holds no state
            — so giving it a group of its own would have been a second change
            smuggled into the move. The two below own their bars because each is
            already a whole region: a local component with state, handlers and a
            condition. Nothing depends on the asymmetry — the semantics test
            sweeps the whole panels directory, so this bar can move into the
            section the day the section grows enough to deserve it. */}
        {node.species === "acceptance" && onUpdate && (
          <PanelGroup key={`platforms-${node.id}`} title="Platforms">
            <div className={PANEL_GUTTER}>
              <AcceptancePlatformsSection node={node} scope={scope} onUpdate={onUpdate} />
            </div>
          </PanelGroup>
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
        <RelationsGroup
          key={`relations-${node.id}`}
          node={node}
          scope={scope}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
          onCreateAcceptanceForAnchor={onCreateAcceptanceForAnchor}
          intake={intake}
          findings={findings}
          onOpenCriterion={onOpenCriterion}
        />
        {node.species === "flow" && allNodes && (
          <PlaylistEditor
            key={`playlist-${node.id}`}
            node={node}
            allNodes={allNodes}
            onUpdate={onUpdate}
            onCreateNode={onCreateNode}
          />
        )}
        {history && (
          <HistorySection
            key={`history-${node.id}`}
            node={node}
            allNodes={allNodes ?? NO_NODES}
          />
        )}
      </div>
    </div>
  );
}

