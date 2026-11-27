"use client";

/**
 * The two honest shelves: promises on screens no journey walks through ("Outside
 * any journey"), and promises that cover nothing yet ("Unanchored"). Both are drawn
 * with a dashed edge — open on purpose, never hidden — and fold shut so 74
 * placements do not drown the map.
 *
 * Styles: app/m3/acceptances-mapping.css (`ka-mapping-shelf`).
 */
import { ChevronDownIcon, CircleDashedIcon, MonitorSmartphoneIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { JourneyScreen, MappingModel, PromiseModel } from "@/lib/utils/acceptances-model";
import { plural } from "./journey-kit";

interface ShelfProps {
  mapping: MappingModel;
  renderPromise: (promise: PromiseModel, opts?: { screen?: JourneyScreen }) => ReactNode;
  collapsed: boolean;
  onToggle: () => void;
}

function Head({ collapsed, onToggle, children }: { collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" className="ka-mapping-shelf-head" aria-expanded={!collapsed} onClick={onToggle}>
      {children}
      <ChevronDownIcon className="ka-mapping-shelf-chev" aria-hidden="true" />
    </button>
  );
}

export function OutsideShelf({ mapping, renderPromise, collapsed, onToggle }: ShelfProps) {
  if (mapping.outside.length === 0) return null;
  const { outside } = mapping.totals;
  return (
    <section className="ka-mapping-scope ka-mapping-shelf" data-shelf="outside">
      <Head collapsed={collapsed} onToggle={onToggle}>
        <span className="ka-mapping-shelf-seal" aria-hidden="true">
          <CircleDashedIcon />
        </span>
        <span className="ka-mapping-shelf-title">
          <span className="ka-mapping-shelf-name">Outside any journey</span>
          <span className="ka-mapping-shelf-sub">
            {plural(outside, "promise")} on {plural(mapping.outside.length, "screen")} no journey walks through
          </span>
        </span>
        <span className="ka-mapping-shelf-count">{outside}</span>
      </Head>
      {!collapsed && (
        <div className="ka-mapping-shelf-body">
          {mapping.outside.map((s) => (
            <div key={s.view.id} className="ka-mapping-shelf-screen">
              <h4 className="ka-mapping-shelf-screen-name">
                <MonitorSmartphoneIcon aria-hidden="true" />
                <span>{s.view.title}</span>
                <b>{s.promises.length}</b>
              </h4>
              <ul>
                {s.promises.map((p) => (
                  <li key={`${s.view.id}-${p.id}`}>{renderPromise(p, { screen: s })}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function UnanchoredShelf({ mapping, renderPromise, collapsed, onToggle }: ShelfProps) {
  if (mapping.unanchored.length === 0) return null;
  return (
    <section className="ka-mapping-scope ka-mapping-shelf" data-shelf="unanchored">
      <Head collapsed={collapsed} onToggle={onToggle}>
        <span className="ka-mapping-shelf-seal" aria-hidden="true">
          <CircleDashedIcon />
        </span>
        <span className="ka-mapping-shelf-title">
          <span className="ka-mapping-shelf-name">Unanchored</span>
          <span className="ka-mapping-shelf-sub">{plural(mapping.unanchored.length, "promise")} that cover no screen or flow yet</span>
        </span>
        <span className="ka-mapping-shelf-count">{mapping.unanchored.length}</span>
      </Head>
      {!collapsed && (
        <div className="ka-mapping-shelf-body" data-single="">
          <ul>
            {mapping.unanchored.map((p) => (
              <li key={p.id}>{renderPromise(p)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
