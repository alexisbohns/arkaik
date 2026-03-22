"use client";

import { useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { wouldCreateCycle } from "@/lib/utils/cycle";
import type { Node, PlaylistEntry } from "@/lib/data/types";
import { NodeSearchCombobox } from "@/components/panels/NodeSearchCombobox";

interface PlaylistEntryListProps {
  entries: PlaylistEntry[];
  onChange: (entries: PlaylistEntry[]) => Promise<void> | void;
  flowNodeId: string;
  allNodes: Node[];
  onCycleBlocked: (candidateFlowId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  depth?: number;
  heading?: string;
}

interface PlaylistEntryRowProps {
  entry: PlaylistEntry;
  index: number;
  total: number;
  flowNodeId: string;
  allNodes: Node[];
  onCycleBlocked: (candidateFlowId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onChangeEntry: (entry: PlaylistEntry) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  onMove: (delta: -1 | 1) => Promise<void> | void;
  depth: number;
}

function createRefEntry(species: "view" | "flow", id: string): PlaylistEntry {
  if (species === "view") {
    return { type: "view", view_id: id };
  }

  return { type: "flow", flow_id: id };
}

function branchIndentClass(depth: number): string {
  if (depth <= 0) return "";
  if (depth === 1) return "ml-4";
  if (depth === 2) return "ml-8";
  return "ml-10";
}

function AddEntryControls({
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

function PlaylistEntryRow({
  entry,
  index,
  total,
  flowNodeId,
  allNodes,
  onCycleBlocked,
  onCreateNode,
  onChangeEntry,
  onRemove,
  onMove,
  depth,
}: PlaylistEntryRowProps) {
  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  const refNode = entry.type === "flow"
    ? nodesById.get(entry.flow_id)
    : entry.type === "view"
      ? nodesById.get(entry.view_id)
      : undefined;

  return (
    <div className={`rounded-md border border-border bg-card p-3 flex flex-col gap-2 ${branchIndentClass(depth)}`}>
      <div className="flex items-start gap-2">
        <span className="text-xs text-muted-foreground min-w-6">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium capitalize">{entry.type}</p>
          {(entry.type === "view" || entry.type === "flow") && (
            <p className="text-xs text-muted-foreground truncate">
              {refNode?.title ?? "Missing node"} <span className="ml-1">({entry.type === "view" ? entry.view_id : entry.flow_id})</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" className="cursor-pointer" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUpIcon className="size-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="cursor-pointer" disabled={index >= total - 1} onClick={() => onMove(1)}>
            <ArrowDownIcon className="size-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="text-destructive cursor-pointer" onClick={() => void onRemove()}>
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </div>

      {entry.type === "condition" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Label</span>
            <Input
              value={entry.label}
              onChange={(event) => void onChangeEntry({ ...entry, label: event.target.value })}
              aria-label="Condition label"
            />
          </div>
          <PlaylistEntryList
            heading="Yes"
            entries={entry.if_true}
            depth={depth + 1}
            flowNodeId={flowNodeId}
            allNodes={allNodes}
            onCycleBlocked={onCycleBlocked}
            onCreateNode={onCreateNode}
            onChange={(next) => onChangeEntry({ ...entry, if_true: next })}
          />
          <PlaylistEntryList
            heading="No"
            entries={entry.if_false}
            depth={depth + 1}
            flowNodeId={flowNodeId}
            allNodes={allNodes}
            onCycleBlocked={onCycleBlocked}
            onCreateNode={onCreateNode}
            onChange={(next) => onChangeEntry({ ...entry, if_false: next })}
          />
        </div>
      )}

      {entry.type === "junction" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Label</span>
            <Input
              value={entry.label}
              onChange={(event) => void onChangeEntry({ ...entry, label: event.target.value })}
              aria-label="Junction label"
            />
          </div>

          <div className="flex flex-col gap-2">
            {entry.cases.map((playlistCase, caseIndex) => (
              <div key={`${caseIndex}-${playlistCase.label}`} className={`rounded-md border border-border p-2 flex flex-col gap-2 ${branchIndentClass(depth + 1)}`}>
                <div className="flex items-center gap-2">
                  <Input
                    value={playlistCase.label}
                    onChange={(event) => {
                      const nextCases = entry.cases.map((item, idx) => {
                        if (idx !== caseIndex) return item;
                        return { ...item, label: event.target.value };
                      });
                      void onChangeEntry({ ...entry, cases: nextCases });
                    }}
                    aria-label={`Junction case ${caseIndex + 1} label`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive cursor-pointer"
                    onClick={() => {
                      const nextCases = entry.cases.filter((_, idx) => idx !== caseIndex);
                      void onChangeEntry({ ...entry, cases: nextCases });
                    }}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
                <PlaylistEntryList
                  entries={playlistCase.entries}
                  depth={depth + 2}
                  flowNodeId={flowNodeId}
                  allNodes={allNodes}
                  onCycleBlocked={onCycleBlocked}
                  onCreateNode={onCreateNode}
                  onChange={(nextEntries) => {
                    const nextCases = entry.cases.map((item, idx) => {
                      if (idx !== caseIndex) return item;
                      return { ...item, entries: nextEntries };
                    });
                    return onChangeEntry({ ...entry, cases: nextCases });
                  }}
                />
              </div>
            ))}
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onChangeEntry({
              ...entry,
              cases: [...entry.cases, { label: `Case ${entry.cases.length + 1}`, entries: [] }],
            })}
          >
            <PlusIcon className="size-4" />
            Add case
          </Button>
        </div>
      )}
    </div>
  );
}

export function PlaylistEntryList({
  entries,
  onChange,
  flowNodeId,
  allNodes,
  onCycleBlocked,
  onCreateNode,
  depth = 0,
  heading,
}: PlaylistEntryListProps) {
  async function handleMove(index: number, delta: -1 | 1) {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= entries.length) return;

    const next = [...entries];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    await onChange(next);
  }

  async function handleRemove(index: number) {
    await onChange(entries.filter((_, idx) => idx !== index));
  }

  async function handleReplace(index: number, entry: PlaylistEntry) {
    const next = entries.map((item, idx) => (idx === index ? entry : item));
    await onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {heading && <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{heading}</p>}
      {entries.length === 0 && (
        <p className={`text-xs text-muted-foreground ${branchIndentClass(depth)}`}>No entries yet.</p>
      )}
      {entries.map((entry, index) => (
        <PlaylistEntryRow
          key={`${entry.type}-${index}`}
          entry={entry}
          index={index}
          total={entries.length}
          flowNodeId={flowNodeId}
          allNodes={allNodes}
          onCycleBlocked={onCycleBlocked}
          onCreateNode={onCreateNode}
          depth={depth}
          onMove={(delta) => handleMove(index, delta)}
          onRemove={() => handleRemove(index)}
          onChangeEntry={(nextEntry) => handleReplace(index, nextEntry)}
        />
      ))}
      <AddEntryControls
        flowNodeId={flowNodeId}
        allNodes={allNodes}
        entries={entries}
        onChange={onChange}
        onCycleBlocked={onCycleBlocked}
        onCreateNode={onCreateNode}
      />
    </div>
  );
}
