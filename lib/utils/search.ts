import type { Node } from "@/lib/data/types";

/** Case-insensitive match against a node's title and description — the shared
 * text-search predicate of the library and delivery surfaces. */
export function matchesSearch(node: Pick<Node, "title" | "description">, searchQuery: string): boolean {
  if (!searchQuery) return true;
  const haystack = `${node.title} ${node.description ?? ""}`.toLowerCase();
  return haystack.includes(searchQuery.toLowerCase());
}
