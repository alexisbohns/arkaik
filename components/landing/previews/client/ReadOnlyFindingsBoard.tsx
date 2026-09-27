"use client";

import type { ComponentProps } from "react";
import { FindingsBoard } from "@/components/quality/FindingsBoard";

/**
 * The board, inert.
 *
 * `FindingsBoard` requires `onOpenFinding`, and a function cannot cross the RSC
 * boundary. `onOpenCriterion` stays omitted on purpose: without it `FindingCard`
 * drops the criterion chip's button, which is the right shape for a preview
 * nobody can click into.
 */
export function ReadOnlyFindingsBoard(
  props: Omit<ComponentProps<typeof FindingsBoard>, "onOpenFinding" | "onOpenCriterion">,
) {
  return <FindingsBoard {...props} onOpenFinding={() => {}} />;
}
