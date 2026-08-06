"use client";

import { useId, useState } from "react";
import type { ProductDefinition } from "@arkaik/schema";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PlatformToggleGroup } from "@/components/panels/PlatformToggleGroup";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PLATFORMS, platformLabel, type PlatformId } from "@/lib/config/platforms";
import { deriveProductId, type ProductDraft } from "@/lib/utils/product-editing";

/**
 * Create or edit one product — title, description, platforms, and nothing else.
 *
 * THE IDENTIFIER IS DERIVED ONCE AND FROZEN (§ D2). It is the key every member
 * node stores in `metadata.product`, so an editable id is not a text field, it
 * is a multi-node rewrite spanning two stores — and one that can half-fail,
 * leaving some members pointing at the old key and some at the new. Every node
 * carrying the old key then resolves to *unassigned* on every read surface,
 * silently, because a membership naming nothing is indistinguishable from no
 * membership. Renaming therefore changes `title` alone.
 *
 * It is SHOWN rather than hidden, for the same reason `resolveProducts` is
 * lenient: bundles are hand-editable and agent-editable, and someone writing
 * `"product": "admin-dashboard"` into a node by hand needs to be able to read
 * the spelling somewhere. A field they can see but not type into says both
 * things at once.
 *
 * THE JOURNEY ANCHOR IS NOT HERE (§ D7). `root_node_id` picks a node, which is a
 * graph-picker this dialog has no business growing, and leaving it out is only
 * safe because {@link upsertProduct} spreads the existing definition first. That
 * is why this dialog emits a {@link ProductDraft} — a description of the edit —
 * instead of a `ProductDefinition` it built itself: a fresh object would drop
 * the anchor, and the user would have no way to notice or to put it back.
 *
 * NARROWING PLATFORMS IS ALLOWED (§ D4). The containment rule is a validator
 * *warning*, never an error, because narrowing a product's platforms is a
 * product decision that must not fail CI or be blocked by a form. So the
 * dropped-platform notice below reports and names, and the Save button stays
 * enabled. *Rejected:* disabling Save until members are cleaned up first, which
 * makes the manager demand exactly the tedium the bulk-move tool exists to
 * remove — and makes an honest product decision unexpressible.
 */

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The product being edited, or `null` to create a new one. */
  product: ProductDefinition | null;
  /** Every id already taken, so a derived slug never collides. */
  existingIds: readonly string[];
  /** The platforms this product's members actually claim, for the § D4 notice. */
  memberPlatforms: readonly PlatformId[];
  onSave: (draft: ProductDraft) => void;
  /** True while the save is in flight, so the dialog cannot be double-submitted. */
  busy?: boolean;
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  existingIds,
  memberPlatforms,
  onSave,
  busy,
}: ProductFormDialogProps) {
  /**
   * Seeded once per opening, from the props the dialog was mounted with.
   *
   * Freshness comes from the **caller**, which keys this component on both the
   * product and the open flag, so every opening is a mount: reopening on the
   * same product discards an abandoned edit rather than resuming it, and
   * opening "Add product" straight after an edit cannot inherit the edited
   * title. *Rejected:* an effect re-seeding on `open` — a `setState` in an
   * effect body, which paints once with the previous product's values before
   * correcting itself, and which `react-hooks/set-state-in-effect` rejects. It
   * also had to depend on `product?.id` rather than on the product object, with
   * a lint suppression, because a definition is re-derived on every project
   * write and an identity dependency would clear whatever the user had typed.
   * A mount has neither problem and needs no suppression.
   *
   * Every read is defensive because a stored definition is only as well-formed
   * as whoever wrote the bundle — `resolveProducts` drops blank and duplicate
   * ids but does not repair a `title` that is a number or a missing `platforms`
   * array, and this form must render it, not crash on it.
   */
  const fieldId = useId();
  const [title, setTitle] = useState(() =>
    typeof product?.title === "string" ? product.title : "",
  );
  const [description, setDescription] = useState(() =>
    typeof product?.description === "string" ? product.description : "",
  );
  const [platforms, setPlatforms] = useState<PlatformId[]>(() =>
    Array.isArray(product?.platforms)
      ? (product.platforms as PlatformId[]).filter(isKnownPlatform)
      : [],
  );

  const editing = product !== null;
  const id = editing ? product.id : deriveProductId(title, existingIds);

  /**
   * The platforms members use that this edit would stop showing. Computed from
   * what is *stored*, so it names real consequences: `effectiveNodePlatforms`
   * intersects a node's platforms with its product's, so these nodes keep their
   * platform data and simply stop displaying it. Saying "keeps them, but they
   * stop showing" is the whole difference between a reversible decision and one
   * the user reads as data loss.
   */
  const dropped = memberPlatforms.filter((platform) => !platforms.includes(platform));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    onSave({ id, title: title.trim(), description, platforms });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit product" : "New product"}</DialogTitle>
          <DialogDescription>
            A product is one app in this project&rsquo;s family &mdash; an end-user app, an admin
            dashboard, a public API. They share one graph.
          </DialogDescription>
        </DialogHeader>

        <form id="product-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label="Title"
            htmlFor={`${fieldId}-title`}
            hint={
              <>
                Identifier: <code>{id || "—"}</code>
                {editing
                  ? " — fixed once created, because every node in this product stores it."
                  : " — derived from the title, and fixed once created."}
              </>
            }
          >
            <Input
              id={`${fieldId}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Admin dashboard"
              required
              aria-label="Product title"
            />
          </Field>

          <Field label="Description" htmlFor={`${fieldId}-description`}>
            <Input
              id={`${fieldId}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this app is for"
              aria-label="Product description"
            />
          </Field>

          {/* No `htmlFor`: a toggle group has no single control to point at. */}
          <Field label="Platforms">
            {/* No `minLength`: an empty selection is meaningful for a product —
                availability is simply not a tracked dimension — which is the
                line the hint below draws. */}
            <PlatformToggleGroup
              value={platforms}
              onChange={setPlatforms}
              ariaLabel="Platforms this product ships on"
            />
            <p className="text-xs text-muted-foreground">
              {platforms.length === 0
                ? "No platforms: availability is not tracked for this product, and its nodes carry a single status."
                : "Nodes in this product can only claim these platforms."}
            </p>
            {dropped.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Nodes in this product currently use{" "}
                {dropped.map((platform) => platformLabel(platform)).join(", ")}. Saving this keeps
                them, but they stop showing.
              </p>
            )}
          </Field>
        </form>

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
            type="submit"
            form="product-form"
            className="cursor-pointer"
            disabled={!title.trim() || busy}
          >
            {busy ? "Saving…" : editing ? "Save" : "Create product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A stored platform this build recognises — anything else is not a toggle. */
function isKnownPlatform(platform: unknown): platform is PlatformId {
  return PLATFORMS.some((entry) => entry.id === platform);
}
