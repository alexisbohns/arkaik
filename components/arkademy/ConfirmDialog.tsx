"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  /** The button that opens the dialog: its words and icon. */
  trigger: ReactNode;
  /** Nothing to act on: the button is disabled. */
  disabled?: boolean;
  title: string;
  description: string;
  /** The red action's words: "Start over", "Discard". */
  confirmLabel: string;
  onConfirm: () => void;
  /** Where focus goes once confirmed (the opening button may be gone or disabled by then). */
  focusAfterConfirm: string;
}

/**
 * A destructive action and its confirmation, in the app's style — the shape
 * of `DeleteConfirmDialog` (components/graph/DeleteConfirmDialog.tsx): a
 * title, one sentence, Cancel first (it takes the focus), then the red
 * action. The opening button is the dialog's trigger, so Cancel and Escape
 * give it the focus back (Radix returns focus only to a `DialogTrigger`);
 * after a confirmation the focus goes to `focusAfterConfirm`.
 */
export function ConfirmDialog({
  trigger,
  disabled = false,
  title,
  description,
  confirmLabel,
  onConfirm,
  focusAfterConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setConfirmed(false);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="text-muted-foreground">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          if (!confirmed) return;
          event.preventDefault();
          document.getElementById(focusAfterConfirm)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmed(true);
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
