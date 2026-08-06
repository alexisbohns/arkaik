"use client";

import { toast } from "sonner";
import type { Node, PlaylistEntry } from "@/lib/data/types";
import { PlaylistEntryList } from "@/components/panels/PlaylistEntryRow";
import { PanelSection } from "@/components/panels/PanelSection";

interface PlaylistEditorProps {
  node: Node;
  allNodes: Node[];
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
}

export function PlaylistEditor({ node, allNodes, onUpdate, onCreateNode }: PlaylistEditorProps) {
  const entries = Array.isArray(node.metadata?.playlist?.entries)
    ? node.metadata.playlist.entries
    : [];

  async function persistEntries(nextEntries: PlaylistEntry[]) {
    if (!onUpdate) return;

    try {
      await onUpdate(node.id, {
        metadata: {
          ...node.metadata,
          playlist: {
            entries: nextEntries,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update playlist";
      toast.error(message);
    }
  }

  function handleCycleBlocked(candidateFlowId: string) {
    toast.error(`Cannot add Flow ${candidateFlowId}: it would create a circular reference.`);
  }

  return (
    <PanelSection title="Playlist">
      <PlaylistEntryList
        entries={entries}
        onChange={persistEntries}
        flowNodeId={node.id}
        allNodes={allNodes}
        onCycleBlocked={handleCycleBlocked}
        onCreateNode={onCreateNode}
      />
    </PanelSection>
  );
}
