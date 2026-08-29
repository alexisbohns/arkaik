"use client";

import { useMemo, type ReactNode } from "react";
import { LayersIcon } from "lucide-react";
import type { KritikLibrary, QualityMatrix, QualitySection } from "@arkaik/schema";
import { SectionHeading } from "@/components/layout/SectionHeading";
import { QualityLegend } from "@/components/quality/QualityLegend";
import { SurfaceScoreCard, cellLabel } from "@/components/quality/SurfaceScoreCard";
import { domainIcon } from "@/lib/config/quality-domain-icons";
import { buildDomainSections, buildSurfaceGauges, cellKey } from "@/lib/utils/quality";

interface QualityMatrixSectionsProps {
  matrix: QualityMatrix;
  section?: QualitySection;
  library?: KritikLibrary;
  /** The open cell as `cellKey` encodes it, or `null`. Owned by the URL. */
  activeCell: string | null;
  onSelectCell: (domain: string, surface: string) => void;
}

/** The gallery: cards in a row, scrolling horizontally when they overflow. */
function Gallery({ children }: { children: ReactNode }) {
  return (
    // Its own scrollport, and the reason it is per-section rather than shared:
    // one scrollport across every domain means reaching `api` in Security
    // scrolls it out of view in Accessibility, and the reader loses the
    // comparison the moment they use the page. `snap-x` so a flick lands on a
    // card rather than between two.
    //
    // `overflow-y-hidden` is the wheel-trap fix, not decoration — the identical
    // one `components/ui/table.tsx` carries, and worth restating because it is
    // invisible until somebody tries to scroll. `overflow-x-auto` alone leaves
    // `overflow-y` at `visible`, which CSS *computes to `auto`* (visible cannot
    // pair with a non-visible value on the other axis), so this div is silently
    // a vertical scrollport with nothing in it to scroll. `globals.css` then
    // gives every `.overflow-x-auto` `overscroll-behavior: contain` — there to
    // stop swipes becoming browser navigation — and containment also blocks the
    // chaining that would hand an exhausted scroller's wheel to its ancestor.
    // Together: a wheel anywhere over a gallery stopped dead, and the page only
    // scrolled from the hairline of margin between two sections.
    //
    // Naming the axis keeps the horizontal scroll the cards need and leaves no
    // vertical scrollport for containment to hold on to. `py-1` is the rent it
    // charges: a clipped axis clips a focus ring too, and these cards are
    // buttons somebody tabs through.
    <div className="-mx-4 flex snap-x gap-2 overflow-x-auto overflow-y-hidden px-4 py-1">
      {children}
    </div>
  );
}

/**
 * The comparative matrix: one stacked section per domain, each a heading above
 * a gallery of surface cards, preceded by the surface roll-up.
 *
 * Nothing here scores anything. `deriveQualityMatrix` produced every number,
 * `gradeOf` bands the roll-up, and the caps were applied before this component
 * saw a cell — which is why a grade can read a letter worse than its score, and
 * why the legend has to say so.
 */
export function QualityMatrixSections({
  matrix,
  section,
  library,
  activeCell,
  onSelectCell,
}: QualityMatrixSectionsProps) {
  // The pilot's section is 338 assessments and 246 findings, and both of these
  // walk the whole of it. Split rather than chained for the reason the pages
  // state: `react-hooks/preserve-manual-memoization` accepts an opaque imported
  // call over its own deps and refuses a chain wrapped in one memo.
  const sections = useMemo(() => buildDomainSections(matrix, section, library), [matrix, section, library]);
  const gauges = useMemo(() => buildSurfaceGauges(matrix, section, library), [matrix, section, library]);

  return (
    <div className="flex flex-col">
      <div className="divide-y">
        {/*
          The surface roll-up, promoted from the old table's `tfoot` to the top
          of the page: a summary read *before* the detail is a summary, read
          after it is a twelfth domain. It is banded straight off its score with
          no caps re-applied — `deriveQualityMatrix` deliberately declined to
          fold them in here, since a cap shapes the cell you act on and folding
          it into the roll-up too would punish one finding twice.
        */}
        <section className="flex flex-col gap-3 p-4">
          <SectionHeading
            title="Overall"
            icon={LayersIcon}
            orientation="inline"
            description="Every domain weighed together, surface by surface."
            subtitle={`${matrix.surfaces.length} surface${matrix.surfaces.length === 1 ? "" : "s"}`}
          />
          <Gallery>
            {gauges.map((gauge) => (
              <SurfaceScoreCard
                key={gauge.surface}
                title={gauge.title}
                score={gauge.score}
                grade={gauge.grade}
                meta={`${gauge.openFindings} open`}
                label={
                  gauge.score === null
                    ? `${gauge.title} — nothing scored`
                    : `${gauge.title} — ${gauge.score} out of 100, grade ${gauge.grade} — ${gauge.openFindings} open findings`
                }
              />
            ))}
          </Gallery>
        </section>

        {sections.map((domain) => (
          <section key={domain.domain} className="flex flex-col gap-3 p-4">
            {/*
              Heading above the gallery, never beside it. `SectionRow`'s
              two-column shape would leave the gallery a `1fr` remainder of an
              already narrow column the moment a panel opens, and every gallery
              would scroll two cards at a time. Full width means the scrollport
              is the surface's width and narrows gracefully instead.
            */}
            <SectionHeading
              title={domain.name}
              icon={domainIcon(domain.domain)}
              orientation="inline"
              description={domain.description}
              subtitle={
                domain.average === null
                  ? "not scored"
                  : `avg ${domain.average} · ${domain.scored} scored`
              }
            />
            <Gallery>
              {domain.cards.map((card) => {
                const key = cellKey(domain.domain, card.surface);
                return (
                  <SurfaceScoreCard
                    key={card.surface}
                    title={card.title}
                    score={card.cell?.score ?? null}
                    grade={card.cell?.grade ?? null}
                    capped={card.cell?.capped}
                    findings={card.cell?.findings}
                    meta={
                      card.cell
                        ? `${card.cell.criteria} criteri${card.cell.criteria === 1 ? "on" : "a"}`
                        : undefined
                    }
                    label={
                      card.cell
                        ? cellLabel(domain.name, card.title, card.cell)
                        : `${domain.name} on ${card.title} — nothing scored`
                    }
                    active={activeCell === key}
                    // An unscored cell gets no handler, so `SurfaceScoreCard`
                    // renders it as inert rather than as a button that opens a
                    // panel with nothing in it.
                    onClick={card.cell ? () => onSelectCell(domain.domain, card.surface) : undefined}
                  />
                );
              })}
            </Gallery>
          </section>
        ))}
      </div>

      <div className="border-t p-4">
        <QualityLegend library={library} />
      </div>
    </div>
  );
}
