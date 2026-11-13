import { ExpressiveShape, type ExpressiveShapeName } from "@/components/arkademy/ExpressiveShape";
import { STATUS_MINIMAP_FILL } from "@/components/graph/nodes/node-styles";
import type { StatusId } from "@/lib/config/statuses";

/**
 * One shape per species, carried from the panel header's seal to the hero and
 * the marks: a view is a cookie (a screen you hold), a flow a clover (paths
 * that branch), an acceptance a sunny burst — a seal on a promise. Decorative
 * everywhere it appears: the species is always also said in words.
 */
export const SPECIES_SHAPE: Record<string, ExpressiveShapeName> = {
  view: "cookie12",
  flow: "clover4",
  acceptance: "sunny",
  "data-model": "cookie9",
  "api-endpoint": "cookie9",
  decision: "flower",
};

export function SpeciesShape({ species, className }: { species: string; className?: string }) {
  return <ExpressiveShape shape={SPECIES_SHAPE[species] ?? "cookie12"} className={className} />;
}

/** A status's tone as a CSS colour — the variable the minimap paints with. */
export function statusTone(status: StatusId | undefined): string {
  return status ? STATUS_MINIMAP_FILL[status] : "var(--md-outline)";
}
