#!/usr/bin/env node

/**
 * The weighing UI's contract (docs/rfcs/weighing.md), read off the SOURCE —
 * the idiom tests/app/panel-semantics.test.js uses, for the same reason: the
 * panel is a client component wired to hooks and refs, and standing a React
 * runtime up would test the stubs as much as the markup.
 *
 * What is pinned is what a later design pass (skill `redesigning-with-tweaks`)
 * must not break while it reshapes the look:
 *  - the form is built from `PanelGroup` + `PanelSection`, never a bare heading
 *    (the panel stack's outline is asserted elsewhere and this must not undo it);
 *  - every part carries a `data-weighing-*` hook, so a stylesheet has something
 *    to hold on to;
 *  - the numbers come from `@arkaik/schema`'s derivation, never recomputed here;
 *  - the form never sends a scorer: provenance is stamped by the writer, so a
 *    person cannot be recorded as an agent or the reverse;
 *  - the group is mounted for acceptances only, read-only without a save path;
 *  - the positioning editor saves a DRAFT by default and activates only on its
 *    own button; and the hook invalidates the project after a write.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
/** A file that does not exist yet reads as empty, so a missing piece is a FAIL, not a crash. */
const read = (...parts) => {
  try {
    return fs.readFileSync(path.join(ROOT, ...parts), "utf8");
  } catch {
    return "";
  }
};

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const group = read("components", "panels", "WeighingGroup.tsx");
const positioning = read("components", "settings", "PositioningPanel.tsx");
const hook = read("lib", "hooks", "useWeighing.ts");
const detail = read("components", "panels", "NodeDetailPanel.tsx");
const settings = read("app", "project", "[id]", "settings", "page.tsx");
const describe = read("components", "journal", "describe-event.ts");

// --- the acceptance-panel form ------------------------------------------------
check("the form is a PanelGroup with PanelSections", /<PanelGroup\b/.test(group) && /<PanelSection\b/.test(group));
check("the form renders no bare heading — the panel stack owns the outline", !/<h[1-6][\s>]/.test(group));
for (const hookName of ["data-weighing", "data-weighing-element", "data-weighing-served", "data-weighing-cost", "data-weighing-kept", "data-weighing-guesswork", "data-weighing-scorer", "data-weighing-stale", "data-weighing-review", "data-weighing-flags", "data-weighing-add"]) {
  check(`the form carries ${hookName}`, group.includes(hookName));
}
check("the numbers come from the schema's derivation", /buildWeighingContext/.test(group) && /weighPromise/.test(group) && /from "@arkaik\/schema"/.test(group));
check("the form never sends a scorer — the writer stamps it", !/\bscorer\s*:\s*\{/.test(group) && !/\bbasis\s*:/.test(group));
check("a write is one weighing.assessment.recorded through record()", /WEIGHING_ASSESSMENT_RECORDED/.test(group) && /await record\(\[input\]\)/.test(group));
check("a refused write is a toast, and the list re-reads either way", /toast\.error/.test(group) && /finally/.test(group));
check("a first human score defaults to confidence 1, never a silent guess", /mine\?\.confidence \?\? 1/.test(group));
check("a person never inherits an agent's evidence", /cell\?\.source === "stored" && cell\.scorer\.kind === "human"/.test(group));
check("the claimed elements are listed first, then 'Add an element'", /Add an element/.test(group) && /claimed/.test(group));
check("a read-only panel offers no controls", /readOnly/.test(group) && /data-weighing-readonly/.test(group));

// --- where it is mounted --------------------------------------------------------
check("NodeDetailPanel mounts the group for acceptances only", /node\.species === "acceptance" && <WeighingGroup/.test(detail));
check("…read-only without a save path", /<WeighingGroup[^>]*readOnly=\{!onUpdate\}/.test(detail));
check("…keyed per record, like its siblings", /<WeighingGroup key=\{`weighing-\$\{node\.id\}`\}/.test(detail));

// --- the hook ----------------------------------------------------------------------
check("useWeighing writes through the provider's appendWeighingEvents", /appendWeighingEvents/.test(hook));
check("…and invalidates the project so a caller reads its own write", /invalidateProject\(projectId\)/.test(hook));
check("…and refuses with a reason when the provider cannot", /cannot record assessments/.test(hook));

// --- the positioning editor ------------------------------------------------------------
check("the editor saves a weighing.set.saved", /WEIGHING_SET_SAVED/.test(positioning));
check("it has a draft button and an activate button", /Save as draft/.test(positioning) && /Save and activate/.test(positioning));
check("the draft button saves a draft; only the other activates", /save\("draft"\)/.test(positioning) && /save\("active"\)/.test(positioning));
check("it says a draft weighs nothing", /feeds no weight until/.test(positioning));
check("it carries data hooks", ["data-positioning", "data-positioning-element", "data-positioning-draft"].every((h) => positioning.includes(h)));
check("Settings mounts it, in the project's own words", /<PositioningPanel projectId=\{id\}/.test(settings) && /<h2 className="text-lg font-semibold">Positioning<\/h2>/.test(settings));

// --- History ----------------------------------------------------------------------------
check("History words both weighing events instead of printing a raw type", /case "weighing\.assessment\.recorded"/.test(describe) && /case "weighing\.set\.saved"/.test(describe));

if (failures > 0) {
  console.log(`\n${failures} weighing-panel test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-panel tests passed.");
