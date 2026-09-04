"use client";

import { FindingsBoard } from "@/components/quality/FindingsBoard";
import type { ComponentProps } from "react";

/**
 * `FindingsBoard` requires `onOpenNode`, and a function cannot cross the RSC
 * boundary, so the no-op is supplied here. `onOpenCriterion` is left out on
 * purpose: without it `FindingCard` drops the criterion chip's button.
 */
export function ReadOnlyFindingsBoard(props: Omit<ComponentProps<typeof FindingsBoard>, "onOpenNode" | "onOpenCriterion">) {
  return <FindingsBoard {...props} onOpenNode={() => {}} />;
}
