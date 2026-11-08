"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ListIcon } from "lucide-react";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import type { PyramidPanelData } from "@/components/panels/ProjectPanels";
import { PyramidSummaryPane } from "@/components/pyramid/PyramidSummaryPane";
import { Button } from "@/components/ui/button";
import { VALUES, type ValueId } from "@/lib/config/values";
import { computeScopedPyramidTiers } from "@/lib/utils/pyramid";
import { PRODUCT_OVERRIDE_PARAM, productScopeMetaLabel } from "@/lib/utils/product-scope";
import { isValueEntry, VALUES_PANEL_KEY } from "@/lib/utils/project-panels";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { NODE_PANEL_PARAM, useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useEffectiveProduct, useProductOverride } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";

const VALUE_LABEL = new Map<string, string>(VALUES.map((v) => [v.id, v.label]));

/** The search param naming the open value panel. Page-owned; the stack's address is `?node=`. */
const VALUE_PARAM = "value";

/**
 * The Pyramid: "How well is each value element delivered?" — the value-delivery
 * radar (spec §9.2), on the real panel stack.
 *
 * The surface is the pyramid itself, upright. Beside it the values directory
 * opens as the resting panel: the 30 elements as a list behind a step filter.
 * Picking an element — a row or a wheel — opens its value panel above the
 * directory, so the directory slides left and the value takes the right
 * column; following one of its acceptances slides the value left in turn. The
 * stack's usual rules, nothing bespoke.
 *
 * The open element is addressed as `?value=`, so a reload or a shared link
 * lands on it.
 */
export default function PyramidPage() {
  const id = useProjectId();
  const { entries, openValues, openValue } = useProjectPanels();

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

  // The one cross-surface link between two surfaces that both own the override,
  // and so the one place "navigation drops the param" is the wrong answer:
  // narrow the pyramid to Admin, follow "Open in Acceptances", and landing on
  // every product's acceptances reads as a bug. It carries the *override* and
  // not `scope.productId`, because a global scope needs no carrying — the
  // sidebar already narrows the destination, and writing it into the URL would
  // turn an ambient scope into a surface override on arrival.
  const acceptancesHref = useCallback(
    (value: string) => {
      const params = new URLSearchParams({ value });
      if (overrideId !== null) params.set(PRODUCT_OVERRIDE_PARAM, overrideId);
      return `/project/${id}/acceptances?${params.toString()}`;
    },
    [id, overrideId],
  );
  const pyramid = useMemo<PyramidPanelData>(
    () => ({ tiers, acceptancesHref }),
    [tiers, acceptancesHref],
  );

  // --- The stack, seeded and addressed -------------------------------------

  const searchParams = useSearchParams();
  const writeQuery = useQueryWriter();
  const directoryOpen = entries[0]?.key === VALUES_PANEL_KEY;

  /** Open an element over the directory, reopening the directory first if it was closed. */
  const showValue = useCallback(
    (valueId: ValueId) => {
      if (!directoryOpen) openValues(0);
      openValue(valueId, VALUE_LABEL.get(valueId) ?? valueId, 1);
    },
    [directoryOpen, openValue, openValues],
  );

  // Seed once per visit: the directory, and the element `?value=` names. Only
  // into an empty stack — a cold load carrying `?node=` has already put that
  // node at the bottom, and opening at depth 0 would truncate it away.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (entries.length > 0 || searchParams.get(NODE_PANEL_PARAM)) return;

    openValues(0);
    const requested = searchParams.get(VALUE_PARAM);
    if (requested && VALUE_LABEL.has(requested)) {
      openValue(requested as ValueId, VALUE_LABEL.get(requested)!, 1);
    }
  }, [entries.length, openValue, openValues, searchParams]);

  // The stack → `?value=`. Written only when the open element *changes*, never
  // on the first pass, so the seed above is not raced by a delete of the very
  // param it is reading.
  const openValueId = entries.find(isValueEntry)?.payload.valueId ?? null;
  const lastOpenValue = useRef<ValueId | null | undefined>(undefined);
  useEffect(() => {
    const previous = lastOpenValue.current;
    lastOpenValue.current = openValueId;
    if (previous === undefined || previous === openValueId) return;

    writeQuery((params) => {
      if (openValueId === null) params.delete(VALUE_PARAM);
      else params.set(VALUE_PARAM, openValueId);
    });
  }, [openValueId, writeQuery]);

  if (nodesLoading || edgesLoading) {
    return <PageLoading label="pyramid" />;
  }

  // Before any aggregate is drawn, never after (#362): every tier aggregates to
  // zero from an unread graph, and a pyramid of empty wheels would blame the
  // product for a read that never landed.
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
    <PageShell
      title="Value pyramid"
      meta={productScopeMetaLabel(scope)}
      // Node wiring for the acceptance panels a value panel opens.
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      pyramid={pyramid}
      // The pyramid is a picture, not a list: no card around it.
      surfaceBare
    >
      <PageSurface>
        <PyramidSummaryPane
          tiers={tiers}
          onSelectValue={showValue}
          action={
            // Only while the directory is closed — it is the page's resting
            // panel, and closing it (Escape) must not strand the reader with
            // no way back to the list short of a reload.
            directoryOpen ? undefined : (
              <Button size="sm" variant="outline" className="cursor-pointer self-start" onClick={() => openValues(0)}>
                <ListIcon className="size-4" />
                Values
              </Button>
            )
          }
        />
      </PageSurface>
    </PageShell>
  );
}
