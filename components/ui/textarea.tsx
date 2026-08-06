import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The stock shadcn/ui Textarea — the missing twin of `input.tsx` (audit
 * `shadcn-3`).
 *
 * The point is the shared focus/invalid treatment. Without this primitive the
 * repo grew three recipes for the same field: two hand-copied approximations of
 * Input's classes that used `focus:` where Input uses `focus-visible:` (so a
 * mouse click lit the ring, which the Inputs beside them do not), and a third
 * `rounded-md border bg-background` recipe with no ring at all. The class string
 * below is Input's, verbatim, so a multi-line field can never again focus
 * differently from the single-line field next to it.
 *
 * One deliberate departure from upstream: upstream ships `field-sizing-content`,
 * which makes the box grow with its content and *overrides* the `rows` attribute.
 * Every textarea in this app sizes itself with `rows` (2 for a description, 10
 * for a pasted bundle), and content sizing would collapse all of them to the
 * `min-h-16` floor while empty. Per-site `rows`, `resize-*` and `font-mono` stay
 * className/attribute overrides, as they are today.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground dark:bg-input/30 border-input flex min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
