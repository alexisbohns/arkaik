"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BMC_YOURS_PATH } from "@/lib/arkademy/tools";
import { useHasCanvasDraft } from "@/lib/hooks/useCanvasDraft";

/**
 * The page's one special action (the filled button), on the cover and on the
 * tour's end card: "Start your own", or "Continue your canvas" once this
 * browser holds one. The server renders "Start your own"; the label changes
 * after hydration, never during it.
 */
export function StartYourOwnButton({ size = "default" }: { size?: "default" | "lg" }) {
  const hasDraft = useHasCanvasDraft();
  return (
    <Button asChild size={size}>
      <Link href={BMC_YOURS_PATH}>{hasDraft ? "Continue your canvas" : "Start your own"}</Link>
    </Button>
  );
}
