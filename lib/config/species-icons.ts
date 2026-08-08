import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  ClipboardListIcon,
  Database,
  DatabaseIcon,
  GitBranchIcon,
  MonitorIcon,
  MonitorSmartphone,
  Network,
  Plug,
  Scale,
  ScaleIcon,
  ServerIcon,
} from "lucide-react";
import type { SpeciesId } from "@/lib/config/species";

/**
 * The species vocabularies — icons for the canvas, icons for navigation, and the
 * plural labels — in one module (audit `factorization-5`).
 *
 * **Two different constants were both named `SPECIES_ICONS`.** One in
 * `components/graph/nodes/node-styles.ts` (flow: Network, view:
 * MonitorSmartphone, api-endpoint: Plug), one private to
 * `components/overview/InventoryCard.tsx` (flow: GitBranch, view: Monitor,
 * api-endpoint: Server), with the second vocabulary re-declared inline again in
 * `ProjectSidebar` and `CommandPalette`. An importer reading `SPECIES_ICONS[…]`
 * could not tell which glyph set they were getting — the distinct names below
 * are the fix, not a preference.
 *
 * The two sets are genuinely different and both stay. The graph set reads at
 * node scale on a canvas, where a flow is a *network* of views; the nav set
 * reads at 16px in a sidebar row, where the same flow is a *branch* in a list of
 * pages. Merging them would make one of the two surfaces worse.
 *
 * Every map is a total `Record<SpeciesId, …>`, which is the working part: adding
 * a species (decision was added recently) now fails the build here, once,
 * instead of silently missing from four scattered maps.
 *
 * Lucide's `*Icon` aliases and their bare twins are the same components; the two
 * spellings below are kept because they are how each vocabulary was written at
 * its original site, and mixing them within one map would read as significance.
 */

/** Canvas and minimap glyphs — the set `node-styles.ts` exports as `SPECIES_ICONS`. */
export const SPECIES_GRAPH_ICONS: Record<SpeciesId, LucideIcon> = {
  flow: Network,
  view: MonitorSmartphone,
  "data-model": Database,
  "api-endpoint": Plug,
  acceptance: ClipboardList,
  decision: Scale,
};

/** Sidebar, command palette and inventory glyphs — the navigation vocabulary. */
export const SPECIES_NAV_ICONS: Record<SpeciesId, LucideIcon> = {
  flow: GitBranchIcon,
  view: MonitorIcon,
  "data-model": DatabaseIcon,
  "api-endpoint": ServerIcon,
  acceptance: ClipboardListIcon,
  decision: ScaleIcon,
};

/**
 * Plural labels, as a species reads when it names a collection — a sidebar
 * entry, an inventory row, a delivery filter. `SPECIES[].label` stays the
 * singular, which is what a badge on one node wants.
 */
export const SPECIES_PLURALS: Record<SpeciesId, string> = {
  flow: "Flows",
  view: "Views",
  "data-model": "Data Models",
  "api-endpoint": "API Endpoints",
  acceptance: "Acceptances",
  decision: "Decisions",
};
