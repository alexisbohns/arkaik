import type { ReactNode } from "react";

import { CANVAS_LINK_STYLE_HREF, canvasLinkCss } from "@/lib/arkademy/canvas-link";

const CSS = canvasLinkCss();

/**
 * Links one example's paragraph and canvas: hovering or focusing a sentence
 * (or gap pill) highlights its block, and the other way round. Wrap exactly
 * one example in it — a cover card, the tour's screen, your own canvas — with
 * its `ParagraphView` and its `CanvasGrid` both inside; the link never
 * crosses wrappers.
 *
 * CSS only (the rules come from `canvasLinkCss`, in a `<style>` React hoists
 * into the head once per page), so it has no hooks and no "use client": a
 * server page renders it, and so can a client screen. `className` sets the
 * wrapper's layout; `contents` keeps a parent's flex or grid gaps as they are.
 */
export function CanvasLink({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-canvas-link="" className={className}>
      <style href={CANVAS_LINK_STYLE_HREF} precedence="default">
        {CSS}
      </style>
      {children}
    </div>
  );
}
