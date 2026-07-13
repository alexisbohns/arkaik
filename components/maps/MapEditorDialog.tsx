"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { isBuiltInMapId, type MapDefinition, type MapKind } from "@arkaik/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Node as DataNode } from "@/lib/data/types";
import { matchesSearch } from "@/lib/utils/search";

interface MapEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing custom map; absent when creating. */
  initialDefinition?: MapDefinition;
  existingMapIds: readonly string[];
  allNodes: DataNode[];
  onSave: (definition: MapDefinition) => Promise<void> | void;
}

function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

/**
 * Create/edit a custom map definition — data written to
 * `project.metadata.maps` (docs/spec/maps.md § Storage). Humans get this
 * dialog; agents write the same JSON directly.
 */
export function MapEditorDialog({
  open,
  onOpenChange,
  initialDefinition,
  existingMapIds,
  allNodes,
  onSave,
}: MapEditorDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<MapKind>("journey");
  const [rootNodeId, setRootNodeId] = useState<string | undefined>(undefined);
  const [rootQuery, setRootQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initialDefinition?.title ?? "");
    setDescription(initialDefinition?.description ?? "");
    setKind(initialDefinition?.kind === "system" ? "system" : "journey");
    setRootNodeId(initialDefinition?.root_node_id);
    setRootQuery("");
    setError(null);
  }, [initialDefinition, open]);

  const rootCandidates = useMemo(() => {
    if (!rootQuery.trim()) return [];
    return allNodes
      .filter((node) => matchesSearch(node, rootQuery) || node.id.toLowerCase().includes(rootQuery.toLowerCase()))
      .slice(0, 8);
  }, [allNodes, rootQuery]);

  const rootNode = rootNodeId ? allNodes.find((node) => node.id === rootNodeId) : undefined;

  async function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("A map needs a title.");
      return;
    }

    const mapId = initialDefinition?.id ?? slugify(trimmedTitle);
    if (!mapId) {
      setError("The title must contain at least one letter or digit.");
      return;
    }
    if (isBuiltInMapId(mapId)) {
      setError(`"${mapId}" is a reserved built-in map id — pick another title.`);
      return;
    }
    if (!initialDefinition && existingMapIds.includes(mapId)) {
      setError(`A map with id "${mapId}" already exists.`);
      return;
    }

    const definition: MapDefinition = {
      ...(initialDefinition ?? {}),
      id: mapId,
      title: trimmedTitle,
      kind,
    };
    if (description.trim()) definition.description = description.trim();
    else delete definition.description;
    if (rootNodeId) definition.root_node_id = rootNodeId;
    else delete definition.root_node_id;

    setSaving(true);
    setError(null);
    try {
      await onSave(definition);
      onOpenChange(false);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unknown save error";
      setError(`Unable to save map: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initialDefinition ? "Edit map" : "New map"}</DialogTitle>
          <DialogDescription>
            A map is a saved reading of the graph: a kind, an optional anchor, stored with the project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Title</label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Admin area" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</label>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this map is for (optional)"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kind</label>
            <Select value={kind} onValueChange={(value) => setKind(value as MapKind)}>
              <SelectTrigger aria-label="Map kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="journey">Journey — navigation drill-down</SelectItem>
                <SelectItem value="system">System — views, APIs, data models</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Anchor (optional)
            </label>
            {rootNode ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{rootNode.title}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{rootNode.id}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="cursor-pointer"
                  onClick={() => setRootNodeId(undefined)}
                  aria-label="Clear anchor"
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    value={rootQuery}
                    onChange={(event) => setRootQuery(event.target.value)}
                    placeholder="Search a node to anchor the map"
                    className="pl-8"
                    aria-label="Search anchor node"
                  />
                </div>
                {rootCandidates.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    {rootCandidates.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/50"
                        onClick={() => {
                          setRootNodeId(node.id);
                          setRootQuery("");
                        }}
                      >
                        <span className="truncate">{node.title}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{node.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive" role="status" aria-live="polite">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="cursor-pointer" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving..." : initialDefinition ? "Save map" : "Create map"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
