"use client";

/**
 * One journey, as a route: a heading that says where it sits (the "part of" trail,
 * each parent a jump), how big it is (the weight bar, sized by whatever the size
 * switch says) and what is wrong (gaps in amber); under it a numbered stop per
 * screen along a spine, empty stops hollow. The stop's bubble is its place on the
 * route; how many promises it holds sits by its name. The heading pins under the
 * toolbar while the journey is open, so a long journey never loses its name.
 *
 * Styles: app/m3/acceptances-mapping.css (`ka-mapping-j`, `ka-mapping-spine`).
 */
import type { ReactNode } from "react";
import { ChevronDownIcon, CornerLeftUpIcon, NetworkIcon } from "lucide-react";
import { ExpressiveShape } from "@/components/arkademy/ExpressiveShape";
import type { Journey, JourneyScreen, MappingModel } from "@/lib/utils/acceptances-model";
import { MAPPING_FONT, WeightBar, anchorId, jumpTo, journeyStats, parentsOf, plural, sizeLabel, useNav } from "./journey-kit";

function Seal() {
  return (
    <span className="ka-mapping-seal" aria-hidden="true">
      <ExpressiveShape shape="cookie12" className="ka-mapping-seal-shape" />
      <NetworkIcon className="ka-mapping-seal-icon" />
    </span>
  );
}

/** "Part of X" — a way back up, one jump per parent. */
function PartOf({ journey, mapping }: { journey: Journey; mapping: MappingModel }) {
  const parents = parentsOf(mapping, journey);
  if (parents.length === 0) return null;
  return (
    <span className="ka-mapping-partof">
      <CornerLeftUpIcon aria-hidden="true" />
      <span>Part of</span>
      {parents.map((p) => (
        <a
          key={p.id}
          href={`#${anchorId(p.id)}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            jumpTo(p.id);
          }}
        >
          {p.title}
        </a>
      ))}
    </span>
  );
}

function Meta({ journey }: { journey: Journey }) {
  const s = journeyStats(journey);
  return (
    <span className="ka-mapping-meta">
      <span>{plural(s.total, "promise")}</span>
      <span>{plural(journey.screens.length, "screen")}</span>
      {s.gaps > 0 && (
        <span className="ka-mapping-meta-gap" title={`${plural(s.gaps, "promise")} kept on some platforms, not all`}>
          {plural(s.gaps, "gap")}
        </span>
      )}
    </span>
  );
}

interface JourneyProps {
  journey: Journey;
  mapping: MappingModel;
  collapsed: boolean;
  onToggle: () => void;
  renderPromise: (promise: Journey["promises"][number], opts?: { screen?: JourneyScreen }) => ReactNode;
}

export function MappingJourney({ journey, mapping, collapsed, onToggle, renderPromise }: JourneyProps) {
  const { sizeBy } = useNav();
  return (
    <section
      data-ac-gap={journey.gaps > 0}
      data-open={collapsed ? undefined : ""}
      data-empty={journey.promises.length === 0 ? "" : undefined}
      data-depth={parentsOf(mapping, journey).length > 0 ? "sub" : "top"}
      className={`${MAPPING_FONT} ka-mapping-scope ka-mapping-j ka-mapping-j-spine`}
    >
      <PartOf journey={journey} mapping={mapping} />
      <h3 className="ka-mapping-j-h">
        <button type="button" className="ka-mapping-j-head ka-mapping-focusable" aria-expanded={!collapsed} onClick={onToggle}>
          <Seal />
          <span className="ka-mapping-j-main">
            <span className="ka-mapping-j-title ka-mapping-display">{journey.title}</span>
            <Meta journey={journey} />
          </span>
          <span className="ka-mapping-j-bar" title={sizeLabel(mapping, sizeBy)}>
            <WeightBar journey={journey} mapping={mapping} by={sizeBy} />
          </span>
          <ChevronDownIcon className="ka-mapping-j-chev" aria-hidden="true" />
        </button>
      </h3>
      {!collapsed && (
        <div>
          <ol className="ka-mapping-spine">
            {journey.direct.length > 0 && (
              <li className="ka-mapping-stop" data-kind="flow">
                <span className="ka-mapping-stop-node" aria-hidden="true">
                  <NetworkIcon />
                </span>
                <div className="ka-mapping-stop-body">
                  <span className="ka-mapping-stop-name">
                    The journey itself <b className="ka-mapping-stop-n">{journey.direct.length}</b>
                  </span>
                  <ul>
                    {journey.direct.map((p) => (
                      <li key={p.id}>{renderPromise(p)}</li>
                    ))}
                  </ul>
                </div>
              </li>
            )}
            {journey.screens.map((s, i) => (
              <li key={s.view.id} className="ka-mapping-stop" data-empty={s.promises.length === 0 ? "" : undefined}>
                <span className="ka-mapping-stop-node ka-mapping-display" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="ka-mapping-stop-body">
                  <span className="ka-mapping-stop-name">
                    <span className="sr-only">Stop {i + 1}: </span>
                    {s.view.title}
                    {s.promises.length === 0 ? <i> · no promise yet</i> : <b className="ka-mapping-stop-n">{s.promises.length}</b>}
                  </span>
                  {s.promises.length > 0 && (
                    <ul>
                      {s.promises.map((p) => (
                        <li key={`${s.view.id}-${p.id}`}>{renderPromise(p, { screen: s })}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
