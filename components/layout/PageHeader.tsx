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
 * which pushed the surface down every single time. Here the second line is
 * always present and only its contents change, so opening a panel costs no
 * layout. `min-h-4` is what keeps that true for a page passing no meta at all,
 * whose row would otherwise collapse and re-centre the title on every open.
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

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-3">
      <SidebarTrigger className="-ml-1 cursor-pointer" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <div className="min-h-4 overflow-hidden text-xs text-muted-foreground">
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
      </div>
      {(children || action) && (
        <div className="flex shrink-0 items-center gap-3">
          {children}
          {action && (
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {ActionIcon && <ActionIcon className="size-4" />}
              {action.label}
            </Button>
          )}
        </div>
      )}
    </header>
  );
}
