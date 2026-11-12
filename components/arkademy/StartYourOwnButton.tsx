"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BMC_YOURS_PATH } from "@/lib/arkademy/tools";
import { useHasCanvasDraft } from "@/lib/hooks/useCanvasDraft";

interface StartYourOwnButtonProps {
  size?: "default" | "lg";
  /** `stone` on the cover, its one special action; `outline` where the page already has one (the tour's end card). */
  variant?: "stone" | "outline";
}

/**
 * "Start your own", or "Continue your canvas" once this browser holds one.
 * The server renders "Start your own"; the label changes after hydration,
 * never during it.
 */
export function StartYourOwnButton({ size = "lg", variant = "stone" }: StartYourOwnButtonProps) {
  const hasDraft = useHasCanvasDraft();
  return (
    <Button asChild variant={variant} size={size}>
      <Link href={BMC_YOURS_PATH}>{hasDraft ? "Continue your canvas" : "Start your own"}</Link>
    </Button>
  );
}
