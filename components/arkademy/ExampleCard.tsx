import type { ReactNode } from "react";

import { CanvasGrid } from "@/components/arkademy/CanvasGrid";
import { CanvasLink } from "@/components/arkademy/CanvasLink";
import { ParagraphView } from "@/components/arkademy/ParagraphView";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { composeParagraph, type CanvasQuestionState } from "@/lib/arkademy/paragraph";
import type { BmcQuestion, Company } from "@/lib/arkademy/schema";

interface ExampleCardProps {
  company: Company;
  /** The document's nine questions. */
  questions: readonly BmcQuestion[];
  /** The example's canvas, from `exampleCanvas`. */
  state: readonly CanvasQuestionState[];
  /** Part 3 puts "Play the tour" here. */
  actions?: ReactNode;
}

/**
 * One example in the cover's gallery: the company's name, a "Simulation"
 * badge when it is one, its one-liner, its whole paragraph (notes and their
 * sources included), its mini canvas and its note. Server-rendered, so a
 * crawler reads every word.
 */
export function ExampleCard({ company, questions, state, actions }: ExampleCardProps) {
  const segments = composeParagraph({ questions, state, subject: company.name });
  const headingId = `example-${company.id}`;
  return (
    <Card role="article" aria-labelledby={headingId} className="min-w-0 gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 id={headingId} className="min-w-0 text-xl font-semibold tracking-tight wrap-anywhere">
              {company.name}
            </h3>
            {company.simulation && <Badge variant="outline">Simulation</Badge>}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{company.oneLiner}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {/* One link per card: its sentences and its blocks highlight each other, never another card's. */}
      <CanvasLink className="contents">
        <ParagraphView segments={segments} />
        <CanvasGrid
          questions={questions}
          state={state}
          density="mini"
          headingLevel={4}
          idPrefix={headingId}
          label={`${company.name}'s canvas`}
        />
      </CanvasLink>
      {company.note && <p className="text-xs leading-relaxed text-muted-foreground">{company.note}</p>}
    </Card>
  );
}
