"use client";

/**
 * The directory's Mapping view: what does the product promise, journey by journey?
 *
 *   - the Ribbon: the whole product as one bar — a piece per journey, in the rail's
 *     order, sized by weight and filled by the share kept; the two honest shelves
 *     dashed at the end. Every piece is a jump. A journey nobody promised anything
 *     on is named in the caption, not drawn as a sliver.
 *   - the Atlas: a pinned index rail that tracks the scroll, sub-flows nested, beside
 *     the body — every journey (as a route of stops) and the two shelves.
 *
 * Going to a journey is a scroll to its anchor. `?mj=` names the one to land on, so
 * Contents can open a chapter here and a link can point at it.
 *
 * Styles: app/m3/acceptances-mapping.css (`ka-mapping-`).
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { CircleDashedIcon } from "lucide-react";
import type { Node } from "@/lib/data/types";
import type { Journey, JourneyScreen, MappingModel, PromiseModel } from "@/lib/utils/acceptances-model";
import {
  JourneyAnchor,
  MAPPING_FONT,
  OUTSIDE_KEY,
  SizeBySwitch,
  UNANCHORED_KEY,
  WeightBar,
  anchorId,
  journeyAria,
  journeyStats,
  journeyTree,
  jumpTo,
  plural,
  sizeRatio,
  useNav,
  useScrollSpy,
} from "./journey-kit";
import { MappingJourney } from "./MappingJourney";
import { MappingPromise } from "./MappingPromise";
import { OutsideShelf, UnanchoredShelf } from "./MappingShelves";

export interface MappingViewProps {
  mapping: MappingModel;
  onSelect: (node: Node) => void;
  isCollapsed: (key: string) => boolean;
  onToggleJourney: (key: string) => void;
}

// ── Ribbon: the product as one bar ──────────────────────────────────────────

function Ribbon({ mapping }: { mapping: MappingModel }) {
  const { sizeBy } = useNav();
  const [hot, setHot] = useState<string | null>(null);
  // The rail's and the body's order (the journey tree), so a piece is found where the eye left it.
  // A journey with no promise has no weight: it is named in the caption, not drawn as a sliver.
  const ordered = useMemo(() => journeyTree(mapping).filter((r) => !r.repeat).map((r) => r.journey), [mapping]);
  if (mapping.empty) return null;
  const drawn = ordered.filter((j) => j.promises.length > 0);
  const hollow = ordered.filter((j) => j.promises.length === 0);
  const hotJourney = mapping.journeys.find((j) => j.id === hot);
  const caption = hotJourney
    ? `${hotJourney.title} — ${plural(hotJourney.promises.length, "promise")}, ${journeyStats(hotJourney).kept} kept everywhere${hotJourney.gaps > 0 ? `, ${plural(hotJourney.gaps, "gap")}` : ""}`
    : hot === OUTSIDE_KEY
      ? `Outside any journey — ${plural(mapping.totals.outside, "promise")} on screens no journey holds`
      : hot === UNANCHORED_KEY
        ? `Unanchored — ${plural(mapping.unanchored.length, "promise")} that cover nothing yet`
        : `${plural(drawn.length, "journey")} · tap a piece to go there${hollow.length ? ` · ${hollow.map((j) => j.title).join(", ")} ${hollow.length === 1 ? "promises" : "promise"} nothing yet` : ""}`;
  // ×10 so a row of small pieces still sums past 1 and fills its line (grow below 1 leaves space).
  const shelfGrow = (n: number) => (sizeBy === "count" && mapping.maxPromises > 0 ? n / mapping.maxPromises : 0.15) * 10;
  const hover = (key: string) => ({
    onMouseEnter: () => setHot(key),
    onMouseLeave: () => setHot(null),
    onFocus: () => setHot(key),
    onBlur: () => setHot(null),
  });
  return (
    <section className={`${MAPPING_FONT} ka-mapping-scope ka-mapping-ribbon`} aria-label="What the product promises">
      <div className="ka-mapping-ribbon-top">
        <h2 className="ka-mapping-ribbon-title ka-mapping-display">
          <span className="ka-mapping-ribbon-big">{mapping.totals.promises}</span> promises, journey by journey
        </h2>
        <SizeBySwitch mapping={mapping} />
      </div>
      <div className="ka-mapping-ribbon-bar" role="group" aria-label="Journeys, sized by weight">
        {drawn.map((j) => {
          const st = journeyStats(j);
          const kept = st.total ? (st.kept / st.total) * 100 : 0;
          const gap = st.total ? (st.gaps / st.total) * 100 : 0;
          return (
            <button
              key={j.id}
              type="button"
              className="ka-mapping-ribbon-seg ka-mapping-focusable"
              style={{ "--ka-mapping-grow": Math.max(sizeRatio(j, mapping, sizeBy), 0.02) * 10, "--ka-mapping-kept": `${kept}%`, "--ka-mapping-gapped": `${kept + gap}%` } as CSSProperties}
              data-gap={j.gaps > 0 ? "" : undefined}
              aria-label={journeyAria(j)}
              onClick={() => jumpTo(j.id)}
              {...hover(j.id)}
            >
              <span className="ka-mapping-ribbon-name">{j.title}</span>
              <b className="ka-mapping-num">{j.promises.length}</b>
            </button>
          );
        })}
        {mapping.outside.length > 0 && (
          <button
            type="button"
            className="ka-mapping-ribbon-seg ka-mapping-focusable"
            data-shelf=""
            style={{ "--ka-mapping-grow": shelfGrow(mapping.totals.outside) } as CSSProperties}
            aria-label={`Outside any journey: ${plural(mapping.totals.outside, "promise")}`}
            onClick={() => jumpTo(OUTSIDE_KEY)}
            {...hover(OUTSIDE_KEY)}
          >
            <span className="ka-mapping-ribbon-name">Outside any journey</span>
            <b className="ka-mapping-num">{mapping.totals.outside}</b>
          </button>
        )}
        {mapping.unanchored.length > 0 && (
          <button
            type="button"
            className="ka-mapping-ribbon-seg ka-mapping-focusable"
            data-shelf=""
            style={{ "--ka-mapping-grow": shelfGrow(mapping.unanchored.length) } as CSSProperties}
            aria-label={`Unanchored: ${plural(mapping.unanchored.length, "promise")}`}
            onClick={() => jumpTo(UNANCHORED_KEY)}
            {...hover(UNANCHORED_KEY)}
          >
            <span className="ka-mapping-ribbon-name">Unanchored</span>
            <b className="ka-mapping-num">{mapping.unanchored.length}</b>
          </button>
        )}
      </div>
      <p className="ka-mapping-ribbon-caption" aria-live="polite">
        {caption}
      </p>
      <p className="ka-mapping-ribbon-key">
        <i data-k="kept" /> kept everywhere <i data-k="gap" /> a platform behind <i data-k="rest" /> not live yet <i data-k="shelf" /> not held by a journey
      </p>
    </section>
  );
}

// ── Atlas: a rail that follows you, the body beside it ──────────────────────

function Empty({ mapping }: { mapping: MappingModel }) {
  return (
    <div className={`${MAPPING_FONT} ka-mapping-scope ka-mapping-empty`}>
      <span className="ka-mapping-display">Nothing to map</span>
      <p>{mapping.emptyMessage}</p>
    </div>
  );
}

function Atlas({ mapping, onSelect, isCollapsed, onToggleJourney }: MappingViewProps) {
  useScrollSpy();
  const { current, sizeBy } = useNav();
  const rows = useMemo(() => journeyTree(mapping), [mapping]);
  if (mapping.empty) return <Empty mapping={mapping} />;

  /** Open a journey if it is folded, then bring it into view. */
  const openAndJump = (key: string) => {
    if (isCollapsed(key)) onToggleJourney(key);
    requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(key)));
  };
  const renderPromise = (promise: PromiseModel, spot?: { journey?: Journey; screen?: JourneyScreen }) => (
    <MappingPromise promise={promise} onSelect={onSelect} {...spot} />
  );
  const shelfItem = (key: string, label: string, count: number): ReactNode => (
    <li key={key}>
      <button type="button" className="ka-mapping-rail-item ka-mapping-focusable" data-kind="shelf" aria-current={current === key ? "location" : undefined} onClick={() => openAndJump(key)}>
        <CircleDashedIcon aria-hidden="true" />
        <span className="ka-mapping-rail-name">{label}</span>
        <b className="ka-mapping-num">{count}</b>
      </button>
    </li>
  );
  return (
    <div className={`${MAPPING_FONT} ka-mapping-scope ka-mapping-atlas`}>
      <div className="ka-mapping-atlas-grid">
        <nav className="ka-mapping-rail" aria-label="Journeys">
          <div className="ka-mapping-rail-head">
            <span className="ka-mapping-display">Journeys</span>
            <b className="ka-mapping-num">{mapping.journeys.length}</b>
          </div>
          <ul className="ka-mapping-rail-list">
            {rows.map((r) => (
              <li
                key={`${r.journey.id}-${r.repeat ? "r" : "o"}`}
                data-depth={Math.min(r.depth, 3)}
                data-repeat={r.repeat ? "" : undefined}
                data-empty={r.journey.promises.length === 0 ? "" : undefined}
              >
                <button
                  type="button"
                  className="ka-mapping-rail-item ka-mapping-focusable"
                  data-kind="journey"
                  aria-current={current === r.journey.id ? "location" : undefined}
                  aria-label={journeyAria(r.journey)}
                  onClick={() => openAndJump(r.journey.id)}
                >
                  <i className="ka-mapping-rail-dot" data-gap={r.journey.gaps > 0 ? "" : undefined} aria-hidden="true" />
                  <span className="ka-mapping-rail-name">{r.journey.title}</span>
                  <b className="ka-mapping-num">{r.journey.promises.length}</b>
                  <span className="ka-mapping-rail-bar" aria-hidden="true">
                    <WeightBar journey={r.journey} mapping={mapping} by={sizeBy} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {(mapping.outside.length > 0 || mapping.unanchored.length > 0) && (
            <ul className="ka-mapping-rail-list ka-mapping-rail-shelves" aria-label="Shelves">
              {mapping.outside.length > 0 && shelfItem(OUTSIDE_KEY, "Outside any journey", mapping.totals.outside)}
              {mapping.unanchored.length > 0 && shelfItem(UNANCHORED_KEY, "Unanchored", mapping.unanchored.length)}
            </ul>
          )}
          <SizeBySwitch mapping={mapping} className="ka-mapping-rail-size" />
        </nav>
        <div className="ka-mapping-atlas-body">
          {rows
            .filter((r) => !r.repeat)
            .map((r) => (
              <JourneyAnchor key={r.journey.id} id={r.journey.id} label={r.journey.title}>
                <MappingJourney
                  journey={r.journey}
                  mapping={mapping}
                  collapsed={isCollapsed(r.journey.id)}
                  onToggle={() => onToggleJourney(r.journey.id)}
                  renderPromise={(p, o) => renderPromise(p, { journey: r.journey, screen: o?.screen })}
                />
              </JourneyAnchor>
            ))}
          {mapping.outside.length > 0 && (
            <JourneyAnchor id={OUTSIDE_KEY} label="Outside any journey">
              <OutsideShelf mapping={mapping} renderPromise={renderPromise} collapsed={isCollapsed(OUTSIDE_KEY)} onToggle={() => onToggleJourney(OUTSIDE_KEY)} />
            </JourneyAnchor>
          )}
          {mapping.unanchored.length > 0 && (
            <JourneyAnchor id={UNANCHORED_KEY} label="Unanchored">
              <UnanchoredShelf mapping={mapping} renderPromise={renderPromise} collapsed={isCollapsed(UNANCHORED_KEY)} onToggle={() => onToggleJourney(UNANCHORED_KEY)} />
            </JourneyAnchor>
          )}
        </div>
      </div>
    </div>
  );
}

export function MappingView(props: MappingViewProps) {
  // `?mj=` names the journey (or shelf) to land on: scroll to it once it is drawn.
  const target = useSearchParams().get("mj");
  useEffect(() => {
    if (!target) return;
    let frames = 0;
    let frame = 0;
    const tick = () => {
      if (document.getElementById(anchorId(target))) jumpTo(target);
      else if (frames++ < 90) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return (
    <>
      <Ribbon mapping={props.mapping} />
      <Atlas {...props} />
    </>
  );
}
