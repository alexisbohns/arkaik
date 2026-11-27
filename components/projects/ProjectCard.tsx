"use client";

import { lastTwelveMonths } from "@/lib/data/project-anatomy";
import type { CardModel } from "@/lib/data/project-page-model";
import {
  CardActions,
  CardLink,
  FONT,
  Platforms,
  Shape,
  SpeciesBar,
  SpeciesChips,
  Touched,
  fmt,
  identityOf,
  plural,
} from "./project-ui";

interface ProjectCardProps {
  /** The card's model: whether it can move and whether it syncs are already decided there. */
  card: CardModel;
}

/** The journal's last twelve months as bars, oldest first, with a caption. */
function MonthPulse({ card }: { card: CardModel }) {
  const journal = card.anatomy?.journal ?? null;
  const bars = journal ? lastTwelveMonths(journal.months) : new Array<number>(12).fill(0);
  const max = Math.max(1, ...bars);
  const year = bars.reduce((s, v) => s + v, 0);
  const label = journal ? `Journal: ${plural(year, "event")} in the last 12 months` : undefined;
  return (
    <div className="pj-pr-pulse">
      <div
        className="pj-pulse"
        data-state={journal ? "ready" : "none"}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        {bars.map((v, i) => (
          <i key={i} data-zero={v === 0 ? "" : undefined} style={{ ["--h" as string]: v / max }} />
        ))}
      </div>
      <span className="pj-pr-caption" aria-hidden="true">
        {journal ? `${fmt(year)} event${year === 1 ? "" : "s"} · 12 mo` : card.anatomy ? "No journal yet" : " "}
      </span>
    </div>
  );
}

/**
 * One project, as a row. THE ROW IS THE OPEN BUTTON.
 *
 * The title is a real `<Link>` stretched over the whole row by
 * `.pj-link::after`, rather than an `onClick` on the article: that keeps
 * keyboard focus, the status bar and open-in-new-tab working, and announces
 * one link per project. Anything else interactive (the sync control, "Move to
 * account") sits above that overlay.
 *
 * Two halves, an Expressive split — two shapes a hair apart with a tight joint:
 * the POSTER (title, description, when it was touched, its platforms) and the
 * ANATOMY (node and edge counts, the species mix as a bar and chips, the
 * journal's last twelve months). Own projects are neutral — no per-project or
 * per-kind colour, which would read like the species colours in the bar; only
 * the public example wears a hue, the Explore kind's plum. Under 36rem of row
 * width the halves stack.
 *
 * "Move to account" stays, because it is the ONLY way a Lokal or Synked
 * project becomes Hosted. Publishing, repositories and deletion live inside
 * the project (the sidebar footer and the Settings page).
 */
export function ProjectCard({ card }: ProjectCardProps) {
  const id = identityOf(card.title);
  return (
    <article
      data-projects-card=""
      data-pj-hue={card.isSeed ? "plum" : "neutral"}
      data-pj-tone={card.isSeed ? "explore" : "neutral"}
      className={`pj-card pj-pr ${FONT}`}
    >
      <div className="pj-pr-poster">
        <span className="pj-pr-art" aria-hidden="true">
          <Shape name={id.shape} className="pj-pr-shape" />
          <span className="pj-pr-letter">{id.monogram}</span>
        </span>
        {card.isSeed ? <span className="pj-pr-public">Public</span> : null}
        <h3 className="pj-title pj-pr-title">
          <CardLink card={card} />
        </h3>
        {card.description ? <p className="pj-pr-desc">{card.description}</p> : null}
        <div className="pj-pr-posterfoot">
          <Touched card={card} />
          <Platforms card={card} />
        </div>
      </div>
      <div className="pj-pr-data">
        <div className="pj-pr-figure">
          <span className="pj-big">{fmt(card.nodeCount)}</span>
          <span className="pj-pr-unit">node{card.nodeCount === 1 ? "" : "s"}</span>
          <span className="pj-pr-edges">
            <b>{fmt(card.edgeCount)}</b> edge{card.edgeCount === 1 ? "" : "s"}
          </span>
        </div>
        <SpeciesBar card={card} />
        <div className="pj-pr-row2">
          <SpeciesChips card={card} max={5} />
          <MonthPulse card={card} />
        </div>
        <CardActions card={card} />
      </div>
    </article>
  );
}
