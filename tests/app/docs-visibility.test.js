#!/usr/bin/env node

/**
 * The /docs publication boundary (lib/utils/docs-visibility.ts).
 *
 * `docs/` holds the product's documentation and the delivery record that made
 * it, side by side. The route used to serve both. This suite pins the rule that
 * separates them, and — because a leak here is public — walks the real `docs/`
 * tree to assert that today's internal directories are actually excluded rather
 * than merely intended to be.
 */

const fs = require("fs");
const path = require("path");
const { loadUtil, BUILD_DIR } = require("./load-panel-utils");

const {
  isPublishedDoc,
  docAreaOf,
  PUBLISHED_DOC_AREAS,
  INTERNAL_DOC_AREAS,
} = loadUtil("docs-visibility");

const ROOT = path.join(__dirname, "..", "..");
const DOCS_DIR = path.join(ROOT, "docs");

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// --- the area a path belongs to ---
assert(docAreaOf("architecture.md") === "architecture", "a top-level file's area is its stem");
assert(docAreaOf("spec/mcp.md") === "spec", "a nested file's area is its directory");
assert(
  docAreaOf("superpowers/plans/2026-08-04-bootstrap-method.md") === "superpowers",
  "a deeply nested file's area is its *first* segment, not its parent",
);

// --- the allowlist ---
assert(isPublishedDoc("architecture.md"), "architecture.md is published");
assert(isPublishedDoc("spec/bundle-format.md"), "the spec is published — the README links it");
assert(isPublishedDoc("articles/2026-08-02-one-graph-many-products.md"), "articles are published");

// --- the withheld areas ---
assert(!isPublishedDoc("superpowers/knowledge/ui.md"), "agent knowledge is not published");
assert(!isPublishedDoc("superpowers/plans/2026-08-04-content-population.md"), "delivery plans are not published");
assert(!isPublishedDoc("superpowers/specs/2026-08-03-self-map-program.md"), "delivery specs are not published");
assert(!isPublishedDoc("audit/2026-08-06-quality-audit.md"), "the internal audit is not published");
assert(!isPublishedDoc("rfcs/products.md"), "RFCs are not published");
assert(!isPublishedDoc("arkaik-skill/skill.md"), "packaged skill sources are not pages");

/*
 * FAILING CLOSED IS THE WHOLE DESIGN, so it gets its own assertion: an area
 * nobody has classified must be private, not public. This is what a denylist
 * would get wrong, and the reason the policy is written the other way round.
 */
assert(!isPublishedDoc("retro/2027-01-01-postmortem.md"), "an unclassified new area defaults to private");
assert(!isPublishedDoc("incidents/outage.md"), "an unclassified new top-level dir defaults to private");

// --- the allowlist is a boundary, so it does not bend ---
assert(!isPublishedDoc("Superpowers/plans/x.md"), "case cannot smuggle a path past the allowlist");
assert(!isPublishedDoc("spec/../superpowers/plans/x.md"), "a traversal segment is refused outright");
assert(!isPublishedDoc("superpowers\\plans\\x.md"), "backslash separators are normalised, not waved through");

// --- the two lists describe one decision ---
const overlap = PUBLISHED_DOC_AREAS.filter((area) => INTERNAL_DOC_AREAS.includes(area));
assert(overlap.length === 0, `published and internal areas are disjoint (overlap: ${overlap.join(", ") || "none"})`);
assert(
  INTERNAL_DOC_AREAS.every((area) => !isPublishedDoc(`${area}/anything.md`)),
  "every area documented as internal is in fact withheld",
);

/*
 * Against the real tree, not a fixture. The point of this suite is that
 * `docs/superpowers` is not on the public site *today*; a fixture would pass
 * happily while the actual directory leaked.
 */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(next);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [next] : [];
  });
}

const relative = walk(DOCS_DIR).map((file) => path.relative(DOCS_DIR, file).split(path.sep).join("/"));
const leaked = relative.filter((file) => INTERNAL_DOC_AREAS.includes(docAreaOf(file)) && isPublishedDoc(file));
assert(leaked.length === 0, `no file in an internal area is publishable (leaked: ${leaked.join(", ") || "none"})`);

const published = relative.filter((file) => isPublishedDoc(file));
assert(published.length > 0, `the real docs tree still publishes something (${published.length} files)`);

// Every area actually present in docs/ is classified one way or the other, so a
// directory added without a decision shows up here rather than silently sitting
// private and confusing whoever wrote it.
const areas = [...new Set(relative.map(docAreaOf))].filter((area) => area !== "readme");
const unclassified = areas.filter(
  (area) => !PUBLISHED_DOC_AREAS.includes(area) && !INTERNAL_DOC_AREAS.includes(area),
);
assert(
  unclassified.length === 0,
  `every area in docs/ is classified (unclassified: ${unclassified.join(", ") || "none"})`,
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} docs-visibility test(s) failed`);
  process.exit(1);
}
console.log("\nAll docs-visibility tests passed");
