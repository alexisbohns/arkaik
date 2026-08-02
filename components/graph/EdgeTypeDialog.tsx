"use client";

import { edgeTypesForSpeciesPair, type SpeciesId } from "@arkaik/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EDGE_TYPES, type EdgeTypeId } from "@/lib/config/edge-types";
import { SPECIES } from "@/lib/config/species";

interface EdgeTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (edgeType: EdgeTypeId) => void;
  /** Species of the dragged-from node; `null` while no connection is pending. */
  sourceSpecies: SpeciesId | null;
  /** Species of the dropped-on node; `null` while no connection is pending. */
  targetSpecies: SpeciesId | null;
}

const speciesLabel = (species: SpeciesId | null) =>
  SPECIES.find((s) => s.id === species)?.label ?? species ?? "node";

/**
 * Offers only the relationships the graph model admits for this ordered species
 * pair (issue #317). The dialog used to list all five edge types regardless of
 * what was connected, so the editor could author graphs its own validator
 * rejects on import — the shape rendered fine until the project left the app.
 */
export function EdgeTypeDialog({ open, onOpenChange, onSelect, sourceSpecies, targetSpecies }: EdgeTypeDialogProps) {
  const allowed = sourceSpecies && targetSpecies ? edgeTypesForSpeciesPair(sourceSpecies, targetSpecies) : [];
  const options = EDGE_TYPES.filter((et) => allowed.includes(et.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{options.length > 0 ? "Choose edge type" : "No relationship available"}</DialogTitle>
          <DialogDescription>
            {options.length > 0
              ? `Select the relationship type for the connection between these two nodes.`
              : `A ${speciesLabel(sourceSpecies)} cannot point at a ${speciesLabel(targetSpecies)}. Try connecting them the other way round, or pick different nodes.`}
          </DialogDescription>
        </DialogHeader>
        {options.length > 0 && (
          <div className="flex flex-col gap-2 pt-2">
            {options.map((et) => (
              <Button
                key={et.id}
                variant="outline"
                className="justify-start"
                onClick={() => onSelect(et.id)}
              >
                {et.label}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
