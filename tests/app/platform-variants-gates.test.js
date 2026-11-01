#!/usr/bin/env node

/**
 * `PlatformVariants` renders a screenshot write control only when the handler
 * that would carry it is passed (#531).
 *
 * Read-only surfaces (overview, pyramid, history…) mount the panel without
 * `onRecordScreenshot` / `onRemoveScreenshot`. Before the fix they still drew
 * the drop zone, the URL field and the Remove button, and every one of them
 * silently did nothing. The gate is the same shape `AcceptancePlatformsSection`
 * has on `onUpdate`: no handler, no control.
 *
 * Static, over the TypeScript AST rather than a render — there is no React
 * runtime in this suite (see `panel-semantics.test.js` for the reasoning). Each
 * control is found by a mark that survives restyling, then its ancestors are
 * walked to prove it only renders on the side of a condition where the handler
 * is present.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const FILE = path.join(__dirname, "..", "..", "components", "panels", "PlatformVariants.tsx");
const source = ts.createSourceFile(FILE, fs.readFileSync(FILE, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

let failures = 0;
function assert(cond, message, detail) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Every JSX element, as `{ tag, opening, node }`. */
function elements(node, out = []) {
  if (ts.isJsxElement(node)) {
    out.push({ tag: node.openingElement.tagName.getText(source), opening: node.openingElement, node });
  } else if (ts.isJsxSelfClosingElement(node)) {
    out.push({ tag: node.tagName.getText(source), opening: node, node });
  }
  // A block body, not `(child) => elements(child, out)`: `forEachChild` stops at
  // the first truthy return, and `out` is always truthy.
  ts.forEachChild(node, (child) => {
    elements(child, out);
  });
  return out;
}

function attr(opening, name) {
  const found = opening.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(source) === name);
  if (!found || !found.initializer) return undefined;
  return ts.isStringLiteral(found.initializer) ? found.initializer.text : found.initializer.getText(source);
}

/**
 * Whether `node` only renders when `handler` is truthy: some ancestor is
 * `handler && <…node…>`, `handler ? <…node…> : …`, or `!handler ? … : <…node…>`.
 */
function gatedOn(node, handler) {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === child &&
      parent.left.getText(source) === handler
    ) {
      return true;
    }
    if (ts.isConditionalExpression(parent)) {
      const cond = parent.condition.getText(source);
      if (cond === handler && parent.whenTrue === child) return true;
      if (cond === `!${handler}` && parent.whenFalse === child) return true;
    }
  }
  return false;
}

const all = elements(source);
const controls = [
  {
    label: "the Remove button",
    handler: "onRemoveScreenshot",
    find: (e) => e.tag === "Button" && attr(e.opening, "aria-label") === "Remove screenshot",
  },
  {
    label: "the drop zone",
    handler: "onRecordScreenshot",
    find: (e) => e.tag === "div" && attr(e.opening, "role") === "button" && attr(e.opening, "onDrop") !== undefined,
  },
  {
    label: "the URL field's form",
    handler: "onRecordScreenshot",
    find: (e) => e.tag === "form",
  },
  {
    label: "the hidden file input",
    handler: "onRecordScreenshot",
    find: (e) => e.tag === "input" && attr(e.opening, "type") === "file",
  },
];

for (const { label, handler, find } of controls) {
  const matches = all.filter(find);
  assert(matches.length === 1, `exactly one ${label} in PlatformVariants`, `found ${matches.length}`);
  if (matches.length === 1) {
    assert(gatedOn(matches[0].node, handler), `${label} renders only when ${handler} is passed`);
  }
}

// The read-only branch says there is nothing, rather than leaving the field blank.
assert(
  /:\s*!onRecordScreenshot\s*\?/.test(source.text) && source.text.includes("No screenshot"),
  "with no shot and no record handler, the field reads “No screenshot”",
);

// The status and notes controls are NOT gated here: the view section always
// passes their handlers. Pinning that keeps this test from passing because a
// refactor hid the whole field set.
assert(
  all.some((e) => e.tag === "Textarea") && all.some((e) => e.tag === "Select"),
  "the notes and status controls still render",
);

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
