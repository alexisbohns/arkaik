/**
 * Which of the repo's markdown files `/docs` is allowed to serve.
 *
 * `docs/` is two things at once: the product's documentation, and the delivery
 * record that produced it — plans, specs, design notes, audits, agent knowledge.
 * The route used to walk the whole tree and publish every `.md` it found, so the
 * second kind was reachable at a guessable URL, listed in the sidebar, and
 * indexed by the ⌘K palette.
 *
 * THE POLICY IS AN ALLOWLIST, and that is the point rather than an
 * implementation detail. A denylist fails open: the next `docs/retro/` or
 * `docs/incidents/` directory is public the moment it is created, and nobody
 * finds out until it is indexed. An allowlist fails closed — a new area is
 * private until someone writes its name here, which is a one-line change made
 * deliberately instead of an exposure discovered later.
 *
 * Kept import-free so it can be tested directly under CI's Node.
 */

/**
 * The published areas, keyed by first path segment: a top-level file's stem, or
 * a directory's name.
 *
 * The list is not a guess. Every entry here is either linked from the public
 * `README.md` (architecture, bootstrap, conventions, data-layer, graph-model,
 * hosted-projects, spec, vision) or already served verbatim by another public
 * route — `llms-full.txt` and `sitemap.ts` both carry their own copies of the
 * same set. Those three lists agreeing is what makes this one reviewable.
 *
 * `articles` and `icon-wobble` are the two additions: published writing, and a
 * craft note about a visible interaction. Neither is delivery process.
 */
export const PUBLISHED_DOC_AREAS: readonly string[] = [
  "architecture",
  "articles",
  "bootstrap",
  "conventions",
  "data-layer",
  "graph-model",
  "hosted-projects",
  "icon-wobble",
  "spec",
  "vision",
];

/**
 * The areas deliberately withheld, named so the exclusion is a documented
 * decision rather than an absence.
 *
 * Nothing reads this — the allowlist above is what the route enforces. It exists
 * so a reader can tell "we decided this is internal" from "we forgot to add
 * this", and so the test can assert the two sets stay disjoint.
 *
 * - `superpowers` — plans, specs and agent knowledge: how the work gets done.
 * - `audit` — internal quality findings, by issue number.
 * - `rfcs` — proposals, including ones that were never taken up.
 * - `arkaik-skill`, `arkaik-bootstrap-skill` — packaged skill sources, not pages;
 *   they ship as a plugin and one of them carries a script rather than prose.
 */
export const INTERNAL_DOC_AREAS: readonly string[] = [
  "arkaik-bootstrap-skill",
  "arkaik-skill",
  "audit",
  "rfcs",
  "superpowers",
];

const PUBLISHED = new Set(PUBLISHED_DOC_AREAS);

/**
 * The area a docs-relative path belongs to: its directory when it has one, its
 * filename stem when it sits at the top level.
 *
 * Case-folded, because the allowlist is a security boundary and `Spec/` must not
 * be a way around `spec`. Backslashes are folded to `/` so a Windows-style
 * relative path cannot present `superpowers\plans\x.md` as a single top-level
 * segment that matches nothing and therefore… also fails closed, but for the
 * wrong reason and only by luck.
 */
export function docAreaOf(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const [first = ""] = normalized.split("/");
  return normalized.includes("/") ? first : first.replace(/\.md$/, "");
}

/**
 * Whether `/docs` may serve this file, given its path relative to `docs/`.
 *
 * Traversal segments are refused outright. The route never builds a path this
 * way — it walks the tree and relativises what it finds — but a `..` reaching
 * this function at all means something upstream is wrong, and answering "yes,
 * that's in an allowed area" to `spec/../superpowers/plans/x.md` would be the
 * worst possible time to be helpful.
 */
export function isPublishedDoc(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.split("/").some((segment) => segment === "..")) return false;
  return PUBLISHED.has(docAreaOf(normalized));
}
