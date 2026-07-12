/**
 * Pure, framework-agnostic helpers for rendering a Publik snapshot preview
 * (`app/p/[id]/page.tsx`, docs/spec/services.md § Publik → Surfaces).
 *
 * The stored `bundle` is `unknown` from the page's point of view — it was
 * validated at publish time by `lib/services/publik.ts`, but this module
 * treats it defensively so a malformed or unexpected shape degrades the
 * preview instead of crashing the route.
 */

export type ConformanceLevel = 0 | 1 | 2;

export type PreviewAssetResolution =
  | { kind: "image"; src: string }
  | { kind: "placeholder" }
  | { kind: "none" };

export interface PublikBundleSummary {
  title: string;
  description?: string;
  nodeCount: number;
  edgeCount: number;
  /** docs/spec/bundle-format.md § Conformance Levels, derived from what's stored. */
  conformanceLevel: ConformanceLevel;
  /** A representative screenshot for the preview card, if one can be resolved. */
  previewAsset: PreviewAssetResolution;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Classify a single asset value per docs/spec/bundle-format.md § Asset Values.
 * Only `data:` URIs and absolute URLs (any URI scheme) carry bytes the hosted
 * preview can render directly; a schemeless relative path is a Kommit-mode
 * reference the server has no bundle directory to resolve against, so it
 * degrades to a placeholder rather than failing.
 */
function resolveAssetValue(value: unknown): PreviewAssetResolution {
  if (typeof value !== "string" || value.length === 0) return { kind: "none" };
  if (value.startsWith("data:")) return { kind: "image", src: value };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return { kind: "image", src: value };
  return { kind: "placeholder" };
}

/** Scan nodes (in stored order) for the first resolvable or placeholder-worthy screenshot. */
function findRepresentativeAsset(nodes: unknown): PreviewAssetResolution {
  if (!Array.isArray(nodes)) return { kind: "none" };

  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const metadata = node.metadata;
    if (!isRecord(metadata)) continue;
    const screenshots = metadata.platformScreenshots;
    if (!isRecord(screenshots)) continue;

    for (const value of Object.values(screenshots)) {
      const resolved = resolveAssetValue(value);
      if (resolved.kind !== "none") return resolved;
    }
  }

  return { kind: "none" };
}

/**
 * Derive the conformance level a stored bundle exhibits (docs/spec/bundle-format.md
 * § Conformance Levels). Publik strips the journal by default, so most published
 * snapshots read as Level 0/1; Level 2 only appears when a publisher opted in
 * with `?include_journal=true`.
 */
function deriveConformanceLevel(root: Record<string, unknown>): ConformanceLevel {
  if (Array.isArray(root.journal) && root.journal.length > 0) return 2;
  if (typeof root.schema_version === "number") return 1;
  return 0;
}

/** Summarize a stored bundle for the `/p/{id}` preview card. Never throws. */
export function summarizeBundle(bundle: unknown): PublikBundleSummary {
  const root = isRecord(bundle) ? bundle : {};
  const project = isRecord(root.project) ? root.project : {};
  const nodes = Array.isArray(root.nodes) ? root.nodes : [];
  const edges = Array.isArray(root.edges) ? root.edges : [];

  const title = typeof project.title === "string" && project.title.trim().length > 0
    ? project.title
    : "Untitled project";
  const description = typeof project.description === "string" ? project.description : undefined;

  return {
    title,
    description,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    conformanceLevel: deriveConformanceLevel(root),
    previewAsset: findRepresentativeAsset(root.nodes),
  };
}
