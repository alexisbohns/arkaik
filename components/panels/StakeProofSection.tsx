"use client";

import { useMemo, useState } from "react";
import { PROOF_EVENT_TYPES, deriveStakeProof, resolveKritikLibrary, type ProofCell } from "@arkaik/schema";

import { PanelSection } from "@/components/panels/PanelSection";
import { platformLabel } from "@/lib/config/platforms";
import { STAKE_STATE_HINTS, STAKE_STATE_LABELS } from "@/lib/config/stake-states";
import type { Edge, Node } from "@/lib/data/types";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useJournal } from "@/lib/hooks/useJournal";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { cn } from "@/lib/utils";

interface StakeProofSectionProps {
  node: Node;
  allNodes?: Node[];
  allEdges?: Edge[];
}

/** What a platform's mark says, strongest first: delivered, verified, stale, or nothing yet. */
function markOf(cell: ProofCell): { word: string; title: string } {
  if (cell.delivered && cell.verified) return { word: "Delivered", title: "Verified and live" };
  if (cell.stale) return { word: "Stale", title: "It was verified, but the check has lapsed or the criterion moved on" };
  if (cell.verified) return { word: "Verified", title: "Merged or live: the definition of done passes" };
  if (cell.delivered) return { word: "Live", title: "Live, but not verified" };
  return { word: "Open", title: "Neither verified nor delivered yet" };
}

/**
 * Where a stake stands, read only: the derived state as a chip and one mark per
 * platform the answer concerns (verified, delivered or stale). Nothing here is
 * stored; `deriveStakeProof` reads it off the graph the panel already has.
 *
 * Its inputs are the nodes and edges the panel was given, the journal events of
 * `PROOF_EVENT_TYPES` (`useJournal` projects the read to them, so a hosted
 * project never sends the rest), the product scope, and the project's own
 * quality and weighing sections. One source is not reachable cheaply here: the
 * Kritik pack lives outside the bundle, so a criterion's version is read from
 * the library the quality section embeds, and a project that embeds none cannot
 * show a requirement as stale for a newer criterion. The server-side readers
 * (the MCP tool) load the pack and do.
 */
export function StakeProofSection({ node, allNodes, allEdges }: StakeProofSectionProps) {
  const projectId = useProjectId();
  const { project } = useProject(projectId);
  const scope = useEffectiveProduct(projectId, project);
  const { journal, loading } = useJournal(projectId, { types: PROOF_EVENT_TYPES });
  // The clock is read once per mount: a panel left open for days is not what a re-verify interval measures.
  const [now] = useState(() => Date.now());
  const quality = project?.quality;
  const library = useMemo(() => resolveKritikLibrary(quality), [quality]);
  const productId = scope.productId;

  const proof = useMemo(
    () =>
      allNodes && allEdges && project && !loading
        ? deriveStakeProof({
            stakeId: node.id,
            nodes: allNodes,
            edges: allEdges,
            events: journal,
            now,
            project: project.project,
            productId,
            library,
            quality,
            weighing: project.weighing,
          })
        : null,
    [allNodes, allEdges, project, loading, node.id, journal, now, productId, library, quality],
  );

  if (!proof) return null;
  const state = proof.state;
  return (
    <PanelSection title="State">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
          title={state ? STAKE_STATE_HINTS[state] : "An archived stake derives no state"}
          data-stake-state={state ?? "archived"}
        >
          {state ? STAKE_STATE_LABELS[state] : "Archived"}
        </span>
        {state !== null && (
          <ul className="flex flex-wrap items-center gap-1" aria-label="Proof by platform" data-stake-cells="">
            {proof.cells.map((cell) => {
              const mark = markOf(cell);
              return (
                <li
                  key={cell.platform ?? "all"}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
                    cell.stale && "border-dashed",
                    !cell.verified && !cell.delivered && !cell.stale && "text-muted-foreground",
                  )}
                  title={mark.title}
                  data-stake-cell={cell.platform ?? "all"}
                  data-stake-cell-mark={mark.word.toLowerCase()}
                >
                  <span className="font-medium">{cell.platform === null ? "All" : platformLabel(cell.platform)}</span>
                  <span>{mark.word}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {state ? STAKE_STATE_HINTS[state] : "An archived stake derives no state."} Read off the graph, never typed in.
      </p>
    </PanelSection>
  );
}
