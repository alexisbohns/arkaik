"use client";

/**
 * The acceptances grammar — every acceptances surface (the directory, the Parity
 * monitor, the acceptance panel) draws a promise's standing through this file.
 * One rule: COLOUR = STATUS, PLATFORM = GLYPH, NOT APPLICABLE = ABSENCE.
 *
 *   - a mark is the platform glyph over a thin level bar; the bar fills to how far
 *     along the status is, and takes the status's tone;
 *   - on a single-platform project there is no platform to name, so the glyph is
 *     the status's own icon;
 *   - "not applicable" is a short dotted line in the mark's footprint: never a ring,
 *     never an empty outline, so it cannot be read as a gap.
 *
 * Styles: app/m3/acceptances.css (`ka-` prefix).
 */
import type { CSSProperties, ReactNode } from "react";
import type { StatusId } from "@arkaik/schema";
import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_ICONS, STATUS_LABELS } from "@/components/graph/nodes/node-styles";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { PromiseMark, PromiseModel } from "@/lib/utils/acceptances-model";

export type MarkSize = "sm" | "md" | "lg";

/** How far along a status is: what a mark fills to. Never a score, only a position on the lifecycle. */
export const PROGRESS: Record<StatusId, number> = {
  idea: 0.06,
  discovery: 0.16,
  backlog: 0.3,
  development: 0.55,
  releasing: 0.8,
  live: 1,
  archived: 0,
};

export type Phase = "kept" | "motion" | "wait" | "off";
export function phaseOf(status: StatusId | undefined): Phase | "na" {
  if (!status) return "na";
  if (status === "live") return "kept";
  if (status === "releasing" || status === "development") return "motion";
  if (status === "archived") return "off";
  return "wait";
}

export const statusWord = (s: StatusId | undefined) => (s ? STATUS_LABELS[s] : "Not applicable");
export const platformWord = (p: PlatformId | null) => (p ? PLATFORM_LABELS[p] : null);

/** Words for a mark, for assistive tech and tooltips: "iOS: Development", "Android: not applicable". */
export function markLabel(m: PromiseMark): string {
  const p = platformWord(m.platform);
  if (!m.status) return p ? `${p}: not applicable` : "Not applicable";
  return p ? `${p}: ${STATUS_LABELS[m.status]}` : STATUS_LABELS[m.status];
}

function Glyph({ mark }: { mark: PromiseMark }) {
  const Icon = mark.platform ? PLATFORM_ICONS[mark.platform] : mark.status ? STATUS_ICONS[mark.status] : null;
  return Icon ? <Icon aria-hidden="true" className="ka-parity-glyph" /> : null;
}

/** One mark: the glyph over its level bar. `size` sm 20 · md 28 · lg 40. */
export function PromiseMarkGlyph({ mark, size }: { mark: PromiseMark; size: MarkSize }) {
  const label = markLabel(mark);
  if (!mark.status) {
    return (
      <span
        data-ac-mark
        data-status="none"
        data-parity-na
        data-size={size}
        role="img"
        aria-label={label}
        title={label}
        className="ka-parity-na"
      />
    );
  }
  const status = mark.status;
  return (
    <span
      data-ac-mark
      data-status={status}
      data-phase={phaseOf(status)}
      data-size={size}
      role="img"
      aria-label={label}
      title={label}
      className="ka-parity-mk"
      style={{ "--ka-parity-p": PROGRESS[status] } as CSSProperties}
    >
      <span className="ka-parity-glyph-wrap ka-parity-glyph-solo"><Glyph mark={mark} /></span>
      <span className="ka-parity-meter" aria-hidden="true"><span className="ka-parity-meter-fill" /></span>
    </span>
  );
}

/** A promise's marks as one strip (`[data-ac-marks]`). */
export function PromiseMarks({ promise, size, vertical }: { promise: Pick<PromiseModel, "marks" | "id">; size: MarkSize; vertical?: boolean }) {
  return (
    <span className="ka-parity-marks" data-ac-marks data-size={size} data-vertical={vertical || undefined}>
      {promise.marks.map((m) => (
        <PromiseMarkGlyph key={m.platform ?? "status"} mark={m} size={size} />
      ))}
    </span>
  );
}

// ── words ───────────────────────────────────────────────────────────────────

/** The one status a gap is named by: its worst-lagging platform. */
export function worstLag(p: PromiseModel) {
  if (!p.lagging.length) return null;
  const order: StatusId[] = ["idea", "discovery", "backlog", "development", "releasing", "live", "archived"];
  return [...p.lagging].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
}

/** "iOS is in development, Android is at backlog" — the gap in plain words. */
export function lagSentence(p: PromiseModel): string {
  if (!p.lagging.length) return "";
  const word = (s: StatusId) =>
    s === "development" ? "in development" : s === "releasing" ? "releasing" : s === "archived" ? "retired" : s === "live" ? "live" : `at ${STATUS_LABELS[s].toLowerCase()}`;
  return p.lagging.map((l) => `${PLATFORM_LABELS[l.platform]} is ${word(l.status)}`).join(", ");
}

/** The anchored preview card: hover (or focus) a promise, see where it stands on every platform. */
export function PromiseCard({ promise, children, side = "top" }: { promise: PromiseModel; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  const then = /Then\s+([\s\S]*)/i.exec(promise.gherkin)?.[1]?.trim();
  return (
    <HoverCard openDelay={250} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} className="ka-parity-card" data-parity-card>
        <p className="ka-parity-card-title">{promise.title}</p>
        <p className="ka-parity-card-id">{promise.id}</p>
        <ul className="ka-parity-card-list">
          {promise.marks.map((m) => (
            <li key={m.platform ?? "status"} data-status={m.status ?? "none"} className="ka-parity-card-line">
              <PromiseMarkGlyph mark={m} size="sm" />
              <span className="ka-parity-card-plat">{platformWord(m.platform) ?? "Status"}</span>
              <span className="ka-parity-card-state">{m.status ? STATUS_LABELS[m.status] : "Does not apply"}</span>
            </li>
          ))}
        </ul>
        {promise.hasGap && <p className="ka-parity-card-gap">{lagSentence(promise)}.</p>}
        {then && <p className="ka-parity-card-then"><b>Then</b> {then.length > 140 ? `${then.slice(0, 137)}…` : then}</p>}
        <p className="ka-parity-card-hint">Click to open</p>
      </HoverCardContent>
    </HoverCard>
  );
}

// ── parity numbers, read once ───────────────────────────────────────────────

export const STATUS_STACK: StatusId[] = ["live", "releasing", "development", "backlog", "discovery", "idea", "archived"];

/** Live everywhere it applies (N/A never counts against it) and no gap. */
export const isKept = (p: PromiseModel) => !p.hasGap && p.marks.some((m) => m.status) && p.marks.every((m) => !m.status || m.status === "live");

export interface ParityStats {
  total: number;
  /** Some platforms delivered, not all. */
  gaps: number;
  /** Every applicable platform is live. */
  kept: number;
  /** Neither: nothing delivered anywhere yet, or a single platform still on its way. */
  way: number;
}

export function parityStats(parity: { promises: PromiseModel[]; totals: { promises: number; gaps: number } }): ParityStats {
  const total = parity.totals.promises;
  const kept = parity.promises.filter(isKept).length;
  const gaps = parity.totals.gaps;
  return { total, gaps, kept, way: Math.max(0, total - kept - gaps) };
}

/** Gaps first (most behind first), then on its way, then kept — the order an overview reads in. */
export function weaveOrder(promises: PromiseModel[]): PromiseModel[] {
  const rank = (p: PromiseModel) => (p.hasGap ? 0 : isKept(p) ? 2 : 1);
  return [...promises].sort((a, b) => rank(a) - rank(b) || b.lagging.length - a.lagging.length || a.title.localeCompare(b.title));
}
