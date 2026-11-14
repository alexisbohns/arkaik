"use client";

/**
 * The project sidebar's header: who (the project switcher), what (the product
 * scope and the sandbox notice) and where-to (Search). Each piece renders ONE
 * markup for both looks; app/m3/sidebar.css draws it per `data-panel-look`:
 *
 * - **Identity.** Expressive: the folder tile on an indigo cookie, the name in
 *   DynaPuff, no ⇕ chevrons. Calm: the project's initial in a halo, a larger
 *   title, the chevron as a small round button. The switcher itself (its menu,
 *   its actions) is the shipped one, untouched.
 * - **Scope.** The live product select, then the sandbox notice as a small
 *   tilted amber sticker that still says changes vanish on refresh.
 * - **Search.** Expressive: a round button docked beside the product select,
 *   in the select's own tones. Calm: a bare "Search or jump" row whose glyph
 *   wears a halo under the pointer, the chord as a ghost keycap.
 */
import type { CSSProperties, ReactNode } from "react";
import { SearchIcon } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { dynaPuff } from "@/lib/font-display";
import { cn } from "@/lib/utils";

function firstGlyph(title: string | undefined): string | null {
  const glyph = title ? Array.from(title.trim())[0] : undefined;
  return glyph ? glyph.toLocaleUpperCase() : null;
}

/** Wraps the live project switcher. `--ps-c-initial` carries the first letter Calm draws in place of the folder. */
export function SidebarIdentity({ projectTitle, children }: { projectTitle: string | undefined; children: ReactNode }) {
  const initial = firstGlyph(projectTitle);
  return (
    <div
      className={cn("ps-id ps-id-puff", dynaPuff.variable)}
      data-ps-c-id="lockup"
      data-ps-c-initial={initial ? "" : undefined}
      style={initial ? ({ "--ps-c-initial": JSON.stringify(initial) } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/** Places the live product select, then the sandbox sticker on the public self-map. */
export function SidebarScope({ selector, sandbox }: { selector: ReactNode; sandbox: boolean }) {
  return (
    <div className="ps-scope ps-scope-sticker">
      {selector}
      {sandbox ? (
        <p className="ps-sandbox-sticker group-data-[collapsible=icon]:hidden">
          <span className="ps-sticker-seal" aria-hidden="true">
            !
          </span>
          <span>
            <strong>Sandbox</strong>
            <span className="ps-sticker-sub">Changes vanish on refresh.</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Opens the ⌘K palette. The label stays in the accessibility tree when the Expressive dock hides it visually. */
export function SidebarSearch({ onOpen, chord }: { onOpen: () => void; chord: string | null }) {
  return (
    <SidebarMenu data-sb-search="" data-ps-c-search="halo" className="ps-search ps-search-dock">
      <SidebarMenuItem>
        <SidebarMenuButton tooltip="Search and jump" onClick={onOpen} className="m3-morph cursor-pointer">
          <SearchIcon />
          <span className="ps-search-dock-label">Search or jump</span>
          {chord ? (
            <kbd data-ps-c-kbd="" className="group-data-[collapsible=icon]:hidden">
              {chord}
            </kbd>
          ) : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
