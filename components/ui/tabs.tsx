"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The stock shadcn/ui Tabs, plus one repo-specific variant (audit `shadcn-2`).
 *
 * Radix is the whole point: the two hand-rolled strips this replaces
 * (`PlatformVariants`, `ShotPreviewDialog`) announce `role="tablist"` /
 * `role="tab"` / `role="tabpanel"` while implementing none of the WAI-ARIA tabs
 * contract — no roving tabindex, no arrow keys, no `aria-controls` linking a tab
 * to its panel. Telling a screen-reader user that arrow keys move between tabs
 * and then not moving them is worse than shipping plain buttons; Radix supplies
 * all of it and the roles become true.
 *
 * **The `underline` variant is the deliberate departure from upstream.** Both
 * strips wear the same look — a `border-b` rail with a `border-b-2 -mb-px`
 * active marker — and that look is the app's, not a drift: it is how a strip
 * reads inside a detail panel, where upstream's filled `bg-muted` pill row would
 * draw a second card edge around content that already sits in one. The variant
 * is declared on the root and shared through context so a strip's look is one
 * decision rather than one per trigger.
 */

const tabsListVariants = cva("", {
  variants: {
    variant: {
      default:
        "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
      underline: "flex border-b border-border",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium outline-none transition-[color,box-shadow] focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "data-[state=active]:bg-background dark:data-[state=active]:text-foreground focus-visible:border-ring dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 text-foreground dark:text-muted-foreground h-[calc(100%-1px)] flex-1 rounded-md border border-transparent px-2 py-1 text-sm data-[state=active]:shadow-sm [&_svg:not([class*='size-'])]:size-4",
        underline:
          "-mb-px border-b-2 border-transparent px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

type TabsVariant = NonNullable<VariantProps<typeof tabsListVariants>["variant"]>;

const TabsVariantContext = React.createContext<TabsVariant>("default");

function Tabs({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & {
  /** Look shared by the list and every trigger. `underline` is the panel strip. */
  variant?: TabsVariant;
}) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-variant={variant}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const variant = React.useContext(TabsVariantContext);

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext);

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants, tabsTriggerVariants };
