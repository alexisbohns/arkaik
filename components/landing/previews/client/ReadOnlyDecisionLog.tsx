"use client";

import { DecisionLog } from "@/components/decisions/DecisionLog";
import type { ComponentProps } from "react";

/**
 * `DecisionLog` requires an `onSelect` handler, and a function cannot cross
 * the RSC boundary, so the no-op is supplied here, on the client side of it.
 */
export function ReadOnlyDecisionLog(props: Omit<ComponentProps<typeof DecisionLog>, "onSelect">) {
  return <DecisionLog {...props} onSelect={() => {}} />;
}
