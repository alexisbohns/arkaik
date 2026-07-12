import type { SpeciesId } from "@/lib/config/species";
import { deriveNodeId, edgeId, SPECIES_PREFIXES } from "@arkaik/schema";

/**
 * Deterministic id helpers, re-exported from the single source of truth in
 * `@arkaik/schema` (docs/spec/bundle-format.md § Identifier Conventions). The
 * app no longer mints random-UUID-suffixed node ids or raw-UUID edge ids
 * (issue #215); ids derive from titles and the `e-{source}-{target}` rule.
 */
export { edgeId, SPECIES_PREFIXES };

/**
 * Generate a node id from its title, disambiguated against the ids already in
 * use (typically `nodesById.keys()`), e.g. `V-user-profile`. Two nodes whose
 * titles kebab-case identically get `-2`, `-3`, … suffixes.
 */
export function generateNodeId(
  species: SpeciesId,
  title: string,
  existingIds: Iterable<string> = [],
): string {
  return deriveNodeId(species, title, existingIds);
}
