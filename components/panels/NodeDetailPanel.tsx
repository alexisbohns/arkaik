"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetClose,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { Node, Edge, JournalEvent } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { SPECIES } from "@/lib/config/species";
import { STATUSES } from "@/lib/config/statuses";
import {
  STATUS_ICONS,
  STATUS_STYLES,
} from "@/components/graph/nodes/node-styles";
import { SpeciesBadge, EntityId } from "@/components/graph/nodes/EntityBadges";
import { RefList } from "@/components/graph/nodes/RefBadges";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { PlaylistEditor } from "@/components/panels/PlaylistEditor";
import { AcceptanceEditor } from "@/components/panels/AcceptanceEditor";
import { AcceptancesSection } from "@/components/panels/AcceptancesSection";
import {
  computeFlowPlatformRollup,
  getEditablePlatformStatuses,
} from "@/lib/utils/platform-status";
import { findWhereUsed } from "@/lib/utils/where-used";
import { computeNodeTimeline } from "@/lib/utils/journal";
import { describeJournalEvent, formatEventDate } from "@/components/journal/describe-event";

interface NodeDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: Node;
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
  onZoomShot?: (node: Node, platform: PlatformId) => void;
}

interface NodeFieldsProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
}

function NodeFields({ node, onUpdate }: NodeFieldsProps) {
  const AUTOSAVE_DELAY_MS = 350;
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
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</span>
          <Select value={status} onValueChange={(v) => handleStatusChange(v as StatusId)}>
            <SelectTrigger aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => {
                const StatusIcon = STATUS_ICONS[s.id];

                return (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="inline-flex items-center gap-2">
                      <StatusIcon className={`size-3.5 ${STATUS_STYLES[s.id].badge}`} />
                      {s.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}
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
    <div className="px-6 flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invocation</span>
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
    </div>
  );
}

function RefsSection({ node }: { node: Node }) {
  const refs = node.metadata?.refs;

  if (!refs || refs.length === 0) {
    return null;
  }

  return (
    <div className="px-6 flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">References</span>
      <RefList refs={refs} />
    </div>
  );
}

interface ConnectionsSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  onNavigate: (node: Node) => void;
}

function ConnectionsSection({ node, allNodes, allEdges, onNavigate }: ConnectionsSectionProps) {
  const crossLayerNodes = allEdges
    .filter((e) => e.edge_type !== "composes" && (e.source_id === node.id || e.target_id === node.id))
    .map((e) => {
      const otherId = e.source_id === node.id ? e.target_id : e.source_id;
      return allNodes.find((n) => n.id === otherId);
    })
    .filter((n): n is Node => !!n && (n.species === "data-model" || n.species === "api-endpoint"));

  const uniqueCrossLayerNodes = [...new Map(crossLayerNodes.map((n) => [n.id, n])).values()];

  if (uniqueCrossLayerNodes.length === 0) {
    return null;
  }

  return (
    <div className="px-6 flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Connections</span>
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
    </div>
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
    <div className="px-6 flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">History</span>
      <div className="flex flex-col gap-0.5">
        {[...timeline].reverse().map((event) => {
          const { icon: Icon, text, meta } = describeJournalEvent(event, nodesById);

          return (
            <div key={event.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm">
              <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="truncate">{text}</p>
                {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{formatEventDate(event.ts)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PlatformVariantsSectionProps {
  node: Node;
  initialPlatform?: PlatformId;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onZoomShot?: (platform: PlatformId) => void;
}

function PlatformVariantsSection({ node, initialPlatform, onUpdate, onZoomShot }: PlatformVariantsSectionProps) {
  const rawNotes = (node.metadata?.platformNotes ?? {}) as Partial<Record<PlatformId, string>>;
  const rawStatuses = getEditablePlatformStatuses(node);
  const rawScreenshots = (node.metadata?.platformScreenshots ?? {}) as Partial<Record<PlatformId, string>>;
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
    <div className="px-6 flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform Variants</span>
      <PlatformVariants
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
  );
}

function ComputedPlatformStatusSection({ node, allNodes, allEdges }: { node: Node; allNodes: Node[]; allEdges: Edge[] }) {
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const rollup = computeFlowPlatformRollup(node, nodesById, allNodes, allEdges);

  return (
    <div className="px-6 flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Computed Platform Statuses</span>
      <PlatformGaugeList rollup={rollup} platforms={node.platforms} showLabels />
    </div>
  );
}

export function NodeDetailPanel({
  open,
  onOpenChange,
  node,
  initialPlatform,
  onUpdate,
  onDelete,
  allNodes,
  allEdges,
  journal,
  onNavigate,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  onZoomShot,
}: NodeDetailPanelProps) {
  void onDelete;
  const speciesConfig = SPECIES.find((s) => s.id === node?.species);
  const speciesLabel = speciesConfig?.label ?? node?.species;
  const speciesDescription = speciesConfig?.description;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle className="sr-only">
            {node ? `${speciesLabel}: ${node.title}` : "Node details"}
          </SheetTitle>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {node && speciesLabel && (
                <SpeciesBadge
                  species={node.species}
                  label={speciesLabel}
                  description={speciesDescription}
                  showLabel
                />
              )}
              {node && <EntityId id={node.id} />}
            </div>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 cursor-pointer"
                aria-label="Close panel"
              >
                <X className="size-4" />
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>
        {node && (
          <>
            <NodeFields key={node.id} node={node} onUpdate={onUpdate} />
            <RefsSection key={`refs-${node.id}`} node={node} />
            {(node.species === "view" || node.species === "flow") && allNodes && allEdges && (
              <AcceptancesSection
                key={`acceptances-${node.id}`}
                node={node}
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
                initialPlatform={initialPlatform}
                onUpdate={onUpdate}
                onZoomShot={onZoomShot ? (platform) => onZoomShot(node, platform) : undefined}
              />
            )}
            {node.species === "flow" && allNodes && allEdges && (
              <ComputedPlatformStatusSection
                key={`computed-${node.id}`}
                node={node}
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
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

