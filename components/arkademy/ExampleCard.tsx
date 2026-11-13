import { FlaskConicalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CanvasGrid } from "@/components/arkademy/CanvasGrid";
import { CanvasLink } from "@/components/arkademy/CanvasLink";
import { ExpressiveShape, type ExpressiveShapeName } from "@/components/arkademy/ExpressiveShape";
import { ParagraphView } from "@/components/arkademy/ParagraphView";
import {
  composeParagraph,
  type CanvasQuestionState,
} from "@/lib/arkademy/paragraph";
import type { BmcQuestion, Company } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

interface ExampleCardProps {
  company: Company;
  /** The document's nine questions. */
  questions: readonly BmcQuestion[];
  /** The example's canvas, from `exampleCanvas`. */
  state: readonly CanvasQuestionState[];
  /** Part 3 puts "Play the tour" here. */
  actions?: ReactNode;
  /** The card's accent: a shape, and its fill and ink classes (`--ink` names the letter's colour). */
  accent?: { shape: ExpressiveShapeName; tone: string };
  className?: string;
}

/**
 * One example in the cover's horizontal gallery: the company's name, a "Simulation"
 * badge when it is one, its one-liner, its whole paragraph (notes and their
 * sources included), its mini canvas and its note. Server-rendered, so a
 * crawler reads every word.
 *
 * Drawn as an M3 Expressive carousel item (m3-expressive.css): a panel in the
 * extra-large-increased shape, the company's initial in an accent shape, the
 * name emphasized, "Simulation" as a tertiary chip, and the canvas's blocks
 * tinted by side of the canvas.
 */
export function ExampleCard({
  company,
  questions,
  state,
  actions,
  accent,
  className,
}: ExampleCardProps) {
  const segments = composeParagraph({
    questions,
    state,
    subject: company.name,
  });
  const headingId = `example-${company.id}`;
  return (
    <article
      aria-labelledby={headingId}
      className={cn("mx-item flex min-w-0 flex-col gap-5 p-4 sm:gap-6 sm:p-8", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-4">
          {accent && (
            <div aria-hidden="true" className={cn("relative size-14 shrink-0", accent.tone)}>
              <ExpressiveShape shape={accent.shape} className="size-full" />
              <span className="mx-title-l-em absolute inset-0 grid place-items-center text-(--ink)">
                {company.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3
                id={headingId}
                className="mx-headline-m min-w-0 text-(--md-on-surface) wrap-anywhere"
              >
                {company.name}
              </h3>
              {company.simulation && (
                <span className="mx-chip">
                  <FlaskConicalIcon aria-hidden="true" />
                  Simulation
                </span>
              )}
            </div>
            <p className="mx-body-m mt-1 text-(--md-on-surface-variant)">
              {company.oneLiner}
            </p>
          </div>
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        )}
      </div>
      {/* One link per card: its sentences and its blocks highlight each other, never another card's. */}
      <CanvasLink className="contents">
        <ParagraphView segments={segments} className="mx-body-l text-(--md-on-surface)" />
        <CanvasGrid
          questions={questions}
          state={state}
          density="mini"
          headingLevel={4}
          idPrefix={headingId}
          label={`${company.name}'s canvas`}
        />
      </CanvasLink>
      {company.note && (
        <p className="mx-body-s text-(--md-on-surface-variant)">
          {company.note}
        </p>
      )}
    </article>
  );
}
