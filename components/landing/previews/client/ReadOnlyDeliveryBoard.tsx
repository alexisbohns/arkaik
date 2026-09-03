"use client";

import { DeliveryBoard } from "@/components/delivery/DeliveryBoard";
import type { ComponentProps } from "react";

/**
 * `DeliveryBoard` requires an `onSelectItem` handler, and a function cannot
 * cross the RSC boundary, so the no-op is supplied here, on the client side of
 * it. Nothing else: the columns arrive already computed.
 */
export function ReadOnlyDeliveryBoard(props: Omit<ComponentProps<typeof DeliveryBoard>, "onSelectItem">) {
  return <DeliveryBoard {...props} onSelectItem={() => {}} />;
}
