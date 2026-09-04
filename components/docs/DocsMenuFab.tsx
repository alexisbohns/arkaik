"use client";

import { RainbowIcon } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * The mobile way into the docs navigation.
 *
 * The docs shell used to carry a header bar whose only job was to hold the
 * sidebar trigger; removing it left phones with no way to open the sheet. A
 * floating button in the thumb's corner is the replacement — and it costs the
 * page no vertical space, which was the reason the header went.
 *
 * Only mounted on mobile: on a desktop the sidebar is already on screen (and
 * the rail collapses it), so a button that opens it would be a duplicate.
 */
export function DocsMenuFab() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  // Not on desktop, where the sidebar is already on screen, and not while the
  // sheet it opens is open — a button floating over its own result reads as a
  // second, different control.
  if (!isMobile || openMobile) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => setOpenMobile(true)}
      aria-label="Open the documentation menu"
      className="fixed bottom-5 right-5 z-40 flex size-14 cursor-pointer items-center justify-center rounded-full border bg-sidebar text-sidebar-foreground shadow-lg transition-transform active:scale-95"
    >
      <RainbowIcon className="size-6" />
    </button>
  );
}
