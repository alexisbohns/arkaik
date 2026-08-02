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
import { Input } from "@/components/ui/input";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [platforms, setPlatforms] = useState<PlatformId[]>([]);

  /**
   * Re-seed whenever the dialog opens, keyed on `open` as well as on the
   * product: reopening on the *same* product then discards an abandoned edit
   * rather than resuming it, and opening "Add product" straight after an edit
   * cannot inherit the edited title.
   *
   * Every read is defensive because a stored definition is only as well-formed
   * as whoever wrote the bundle — `resolveProducts` drops blank and duplicate
   * ids but does not repair a `title` that is a number or a missing `platforms`
   * array, and this form must render it, not crash on it.
   */
  useEffect(() => {
    if (!open) return;
    setTitle(typeof product?.title === "string" ? product.title : "");
    setDescription(typeof product?.description === "string" ? product.description : "");
    setPlatforms(
      Array.isArray(product?.platforms) ? (product.platforms as PlatformId[]).filter(isKnownPlatform) : [],
    );
  }, [open, product]);

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
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Title
            </span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Admin dashboard"
              required
              aria-label="Product title"
            />
            <p className="text-xs text-muted-foreground">
              Identifier: <code>{id || "—"}</code>
              {editing
                ? " — fixed once created, because every node in this product stores it."
                : " — derived from the title, and fixed once created."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Description
            </span>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this app is for"
              aria-label="Product description"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Platforms
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {PLATFORMS.map((platform) => {
                const selected = platforms.includes(platform.id);
                return (
                  <button
                    key={platform.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setPlatforms((previous) =>
                        previous.includes(platform.id)
                          ? previous.filter((entry) => entry !== platform.id)
                          : [...previous, platform.id],
                      )
                    }
                    className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {platform.label}
                  </button>
                );
              })}
            </div>
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
          </div>
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

/** The human label for a platform id, falling back to the id itself. */
function platformLabel(platform: PlatformId): string {
  return PLATFORMS.find((entry) => entry.id === platform)?.label ?? platform;
}
