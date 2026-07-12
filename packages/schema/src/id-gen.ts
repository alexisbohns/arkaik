/**
 * Deterministic identifier generation for Arkaik ProjectBundles — the
 * producer half of the Identifier Conventions that validate.ts enforces
 * (docs/spec/bundle-format.md § Identifier Conventions). Node ids are the
 * species prefix + kebab-case of the title; edge ids are `e-{source}-{target}`.
 *
 * Deliberately zod-free (imports only a *type* from ./ids): this is the single
 * source of truth for the `SPECIES_PREFIXES` map, which validate.ts consumes,
 * and validate.ts is esbuild-bundled into the standalone `validate-bundle.js`
 * — pulling the zod runtime in here would bloat that artifact for no benefit.
 */

import type { SpeciesId } from "./ids";

/**
 * Species → node-id prefix (with the trailing dash). The single source of
 * truth for prefixes across the codebase: validate.ts, the app's
 * `lib/utils/id.ts`, and the generated prompt fragment all resolve to this.
 */
export const SPECIES_PREFIXES: Record<SpeciesId, string> = {
  flow: "F-",
  view: "V-",
  "data-model": "DM-",
  "api-endpoint": "API-",
};

/**
 * kebab-case a human title: strip accents, lowercase, collapse every run of
 * non-alphanumerics to a single hyphen, and trim leading/trailing hyphens.
 * Returns an empty string for a title with no alphanumeric content — callers
 * decide the fallback.
 */
export function kebabCase(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A short, stable, dependency-free hash of `seed` as a fixed-width 6-char
 * base36 string. Used only for the untitled-node fallback. Fixed 6-char width
 * (never 8 hex) means a fallback id can never be mistaken for the app's old
 * random `{prefix}-{8 hex}` shape on a later migration pass.
 */
function shortHash(seed: string): string {
  // FNV-1a, 32-bit. Deterministic across runs and platforms.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, "0").slice(-6);
}

/**
 * Derive a deterministic node id from a title: species prefix + kebab-case of
 * the title, disambiguated against `existingIds` with `-2`, `-3`, … counters
 * (docs/spec/bundle-format.md § Identifier Conventions). A title that
 * kebab-cases to empty falls back to `prefix + shortHash(fallbackSeed ?? title)`
 * so an untitled node still gets a stable, unique id rather than a bare prefix.
 */
export function deriveNodeId(
  species: SpeciesId,
  title: string,
  existingIds: Iterable<string> = [],
  fallbackSeed?: string,
): string {
  const prefix = SPECIES_PREFIXES[species];
  const slug = kebabCase(title ?? "");
  const base = slug ? `${prefix}${slug}` : `${prefix}${shortHash(fallbackSeed ?? title ?? "")}`;

  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds);
  if (!taken.has(base)) return base;

  let counter = 2;
  while (taken.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

/** The canonical edge id for a source→target pair: `e-{source}-{target}`. */
export function edgeId(sourceId: string, targetId: string): string {
  return `e-${sourceId}-${targetId}`;
}
