"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const LABEL_AUTOSAVE_DELAY_MS = 350;

/**
 * One editing session on a playlist label. All four fields have to move
 * together, and they have to be *state* rather than refs, because the
 * adopt-from-outside rule below runs during render — where refs are off limits.
 */
interface LabelDraft {
  /** What the input shows. */
  text: string;
  /** The last label seen coming in from above, so an external *change* is distinguishable from a mere difference against local text. */
  anchor: string;
  /** The last text sent upstream, so its own round-trip is not mistaken for someone else's edit. */
  committed: string;
  /** Whether `text` still owes the store a write. */
  pending: boolean;
}

/**
 * A playlist label field — condition, junction, or junction case — that types
 * locally and persists on a debounce.
 *
 * Every label write here is a **whole-node metadata write**: `onCommit` walks
 * back up to `PlaylistEditor.persistEntries`, which rebuilds
 * `metadata.playlist` and hands the node to `provider.updateNode` — an
 * IndexedDB write locally, an HTTP request on a hosted project. Bound straight
 * to `entry.label`, these Inputs fired one of those per keystroke, and because
 * the controlled value only came back once the async write resolved and
 * `useNodes` re-set state, typed characters visibly reverted and two in-flight
 * remote writes could land out of order. So the text lives here and the write
 * is debounced at 350ms — the same treatment `NodeFields`
 * (NodeDetailPanel.tsx:95-140) and `AcceptanceEditor` (AcceptanceEditor.tsx:50-60)
 * give the same kind of edit.
 */
function DebouncedLabelInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (label: string) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<LabelDraft>({
    text: value,
    anchor: value,
    committed: value,
    pending: false,
  });

  /**
   * The latest draft and the latest `onCommit`, read at fire time — the
   * `nodeRef` pattern from AcceptanceEditor.tsx:48-60. It matters more here
   * than it does there: `onCommit` rebuilds the whole entries array out of the
   * props of the render that made it, so firing a closure from an older render
   * would write a stale playlist back over a newer one, in the worst case
   * resurrecting an entry deleted in between.
   */
  const draftRef = useRef(draft);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    draftRef.current = draft;
    commitRef.current = onCommit;
  });

  const flush = useCallback(() => {
    const current = draftRef.current;
    if (!current.pending) return;
    draftRef.current = { ...current, committed: current.text, pending: false };
    setDraft(draftRef.current);
    commitRef.current(current.text);
  }, []);

  // Keyed on the text and the pending flag, not on the draft object: an
  // `anchor` bump (below) is bookkeeping about a value that already exists in
  // the store and must not push the write another 350ms out.
  useEffect(() => {
    if (!draft.pending) return;
    const timeout = setTimeout(flush, LABEL_AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [draft.text, draft.pending, flush]);

  /**
   * Adopt a label that changed from OUTSIDE — a different entry landing in this
   * row (entries are keyed by index, so the move-up/move-down buttons and a
   * sibling deletion both hand an existing row someone else's data) or another
   * writer touching the same node.
   *
   * The guard that makes this safe is `committed`: the *only* external change
   * that occurs during ordinary typing is this input's own write coming back
   * through the store, and ignoring that echo is precisely what stops the
   * characters-revert bug from returning. Anything else is genuinely a
   * different label, and then the pending edit belongs to whatever used to be
   * in this row — dropping it is the point, not a casualty.
   *
   * Adjusted during render rather than from an effect: this is state derived
   * from a prop change, so an effect would paint the stale text once and then
   * cascade a second render over it — React re-runs this component with the new
   * draft before committing anything to the DOM.
   */
  if (value !== draft.anchor) {
    setDraft(
      value === draft.committed
        ? { ...draft, anchor: value }
        : { text: value, anchor: value, committed: value, pending: false },
    );
  }

  /**
   * Commit on unmount rather than discarding up to 350ms of typing the way
   * `NodeFields` does — a playlist row unmounts on far more than a panel close.
   * Deliberately not `flush`: there is no state left worth updating here, and
   * the write is the only part that still matters. `[]` deps, so it runs once.
   */
  useEffect(() => {
    return () => {
      const current = draftRef.current;
      if (!current.pending) return;
      commitRef.current(current.text);
    };
  }, []);

  return (
    <Input
      value={draft.text}
      onChange={(event) => {
        const next = event.target.value;
        setDraft((current) => ({ ...current, text: next, pending: true }));
      }}
      // Blur commits immediately, which is what keeps the debounce window from
      // outliving the structure it was typed into: clicking Add case, the case
      // delete button, or a move arrow blurs the input first, so the write lands
      // against the entries array the user was actually looking at.
      onBlur={flush}
      aria-label={ariaLabel}
    />
  );
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
            <DebouncedLabelInput
              value={entry.label}
              onCommit={(label) => void onChangeEntry({ ...entry, label })}
              ariaLabel="Condition label"
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
            <DebouncedLabelInput
              value={entry.label}
              onCommit={(label) => void onChangeEntry({ ...entry, label })}
              ariaLabel="Junction label"
            />
          </div>

          <div className="flex flex-col gap-2">
            {/*
              * Keyed by index, never by `playlistCase.label`: the label is
              * edited by the Input inside this row, so a label key made every
              * persisted keystroke remount the row, drop focus, and throw away
              * whatever was typed during the in-flight write — one click per
              * character — while also wiping the nested list's own state.
              *
              * Index is the right key because `JunctionCase`
              * (packages/schema/src/playlist.ts:3-6) carries no id, and cases
              * are never reordered: this editor only appends (Add case) and
              * removes, there is no case-level move control (unlike entries),
              * and nothing else in the repo sorts or splices `cases`. A removal
              * still shifts every later case up one index; `DebouncedLabelInput`
              * handles that by adopting the label that lands in the row.
              */}
            {entry.cases.map((playlistCase, caseIndex) => (
              <div key={caseIndex} className={`rounded-md border border-border p-2 flex flex-col gap-2 ${branchIndentClass(depth + 1)}`}>
                <div className="flex items-center gap-2">
                  <DebouncedLabelInput
                    value={playlistCase.label}
                    onCommit={(label) => {
                      const nextCases = entry.cases.map((item, idx) => {
                        if (idx !== caseIndex) return item;
                        return { ...item, label };
                      });
                      void onChangeEntry({ ...entry, cases: nextCases });
                    }}
                    ariaLabel={`Junction case ${caseIndex + 1} label`}
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
