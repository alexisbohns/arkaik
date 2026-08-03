"use client";

import { useMemo } from "react";
import { BoxesIcon } from "lucide-react";
import { ProductSelect } from "@/components/layout/ProductSelect";
import type { ProjectBundle } from "@/lib/data/types";
import { useProductScope } from "@/lib/hooks/useProductScope";
import { productScopeOptions } from "@/lib/utils/product-scope";

/**
 * The one control that sets the product scope, sat under the project switcher.
 *
 * One control, not one per surface: the scope spans every page under
 * /project/[id] (§ Decision 2, "every view respects it"), so it belongs in the
 * shell beside the other thing that reframes the whole app — the project
 * switcher. Every surface reads the same value back through
 * `useEffectiveProduct`.
 *
 * **A project with no products renders nothing here.** Not an optimisation: it
 * is what keeps products opt-in. A project that has never declared one must
 * look exactly as it did before the feature existed — no empty select, no new
 * word in the sidebar. `productScopeOptions` returning `[]` is that guarantee,
 * and it is asserted in tests/app/product-scope.test.js rather than eyeballed.
 *
 * The same emptiness covers the first render and SSR for free: `useProject`
 * loads the bundle in an effect, so `project` is `undefined` until it lands and
 * there is no options list to flash.
 *
 * A scope pointing at a product this project no longer declares degrades to
 * "All products" in the trigger — `ProductSelect`'s own fallback — matching
 * `resolveProductScope`; a stale localStorage value must never leave the
 * trigger blank.
 *
 * Displayed, not healed, and deliberately so. Clearing the stored id here
 * would mean a project momentarily missing a product — a half-synced bundle, a
 * branch being switched — permanently forgetting a scope the user chose, and
 * the selector would be writing state as a side effect of rendering. The cost
 * is the opposite case: re-declaring that product silently restores the
 * scope. Restoring a choice the user made is the better failure.
 */

interface ProductScopeSelectorProps {
  projectId: string;
  project: ProjectBundle | undefined;
}

export function ProductScopeSelector({ projectId, project }: ProductScopeSelectorProps) {
  const { productId, setScope } = useProductScope(projectId);
  // Products live at `bundle.project.metadata`; `productScopeOptions` drills in
  // itself, which is why it takes the bundle rather than the project.
  const options = useMemo(() => productScopeOptions(project), [project]);

  if (options.length === 0) return null;

  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <ProductSelect
        value={productId}
        onChange={setScope}
        options={options}
        ariaLabel="Product"
        allProductsHint="Everything in the project"
        triggerIcon={<BoxesIcon className="size-4 shrink-0 text-sidebar-foreground/70" />}
        triggerClassName="h-8 w-full gap-2 border-sidebar-border bg-sidebar text-sm text-sidebar-foreground shadow-none focus:ring-sidebar-ring"
        contentClassName="min-w-56"
      />
    </div>
  );
}
