"use client";

import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";

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

interface StartOverDialogProps {
  /** Nothing to clear: the button is disabled. */
  disabled: boolean;
  onConfirm: () => void;
  /** Where focus goes once the canvas is cleared (the button is disabled by then). */
  focusAfterConfirm: string;
}

/**
 * "Start over" and its confirmation, in the app's destructive style — the
 * shape of `DeleteConfirmDialog` (components/graph/DeleteConfirmDialog.tsx): a
 * title, one sentence, Cancel first (it takes the focus), then the red action.
 * The button is the dialog's trigger, so Cancel and Escape give it the focus
 * back; after a confirmed start over the focus goes to `focusAfterConfirm`.
 */
export function StartOverDialog({ disabled, onConfirm, focusAfterConfirm }: StartOverDialogProps) {
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
          <RotateCcwIcon aria-hidden="true" />
          Start over
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
          <DialogTitle>Start over?</DialogTitle>
          <DialogDescription>
            Your product&apos;s name and every answer leave this browser. Download JSON first if you want to keep a
            copy.
          </DialogDescription>
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
            Start over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
