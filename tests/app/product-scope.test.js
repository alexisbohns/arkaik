#!/usr/bin/env node

/**
 * Product scope helpers (lib/utils/product-scope.ts) — the app-side layer over
 * the schema's product projections.
 *
 * The load-bearing assertion is the "All products" one: `scopedPlatforms` must
 * intersect a node against **its own product's** menu, never against the
 * scope's platform list. Under All products that list is the union of every
 * product, so intersecting against it would leave a web-only admin view
 * contributing to the Android column exactly as it does today — the bug this
 * whole feature exists to fix. The fixture deliberately gives that admin view a
 * stale three-platform `platforms` array so the two implementations disagree.
 */

const fs = require("fs");
const path = require("path");
const { loadProductScope, BUILD_DIR } = require("./load-product-scope");

const {
  platformAvailabilityShape,
  resolveProductScope,
  productScopeOptions,
  platformCountLabel,
  nodeInScope,
  productsOfNode,
  productLabelsOfNode,
  scopedPlatforms,
  scopedRollupPlatforms,
  flowGaugePlatforms,
  buildProductUsageIndex,
  getProductScopeId,
  setProductScopeId,
  subscribeProductScope,
  resetProductScopeStore,
} = loadProductScope();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- Fixture -----------------------------------------------------------------
//
// Two products, deliberately of different arity, so the union is genuinely
// wider than either member's menu.

const ENDUSER = { id: "enduser", title: "End-user app", platforms: ["web", "ios", "android"] };
const ADMIN = { id: "admin", title: "Admin dashboard", platforms: ["web"] };

const bundle = { project: { id: "P1", metadata: { products: [ENDUSER, ADMIN] } } };
const noProducts = { project: { id: "P2", metadata: {} } };

/** A view whose stored platforms predate products — the stale, over-claiming case. */
const adminView = {
  id: "V-admin",
  species: "view",
  platforms: ["web", "ios", "android"],
  metadata: { product: "admin" },
};
const endUserView = {
  id: "V-feed",
  species: "view",
  platforms: ["ios", "web"],
  metadata: { product: "enduser" },
};
/** Triage: stores no membership at all. */
const unassignedView = { id: "V-orphan", species: "view", platforms: ["web", "ios", "android"], metadata: {} };
/** Points at a product the project no longer declares. */
const ghostView = { id: "V-ghost", species: "view", platforms: ["web", "android"], metadata: { product: "ghost" } };
/** A species that never stores membership; it is derived from consumers. */
const dataModel = { id: "DM-user", species: "data-model", platforms: ["web", "ios"], metadata: { product: "admin" } };

// --- platformAvailabilityShape — the arity rule itself -----------------------
//
// `components/graph/nodes/PlatformAvailability.tsx` is a switch over this one
// function, and eight surfaces inherit its answer. No React test runner exists
// here, so the component cannot be rendered — but the decision it makes is pure,
// and this is where it is pinned. The 2-platform case is the load-bearing one:
// an off-by-one to `> 2` would leave a two-platform product rendering a single
// bar, and no surface exercises that until the Pyramid adopts the primitive.

assert(platformAvailabilityShape(["web", "ios", "android"]) === "rings", "arity 3 renders rings");
assert(
  platformAvailabilityShape(["web", "ios"]) === "rings",
  "arity 2 renders rings — THE BOUNDARY: two is already worth per-platform chrome",
);
assert(
  platformAvailabilityShape(["web"]) === "bar",
  "arity 1 renders a bar — the aggregate ring and the lone platform ring would carry identical numbers",
);
assert(
  platformAvailabilityShape([]) === "bar",
  "arity 0 renders a bar too — 'not tracked' and 'tracked on one runtime' are the same picture",
);
// The identity is the point, not a by-product of both happening to say "bar".
// `PlatformAvailability`'s bar branch carries no platform icon at either arity
// and has one markup path for both, so 1 and 0 render identically; a later
// change that reintroduced icon-at-arity-1 would have to split this answer
// first.
assert(
  platformAvailabilityShape([]) === platformAvailabilityShape(["web"]),
  "arity 0 and arity 1 are the SAME shape — no platform icon at either, so the two are pixel-identical",
);

// --- resolveProductScope -----------------------------------------------------

const allScope = resolveProductScope(bundle, null);
assert(allScope.productId === null && allScope.product === null, "All products is a null id and a null product");
assert(
  eq(allScope.platforms, ["web", "ios", "android"]),
  `All products unions every declared menu (got ${JSON.stringify(allScope.platforms)})`,
);
assert(allScope.isMultiPlatform === true, "a 3-platform union is multi-platform");
assert(allScope.productsById.size === 2, "productsById indexes every declared product");

const endUserScope = resolveProductScope(bundle, "enduser");
assert(
  endUserScope.product === ENDUSER && eq(endUserScope.platforms, ["web", "ios", "android"]),
  "a named product resolves to its own definition and menu",
);
assert(endUserScope.isMultiPlatform === true, "arity 3 is multi-platform");

const adminScope = resolveProductScope(bundle, "admin");
assert(eq(adminScope.platforms, ["web"]), "a web-only product scopes to one platform");
assert(adminScope.isMultiPlatform === false, "arity 1 is NOT multi-platform — the arity rule collapses it");

const platformless = { project: { metadata: { products: [{ id: "api", title: "Public API", platforms: [] }] } } };
const apiScope = resolveProductScope(platformless, "api");
assert(
  eq(apiScope.platforms, []) && apiScope.isMultiPlatform === false,
  "arity 0 is NOT multi-platform either — rendered identically to arity 1",
);

const bareScope = resolveProductScope(noProducts, null);
assert(
  eq(bareScope.platforms, ["web", "ios", "android"]) && bareScope.productsById.size === 0,
  "a project declaring no products degenerates to every platform, unchanged from today",
);
assert(bareScope.isMultiPlatform === true, "the degenerate case stays multi-platform");

// `isMultiPlatform` is the same rule wearing a boolean, and it is asserted to be
// derived rather than re-implemented — two copies of `>= 2` is exactly how a
// surface reading the flag and a surface composing the primitive end up
// disagreeing about a two-platform product.
assert(
  [allScope, endUserScope, adminScope, apiScope, bareScope].every(
    (scope) => scope.isMultiPlatform === (platformAvailabilityShape(scope.platforms) === "rings"),
  ),
  "isMultiPlatform agrees with platformAvailabilityShape at every arity in this fixture",
);

const undefinedScope = resolveProductScope(undefined, null);
assert(
  eq(undefinedScope.platforms, ["web", "ios", "android"]) && undefinedScope.product === null,
  "an unloaded bundle degrades to the degenerate case rather than throwing",
);

const staleScope = resolveProductScope(bundle, "ghost");
assert(
  staleScope.product === null && eq(staleScope.platforms, ["web", "ios", "android"]),
  "a stale scope id degrades to the union rather than to nothing",
);

// --- The sidebar selector's pure parts ---------------------------------------
//
// There is no React test runner here, so ProductScopeSelector cannot be
// rendered. Everything in it that is a decision rather than markup lives in
// these two functions, and is asserted here instead: the component is a thin
// render over them.

assert(
  eq(productScopeOptions(noProducts), []),
  "a project declaring no products yields no options — THE SELECTOR RENDERS NOTHING, so a project that never heard of products is untouched",
);
assert(
  eq(productScopeOptions(undefined), []),
  "an unloaded bundle yields no options too — no empty select flashes while useProject's effect runs",
);

const options = productScopeOptions(bundle);
assert(
  eq(
    options,
    [
      { id: "enduser", label: "End-user app", platformLabel: "3 platforms" },
      { id: "admin", label: "Admin dashboard", platformLabel: "Web only" },
    ],
  ),
  `every declared product becomes one option, in declaration order (got ${JSON.stringify(options)})`,
);

const untitled = { project: { metadata: { products: [{ id: "public-api", platforms: [] }] } } };
assert(
  eq(productScopeOptions(untitled), [
    { id: "public-api", label: "public-api", platformLabel: "No platforms" },
  ]),
  "a definition with no title falls back to its id rather than rendering a blank row",
);
assert(
  productScopeOptions({ project: { metadata: { products: [{ id: "p", title: "   ", platforms: ["ios"] }] } } })[0]
    .label === "p",
  "a whitespace-only title falls back too — a row of spaces is still a blank row",
);

assert(platformCountLabel([]) === "No platforms", "arity 0 is a real state: 'No platforms'");
assert(platformCountLabel(undefined) === "No platforms", "a missing platforms array reads like an empty one");
assert(platformCountLabel(["web"]) === "Web only", "arity 1 names the platform: 'Web only'");
assert(platformCountLabel(["ios"]) === "iOS only", "arity 1 uses the platform's own label, not its id");
assert(
  platformCountLabel(["web", "ios", "android"]) === "3 platforms",
  "arity n counts: '3 platforms'",
);
assert(platformCountLabel(["web", "ios"]) === "2 platforms", "arity 2 counts too — only 1 is special-cased");
assert(
  platformCountLabel(["bogus"]) === "1 platform" && platformCountLabel([null]) === "1 platform",
  "an unrecognised single entry falls back to the neutral count — never echoed back as 'null only'",
);

// --- nodeInScope -------------------------------------------------------------

assert(nodeInScope(adminView, adminScope) === true, "a node matches the scope it stores membership for");
assert(nodeInScope(adminView, endUserScope) === false, "a node does not leak into another product's scope");
assert(
  nodeInScope(adminView, allScope) && nodeInScope(unassignedView, allScope) && nodeInScope(dataModel, allScope),
  "All products matches everything, membership or not",
);
assert(
  nodeInScope(unassignedView, adminScope) === false,
  "a node with no membership is in triage — excluded from a named scope",
);
assert(
  nodeInScope(dataModel, adminScope) === false,
  "a species that never stores membership never matches a named scope by its stored key",
);

// --- The Library's scoped list (Task 14) -------------------------------------
//
// `app/project/[id]/library/page.tsx` filters with `nodeInScope(node, scope,
// graph)` and nothing else, so every claim the Library makes about visibility is
// a claim about these four assertions. The graph is the point: without one,
// `nodeInScope` degrades to stored membership and the whole system layer
// disappears from every named scope.

/** Triage: a flow nobody has assigned. Visible under All products only. */
const unassignedFlow = { id: "F-loose", species: "flow", platforms: ["web"], metadata: {} };
/** Reached only from the admin view — the "hidden under end-user" case. */
const auditModel = { id: "DM-audit", species: "data-model", platforms: ["web"], metadata: {} };
/** Reached from both views. */
const sharedModel = { id: "DM-shared", species: "data-model", platforms: ["web"], metadata: {} };
/** Reached by nothing at all — the orphan § Decision 8 keeps in every scope. */
const orphanModel = { id: "DM-orphan", species: "data-model", platforms: ["web"], metadata: {} };
const adminEndpoint = { id: "EP-audit-log", species: "api-endpoint", platforms: ["web"], metadata: {} };

const libraryNodes = [
  adminView,
  endUserView,
  unassignedFlow,
  auditModel,
  sharedModel,
  orphanModel,
  adminEndpoint,
];
const libraryEdges = [
  { edge_type: "queries", source_id: "V-admin", target_id: "DM-audit" },
  { edge_type: "queries", source_id: "V-admin", target_id: "DM-shared" },
  { edge_type: "queries", source_id: "V-feed", target_id: "DM-shared" },
  { edge_type: "calls", source_id: "V-admin", target_id: "EP-audit-log" },
];
const libraryGraph = {
  edges: libraryEdges,
  nodesById: new Map(libraryNodes.map((node) => [node.id, node])),
  usageIndex: buildProductUsageIndex(libraryNodes, libraryEdges),
};

// Preconditions. Without these the visibility assertions below could pass for
// the wrong reason — an "orphan" that is really in `admin`, or a "hidden" model
// that is hidden because the traversal found nobody rather than found admin.
assert(
  productsOfNode(orphanModel, libraryGraph).size === 0,
  "precondition: nothing in the graph reaches DM-orphan",
);
assert(
  eq([...productsOfNode(auditModel, libraryGraph)], ["admin"]),
  `precondition: DM-audit is reached by admin and only admin (got ${JSON.stringify([
    ...productsOfNode(auditModel, libraryGraph),
  ])})`,
);

assert(
  nodeInScope(orphanModel, adminScope, libraryGraph) === true &&
    nodeInScope(orphanModel, endUserScope, libraryGraph) === true &&
    nodeInScope(orphanModel, allScope, libraryGraph) === true,
  "an orphan data model shows under EVERY named scope — hiding it would bury the node that needs attention most",
);
assert(
  nodeInScope(auditModel, endUserScope, libraryGraph) === false,
  "a data model only the admin views reach is hidden under end-user — the 'what does this app touch?' answer",
);
assert(
  nodeInScope(auditModel, adminScope, libraryGraph) === true &&
    nodeInScope(adminEndpoint, adminScope, libraryGraph) === true,
  "the same model, and an endpoint reached the same way, are both in under admin",
);
assert(
  nodeInScope(sharedModel, adminScope, libraryGraph) === true &&
    nodeInScope(sharedModel, endUserScope, libraryGraph) === true,
  "a data model both products reach appears under both — membership is not exclusive",
);
assert(
  nodeInScope(unassignedFlow, adminScope, libraryGraph) === false &&
    nodeInScope(unassignedFlow, endUserScope, libraryGraph) === false,
  "an unassigned flow is OUT of every named scope — the empty set means triage, not 'everywhere'",
);
assert(
  nodeInScope(unassignedFlow, allScope, libraryGraph) === true,
  "…and IN under All products, which is where triage is done",
);

// --- productLabelsOfNode — the badges themselves -----------------------------

assert(
  eq(productLabelsOfNode(sharedModel, allScope, libraryGraph), ["End-user app", "Admin dashboard"]),
  `"Used by" reads in DECLARATION order, not the index's alphabetical one (got ${JSON.stringify(
    productLabelsOfNode(sharedModel, allScope, libraryGraph),
  )})`,
);
assert(
  eq(libraryGraph.usageIndex.get("DM-shared"), ["admin", "enduser"]),
  "precondition: the usage index itself sorts alphabetically, so the ordering above is doing real work",
);
assert(
  eq(productLabelsOfNode(orphanModel, allScope, libraryGraph), []),
  "an orphan has no labels — the card renders 'Unattached' from the emptiness, not from a sentinel string",
);
assert(
  eq(productLabelsOfNode(adminView, allScope, libraryGraph), ["Admin dashboard"]),
  "a view badges the title of the product it stores",
);
assert(
  eq(productLabelsOfNode(unassignedFlow, allScope, libraryGraph), []),
  "an unassigned flow has no labels either — same emptiness, different reading, resolved by the caller",
);

const untitledBundle = { project: { metadata: { products: [{ id: "public-api", platforms: [] }] } } };
const untitledScope = resolveProductScope(untitledBundle, null);
assert(
  eq(productLabelsOfNode({ id: "V-x", species: "view", metadata: { product: "public-api" } }, untitledScope, libraryGraph), [
    "public-api",
  ]),
  "a product with no title badges its id rather than an empty pill",
);
assert(
  eq(productLabelsOfNode(ghostView, allScope, libraryGraph), ["ghost"]),
  "a membership pointing at a product the project no longer declares renders the id — never silently dropped",
);

// --- The clamp: rollup widening, then the scope's menu -----------------------
//
// `NodeCard` calls `scopedRollupPlatforms` for a flow's gauge list. The seed has
// exactly this shape: `F-swap-glyph` declares web/ios while its descendant
// `V-glyphs-list` declares android, so the rollup counts a platform the flow
// never lists. Both halves matter — dropping the widening loses counted work
// under All products; skipping the clamp re-admits a platform the product
// cannot ship.

const swapGlyphDeclared = ["web", "ios"];
const swapGlyphRollup = { counts: { android: { live: 1 } }, totals: { android: 1 } };

assert(
  eq(scopedRollupPlatforms(swapGlyphDeclared, swapGlyphRollup, allScope.platforms), ["web", "ios", "android"]),
  `under All products the widened android bar SURVIVES — today's behaviour, exactly preserved (got ${JSON.stringify(
    scopedRollupPlatforms(swapGlyphDeclared, swapGlyphRollup, allScope.platforms),
  )})`,
);
assert(
  eq(scopedRollupPlatforms(swapGlyphDeclared, swapGlyphRollup, adminScope.platforms), ["web"]),
  `under a web-only scope the same bar CLAMPS OUT (got ${JSON.stringify(
    scopedRollupPlatforms(swapGlyphDeclared, swapGlyphRollup, adminScope.platforms),
  )})`,
);
assert(
  eq(scopedRollupPlatforms(swapGlyphDeclared, swapGlyphRollup, bareScope.platforms), ["web", "ios", "android"]),
  "with no products declared the menu is every platform, so nothing clamps — the degenerate case is untouched",
);
// The clamp is a filter ON TOP OF the widening, not a replacement for it. This
// is what a `scopedPlatforms(node, scope)` shortcut would get wrong: it never
// consults the rollup, so it answers ["web","ios"] under All products and the
// android bar — real counted work — vanishes.
assert(
  !eq(
    scopedRollupPlatforms(swapGlyphDeclared, swapGlyphRollup, allScope.platforms),
    scopedPlatforms({ species: "flow", platforms: swapGlyphDeclared, metadata: {} }, allScope),
  ),
  "the clamp is NOT scopedPlatforms — the two disagree about android under All products, which is the whole reason for the composition",
);

// --- The canvas flow card's fallback -----------------------------------------
//
// `FlowNode` draws its gauge list from `flowGaugePlatforms`. Two branches, both
// leaks before Task 16: the declared branch is the clamp above, and the
// *undeclared* branch used to fall back to `PLATFORMS.map(...)` — every
// platform, whatever the scope. A flow that declares nothing is not rare: every
// synthetic condition/junction branch node the journey graph emits carries
// `platforms: []`.

const noRollup = { counts: {}, totals: {} };

assert(
  eq(flowGaugePlatforms([], noRollup, adminScope.platforms), ["web"]),
  `THE FALLBACK: a flow declaring no platforms under a web-only scope draws ONE track, not three (got ${JSON.stringify(
    flowGaugePlatforms([], noRollup, adminScope.platforms),
  )})`,
);
assert(
  eq(flowGaugePlatforms([], noRollup, allScope.platforms), ["web", "ios", "android"]),
  "under All products the same flow still draws every track — the fallback is the scope's menu, and that menu is the union",
);
assert(
  eq(flowGaugePlatforms([], noRollup, bareScope.platforms), ["web", "ios", "android"]),
  "with no products declared the fallback is every platform, exactly as before products existed",
);
assert(
  eq(flowGaugePlatforms([], noRollup, []), []),
  "an arity-0 scope draws no tracks — PlatformGaugeList's own empty guard then renders nothing, which is the honest answer",
);
assert(
  eq(
    flowGaugePlatforms(swapGlyphDeclared, swapGlyphRollup, adminScope.platforms),
    scopedRollupPlatforms(swapGlyphDeclared, swapGlyphRollup, adminScope.platforms),
  ),
  "a flow that DOES declare platforms takes the clamp branch unchanged — the fallback is not a second policy",
);
assert(
  !eq(
    flowGaugePlatforms([], noRollup, adminScope.platforms),
    flowGaugePlatforms([], noRollup, allScope.platforms),
  ),
  "the fallback DISCRIMINATES on the scope — a fallback to the global list would answer the same thing twice",
);

// --- Shape decisions read the MENU; per-node facts read scopedPlatforms -------
//
// The detail panel's platform tab strip is a *shape* decision — how many
// platform columns does this surface show — so it reads `scope.platforms`,
// exactly as the Acceptances matrix reads it for its status columns and the
// Pyramid for its rings. Reading `scopedPlatforms(node, scope)` there would
// break the degenerate case: with no products declared that helper answers the
// node's OWN array, so a view declaring only `["web"]` would collapse from three
// tabs to one in a project that has never heard of products. The seed has ten
// such views. The chips are the other half of the distinction and stay per-node:
// "what does this node ship on" genuinely is a fact about the node.

/** A view whose own array is narrower than every menu — the discriminating case. */
const webOnlyView = { id: "V-web-only", species: "view", platforms: ["web"], metadata: {} };

assert(
  eq(bareScope.platforms, ["web", "ios", "android"]),
  "THE DEGENERATE CASE: with no products declared the strip's menu is every platform, whatever the node declares",
);
assert(
  eq(scopedPlatforms(webOnlyView, bareScope), ["web"]) &&
    !eq(scopedPlatforms(webOnlyView, bareScope), bareScope.platforms),
  `…and scopedPlatforms would NOT do — it answers the node's own one-platform array (got ${JSON.stringify(
    scopedPlatforms(webOnlyView, bareScope),
  )})`,
);
assert(
  eq(adminScope.platforms, ["web"]),
  "the menu still collapses the strip to one status under a web-only product — the fix survives the correction",
);

// Which of the two each call site uses is not observable from a pure function,
// so it is read off the source — the same technique as the threshold check
// below, and for the same reason: there is no React test runner here.

const ROOT = path.join(__dirname, "..", "..");
const readSource = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** The props of the one `<PlatformVariants …>` element in a source file. */
function platformVariantsProps(source) {
  const start = source.indexOf("<PlatformVariants");
  return start === -1 ? "" : source.slice(start, source.indexOf(">", start));
}

for (const [label, file] of [
  ["the detail panel", ["components", "panels", "NodeDetailPanel.tsx"]],
  ["the acceptance editor", ["components", "panels", "AcceptanceEditor.tsx"]],
]) {
  const props = platformVariantsProps(readSource(...file));
  assert(
    /platforms=\{scope\.platforms\}/.test(props),
    `${label} builds its tab strip from the scope's menu`,
  );
  assert(
    props !== "" && !props.includes("scopedPlatforms"),
    `…and not from scopedPlatforms, which would break the degenerate case in ${label}`,
  );
}

assert(
  readSource("components", "panels", "AcceptancesSection.tsx").includes("scopedPlatforms(acc, scope)"),
  "the CHIPS stay per-node — 'what does this node ship on' is a fact about the node, not a shape",
);

// --- The arity threshold is written once --------------------------------------
//
// `platformAvailabilityShape` is the only place the 2-platform boundary lives.
// Three surfaces now switch on it (Pyramid rings, Acceptances columns, and the
// detail panel's platform tabs); a second `>= 2` spelled out in any of them is
// a boundary that can drift silently, so the source is checked rather than
// trusted.

const variantsSource = readSource("components", "panels", "PlatformVariants.tsx");

assert(
  variantsSource.includes("platformAvailabilityShape(platforms)"),
  "the detail panel's tab strip asks platformAvailabilityShape for its shape",
);
assert(
  !/platforms\.length\s*(>=|>|<=|<)\s*[0-9]/.test(variantsSource),
  "…and nowhere writes the threshold out a second time",
);
assert(
  platformAvailabilityShape([]) === "bar" &&
    platformAvailabilityShape(["web"]) === "bar" &&
    platformAvailabilityShape(["web", "ios"]) === "rings",
  "the boundary itself: 0 and 1 collapse to one status, 2 earns tabs",
);

// --- scopedPlatforms — the headline assertion --------------------------------

assert(
  eq(allScope.platforms, ["web", "ios", "android"]) && eq(adminView.platforms, ["web", "ios", "android"]),
  "precondition: under All products the scope union and the stale node array are both 3 wide",
);
assert(
  eq(scopedPlatforms(adminView, allScope), ["web"]),
  `THE FIX: under All products a web-only product's view yields ["web"], not the union (got ${JSON.stringify(
    scopedPlatforms(adminView, allScope),
  )})`,
);
assert(
  eq(scopedPlatforms(endUserView, allScope), ["web", "ios"]),
  "a multi-platform product's view keeps its own platforms, ordered by PLATFORM_IDS",
);
assert(
  eq(scopedPlatforms(adminView, adminScope), ["web"]),
  "the same node under its own named scope yields the same answer",
);

// Fallback to scope.product for a membership-less node under a named scope.
assert(
  eq(scopedPlatforms(unassignedView, adminScope), ["web"]),
  "a membership-less node falls back to the scoped product's menu",
);
assert(
  eq(scopedPlatforms(unassignedView, allScope), ["web", "ios", "android"]),
  "under All products a membership-less node has no menu to intersect against and keeps its own list",
);

// A node whose own product is unknown/missing.
assert(
  eq(scopedPlatforms(ghostView, allScope), ["web", "android"]),
  "an unknown product id degrades to the node's own list, never to empty",
);
assert(
  eq(scopedPlatforms(ghostView, adminScope), ["web"]),
  "an unknown product id under a named scope falls back to that scope's menu",
);
assert(
  eq(scopedPlatforms(adminView, bareScope), ["web", "ios", "android"]),
  "with no products declared, every node keeps its own platforms — today's behaviour, unchanged",
);

// --- The store: one value, shared by every consumer -------------------------
//
// The sidebar selector and every surface each call `useProductScope`. If that
// hook held per-component `useState`, picking a product would relabel the
// selector and change nothing else — the feature would be inert. What makes it
// shared is this store, so this is where that is asserted. `useSyncExternalStore`
// adds no logic of its own; it only wires `subscribe` / `getSnapshot` to React.

resetProductScopeStore();

// Two independent consumers, standing in for the selector and a surface.
let selectorNotifications = 0;
let surfaceNotifications = 0;
const unsubscribeSelector = subscribeProductScope(() => selectorNotifications++);
const unsubscribeSurface = subscribeProductScope(() => surfaceNotifications++);

assert(getProductScopeId("P1") === null, "a project with nothing stored starts at All products");

// The selector sets; the surface must observe it.
setProductScopeId("P1", "admin");
assert(
  selectorNotifications === 1 && surfaceNotifications === 1,
  `one set notifies EVERY subscriber, not just the setter (got ${selectorNotifications}/${surfaceNotifications})`,
);
assert(
  getProductScopeId("P1") === "admin",
  "the snapshot a second consumer reads is the value the first one set — the scope is shared",
);

// Snapshot stability: useSyncExternalStore re-reads on every render and warns
// if the value is not referentially cached. A primitive makes that free.
assert(
  getProductScopeId("P1") === getProductScopeId("P1"),
  "repeated snapshot reads are referentially equal, so React never loops",
);

setProductScopeId("P1", "admin");
assert(
  selectorNotifications === 1,
  "setting the value it already holds notifies no one — no render storm from a re-select",
);

setProductScopeId("P1", null);
assert(
  getProductScopeId("P1") === null && selectorNotifications === 2,
  "returning to All products is a real transition, notified like any other",
);

assert(
  getProductScopeId("P2") === null,
  "scope is keyed per project — setting P1 never moved P2",
);

unsubscribeSelector();
setProductScopeId("P1", "enduser");
assert(
  selectorNotifications === 2 && surfaceNotifications === 3,
  `unsubscribing stops notifications for that consumer only (got ${selectorNotifications}/${surfaceNotifications})`,
);

unsubscribeSurface();
resetProductScopeStore();

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll product-scope tests passed");
