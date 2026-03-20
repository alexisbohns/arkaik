"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EDGE_TYPES, type EdgeTypeId } from "@/lib/config/edge-types";

interface EdgeTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (edgeType: EdgeTypeId) => void;
}

export function EdgeTypeDialog({ open, onOpenChange, onSelect }: EdgeTypeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Choose edge type</DialogTitle>
          <DialogDescription>
            Select the relationship type for the connection between these two nodes.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          {EDGE_TYPES.map((et) => (
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
      </DialogContent>
    </Dialog>
  );
}
