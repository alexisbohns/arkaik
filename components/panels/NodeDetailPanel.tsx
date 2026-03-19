"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface NodeDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId?: string;
}

export function NodeDetailPanel({
  open,
  onOpenChange,
  nodeId,
}: NodeDetailPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Node detail</SheetTitle>
          <SheetDescription>
            Inspect and edit the properties of node {nodeId}.
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
