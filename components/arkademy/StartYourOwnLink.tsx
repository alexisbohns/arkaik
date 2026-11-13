"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { BMC_YOURS_PATH } from "@/lib/arkademy/tools";
import { useHasCanvasDraft } from "@/lib/hooks/useCanvasDraft";

/**
 * StartYourOwnButton's words and destination, unstyled: the cover's Material
 * reading draws it as its own button. "Start your own", or "Continue your
 * canvas" once this browser holds one (after hydration, never during it).
 */
export function StartYourOwnLink({ className, icon }: { className?: string; icon?: ReactNode }) {
  const hasDraft = useHasCanvasDraft();
  return (
    <Link href={BMC_YOURS_PATH} className={className}>
      {icon}
      {hasDraft ? "Continue your canvas" : "Start your own"}
    </Link>
  );
}
