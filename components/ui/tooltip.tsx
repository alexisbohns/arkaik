"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Tooltip, current generation (audit `shadcn-8`).
 *
 * The old copy re-exported Radix's Provider/Root/Trigger raw, so every consumer
 * had to remember to mount a `TooltipProvider` — and six of them did it at the
 * call site, `ValueBadge` once per badge and `ComposeEdge` once per action
 * inside a `.map`. A provider per tooltip is the same as no provider at all:
 * `skipDelayDuration` — "once one tooltip is showing, the next opens instantly"
 * — is grouping state held *by* the provider, and a group of one never groups.
 *
 * Upstream's fix is for `Tooltip` to mount a provider itself, which makes a bare
 * `<Tooltip>` work anywhere. Taken literally that reintroduces the same problem
 * one level down (a provider per root, always) and shadows any app-level
 * provider. So this copy mounts the fallback provider **only when there is not
 * one above it** — tracked with a plain boolean context, since Radix does not
 * expose its own. Inside the app shell (`SidebarProvider` mounts one) every
 * tooltip shares a single provider and grouping finally works; outside it, a
 * standalone `<Tooltip>` still stands on its own.
 *
 * `TooltipContent` keeps this repo's look — `bg-popover` with a shadow, and no
 * arrow — rather than upstream's filled `bg-primary` tooltip with an arrow.
 */

/**
 * The delay every tooltip in this app was written against, back when each call
 * site passed `delayDuration={300}` to its own provider. It is set on the *root*
 * rather than left to the provider because the two consumers want different
 * delays from the same shared provider: badges and icons want the 300ms pause
 * that keeps a tooltip from flashing on every pointer transit, while the
 * collapsed sidebar's icon rail wants 0 (see `SidebarMenuButton`). A root's
 * `delayDuration` overrides the provider's, so both are expressible at once.
 */
const TOOLTIP_DELAY_MS = 300;

const TooltipProviderContext = React.createContext(false);

function TooltipProvider({
  delayDuration = TOOLTIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipProviderContext.Provider value={true}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        {...props}
      />
    </TooltipProviderContext.Provider>
  );
}

function Tooltip({
  delayDuration = TOOLTIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const insideProvider = React.useContext(TooltipProviderContext);

  const root = (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      delayDuration={delayDuration}
      {...props}
    />
  );

  return insideProvider ? root : <TooltipProvider>{root}</TooltipProvider>;
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
          "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
