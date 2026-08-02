"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProductDefinition } from "@arkaik/schema";
import type { NodeMetadata } from "@/lib/data/types";
import { ProductPicker } from "@/components/panels/ProductPicker";
import { useSeedOnOpen } from "@/lib/hooks/useSeedOnOpen";
import { withProductMembership } from "@/lib/utils/product-editing";

/**
 * Create one acceptance: a title, and the product it belongs to.
 *
 * **Why this exists at all.** The Acceptances page used to create through a
 * `window.prompt`, which was a reasonable call while acceptances were made at
 * scale by the retro-population agents and by hand only rarely. It stopped being
 * reasonable the moment products shipped: a prompt returns a string and nothing
 * else, so every acceptance created under a named scope landed with no
 * membership — and an acceptance covering nothing reads its membership from its
 * own stored key, so it appeared under All products only. The user watched the
 * thing they had just created vanish from the scope they were standing in, with
 * no explanation. A dialog is the smallest surface that can carry the product.
 *
 * **Deliberately smaller than `NewNodeForm`.** No species (it is always an
 * acceptance), no platforms and no status (acceptances are created as ideas
 * across every platform, and both of those are the page's business, not the
 * user's, at create time). Adding fields here would change what an acceptance
 * *is* on creation; this only stops one from being born outside its scope.
 *
 * **The degenerate case is byte-identical to the prompt's replacement.** With no
 * products declared this is a title field and nothing else — no picker, no
 * label, no new word.
 */

export interface NewAcceptanceFormData {
  title: string;
  /** Omitted entirely when there is no membership to record. */
  metadata?: NodeMetadata;
}

interface NewAcceptanceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: NewAcceptanceFormData) => void;
  /**
   * The project's declared products. **Empty means the picker never renders** —
   * the same guarantee, and the same guard, as `NewNodeForm`.
   */
  products?: readonly ProductDefinition[];
  /** The scope the user is standing in, pre-filled and editable (§ D1). */
  defaultProductId?: string | null;
}

export function NewAcceptanceForm({
  open,
  onOpenChange,
  onSubmit,
  products = [],
  defaultProductId = null,
}: NewAcceptanceFormProps) {
  const [title, setTitle] = useState("");
  const [product, setProduct] = useState<string | null>(defaultProductId);

  const showsProductPicker = products.length > 0;

  // Seeded on the closed → open transition only. The page keeps this dialog
  // mounted, and `scope.productId` resolves late against a bundle that loads in
  // an effect, so neither the initial `useState` nor a bare `open` effect is
  // enough — see `useSeedOnOpen`.
  useSeedOnOpen(open, defaultProductId, setProduct);

  function resetForm() {
    setTitle("");
    setProduct(defaultProductId);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    // `withProductMembership` removes the key for null rather than blanking it,
    // so an unassigned acceptance carries no `product` at all — and the whole
    // object is dropped when it would be empty, leaving the created node exactly
    // as it was before this dialog existed.
    const metadata = showsProductPicker ? withProductMembership(undefined, product) : {};

    onSubmit({
      title: title.trim(),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    resetForm();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New acceptance</DialogTitle>
          <DialogDescription className="sr-only">
            Name the acceptance, and choose which product it belongs to.
          </DialogDescription>
        </DialogHeader>
        <form id="new-acceptance-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The What — what must be true"
              required
              aria-label="Acceptance title"
            />
          </div>
          {showsProductPicker && (
            <ProductPicker
              products={products}
              value={product}
              onChange={setProduct}
              hint={
                product === null
                  ? "Unassigned acceptances appear under All products only."
                  : undefined
              }
            />
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-acceptance-form">
            Create acceptance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
