"use client";

import { useEffect, useRef, useState } from "react";
import type { Node, Edge, PlatformStatusMap } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { ValueId } from "@arkaik/schema";
import { STATUSES } from "@/lib/config/statuses";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_ICONS, STATUS_STYLES, SPECIES_ICONS } from "@/components/graph/nodes/node-styles";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { ValuePicker } from "@/components/values/ValuePicker";

interface AcceptanceEditorProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onNavigate?: (node: Node) => void;
}

export function AcceptanceEditor({ node, allNodes, allEdges, onUpdate, onNavigate }: AcceptanceEditorProps) {
  const [gherkin, setGherkin] = useState(node.metadata?.gherkin ?? "");
  const nodeRef = useRef(node);
  useEffect(() => { nodeRef.current = node; }, [node]);
  // Debounce-save gherkin. The effect reschedules on every keystroke and clears
  // its timer on rechange/unmount, so the save closure is always fresh. It reads
  // the LATEST node via nodeRef at fire time, so a concurrent values/status edit
  // isn't clobbered by the provider's shallow metadata merge (mirrors NodeFields).
  useEffect(() => {
    if (gherkin === (nodeRef.current.metadata?.gherkin ?? "")) return;
    const t = setTimeout(() => {
      onUpdate(nodeRef.current.id, { metadata: { ...nodeRef.current.metadata, gherkin } });
    }, 350);
    return () => clearTimeout(t);
  }, [gherkin, onUpdate]);

  const statuses: PlatformStatusMap = getEditablePlatformStatuses(node);
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const coveredAnchors = allEdges
    .filter((e) => e.edge_type === "covers" && e.source_id === node.id)
    .map((e) => nodesById.get(e.target_id))
    .filter((n): n is Node => Boolean(n));

  function patchMetadata(next: Record<string, unknown>) {
    onUpdate(node.id, { metadata: { ...node.metadata, ...next } });
  }

  return (
    <div className="px-6 flex flex-col gap-5">
      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Status</span>
        <Select value={node.status} onValueChange={(v) => onUpdate(node.id, { status: v as StatusId })}>
          <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => {
              const Icon = STATUS_ICONS[s.id];
              return <SelectItem key={s.id} value={s.id}><span className="inline-flex items-center gap-2"><Icon className={`size-3.5 ${STATUS_STYLES[s.id].badge}`} />{s.label}</span></SelectItem>;
            })}
          </SelectContent>
        </Select>
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Gherkin — the How (one Given/When/Then)</span>
        <textarea
          value={gherkin}
          onChange={(e) => setGherkin(e.target.value)}
          rows={3}
          placeholder="When I'm on …, Then …"
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Values — the Why</span>
        <ValuePicker selected={node.metadata?.values ?? []} onChange={(values: ValueId[]) => patchMetadata({ values })} />
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Per-platform status</span>
        <PlatformVariants
          statuses={statuses}
          notes={node.metadata?.platformNotes}
          screenshots={node.metadata?.platformScreenshots}
          onStatusChange={(platform: PlatformId, value) => {
            const next = { ...statuses };
            if (value) next[platform] = value; else delete next[platform];
            patchMetadata({ platformStatuses: next });
          }}
          onNotesChange={(platform: PlatformId, value) => patchMetadata({ platformNotes: { ...node.metadata?.platformNotes, [platform]: value } })}
          onScreenshotChange={(platform: PlatformId, value) => patchMetadata({ platformScreenshots: { ...node.metadata?.platformScreenshots, [platform]: value } })}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Covers</span>
        {coveredAnchors.length === 0 ? (
          <p className="text-xs text-muted-foreground">Product-level (covers nothing).</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {coveredAnchors.map((anchor) => {
              const Icon = SPECIES_ICONS[anchor.species];
              return (
                <li key={anchor.id}>
                  <button type="button" className="inline-flex items-center gap-2 text-sm hover:underline" onClick={() => onNavigate?.(anchor)}>
                    <Icon className="size-3.5 text-muted-foreground" /> {anchor.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
