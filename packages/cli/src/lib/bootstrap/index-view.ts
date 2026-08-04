/**
 * A compact listing of the current map: id, species, title, product — one
 * tab-separated line per node.
 *
 * An agent that must reference existing nodes (every brownfield reconcile unit,
 * every acceptance unit writing `covers` edges) needs their ids, not their
 * bodies. For a 173-node map this is a few KB against a 164KB bundle.
 */
interface IndexNode {
  id?: unknown;
  species?: unknown;
  title?: unknown;
  metadata?: { product?: unknown } | null;
}

/**
 * Node titles (and, defensively, every other field here) are free text
 * written by humans and agents — nothing stops one from containing a tab, a
 * CR, or a newline. Left alone, an embedded tab shifts every column after it
 * on that line, and an embedded newline splits one node's line into two (the
 * second half with no id at all) — either way, an agent parsing this format
 * with `line.split("\t")` silently mis-associates an id with the wrong
 * title. Collapsing any run of tab/CR/LF into a single space keeps every
 * line exactly one node, exactly four columns, no exceptions.
 */
function tsvField(value: unknown, fallback = ""): string {
  const str = value === undefined || value === null ? fallback : String(value);
  return str.replace(/[\t\r\n]+/g, " ");
}

export function renderIndex(bundle: { nodes?: unknown }): string {
  const nodes = Array.isArray(bundle.nodes) ? (bundle.nodes as IndexNode[]) : [];
  const lines = ["id\tspecies\ttitle\tproduct"];
  for (const node of nodes) {
    const product = node.metadata && typeof node.metadata === "object" ? node.metadata.product : undefined;
    // `product` is already truthy here, so tsvField's fallback never runs for
    // it — the fallback only matters for id/species/title, which can be
    // missing. The falsy case ("-") is handled outside tsvField entirely.
    lines.push([tsvField(node.id), tsvField(node.species), tsvField(node.title), product ? tsvField(product) : "-"].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}
