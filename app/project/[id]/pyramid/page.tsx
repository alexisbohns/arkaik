"use client";

import { useCallback, useMemo, useState } from "react";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { PyramidElementCard } from "@/components/pyramid/PyramidElementCard";
import { PyramidElementRow } from "@/components/pyramid/PyramidElementRow";
import { PyramidTierGroup } from "@/components/pyramid/PyramidTierGroup";
import {
  PyramidToolbar,
  type PyramidFilterStep,
  type PyramidViewMode,
} from "@/components/pyramid/PyramidToolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import type { PyramidElement } from "@/lib/utils/pyramid";
import { computeScopedPyramidTiers } from "@/lib/utils/pyramid";
import { PRODUCT_OVERRIDE_PARAM, productScopeMetaLabel } from "@/lib/utils/product-scope";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct, useProductOverride } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";

const VALUE_LABEL = new Map(VALUES.map((v) => [v.id, v.label]));
const VALUE_DESCRIPTION = new Map(VALUES.map((v) => [v.id, v.description]));
const TIER_CONFIG = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t]));

function matchesStep(element: PyramidElement, step: PyramidFilterStep) {
  if (step === "addressed") return element.acceptanceCount > 0;
  if (step === "empty") return element.acceptanceCount === 0;
  return true;
}

/**
 * The Pyramid: "How well is each value element delivered?" — the value-delivery
 * radar (spec §9.2). Each element carries its availability — four status rings
 * (global + one per platform) for a scope shipping on two or more, a single bar
 * and a count for one or none; a three-step filter picks the slice worth
 * looking at, and the view switcher trades the icon-led cards for one-line rows.
 */
export default function PyramidPage() {
  const id = useProjectId();

  const [viewMode, setViewMode] = useState<PyramidViewMode>("cards");
  const [filterStep, setFilterStep] = useState<PyramidFilterStep>("all");

  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes } = useNodes(id);
  // Gated on below alongside the nodes, as /acceptances does: an acceptance's
  // product comes from the anchors it covers, so aggregating before the edges
  // land would scope a scoped pyramid by stored keys alone and then correct
  // itself a frame later.
  const { edges: dataEdges, loading: edgesLoading, error: edgesError, reload: reloadEdges } = useEdges(id);
  const { project: projectBundle, error: projectError, reload: reloadProject } = useProject(id);

  // `useProject` resolves in an effect, so this is the no-products scope on the
  // first render — every platform, all acceptances — which is also exactly what
  // a project that declares no products resolves to for good. Nothing flashes.
  const scope = useEffectiveProduct(id, projectBundle);
  const { overrideId } = useProductOverride(id, projectBundle);

  const acceptances = useMemo(
    () => dataNodes.filter((node) => node.species === "acceptance"),
    [dataNodes],
  );
  const nodesById = useMemo(
    () => new Map(dataNodes.map((node) => [node.id, node])),
    [dataNodes],
  );
  // Scoping the *acceptances* as well as the platform menu: a pyramid for Admin
  // has to aggregate Admin's acceptances, and membership follows an
  // acceptance's anchors before its stored key (§ Decision 5). Both steps live
  // in `computeScopedPyramidTiers`, which the Overview's card calls too — the
  // two surfaces draw the same pyramid, so they compose it once.
  const tiers = useMemo(
    () => computeScopedPyramidTiers(acceptances, dataEdges, nodesById, scope),
    [acceptances, dataEdges, nodesById, scope],
  );

  const visibleTiers = useMemo(
    () =>
      tiers
        .map((tier) => ({
          ...tier,
          addressedCount: tier.elements.filter((element) => element.acceptanceCount > 0).length,
          visible: tier.elements.filter((element) => matchesStep(element, filterStep)),
        }))
        .filter((tier) => tier.visible.length > 0),
    [tiers, filterStep],
  );

  // The one cross-surface link between two surfaces that both own the override,
  // and so the one place "navigation drops the param" is the wrong answer:
  // narrow the pyramid to Admin, click an element, and landing on every
  // product's acceptances reads as a bug. It carries the *override* and not
  // `scope.productId`, because a global scope needs no carrying — the sidebar
  // already narrows the destination, and writing it into the URL would turn an
  // ambient scope into a surface override on arrival.
  const acceptancesHref = useCallback(
    (value: string) => {
      const params = new URLSearchParams({ value });
      if (overrideId !== null) params.set(PRODUCT_OVERRIDE_PARAM, overrideId);
      return `/project/${id}/acceptances?${params.toString()}`;
    },
    [id, overrideId],
  );

  if (nodesLoading || edgesLoading) {
    return <PageLoading label="pyramid" />;
  }

  // Before the filter's empty state, never after (#362): every tier aggregates
  // to zero from an unread graph, so "No value element matches this filter."
  // would blame a filter for a read that never landed.
  const loadError = nodesError ?? edgesError ?? projectError;
  if (loadError) {
    return (
      <PageError
        label="pyramid"
        message={loadError}
        onRetry={() => {
          void reloadNodes();
          void reloadEdges();
          void reloadProject();
        }}
      />
    );
  }

  return (
    <PageShell title="Value pyramid" meta={productScopeMetaLabel(scope)}>
      <PageSurface
        contentClassName="flex flex-col gap-6"
        toolbar={
          <PyramidToolbar
            viewMode={viewMode}
            filterStep={filterStep}
            onViewModeChange={setViewMode}
            onFilterStepChange={setFilterStep}
            projectId={id}
            project={projectBundle}
          />
        }
      >
        {visibleTiers.length === 0 ? (
          /* `p-10` rather than the `p-8` this card used to hand-roll — the
             audit's converge-on-the-dominant-treatment call (factorization-3). */
          <EmptyState message="No value element matches this filter." />
        ) : (
          visibleTiers.map((tier) => {
            const config = TIER_CONFIG.get(tier.tier);
            const View = viewMode === "cards" ? PyramidElementCard : PyramidElementRow;
            const items = tier.visible.map((element) => (
              <View
                key={element.value}
                element={element}
                label={VALUE_LABEL.get(element.value) ?? element.value}
                description={VALUE_DESCRIPTION.get(element.value) ?? ""}
                href={acceptancesHref(element.value)}
                platforms={scope.platforms}
              />
            ));
            return (
              <PyramidTierGroup
                key={tier.tier}
                label={config?.label ?? tier.tier}
                color={config?.color ?? "#94a3b8"}
                elementCount={tier.elements.length}
                addressedCount={tier.addressedCount}
              >
                {viewMode === "cards" ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items}</div>
                ) : (
                  <div className="overflow-hidden rounded-xl border bg-card">{items}</div>
                )}
              </PyramidTierGroup>
            );
          })
        )}
      </PageSurface>
    </PageShell>
  );
}
