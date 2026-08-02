"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { resolveProducts, type ProductDefinition } from "@arkaik/schema";

import { ProductDeleteDialog } from "@/components/settings/ProductDeleteDialog";
import { ProductFormDialog } from "@/components/settings/ProductFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { ProjectBundle, ProjectMetadata } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { applyProductPlan } from "@/lib/utils/apply-product-plan";
import {
  membersOfProduct,
  planProductDeletion,
  upsertProduct,
  type ProductDraft,
} from "@/lib/utils/product-editing";
import { platformCountLabel } from "@/lib/utils/product-scope";

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
  const { nodes, applyMutations } = useNodes(projectId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ProductDefinition | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  /**
   * The resolved definitions, which is also what an edit is written back from.
   * `resolveProducts` drops entries with a blank or duplicate id, so saving here
   * normalizes those out of the stored array — deliberate, because an entry it
   * drops is one the whole app already cannot see, and leaving it in the bundle
   * only preserves something no surface can address or delete.
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
      for (const platform of node.platforms ?? []) used.add(platform);
    }
    return PLATFORMS.map((platform) => platform.id).filter((platform) => used.has(platform));
  }, [editing, nodes]);

  /** `planToOps`' input — the freshest node list, never a snapshot taken at open. */
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  async function handleSave(draft: ProductDraft) {
    if (saving) return;
    setSaving(true);
    try {
      await updateProject({
        metadata: { ...(project?.project.metadata ?? {}), products: upsertProduct(products, draft) },
      });
      toast.success(editing ? `"${draft.title}" was updated.` : `"${draft.title}" was created.`);
      setFormOpen(false);
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
   */
  async function handleDelete(reassignTo: string | null) {
    if (!deleting || deleteBusy) return;
    const target = deleting;
    setDeleteBusy(true);
    const plan = planProductDeletion(products, nodes, target.id, reassignTo);
    try {
      await applyProductPlan(plan, {
        nodesById,
        projectMetadata: project?.project.metadata,
        updateProject,
        applyMutations,
      });
      const moved = plan.reassignments.length;
      toast.success(
        moved === 0
          ? `"${displayTitle(target)}" was deleted.`
          : `"${displayTitle(target)}" was deleted; ${moved} node${moved === 1 ? "" : "s"} ${
              reassignTo === null ? "are now unassigned" : "moved"
            }.`,
      );
      setDeleting(null);
    } catch (err) {
      console.error("[ProductManagerPanel] Failed to delete product:", err);
      toast.error(err instanceof Error ? err.message : "Could not delete this product.");
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
                    <p className="text-sm font-medium">{displayTitle(product)}</p>
                    {typeof product.description === "string" && product.description.trim() !== "" ? (
                      <p className="text-sm text-muted-foreground">{product.description}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(Array.isArray(product.platforms) ? product.platforms : []).map((platform) => (
                        <Badge key={String(platform)} variant="secondary">
                          {platformLabel(platform)}
                        </Badge>
                      ))}
                      <span className="text-xs text-muted-foreground">
                        {platformCountLabel(product.platforms)} &middot; {count} node
                        {count === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      className="cursor-pointer"
                      onClick={() => {
                        setEditing(product);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="cursor-pointer text-destructive"
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

/**
 * What to call a product on screen. A stored definition may carry no `title` at
 * all — `resolveProducts` requires an id and nothing else — and falling back to
 * the id is what `ProductScopeSelector` and `productScopeOptions` already do, so
 * the same malformed product reads the same way everywhere.
 */
function displayTitle(product: ProductDefinition): string {
  return typeof product.title === "string" && product.title.trim() !== ""
    ? product.title
    : product.id;
}

/** The human label for a stored platform id, echoing an unknown one verbatim. */
function platformLabel(platform: unknown): string {
  return PLATFORMS.find((entry) => entry.id === platform)?.label ?? String(platform);
}
