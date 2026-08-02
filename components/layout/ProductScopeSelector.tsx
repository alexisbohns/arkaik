"use client";

import { useMemo } from "react";
import { BoxesIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
 */

/**
 * Radix reserves the empty string for "no selection", so "All products" — a
 * real member of the domain, not an absence — needs a sentinel of its own. The
 * store still holds `null` for it; the sentinel never leaves this file.
 */
const ALL_PRODUCTS = "__all__";

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

  // A scope pointing at a product this project no longer declares degrades to
  // "All products", matching `resolveProductScope` — a stale localStorage value
  // must never leave the trigger blank.
  const selected = options.find((option) => option.id === productId) ?? null;

  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <Select
        value={selected ? selected.id : ALL_PRODUCTS}
        onValueChange={(next) => setScope(next === ALL_PRODUCTS ? null : next)}
      >
        <SelectTrigger
          aria-label="Product"
          className="h-8 w-full gap-2 border-sidebar-border bg-sidebar text-sm text-sidebar-foreground shadow-none focus:ring-sidebar-ring"
        >
          <BoxesIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
          {/* Children make Radix render this instead of portaling the selected
              item's text in — so the trigger stays one line while the options
              below carry their second, secondary one. */}
          <SelectValue>
            <span className="truncate">{selected ? selected.label : "All products"}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="min-w-56">
          <SelectItem value={ALL_PRODUCTS}>
            <span className="grid text-left leading-tight">
              <span className="truncate">All products</span>
              <span className="truncate text-xs text-muted-foreground">Everything in the project</span>
            </span>
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              <span className="grid text-left leading-tight">
                <span className="truncate">{option.label}</span>
                <span className="truncate text-xs text-muted-foreground">{option.platformLabel}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
