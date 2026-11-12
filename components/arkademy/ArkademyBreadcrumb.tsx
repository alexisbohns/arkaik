import Link from "next/link";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface ArkademyCrumb {
  label: string;
  /** Omitted on the last crumb: the page itself. */
  href?: string;
}

/**
 * The trail above a page deeper than the shell: "Arkademy › Business Model
 * Canvas" on the cover, one more crumb on a tour. Crumbs with an `href` are
 * Next links (client navigation); the one without is the current page.
 */
export function ArkademyBreadcrumb({ trail }: { trail: readonly ArkademyCrumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {trail.map((crumb, i) => (
          <Fragment key={`${i}:${crumb.label}`}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="rounded-sm transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {crumb.label}
                </Link>
              ) : (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
