import Link from "next/link";
import type { ReactNode } from "react";

import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { ARKADEMY_PATH } from "@/lib/arkademy/tools";
import { gochiHand } from "@/lib/fonts";
import { cn } from "@/lib/utils";

/** Every Arkademy page's content column, so the header and the pages line up. */
export const ARKADEMY_COLUMN = "mx-auto w-full max-w-6xl px-4 sm:px-6";

/** Each page's one `h1`, in the handwritten face (the docs and the landing use it the same way). */
export const ARKADEMY_TITLE = cn(gochiHand.className, "text-[2.75rem] leading-[1.05] text-foreground md:text-[3.5rem]");

/** A section's `h2` on an Arkademy page. */
export const ARKADEMY_SECTION_TITLE = "text-2xl font-semibold tracking-tight text-balance";

/**
 * The Arkademy's chrome, rendered once by app/arkademy/layout.tsx around every
 * page under it: the `/p/[id]` header pattern — the arkaik mark home, the word
 * "Arkademy" to the shell, the theme toggle — and the page's `main`.
 *
 * The `data-arkademy-*` hooks let one page restyle the chrome from its own
 * scoped stylesheet (the cover's Material reading, app/arkademy/
 * business-model-canvas/m3.css) without the chrome knowing about it.
 *
 * It holds no `h1`; each page renders exactly one. A server component: the
 * only client piece is ThemeToggle.
 */
export function ArkademyChrome({ children }: { children: ReactNode }) {
  return (
    <div data-arkademy-shell="" className="flex min-h-svh flex-col bg-background font-sans">
      <header data-arkademy-bar="" className="border-b">
        <div className={cn(ARKADEMY_COLUMN, "flex items-center justify-between gap-4 py-3")}>
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="Go to arkaik home"
              className="inline-flex shrink-0 items-center rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ArkaikLogo className="w-20" />
            </Link>
            <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
            <Link
              href={ARKADEMY_PATH}
              data-arkademy-title=""
              className={cn(
                gochiHand.className,
                "rounded-sm text-[1.6rem] leading-none text-foreground outline-none hover:text-foreground/80 focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              Arkademy
            </Link>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
