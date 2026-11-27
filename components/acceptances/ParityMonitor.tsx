"use client";

/**
 * The Parity monitor's body: is each promise kept on every platform it applies to?
 * A barcode weave over every promise, then a flat list (each promise once, gaps
 * first) of dense rows that open a preview card on hover. Delivery monitoring,
 * not a directory: it lives under Project, beside Delivery.
 */
import { useMemo, useState, type CSSProperties } from "react";
import type { Node } from "@/lib/data/types";
import type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";
import type { ParityModel, PromiseModel } from "@/lib/utils/acceptances-model";
import { PLATFORM_ICONS, STATUS_LABELS } from "@/components/graph/nodes/node-styles";
import { PLATFORMS } from "@/lib/config/platforms";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import { PromiseCard, PromiseMarks, STATUS_STACK, isKept, lagSentence, markLabel, parityStats, weaveOrder } from "./kit";

const n = (x: number) => x.toLocaleString("en");

/** Every promise as a thread across platform lanes, gaps gathered first. */
function ParityWeave({ parity, onSelect }: { parity: ParityModel; onSelect: (node: Node) => void }) {
  const stats = parityStats(parity);
  const ordered = useMemo(() => weaveOrder(parity.promises), [parity.promises]);
  if (parity.totals.promises === 0) return null;
  return (
    <section className="ka-parity-hero ka-parity-weave" aria-label="Every promise on every platform, as a weave">
      <header className="ka-parity-hero-head">
        <h2 className="ka-parity-hero-title"><span className="ka-parity-num">{n(stats.gaps)}</span> gaps in {n(stats.total)} promises</h2>
        <p className="ka-parity-hero-sub">One thread per promise, one lane per platform. Gaps gather on the left. Click a thread to open it.</p>
      </header>
      <div className="ka-parity-weave-scroll" role="img" aria-label={`${stats.gaps} gaps among ${stats.total} promises; the list below says each one`}>
        <div className="ka-parity-weave-lanes" style={{ "--ka-parity-n": ordered.length } as CSSProperties}>
          {stats.gaps > 0 && (
            <div className="ka-parity-weave-lane ka-parity-weave-band" aria-hidden="true">
              <span />
              <span className="ka-parity-weave-bracket" style={{ gridColumn: `2 / span ${stats.gaps}` }}>
                <i>{stats.gaps} {stats.gaps === 1 ? "gap" : "gaps"}</i>
              </span>
            </div>
          )}
          {parity.columns.map((platform, i) => {
            const Icon = platform ? PLATFORM_ICONS[platform] : null;
            return (
              <div key={platform ?? "status"} className="ka-parity-weave-lane" data-platform={platform ?? "status"}>
                <span className="ka-parity-weave-tag" aria-hidden="true">{Icon && <Icon className="size-3" />}</span>
                {ordered.map((p) => {
                  const m = p.marks[i];
                  return (
                    <button
                      key={p.id}
                      type="button"
                      tabIndex={-1}
                      aria-hidden="true"
                      className="ka-parity-tone ka-parity-weave-tick"
                      data-status={m?.status ?? "none"}
                      data-gap={p.hasGap || undefined}
                      title={`${p.title}\n${markLabel(m)}`}
                      onClick={() => onSelect(p.node)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <ul className="ka-parity-legend" aria-hidden="true">
        {STATUS_STACK.slice(0, 6).map((s) => <li key={s} className="ka-parity-tone" data-status={s}><i />{STATUS_LABELS[s]}</li>)}
        <li className="ka-parity-legend-na"><i />Does not apply</li>
      </ul>
    </section>
  );
}

/** One 34px line: small marks, the title, the lag if there is one; the preview card on hover or focus. */
function ParityRow({ promise, onSelect }: { promise: PromiseModel; onSelect: (node: Node) => void }) {
  return (
    <PromiseCard promise={promise}>
      <button
        type="button"
        data-ac-row
        data-ac-gap={promise.hasGap}
        data-ac-status={promise.status}
        className="ka-parity-rdense ka-rdense"
        onClick={() => onSelect(promise.node)}
      >
        <PromiseMarks promise={promise} size="sm" />
        <span className="ka-parity-rdense-title">{promise.title}</span>
        {promise.hasGap && <span className="ka-parity-rdense-lag">{lagSentence(promise)}</span>}
      </button>
    </PromiseCard>
  );
}

type Cut = "all" | "gaps" | "way" | "kept";

/** No anchors, no repeats: each promise once, gaps first, with Gaps, On its way and Kept cuts. */
function ParityList({ parity, onSelect }: { parity: ParityModel; onSelect: (node: Node) => void }) {
  const [cut, setCut] = useState<Cut>("all");
  const ordered = useMemo(() => weaveOrder(parity.promises), [parity.promises]);
  if (parity.empty) {
    return (
      <div className="ka-parity-empty" role="status">
        <p className="ka-parity-empty-title">{parity.emptyMessage}</p>
        <p className="ka-parity-empty-sub">Open on purpose: clear a filter to see promises again.</p>
      </div>
    );
  }
  const stats = parityStats(parity);
  const list = ordered.filter((p) => (cut === "all" ? true : cut === "gaps" ? p.hasGap : cut === "kept" ? isKept(p) : !p.hasGap && !isKept(p)));
  const chips: { id: Cut; label: string; n: number }[] = [
    { id: "all", label: "Every promise", n: stats.total },
    { id: "gaps", label: "Gaps", n: stats.gaps },
    { id: "way", label: "On its way", n: stats.way },
    { id: "kept", label: "Kept", n: stats.kept },
  ];
  return (
    <div className="ka-parity-flat">
      <div className="ka-parity-flat-bar" role="group" aria-label="Show">
        {chips.map((c) => (
          <button key={c.id} type="button" className="ka-parity-chip" aria-pressed={cut === c.id} onClick={() => setCut(c.id)}>
            {c.label} <b>{n(c.n)}</b>
          </button>
        ))}
        <span className="ka-parity-flat-note">Each promise once, gaps first.</span>
      </div>
      <ul className="ka-parity-flat-list">{list.map((p) => <li key={p.id}>{<ParityRow promise={p} onSelect={onSelect} />}</li>)}</ul>
    </div>
  );
}

/** Quick chips above the filter bar: Gaps only with its count, and one chip per platform. */
export function ParityQuickChips({ parity, filters, onFiltersChange }: { parity: ParityModel; filters: AcceptanceFilters; onFiltersChange: (next: AcceptanceFilters) => void }) {
  const platforms = PLATFORMS.filter((p) => parity.platforms.includes(p.id));
  return (
    <Toolbar>
      <ToolbarGroup>
        <span className="ka-parity-qc" role="group" aria-label="Quick filters">
          <button type="button" className="ka-parity-chip ka-parity-qc-gaps" aria-pressed={filters.parityGap} onClick={() => onFiltersChange({ ...filters, parityGap: !filters.parityGap })}>
            Gaps only <b>{parity.totals.gaps}</b>
          </button>
          {platforms.length > 1 &&
            platforms.map((p) => {
              const Icon = PLATFORM_ICONS[p.id];
              const on = filters.platform === p.id;
              return (
                <button key={p.id} type="button" className="ka-parity-chip" aria-pressed={on} onClick={() => onFiltersChange({ ...filters, platform: on ? "all" : p.id })}>
                  <Icon className="size-3.5" aria-hidden="true" />
                  {p.label}
                </button>
              );
            })}
        </span>
      </ToolbarGroup>
    </Toolbar>
  );
}

export function ParityMonitor({ parity, onSelect }: { parity: ParityModel; onSelect: (node: Node) => void }) {
  return (
    <>
      <ParityWeave parity={parity} onSelect={onSelect} />
      <ParityList parity={parity} onSelect={onSelect} />
    </>
  );
}
