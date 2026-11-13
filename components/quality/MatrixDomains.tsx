"use client";

import { Fragment, useMemo, type CSSProperties } from "react";
import type { QualityMatrixCell, ScoreDelta } from "@arkaik/schema";
import { GRADES } from "@/components/quality/GradeTrack";
import { DomainGlyph, QualitySeal, plural } from "@/components/quality/QualitySeal";
import { DeltaArrow, cellLabel } from "@/components/quality/SurfaceScoreCard";
import { cellKey, type DomainSection } from "@/lib/utils/quality";

/** How the matrix lays its cells out — `?matrix=worst` on the Matrix page; absent = the heatmap. */
export type MatrixView = "heatmap" | "worst";

const VIEWS: readonly { id: MatrixView; label: string }[] = [
  { id: "heatmap", label: "Heatmap" },
  { id: "worst", label: "Worst first" },
];

interface MatrixDomainsProps {
  /** One per domain, each with one card per profile surface (`cell: null` = not scored). */
  sections: DomainSection[];
  /** The open cell as `cellKey` encodes it, or `null`. Owned by the URL. */
  activeCell: string | null;
  onSelectCell: (domain: string, surface: string) => void;
  view: MatrixView;
  /**
   * Absent where the view is not the reader's to change (the landing
   * preview): the switch is not drawn and the view stays what it was given.
   */
  onViewChange?: (view: MatrixView) => void;
}

/**
 * Every domain on every surface, in one of two layouts behind one switch.
 *
 * - **Heatmap** (the default): the matrix as a matrix. The old per-domain
 *   galleries made the reader scroll eleven rows sideways to compare one
 *   surface; a grid with domains down and surfaces across answers "where is
 *   it worst" in one look, and the grade tint does the reading.
 * - **Worst first**: the same cells as triage — banded by the grade they
 *   hold, lowest score first. Where to look, in order.
 *
 * The same buttons in both, with the same accessible names (`cellLabel`) and
 * the same `aria-pressed` on the open cell, so the switch changes an order,
 * never a behaviour. A connected two-key group rather than a menu: two
 * choices, both always visible, the chosen one lifted out.
 */
export function MatrixDomains({ sections, activeCell, onSelectCell, view, onViewChange }: MatrixDomainsProps) {
  return (
    <div>
      {onViewChange && (
        <div className="kq-domains-bar">
          <div role="group" aria-label="Matrix view" className="kq-segments">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={view === option.id}
                onClick={() => onViewChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {view === "worst" ? (
        <MatrixWorstFirst sections={sections} activeCell={activeCell} onSelectCell={onSelectCell} />
      ) : (
        <MatrixHeatmap sections={sections} activeCell={activeCell} onSelectCell={onSelectCell} />
      )}
    </div>
  );
}

type LayoutProps = Pick<MatrixDomainsProps, "sections" | "activeCell" | "onSelectCell">;

/** A domain's seal, name and average — the heatmap's row head. */
function DomainHead({ domain }: { domain: DomainSection }) {
  return (
    <div className="kq-domain-head">
      <QualitySeal className="kq-domain-seal">
        <DomainGlyph code={domain.domain} className="size-[1.05em]" />
      </QualitySeal>
      <span className="kq-domain-text">
        {/* The description lives in the tooltip: eleven paragraphs down the
            row heads would push the grid off the screen it exists to fit on. */}
        <h2 className="kq-domain-name" title={domain.description}>
          {domain.name}
        </h2>
        {/* Deliberately unweighted — see `DomainSection.average`. A heading,
            not a score anybody acts on. */}
        <span className="kq-domain-avg">
          {domain.average === null ? "not scored" : `avg ${domain.average} · ${domain.scored} scored`}
        </span>
      </span>
    </div>
  );
}

/** The accessible name of a cell that was not scored — said, not skipped, so the grid has no holes. */
const unscoredLabel = (domainName: string, surfaceTitle: string) => `${domainName} on ${surfaceTitle} — nothing scored`;

function cellName(domain: DomainSection, title: string, cell: QualityMatrixCell, delta?: ScoreDelta) {
  return cellLabel(domain.name, title, cell, delta);
}

/**
 * The matrix as one connected shape: domains down, surfaces across, each tile
 * tinted by its grade, the outer corners rounded and the joints tight (the
 * Expressive connected group). Pointing at a tile recedes everything outside
 * its row and its column — a crosshair, focus by receding — and the open cell
 * lifts out of the shape.
 *
 * The column heads stick to the top of the page's scroller, so a surface stays
 * named eleven rows down. Under 40rem of its own width (a panel open on a
 * laptop, a phone) the row heads move above their row and the tiles keep the
 * full width: the grid narrows, it never scrolls sideways.
 *
 * An unscored cell is an inert dashed tile with its own sentence, never a
 * button: there is nothing to open behind it.
 */
function MatrixHeatmap({ sections, activeCell, onSelectCell }: LayoutProps) {
  const surfaces = sections[0]?.cards ?? [];
  const rows = sections.length;
  return (
    <section className="kq-scope kq-heat" aria-label="Every domain on every surface">
      <div className="kq-heat-grid" style={{ "--kq-cols": surfaces.length } as CSSProperties}>
        <span className="kq-heat-corner" aria-hidden="true" />
        {/* `aria-hidden`: every tile's name already says its surface. */}
        {surfaces.map((card) => (
          <span key={card.surface} className="kq-heat-col" title={card.title} aria-hidden="true">
            {card.title}
          </span>
        ))}
        {sections.map((domain, r) => (
          <Fragment key={domain.domain}>
            <div className="kq-heat-row">
              <DomainHead domain={domain} />
            </div>
            {domain.cards.map((card, c) => {
              const key = cellKey(domain.domain, card.surface);
              // Where the tile sits: the crosshair recedes by row and column,
              // and only the shape's four outer corners are rounded.
              const position = {
                "data-row": String(r + 1),
                "data-col": String(c + 1),
                "data-r0": r === 0 || undefined,
                "data-rl": r === rows - 1 || undefined,
                "data-c0": c === 0 || undefined,
                "data-cl": c === domain.cards.length - 1 || undefined,
              };
              if (!card.cell) {
                const label = unscoredLabel(domain.name, card.title);
                return (
                  <span key={card.surface} className="kq-heat-tile" data-unscored="" role="img" aria-label={label} title={label} {...position}>
                    <span className="kq-heat-gap">—</span>
                  </span>
                );
              }
              const label = cellName(domain, card.title, card.cell, card.delta);
              return (
                <button
                  key={card.surface}
                  type="button"
                  className="kq-heat-tile"
                  data-kq-grade={card.cell.grade}
                  aria-pressed={activeCell === key}
                  aria-label={label}
                  title={label}
                  onClick={() => onSelectCell(domain.domain, card.surface)}
                  {...position}
                >
                  <span className="kq-heat-score">{card.cell.score}</span>
                  <span className="kq-heat-meta">
                    <span className="kq-heat-grade">
                      {card.cell.grade}
                      {card.cell.capped && "*"}
                    </span>
                    <DeltaArrow delta={card.delta} />
                  </span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

/**
 * Worst first: every scored cell, banded by the grade it holds (caps already
 * applied — the band is the grade the reader sees, not the one the score
 * alone would earn), lowest score first inside a band, a capped cell before an
 * uncapped one at the same score. The bands run E to A. Cells nothing scored
 * close the list, inert, so the count adds up to the heatmap's.
 */
function MatrixWorstFirst({ sections, activeCell, onSelectCell }: LayoutProps) {
  const bands = useMemo(() => {
    const scored: { domain: DomainSection; title: string; surface: string; cell: QualityMatrixCell; order: number }[] = [];
    const unscored: { domain: DomainSection; title: string; surface: string }[] = [];
    let order = 0;
    for (const domain of sections)
      for (const card of domain.cards) {
        if (card.cell) scored.push({ domain, title: card.title, surface: card.surface, cell: card.cell, order: order++ });
        else unscored.push({ domain, title: card.title, surface: card.surface });
      }
    scored.sort((a, b) => a.cell.score - b.cell.score || Number(b.cell.capped) - Number(a.cell.capped) || a.order - b.order);
    const byGrade = [...GRADES]
      .reverse()
      .map((grade) => ({ grade, cells: scored.filter((entry) => entry.cell.grade === grade) }))
      .filter((band) => band.cells.length > 0);
    return { byGrade, unscored };
  }, [sections]);
  const deltaOf = (domain: DomainSection, surface: string) => domain.cards.find((card) => card.surface === surface)?.delta;

  return (
    <div className="kq-scope kq-triage">
      {bands.byGrade.map((band) => (
        <section key={band.grade} className="kq-band" aria-label={`Grade ${band.grade}`}>
          <header className="kq-band-head">
            <QualitySeal grade={band.grade} shape="cookie9" className="kq-band-seal">
              {band.grade}
            </QualitySeal>
            <h2 className="kq-band-title">Grade {band.grade}</h2>
            <span className="kq-band-count">{plural(band.cells.length, "cell", "cells")}</span>
          </header>
          <ul className="kq-band-tiles">
            {band.cells.map(({ domain, title, surface, cell }) => {
              const key = cellKey(domain.domain, surface);
              const label = cellName(domain, title, cell, deltaOf(domain, surface));
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="kq-band-tile"
                    data-kq-grade={cell.grade}
                    aria-pressed={activeCell === key}
                    aria-label={label}
                    title={label}
                    onClick={() => onSelectCell(domain.domain, surface)}
                  >
                    <DomainGlyph code={domain.domain} className="kq-band-icon" />
                    <span className="kq-band-names">
                      <span className="kq-band-domain">{domain.name}</span>
                      <span className="kq-band-surface">{title}</span>
                    </span>
                    <span className="kq-band-score">
                      {cell.score}
                      {cell.capped && <sup>*</sup>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {bands.unscored.length > 0 && (
        <section className="kq-band" aria-label="Not scored">
          <header className="kq-band-head">
            <h2 className="kq-band-title">Not scored</h2>
            <span className="kq-band-count">{plural(bands.unscored.length, "cell", "cells")}</span>
          </header>
          <ul className="kq-band-tiles">
            {bands.unscored.map(({ domain, title, surface }) => (
              <li key={cellKey(domain.domain, surface)}>
                <span className="kq-band-tile" data-unscored="" role="img" aria-label={unscoredLabel(domain.name, title)}>
                  <span className="kq-band-names">
                    <span className="kq-band-domain">{domain.name}</span>
                    <span className="kq-band-surface">{title}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
