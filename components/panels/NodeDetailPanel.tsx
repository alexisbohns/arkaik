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
import type { Node } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { SPECIES } from "@/lib/config/species";
import { STATUSES } from "@/lib/config/statuses";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";

interface NodeDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => void;
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

export function NodeDetailPanel({
  open,
  onOpenChange,
  node,
  onUpdate,
}: NodeDetailPanelProps) {
  const speciesConfig = SPECIES.find((s) => s.id === node?.species);
  const speciesLabel = speciesConfig?.label ?? node?.species;
  const speciesDescription = speciesConfig?.description;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{node?.title ?? "Node detail"}</SheetTitle>
          {speciesLabel && (
            <SheetDescription>{speciesLabel}{speciesDescription ? ` — ${speciesDescription}` : ""}</SheetDescription>
          )}
        </SheetHeader>
        {node && (
          <NodeFields key={node.id} node={node} onUpdate={onUpdate} />
        )}
      </SheetContent>
    </Sheet>
  );
}

