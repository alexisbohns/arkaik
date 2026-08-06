import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Skeleton, current generation (audit `shadcn-10`). Upstream has
 * since moved the fill from `bg-muted` to `bg-accent`; this app keeps
 * `bg-muted`, which is the tone every other loading surface here uses.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
