"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Popover, current generation (audit `shadcn-10`): function
 * components carrying `data-slot`, no `forwardRef` (React 19 passes `ref`
 * through as an ordinary prop).
 *
 * Two deliberate departures from upstream, both pre-existing and both visual:
 * `sideOffset` is 6 rather than 4, and the panel padding is `p-3` rather than
 * `p-4` — this app's popovers hold compact option lists, not prose.
 *
 * Skinned M3 Expressive since (app/m3/controls.css `.m3-float`): no stroke,
 * the soft raised surface at elevation 2, 28px corners, 20px of padding, and
 * a spring entrance that grows out of the trigger (Radix's transform origin).
 * The padding went past upstream's on purpose — breath, not density.
 */

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "m3-float z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-(--md-shape-xl) p-5 outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
