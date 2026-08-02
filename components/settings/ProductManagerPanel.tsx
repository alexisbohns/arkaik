"use client";

import { useMemo, useRef, useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { resolveProducts, type ProductDefinition } from "@arkaik/schema";

import { ProductDeleteDialog } from "@/components/settings/ProductDeleteDialog";
import { ProductFormDialog } from "@/components/settings/ProductFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLATFORMS, platformLabel, type PlatformId } from "@/lib/config/platforms";
import type { ProjectBundle, ProjectMetadata } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { applyProductPlan } from "@/lib/utils/apply-product-plan";
import {
  membersOfProduct,
  planProductDeletion,
  upsertProduct,
  type ProductDraft,
} from "@/lib/utils/product-editing";
import { platformCountLabel, productDisplayTitle } from "@/lib/utils/product-scope";

/**
 * The Products section of project settings — where a human can finally do what
 * only an agent could before: name the apps this project describes.
 *
 * Definitions are project metadata, so creating or renaming one is a single
 * `updateProject`. Only *deletion* touches nodes, and only deletion goes through
 * `applyProductPlan`.
 *
 * THE EMPTY STATE IS THE DEGENERATE-CASE GUARANTEE. A project that declares no
 * products must look and behave exactly as it did before products existed, so
 * this section is present (it is how the first product gets created) but
 * introduces no vocabulary until one exists: no scope selector, no product
 * column, no membership field anywhere else in the app. The prose here is the
 * only place a user with zero products meets the word.
 *
 * IT READS NODES, WHICH THE SETTINGS PAGE OTHERWISE DOES NOT. The member count
 * on each row and the reassignment a deletion offers are both about stored
 * `metadata.product`, so this panel needs the node list — but nothing else on
 * the settings page does, and threading `nodes` plus `applyMutations` through
 * the page would make an otherwise node-free route look like a graph surface.
 * So the hook is called here. *Rejected:* counting members lazily when the
 * delete dialog opens, which is the same fetch a moment later and leaves the
 * list unable to say which products are actually in use.
 */

interface ProductManagerPanelProps {
  projectId: string;
  project: ProjectBundle | undefined;
  /**
   * `useProject`'s updater, narrowed to the one patch this panel sends. The hook
   * accepts any project-level field; naming only `metadata` here documents that
   * a product edit never touches anything else about the project.
   */
  updateProject: (patch: { metadata: ProjectMetadata }) => Promise<unknown>;
}

export function ProductManagerPanel({ projectId, project, updateProject }: ProductManagerPanelProps) {
  const { nodes, loading: nodesLoading, applyMutations } = useNodes(projectId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ProductDefinition | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  /**
   * How many members a *failed* deletion already moved, per product id.
   *
   * `applyProductPlan` writes memberships before definitions, so the likely
   * failure — the project write — leaves the nodes moved and the product still
   * there. A retry then recomputes the plan, finds no members left, and moves
   * zero, so without this the success toast would say the product was deleted
   * and never mention the nodes that changed hands on the first attempt. A ref
   * rather than state because nothing renders from it; it only makes the final
   * sentence true.
   */
  const alreadyMoved = useRef<Map<string, number>>(new Map());

  /**
   * The definitions as **resolved**, for everything that reads: rows, counts,
   * ids, reassignment targets. What an edit is written *back* from is the raw
   * stored array (see {@link handleSave}) — resolving drops entries, and a save
   * must not delete one as a side effect of an unrelated rename.
   */
  const products = useMemo(() => resolveProducts(project?.project), [project]);

  /** Stored membership only — the count a deletion would have to answer for. */
  const memberCounts = useMemo<Record<string, number>>(
    () =>
      Object.fromEntries(
        products.map((product) => [product.id, membersOfProduct(nodes, product.id).length]),
      ),
    [nodes, products],
  );

  /** The platforms the edited product's members claim — the § D4 notice's input. */
  const memberPlatforms = useMemo<PlatformId[]>(() => {
    if (!editing) return [];
    const used = new Set<PlatformId>();
    for (const node of membersOfProduct(nodes, editing.id)) {
      // `Array.isArray` rather than `?? []`: a node's `platforms` is required by
      // the schema, but this panel reads whatever the store holds, and a bundle
      // that carries a string or an object there must render the same leniency
      // every product read gets — not throw and take the settings page with it.
      if (!Array.isArray(node.platforms)) continue;
      for (const platform of node.platforms) used.add(platform);
    }
    return PLATFORMS.map((platform) => platform.id).filter((platform) => used.has(platform));
  }, [editing, nodes]);

  /** `planToOps`' input — the freshest node list, never a snapshot taken at open. */
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  /**
   * Create or rename, written back onto the **stored** array rather than the
   * resolved one.
   *
   * Resolving drops entries — blank ids, and every copy after the first of a
   * duplicated id — so writing the resolved list back would delete them. The
   * blank-id half of that is harmless (an entry the app cannot address is not
   * data anyone can lose), but the duplicate half is not: renaming product A
   * would silently delete the shadowed second copy of B, clearing the
   * `product-duplicate-id` validator warning by *rename* rather than by fix. A
   * warning that self-clears is worse than one that stays, because the second
   * definition is gone and nothing ever said so.
   *
   * `upsertProduct` handles the raw array unchanged: it replaces the **first**
   * match by index, which is exactly `resolveProducts`' first-wins reading, and
   * its own doc comment already covers the duplicated case. `existingIds` still
   * comes from the resolved list, which is safe in both directions — a
   * duplicate shares its id with the entry that shadowed it, and a blank id can
   * never collide with a derived one.
   */
  async function handleSave(draft: ProductDraft) {
    if (saving) return;
    setSaving(true);
    const stored = project?.project.metadata?.products;
    try {
      await updateProject({
        metadata: {
          ...(project?.project.metadata ?? {}),
          products: upsertProduct(Array.isArray(stored) ? stored : [], draft),
        },
      });
      toast.success(editing ? `"${draft.title}" was updated.` : `"${draft.title}" was created.`);
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      console.error("[ProductManagerPanel] Failed to save product:", err);
      toast.error(err instanceof Error ? err.message : "Could not save this product.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Deletion, as ONE plan (§ D3). The plan is computed here at confirm time
   * from the current `products` and `nodes` rather than when the dialog opened,
   * so a refetch in between is reflected instead of overwritten — and
   * `applyProductPlan` owns the ordering of the two writes it spans, which is
   * why neither store is touched directly in this function.
   *
   * **IT REFUSES TO RUN BEFORE THE NODES ARE READ.** `useNodes` starts at `[]`
   * and fills in from an effect, so on a cold settings page there is a window
   * where every row says "0 nodes" and a deletion confirmed inside it plans
   * against an empty list: no reassignments, `applyMutations` skipped entirely,
   * and only the definition removed. That strands every member holding
   * `metadata.product` for a product nobody declares — verbatim the state
   * apply-product-plan.ts reorders its two writes to avoid, and the one it calls
   * worse precisely because every read surface survives it silently. One fast
   * click reaches it, and nothing undoes it. Confirm-time derivation is no help:
   * the list is empty at confirm time too. So the guard is the load flag, and it
   * is mirrored in the button and in the count each row shows, so the UI never
   * asserts a number it has not read.
   */
  async function handleDelete(reassignTo: string | null) {
    if (!deleting || deleteBusy || nodesLoading) return;
    const target = deleting;
    setDeleteBusy(true);
    /**
     * Planned against the **stored** array, exactly as `handleSave` is and for
     * exactly its reason. `plan.products` is written back verbatim, so planning
     * against `resolveProducts`' output would make deleting product A also drop
     * the shadowed second copy of a duplicated B — clearing a
     * `product-duplicate-id` warning by deletion rather than by fix, which is
     * the harm the save path was hardened against. Two write paths in one
     * component must not disagree about what the stored array is.
     *
     * The plan's own guards are unaffected: a duplicate shares the surviving
     * entry's id, so `declared` and the destination check read the same answer
     * from either array. `products` stays the source for the rows, the counts
     * and the reassignment targets, which are all display of what the app can
     * actually address.
     */
    const stored = project?.project.metadata?.products;
    const plan = planProductDeletion(
      Array.isArray(stored) ? stored : [],
      nodes,
      target.id,
      reassignTo,
    );
    /**
     * Did the membership half commit? `applyProductPlan` reports success or
     * failure for the pair, and the two failures need different sentences: the
     * memberships failing changed nothing, while the definitions failing left
     * the nodes moved. Wrapping the callback is the only way to learn which
     * from the outside, and it is honest — the wrapper adds no behaviour, it
     * only records that the call it forwards returned.
     */
    let membershipsWritten = false;
    try {
      await applyProductPlan(plan, {
        nodesById,
        projectMetadata: project?.project.metadata,
        updateProject,
        applyMutations: async (ops) => {
          const result = await applyMutations(ops);
          membershipsWritten = true;
          return result;
        },
      });
      // Members moved on an earlier failed attempt count towards what the user
      // is told happened — see `alreadyMoved`.
      const moved = plan.reassignments.length + (alreadyMoved.current.get(target.id) ?? 0);
      alreadyMoved.current.delete(target.id);
      toast.success(
        moved === 0
          ? `"${productDisplayTitle(target)}" was deleted.`
          : `"${productDisplayTitle(target)}" was deleted; ${moved} node${moved === 1 ? "" : "s"} ${
              reassignTo === null ? "are now unassigned" : "moved"
            }.`,
      );
      setDeleting(null);
    } catch (err) {
      console.error("[ProductManagerPanel] Failed to delete product:", err);
      /**
       * Memberships are written first, so the failure the user is most likely
       * to hit — the project write — has already moved the nodes. Reporting
       * that as "could not delete this product" is true about the product and
       * false about everything else that just changed. Naming the half that
       * landed is what makes the retry safe to offer: it recomputes the plan,
       * finds no members left, and retries the project write alone.
       */
      const moved = membershipsWritten ? plan.reassignments.length : 0;
      if (moved > 0) {
        alreadyMoved.current.set(target.id, moved + (alreadyMoved.current.get(target.id) ?? 0));
        toast.error(
          `"${productDisplayTitle(target)}" was not deleted, but ${moved} node${
            moved === 1 ? " has" : "s have"
          } already moved out of it. Try again to finish.`,
        );
      } else {
        toast.error(err instanceof Error ? err.message : "Could not delete this product.");
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {products.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            This project describes one product. Add another &mdash; an admin dashboard, a public
            API, a CLI &mdash; and every page gains a scope selector for moving between them.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {products.map((product) => {
              const count = memberCounts[product.id] ?? 0;
              return (
                <li
                  key={product.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{productDisplayTitle(product)}</p>
                    {typeof product.description === "string" && product.description.trim() !== "" ? (
                      <p className="text-sm text-muted-foreground">{product.description}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(Array.isArray(product.platforms) ? product.platforms : []).map((platform) => (
                        <Badge key={String(platform)} variant="secondary">
                          {platformLabel(platform)}
                        </Badge>
                      ))}
                      {/* "counting…" rather than 0 while the nodes load: a row
                          that asserts a number it has not read is the same lie
                          the delete guard exists to stop, one line earlier. */}
                      <span className="text-xs text-muted-foreground">
                        {platformCountLabel(product.platforms)} &middot;{" "}
                        {nodesLoading ? "counting…" : `${count} node${count === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      className="cursor-pointer"
                      disabled={saving || deleteBusy}
                      onClick={() => {
                        setEditing(product);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    {/* Held back until the node list has arrived: a deletion
                        planned against the empty initial list moves nobody and
                        strands every member (see `handleDelete`). */}
                    <Button
                      variant="ghost"
                      className="cursor-pointer text-destructive"
                      disabled={saving || deleteBusy || nodesLoading}
                      onClick={() => setDeleting(product)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div>
          <Button
            variant="outline"
            className="cursor-pointer"
            // Disabled until the bundle is loaded: `updateProject` throws
            // outright before then, and a create that cannot be written is
            // better refused than reported as an error the user caused.
            disabled={!project || saving}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <PlusIcon className="size-4" />
            Add product
          </Button>
        </div>
      </div>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open && saving) return;
          setFormOpen(open);
          // Clear the subject with the dialog. `editing` is the panel's "am I
          // editing?" flag and `handleSave`'s toast reads it, so leaving it set
          // after a cancel means the flag outlives the dialog it describes.
          if (!open) setEditing(null);
        }}
        product={editing}
        existingIds={products.map((product) => product.id)}
        memberPlatforms={memberPlatforms}
        onSave={(draft) => void handleSave(draft)}
        busy={saving}
      />

      <ProductDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleting(null);
        }}
        product={deleting}
        // Read from the live counts, so the number moves with a refetch rather
        // than freezing at whatever it was when the dialog opened.
        memberCount={deleting ? memberCounts[deleting.id] ?? 0 : 0}
        otherProducts={products.filter((product) => product.id !== deleting?.id)}
        onConfirm={(reassignTo) => void handleDelete(reassignTo)}
        busy={deleteBusy}
      />
    </>
  );
}
