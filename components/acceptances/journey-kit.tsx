"use client";

/**
 * The journey kit — what the directory's views share about the product's
 * journeys: the tree (sub-flows under the journeys that reach them), the keys of
 * the two honest shelves, the DynaPuff font class every journey surface carries,
 * and the words. Contents numbers its chapters from this tree; Mapping draws
 * its rail and ribbon from it.
 *
 * Styles: app/m3/acceptances-directory.css (`ka-mapping-` tokens, `ka-contents-`).
 */
import { dynaPuff } from "@/lib/font-display";
import type { AnchorRef, Journey, MappingModel } from "@/lib/utils/acceptances-model";

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
