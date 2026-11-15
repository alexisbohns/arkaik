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
const ts = require("typescript");

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

/** The pure merge, loaded without a build directory: transpiled and evaluated in place. It imports nothing. */
function loadHelper() {
  const source = read("lib", "utils", "weighing-input.ts");
  if (source === "") return {};
  const { outputText } = ts.transpileModule(source, { fileName: "weighing-input.ts", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const mod = { exports: {} };
  new Function("module", "exports", outputText)(mod, mod.exports);
  return mod.exports;
}
const helper = loadHelper();
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
check("a write is one weighing.assessment.recorded through record()", /WEIGHING_ASSESSMENT_RECORDED/.test(group) && /await record\(\[\{ type: WEIGHING_ASSESSMENT_RECORDED/.test(group));
check("a refused write is a toast, and the list re-reads either way", /toast\.error/.test(group) && /finally/.test(group));
check("the merge, not the form, decides what a first human score carries", /assessmentFieldsFor/.test(group));
check("the claimed elements are listed first, then 'Add an element'", /Add an element/.test(group) && /claimed/.test(group));
check("a read-only panel offers no controls", /readOnly/.test(group) && /data-weighing-readonly/.test(group));

// --- the write is a merge, serialized per row (the stale-closure bug) --------------------
const humanCell = (over = {}) => ({ level: 1, confidence: 1, source: "stored", scorer: { kind: "human" }, evidence: "old words", ...over });
const agentCell = (over = {}) => ({ level: 2, confidence: 2, source: "stored", scorer: { kind: "agent" }, evidence: "the agent's reading", ...over });
const seedCell = { level: 3, confidence: 0, source: "seed", scorer: { kind: "rule" } };
const { assessmentFieldsFor, evidenceChanged, intentOf, currentIntent } = helper;
check("the merge helper exists, with no runtime import", typeof assessmentFieldsFor === "function" && !/^import (?!type)/m.test(read("lib", "utils", "weighing-input.ts")));
if (typeof assessmentFieldsFor === "function") {
  // Reproduction 1: type evidence, click a confidence. The blur saves A; the click builds B from the SAME stale cell.
  const afterBlur = intentOf(assessmentFieldsFor(humanCell(), undefined, { evidence: "typed words" }));
  check("a confidence click after typing keeps the typed evidence", assessmentFieldsFor(humanCell(), afterBlur, { confidence: 2 })?.evidence === "typed words");
  // Reproduction 2: click +3, click a confidence before the refetch lands.
  const afterLevel = intentOf(assessmentFieldsFor(humanCell(), undefined, { level: 3 }));
  check("a confidence click after a level click keeps the new level", assessmentFieldsFor(humanCell(), afterLevel, { confidence: 2 })?.level === 3);
  check("a level click after typing keeps the typed evidence", eq(assessmentFieldsFor(humanCell(), afterBlur, { level: -1 }), { level: -1, confidence: 1, evidence: "typed words" }));
  check("the gesture's own field beats what the row last said", assessmentFieldsFor(humanCell(), afterLevel, { level: -2 })?.level === -2);
  check("a blank row has nothing to write until a level is chosen", assessmentFieldsFor(undefined, undefined, { confidence: 2 }) === undefined && assessmentFieldsFor(undefined, undefined, { evidence: "x" }) === undefined);
  check("a confidence held on a blank row goes out with the level", eq(assessmentFieldsFor(undefined, { confidence: 3 }, { level: -1 }), { level: -1, confidence: 3 }));
  check("a first score defaults to confidence 1", assessmentFieldsFor(undefined, undefined, { level: 1 })?.confidence === 1);
  check("a person never inherits an agent's evidence or confidence", eq(assessmentFieldsFor(agentCell(), undefined, { level: 2 }), { level: 2, confidence: 1 }));
  check("choosing on a guess records the person's own score at that level", eq(assessmentFieldsFor(seedCell, undefined, { level: 3 }), { level: 3, confidence: 1 }));
  check("an evidence typed over a guess is kept with it", assessmentFieldsFor(seedCell, undefined, { evidence: "I read it" })?.evidence === "I read it");
  check("blank evidence is omitted, never sent", !("evidence" in assessmentFieldsFor(humanCell(), undefined, { evidence: "   " })));
  check("clearing the evidence beats the stored one, and sticks", !("evidence" in assessmentFieldsFor(humanCell(), intentOf({ level: 1, confidence: 1 }), { confidence: 2 })));
  check("a patch carrying undefined never overwrites a value", assessmentFieldsFor(humanCell(), undefined, { level: undefined, confidence: 2 })?.level === 1);
  check("the cell is not mutated", (() => { const c = humanCell(); assessmentFieldsFor(c, undefined, { level: 3 }); return eq(c, humanCell()); })());
  check("a blur with the same text is not worth a write", evidenceChanged(humanCell(), undefined, "old words") === false);
  check("…nor one that only repeats what was just sent", evidenceChanged(humanCell(), afterBlur, "typed words") === false);
  check("…but different text is", evidenceChanged(humanCell(), afterBlur, "more words") === true);
  check("…and an empty box over an agent's evidence is no change", evidenceChanged(agentCell(), undefined, "") === false);
  check("currentIntent reads the person's own confidence only", currentIntent(agentCell(), undefined).confidence === undefined);
}

const evidenceBox = (group.match(/<Textarea\b[\s\S]*?\/>/) ?? [""])[0];
check("the evidence box saves on blur, never per keystroke", /onBlur=/.test(evidenceBox) && !/onChange=/.test(evidenceBox));
check("a write reads the box's live value, not the cached cell", /textareas\.current/.test(group) && /\.value/.test(group));
check("every write is built by the merge, after the previous one settled", /assessmentFieldsFor\(/.test(group) && /queues\.current/.test(group) && /\.then\(/.test(group));
check("a failed write gives back what the row last said", /lastSent\.current/.test(group) && /\.delete\(|\.set\(criterion, before\)/.test(group));
check("pending is per row, and no strip is disabled by it", /data-pending/.test(group) && !/<SegmentedControl[^>]*disabled/.test(group));
check("the evidence of a score that is not the person's is shown", /data-weighing-evidence/.test(group));
check("both strips carry a visible label", />\s*Level\s*</.test(group) && />\s*How sure\s*</.test(group));
check("each confidence option explains itself", /CONFIDENCE_ANCHORS\[level\]/.test(group) && /title/.test(read("components", "ui", "segmented-control.tsx")));

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
check("History names the element and writes a minus as one", /VALUE_CONTRIBUTION_SET/.test(describe) && /\\u2212|−/.test(describe) && /with evidence/.test(describe));
check("the static malformed notice is not a live region", !/data-positioning-malformed role="status"/.test(positioning) && !/role="status"/.test(positioning));

if (failures > 0) {
  console.log(`\n${failures} weighing-panel test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-panel tests passed.");
