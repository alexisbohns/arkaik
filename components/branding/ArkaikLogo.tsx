import { cn } from "@/lib/utils";

import { LOGO_VIEWBOX, LogoPaths } from "./logo-paths";

interface ArkaikLogoProps {
  className?: string;
}

export function ArkaikLogo({ className }: ArkaikLogoProps) {
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      role="img"
      aria-label="Arkaik"
      className={cn("w-full text-primary", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <LogoPaths />
    </svg>
  );
}
