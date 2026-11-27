"use client";

/**
 * The Value view's kit: the small vocabulary every part of it draws from.
 * Nothing here derives a rule: `PromiseModel` / `ValueModel` / `PromiseWeighing`
 * (lib/utils/acceptances-model.ts) already carry them.
 *
 * ONE GRAMMAR for the value view:
 *   - SOLID fill   = weighed: somebody scored it.
 *   - HATCHED fill = a guess: a seed (+1 per claimed value, nobody weighed it).
 *   - DASHED amber = owed: promised but not live everywhere yet.
 *   - RED          = cost. Served (green) and cost (red) are drawn in separate
 *                    bars / separate figures, never netted into one number.
 *   - A level's hue says its sign, never a platform.
 *
 * Styles: app/m3/acceptances-value.css (`ka-value-` prefix).
 */
import type { EffectiveCell, PromiseWeighing } from "@arkaik/schema";
import { AlertTriangleIcon, CircleSlashIcon, GiftIcon, OctagonAlertIcon, ScaleIcon } from "lucide-react";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import type { PromiseModel, ValueElement, ValueModel } from "@/lib/utils/acceptances-model";

const VALUE_LABEL = new Map<string, string>(VALUES.map((v) => [v.id, v.label]));
export const valueLabel = (id: string): string => VALUE_LABEL.get(id) ?? id;

const TIERS = VALUE_TIERS_CONFIG.map((t) => ({ id: t.id as string, label: t.label as string }));

/** One decimal, no trailing zero. */
export const fmt = (n: number): string => (Math.round(n * 10) / 10).toString();
export const pct = (share: number): string => `${Math.round(share * 100)}%`;
/** A level as a person reads it: a real minus, an explicit plus. */
const signed = (level: number): string => (level > 0 ? `+${level}` : level < 0 ? `−${-level}` : "0");

export function cellOf(promise: PromiseModel, elementId: string | undefined): EffectiveCell | undefined {
  return elementId === undefined ? undefined : promise.weighing?.cells.find((c) => c.criterion === elementId);
}

/** Who scored a cell, in a word. */
function whoOf(cell: EffectiveCell): "guess" | "person" | "agent" {
  return cell.source === "seed" ? "guess" : cell.scorer.kind === "human" ? "person" : "agent";
}
export const whoWords = (cell: EffectiveCell): string =>
  cell.source === "seed" ? "a guess" : cell.scorer.kind === "human" ? "a person" : "an agent";

// ── flags ───────────────────────────────────────────────────────────────────

export type FlagKind = "unclaimed-cost" | "contradicted" | "unsupported" | "review" | "unclaimed-value";
export interface PromiseFlag {
  kind: FlagKind;
  ids: string[];
}

export const FLAG_COPY: Record<FlagKind, { label: string; tone: "cost" | "owed" | "review" | "served"; sentence: (names: string) => string }> = {
  "unclaimed-cost": {
    label: "Unclaimed cost",
    tone: "cost",
    sentence: (n) => `It costs ${n}, and nobody said it would.`,
  },
  contradicted: {
    label: "Claim contradicted",
    tone: "cost",
    sentence: (n) => `It claims ${n}, yet it costs it.`,
  },
  unsupported: {
    label: "Claim not supported",
    tone: "owed",
    sentence: (n) => `It claims ${n}, but weighed against the promise, it is unrelated.`,
  },
  review: {
    label: "Review",
    tone: "review",
    sentence: (n) => `A person and an agent read ${n} differently.`,
  },
  "unclaimed-value": {
    label: "Unclaimed value",
    tone: "served",
    sentence: (n) => `It also serves ${n}, and never says so.`,
  },
};
const FLAG_ORDER: FlagKind[] = ["unclaimed-cost", "contradicted", "unsupported", "review", "unclaimed-value"];

export function flagsOf(promise: PromiseModel): PromiseFlag[] {
  const w: PromiseWeighing | null | undefined = promise.weighing;
  if (!w) return [];
  const by: Record<FlagKind, string[]> = {
    "unclaimed-cost": w.flags.unclaimed_cost,
    contradicted: w.flags.claim_contradicted,
    unsupported: w.flags.claim_not_supported,
    review: w.review,
    "unclaimed-value": w.flags.unclaimed_value,
  };
  return FLAG_ORDER.filter((k) => by[k].length > 0).map((kind) => ({ kind, ids: by[kind] }));
}
export const namesOf = (ids: string[]): string => ids.map(valueLabel).join(", ");

export function FlagIcon({ kind, className }: { kind: FlagKind; className?: string }) {
  const props = { className: className ?? "size-3.5", "aria-hidden": true as const };
  if (kind === "unclaimed-cost") return <OctagonAlertIcon {...props} />;
  if (kind === "contradicted") return <AlertTriangleIcon {...props} />;
  if (kind === "unsupported") return <CircleSlashIcon {...props} />;
  if (kind === "review") return <ScaleIcon {...props} />;
  return <GiftIcon {...props} />;
}

// ── marks of weight ─────────────────────────────────────────────────────────

/**
 * A bar: the solid part is weighed, the hatched part a guess, an optional
 * dashed tail is what is still owed. `max` is the full track.
 */
export function Meter({
  value,
  owed = 0,
  max,
  guess = 0,
  tone = "served",
  size = "md",
}: {
  value: number;
  owed?: number;
  max: number;
  /** 0–1: the share of `value` that rests on guesses. */
  guess?: number;
  tone?: "served" | "cost";
  size?: "sm" | "md";
}) {
  const w = (n: number) => (max <= 0 ? 0 : Math.max(0, Math.min(100, (n / max) * 100)));
  const g = Math.max(0, Math.min(1, guess));
  return (
    <span className="ka-value-meter" data-vt={tone} data-size={size} aria-hidden="true">
      {value > 0 && (
        <span className="ka-value-meter-fill" style={{ flexBasis: `${w(value)}%` }}>
          {g < 1 && <span className="ka-value-meter-solid" style={{ flexBasis: `${(1 - g) * 100}%` }} />}
          {g > 0 && <span className="ka-value-meter-guess" style={{ flexBasis: `${g * 100}%` }} />}
        </span>
      )}
      {owed > 0 && <span className="ka-value-meter-owed" style={{ flexBasis: `${w(owed)}%` }} />}
    </span>
  );
}

/** "54% guessed", as a small hatched-swatch caption. Hollow = guess. */
export function GuessTag({ share }: { share: number }) {
  if (share <= 0) return <span className="ka-value-guesstag" data-weighed="true">all weighed</span>;
  return (
    <span className="ka-value-guesstag" title="Hatched = a guess: +1 per claimed value, nobody weighed it.">
      <span className="ka-value-swatch" aria-hidden="true" />
      {pct(share)} guessed
    </span>
  );
}

/** A level as a coloured pill: hue = sign, hatched = guess, ring = a person scored it. */
export function LevelPill({ cell }: { cell: EffectiveCell }) {
  return (
    <span
      className="ka-value-level"
      data-sign={cell.level > 0 ? "plus" : cell.level < 0 ? "minus" : "zero"}
      data-who={whoOf(cell)}
      data-size="sm"
      title={`${valueLabel(cell.criterion)} ${signed(cell.level)} — ${whoWords(cell)}`}
    >
      <span className="ka-value-level-n">{signed(cell.level)}</span>
    </span>
  );
}

/** The one-line, plain-words honesty statement for a promise. */
export function promiseVerdict(p: PromiseModel): string {
  const w = p.weighing;
  if (!w) return "No value matrix.";
  if (p.unweighed) return "Only guessed: nobody has weighed this promise.";
  const cells = w.cells.filter((c) => c.source === "stored").length;
  return `${cells} element${cells === 1 ? "" : "s"} weighed${w.guesswork.served > 0 ? `, ${pct(w.guesswork.served)} of what it serves still a guess` : ""}.`;
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="ka-value-empty" role="status">
      <span className="ka-value-empty-mark" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

/** The promises behind an element, strongest first: those that serve it and those that cost it. */
export function elementPromises(element: ValueElement): { serving: PromiseModel[]; costing: PromiseModel[] } {
  const level = (p: PromiseModel) => Math.abs(p.weighing?.cells.find((c) => c.criterion === element.id)?.level ?? 0);
  return {
    serving: [...element.serving].sort((a, b) => level(b) - level(a)),
    costing: [...element.costing].sort((a, b) => level(b) - level(a)),
  };
}

// ── tiers ───────────────────────────────────────────────────────────────────

export interface Tier {
  id: string;
  label: string;
  promised: number;
  kept: number;
  owed: number;
  cost: number;
  /** 0–1: the share of what is promised that rests on guesses. */
  guess: number;
}

/** The Bain tiers, in the model's order, each summing its elements' mass. */
export function tiersOf(value: ValueModel): Tier[] {
  return TIERS.map((t) => {
    const elements = value.elements.filter((e) => e.tier === t.id);
    const promised = elements.reduce((n, e) => n + e.mass.promised, 0);
    const kept = elements.reduce((n, e) => n + e.mass.kept, 0);
    const cost = elements.reduce((n, e) => n + e.mass.cost, 0);
    const guessMass = elements.reduce((n, e) => n + e.mass.promised * e.mass.guesswork.promised, 0);
    return {
      id: t.id,
      label: t.label,
      promised,
      kept,
      owed: Math.max(0, promised - kept),
      cost,
      guess: promised > 0 ? guessMass / promised : 0,
    };
  });
}
