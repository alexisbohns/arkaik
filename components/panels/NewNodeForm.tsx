"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SPECIES, isStepSpecies } from "@/lib/config/species";
import { STATUSES } from "@/lib/config/statuses";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { SpeciesId } from "@/lib/config/species";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import type { Node, NodeMetadata } from "@/lib/data/types";

const PARENT_NONE = "__none__";

export interface NewNodeFormData {
  title: string;
  species: SpeciesId;
  status: StatusId;
  platforms: PlatformId[];
  parent_id: string | null;
  metadata?: NodeMetadata;
}

interface NewNodeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: NewNodeFormData) => void;
  nodes?: Node[];
  /** Pre-fill parent and/or species when opening from an "Add child" action. */
  defaultValues?: Partial<Pick<NewNodeFormData, "parent_id" | "species">>;
}

export function NewNodeForm({ open, onOpenChange, onSubmit, nodes = [], defaultValues }: NewNodeFormProps) {
  const [title, setTitle] = useState("");
  const [species, setSpecies] = useState<SpeciesId>(defaultValues?.species ?? "component");
  const [status, setStatus] = useState<StatusId>("idea");
  const [platforms, setPlatforms] = useState<PlatformId[]>([]);
  const [parentId, setParentId] = useState<string | null>(defaultValues?.parent_id ?? null);
  const usesSingleStatusField = !isStepSpecies(species) && species !== "flow" && species !== "scenario";
  const usesPlatformDefaultStatus = isStepSpecies(species);
  const allowsPlatformEditing = species !== "flow" && species !== "scenario";

  function resetForm() {
    setTitle("");
    setSpecies(defaultValues?.species ?? "component");
    setStatus("idea");
    setPlatforms([]);
    setParentId(defaultValues?.parent_id ?? null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  }

  function handlePlatformToggle(platformId: PlatformId) {
    setPlatforms((prev) =>
      prev.includes(platformId) ? prev.filter((p) => p !== platformId) : [...prev, platformId]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const metadata: NodeMetadata | undefined = isStepSpecies(species)
      ? {
          platformStatuses: Object.fromEntries(
            platforms.map((platformId) => [platformId, status]),
          ) as Record<PlatformId, StatusId>,
        }
      : undefined;

    onSubmit({ title: title.trim(), species, status, platforms, parent_id: parentId, metadata });
    resetForm();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{defaultValues?.parent_id ? "Add child node" : "New node"}</DialogTitle>
          <DialogDescription className="sr-only">
            Fill in the details to create a new node on the canvas.
          </DialogDescription>
        </DialogHeader>
        <form id="new-node-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Node title"
              required
              aria-label="Node title"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Species</span>
            <Select value={species} onValueChange={(v) => setSpecies(v as SpeciesId)}>
              <SelectTrigger aria-label="Species">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPECIES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(usesSingleStatusField || usesPlatformDefaultStatus) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {usesPlatformDefaultStatus ? "Default Platform Status" : "Status"}
              </span>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusId)}>
                <SelectTrigger aria-label={usesPlatformDefaultStatus ? "Default platform status" : "Status"}>
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
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Parent</span>
            <Select
              value={parentId ?? PARENT_NONE}
              onValueChange={(v) => setParentId(v === PARENT_NONE ? null : v)}
            >
              <SelectTrigger aria-label="Parent node">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PARENT_NONE}>None</SelectItem>
                {nodes.map((n) => {
                  const speciesLabel = SPECIES.find((s) => s.id === n.species)?.label ?? n.species;
                  return (
                    <SelectItem key={n.id} value={n.id}>
                      {n.title} ({speciesLabel})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-node-form">
            Create node
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
