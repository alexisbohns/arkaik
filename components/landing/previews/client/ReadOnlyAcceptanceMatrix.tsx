"use client";

import { AcceptanceMatrix } from "@/components/acceptances/AcceptanceMatrix";
import type { ComponentProps } from "react";

/**
 * `AcceptanceMatrix` requires an `onSelect` handler, and a function cannot
 * cross the RSC boundary, so the no-op is supplied here, on the client side of
 * it.
 */
export function ReadOnlyAcceptanceMatrix(props: Omit<ComponentProps<typeof AcceptanceMatrix>, "onSelect">) {
  return <AcceptanceMatrix {...props} onSelect={() => {}} />;
}
