/**
 * Bundle reading for the `arkaik` CLI commands that need the snapshot alongside
 * the journal (`log`, `release`). Small, throwing helpers — the caller decides
 * how to surface an error (usage message + exit code). Keeps the JSON read and
 * the `id -> node` map in one place so the commands stay focused on their flow.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Node } from "@arkaik/schema";

/** Read + parse a bundle JSON file. Throws on a missing file, bad JSON, or non-object. */
export function readBundle(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    throw new Error(`Cannot parse JSON — ${(e as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Bundle must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * The bundle's nodes keyed by id — used to resolve titles when rendering events
 * and to resolve platforms when computing a platform-scoped changelog. Nodes
 * without a string `id` are skipped.
 */
export function nodesByIdOf(bundle: Record<string, unknown>): Map<string, Node> {
  const nodes = Array.isArray(bundle.nodes) ? bundle.nodes : [];
  const map = new Map<string, Node>();
  for (const n of nodes) {
    if (n !== null && typeof n === "object" && typeof (n as { id?: unknown }).id === "string") {
      map.set((n as Node).id, n as Node);
    }
  }
  return map;
}
