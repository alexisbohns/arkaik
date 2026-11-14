import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// M3 Expressive (app/m3/controls.css, docs/arkademy-design.md § 4 Shape): a
// pill at rest that tightens into a rounded square under the pointer and
// tighter still on press — the same morph as the panel header's `#` id. A
// toggle that is on, or a trigger whose menu is out, holds the rounded square.
// Tonal fills from the --md-* roles, never a stroke: `outline` keeps its name
// for its call sites but is the tonal button now.
//
// The pill is `--m3-pill` (20px), never `rounded-full`: a spring from 9999px
// to 12px undershoots zero and the corners flash square. Radii clamp, so 20px
// still reads as a full pill on the 32 and 36px sizes. The springs live in
// controls.css (keyed on data-variant/data-size, which TooltipTrigger asChild
// cannot overwrite); everything here is a utility, so a call site's own
// `rounded-*` or colours still win through tailwind-merge.
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-(--m3-pill) text-sm font-medium hover:rounded-(--md-shape-md) active:rounded-(--md-shape-sm) aria-pressed:rounded-(--md-shape-md) aria-expanded:rounded-(--md-shape-md) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-(color:--md-secondary) aria-invalid:outline-2 aria-invalid:outline-(color:--md-error)",
  {
    variants: {
      variant: {
        default:
          "bg-(--md-primary) text-(--md-on-primary) hover:bg-[color-mix(in_srgb,var(--md-on-primary)_8%,var(--md-primary))]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "bg-(--m3-control) text-(--m3-on-control) hover:bg-(--m3-control-hover) hover:text-(--md-on-surface) aria-pressed:bg-(--m3-on) aria-pressed:text-(--m3-on-on) aria-expanded:bg-(--m3-on) aria-expanded:text-(--m3-on-on)",
        secondary:
          "bg-(--md-secondary-container) text-(--md-on-secondary-container) hover:bg-(--m3-on-hover)",
        ghost:
          "text-(--m3-on-control) hover:bg-(--m3-hover) hover:text-(--md-on-surface) aria-pressed:bg-(--m3-on) aria-pressed:text-(--m3-on-on) aria-expanded:bg-(--m3-hover) aria-expanded:text-(--md-on-surface)",
        link: "rounded-none text-(--md-primary) underline-offset-4 hover:rounded-none hover:underline active:rounded-none",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3.5",
        sm: "h-8 gap-1.5 px-3.5 has-[>svg]:px-3",
        lg: "h-10 px-6 has-[>svg]:px-5",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      // Read by app/m3/controls.css: inside a bar (`Toolbar`, a `role="toolbar"`)
      // the outline and ghost buttons become M3 pills, which a class string
      // cannot say from outside. The sheet keys on these two, not on
      // `data-slot`, because a `TooltipTrigger asChild` overwrites the slot.
      // Upstream shadcn carries the same two attributes.
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
