"use client";

import { toast } from "sonner";
import type { Node, PlaylistEntry } from "@/lib/data/types";
import { PlaylistEntryList } from "@/components/panels/PlaylistEntryRow";
import { PanelGroup } from "@/components/panels/PanelGroup";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";

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
    <PanelGroup title="Playlist">
      {/* The group does not gutter its children the way `PanelSection` did, so
          the composer carries its own — otherwise it would sit flush against
          the panel's edges while every field above it stays indented. */}
      <div className={PANEL_GUTTER}>
        <PlaylistEntryList
          entries={entries}
          onChange={persistEntries}
          flowNodeId={node.id}
          allNodes={allNodes}
          onCycleBlocked={handleCycleBlocked}
          onCreateNode={onCreateNode}
        />
      </div>
    </PanelGroup>
  );
}
