"use client";

/**
 * The Value view's body: "do we deliver the value we stand for?" A strip of the
 * four Bain tiers (each as wide as what it promises, each with its own guess
 * share), then every element of value as a two-sided row: cost to the left,
 * served to the right, never on one axis. A row opens to the promises behind it,
 * each a dense line that peeks a card on hover or focus.
 *
 * Served and cost are never netted. What rests on guesses is part of the
 * headline, not a footnote. When the project has no active value matrix the
 * view says so plainly and draws nothing else.
 *
 * Reads `ValueModel` (lib/utils/acceptances-model.ts) and derives no rule.
 * Styles: app/m3/acceptances-value.css (`ka-value-` prefix).
 */
import { useId, useState } from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";
import type { Node } from "@/lib/data/types";
import type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";
import type { PromiseModel, ValueElement, ValueModel } from "@/lib/utils/acceptances-model";
import { Toolbar } from "@/components/layout/Toolbar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ValueIcon } from "@/components/values/ValueBadge";
import { PromiseMarks } from "./kit";
import {
  Empty,
  FLAG_COPY,
  FlagIcon,
  GuessTag,
  LevelPill,
  Meter,
  cellOf,
  elementPromises,
  flagsOf,
  fmt,
  namesOf,
  pct,
  promiseVerdict,
  tiersOf,
  valueLabel,
  whoWords,
} from "./value-kit";

type Select = (node: Node) => void;

export function ValueView({ value, onSelect }: { value: ValueModel; onSelect: Select }) {
  if (!value.available || value.empty) return <Empty message={value.emptyMessage} />;
  return (
    <>
      <TierStrip value={value} />
      <ServedCost value={value} onSelect={onSelect} />
    </>
  );
}

// ── the tier strip ──────────────────────────────────────────────────────────

/** The sentence the strip ends on: how much is a guess, and how many promises anyone weighed. */
function GuessLine({ value }: { value: ValueModel }) {
  const guess = value.totals?.guesswork.promised ?? 0;
  return (
    <p className="ka-value-gl" data-value-guessline>
      <span className="ka-value-swatch" aria-hidden="true" />
      <span>
        <b>{pct(guess)}</b> of the value promised is a guess: only <b>{value.promises.length - value.unweighed}</b> of {value.promises.length} promises
        were weighed by someone.
      </span>
    </p>
  );
}

function TierStrip({ value }: { value: ValueModel }) {
  const tiers = tiersOf(value).filter((t) => t.promised > 0 || t.cost > 0);
  return (
    <header className="ka-value-hero">
      <ul className="ka-value-ts-strip" aria-label="Value promised, by tier">
        {tiers.map((t) => (
          <li key={t.id} className="ka-value-ts-seg" data-tier={t.id} style={{ flexGrow: Math.max(t.promised, 4), flexBasis: 0 }}>
            <p className="ka-value-ts-name">{t.label}</p>
            <p className="ka-value-ts-fig">
              <b>{fmt(t.kept)}</b> kept of {fmt(t.promised)}
            </p>
            <Meter value={t.kept} owed={t.owed} max={t.promised} guess={t.guess} />
            <p className="ka-value-ts-foot">
              <GuessTag share={t.guess} />
              {t.cost > 0 && <span data-vt="cost">costs {fmt(t.cost)}</span>}
            </p>
          </li>
        ))}
      </ul>
      <GuessLine value={value} />
    </header>
  );
}

// ── served | cost ───────────────────────────────────────────────────────────

function ServedCost({ value, onSelect }: { value: ValueModel; onSelect: Select }) {
  return (
    <div className="ka-value-split" data-value-layout>
      <div className="ka-value-sp-legend" aria-hidden="true">
        <span data-vt="cost">◀ cost, on its own enlarged scale</span>
        <span data-vt="served">
          served: kept ▶ <i>owed dashed</i>
        </span>
      </div>
      <ul className="ka-value-sp-list">
        {value.elements.map((e) => (
          <ElementRow key={e.id} element={e} value={value} onSelect={onSelect} />
        ))}
      </ul>
      <p className="ka-value-sp-foot">The two sides share no axis on purpose: served and cost are never netted.</p>
    </div>
  );
}

function ElementRow({ element: e, value, onSelect }: { element: ValueElement; value: ValueModel; onSelect: Select }) {
  const [open, setOpen] = useState(false);
  const body = useId();
  return (
    <li className="ka-value-sp-item" data-open={open} data-owed={e.owed > 0.05}>
      <button type="button" className="ka-value-sp-row ka-value-press" aria-expanded={open} aria-controls={body} onClick={() => setOpen((v) => !v)}>
        <span className="ka-value-sp-cost" data-empty={e.mass.cost === 0}>
          <span className="ka-value-sp-n" data-k="cost">
            {e.mass.cost > 0 ? fmt(e.mass.cost) : ""}
          </span>
          <span className="ka-value-sp-bar">
            <Meter value={e.mass.cost} max={Math.max(value.maxCost, 0.01)} guess={e.mass.guesswork.cost} tone="cost" />
          </span>
        </span>
        <span className="ka-value-sp-name">
          <ValueIcon valueId={e.id} className="size-3.5 shrink-0" />
          <span>{e.label}</span>
          <ChevronDownIcon className="ka-value-sp-chev size-3.5" aria-hidden="true" />
        </span>
        <span className="ka-value-sp-served">
          <span className="ka-value-sp-bar">
            <Meter value={e.mass.kept} owed={e.owed} max={value.maxPromised} guess={e.mass.guesswork.kept} />
          </span>
          <span className="ka-value-sp-n" data-k="served">
            {fmt(e.mass.kept)}
            {e.owed > 0.05 && <i> +{fmt(e.owed)} owed</i>}
          </span>
        </span>
      </button>
      {open && <ElementPromises element={e} onSelect={onSelect} id={body} />}
    </li>
  );
}

const SHOW = 6;

/** The promises behind an element: serving first, costs apart. */
function ElementPromises({ element, onSelect, id }: { element: ValueElement; onSelect: Select; id: string }) {
  const { serving, costing } = elementPromises(element);
  const [all, setAll] = useState(false);
  const shown = all ? serving : serving.slice(0, SHOW);
  return (
    <div className="ka-value-ep" id={id}>
      {costing.length > 0 && (
        <div className="ka-value-ep-block" data-vt="cost">
          <p className="ka-value-ep-h">
            <span>Costs it</span>
            <b>{costing.length}</b>
          </p>
          <ul>
            {costing.map((p) => (
              <li key={p.id}>
                <PromiseRow promise={p} element={element} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="ka-value-ep-block" data-vt="served">
        <p className="ka-value-ep-h">
          <span>Serves it</span>
          <b>{serving.length}</b>
        </p>
        {serving.length === 0 ? (
          <p className="ka-value-ep-none">No promise serves this yet.</p>
        ) : (
          <ul>
            {shown.map((p) => (
              <li key={p.id}>
                <PromiseRow promise={p} element={element} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        )}
        {serving.length > SHOW && (
          <button type="button" className="ka-value-ep-more ka-value-press" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show ${serving.length - SHOW} more`}
          </button>
        )}
      </div>
    </div>
  );
}

// ── a promise: one dense line, and a card that peeks ────────────────────────

const unweighedTitle = "Nobody weighed this: a guess, +1 per claimed value.";

function PromiseRow({ promise, element, onSelect }: { promise: PromiseModel; element: ValueElement; onSelect: Select }) {
  const w = promise.weighing;
  const flags = flagsOf(promise);
  const cell = cellOf(promise, element.id);
  const tone = flags.find((f) => f.kind === "unclaimed-cost" || f.kind === "contradicted")
    ? "cost"
    : flags.length > 0 || promise.hasGap
      ? "owed"
      : undefined;
  const cells = [...(w?.cells ?? [])]
    .sort((a, b) => Number(b.claimed) - Number(a.claimed) || Math.abs(b.level) - Math.abs(a.level))
    .slice(0, 7);
  return (
    <HoverCard openDelay={250} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-ac-row
          data-ac-gap={promise.hasGap}
          data-ac-status={promise.status}
          data-value-flagged={flags.length > 0}
          onClick={() => onSelect(promise.node)}
          className="ka-value-pp ka-value-press-row"
        >
          <span className="ka-value-pp-dot" data-vt={tone} data-on={tone !== undefined} aria-hidden="true" />
          <span className="ka-value-pp-title">{promise.title}</span>
          {cell && <LevelPill cell={cell} />}
          {w && (
            <span className="ka-value-pp-n" title={promise.unweighed ? unweighedTitle : undefined}>
              <span data-k="served">{fmt(w.served)}</span>
              <span data-k="cost" data-zero={w.cost === 0}>
                {w.cost > 0 ? `−${fmt(w.cost)}` : ""}
              </span>
              {promise.unweighed && <span className="ka-value-pp-guess" aria-label="guessed" />}
            </span>
          )}
          <PromiseMarks promise={promise} size="sm" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="ka-value-pp-card">
        <p className="ka-value-pp-card-t">{promise.title}</p>
        <p className="ka-value-pp-card-v">{promiseVerdict(promise)}</p>
        {w && (
          <p className="ka-value-pp-card-f">
            <span data-vt="served">
              <b>{fmt(w.served)}</b> serves
            </span>
            <span data-vt="cost">
              <b>{fmt(w.cost)}</b> costs
            </span>
            <span>{w.kept_share === null ? "applies nowhere" : `${pct(w.kept_share)} kept`}</span>
          </p>
        )}
        {cells.length > 0 && (
          <ul className="ka-value-pp-card-cells">
            {cells.map((c) => (
              <li key={c.criterion}>
                <LevelPill cell={c} />
                <span>{valueLabel(c.criterion)}</span>
                <i>{whoWords(c)}</i>
              </li>
            ))}
          </ul>
        )}
        {flags.map((f) => (
          <p key={f.kind} className="ka-value-pp-card-flag" data-vt={FLAG_COPY[f.kind].tone}>
            <FlagIcon kind={f.kind} />
            <span>{FLAG_COPY[f.kind].sentence(namesOf(f.ids))}</span>
          </p>
        ))}
        <p className="ka-value-pp-card-hint">Click to open the promise. Levels run −3 to +3.</p>
      </HoverCardContent>
    </HoverCard>
  );
}

// ── the element lens ────────────────────────────────────────────────────────

/**
 * A toolbar strip, shown on the Value view only: look at one element of value
 * (`filters.value`). The elements with the most owed lead, so the strip starts
 * with the gaps; the chosen one is always present. Renders nothing when the
 * project has no active value matrix.
 */
export function ValueLens({
  value,
  filters,
  onFiltersChange,
}: {
  value: ValueModel;
  filters: AcceptanceFilters;
  onFiltersChange: (next: AcceptanceFilters) => void;
}) {
  if (!value.available) return null;
  const chosen = filters.value === "all" ? undefined : filters.value;
  const ranked = [...value.elements].sort((a, b) => b.owed - a.owed || b.mass.promised - a.mass.promised);
  const strip = ranked.slice(0, 12);
  if (chosen && !strip.some((e) => e.id === chosen)) {
    const picked = value.elements.find((e) => e.id === chosen);
    if (picked) strip.unshift(picked);
  }
  return (
    <Toolbar>
      <div className="ka-value-lens" role="group" aria-label="Look at one element of value">
        <span className="ka-value-lens-k">Look at</span>
        <div className="ka-value-lens-row">
          {strip.map((e) => (
            <button
              key={e.id}
              type="button"
              className="ka-value-lens-chip ka-value-press"
              data-owed={e.owed > 0.05}
              aria-pressed={chosen === e.id}
              title={`${e.label}: ${fmt(e.mass.kept)} kept of ${fmt(e.mass.promised)} promised${e.owed > 0.05 ? `, ${fmt(e.owed)} owed` : ""}`}
              onClick={() => onFiltersChange({ ...filters, value: chosen === e.id ? "all" : e.id })}
            >
              <ValueIcon valueId={e.id} className="size-3.5 shrink-0" />
              <span>{e.label}</span>
              {e.owed > 0.05 && <b>{fmt(e.owed)}</b>}
              {chosen === e.id && <XIcon className="size-3.5 shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    </Toolbar>
  );
}
