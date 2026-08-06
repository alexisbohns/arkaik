"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { XIcon } from "lucide-react";
import { isBuiltInMapId, type MapDefinition, type MapKind } from "@arkaik/schema";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
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
  const fieldId = useId();
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
          <Field label="Title" htmlFor={`${fieldId}-title`}>
            <Input
              id={`${fieldId}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Admin area"
            />
          </Field>

          <Field label="Description" htmlFor={`${fieldId}-description`}>
            <Input
              id={`${fieldId}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this map is for (optional)"
            />
          </Field>

          <Field label="Kind" htmlFor={`${fieldId}-kind`}>
            {/* The `aria-label="Map kind"` this trigger used to carry is gone
                with the label that now names it: two names for one control, and
                the invisible one wins. */}
            <Select value={kind} onValueChange={(value) => setKind(value as MapKind)}>
              <SelectTrigger id={`${fieldId}-kind`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="journey">Journey — navigation drill-down</SelectItem>
                <SelectItem value="system">System — views, APIs, data models</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/* No `htmlFor` once an anchor is picked: the search field is replaced
              by the chosen node and its Clear button, and there is nothing left
              for a label to point at. */}
          <Field label="Anchor (optional)" htmlFor={rootNode ? undefined : `${fieldId}-anchor`}>
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
              // `inline` rather than a floating list: this one sits inside a
              // dialog that is free to grow, and pushing the footer down reads
              // better than covering it. No `empty` either — a query matching
              // nothing shows nothing, which is what it did before.
              <Combobox<DataNode>
                id={`${fieldId}-anchor`}
                value={rootQuery}
                onValueChange={setRootQuery}
                items={rootCandidates}
                itemKey={(node) => node.id}
                onSelect={(node) => {
                  setRootNodeId(node.id);
                  setRootQuery("");
                }}
                renderItem={(node) => (
                  <>
                    <span className="truncate">{node.title}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{node.id}</span>
                  </>
                )}
                itemClassName={(_node, active) =>
                  cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                    active && "bg-accent/50",
                  )
                }
                placeholder="Search a node to anchor the map"
                aria-label="Search anchor node"
                search
                placement="inline"
                listClassName="max-h-40 overflow-y-auto rounded-md border"
                className="gap-1"
              />
            )}
          </Field>

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
