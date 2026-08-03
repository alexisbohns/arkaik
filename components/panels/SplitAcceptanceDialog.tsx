"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSeedOnOpen } from "@/lib/hooks/useSeedOnOpen";
import { splitPieces } from "@/lib/utils/acceptance-intake";

/**
 * Break one acceptance into several.
 *
 * **The first row is the acceptance you are standing in.** It arrives filled
 * with the current title and renames it in place; every row below creates a new
 * acceptance. Saying so on screen is what makes the gesture legible — a "split"
 * that silently left a parent behind, or silently deleted one, would be two
 * quite different operations wearing the same word.
 *
 * The dialog collects titles and nothing else. What each piece inherits — the
 * product, the anchors, the platforms — is `planAcceptanceSplit`'s to decide and
 * is stated once, in the footnote, rather than offered as choices nobody filing
 * an idea has an opinion about yet.
 */

interface SplitAcceptanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The title the first row is seeded with — the acceptance being split. */
  title: string;
  /** How many nodes the original covers, for the sentence about what carries over. */
  anchorCount: number;
  onSubmit: (titles: string[]) => Promise<void> | void;
}

export function SplitAcceptanceDialog({
  open,
  onOpenChange,
  title,
  anchorCount,
  onSubmit,
}: SplitAcceptanceDialogProps) {
  const [rows, setRows] = useState<string[]>([title, ""]);
  const [busy, setBusy] = useState(false);

  // Seeded on the closed → open transition, like `NewAcceptanceForm`: the panel
  // keeps this mounted, and the title can change under it (the editor renames on
  // a debounce), so an initial `useState` would show a stale first row forever.
  useSeedOnOpen(open, title, (next) => setRows([next, ""]));

  const pieces = splitPieces(rows);
  const canSplit = pieces.length >= 2 && !busy;

  function setRow(index: number, value: string) {
    setRows((prev) => prev.map((row, i) => (i === index ? value : row)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSplit) return;
    setBusy(true);
    try {
      await onSubmit(pieces);
      onOpenChange(false);
    } catch {
      // Closing here would throw away rows the user typed for a write that did
      // not happen. The caller has already reported the failure; leave the
      // dialog exactly as it was so the same submit can be tried again.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Split acceptance</DialogTitle>
          <DialogDescription>
            One idea, several statements. The first piece renames this acceptance; the rest are
            created as new ideas.
          </DialogDescription>
        </DialogHeader>
        <form id="split-acceptance-form" onSubmit={handleSubmit} className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={row}
                onChange={(event) => setRow(index, event.target.value)}
                placeholder={index === 0 ? "The What — what must be true" : "Another piece"}
                aria-label={index === 0 ? "First piece (renames this acceptance)" : `Piece ${index + 1}`}
                disabled={busy}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                // The first two rows are the split itself — removing one would
                // leave a dialog that cannot do the thing it is for.
                disabled={rows.length <= 2 || busy}
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                aria-label={`Remove piece ${index + 1}`}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setRows((prev) => [...prev, ""])}
            disabled={busy}
          >
            <PlusIcon className="size-4" /> Add a piece
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Each new piece keeps this acceptance&apos;s product
          {anchorCount > 0
            ? `, covers the same ${anchorCount} node${anchorCount === 1 ? "" : "s"},`
            : ""}{" "}
          and starts as an idea. Blank and duplicate rows are ignored.
        </p>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="split-acceptance-form" disabled={!canSplit}>
            {pieces.length >= 2 ? `Split into ${pieces.length}` : "Split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
