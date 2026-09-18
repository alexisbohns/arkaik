"use client";

import { Fragment, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Node } from "@/lib/data/types";
import { usePanelBreadcrumbs } from "@/lib/hooks/usePanelBreadcrumbs";

export interface PageAction {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

interface PageHeaderProps {
  /** The page's own name. Also the trail's first crumb. */
  title: string;
  /** Line two when no panel is open — counts, filters, whatever the page wants. */
  meta?: ReactNode;
  action?: PageAction;
  /**
   * The page's own node list, for naming the crumbs. Passed rather than fetched
   * so a rename on the surface reaches the trail — see `usePanelBreadcrumbs`.
   */
  nodes?: Node[];
  /** Right-side controls, left of the action: display options, a version pill. */
  children?: ReactNode;
}

/**
 * The one project header, for pages under `ProjectPanelsProvider` — it reads the
 * panel stack, so despite the generic name it will throw anywhere else. That
 * throw is the point: a header that quietly rendered no trail would hide the
 * wiring mistake.
 *
 * Breadcrumbs used to mount in a row of their own the moment a panel opened,
 * which pushed the surface down every single time. That is fixed by the header
 * being `h-12` and staying `h-12`: whatever line two does, nothing below this
 * header ever moves.
 *
 * Line two is reserved only when it has something in it. It used to be reserved
 * unconditionally, behind a `min-h-4` floor, so the title could not re-centre
 * when a panel opened on a page carrying no meta. That cost was paid on every
 * render of such a page — the maps, mainly — where a 36px block of title and
 * nothing, centred in a 48px row, sat the title eight pixels above the sidebar
 * trigger and the buttons it stands between, and read as a mistake. A permanent
 * misalignment is worse than a one-off nudge that happens while a whole column
 * is appearing beside it, so the floor is gone.
 *
 * The breadcrumb classes defend the same equality. The stock list wraps and
 * sizes itself at `text-sm`, either of which makes the trail taller than the
 * `text-xs` line it stands in for; and a long trail turns the list into a
 * scroll container, which on a platform with classic scrollbars reserves gutter
 * height inside a header that has none to give.
 */
export function PageHeader({ title, meta, action, nodes, children }: PageHeaderProps) {
  const crumbs = usePanelBreadcrumbs(title, nodes);
  const ActionIcon = action?.icon;
  // Tested on what would actually RENDER, not on whether the prop was passed: a
  // page that computes its meta (`meta={filter === "all" ? undefined : label}`)
  // hands this an empty value in some states, and a line reserved for a value
  // that is not there is the whole fault above.
  const hasSecondLine =
    crumbs.length > 0 || (meta !== undefined && meta !== null && meta !== false && meta !== "");

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-3">
      <SidebarTrigger className="-ml-1 cursor-pointer" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <div className="min-w-0 flex-1">
        {/* The page's `h1`, not a styled paragraph. Every project surface
            renders exactly one `PageShell`, so this is the one place the whole
            view can be named — and the panel stack below hangs its own `h2` per
            open record off it. Without it those panels would be an outline
            starting at level two under nothing. Tailwind's preflight strips a
            heading's own size and weight, so the classes still decide how it
            looks: this is a semantics change, not a visual one. */}
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {hasSecondLine && (
          <div className="overflow-hidden text-xs text-muted-foreground">
            {crumbs.length > 0 ? (
              <Breadcrumb>
                <BreadcrumbList className="flex-nowrap gap-1 overflow-x-auto whitespace-nowrap text-xs [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden">
                  {crumbs.map((crumb, index) => (
                    <Fragment key={crumb.id}>
                      {index > 0 && <BreadcrumbSeparator />}
                      <BreadcrumbItem>
                        {crumb.onClick ? (
                          <button
                            type="button"
                            className="max-w-48 cursor-pointer truncate transition-colors hover:text-foreground"
                            onClick={crumb.onClick}
                          >
                            {crumb.label}
                          </button>
                        ) : (
                          <BreadcrumbPage className="max-w-48 truncate">{crumb.label}</BreadcrumbPage>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
            ) : (
              <span className="block truncate">{meta}</span>
            )}
          </div>
        )}
      </div>
      {(children || action) && (
        <div className="flex shrink-0 items-center gap-3">
          {children}
          {action &&
            (ActionIcon ? (
              // Below `md` the action is its icon alone. This header is one
              // fixed-height row carrying a title, a trail, the display controls
              // and this button, and on a phone the label is the first of those
              // that can be spared — the glyph and the tooltip still say what it
              // does. Only with an icon: label-less and icon-less would be a
              // blank button.
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    className="cursor-pointer"
                    onClick={action.onClick}
                    disabled={action.disabled}
                    // The label survives as the accessible name at every width,
                    // so the collapse is visual only.
                    aria-label={action.label}
                  >
                    <ActionIcon className="size-4" />
                    <span className="hidden md:inline">{action.label}</span>
                  </Button>
                </TooltipTrigger>
                {/* Only where the label is not already on screen — a tooltip
                    repeating a visible word is noise. */}
                <TooltipContent side="bottom" className="md:hidden">
                  {action.label}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                size="sm"
                className="cursor-pointer"
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.label}
              </Button>
            ))}
        </div>
      )}
    </header>
  );
}
