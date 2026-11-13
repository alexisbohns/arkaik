"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

/**
 * The theme toggle, for the tour's own top bar (the tour draws no Arkademy
 * header, so the header's toggle is not there): the app's ThemeToggle's
 * behaviour as an M3 tonal icon button. The sun shows in light, the moon in
 * dark, by the root's class (m3-tour.css), so the server and the first
 * client render agree whatever the stored theme.
 */
export function TourThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn("mx-icon-btn mx-icon-btn--tonal", className)}
    >
      <SunIcon aria-hidden="true" className="mx-theme-sun" />
      <MoonIcon aria-hidden="true" className="mx-theme-moon" />
    </button>
  );
}
