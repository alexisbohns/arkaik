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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SPECIES } from "@/lib/config/species";
import { STATUSES } from "@/lib/config/statuses";
import { PLATFORMS } from "@/lib/config/platforms";
import {
  PLATFORM_DOT_STYLES,
  PLATFORM_LABELS,
  STATUS_ICONS,
  STATUS_STYLES,
} from "@/components/graph/nodes/node-styles";
import type { SpeciesId } from "@/lib/config/species";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import type { NodeMetadata } from "@/lib/data/types";
import { PRODUCT_MEMBERSHIP_SPECIES, type ProductDefinition } from "@arkaik/schema";
import { ProductPicker } from "@/components/panels/ProductPicker";
import { useSeedOnOpen } from "@/lib/hooks/useSeedOnOpen";
import {
  constrainPlatforms,
  platformMenuFor,
  withProductMembership,
} from "@/lib/utils/product-editing";

export interface NewNodeFormData {
  title: string;
  species: SpeciesId;
  status: StatusId;
  platforms: PlatformId[];
  metadata?: NodeMetadata;
}

interface NewNodeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: NewNodeFormData) => void;
  /** Pre-fill species when opening from an "Add child" action. */
  defaultValues?: Partial<Pick<NewNodeFormData, "species">>;
  /**
   * The project's declared products. **Empty means the picker never renders** —
   * a project that has never heard of products must see no new field, no new
   * label, and no new word (§ degenerate-case guarantee).
   */
  products?: readonly ProductDefinition[];
  /**
   * The scope the user is standing in, pre-filled into the picker (§ D1).
   *
   * Visible and editable, never silent: creating a node under a named scope
   * without this produced a node that vanished from the scope the moment it was
   * created, because an unassigned flow or view shows under All products only.
   */
  defaultProductId?: string | null;
}

export function NewNodeForm({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  products = [],
  defaultProductId = null,
}: NewNodeFormProps) {
  const [title, setTitle] = useState("");
  const [species, setSpecies] = useState<SpeciesId>(defaultValues?.species ?? "view");
  const [status, setStatus] = useState<StatusId>("idea");
  const [platforms, setPlatforms] = useState<PlatformId[]>([]);
  const [product, setProduct] = useState<string | null>(defaultProductId);

  // Only three species *store* membership; the system layer derives it from who
  // consumes it and must never be offered the control.
  const storesProduct = PRODUCT_MEMBERSHIP_SPECIES.includes(species);
  const showsProductPicker = products.length > 0 && storesProduct;

  /**
   * The definition an id names, or `null` for unassigned — and for an id this
   * project no longer declares, which `platformMenuFor` reads as "every
   * platform" rather than as none.
   *
   * One lookup, three callers (the menu below, the change handler, the open
   * seed). Written out at each site they drifted immediately: the menu guarded
   * on `product !== null` and the handler on `nextProduct === null`, which are
   * the same rule spelled twice and one edit away from disagreeing.
   */
  const findProduct = (id: string | null) =>
    id === null ? null : products.find((candidate) => candidate.id === id) ?? null;

  // The containment rule at its source (§ D4): a node may only claim platforms
  // its product ships on. An unassigned node — or a project with no products —
  // gets every platform, which is today's behaviour unchanged.
  const platformMenu = platformMenuFor(storesProduct ? findProduct(product) : null);

  // A platform-less product means availability is not a tracked dimension here
  // (a CLI, a public API), so there is nothing to toggle — RFC decision 2.
  const allowsPlatformEditing = species !== "flow" && platformMenu.length > 0;

  // A view's status is normally the *default* it stamps onto each platform it
  // claims. Inside a platform-less product there are no platforms to stamp, so
  // the same field becomes the node's one status — RFC decision 2, and the other
  // half of what "no platform toggles" has to mean. Without this the view would
  // lose its status field entirely, and submit would write an empty
  // `platformStatuses` map that no read surface can get a status out of.
  const usesPlatformDefaultStatus = species === "view" && platformMenu.length > 0;
  const usesSingleStatusField =
    species === "data-model" ||
    species === "api-endpoint" ||
    (species === "view" && platformMenu.length === 0);

  /**
   * Re-seed the scoped default on each closed → open transition, and never
   * once the dialog is already open.
   *
   * These call sites mount the form once and keep it mounted, so the initial
   * `useState` runs long before the user picks a scope: without this, switching
   * to Admin and creating a view would pre-fill whatever scope the page was
   * first rendered under.
   *
   * The transition, not merely `open`, because `defaultProductId` moves on its
   * own — `useEffectiveProduct` resolves against a bundle that arrives in an
   * effect, so a dialog opened in that window would have the user's choice
   * overwritten a beat later. `useSeedOnOpen` owns that latch; the seed goes
   * through `handleProductChange` so the platform constraint runs in the same
   * step rather than leaving a selection the seeded product forbids.
   */
  useSeedOnOpen(open, defaultProductId, handleProductChange);

  function resetForm() {
    setTitle("");
    setSpecies(defaultValues?.species ?? "view");
    setStatus("idea");
    setPlatforms([]);
    setProduct(defaultProductId);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  }

  function handlePlatformToggle(platformId: PlatformId) {
    setPlatforms((prev) =>
      prev.includes(platformId) ? prev.filter((p) => p !== platformId) : [...prev, platformId]
    );
  }

  /**
   * Switching to a narrower product drops the platforms it does not ship on,
   * rather than storing a claim the product forbids and letting
   * `effectiveNodePlatforms` silently hide it at render time.
   */
  function handleProductChange(nextProduct: string | null) {
    setProduct(nextProduct);
    const nextMenu = platformMenuFor(findProduct(nextProduct));
    setPlatforms((previous) => constrainPlatforms(previous, nextMenu));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const platformStatuses = usesPlatformDefaultStatus
      ? {
          platformStatuses: Object.fromEntries(
            platforms.map((platformId) => [platformId, status]),
          ) as Record<PlatformId, StatusId>,
        }
      : {};

    // Membership only for the species that store it, and only when the project
    // has products at all. `withProductMembership` removes the key for null
    // rather than blanking it — unassigned has to mean absent. The two
    // contributions are *merged*: a view in a product needs both, and either one
    // overwriting the other would silently drop the other's key.
    const membership = storesProduct && products.length > 0
      ? withProductMembership(undefined, product)
      : {};

    const metadata: NodeMetadata = { ...membership, ...platformStatuses };

    onSubmit({
      title: title.trim(),
      species,
      status,
      platforms,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    resetForm();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New node</DialogTitle>
          <DialogDescription className="sr-only">
            Fill in the details to create a new node on the canvas.
          </DialogDescription>
        </DialogHeader>
        <form id="new-node-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Node title"
              required
              aria-label="Node title"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Species</span>
            <Select value={species} onValueChange={(v) => setSpecies(v as SpeciesId)}>
              <SelectTrigger aria-label="Species">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPECIES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showsProductPicker && (
            <ProductPicker
              products={products}
              value={product}
              onChange={handleProductChange}
              hint={
                product === null
                  ? "Unassigned nodes appear under All products only."
                  : undefined
              }
            />
          )}
          {(usesSingleStatusField || usesPlatformDefaultStatus) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {usesPlatformDefaultStatus ? "Default Platform Status" : "Status"}
              </span>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusId)}>
                <SelectTrigger aria-label={usesPlatformDefaultStatus ? "Default platform status" : "Status"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => {
                    const StatusIcon = STATUS_ICONS[s.id];

                    return (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="inline-flex items-center gap-2">
                          <StatusIcon className={`size-3.5 ${STATUS_STYLES[s.id].badge}`} />
                          {s.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
          {allowsPlatformEditing && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platforms</span>
              <div className="flex items-center gap-2 flex-wrap">
                {PLATFORMS.map((p) => {
                  const selected = platforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePlatformToggle(p.id)}
                      aria-pressed={selected}
                      className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                        selected
                          ? "bg-muted text-foreground"
                          : "bg-transparent text-muted-foreground border border-input hover:bg-muted/50"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${selected ? PLATFORM_DOT_STYLES[p.id] : "bg-muted-foreground/40"}`} />
                      {PLATFORM_LABELS[p.id]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-node-form">
            Create node
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
