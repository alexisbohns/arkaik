"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import type { ReactNode } from "react";

import { ownsArkademyChrome } from "@/lib/arkademy/tour-stage";

/**
 * Where the Arkademy's header goes, decided by route: every page under
 * /arkademy gets it, except the tour's screen, which draws its own top bar
 * (lib/arkademy/tour-stage.ts `ownsArkademyChrome`). It reads the segments
 * below app/arkademy/layout.tsx, on the server as on the client, so the
 * header is simply not rendered there — never rendered and hidden.
 */
export function ArkademyHeaderSlot({ children }: { children: ReactNode }) {
  const segments = useSelectedLayoutSegments();
  return ownsArkademyChrome(segments) ? null : children;
}
