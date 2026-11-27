"use client";

import type { ReactNode } from "react";

import { SectionCreateMenu } from "./SectionCreateMenu";
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
}

/**
 * One section of the projects page: a heading, a count, that section's creation
 * controls, and either its cards or an empty state.
 *
 * An empty section still renders. It is how the page teaches what the three
 * kinds ARE, and the empty state carries the same create control as the header
 * so the explanation and the action sit together.
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
}: ProjectSectionProps) {
  const { target, items, title, blurb } = section;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-baseline gap-2 text-lg font-semibold">
          {title}
          <span className="text-sm font-normal text-muted-foreground">{items.length}</span>
        </h2>
        <SectionCreateMenu
          target={target}
          onCreate={onCreate}
          onImport={onImport}
          onRestore={onRestore}
          disabled={disabled}
        />
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">{blurb}</p>
          {/* A distinct label, so an empty section does not announce two
              identically-named create buttons to a screen reader. */}
          <SectionCreateMenu
            target={target}
            onCreate={onCreate}
            onImport={onImport}
            onRestore={onRestore}
            disabled={disabled}
            primaryLabel={`Create your first ${title} project`}
          />
          {emptyExtra ? <div className="flex items-center gap-2">{emptyExtra}</div> : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{items.map(renderCard)}</div>
      )}
    </section>
  );
}
