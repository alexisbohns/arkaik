"use client";

import type { ReactNode } from "react";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { EmptyState } from "@/components/ui/empty-state";
import type { useQualityData } from "@/lib/hooks/useQualityData";
import type { ProductScope } from "@/lib/utils/product-scope";

interface QualityFrameProps {
  /** The page's own name — "Matrix", "Findings". */
  title: string;
  meta?: ReactNode;
  data: ReturnType<typeof useQualityData>;
  scope: ProductScope;
  toolbar?: ReactNode;
  children: ReactNode;
}

/**
 * The shell both Quality pages mount: header, panel grid, and the three states
 * that precede any content.
 *
 * Shared because those three states carry decisions that must not be re-made
 * per page. In particular the error branch comes **before** the empty state,
 * never after (#362, audit `quality-frontend-2`): a project whose bundle failed
 * to read has no `quality` section either, and would otherwise be told to go
 * install a plugin and run an audit it may well have run already.
 */
export function QualityFrame({ title, meta, data, scope, toolbar, children }: QualityFrameProps) {
  if (data.loading) {
    return <PageLoading label="quality" />;
  }

  if (data.error) {
    return <PageError label="quality" message={data.error} onRetry={data.reload} />;
  }

  if (!data.section) {
    return (
      <PageShell title={title} allNodes={data.nodes} allEdges={data.edges} scope={scope}>
        <PageSurface>
          <EmptyState
            message={
              <>
                No quality audit yet. Three steps to the matrix: install the{" "}
                <code className="font-mono text-xs">kritik@arkaik</code> plugin, run an audit over a
                surface, then import the bundle it writes back.
              </>
            }
          />
        </PageSurface>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={title}
      meta={meta}
      /* Neither page renders nodes of its own, but `ProjectPanels` resolves
         node entries against this data — without it, following a finding into
         its linked node opens a panel that cannot find its node. */
      allNodes={data.nodes}
      allEdges={data.edges}
      scope={scope}
      /* What the cell and criterion panels need: `ProjectPanels` derives each
         one's matrix and findings from them itself, once per stack. */
      qualitySection={data.section}
      qualityLibrary={data.library}
    >
      <PageSurface
        /* `fill` puts the toolbar outside the scrolling box, which is what
           `FindingsBoard`'s sticky `0px` fallback is written against: its
           priority headings pin to the scrollport's own top edge, which in
           `fill` is exactly the toolbar's hairline. */
        fill
        contentClassName="overflow-y-auto"
        toolbar={toolbar}
      >
        {children}
      </PageSurface>
    </PageShell>
  );
}
