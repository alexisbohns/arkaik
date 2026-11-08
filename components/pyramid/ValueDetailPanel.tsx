"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PanelHeaderEntityId } from "@/components/graph/nodes/EntityBadges";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { PlatformAvailability } from "@/components/graph/nodes/PlatformAvailability";
import { PlatformStatusIcons } from "@/components/graph/nodes/PlatformStatusIcons";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { ValueIcon } from "@/components/values/ValueBadge";
import { VALUES, VALUE_TIERS_CONFIG, type ValueId } from "@/lib/config/values";
import type { Edge, Node } from "@/lib/data/types";
import { EMPTY_FILTERS, filterAcceptances } from "@/lib/utils/acceptance-matrix";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import { scopedPlatforms, type ProductScope } from "@/lib/utils/product-scope";
import type { PyramidTier } from "@/lib/utils/pyramid";
import { cn } from "@/lib/utils";

const VALUE_BY_ID = new Map(VALUES.map((value) => [value.id, value]));
const TIER_CONFIG = new Map(VALUE_TIERS_CONFIG.map((tier) => [tier.id, tier]));

/**
 * A value panel's header: the kind and the id, as chips — the idiom every
 * panel header follows (`FindingDetailPanelHeader`), never a title.
 */
export function ValueDetailPanelHeader({ valueId }: { valueId: ValueId }) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
        <ValueIcon valueId={valueId} className="size-3.5" />
        Value
      </span>
      <PanelHeaderEntityId id={valueId} />
    </div>
  );
}

interface ValueDetailPanelProps {
  valueId: ValueId;
  /** The scoped pyramid — the element's counts come from here, never recomputed. */
  tiers: PyramidTier[];
  allNodes: Node[];
  allEdges: Edge[];
  nodesById: ReadonlyMap<string, Node>;
  scope: ProductScope;
  /** The Acceptances surface, filtered to this element. */
  acceptancesHref: string;
  onOpenAcceptance: (acceptance: Node) => void;
}

/**
 * One value element, presented: what it means, how well it is delivered, and
 * the acceptances that carry it. Following one opens it above this panel, so
 * the value slides left and the acceptance takes the right column.
 */
export function ValueDetailPanel({
  valueId,
  tiers,
  allNodes,
  allEdges,
  nodesById,
  scope,
  acceptancesHref,
  onOpenAcceptance,
}: ValueDetailPanelProps) {
  const value = VALUE_BY_ID.get(valueId);
  const element = useMemo(
    () => tiers.flatMap((tier) => tier.elements).find((candidate) => candidate.value === valueId) ?? null,
    [tiers, valueId],
  );
  const tier = value ? TIER_CONFIG.get(value.tier) : undefined;

  // The Acceptances surface's own filter, value and product together — so this
  // lists exactly what "Open in Acceptances" lands on, and exactly the
  // acceptances the element's count was aggregated from.
  const acceptances = useMemo(
    () =>
      filterAcceptances(
        allNodes.filter((node) => node.species === "acceptance"),
        allEdges,
        nodesById,
        { ...EMPTY_FILTERS, product: scope.productId, value: valueId },
      ),
    [allNodes, allEdges, nodesById, scope.productId, valueId],
  );

  return (
    <div className={cn(PANEL_GUTTER, "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto py-5 lg:py-6")}>
      <div className="flex flex-col gap-3">
        <ValueIcon valueId={valueId} className="size-7 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold leading-tight">{value?.label ?? valueId}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: tier?.color }}
              aria-hidden="true"
            />
            {tier?.label ?? value?.tier}
          </p>
        </div>
        {value?.description && <p className="text-sm text-muted-foreground">{value.description}</p>}
      </div>

      {element && (
        <PlatformAvailability
          rollup={element.rollup}
          platforms={scope.platforms}
          count={element.acceptanceCount}
          size="lg"
          countLabel="acceptances"
        />
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Acceptances
          <span className="ml-1.5 font-normal normal-case tracking-normal opacity-70">{acceptances.length}</span>
        </h3>
        {acceptances.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing addresses this element yet.</p>
        ) : (
          <ul className="-mx-2 flex flex-col gap-0.5">
            {acceptances.map((acceptance) => (
              <li key={acceptance.id}>
                <EntityRow node={acceptance} onOpen={() => onOpenAcceptance(acceptance)}>
                  <span className="min-w-0 flex-1 truncate">{acceptance.title}</span>
                  <PlatformStatusIcons
                    className="shrink-0"
                    platforms={scopedPlatforms(acceptance, scope)}
                    platformStatuses={getEditablePlatformStatuses(acceptance)}
                  />
                </EntityRow>
              </li>
            ))}
          </ul>
        )}
        {acceptances.length > 0 && (
          <Link
            href={acceptancesHref}
            className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Open in Acceptances →
          </Link>
        )}
      </section>
    </div>
  );
}
