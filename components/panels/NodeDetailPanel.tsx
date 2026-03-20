"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { Node } from "@/lib/data/types";
import { SPECIES } from "@/lib/config/species";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";

interface NodeDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: Node;
}

export function NodeDetailPanel({
  open,
  onOpenChange,
  node,
}: NodeDetailPanelProps) {
  const speciesConfig = SPECIES.find((s) => s.id === node?.species);
  const speciesLabel = speciesConfig?.label ?? node?.species;
  const speciesDescription = speciesConfig?.description;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{node?.title ?? "Node detail"}</SheetTitle>
          {speciesLabel && (
            <SheetDescription>{speciesLabel}{speciesDescription ? ` — ${speciesDescription}` : ""}</SheetDescription>
          )}
        </SheetHeader>
        {node && (
          <div className="px-6 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</span>
              <div>
                <StatusBadge status={node.status} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platforms</span>
              {node.platforms.length > 0 ? (
                <div className="flex items-center gap-2">
                  {node.platforms.map((platformId) => (
                    <span
                      key={platformId}
                      className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-muted text-foreground font-medium"
                    >
                      <span className={`w-2 h-2 rounded-full ${PLATFORM_DOT_STYLES[platformId]}`} />
                      {PLATFORM_LABELS[platformId]}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">None</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</span>
              {node.description ? (
                <p className="text-sm text-foreground leading-relaxed">{node.description}</p>
              ) : (
                <span className="text-sm text-muted-foreground">No description</span>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
