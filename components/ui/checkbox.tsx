"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The stock shadcn/ui Checkbox (audit `shadcn-5`), replacing four recipes for
 * the same control — `accent-primary`, `accent-foreground`, fully unstyled
 * native, and `rounded border-input` — none of which had the focus-visible ring
 * every other interactive primitive here carries.
 *
 * The indicator is the one addition over upstream, and it is why NodeTable's
 * select-all can drop its ref + effect: `checked="indeterminate"` is a plain
 * prop on Radix's root, where the native `indeterminate` is an IDL property
 * settable only from JavaScript. Upstream draws a check for both states, which
 * would make "some selected" and "all selected" identical boxes — exactly the
 * misreport the ref hack existed to avoid — so the third state gets a dash.
 *
 * Reading `checked` for that branch is safe because indeterminate is only ever
 * reachable through the controlled prop; an uncontrolled checkbox has no way to
 * enter it.
 */
function Checkbox({
  className,
  checked,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      checked={checked}
      className={cn(
        "peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        {checked === "indeterminate" ? (
          <MinusIcon className="size-3.5" />
        ) : (
          <CheckIcon className="size-3.5" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
