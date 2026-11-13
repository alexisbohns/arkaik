"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { PanelGroup } from "@/components/panels/PanelGroup";
import { RelationsGroup } from "@/components/panels/RelationsGroup";
import type { Node, NodeMetadata, Edge } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { SPECIES } from "@/lib/config/species";
import { SpeciesBadge, CopyIdChip } from "@/components/graph/nodes/EntityBadges";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import { SpeciesShape } from "@/components/panels/species-shape";
import { StatusTrack } from "@/components/panels/StatusTrack";
import { ProductChip } from "@/components/panels/ProductChip";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { PlatformRollupTiles } from "@/components/panels/PlatformRollupTiles";
import { PlaylistEditor } from "@/components/panels/PlaylistEditor";
import { AcceptanceAuthoredFields } from "@/components/panels/AcceptanceAuthoredFields";
import { AcceptancePlatformsSection } from "@/components/panels/AcceptancePlatformsSection";
import { DecisionEditor } from "@/components/panels/DecisionEditor";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import type { NodeRelations } from "@/lib/hooks/useNodeRelations";
import { useJournal } from "@/lib/hooks/useJournal";
import { useProjectId } from "@/lib/hooks/useProjectId";
import {
  computeFlowPlatformRollup,
  getEditablePlatformStatuses,
  scopedRollupPlatforms,
} from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";
import { withProductMembership } from "@/lib/utils/product-editing";
import { acceptancesCovering } from "@arkaik/schema";
import { describeProductMembership, isMembershipSettled } from "@/lib/utils/product-membership";
import type { PlatformScreenshotMetaMap } from "@arkaik/schema";
import { useScreenshotStaleness } from "@/lib/hooks/useScreenshotStaleness";
import { stalenessRelatedIds } from "@/lib/utils/screenshot-staleness";
import type { ScreenshotPanelOp } from "@/lib/utils/screenshot-ops";
import { computeNodeTimeline } from "@/lib/utils/journal";
import { FeedRow } from "@/components/journal/FeedRow";
import { describeJournalEvent, formatEventDate } from "@/components/journal/describe-event";
import type { FindingRow } from "@/lib/utils/quality";
import { cn } from "@/lib/utils";
import { CopyPlusIcon, SplitIcon, Trash2Icon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  /** Screenshot writes, as the op itself: the panel never patches `platformScreenshots` through `onUpdate`. */
  onScreenshot?: (op: ScreenshotPanelOp) => Promise<void> | void;
  // No `onDelete` / `onDuplicate` here: the record's own actions render in
  // `NodeDetailPanelHeader`, which takes them directly. The body accepted
  // `onDelete` and discarded it with `void onDelete;` for as long as there was
  // nowhere to put it; there is now.
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
  /**
   * Writing a node's relations (`useNodeRelations`), forwarded to the detail
   * panel's Relations group. Absent on a read-only surface, which is what makes
   * every line there read-only and drops the empty ones.
   */
  relations?: NodeRelations;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
  /**
   * Every finding in the project, denormalized once by `buildFindingRows` — the
   * Findings section picks out this node's own. The whole list rather than a
   * pre-filtered one because the caller builds it once for a whole panel stack,
   * and re-filtering it per open panel is what a panel is for.
   *
   * Optional with `onOpenFinding`, and the section is absent without both: a
   * list of findings nothing can open is a dead end.
   */
  findings?: FindingRow[];
  onOpenFinding?: (findingId: string) => void;
}

interface NodeFieldsProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /**
   * The species' own authored fields (Gherkin, Values), last in the intro
   * block. They sit there rather than in a group because they are what the
   * record *is*, not what it is attached to. They render straight into this
   * component's gutter and `gap-5` column, so they may not carry a gutter of
   * their own.
   *
   * There is no membership slot: which product a node belongs to rides in the
   * panel header (`NodeDetailPanelHeader`), beside the id.
   */
  authored?: ReactNode;
}

function NodeFields({ node, onUpdate, authored }: NodeFieldsProps) {
  const AUTOSAVE_DELAY_MS = 350;
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [status, setStatus] = useState<StatusId>(node.status);
  const lastSavedTitleRef = useRef(node.title);
  const lastSavedDescriptionRef = useRef(node.description ?? "");

  // The editable title and description are uncontrolled (contentEditable owns
  // the caret), so their text is seeded once, when each element attaches —
  // through a callback ref rather than a mount effect, because the element can
  // attach after mount: a layout that places the title in a different wrapper
  // (the panel looks do) mounts a fresh element, which a mount-once effect
  // would leave empty. `seeded` marks an element already filled, so a re-render
  // never overwrites what is being typed. The text it seeds from is the latest
  // committed value, read through a ref.
  const latestText = useRef({ title: node.title, description: node.description ?? "" });
  useEffect(() => {
    latestText.current = { title, description };
  });
  const attachTitle = useCallback((el: HTMLDivElement | null) => {
    if (el && el.dataset.seeded !== "1") {
      el.textContent = latestText.current.title;
      el.dataset.seeded = "1";
    }
  }, []);
  const attachDescription = useCallback((el: HTMLDivElement | null) => {
    if (el && el.dataset.seeded !== "1") {
      el.textContent = latestText.current.description;
      el.dataset.seeded = "1";
    }
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
    // Nothing at all without a save path, local state included: the select is
    // disabled on a read-only surface, and this makes that the whole truth
    // rather than a property of the trigger. A `setStatus` that ran anyway
    // would let the panel show a status the store has never heard of the
    // moment anything else reached this handler.
    if (!onUpdate) return;
    setStatus(value);
    onUpdate(node.id, { status: value });
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
      {/* The hero: the record's title at headline scale on a species-tinted
          card that bleeds up under the header, so header and title read as one
          shape — the panel's one loud thing. The species shape in its corner is
          decorative; the header says the species in words. The title and the
          description stay one block, closer to each other than to anything
          below, which is what the outer `gap-5` is for. */}
      <div data-np-intro="bleed" data-species={node.species} className="np-hero">
        <SpeciesShape species={node.species} className="np-hero-shape" />
        <div className="np-hero-text">
          <div
            ref={attachTitle}
            data-panel-title
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
            ref={attachDescription}
            data-panel-description
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
      </div>
      {usesSingleStatusField && (
        // Disabled without `onUpdate`, not hidden: a status is a fact the
        // reader of a read-only surface (Design, Changelog, the quality pages)
        // came here to see, so the track keeps showing where the record sits
        // and only stops offering the other steps.
        <div data-np-meta="track" className="np-meta-stack">
          <StatusTrack value={status} onChange={onUpdate ? handleStatusChange : undefined} />
        </div>
      )}
      {authored}
    </div>
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

  // The group opens shut, so its bar says what happened last: the latest
  // event, its glyph and its date, previewed beside the title. The node's own
  // title is the panel's subject, so "Home: iOS screenshot recorded" previews
  // as "iOS screenshot recorded". Open, the timeline says it all and the
  // preview steps back (panels.css).
  const latest = timeline[timeline.length - 1];
  const described = describeJournalEvent(latest, nodesById);
  const preview =
    node.title && described.text.startsWith(`${node.title}: `)
      ? described.text.slice(node.title.length + 2)
      : described.text;
  const LatestIcon = described.icon;

  return (
    <PanelGroup
      title="History"
      defaultOpen={false}
      meta={
        <span className="np-history-preview">
          <LatestIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="np-history-preview-text">{preview}</span>
          <span className="np-history-preview-date">{formatEventDate(latest.ts)}</span>
        </span>
      }
    >
      {/* A timeline: the rows hang off one tinted rail (panels.css), newest first. */}
      <div data-history-feed className={cn(PANEL_GUTTER, "flex flex-col gap-0.5")}>
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
  onScreenshot?: (op: ScreenshotPanelOp) => Promise<void> | void;
  onZoomShot?: (platform: PlatformId) => void;
  /**
   * Per platform, the covering acceptances whose moves stale this view's shot
   * (`stalenessRelatedIds`) — the same rule the Screens map applies, so the
   * caption and the wall never disagree. Absent when the surface passes no
   * graph: the caption then reads the view's own events only.
   */
  staleRelatedIds?: Partial<Record<PlatformId, readonly string[]>>;
}

function PlatformVariantsSection({
  node,
  scope,
  initialPlatform,
  onUpdate,
  onScreenshot,
  onZoomShot,
  staleRelatedIds,
}: PlatformVariantsSectionProps) {
  const rawNotes = (node.metadata?.platformNotes ?? {}) as Partial<Record<PlatformId, string>>;
  const rawStatuses = getEditablePlatformStatuses(node);
  // Seeded from the FULL stored maps, not the scoped ones: a note for a
  // platform outside the effective set is not rendered and not deleted — every
  // handler below patches by spreading these, so it round-trips untouched.
  const [notes, setNotes] = useState<Partial<Record<PlatformId, string>>>(rawNotes);
  const [statuses, setStatuses] = useState(rawStatuses);
  // Screenshots are READ straight off the node and never held in state here:
  // they are written through `onScreenshot` as an op, and the op's result
  // comes back through the cache. The notes and status patches below still
  // spread the stored slot map so an edit round-trips it untouched — spread,
  // not written: the one writer of `platformScreenshots` is the op.
  //
  // `shotPending` holds every control while an op is in flight: a notes or
  // status patch built from the pre-op `node.metadata` would hand `update_node`
  // the old slot, and `update_node` replaces metadata wholesale, so the fresh
  // shot would be overwritten before the cache ever showed it. The `notes` and
  // `statuses` state seeded at mount is a pre-existing hazard of the same kind
  // (a patch spreads whatever the closure holds) and is NOT fixed here.
  const screenshots = (node.metadata?.platformScreenshots ?? {}) as Partial<Record<PlatformId, string>>;
  const screenshotMeta = (node.metadata?.platformScreenshotMeta ?? {}) as PlatformScreenshotMetaMap;
  const stale = useScreenshotStaleness(node.id, scope.platforms, screenshotMeta, staleRelatedIds);
  const [shotPending, setShotPending] = useState(false);

  async function runScreenshotOp(op: ScreenshotPanelOp) {
    if (!onScreenshot) return;
    setShotPending(true);
    try {
      await onScreenshot(op);
    } finally {
      setShotPending(false);
    }
  }

  function handleNotesChange(platform: PlatformId, value: string) {
    const next = { ...notes, [platform]: value };
    setNotes(next);
    onUpdate?.(node.id, {
      metadata: {
        ...node.metadata,
        platformNotes: next,
        platformStatuses: statuses,
        platformScreenshots: node.metadata?.platformScreenshots,
      },
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
      metadata: {
        ...node.metadata,
        platformStatuses: next,
        platformNotes: notes,
        platformScreenshots: node.metadata?.platformScreenshots,
      },
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
          screenshotMeta={screenshotMeta}
          stale={stale}
          busy={shotPending}
          initialPlatform={initialPlatform}
          // Only with a save path. Passed unconditionally, these drew a live
          // status select and notes box on read-only surfaces (Design, the
          // quality pages) that changed on screen and never saved.
          onStatusChange={onUpdate ? handleStatusChange : undefined}
          onNotesChange={onUpdate ? handleNotesChange : undefined}
          onRecordScreenshot={
            onScreenshot
              ? (platform, form, value) => {
                  void runScreenshotOp({ op: "record_screenshot", node_id: node.id, platform, source: "manual", form, value });
                }
              : undefined
          }
          onRemoveScreenshot={
            onScreenshot
              ? (platform) => {
                  void runScreenshotOp({ op: "remove_screenshot", node_id: node.id, platform });
                }
              : undefined
          }
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
        <PlatformRollupTiles
          rollup={rollup}
          platforms={scopedRollupPlatforms(node.platforms, rollup, scope.platforms)}
        />
      </div>
    </PanelGroup>
  );
}

/**
 * What identifies the panel, for the stack's per-panel header — the species as
 * a seal (its shape, its glyph, its name), the id as a compact `#` that copies
 * it, the product when there is one worth saying, and the record's own actions.
 * The close button is NOT here: it belongs to `PanelStack`, which owns every
 * panel's frame, and the actions sit to its left because they belong to the
 * record rather than the frame.
 *
 * **The id is a `#`, at every width.** The full id is in its tooltip and its
 * accessible name, and one click copies it; spelled out, a long acceptance id
 * pushed the product off the row or wrapped onto two.
 *
 * **The product rides here, not in the body.** Membership is rarely changed and
 * says nothing in a one-product project, so it is a small chip beside the id
 * (`ProductChip`) instead of a labelled field, and it is absent when
 * `isMembershipSettled` (one product, the node already in it), when the project
 * declares no products, and without a save path.
 *
 * **The actions are out in the open**, one connected group of icon buttons
 * (Duplicate · Split · Delete, Delete in the error tone), each naming itself in
 * a tooltip. **Every one is conditional, and with none there is no group at
 * all**: a read-only surface passes no handlers and gets no actions.
 *
 * `onDuplicate` and `onSplit` are callbacks rather than the dialogs themselves.
 * The triggers live here and the dialogs have to live in the document, and
 * `PanelStack` renders header and body through two separate render props — so
 * the open state can only be held above both, by `ProjectPanels`, which mounts
 * one of each for the whole stack.
 */
export function NodeDetailPanelHeader({
  node,
  scope,
  onUpdate,
  allNodes,
  allEdges,
  onDuplicate,
  onDelete,
  onSplit,
}: {
  node: Node;
  /** The surface's product scope: what the product chip offers. */
  scope?: ProductScope;
  /** The save path for the product chip; without it, there is no chip. */
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /** The graph an acceptance's product is derived from. */
  allNodes?: Node[];
  allEdges?: Edge[];
  /**
   * Open the duplicate dialog for this node. It writes nothing on its own —
   * naming the copy happens in `DuplicateNodeDialog`, which `ProjectPanels`
   * owns — so this is a plain `() => void` and not a write path.
   */
  onDuplicate?: () => void;
  onDelete?: (nodeId: string) => void;
  onSplit?: () => void;
}) {
  const speciesConfig = SPECIES.find((s) => s.id === node.species);
  const speciesLabel = speciesConfig?.label ?? node.species;
  const SpeciesIcon = SPECIES_GRAPH_ICONS[node.species];
  // The id when there is no title: an untitled record is reachable — a
  // duplicate of one is titled just "(copy)", and a new one is titled nothing
  // at all — and "Duplicate " names nothing.
  const name = node.title || node.id;
  const membership = scope && onUpdate ? describeProductMembership(node, scope, allNodes, allEdges) : null;
  const actions = [
    onDuplicate && { key: "duplicate", verb: "Duplicate", label: `Duplicate ${name}`, Icon: CopyPlusIcon, run: onDuplicate },
    onSplit && { key: "split", verb: "Split into several", label: `Split ${name} into several`, Icon: SplitIcon, run: onSplit },
    // No confirmation of its own: `onDelete` is the surface's existing delete
    // request, which opens that surface's confirm dialog. A second one here
    // would either double-prompt or, worse, replace a prompt that knows what
    // else the deletion takes with one that does not.
    onDelete && { key: "delete", verb: "Delete", label: `Delete ${name}`, Icon: Trash2Icon, run: () => onDelete(node.id), tone: "error" },
  ].filter(Boolean) as { key: string; verb: string; label: string; Icon: typeof Trash2Icon; run: () => void; tone?: string }[];

  return (
    <span data-node-panel-header data-species={node.species} className="contents">
      <span className="np-seal" aria-hidden="true">
        <SpeciesShape species={node.species} className="np-seal-shape" />
        <SpeciesIcon className="np-seal-icon" />
      </span>
      <SpeciesBadge
        species={node.species}
        label={speciesLabel}
        description={speciesConfig?.description}
        showLabel
      />
      <span className="np-id">
        <CopyIdChip id={node.id} />
      </span>
      {membership && onUpdate && !isMembershipSettled(membership) && (
        <ProductChip
          membership={membership}
          // Routed through `withProductMembership`, never assembled here: it
          // owns the "unassigned means *absent*, never `product: \"\"`" rule
          // and carries the rest of the metadata through untouched — a patch
          // replaces `metadata` wholesale.
          onChange={(next) => void onUpdate(node.id, { metadata: withProductMembership(node.metadata, next) })}
        />
      )}
      {actions.length > 0 && (
        // `ml-auto shrink-0`: this sits in a `min-w-0 flex-1` row next to
        // truncating identity chips, and the chips should give way, not the
        // actions.
        <span role="group" aria-label={`Actions for ${name}`} className="np-action-group ml-auto shrink-0">
          {actions.map(({ key, verb, label, Icon, run, tone }) => (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <button type="button" aria-label={label} data-tone={tone} onClick={run}>
                  <Icon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{verb}</TooltipContent>
            </Tooltip>
          ))}
        </span>
      )}
    </span>
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
  onScreenshot,
  allNodes,
  allEdges,
  history,
  onNavigate,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  intake,
  relations,
  onZoomShot,
  findings,
  onOpenFinding,
}: NodeDetailPanelProps) {
  // The panel's one latest-metadata write base.
  //
  // `onUpdate` is NOT optimistic: it awaits the provider before `node.metadata`
  // reflects a write. So while writer A's save is in flight, `node.metadata` in
  // writer B's closure is still the pre-A value, and B — which patches
  // `metadata` wholesale, as every metadata write here does — spreads it and
  // silently drops A's edit. Each writer that takes this ref reads it as its
  // spread base and writes its result back into it before calling `onUpdate`,
  // so those writers do not overwrite each other's *completed* edits. Not a
  // total order: the resync below can still regress the base if writer A's
  // response lands while writer B is in flight. That mechanism predates this
  // ref moving up here — the identical effect ran in `DecisionEditor` — and
  // closing it needs an in-flight count, which is a change with failure modes
  // of its own.
  //
  // It lives here rather than in `DecisionEditor`, which owned it until Blocked
  // by moved out of that editor and into the Relations group: the two are now
  // mounted on the same decision panel, and a base owned by one of two siblings
  // is not a shared base at all. This component renders them both, which is why
  // it is the one that owns it.
  //
  // Sharing it today: `DecisionEditor`'s three debounced text fields and its
  // status transition, and `BlockedByField`. NOT sharing it: the header's
  // product chip, `PlatformVariantsSection`, `PlaylistEditor`,
  // `AcceptanceAuthoredFields` and `AcceptancePlatformsSection`, which all still
  // spread `node.metadata`. Those race each other, and did before this ref moved
  // up here; widening the protocol to them is a change of its own and not one
  // this move made necessary.
  const metadataRef = useRef<NodeMetadata | undefined>(node.metadata);
  // Per record, because the call site keys this component on `node.id`. That
  // key is load-bearing for this ref and not decoration: a panel slot is
  // refreshed in place onto a different record, and without the remount the
  // first write on the new one would spread the previous one's metadata.
  //
  // The effect below cannot cover that, and not for a timing reason: its
  // dependency is `node.metadata`, which a record switch need not change at
  // all. Swap a slot from a record whose metadata is `undefined` — with a
  // write in flight, so the ref holds `{ blocked_by: "x" }` — to another whose
  // metadata is also `undefined`, and the dep is equal, the effect never runs,
  // and the new record's first write inherits the old one's blocker. Only the
  // remount covers it.
  useEffect(() => {
    metadataRef.current = node.metadata;
  }, [node.metadata]);

  // A view's shot is also staled by moves on the acceptances covering it — a
  // deploy or a merge lands on those, never on the view — so the caption asks
  // the same question the Screens map does (`stalenessRelatedIds`). Only for a
  // view, and only with the whole graph: `acceptancesCovering` reads every
  // `covers` edge, and a surface that passes no graph keeps today's caption.
  const staleRelatedIds = useMemo(() => {
    if (node.species !== "view" || !allNodes || !allEdges) return undefined;
    const covering = acceptancesCovering(node.id, allNodes, allEdges);
    const byPlatform: Partial<Record<PlatformId, readonly string[]>> = {};
    for (const platform of scope.platforms) {
      byPlatform[platform] = stalenessRelatedIds(covering, platform);
    }
    return byPlatform;
  }, [allEdges, allNodes, node.id, node.species, scope.platforms]);

  return (
    // The top padding is not decoration: without it the title sat flush against
    // the header's bottom border, which is the one panel body that read as
    // clipped rather than as laid out. It tracks the gutter's own step down
    // below `lg`.
    //
    // `data-node-panel` and `data-species` are the stylesheet's hooks
    // (app/m3/panels.css): the species tints the hero, the seal and the marks.
    <div
      data-node-panel
      data-species={node.species}
      className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-4 py-5 lg:py-6"
    >
      <NodeFields
        key={node.id}
        node={node}
        onUpdate={onUpdate}
        authored={
          node.species === "acceptance" && onUpdate ? (
            <AcceptanceAuthoredFields node={node} onUpdate={onUpdate} />
          ) : undefined
        }
      />
      {node.species === "decision" && onUpdate && (
        <DecisionEditor
          key={`decision-${node.id}`}
          node={node}
          onUpdate={onUpdate}
          metadataRef={metadataRef}
        />
      )}
      {/* Groups live in a column of their own, spaced by the group style
          (panels.css): the body's `gap-4` is the intro's rhythm, not theirs. */}
      <div className="flex flex-col">
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
              <AcceptancePlatformsSection
                node={node}
                scope={scope}
                onUpdate={onUpdate}
                onScreenshot={onScreenshot}
              />
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
            onScreenshot={onScreenshot}
            onZoomShot={onZoomShot ? (platform) => onZoomShot(node, platform) : undefined}
            staleRelatedIds={staleRelatedIds}
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
          onUpdate={onUpdate}
          metadataRef={metadataRef}
          onCreateAcceptanceForAnchor={onCreateAcceptanceForAnchor}
          intake={intake}
          relations={relations}
          findings={findings}
          onOpenFinding={onOpenFinding}
        />
        {node.species === "flow" && allNodes && (
          <PlaylistEditor
            key={`playlist-${node.id}`}
            node={node}
            allNodes={allNodes}
            onUpdate={onUpdate}
            onCreateNode={onCreateNode}
            scope={scope}
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

