"use client";

import { useMemo, useState } from "react";
import { PyramidElementRow } from "@/components/pyramid/PyramidElementRow";
import { PyramidFilterSelect, type PyramidFilterStep } from "@/components/pyramid/PyramidFilterSelect";
import { PyramidSortSelect, type PyramidSortOrder } from "@/components/pyramid/PyramidSortSelect";
import { PyramidTierGroup } from "@/components/pyramid/PyramidTierGroup";
import type { PlatformId } from "@/lib/config/platforms";
import { VALUES, VALUE_TIERS_CONFIG, type ValueId, type ValueTierId } from "@/lib/config/values";
import type { PyramidElement, PyramidTier } from "@/lib/utils/pyramid";

const VALUE_LABEL = new Map(VALUES.map((v) => [v.id, v.label]));
const VALUE_DESCRIPTION = new Map(VALUES.map((v) => [v.id, v.description]));
const TIER_CONFIG = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t]));

/**
 * Most acceptances first, ties broken by name so the order is stable; or by
 * name alone. Within a tier only — the tiers keep the pyramid's order.
 */
function compareElements(order: PyramidSortOrder) {
  const byName = (left: PyramidElement, right: PyramidElement) =>
    (VALUE_LABEL.get(left.value) ?? left.value).localeCompare(VALUE_LABEL.get(right.value) ?? right.value);
  return order === "alphabetical"
    ? byName
    : (left: PyramidElement, right: PyramidElement) =>
        right.acceptanceCount - left.acceptanceCount || byName(left, right);
}

interface TierView {
  filter: PyramidFilterStep;
  sort: PyramidSortOrder;
}

const DEFAULT_VIEW: TierView = { filter: "all", sort: "acceptances" };

function matchesStep(element: PyramidElement, step: PyramidFilterStep) {
  if (step === "addressed") return element.acceptanceCount > 0;
  if (step === "empty") return element.acceptanceCount === 0;
  return true;
}

interface ValuesDirectoryPanelProps {
  tiers: PyramidTier[];
  /** The scope's effective platforms — `PlatformAvailability` owns the arity rule. */
  platforms: PlatformId[];
  /** The element open in the panel above this one, if any. */
  selectedValue: ValueId | null;
  onSelect: (valueId: ValueId, label: string) => void;
}

/**
 * The 30 value elements as a list, grouped by tier — the Pyramid page's resting
 * panel, beside the pyramid itself.
 *
 * One card per value family, each with its own step filter and sort as icon
 * menus at the right of its heading — no toolbar above them. The product scope
 * is the sidebar's. No panel header and no panel card
 * (`PanelStack`'s `headerless` and `bare`): it is the page's resting panel, and
 * its body is already made of cards.
 *
 * The filters and sorts are the panel's own state, per family, rather than the
 * page's: each shapes one card and nothing else.
 */
export function ValuesDirectoryPanel({
  tiers,
  platforms,
  selectedValue,
  onSelect,
}: ValuesDirectoryPanelProps) {
  // Per family: each card carries its own filter and sort, so narrowing the
  // functional tier to what is empty leaves the emotional tier as it was.
  const [views, setViews] = useState<Partial<Record<ValueTierId, TierView>>>({});
  const setView = (tier: ValueTierId, patch: Partial<TierView>) =>
    setViews((previous) => ({ ...previous, [tier]: { ...(previous[tier] ?? DEFAULT_VIEW), ...patch } }));

  // Every card always renders, even when its filter hides every element: the
  // card carries the only control that can undo that filter.
  const shownTiers = useMemo(
    () =>
      tiers.map((tier) => {
        const view = views[tier.tier] ?? DEFAULT_VIEW;
        const addressedCount = tier.elements.filter((element) => element.acceptanceCount > 0).length;
        return {
          ...tier,
          view,
          addressedCount,
          counts: {
            all: tier.elements.length,
            addressed: addressedCount,
            empty: tier.elements.length - addressedCount,
          },
          visible: tier.elements
            .filter((element) => matchesStep(element, view.filter))
            .sort(compareElements(view.sort)),
        };
      }),
    [tiers, views],
  );

  return (
    // `@container` so a row's hover description yields on a narrow panel.
    <div className="@container flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {shownTiers.map((tier) => {
        const config = TIER_CONFIG.get(tier.tier);
        return (
          <PyramidTierGroup
            key={tier.tier}
            label={config?.label ?? tier.tier}
            color={config?.color ?? "#94a3b8"}
            elementCount={tier.elements.length}
            addressedCount={tier.addressedCount}
            actions={
              <>
                <PyramidFilterSelect
                  compact
                  value={tier.view.filter}
                  onChange={(filter) => setView(tier.tier, { filter })}
                  counts={tier.counts}
                />
                <PyramidSortSelect
                  compact
                  value={tier.view.sort}
                  onChange={(sort) => setView(tier.tier, { sort })}
                />
              </>
            }
          >
            {tier.visible.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No element in this family matches the filter.</p>
            ) : (
              tier.visible.map((element) => {
                const label = VALUE_LABEL.get(element.value) ?? element.value;
                return (
                  <PyramidElementRow
                    key={element.value}
                    element={element}
                    label={label}
                    description={VALUE_DESCRIPTION.get(element.value) ?? ""}
                    platforms={platforms}
                    selected={element.value === selectedValue}
                    onSelect={() => onSelect(element.value, label)}
                  />
                );
              })
            )}
          </PyramidTierGroup>
        );
      })}
    </div>
  );
}
