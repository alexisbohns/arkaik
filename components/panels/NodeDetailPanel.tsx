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
import type { Node, Edge } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { SPECIES, isStepSpecies } from "@/lib/config/species";
import { STATUSES } from "@/lib/config/statuses";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import {
  addNodeToRollup,
  createEmptyRollup,
  getEditablePlatformStatuses,
  mergeRollups,
} from "@/lib/utils/platform-status";

function computeFlowRollup(node: Node, allNodes: Node[]) {
  return allNodes
    .filter((candidate) => candidate.parent_id === node.id && isStepSpecies(candidate.species))
    .reduce((rollup, child) => addNodeToRollup(rollup, child), createEmptyRollup());
}

function computeNodeRollup(node: Node, allNodes: Node[]) {
  if (node.species === "flow") {
    return computeFlowRollup(node, allNodes);
  }

  if (node.species === "scenario") {
    const childFlows = allNodes.filter((candidate) => candidate.parent_id === node.id && candidate.species === "flow");
    return mergeRollups(...childFlows.map((flow) => computeFlowRollup(flow, allNodes)));
  }

  return createEmptyRollup();
}

interface NodeDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => void;
  onDelete?: (nodeId: string) => void;
  allNodes?: Node[];
  allEdges?: Edge[];
  onNavigate?: (node: Node) => void;
}

interface NodeFieldsProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => void;
}

function NodeFields({ node, onUpdate }: NodeFieldsProps) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [status, setStatus] = useState<StatusId>(node.status);
  const [platforms, setPlatforms] = useState<PlatformId[]>(node.platforms);
  const usesSingleStatusField = !isStepSpecies(node.species) && node.species !== "flow" && node.species !== "scenario";
  const allowsPlatformEditing = node.species !== "flow" && node.species !== "scenario";

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

    if (isStepSpecies(node.species)) {
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
  const parent = node.parent_id ? allNodes.find((n) => n.id === node.parent_id) : undefined;
  const children = allNodes.filter((n) => n.parent_id === node.id);

  const crossLayerNodes = allEdges
    .filter((e) => e.source_id === node.id || e.target_id === node.id)
    .map((e) => {
      const otherId = e.source_id === node.id ? e.target_id : e.source_id;
      return allNodes.find((n) => n.id === otherId);
    })
    .filter((n): n is Node => !!n && (n.species === "data-model" || n.species === "api-endpoint"));

  const uniqueCrossLayerNodes = [...new Map(crossLayerNodes.map((n) => [n.id, n])).values()];

  if (!parent && children.length === 0 && uniqueCrossLayerNodes.length === 0) {
    return null;
  }

  return (
    <div className="px-6 flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Connections</span>
      <div className="flex flex-col gap-0.5">
        {parent && (
          <ConnectionItem badge="Parent" node={parent} onNavigate={onNavigate} />
        )}
        {children.map((child) => (
          <ConnectionItem key={child.id} badge="Child" node={child} onNavigate={onNavigate} />
        ))}
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
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => void;
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

function ComputedPlatformStatusSection({ node, allNodes }: { node: Node; allNodes: Node[] }) {
  const rollup = computeNodeRollup(node, allNodes);

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
            {isStepSpecies(node.species) && (
              <PlatformVariantsSection
                key={`pv-${node.id}`}
                node={node}
                onUpdate={onUpdate}
              />
            )}
            {(node.species === "flow" || node.species === "scenario") && allNodes && (
              <ComputedPlatformStatusSection
                key={`computed-${node.id}`}
                node={node}
                allNodes={allNodes}
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

