"use client";

import { useMemo } from "react";
import { BoxesIcon } from "lucide-react";
import { ProductSelect } from "@/components/layout/ProductSelect";
import type { ProjectBundle } from "@/lib/data/types";
import { useProductOverride } from "@/lib/hooks/useProductScope";
import { productScopeOptions } from "@/lib/utils/product-scope";

/**
 * A surface's own product control — Delivery, Pyramid, Acceptances, Library.
 *
 * **It narrows and never widens.** It renders only while the shell is showing
 * All products, so whatever the sidebar names is always at least as wide as
 * what you are looking at and cannot lie about it. Under a named global scope
 * `canOverride` is false and this returns `null`: there is nothing a named scope
 * could narrow *to* that is not itself, and the alternative — a "follow the
 * sidebar" option — is an affordance no select trigger makes readable.
 *
 * The same `null` covers the degenerate case: a project declaring no products
 * shows no new control here exactly as it shows none in the sidebar, because
 * both ask `productScopeOptions`.
 *
 * It sits **inside** each surface's filter bar rather than in the page header:
 * it composes with the platform, species and search controls beside it, and a
 * reader narrowing to Admin is mid-filtering, not reframing the app.
 *
 * Leaving a surface drops the override, because sidebar nav links carry no query
 * string — that is what makes it per-surface, and it needs no code.
 */
interface ProductOverrideSelectorProps {
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

export function ProductOverrideSelector({ projectId, project }: ProductOverrideSelectorProps) {
  const { canOverride, overrideId, setOverride } = useProductOverride(projectId, project);
  const options = useMemo(() => productScopeOptions(project), [project]);

  if (!canOverride) return null;

  return (
    <ProductSelect
      value={overrideId}
      onChange={setOverride}
      options={options}
      ariaLabel="Product"
      allProductsHint="Everything in the project"
      triggerIcon={<BoxesIcon className="size-4 shrink-0 text-muted-foreground" />}
      triggerClassName="h-9 w-[11rem] gap-2"
      contentClassName="min-w-56"
    />
  );
}
