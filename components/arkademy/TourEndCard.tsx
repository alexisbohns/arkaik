import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ARKADEMY_KICKER } from "@/components/arkademy/QuestionCard";
import { Button } from "@/components/ui/button";
import type { Company } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

interface TourEndCardProps {
  company: Pick<Company, "name">;
  /** The next example in gallery order, wrapping; null when the gallery has only this one. */
  next: { name: string; href: string } | null;
  /** The cover's gallery: `…/business-model-canvas#examples`. */
  examplesHref: string;
  /** Part 4 puts "Start your own" first here. */
  actions?: ReactNode;
  className?: string;
}

/**
 * What the last step shows once it is complete: the tour is over, and where
 * to go next — the next example's tour, or back to the gallery. Replay is the
 * player's own Play button.
 */
export function TourEndCard({ company, next, examplesHref, actions, className }: TourEndCardProps) {
  return (
    <section
      aria-labelledby="tour-end-title"
      className={cn("rounded-xl border border-dashed border-muted-foreground/45 p-4 sm:p-6", className)}
    >
      <p className={ARKADEMY_KICKER}>End of the tour</p>
      <h2 id="tour-end-title" className="mt-2 text-lg leading-snug font-semibold tracking-tight text-balance">
        Nine questions, one paragraph
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        That is {company.name}&apos;s business model: each answer became a sentence and filled its block. Every
        example is built the same way.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {actions}
        {next && (
          <Button asChild variant="outline">
            <Link href={next.href}>
              Next example: {next.name}
              <ChevronRightIcon aria-hidden="true" />
            </Link>
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link href={examplesHref}>All examples</Link>
        </Button>
      </div>
    </section>
  );
}
