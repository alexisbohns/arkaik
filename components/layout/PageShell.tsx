"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ProjectPanels, type PyramidPanelData } from "@/components/panels/ProjectPanels";
import type { ScreenshotPanelOp } from "@/lib/utils/screenshot-ops";
import type { KritikLibrary, QualitySection, QualityTrend } from "@arkaik/schema";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, Node } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import type { NodeRelations } from "@/lib/hooks/useNodeRelations";
import { usePageAction, type PageAction } from "@/lib/hooks/usePageCommands";

interface PageShellProps {
  /** The page's name — its `h1`, read by screen readers; nothing draws it. */
  title: string;
  /** The page's create action, offered in the ⌘K palette's Create group. */
  action?: PageAction;
  /** The surface — canvas, board, list. The panel grid's first cell. */
  children: ReactNode;
  /**
   * The page's right rail (`RightRail`) — drawn after the panel grid, at the
   * window's right edge, so open panels sit to its left and it never moves.
   */
  rail?: ReactNode;
  /**
   * Draw the surface as a card — its own background and border.
   *
   * Off by default: most surfaces are already built from cards, tables and
   * blocks, so a card around them is a box drawn around boxes. Turn it on for a
   * canvas, which has no internal edges of its own.
   */
  surfaceCard?: boolean;
  /** Draw the surface straight on the page background — see `PanelStack`. */
  surfaceBare?: boolean;
  onLayoutChange?: () => void;
  /**
   * Node wiring for the detail panels. Optional: a page that passes none still
   * gets the grid, which is all the raw bundle panel needs.
   */
  allNodes?: Node[];
  allEdges?: Edge[];
  /** The surface's product scope, forwarded to every node panel it opens. */
  scope?: ProductScope;
  /**
   * Mount the History section in every node panel this page opens. The
   * section reads the journal itself, so a page that passes this pays for the
   * journal only once a panel opens — and a page that passes nothing (Overview,
   * Pyramid, Settings, Quality) opens panels without a History section.
   */
  history?: boolean;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /** Screenshot writes as ops — see `ProjectPanels`. */
  onScreenshot?: (op: ScreenshotPanelOp) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  /** The acceptance decompose gestures — see `useAcceptanceIntake`. */
  intake?: AcceptanceIntake;
  /** Writing a node's relations — see `useNodeRelations`. */
  relations?: NodeRelations;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
  /** Kritik state for criterion panels — see `ProjectPanels`. Quality only. */
  qualitySection?: QualitySection;
  qualityLibrary?: KritikLibrary;
  qualityTrend?: QualityTrend;
  /** The scoped pyramid for the values panels — see `ProjectPanels`. Pyramid only. */
  pyramid?: PyramidPanelData;
}

/**
 * A project page: the panel grid holding the surface, edge to edge — no header.
 *
 * What the header used to carry went where it is used: the create action into
 * the ⌘K palette (`usePageAction`), the sidebar toggle to ⌘B, and the title
 * into a visually hidden `h1`. The `h1` stays because the panel stack hangs one
 * `h2` per open record off it; without it the page's outline would start at
 * level two under nothing.
 *
 * Every project surface renders exactly one of these, which is what makes the
 * raw bundle reachable from anywhere — the grid it needs is no longer something
 * only five of the ten pages happen to mount.
 */
export function PageShell({
  title,
  action,
  children,
  rail,
  surfaceCard,
  surfaceBare,
  onLayoutChange,
  ...panelProps
}: PageShellProps) {
  usePageAction(action);

  const panels = (
    <ProjectPanels
      surfaceLabel={title}
      surfaceCard={surfaceCard}
      surfaceBare={surfaceBare}
      onLayoutChange={onLayoutChange}
      {...panelProps}
    >
      {children}
    </ProjectPanels>
  );

  // No rail → exactly the markup every other page already has. With one, the
  // root turns into a row and the grid gets its own column box: `PanelStack`
  // is `flex-1` and expects a column parent to grow into. One return, so one
  // `h1` — `panel-semantics` holds this file to exactly that.
  return (
    <div className={cn("flex h-full w-full", rail ? "flex-row" : "flex-col")}>
      <h1 className="sr-only">{title}</h1>
      {rail ? <div className="flex min-h-0 min-w-0 flex-1 flex-col">{panels}</div> : panels}
      {rail}
    </div>
  );
}
