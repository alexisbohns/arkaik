"use client";

import type { Node, Edge } from "@/lib/data/types";
import { acceptancesCovering, hasParityGap } from "@arkaik/schema";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import { PlatformList } from "@/components/graph/nodes/PlatformList";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { Button } from "@/components/ui/button";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

interface AcceptancesSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  onNavigate?: (node: Node) => void;
  onCreate?: (anchor: Node, title: string) => Promise<Node>;
}

export function AcceptancesSection({ node, allNodes, allEdges, onNavigate, onCreate }: AcceptancesSectionProps) {
  const covering = acceptancesCovering(node.id, allNodes, allEdges);
  return (
    <section className="px-6 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Acceptances</span>
        {onCreate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              const title = window.prompt(`New acceptance for "${node.title}" (the What):`);
              if (!title || !title.trim() || !onCreate) return;
              try {
                await onCreate(node, title.trim());
              } catch (err) {
                toast.error("Couldn't add the acceptance.");
                console.error(err);
              }
            }}
          >
            <PlusIcon className="size-4" /> Add
          </Button>
        )}
      </div>
      {covering.length === 0 ? (
        <p className="text-xs text-muted-foreground">No acceptances cover this {node.species} yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {covering.map((acc) => (
            <li key={acc.id}>
              <button
                type="button"
                onClick={() => onNavigate?.(acc)}
                className="flex w-full flex-col gap-1 rounded-md border p-2 text-left hover:bg-muted/40"
              >
                <span className="flex items-center gap-1.5 text-sm">
                  {hasParityGap(acc) && <TriangleAlertIcon className="size-3.5 text-amber-500" aria-label="Parity gap" />}
                  {acc.title}
                </span>
                <EntityId id={acc.id} />
                <PlatformList platforms={acc.platforms} platformStatuses={getEditablePlatformStatuses(acc)} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
