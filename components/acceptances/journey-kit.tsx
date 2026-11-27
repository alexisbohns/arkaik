"use client";

/**
 * The journey kit — what the directory's views share about the product's
 * journeys: the tree (sub-flows under the journeys that reach them), the keys of
 * the two honest shelves, the DynaPuff font class every journey surface carries,
 * and the words. Contents numbers its chapters from this tree; Mapping draws
 * its ribbon and rail from it, and both go to a journey through the anchors here.
 *
 * The anchors are the contract between the ribbon, the rail and the body: the
 * layout wraps each journey (and each shelf) in `<JourneyAnchor>`, and whatever
 * wants to take the reader there calls `jumpTo`.
 *
 * Styles: app/m3/acceptances-directory.css (`ka-mapping-` tokens, `ka-contents-`)
 * and app/m3/acceptances-mapping.css (the Mapping view).
 */
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { dynaPuff } from "@/lib/font-display";
import type { AnchorRef, Journey, MappingModel } from "@/lib/utils/acceptances-model";
import { isKept } from "./kit";

/** Class that defines `--font-display` (DynaPuff) for everything inside. */
export const MAPPING_FONT = dynaPuff.variable;

/** The two honest shelves: promises on screens no journey holds, and promises that cover nothing. */
export const OUTSIDE_KEY = "__mapping-outside__";
export const UNANCHORED_KEY = "__mapping-unanchored__";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── the journey tree ────────────────────────────────────────────────────────

/** The flow ids a playlist reaches directly: flow entries, inside conditions and junction cases too. */
export function flowRefs(entries: unknown, out: string[] = []): string[] {
  if (!Array.isArray(entries)) return out;
  for (const e of entries as { type?: string; flow_id?: string; if_true?: unknown; if_false?: unknown; cases?: { entries?: unknown }[] }[]) {
    if (e.type === "flow" && e.flow_id) out.push(e.flow_id);
    else if (e.type === "condition") {
      flowRefs(e.if_true, out);
      flowRefs(e.if_false, out);
    } else if (e.type === "junction" && Array.isArray(e.cases)) for (const c of e.cases) flowRefs(c.entries, out);
  }
  return out;
}

const parentCache = new WeakMap<MappingModel, Map<string, AnchorRef[]>>();
/**
 * Child journey id → the shown journeys whose playlist reaches it directly.
 * Derived here from each flow's own playlist: `Journey.parents` reads
 * `entry.node_id` / `branches`, which no playlist entry carries (it is
 * `flow_id`, `if_true` / `if_false`, `cases`), so it comes out empty.
 */
export function parentsMap(mapping: MappingModel): Map<string, AnchorRef[]> {
  const hit = parentCache.get(mapping);
  if (hit) return hit;
  const shown = new Set(mapping.journeys.map((j) => j.id));
  const map = new Map<string, AnchorRef[]>();
  for (const j of mapping.journeys) {
    const playlist = (j.flow.metadata as { playlist?: { entries?: unknown } } | undefined)?.playlist;
    for (const id of new Set(flowRefs(playlist?.entries))) {
      if (id === j.id || !shown.has(id)) continue;
      map.set(id, [...(map.get(id) ?? []), { id: j.id, title: j.title, species: "flow" }]);
    }
  }
  parentCache.set(mapping, map);
  return map;
}
export const parentsOf = (mapping: MappingModel, j: Journey): AnchorRef[] => parentsMap(mapping).get(j.id) ?? [];

export interface TreeRow {
  journey: Journey;
  depth: number;
  /** A sub-flow reached again under a second parent: shown as a pointer, not rendered twice. */
  repeat: boolean;
  children: number;
}

/** Roots first (no shown parent), each followed by its sub-flows. A sub-flow with two parents renders under the first. */
export function journeyTree(mapping: MappingModel): TreeRow[] {
  const kids = new Map<string, Journey[]>();
  const roots: Journey[] = [];
  for (const j of mapping.journeys) {
    const parents = parentsOf(mapping, j);
    if (parents.length === 0) roots.push(j);
    for (const p of parents) kids.set(p.id, [...(kids.get(p.id) ?? []), j]);
  }
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (j: Journey, depth: number, trail: Set<string>) => {
    const repeat = seen.has(j.id);
    const children = (kids.get(j.id) ?? []).filter((c) => !trail.has(c.id));
    rows.push({ journey: j, depth, repeat, children: children.length });
    if (repeat) return;
    seen.add(j.id);
    const next = new Set(trail).add(j.id);
    for (const c of children) walk(c, depth + 1, next);
  };
  for (const r of roots) walk(r, 0, new Set());
  for (const j of mapping.journeys) if (!seen.has(j.id)) walk(j, 0, new Set());
  return rows;
}

// ── navigation store ────────────────────────────────────────────────────────

/** What a journey's size means: how many promises it holds, or the value they serve. */
export type SizeBy = "count" | "served";
interface Nav {
  /** The journey (or shelf key) the reader is looking at, from the scroll-spy. */
  current: string | null;
  sizeBy: SizeBy;
}
let nav: Nav = { current: null, sizeBy: "count" };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function emit(next: Nav) {
  nav = next;
  for (const l of listeners) l();
}
export const useNav = () => useSyncExternalStore(subscribe, () => nav, () => nav);
const setCurrent = (current: string | null) => {
  if (nav.current !== current) emit({ ...nav, current });
};
const setSizeBy = (sizeBy: SizeBy) => {
  if (nav.sizeBy !== sizeBy) emit({ ...nav, sizeBy });
};

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const anchorId = (key: string) => `mapping-j-${key}`;

/** After a jump the scroll may stop short (the page ends first): the spy keeps hands off for a moment. */
let spyLockedUntil = 0;

/** Scroll a journey (or shelf) into view and move focus there. */
export function jumpTo(key: string) {
  const el = document.getElementById(anchorId(key));
  if (!el) return;
  spyLockedUntil = Date.now() + 1500;
  setCurrent(el.dataset.mappingAnchor ?? key);
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  if (el.hasAttribute("data-mapping-anchor")) el.focus({ preventScroll: true });
}

/** The wrapper the body puts around each journey and shelf: the target of every jump. */
export function JourneyAnchor({ id, label, children }: { id: string; label?: string; children: ReactNode }) {
  return (
    <div id={anchorId(id)} data-mapping-anchor={id} data-mapping-label={label} tabIndex={-1} className="ka-mapping-anchor">
      {children}
    </div>
  );
}

function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/** Scroll-spy: the last anchor whose top has passed the pinned bars is "current". */
export function useScrollSpy(offset = 96) {
  useEffect(() => {
    const first = document.querySelector<HTMLElement>("[data-acceptances-page]");
    const scroller = scrollerOf(first?.firstElementChild as HTMLElement | null) ?? first?.parentElement ?? null;
    if (!scroller) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      if (Date.now() < spyLockedUntil) return;
      const top = scroller.getBoundingClientRect().top + offset;
      let current: string | null = null;
      for (const a of document.querySelectorAll<HTMLElement>("[data-mapping-anchor]")) {
        if (a.getBoundingClientRect().top <= top) current = a.dataset.mappingAnchor ?? null;
        else break;
      }
      setCurrent(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(scroller, { childList: true, subtree: true });
    schedule();
    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [offset]);
}

// ── sizing, honestly ────────────────────────────────────────────────────────

/** Σ served mass guessed across the shown journeys (0..1), or null with no matrix. */
function guessShare(mapping: MappingModel): number | null {
  let served = 0;
  let guessed = 0;
  for (const j of mapping.journeys) {
    if (!j.weight) return null;
    served += j.weight.served;
    guessed += j.weight.served * j.weight.guesswork;
  }
  return served === 0 ? null : guessed / served;
}

export function sizeRatio(j: Journey, mapping: MappingModel, by: SizeBy): number {
  if (by === "served") return j.weight && mapping.maxServed > 0 ? j.weight.served / mapping.maxServed : 0;
  return mapping.maxPromises > 0 ? j.promises.length / mapping.maxPromises : 0;
}

/** The sentence that says what a size means — never silent about it. */
export function sizeLabel(mapping: MappingModel, by: SizeBy): string {
  if (by === "count") return "Sized by promises";
  const g = guessShare(mapping);
  return g === null ? "Sized by served value" : `Sized by served value · ${Math.round(g * 100)}% of it guessed`;
}

export function journeyStats(j: Journey) {
  const total = j.promises.length;
  const kept = j.promises.filter(isKept).length;
  const gaps = j.gaps;
  return { total, kept, gaps, rest: Math.max(0, total - kept - gaps) };
}

export function journeyAria(j: Journey): string {
  const s = journeyStats(j);
  return `${j.title}: ${plural(s.total, "promise")}, ${s.kept} kept everywhere, ${plural(s.gaps, "gap")}`;
}

/**
 * The bar. Count mode: width = share of the longest journey, split by status
 * (kept everywhere · a platform behind · not live yet). Served mode: width =
 * share of the heaviest journey, the guessed part hatched, and the cost (never
 * netted) as its own red hairline below.
 */
export function WeightBar({ journey, mapping, by }: { journey: Journey; mapping: MappingModel; by: SizeBy }) {
  const ratio = sizeRatio(journey, mapping, by);
  const width = `${Math.max(ratio > 0 ? 4 : 0, ratio * 100)}%`;
  const s = journeyStats(journey);
  const w = journey.weight;
  return (
    <span className="ka-mapping-bar" data-by={by} role="img" aria-label={journeyAria(journey)}>
      <span className="ka-mapping-bar-track">
        <span className="ka-mapping-bar-fill" style={{ width }}>
          {by === "count" ? (
            <>
              <i className="ka-mapping-bar-kept" style={{ flexGrow: s.kept }} />
              <i className="ka-mapping-bar-gap" style={{ flexGrow: s.gaps }} />
              <i className="ka-mapping-bar-rest" style={{ flexGrow: s.rest }} />
            </>
          ) : (
            <>
              <i className="ka-mapping-bar-kept" style={{ flexGrow: 1 - (w?.guesswork ?? 1) }} />
              <i className="ka-mapping-bar-guess" style={{ flexGrow: w?.guesswork ?? 1 }} />
            </>
          )}
        </span>
      </span>
      {by === "served" && w && w.cost > 0 && (
        <span className="ka-mapping-bar-cost" style={{ width: `${Math.max(4, (w.cost / Math.max(mapping.maxServed, 0.1)) * 100)}%` }} />
      )}
    </span>
  );
}

/** Promises | Served value — what a size means, said out loud. */
export function SizeBySwitch({ mapping, className = "" }: { mapping: MappingModel; className?: string }) {
  const { sizeBy } = useNav();
  const canServe = mapping.maxServed > 0;
  return (
    <span className={`ka-mapping-sizeby ${className}`}>
      <span className="ka-mapping-sizeby-keys" role="group" aria-label="Size journeys by">
        <button type="button" aria-pressed={sizeBy === "count"} onClick={() => setSizeBy("count")}>
          Promises
        </button>
        <button type="button" aria-pressed={sizeBy === "served"} disabled={!canServe} onClick={() => setSizeBy("served")}>
          Served
        </button>
      </span>
      <span aria-live="polite">
        {sizeLabel(mapping, canServe ? sizeBy : "count")}
      </span>
    </span>
  );
}

// ── the Gherkin's Then ──────────────────────────────────────────────────────

const STEP = /\b(Given|When|Then|And|But)\b/;

/** One step per line: "When x, Then y" is two. */
function gherkinSteps(text: string): { kw: string; body: string }[] {
  return text
    .split(/\n|(?=\b(?:Given|When|Then|And|But)\b)/)
    .map((l) => l.trim().replace(/,$/, ""))
    .filter(Boolean)
    .map((line) => {
      const m = line.match(new RegExp(`^${STEP.source}`));
      return m ? { kw: m[1], body: line.slice(m[0].length).trim() } : { kw: "", body: line };
    });
}

/** The "Then": the line a person reads. Falls back to null when the Gherkin has none. */
export function thenOf(text: string): string | null {
  const steps = gherkinSteps(text);
  const i = steps.findIndex((s) => s.kw === "Then");
  if (i < 0) return null;
  const parts = [steps[i].body];
  for (const s of steps.slice(i + 1)) if (s.kw === "And" || s.kw === "But") parts.push(s.body);
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
