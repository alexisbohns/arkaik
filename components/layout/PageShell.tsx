"use client";

import type { ReactNode } from "react";
import { PageHeader, type PageAction } from "@/components/layout/PageHeader";
import { ProjectPanels } from "@/components/panels/ProjectPanels";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, JournalEvent, Node } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";

interface PageShellProps {
  title: string;
  meta?: ReactNode;
  action?: PageAction;
  /** Right-side header controls, left of the action. */
  headerExtra?: ReactNode;
  /** The surface — canvas, board, list. The panel grid's first cell. */
  children: ReactNode;
  /**
   * Draw the surface as a card — its own background and border.
   *
   * Off by default: most surfaces are already built from cards, tables and
   * blocks, so a card around them is a box drawn around boxes. Turn it on for a
   * canvas, which has no internal edges of its own.
   */
  surfaceCard?: boolean;
  onLayoutChange?: () => void;
  /**
   * Node wiring for the detail panels. Optional: a page that passes none still
   * gets the grid, which is all the raw bundle panel needs.
   */
  allNodes?: Node[];
  allEdges?: Edge[];
  /** The surface's product scope, forwarded to every node panel it opens. */
  scope?: ProductScope;
  journal?: JournalEvent[];
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
}

/**
 * A project page: the shared header, and the panel grid holding the surface.
 *
 * Every project surface renders exactly one of these, which is what makes the
 * raw bundle reachable from anywhere — the grid it needs is no longer something
 * only five of the ten pages happen to mount.
 */
export function PageShell({
  title,
  meta,
  action,
  headerExtra,
  children,
  surfaceCard,
  onLayoutChange,
  ...panelProps
}: PageShellProps) {
  return (
    <div className="flex h-full w-full flex-col">
      {/* The header names the crumbs from the same node list the panels resolve
          against, so a rename reaches both at once. */}
      <PageHeader title={title} meta={meta} action={action} nodes={panelProps.allNodes}>
        {headerExtra}
      </PageHeader>
      <ProjectPanels
        surfaceLabel={title}
        surfaceCard={surfaceCard}
        onLayoutChange={onLayoutChange}
        {...panelProps}
      >
        {children}
      </ProjectPanels>
    </div>
  );
}
