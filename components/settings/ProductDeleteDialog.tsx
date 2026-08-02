"use client";

import { useEffect, useState } from "react";
import type { ProductDefinition } from "@arkaik/schema";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { productDisplayTitle } from "@/lib/utils/product-scope";

/**
 * Delete a product, and decide what happens to the nodes that named it (§ D3).
 *
 * THE COUNT COMES BEFORE THE CHOICE, because it is the whole reason there is a
 * choice: deleting an empty product is a one-click nothing, and deleting one
 * with forty views is a decision. So the destination field does not even render
 * when nothing belongs to the product — an empty deletion should not look like
 * it has consequences it does not have.
 *
 * LEAVING THEM UNASSIGNED IS OFFERED, NOT ASSUMED. Unassigning silently is the
 * behaviour a delete button without a dialog would have, and it drops data the
 * user may not know they had: an unassigned flow shows only under All products,
 * which is triage rather than deletion, but it is still somewhere a node gets
 * lost. *Rejected* for the same reason: blocking deletion while members exist,
 * which forces exactly the tedium the bulk-move tool exists to remove.
 *
 * BOTH BRANCHES ARE ONE PLAN. This dialog reports a destination and nothing
 * more — `planProductDeletion` decides what that means and `applyProductPlan`
 * executes it as two ordered writes. A loop of single-node patches here would
 * be N chances to half-fail with no way to say what happened.
 *
 * THE COUNT IS LIVE, NOT CAPTURED. `memberCount` is derived by the panel from
 * the node list it is currently rendering, so a refetch while this dialog sits
 * open moves the number rather than leaving a stale one on screen — and the
 * plan the confirm builds is computed at that moment from the same list, never
 * from a snapshot taken at open. The remaining seam (a node changing between
 * the click and the write) is closed one layer down: `planToOps` drops a
 * reassignment for a node the map no longer knows rather than patching it from
 * no prior metadata.
 */

/** Radix reserves `""` for no-selection, so "leave unassigned" needs a sentinel. */
const UNASSIGNED = "__unassigned__";

interface ProductDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDefinition | null;
  /** How many nodes store this product's id, as of the current node list. */
  memberCount: number;
  /** Every other declared product, as reassignment targets. */
  otherProducts: readonly ProductDefinition[];
  onConfirm: (reassignTo: string | null) => void;
  busy?: boolean;
}

export function ProductDeleteDialog({
  open,
  onOpenChange,
  product,
  memberCount,
  otherProducts,
  onConfirm,
  busy,
}: ProductDeleteDialogProps) {
  const [reassignTo, setReassignTo] = useState<string>(UNASSIGNED);

  /**
   * Default to unassigned every time the dialog opens. A destination remembered
   * from the previous deletion is exactly the state that moves forty nodes
   * somewhere nobody chose, and the safe default is the one whose consequence
   * is visible in the list rather than buried in another product.
   */
  useEffect(() => {
    if (open) setReassignTo(UNASSIGNED);
  }, [open, product]);

  // The title-or-id fallback is `productDisplayTitle`'s, so a product with no
  // stored title is named identically in the dialog that deletes it and in the
  // row it was deleted from.
  const title = productDisplayTitle(product);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete product</DialogTitle>
          <DialogDescription>
            {memberCount === 0
              ? `Nothing belongs to "${title}", so deleting it changes nothing else.`
              : `${memberCount} node${memberCount === 1 ? "" : "s"} belong${
                  memberCount === 1 ? "s" : ""
                } to "${title}".`}
          </DialogDescription>
        </DialogHeader>

        {memberCount > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Move them to
            </span>
            <Select value={reassignTo} onValueChange={setReassignTo} disabled={busy}>
              <SelectTrigger aria-label="Move nodes to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Leave them unassigned</SelectItem>
                {otherProducts.map((other) => (
                  <SelectItem key={other.id} value={other.id}>
                    {productDisplayTitle(other)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reassignTo === UNASSIGNED && (
              <p className="text-xs text-muted-foreground">
                Unassigned nodes still exist &mdash; they appear under All products until someone
                gives them a home.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="cursor-pointer"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="cursor-pointer"
            disabled={busy}
            onClick={() => onConfirm(reassignTo === UNASSIGNED ? null : reassignTo)}
          >
            {busy ? "Deleting…" : "Delete product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
