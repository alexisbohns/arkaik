"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** When provided, renders a cascade checkbox with this label. */
  cascadeLabel?: string;
  cascadeChecked?: boolean;
  onCascadeChange?: (checked: boolean) => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cascadeLabel,
  cascadeChecked,
  onCascadeChange,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {cascadeLabel && (
          <div className="flex items-center gap-2 py-1">
            <input
              id="cascade-check"
              type="checkbox"
              checked={cascadeChecked}
              onChange={(e) => onCascadeChange?.(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-foreground"
            />
            <label htmlFor="cascade-check" className="text-sm select-none cursor-pointer">
              {cascadeLabel}
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
