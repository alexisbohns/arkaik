"use client";

import { useEffect, useMemo } from "react";

import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { ProjectBundle } from "@/lib/data/types";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";

/**
 * Whether a surface offers a platform filter, which platforms it may offer, and
 * the rule that clears a stale one — duplicated verbatim between
 * `AcceptanceFilterBar` and `DeliveryFilterBar`, multi-sentence comment included
 * (audit `factorization-9`).
 *
 * The arity rule is the same one the Acceptances matrix reads for its status
 * columns, the Pyramid for its rings and `PlatformVariants` for its tabs: a
 * control that can only ever say "Web" is not a choice, it is the scope
 * repeated. A project declaring no products resolves to every platform, so an
 * unscoped project still gets today's bar.
 *
 * **Scope: the effect, not the bar.** The two filter bars keep their own
 * rendering — one draws a `Select`, the other a row of toggle Buttons — and that
 * difference is real. A shared `FilterBar` shell would buy one container `div`
 * and cost four surfaces their independence; the audit is explicit about not
 * attempting it.
 */
export function usePlatformFilterControl(
  projectId: string,
  project: ProjectBundle | undefined,
  value: "all" | PlatformId,
  onClear: () => void,
): {
  showPlatformFilter: boolean;
  platformOptions: (typeof PLATFORMS)[number][];
} {
  const scope = useEffectiveProduct(projectId, project);
  const showPlatformFilter = scope.isMultiPlatform;
  const platformOptions = useMemo(
    () => PLATFORMS.filter((platform) => scope.platforms.includes(platform.id)),
    [scope],
  );

  // A stale platform filter must not outlive the control that could clear it:
  // scoped to a web-only product, `platform=android` would silently empty the
  // list with nothing on screen to explain why. The caller clears through the
  // same handler its own control uses, so the URL stays the one source of truth.
  // The early return makes this idempotent — once cleared, `value` is already
  // `"all"`, so it cannot loop, and `onClear` may be an inline closure without
  // the effect doing anything on the renders it re-runs.
  useEffect(() => {
    if (showPlatformFilter || value === "all") return;
    onClear();
  }, [showPlatformFilter, value, onClear]);

  return { showPlatformFilter, platformOptions };
}
