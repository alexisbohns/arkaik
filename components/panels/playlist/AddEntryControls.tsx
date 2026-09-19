"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NodeSearchCombobox } from "@/components/panels/NodeSearchCombobox";
import { wouldCreateCycle } from "@/lib/utils/cycle";
import type { Node, PlaylistEntry } from "@/lib/data/types";

/**
 * The composer at the foot of every playlist list — pick a kind, then pick or
 * name the thing. Moved out of `PlaylistEntryList` unchanged: it is the one
 * part of the editor that is not recursive, so it has no business sharing a
 * file with the list/row pair that is.
 */
function createRefEntry(species: "view" | "flow", id: string): PlaylistEntry {
  if (species === "view") {
    return { type: "view", view_id: id };
  }

  return { type: "flow", flow_id: id };
}

export function AddEntryControls({
  flowNodeId,
  allNodes,
  entries,
  onChange,
  onCycleBlocked,
  onCreateNode,
}: {
  flowNodeId: string;
  allNodes: Node[];
  entries: PlaylistEntry[];
  onChange: (entries: PlaylistEntry[]) => Promise<void> | void;
  onCycleBlocked: (candidateFlowId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
}) {
  const [type, setType] = useState<PlaylistEntry["type"]>("view");
  const [label, setLabel] = useState("");

  async function pushEntry(entry: PlaylistEntry) {
    await onChange([...entries, entry]);
  }

  async function handleSelectNode(nodeId: string) {
    if (type === "flow" && wouldCreateCycle(flowNodeId, nodeId, allNodes)) {
      onCycleBlocked(nodeId);
      return;
    }

    if (type !== "view" && type !== "flow") return;
    await pushEntry(createRefEntry(type, nodeId));
  }

  async function handleCreateNode(title: string) {
    if (!onCreateNode) return;
    if (type !== "view" && type !== "flow") return;

    const created = await onCreateNode(type, title);
    const nodesForValidation = [...allNodes.filter((node) => node.id !== created.id), created];

    if (type === "flow" && wouldCreateCycle(flowNodeId, created.id, nodesForValidation)) {
      onCycleBlocked(created.id);
      return;
    }

    await pushEntry(createRefEntry(type, created.id));
  }

  async function handleAddStructured() {
    const trimmed = label.trim();

    if (type === "condition") {
      await pushEntry({
        type: "condition",
        label: trimmed || "Condition",
        if_true: [],
        if_false: [],
      });
      setLabel("");
      return;
    }

    if (type === "junction") {
      await pushEntry({
        type: "junction",
        label: trimmed || "Junction",
        cases: [{ label: "Case 1", entries: [] }],
      });
      setLabel("");
    }
  }

  return (
    <div className="border border-dashed border-border rounded-md p-3 flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-center">
        <Select value={type} onValueChange={(value) => setType(value as PlaylistEntry["type"])}>
          <SelectTrigger aria-label="Playlist entry type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="view">View</SelectItem>
            <SelectItem value="flow">Flow</SelectItem>
            <SelectItem value="condition">Condition</SelectItem>
            <SelectItem value="junction">Junction</SelectItem>
          </SelectContent>
        </Select>
        {(type === "view" || type === "flow") && (
          <NodeSearchCombobox
            species={type}
            allNodes={allNodes}
            onSelect={handleSelectNode}
            onCreate={onCreateNode ? handleCreateNode : undefined}
          />
        )}
        {(type === "condition" || type === "junction") && (
          <div className="flex items-center gap-2">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={type === "condition" ? "Condition label" : "Junction label"}
              aria-label={type === "condition" ? "Condition label" : "Junction label"}
            />
            <Button type="button" size="sm" onClick={handleAddStructured}>
              <PlusIcon className="size-4" />
              Add
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
