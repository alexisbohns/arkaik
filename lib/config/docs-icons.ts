import type { LucideIcon } from "lucide-react";
import {
  BlocksIcon,
  BookOpenIcon,
  CloudIcon,
  CompassIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderTreeIcon,
  GitBranchIcon,
  LayersIcon,
  LightbulbIcon,
  MapIcon,
  NetworkIcon,
  NewspaperIcon,
  NotebookPenIcon,
  PackageIcon,
  PenToolIcon,
  PlugIcon,
  RocketIcon,
  ScaleIcon,
  ServerIcon,
  ShapesIcon,
  ShieldIcon,
  SparklesIcon,
  TelescopeIcon,
  TerminalIcon,
  WorkflowIcon,
  WrenchIcon,
} from "lucide-react";

/**
 * The glyphs a doc may ask for by name, via `icon:` in its frontmatter.
 *
 * An allowlist rather than a dynamic `lucide-react` lookup, for the same reason
 * the published-areas list is one: a frontmatter string is authored content, and
 * indexing the whole icon set with it would let any doc pull any component name
 * out of the library at render time. It also keeps the sidebar's client bundle
 * to these icons instead of all ~1500.
 *
 * Kept small and vocabulary-shaped on purpose — a doc picks the closest word,
 * and adding a new one here is a one-line, reviewable change.
 */
export const DOC_ICONS = {
  architecture: BlocksIcon,
  article: NewspaperIcon,
  book: BookOpenIcon,
  branch: GitBranchIcon,
  cloud: CloudIcon,
  compass: CompassIcon,
  database: DatabaseIcon,
  design: PenToolIcon,
  file: FileTextIcon,
  folder: FolderTreeIcon,
  idea: LightbulbIcon,
  layers: LayersIcon,
  map: MapIcon,
  network: NetworkIcon,
  notebook: NotebookPenIcon,
  package: PackageIcon,
  plug: PlugIcon,
  rocket: RocketIcon,
  scale: ScaleIcon,
  server: ServerIcon,
  shapes: ShapesIcon,
  shield: ShieldIcon,
  sparkles: SparklesIcon,
  telescope: TelescopeIcon,
  terminal: TerminalIcon,
  workflow: WorkflowIcon,
  wrench: WrenchIcon,
} satisfies Record<string, LucideIcon>;

export type DocIconName = keyof typeof DOC_ICONS;

/** The glyph a page falls back to when its frontmatter names none. */
export const DEFAULT_DOC_ICON: LucideIcon = FileTextIcon;

/** The glyph for a navigation row that is a section rather than a page. */
export const DEFAULT_DOC_SECTION_ICON: LucideIcon = FolderTreeIcon;

/**
 * The icon a nav row wears. An unknown name resolves to the fallback rather
 * than throwing: a typo in frontmatter should cost the row its glyph, not the
 * whole sidebar.
 */
export function resolveDocIcon(name: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!name) return fallback;
  const key = name.trim().toLowerCase();
  // `Object.hasOwn`, not a plain lookup: an object literal inherits from
  // `Object.prototype`, so `DOC_ICONS["constructor"]` is truthy and would be
  // handed to JSX as a component. `icon: constructor` is an absurd thing to
  // write, but the whole point of the allowlist is that authored strings do not
  // get to reach past it.
  return Object.hasOwn(DOC_ICONS, key) ? DOC_ICONS[key as DocIconName] : fallback;
}
