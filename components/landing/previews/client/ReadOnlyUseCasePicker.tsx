"use client";

import { UseCasePicker } from "@/components/generate/UseCasePicker";
import type { ComponentProps } from "react";

/** `UseCasePicker` requires `onSelect`; the no-op lives on the client side of the RSC boundary. */
export function ReadOnlyUseCasePicker(props: Omit<ComponentProps<typeof UseCasePicker>, "onSelect">) {
  return <UseCasePicker {...props} onSelect={() => {}} />;
}
