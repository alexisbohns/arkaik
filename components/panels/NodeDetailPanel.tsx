"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trash2Icon } from "lucide-react";
import type { Node, Edge, PlaylistEntry } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { SPECIES } from "@/lib/config/species";
import { STATUSES } from "@/lib/config/statuses";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { PlaylistEditor } from "@/components/panels/PlaylistEditor";
import {
  addNodeToRollup,
  createEmptyRollup,
  getEditablePlatformStatuses,
  mergeRollups,
} from "@/lib/utils/platform-status";

function collectReferencedNodeIds(entries: PlaylistEntry[]): string[] {
  const result: string[] = [];

  for (const entry of entries) {
    if (entry.type === "view") {
      result.push(entry.view_id);
      continue;
    }

    if (entry.type === "flow") {
      result.push(entry.flow_id);
      continue;
    }

    if (entry.type === "condition") {
      result.push(...collectReferencedNodeIds(entry.if_true));
      result.push(...collectReferencedNodeIds(entry.if_false));
      continue;
    }

    for (const playlistCase of entry.cases) {
      result.push(...collectReferencedNodeIds(playlistCase.entries));
    }
  }

  return result;
}

function getOrderedPlaylistChildren(node: Node, allNodes: Node[]) {
  const entries = Array.isArray(node.metadata?.playlist?.entries) ? node.metadata.playlist.entries : [];
  const playlist = collectReferencedNodeIds(entries);
  const childMap = new Map(allNodes.map((candidate) => [candidate.id, candidate]));
  return playlist
    .map((id) => childMap.get(id))
    .filter((child): child is Node => Boolean(child));
}

function computeFlowRollup(node: Node, allNodes: Node[]) {
  const allNodesById = new Map(allNodes.map((candidate) => [candidate.id, candidate]));

  function computeFlowRollupRecursive(flowNode: Node, visited: Set<string>) {
    if (visited.has(flowNode.id)) {
      return createEmptyRollup();
    }

    visited.add(flowNode.id);
    const children = getOrderedPlaylistChildren(flowNode, allNodes);
    const directViewRollup = children
      .filter((candidate) => candidate.species === "view")
      .reduce((rollup, child) => addNodeToRollup(rollup, child), createEmptyRollup());
    const nestedFlowRollup = mergeRollups(
      ...children
        .filter((candidate) => candidate.species === "flow")
        .map((child) => allNodesById.get(child.id))
        .filter((candidate): candidate is Node => Boolean(candidate))
        .map((childFlow) => computeFlowRollupRecursive(childFlow, visited)),
    );

    visited.delete(flowNode.id);
    return mergeRollups(directViewRollup, nestedFlowRollup);
  }

  return computeFlowRollupRecursive(node, new Set<string>());
}

function getComposeChildren(node: Node, allNodes: Node[], allEdges: Edge[]) {
  const childIds = allEdges
    .filter((edge) => edge.edge_type === "composes" && edge.source_id === node.id)
    .map((edge) => edge.target_id);
  const childMap = new Map(allNodes.map((candidate) => [candidate.id, candidate]));
  return childIds
    .map((id) => childMap.get(id))
    .filter((child): child is Node => Boolean(child));
}

function computeNodeRollup(node: Node, allNodes: Node[], allEdges: Edge[]) {
  if (node.species === "flow") {
    return computeFlowRollup(node, allNodes);
  }

  return createEmptyRollup();
}

interface NodeDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  allNodes?: Node[];
  allEdges?: Edge[];
  onNavigate?: (node: Node) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
}

interface NodeFieldsProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
}

function NodeFields({ node, onUpdate }: NodeFieldsProps) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [status, setStatus] = useState<StatusId>(node.status);
  const [platforms, setPlatforms] = useState<PlatformId[]>(node.platforms);
  const usesSingleStatusField = node.species === "data-model" || node.species === "api-endpoint";
  const allowsPlatformEditing = node.species !== "flow";

  function handleTitleBlur() {
    if (title !== node.title) {
      onUpdate?.(node.id, { title });
    }
  }

  function handleDescriptionBlur() {
    const trimmed = description.trim() || undefined;
    if (trimmed !== node.description) {
      onUpdate?.(node.id, { description: trimmed });
    }
  }

  function handleStatusChange(value: StatusId) {
    setStatus(value);
    onUpdate?.(node.id, { status: value });
  }

  function handlePlatformToggle(platformId: PlatformId) {
    const next = platforms.includes(platformId)
      ? platforms.filter((p) => p !== platformId)
      : [...platforms, platformId];
    setPlatforms(next);

    if (node.species === "view") {
      const currentStatuses = getEditablePlatformStatuses(node);
      const nextStatuses = Object.fromEntries(
        next.map((platform) => [platform, currentStatuses[platform] ?? node.status]),
      ) as Record<PlatformId, StatusId>;
      const currentNotes = node.metadata?.platformNotes ?? {};
      const nextNotes = Object.fromEntries(
        next.flatMap((platform) => {
          const note = currentNotes[platform];
          return typeof note === "string" ? [[platform, note]] : [];
        }),
      ) as Partial<Record<PlatformId, string>>;

      onUpdate?.(node.id, {
        platforms: next,
        metadata: {
          ...node.metadata,
          platformStatuses: nextStatuses,
          platformNotes: nextNotes,
        },
      });
      return;
    }

    onUpdate?.(node.id, { platforms: next });
  }

  return (
    <div className="px-6 flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</span>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          aria-label="Node title"
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
              {STATUSES.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {allowsPlatformEditing && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platforms</span>
          <div className="flex items-center gap-2 flex-wrap">
            {PLATFORMS.map((p) => {
              const selected = platforms.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePlatformToggle(p.id)}
                  aria-pressed={selected}
                  className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                    selected
                      ? "bg-muted text-foreground"
                      : "bg-transparent text-muted-foreground border border-input hover:bg-muted/50"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${selected ? PLATFORM_DOT_STYLES[p.id] : "bg-muted-foreground/40"}`} />
                  {PLATFORM_LABELS[p.id]}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={handleDescriptionBlur}
          placeholder="No description"
          rows={4}
          className="border-input bg-transparent text-sm text-foreground leading-relaxed resize-none rounded-md border px-3 py-2 shadow-xs outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Description"
        />
      </div>
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

interface PlatformVariantsSectionProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
}

function PlatformVariantsSection({ node, onUpdate }: PlatformVariantsSectionProps) {
  const rawNotes = (node.metadata?.platformNotes ?? {}) as Partial<Record<PlatformId, string>>;
  const rawStatuses = getEditablePlatformStatuses(node);
  const [notes, setNotes] = useState<Partial<Record<PlatformId, string>>>(rawNotes);
  const [statuses, setStatuses] = useState(rawStatuses);

  function handleNotesChange(platform: PlatformId, value: string) {
    const next = { ...notes, [platform]: value };
    setNotes(next);
    onUpdate?.(node.id, {
      metadata: { ...node.metadata, platformNotes: next, platformStatuses: statuses },
    });
  }

  function handleStatusChange(platform: PlatformId, value: StatusId) {
    const next = { ...statuses, [platform]: value };
    setStatuses(next);
    onUpdate?.(node.id, {
      metadata: { ...node.metadata, platformStatuses: next, platformNotes: notes },
    });
  }

  return (
    <div className="px-6 flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform Variants</span>
      <PlatformVariants
        platforms={node.platforms}
        statuses={statuses}
        notes={notes}
        onStatusChange={handleStatusChange}
        onNotesChange={handleNotesChange}
      />
    </div>
  );
}

function ComputedPlatformStatusSection({ node, allNodes, allEdges }: { node: Node; allNodes: Node[]; allEdges: Edge[] }) {
  const rollup = computeNodeRollup(node, allNodes, allEdges);

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
  onUpdate,
  onDelete,
  allNodes,
  allEdges,
  onNavigate,
  onCreateNode,
}: NodeDetailPanelProps) {
  const speciesConfig = SPECIES.find((s) => s.id === node?.species);
  const speciesLabel = speciesConfig?.label ?? node?.species;
  const speciesDescription = speciesConfig?.description;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1 min-w-0">
              <SheetTitle>{node?.title ?? "Node detail"}</SheetTitle>
              {speciesLabel && (
                <SheetDescription>{speciesLabel}{speciesDescription ? ` — ${speciesDescription}` : ""}</SheetDescription>
              )}
            </div>
            {node && onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                aria-label="Delete node"
                onClick={() => onDelete(node.id)}
              >
                <Trash2Icon className="size-4" />
              </Button>
            )}
          </div>
        </SheetHeader>
        {node && (
          <>
            <NodeFields key={node.id} node={node} onUpdate={onUpdate} />
            {node.species === "view" && (
              <PlatformVariantsSection
                key={`pv-${node.id}`}
                node={node}
                onUpdate={onUpdate}
              />
            )}
            {node.species === "flow" && allNodes && (
              <ComputedPlatformStatusSection
                key={`computed-${node.id}`}
                node={node}
                allNodes={allNodes}
                allEdges={allEdges ?? []}
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
            {allNodes && allEdges && onNavigate && (
              <ConnectionsSection
                key={`conn-${node.id}`}
                node={node}
                allNodes={allNodes}
                allEdges={allEdges}
                onNavigate={onNavigate}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

