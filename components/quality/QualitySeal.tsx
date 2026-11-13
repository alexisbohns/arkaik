import { createElement, type ReactNode } from "react";
import type { QualityGrade } from "@arkaik/schema";
import { ExpressiveShape, type ExpressiveShapeName } from "@/components/arkademy/ExpressiveShape";
import { domainIcon } from "@/lib/config/quality-domain-icons";
import { cn } from "@/lib/utils";

/**
 * A decorative Material 3 Expressive shape with something — a domain's mark, a
 * grade's letter, a lane's priority — set on it. The quality pages' answer to
 * the node panel's species seal: a domain head, a grade band and the cell
 * panel's header all wear one, so the pages read as the panels' kin.
 *
 * Neutral by default (the secondary tone). Given a `grade` or a `priority` it
 * fills solid in that tone, through the same `data-kq-*` attributes the tiles
 * and the grade track use, so a seal never disagrees with the tile beside it.
 *
 * `aria-hidden`: whatever it carries is said in words next to it.
 */
export function QualitySeal({
  children,
  shape = "cookie12",
  className,
  grade,
  priority,
}: {
  children: ReactNode;
  shape?: ExpressiveShapeName;
  className?: string;
  grade?: QualityGrade;
  priority?: string;
}) {
  return (
    <span className={cn("kq-seal", className)} aria-hidden="true" data-kq-grade={grade} data-kq-priority={priority}>
      <ExpressiveShape shape={shape} className="kq-seal-shape" />
      <span className="kq-seal-face">{children}</span>
    </span>
  );
}

/** A domain's mark, looked up from its code (the shipped icon table). */
export function DomainGlyph({ code, className }: { code: string; className?: string }) {
  return createElement(domainIcon(code), { className, "aria-hidden": true });
}

/** "1 criterion" / "3 criteria", "1 open finding" / "2 open findings". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
