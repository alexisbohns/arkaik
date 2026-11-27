"use client";

import type { ReactNode } from "react";

import type { PageModel } from "@/lib/data/project-page-model";
import { FONT, Shape, ago, plural, touchedAt } from "./project-ui";

/** One true line about the shelf, or a promise when it is empty. */
function truth(page: PageModel): string {
  const t = page.totals;
  if (t.projects === 0) return "Every product you map, in one place.";
  const newest = page.recent[0] ? ago(touchedAt(page.recent[0])) : null;
  return `${plural(t.projects, "project")} · ${plural(t.nodes, "node")} · ${plural(t.edges, "edge")}${
    newest ? ` · last touched ${newest}` : ""
  }`;
}

/**
 * The page's opening, by look — both render, the stylesheet shows one per
 * `data-panel-look` (set before first paint, so the wrong one never flashes):
 *
 *  - Expressive: "Projects" big, in the brand face, one true line under it,
 *    a neutral flower that turns when you hover;
 *  - Calm: a quiet bar — the title and three chips of truth.
 *
 * Signed in, the page's create entry is the "New project" door beside the
 * kind tabs (Expressive) or each section's round plus (Calm), so the hero
 * carries none; signed out there is only Lokal, and `create` is its menu.
 * Each look has its own h1; the hidden one is `display: none`, so exactly one
 * is ever exposed.
 */
export function ProjectsHero({ page, create }: { page: PageModel; create: ReactNode }) {
  const t = page.totals;
  return (
    <>
      <div data-pj-look="expressive">
        <section className={`pj-hero ${FONT}`} data-pj-hero="title">
          <Shape name="flower" className="pj-hero-shape" />
          <div className="pj-hero-text">
            <h1 className="pj-hero-title">Projects</h1>
            <p className="pj-hero-sub">{truth(page)}</p>
          </div>
          {create ? <div className="pj-hero-actions">{create}</div> : null}
        </section>
      </div>
      <div data-pj-look="calm">
        <section className={`pj-hero ${FONT}`} data-pj-hero="compact">
          <h1 className="pj-hero-title">Projects</h1>
          {t.projects > 0 ? (
            <ul className="pj-chipline">
              <li>{plural(t.projects, "project")}</li>
              <li>{plural(t.nodes, "node")}</li>
              <li>{plural(t.edges, "edge")}</li>
            </ul>
          ) : null}
          {create ? <div className="pj-hero-actions">{create}</div> : null}
        </section>
      </div>
    </>
  );
}
