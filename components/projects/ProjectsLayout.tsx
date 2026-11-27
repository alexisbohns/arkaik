"use client";

import { useContext, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { CreateTarget } from "@/lib/data/create-target";
import type { CardModel, PageModel } from "@/lib/data/project-page-model";
import { Door, FONT, KINDS, KindMark, ProjectsLook, TARGETS } from "./project-ui";

interface ProjectsLayoutProps {
  page: PageModel;
  /** One section (head, rows or empty state); `headless` inside the tabs, where the tab names it. */
  renderSection: (target: CreateTarget, opts: { headless: boolean }) => ReactNode;
  renderCard: (card: CardModel) => ReactNode;
  /** Signed out with no projects: the first-visit block. */
  firstRun: ReactNode;
}

/**
 * Explore — the public example project(s), for everyone, signed in or out. No
 * create controls: nothing can be created here. Expressive makes it an
 * invitation (a plum stage saying what it is for); Calm a slim strip.
 */
export function ExploreSection({ items, renderCard }: { items: CardModel[]; renderCard: (card: CardModel) => ReactNode }) {
  const look = useContext(ProjectsLook);
  if (items.length === 0) return null;
  const invite = look === "expressive";
  return (
    <section
      data-projects-section="explore"
      data-pj-explore={invite ? "invite" : "strip"}
      data-pj-hue="plum"
      className={`pj-explore ${FONT}`}
    >
      <div className="pj-explore-head">
        <KindMark kind="explore" size={invite ? "xl" : "m"} />
        <div className="pj-explore-text">
          <h2 className="pj-explore-title">
            Explore
            <span className="pj-sechead-count">{items.length}</span>
          </h2>
          <p className="pj-explore-blurb">
            {invite
              ? "Public example projects. Open one to see what a full map looks like — there is nothing to create."
              : "Public examples — open one to look around."}
          </p>
        </div>
      </div>
      <div data-projects-grid="" data-projects-target="explore" className="pj-explore-grid">
        {items.map(renderCard)}
      </div>
    </section>
  );
}

/** Signed out: there is only Lokal — its rows, or the first visit — then Explore. */
function SignedOutBody({ page, renderCard, firstRun }: ProjectsLayoutProps) {
  const items = page.sections[0]?.items ?? [];
  return (
    <>
      {items.length === 0 ? (
        firstRun
      ) : (
        <div data-projects-grid="" data-projects-target="lokal">
          {items.map(renderCard)}
        </div>
      )}
      <ExploreSection items={page.explore} renderCard={renderCard} />
    </>
  );
}

/** The tab that opens first: the first kind with a project in it, else Hosted. */
function firstKind(page: PageModel): CreateTarget {
  return page.sections.find((s) => s.items.length > 0)?.target ?? "hosted";
}

/**
 * Expressive: the kinds as TABS — one kind at a time, its count on the tab,
 * and ONE create entry (the "New project" door, which asks where it should
 * live). An empty tab's own empty state says what the kind is.
 */
function KindTabs(props: ProjectsLayoutProps) {
  const { page, renderSection, renderCard } = props;
  const [picked, setPicked] = useState<CreateTarget | null>(null);
  const uid = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  if (!page.signedIn) return <SignedOutBody {...props} />;
  const active = picked ?? firstKind(page);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TARGETS.indexOf(active);
    const next = e.key === "ArrowRight" ? TARGETS[(i + 1) % 3] : e.key === "ArrowLeft" ? TARGETS[(i + 2) % 3] : null;
    if (!next) return;
    e.preventDefault();
    setPicked(next);
    refs.current[next]?.focus();
  };

  return (
    <>
      <div className="pj-tabbar">
        <div role="tablist" aria-label="Kinds of project" className="pj-tablist">
          {page.sections.map((s) => {
            const on = s.target === active;
            return (
              <button
                key={s.target}
                ref={(el) => {
                  refs.current[s.target] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${s.target}`}
                aria-selected={on}
                aria-controls={`${uid}-panel`}
                tabIndex={on ? 0 : -1}
                data-pj-hue={KINDS[s.target].hue}
                className="pj-tab"
                onClick={() => setPicked(s.target)}
                onKeyDown={onKey}
              >
                <KindMark kind={s.target} size="s" />
                <span className="pj-tab-label">{s.title}</span>
                <span className="pj-tab-count">{s.items.length}</span>
              </button>
            );
          })}
        </div>
        <Door page={page} />
      </div>
      <div
        role="tabpanel"
        id={`${uid}-panel`}
        aria-labelledby={`${uid}-tab-${active}`}
        className="pj-tabpanel"
        data-pj-hue={KINDS[active].hue}
      >
        {renderSection(active, { headless: true })}
      </div>
      <ExploreSection items={page.explore} renderCard={renderCard} />
    </>
  );
}

/** Calm: the kinds stacked, each under its own head with its own round plus. */
function KindStack(props: ProjectsLayoutProps) {
  const { page, renderSection, renderCard } = props;
  if (!page.signedIn) return <SignedOutBody {...props} />;
  return (
    <>
      {TARGETS.map((t) => renderSection(t, { headless: false }))}
      <ExploreSection items={page.explore} renderCard={renderCard} />
    </>
  );
}

/**
 * How the sections are arranged, by look. The two differ in STRUCTURE (tabs
 * vs stacked sections), so both render and the stylesheet shows one per
 * `data-panel-look` — that attribute is set before first paint; a look read
 * in React is not, and the wrong structure would flash in. The Calm subtree
 * tells the pieces inside it which look they are in (`ProjectsLook`).
 */
export function ProjectsLayout(props: ProjectsLayoutProps) {
  return (
    <>
      <div data-pj-look="expressive">
        <div className={`pj-layout ${FONT}`} data-pj-layout="tabs">
          <KindTabs {...props} />
        </div>
      </div>
      <div data-pj-look="calm">
        <ProjectsLook.Provider value="calm">
          <div className={`pj-layout ${FONT}`} data-pj-layout="stack">
            <KindStack {...props} />
          </div>
        </ProjectsLook.Provider>
      </div>
    </>
  );
}
