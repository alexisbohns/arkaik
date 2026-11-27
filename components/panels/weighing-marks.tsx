"use client";

/**
 * The small marks the weighing group draws with: the serves / costs bars, the
 * "guessed" caption, and the audit's flags as sentences. Nothing here derives a
 * rule — `PromiseWeighing` already carries them — it only words and draws what
 * `@arkaik/schema`'s derivation returned.
 *
 * One grammar: SOLID fill = weighed (somebody scored it); HATCHED = a guess (a
 * seed, +1 per claimed value, nobody weighed it); GREEN = served and RED =
 * cost, drawn apart and never netted into one number.
 */
import { AlertTriangleIcon, CircleSlashIcon, GiftIcon, OctagonAlertIcon, ScaleIcon } from "lucide-react";
import type { EffectiveCell, PromiseWeighing } from "@arkaik/schema";
import { VALUES } from "@/lib/config/values";

const VALUE_LABEL = new Map<string, string>(VALUES.map((v) => [v.id, v.label]));

/** One decimal, no trailing zero. */
export const fmt = (n: number): string => (Math.round(n * 10) / 10).toString();
export const pct = (share: number): string => `${Math.round(share * 100)}%`;
/** A level as a person reads it: a real minus, an explicit plus. */
export const signed = (level: number): string => (level > 0 ? `+${level}` : level < 0 ? `−${-level}` : "0");

/** Who scored a cell, in a word. */
export function whoOf(cell: EffectiveCell): "guess" | "person" | "agent" {
  return cell.source === "seed" ? "guess" : cell.scorer.kind === "human" ? "person" : "agent";
}

// ── flags ───────────────────────────────────────────────────────────────────

type FlagKind = "unclaimed-cost" | "contradicted" | "unsupported" | "review" | "unclaimed-value";

const FLAG_COPY: Record<FlagKind, { label: string; tone: "cost" | "owed" | "review" | "served"; sentence: (names: string) => string }> = {
  "unclaimed-cost": { label: "Unclaimed cost", tone: "cost", sentence: (n) => `It costs ${n}, and nobody said it would.` },
  contradicted: { label: "Claim contradicted", tone: "cost", sentence: (n) => `It claims ${n}, yet it costs it.` },
  unsupported: { label: "Claim not supported", tone: "owed", sentence: (n) => `It claims ${n}, but weighed against the promise, it is unrelated.` },
  review: { label: "Review", tone: "review", sentence: (n) => `A person and an agent read ${n} differently.` },
  "unclaimed-value": { label: "Unclaimed value", tone: "served", sentence: (n) => `It also serves ${n}, and never says so.` },
};

const namesOf = (ids: string[]): string => ids.map((id) => VALUE_LABEL.get(id) ?? id).join(", ");

function FlagIcon({ kind }: { kind: FlagKind }) {
  const props = { className: "size-4", "aria-hidden": true as const };
  if (kind === "unclaimed-cost") return <OctagonAlertIcon {...props} />;
  if (kind === "contradicted") return <AlertTriangleIcon {...props} />;
  if (kind === "unsupported") return <CircleSlashIcon {...props} />;
  if (kind === "review") return <ScaleIcon {...props} />;
  return <GiftIcon {...props} />;
}

/** The audit's finds, worst first, each in a sentence. Nothing when the weighing has none. */
export function FlagSentences({ weighing: w }: { weighing: PromiseWeighing }) {
  const by: Record<FlagKind, string[]> = {
    "unclaimed-cost": w.flags.unclaimed_cost,
    contradicted: w.flags.claim_contradicted,
    unsupported: w.flags.claim_not_supported,
    review: w.review,
    "unclaimed-value": w.flags.unclaimed_value,
  };
  const flags = (Object.keys(FLAG_COPY) as FlagKind[]).filter((kind) => by[kind].length > 0);
  if (flags.length === 0) return null;
  return (
    <ul className="kap-wfl" data-weighing-flags>
      {flags.map((kind) => (
        <li key={kind} className="kap-wfl-item" data-vt={FLAG_COPY[kind].tone} data-weighing-flag={FLAG_COPY[kind].label}>
          <FlagIcon kind={kind} />
          <span>
            <b>{FLAG_COPY[kind].label}.</b> {FLAG_COPY[kind].sentence(namesOf(by[kind]))}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── bars ────────────────────────────────────────────────────────────────────

/** A bar: the solid part is weighed, the hatched part a guess. `max` is the full track. */
export function Meter({ value, max, guess = 0, tone = "served" }: { value: number; max: number; /** 0–1: the share of `value` that rests on guesses. */ guess?: number; tone?: "served" | "cost" }) {
  const share = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const g = Math.max(0, Math.min(1, guess));
  return (
    <span className="kap-meter" data-vt={tone} aria-hidden="true">
      {value > 0 && (
        <span className="kap-meter-fill" style={{ flexBasis: `${share}%` }}>
          {g < 1 && <span className="kap-meter-solid" style={{ flexBasis: `${(1 - g) * 100}%` }} />}
          {g > 0 && <span className="kap-meter-guess" style={{ flexBasis: `${g * 100}%` }} />}
        </span>
      )}
    </span>
  );
}

/** "54% guessed", as a small hatched-swatch caption. Hollow = guess. */
export function GuessTag({ share }: { share: number }) {
  if (share <= 0) return <span className="kap-guesstag" data-weighed="true">all weighed</span>;
  return (
    <span className="kap-guesstag" title="Hatched = a guess: +1 per claimed value, nobody weighed it.">
      <span className="kap-swatch" aria-hidden="true" />
      {pct(share)} guessed
    </span>
  );
}
