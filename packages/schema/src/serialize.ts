import type { ProjectBundle } from "./bundle";

/**
 * Canonical serialization for Arkaik ProjectBundles
 * (docs/spec/bundle-format.md § Canonical Serialization).
 *
 * So bundles diff and merge cleanly in git, writers emit a canonical form:
 *  - UTF-8, LF line endings, 2-space indentation, trailing newline;
 *  - top-level key order `schema_version, project, nodes, edges, journal`,
 *    with any other/unknown top-level keys kept AFTER these, codepoint-sorted;
 *  - `nodes` and `edges` sorted by `id` (codepoint ascending);
 *  - object keys emitted in the schema field order (Node/Edge/Project/
 *    ProjectBundle), with unknown fields after the known ones, codepoint-sorted.
 *
 * Deliberately zod-free (only plain field-order lists, no schema imports): the
 * module stays bundleable into the standalone validator, mirroring validate.ts.
 * All unknown/catchall keys are preserved — nothing is silently stripped
 * (docs/spec/bundle-format.md § Schema Versioning).
 */

/**
 * Schema field orders, mirroring the zod object schemas in bundle.ts. Kept as
 * hardcoded lists (like scripts/generate/generate-json-schema.js does for the
 * JSON Schema key order) and verified against bundle.ts:
 *  - ProjectBundleSchema (bundle.ts ~218): schema_version, project, nodes, edges, journal
 *  - ProjectSchema       (bundle.ts ~189): id, title, description, version,
 *                                          root_node_id, metadata, created_at,
 *                                          updated_at, archived_at
 *  - NodeSchema          (bundle.ts ~131): id, project_id, species, title,
 *                                          description, status, platforms, metadata
 *  - EdgeSchema          (bundle.ts ~151): id, project_id, source_id, target_id,
 *                                          edge_type, metadata
 */
const BUNDLE_KEY_ORDER: readonly string[] = ["schema_version", "project", "nodes", "edges", "journal"];
const PROJECT_KEY_ORDER: readonly string[] = [
  "id",
  "title",
  "description",
  "version",
  "root_node_id",
  "metadata",
  "created_at",
  "updated_at",
  "archived_at",
];
const NODE_KEY_ORDER: readonly string[] = [
  "id",
  "project_id",
  "species",
  "title",
  "description",
  "status",
  "platforms",
  "metadata",
];
const EDGE_KEY_ORDER: readonly string[] = [
  "id",
  "project_id",
  "source_id",
  "target_id",
  "edge_type",
  "metadata",
];

/**
 * Raw codepoint comparison via `<`/`>` on the string (NOT `localeCompare`,
 * whose locale-aware collation is neither stable across environments nor the
 * ordering the spec calls for).
 */
function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Emission order for an object's own keys: the `known` schema fields that are
 * present (in schema order) first, then every remaining key codepoint-sorted.
 */
function emissionOrder(keys: string[], known: readonly string[]): string[] {
  const present = new Set(keys);
  const ordered = known.filter((k) => present.has(k));
  const orderedSet = new Set(ordered);
  const rest = keys.filter((k) => !orderedSet.has(k)).sort(codepointCompare);
  return [...ordered, ...rest];
}

/**
 * Canonicalize a nested value (metadata, journal entries, unknown subtrees):
 * object keys are codepoint-sorted, arrays keep their order, primitives pass
 * through untouched. No schema field order applies below the top-level
 * entities.
 */
function canonicalizeNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeNested);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(codepointCompare)) {
      out[key] = canonicalizeNested(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Canonicalize an object that has a known schema field order (Project, Node,
 * Edge): known fields first in schema order, remaining fields codepoint-sorted;
 * each value canonicalized as a nested value.
 */
function canonicalizeOrdered(obj: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of emissionOrder(Object.keys(obj), known)) {
    out[key] = canonicalizeNested(obj[key]);
  }
  return out;
}

function idOf(item: unknown): string {
  if (isPlainObject(item) && typeof item.id === "string") return item.id;
  return "";
}

/**
 * Canonicalize the `nodes`/`edges` arrays: order each element's keys by the
 * given schema field order, then sort the array by `id` (raw codepoint
 * comparison). The sort is stable, so entries with equal ids keep their
 * relative order.
 */
function canonicalizeSortedEntities(value: unknown, known: readonly string[]): unknown {
  if (!Array.isArray(value)) return canonicalizeNested(value);
  const items = value.map((item) =>
    isPlainObject(item) ? canonicalizeOrdered(item, known) : canonicalizeNested(item),
  );
  items.sort((a, b) => codepointCompare(idOf(a), idOf(b)));
  return items;
}

function canonicalizeBundle(bundle: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of emissionOrder(Object.keys(bundle), BUNDLE_KEY_ORDER)) {
    const value = bundle[key];
    if (key === "project") {
      out[key] = isPlainObject(value) ? canonicalizeOrdered(value, PROJECT_KEY_ORDER) : canonicalizeNested(value);
    } else if (key === "nodes") {
      out[key] = canonicalizeSortedEntities(value, NODE_KEY_ORDER);
    } else if (key === "edges") {
      out[key] = canonicalizeSortedEntities(value, EDGE_KEY_ORDER);
    } else {
      // schema_version, journal (array order preserved — its ts-then-id
      // ordering is owned elsewhere), and any unknown top-level keys.
      out[key] = canonicalizeNested(value);
    }
  }
  return out;
}

/**
 * Serialize a {@link ProjectBundle} to its canonical JSON string: 2-space
 * indent, LF newlines, trailing newline. Pure string/object operations — safe
 * in the browser and in a bundler-free Node loader alike.
 */
export function serializeBundle(bundle: ProjectBundle): string {
  return JSON.stringify(canonicalizeBundle(bundle as unknown as Record<string, unknown>), null, 2) + "\n";
}
