#!/usr/bin/env node

/**
 * The panel stack's document semantics — the shape a reader navigates by, as
 * opposed to the shape a reader looks at.
 *
 * Three claims are pinned here, because all three are invisible on screen and
 * so all three can be undone by a well-meaning refactor without anyone noticing
 * until a screen reader lands in the stack:
 *
 *   1. A panel cell is a NAMED `<section>` — that, and only that, makes it a
 *      landmark, which is what lets a reader list the open columns and jump
 *      between them. An `aria-label` dropped, or the tag swapped for a `div`,
 *      silently costs the landmark.
 *   2. Inside it, the record is an `<article>` sharing the cell's name, with
 *      its own `h2`. The section is the slot; the article is what occupies it.
 *   3. The outline runs h1 (the page) → h2 (each open record) → h3 (the
 *      record's own sections), with no rung missing. A lone `h3` under nothing
 *      is exactly the state this stack was in before, and it is why
 *      `PanelSection`'s heading was a `<span>`.
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
assert(
  panelSectionHeadings.length === 2 && panelSectionHeadings.every((element) => element.tag === "h3"),
  "PanelSection heads both its variants with h3",
  `found ${panelSectionHeadings.map((element) => element.tag).join(", ") || "none"}`,
);

// Every heading in a panel module is h3, bar the record's own h2 in the stack.
// h4 is the tell that someone nested a section inside a section without saying
// so; h2 anywhere else is a second record where there is only one.
const panelFiles = fs
  .readdirSync(PANELS_DIR)
  .filter((name) => name.endsWith(".tsx") && name !== "PanelStack.tsx");

const strays = [];
for (const name of panelFiles) {
  const source = parse(path.join(PANELS_DIR, name));
  for (const element of elements(source)) {
    // Dialogs are their own documents — they carry a DialogTitle, not a rung of
    // this outline.
    if (HEADINGS.has(element.tag) && element.tag !== "h3" && !name.endsWith("Dialog.tsx")) {
      strays.push(`${name}:${element.tag}`);
    }
  }
}
assert(strays.length === 0, "panel bodies head their sections at h3", strays.join(", "));

// --- the invariant that catches the next one --------------------------------

// A `<section>` earns the tag by naming itself or by heading itself. One that
// does neither is a `div` with opinions: the accessibility tree flattens it to
// a generic box, and the outline never learns it was there.
const unnamed = [];
for (const name of [...panelFiles, "PanelStack.tsx"]) {
  const source = parse(path.join(PANELS_DIR, name));
  for (const element of elements(source)) {
    if (element.tag !== "section") continue;
    const named =
      attr(element.opening, "aria-label") !== null ||
      attr(element.opening, "aria-labelledby") !== null;
    const headed =
      ts.isJsxElement(element.node) &&
      elements(element.node).some((child) => HEADINGS.has(child.tag));
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
