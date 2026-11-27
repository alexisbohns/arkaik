"use client";

import type { ReactNode } from "react";

import { SectionCreateMenu } from "./SectionCreateMenu";
import { FONT, KINDS, KindMark } from "./project-ui";
import type { CardModel, SectionModel } from "@/lib/data/project-page-model";

interface ProjectSectionProps {
  /** This section, as a model: its target, its copy and its cards. The count and the empty state both derive from it. */
  section: SectionModel;
  /** Renders one card. The section owns the grid; the caller owns the card's wiring. */
  renderCard: (card: CardModel) => ReactNode;
  onCreate: () => void;
  onImport: () => void;
  onRestore?: () => void;
  disabled?: boolean;
  /**
   * Extra content for the empty state, below the create menu.
   *
   * It exists for the example project picker, which belongs to Lokal and only
   * to Lokal: an example is a bundle written to this browser, so there is no
   * Hosted or Synked equivalent to offer. Rather than teach this component
   * about seeds, the one section that has something more to say passes it in.
   */
  emptyExtra?: ReactNode;
  /** Inside the kind tabs the tab already names the section: its head is left out. */
  headless?: boolean;
}

/**
 * One section of the projects page: a head (the kind's mark, its name, a count
 * and where it lives, the round create plus), then its projects as rows — or
 * an empty state.
 *
 * An empty section still renders. It is how the page teaches what the three
 * kinds ARE — in a line and as two facts — and the empty state carries its own
 * create control so the explanation and the action sit together.
 *
 * The section takes its model rather than a count plus an already built grid:
 * with two inputs, a caller whose filter changed one but not the other would
 * show an empty state on top of real projects. One input cannot disagree with
 * itself.
 */
export function ProjectSection({
  section,
  renderCard,
  onCreate,
  onImport,
  onRestore,
  disabled,
  emptyExtra,
  headless = false,
}: ProjectSectionProps) {
  const { target, items, title, blurb } = section;
  const k = KINDS[target];
  const menu = (context: "head" | "empty", primaryLabel?: string) => (
    <SectionCreateMenu
      target={target}
      onCreate={onCreate}
      onImport={onImport}
      onRestore={onRestore}
      disabled={disabled}
      context={context}
      primaryLabel={primaryLabel}
    />
  );

  return (
    <section data-projects-section={target} className="pj-section">
      {headless ? null : (
        <div className={`pj-sechead ${FONT}`} data-pj-hue={k.hue}>
          <KindMark kind={target} />
          <div className="pj-sechead-text">
            <h2 className="pj-sechead-title">
              {title}
              <span className="pj-sechead-count">{items.length}</span>
            </h2>
            <p className="pj-sechead-where">{k.where}</p>
          </div>
          <div className="pj-sechead-create">{menu("head")}</div>
        </div>
      )}

      {items.length === 0 ? (
        <div data-projects-empty="" data-pj-empty="teach" data-pj-hue={k.hue} className={`pj-empty ${FONT}`}>
          <KindMark kind={target} size="xl" />
          <div className="pj-empty-text">
            <p className="pj-empty-title">No {title} projects yet</p>
            <p className="pj-empty-blurb">{blurb}</p>
            <ul className="pj-facts">
              {k.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className="pj-empty-ways">
            {/* A distinct label, so an empty section does not announce two
                identically-named create controls to a screen reader. */}
            {menu("empty", `Create your first ${title} project`)}
            {emptyExtra ? <div className="pj-empty-extra">{emptyExtra}</div> : null}
          </div>
        </div>
      ) : (
        <div data-projects-grid="" data-projects-target={target}>
          {items.map(renderCard)}
        </div>
      )}
    </section>
  );
}
