#!/usr/bin/env node

/**
 * The panel stack's document semantics — the shape a reader navigates by, as
 * opposed to the shape a reader looks at.
 *
 * Four claims are pinned here, because every one of them is invisible on screen
 * and so every one can be undone by a well-meaning refactor without anyone
 * noticing until a screen reader lands in the stack:
 *
 *   1. A panel cell is a NAMED `<section>` — that, and only that, makes it a
 *      landmark, which is what lets a reader list the open columns and jump
 *      between them. An `aria-label` dropped, or the tag swapped for a `div`,
 *      silently costs the landmark.
 *   2. Inside it, the record is an `<article>` sharing the cell's name, with
 *      its own `h2`. The section is the slot; the article is what occupies it.
 *   3. The outline runs h1 (the page) → h2 (each open record) → h3 (a
 *      `PanelGroup`'s bar, or a section standing on its own) → h4 (a section
 *      inside a group), with no rung missing. A lone `h3` under nothing is
 *      exactly the state this stack was in before, and it is why
 *      `PanelSection`'s heading was a `<span>`.
 *   4. A `PanelGroup`'s bar is a disclosure — one `h3` whose whole content is
 *      the trigger — so the region is an outline entry and a control at once,
 *      and it re-applies the panel gutter rather than bleeding past it.
 *
 * Static, over the TypeScript AST rather than a render: `PanelStack` is a
 * client component wired to `useIsMobile`, refs and four effects, and standing
 * a React runtime up to read its markup would test the stubs as much as the
 * markup. What is asserted here is the source's own shape, which is precisely
 * what a refactor changes.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const PANELS_DIR = path.join(ROOT, "components", "panels");

let failures = 0;
function assert(cond, message, detail) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

function parse(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
}

/** Every JSX element in `node`, as `{ tag, opening, node }`. */
function elements(node) {
  const found = [];
  const visit = (current) => {
    if (ts.isJsxElement(current)) {
      found.push({
        tag: current.openingElement.tagName.getText(),
        opening: current.openingElement,
        node: current,
      });
    } else if (ts.isJsxSelfClosingElement(current)) {
      found.push({ tag: current.tagName.getText(), opening: current, node: current });
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/**
 * Components declared in this file whose own JSX renders a heading.
 *
 * A `<section>` heads itself when a heading is one hop inside it, and one hop
 * is exactly what factoring a heading into a local component costs. Matching
 * the component by NAME would be too generous: `components/layout/SectionHeading`
 * is a different exported component of the same name that heads at `h2`, and a
 * panel importing it would satisfy a name check while breaking the outline.
 * Resolving to a local declaration that demonstrably renders a heading closes
 * that, and couples the allowance to the fact it stands on — gut the component
 * and it drops out of this set rather than staying blessed by its name.
 *
 * One hop is as far as this resolves, so what it proves is that a heading exists
 * somewhere in the component, not that every path through it renders one: a
 * component heading on one branch and returning `null` on another still
 * qualifies. That residual looseness is accepted deliberately — the only way to
 * close it is to evaluate the component, which is the render this file exists to
 * avoid.
 */
function localHeadingComponents(source) {
  const names = new Set();
  const heads = (node) => elements(node).some((el) => HEADINGS.has(el.tag));
  const visit = (node) => {
    // Both spellings: this repo writes components as `function Foo()` and as
    // `const Foo = () => …`, and a set that saw only the first would report a
    // section whose heading is plainly there as unheaded.
    if (ts.isFunctionDeclaration(node) && node.name && heads(node)) {
      names.add(node.name.getText());
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      heads(node.initializer)
    ) {
      names.add(node.name.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * An attribute's value as source text — `{expr}` collapses to `expr`, a string
 * literal to its contents. Comparing text is enough for the identity checks
 * below: the three places that must agree are three references to the same
 * local, so they either read the same or the wiring is broken.
 */
function attr(element, name) {
  const found = element.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  if (!found || !found.initializer) return null;
  if (ts.isStringLiteral(found.initializer)) return found.initializer.text;
  if (ts.isJsxExpression(found.initializer) && found.initializer.expression) {
    return found.initializer.expression.getText();
  }
  return null;
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

// --- 1 + 2: the cell, and the record inside it ------------------------------

const stack = parse(path.join(PANELS_DIR, "PanelStack.tsx"));
const stackElements = elements(stack);

const sections = stackElements.filter((element) => element.tag === "section");
assert(sections.length === 2, `PanelStack renders two section cells (found ${sections.length})`);

// The surface cell names itself directly; the panel cell points at its heading.
const surfaceCell = sections.find((element) => attr(element.opening, "aria-label") !== null);
const panelCell = sections.find((element) => attr(element.opening, "aria-labelledby") !== null);

assert(surfaceCell !== undefined, "the surface cell is a named section (aria-label)");
assert(panelCell !== undefined, "the panel cell is a named section (aria-labelledby)");

if (panelCell) {
  const headingId = attr(panelCell.opening, "aria-labelledby");
  const inside = elements(panelCell.node);

  const header = inside.find((element) => element.tag === "header");
  assert(header !== undefined, "the panel cell carries a header — the stack's own chrome");

  const article = inside.find((element) => element.tag === "article");
  assert(article !== undefined, "the panel cell holds an article — the record itself");

  if (article) {
    assert(
      attr(article.opening, "aria-labelledby") === headingId,
      "the article and its cell answer to the same name",
      `section=${headingId} article=${attr(article.opening, "aria-labelledby")}`,
    );

    const heading = elements(article.node).find((element) => element.tag === "h2");
    assert(heading !== undefined, "the record names itself with an h2");

    if (heading) {
      assert(
        attr(heading.opening, "id") === headingId,
        "the h2 is what both aria-labelledby point at",
        `h2 id=${attr(heading.opening, "id")}`,
      );
      // Not decoration: the panel's visible identity is chips in the header, and
      // a node's title is an editable field in the body. Neither can be the
      // heading, so the heading exists for the outline alone.
      assert(
        (attr(heading.opening, "className") ?? "").includes("sr-only"),
        "the h2 is sr-only — the visible identity is the header's chips",
      );
    }

    // The close button belongs to the stack, not to the record, and the focus
    // bookkeeping in `runClose` reads `closest("section")` from it.
    assert(
      elements(article.node).every((element) => element.tag !== "header"),
      "the header stays outside the article",
    );
  }
}

// --- 3: the outline, rung by rung -------------------------------------------

const pageHeader = parse(path.join(ROOT, "components", "layout", "PageHeader.tsx"));
const pageHeadings = elements(pageHeader).filter((element) => HEADINGS.has(element.tag));
assert(
  pageHeadings.length === 1 && pageHeadings[0].tag === "h1",
  "PageHeader names the page h1 — the rung every panel h2 hangs off",
  `found ${pageHeadings.map((element) => element.tag).join(", ") || "none"}`,
);

const panelSection = parse(path.join(PANELS_DIR, "PanelSection.tsx"));
const panelSectionHeadings = elements(panelSection).filter((element) => HEADINGS.has(element.tag));
// Exactly one of each, in one ternary: standalone the section is the record's
// own level-three, nested in a group it is the group's level-four. Written as a
// pair of literal tags rather than a computed `<Heading>` so that this check can
// still see which levels exist — a dynamic tag name would make the outline
// unreadable to everything but a browser.
assert(
  panelSectionHeadings.length === 2 &&
    panelSectionHeadings.some((element) => element.tag === "h3") &&
    panelSectionHeadings.some((element) => element.tag === "h4"),
  "PanelSection heads at h3 standalone and h4 inside a group",
  `found ${panelSectionHeadings.map((element) => element.tag).join(", ") || "none"}`,
);

// Every heading in a panel module is h3 or h4, bar the record's own h2 in the
// stack: h3 for a group bar or a standalone section, h4 for a section inside a
// group. Anything else is a rung this outline does not have.
const panelFiles = fs
  .readdirSync(PANELS_DIR)
  .filter((name) => name.endsWith(".tsx") && name !== "PanelStack.tsx");

const strays = [];
for (const name of panelFiles) {
  const source = parse(path.join(PANELS_DIR, name));
  for (const element of elements(source)) {
    // h4 is now legal — it is the rung a `PanelSection` takes inside a
    // `PanelGroup`. h1, h2, h5 and h6 in a panel body still are not: h2 would
    // be a second record where there is only one, and h5 a level nothing in
    // this outline reaches. Dialogs are exempt wholesale — they are their own
    // documents, carrying a DialogTitle rather than a rung of this outline.
    const legal = element.tag === "h3" || element.tag === "h4";
    if (HEADINGS.has(element.tag) && !legal && !name.endsWith("Dialog.tsx")) {
      strays.push(`${name}:${element.tag}`);
    }
  }
}
assert(strays.length === 0, "panel bodies head their sections at h3 or h4", strays.join(", "));

// --- 4: the group bar, and the rung it adds ---------------------------------

const panelGroup = parse(path.join(PANELS_DIR, "PanelGroup.tsx"));
const groupElements = elements(panelGroup);

// The bar is a disclosure: a heading whose whole content is the button that
// opens it. Either half alone is a different, worse thing — a heading that
// cannot be operated, or a button the outline cannot see.
const groupHeading = groupElements.find((element) => element.tag === "h3");
assert(groupHeading !== undefined, "PanelGroup heads its bar with an h3");

if (groupHeading) {
  const trigger = elements(groupHeading.node).find(
    (element) => element.tag === "CollapsibleTrigger",
  );
  assert(
    trigger !== undefined,
    "the h3's content is the CollapsibleTrigger — the bar is a disclosure",
  );
}

// The panel body has no horizontal padding, so a group is already full width;
// applying the section bleed on top of that would push the bar out of the
// panel. This is the assertion that catches someone "fixing" the gutter.
//
// Read off the import specifiers, not the source text. Grepping would be wrong
// twice over: `PANEL_GUTTER_BLEED` contains `PANEL_GUTTER`, so the positive
// check passes on the very token the negative one forbids; and this repo
// documents its rejected alternatives in prose, so the docblock explaining why
// the bleed is deliberately unused would itself trip the negative check.
const groupImports = new Set();
for (const statement of panelGroup.statements) {
  if (!ts.isImportDeclaration(statement)) continue;
  const bindings = statement.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) continue;
  for (const specifier of bindings.elements) groupImports.add(specifier.name.getText());
}
assert(
  !groupImports.has("PANEL_GUTTER_BLEED"),
  "PanelGroup does not bleed — it is already flush with the panel's edges",
);
assert(
  groupImports.has("PANEL_GUTTER"),
  "PanelGroup re-applies the panel gutter inside its bar",
);

// --- 5: History opens shut --------------------------------------------------

const nodePanel = parse(path.join(PANELS_DIR, "NodeDetailPanel.tsx"));
const nodePanelGroups = elements(nodePanel).filter((element) => element.tag === "PanelGroup");

const historyGroup = nodePanelGroups.find((element) => attr(element.opening, "title") === "History");
assert(historyGroup !== undefined, "the node panel wraps History in a PanelGroup");

if (historyGroup) {
  assert(
    attr(historyGroup.opening, "defaultOpen") === "false",
    "the History group opens shut — it fetches the journal to render a feed nobody scrolled to",
    `defaultOpen=${attr(historyGroup.opening, "defaultOpen")}`,
  );
}

// Rendered by RelationsGroup, not inline here — so its absence from this file is
// expected, and what is pinned instead is that the node panel mounts it.
const mountsRelations = elements(nodePanel).some((element) => element.tag === "RelationsGroup");
assert(mountsRelations, "the node panel mounts RelationsGroup");
const relationsGroup = nodePanelGroups.find(
  (element) => attr(element.opening, "title") === "Relations",
);
assert(
  relationsGroup === undefined,
  "Relations is not also opened inline — one component owns that bar",
);

// --- the invariant that catches the next one --------------------------------

// A `<section>` earns the tag by naming itself or by heading itself. One that
// does neither is a `div` with opinions: the accessibility tree flattens it to
// a generic box, and the outline never learns it was there.
const unnamed = [];
for (const name of [...panelFiles, "PanelStack.tsx"]) {
  const source = parse(path.join(PANELS_DIR, name));
  // A heading one hop away still heads the section — factoring the heading into
  // a local component (`PanelSection`'s `SectionHeading`) does not un-head it.
  // Resolved to a declaration in this same file that renders a heading, never
  // matched by name: `components/layout/SectionHeading` is an unrelated
  // component of that exact name which heads at `h2`, and a name check would
  // bless a panel importing it while the stray scan — which only reads this
  // directory — never saw the `h2`.
  const local = localHeadingComponents(source);
  for (const element of elements(source)) {
    if (element.tag !== "section") continue;
    const named =
      attr(element.opening, "aria-label") !== null ||
      attr(element.opening, "aria-labelledby") !== null;
    const headed =
      ts.isJsxElement(element.node) &&
      elements(element.node).some((child) => HEADINGS.has(child.tag) || local.has(child.tag));
    if (!named && !headed) unnamed.push(`${name}:${element.opening.getStart()}`);
  }
}
assert(
  unnamed.length === 0,
  "every section in a panel module either names itself or heads itself",
  unnamed.join(", "),
);

if (failures > 0) {
  console.error(`\n${failures} panel-semantics check(s) failed`);
  process.exit(1);
}
console.log("\nAll panel-semantics tests passed");
