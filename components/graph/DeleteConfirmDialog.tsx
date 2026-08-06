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
import { Checkbox } from "@/components/ui/checkbox";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
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
  confirmLabel = "Delete",
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
            {/* The primitive is a `<button role="checkbox">`, which is a
                labelable element, so the plain `<label for>` beside it keeps
                forwarding its clicks — and `onCheckedChange` hands back the
                next state directly, where the native input needed the event's
                `target.checked` read back off the DOM. */}
            <Checkbox
              id="cascade-check"
              checked={cascadeChecked}
              onCheckedChange={(checked) => onCascadeChange?.(checked === true)}
              className="cursor-pointer"
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
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
