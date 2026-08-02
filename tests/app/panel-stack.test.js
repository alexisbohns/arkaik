#!/usr/bin/env node

/**
 * Push-panel stack semantics (lib/utils/panel-stack.ts). Pins the one rule —
 * a click in panel `i` owns everything above `i` — and the two things that are
 * easy to get subtly wrong: instanceId identity (a refresh keeps per-panel UI
 * state, a swap must not inherit it) and the three reconcile paths, which are
 * the only place the stack infers intent rather than being told it.
 */

const fs = require("fs");
const { loadPanelStack, BUILD_DIR } = require("./load-panel-stack");

const {
  initStack,
  openFrom,
  closeAt,
  unwindTo,
  reconcileArrival,
  visibleFrom,
  visibleWindow,
} = loadPanelStack();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const keys = (stack) => stack.map((entry) => entry.key).join(" · ");
const payload = (key) => ({ nodeId: key });

// --- open from the surface (depth 0): push, then swap ---
const empty = initStack();
assert(empty.length === 0, "a fresh stack is empty");

const withA = openFrom(empty, 0, "A", payload("A"));
assert(keys(withA) === "A", `canvas click opens one panel (got "${keys(withA)}")`);
assert(withA[0].payload.nodeId === "A", "the entry carries its payload");
assert(empty.length === 0, "inputs are not mutated");

const withB = openFrom(withA, 0, "B", payload("B"));
assert(keys(withB) === "B", `a second canvas click swaps, not pushes (got "${keys(withB)}")`);
assert(
  withB[0].instanceId !== withA[0].instanceId,
  "a swap replaces the instanceId — per-panel state must not bleed between entities",
);

// --- open from inside a panel (depth 1): push ---
const withAB = openFrom(withA, 1, "B", payload("B"));
assert(keys(withAB) === "A · B", `a click inside panel A pushes (got "${keys(withAB)}")`);
assert(withAB[0] === withA[0], "the panel navigated from is untouched (same object)");

const withABC = openFrom(withAB, 2, "C", payload("C"));
assert(keys(withABC) === "A · B · C", `the stack keeps growing (got "${keys(withABC)}")`);

// --- a click in panel i owns everything above i ---
const reopenedFromA = openFrom(withABC, 1, "D", payload("D"));
assert(
  keys(reopenedFromA) === "A · D",
  `opening from panel A drops everything above it (got "${keys(reopenedFromA)}")`,
);
const fromCanvas = openFrom(withABC, 0, "Z", payload("Z"));
assert(keys(fromCanvas) === "Z", `a canvas click collapses the whole trail (got "${keys(fromCanvas)}")`);

// --- refresh: the same key landing back in the same slot keeps its instance ---
const refreshed = openFrom(withAB, 1, "B", payload("B"));
assert(keys(refreshed) === "A · B", "re-opening the same node into the same slot keeps the shape");
assert(
  refreshed[1].instanceId === withAB[1].instanceId,
  "a refresh keeps the instanceId — scroll position and in-progress edits survive",
);
assert(
  refreshed[1] !== withAB[1] && refreshed[1].payload !== withAB[1].payload,
  "a refresh still adopts the fresh payload",
);

const refreshedTail = openFrom(withABC, 1, "B", payload("B"));
assert(
  keys(refreshedTail) === "A · B" && refreshedTail[1].instanceId === withABC[1].instanceId,
  "a refresh drops the panels above it while keeping its own instance",
);

// --- self-link: a reference to the node you are already reading ---
const selfLink = openFrom(withAB, 2, "B", payload("B"));
assert(
  keys(selfLink) === "A · B",
  `clicking B from inside B refreshes in place, no duplicate column (got "${keys(selfLink)}")`,
);
assert(
  selfLink[1].instanceId === withAB[1].instanceId,
  "the self-link refresh keeps the panel's instanceId",
);

// --- closing ---
const closedTop = closeAt(withABC, 2);
assert(keys(closedTop) === "A · B", `closing the top pops it (got "${keys(closedTop)}")`);

const closedBelow = closeAt(withAB, 0);
assert(
  keys(closedBelow) === "B",
  `closing a panel that isn't the top leaves the ones above (got "${keys(closedBelow)}")`,
);
assert(closedBelow[0] === withAB[1], "the surviving panel keeps its identity when one below closes");
assert(closeAt(withAB, 7) === withAB, "closing an out-of-range index is a no-op");

// --- unwinding ---
assert(keys(unwindTo(withABC, 1)) === "A", "the breadcrumb unwinds to a depth");
assert(unwindTo(withABC, 0).length === 0, "unwinding to the surface closes the stack");
assert(
  keys(unwindTo(withABC, withABC.length - 1)) === "A · B",
  "Escape pops exactly one panel",
);
assert(unwindTo(withABC, 3) === withABC, "unwinding to the current depth is a no-op");
assert(unwindTo(withABC, 9) === withABC, "unwinding past the top is a no-op");
assert(unwindTo(withABC, 1)[0] === withABC[0], "unwinding keeps the surviving entries' identity");

// --- reconcileArrival, path 1: the id is already the top (we published it) ---
assert(
  reconcileArrival(withABC, "C", payload("C")) === withABC,
  "an id that is already the top returns the very same stack — no churn",
);

// --- reconcileArrival, path 2: the id sits below the top (Back, or a jump) ---
const backToA = reconcileArrival(withABC, "A", payload("A"));
assert(keys(backToA) === "A", `Back unwinds to the arriving id (got "${keys(backToA)}")`);
assert(backToA[0] === withABC[0], "Back keeps the surviving panel mounted (same instance)");

// --- reconcileArrival, path 3: the id is unknown (Forward, or a cold load) ---
const forwardToC = reconcileArrival(withAB, "C", payload("C"));
assert(
  keys(forwardToC) === "A · B · C",
  `Forward re-opens the popped branch rather than flattening it (got "${keys(forwardToC)}")`,
);
const coldLoad = reconcileArrival(initStack(), "V-landing", payload("V-landing"));
assert(
  keys(coldLoad) === "V-landing",
  `a cold load of ?node=X opens exactly one panel (got "${keys(coldLoad)}")`,
);

// --- reconcileArrival: no id at all closes the stack ---
assert(reconcileArrival(withABC, null, null).length === 0, "a missing id closes the stack");
const alreadyEmpty = initStack();
assert(
  reconcileArrival(alreadyEmpty, null, null) === alreadyEmpty,
  "a missing id on an empty stack returns the same array — no render loop",
);

// --- visibility rule: the surface is a column like any other ---
assert(visibleFrom(0, 2) === 0, "an empty stack has nothing to skip");
assert(visibleFrom(2, 2) === 0, "two cells both render");
assert(visibleFrom(6, 2) === 4, "six cells render only the top two");
assert(visibleFrom(6, 1) === 5, "one column renders only the topmost cell");

const win = (panels, columns) => {
  const w = visibleWindow(panels, columns);
  return `${w.surfaceVisible ? "surface" : "-"}|from:${w.firstVisiblePanel}|cols:${w.columnCount}`;
};

// Two columns — the femfolk window. The surface is pushed out by the same rule
// that hides deep panels, so the newest two things are always what you see.
assert(win(0, 2) === "surface|from:0|cols:1", `no panels: the surface alone (${win(0, 2)})`);
assert(win(1, 2) === "surface|from:0|cols:2", `one panel: surface + panel (${win(1, 2)})`);
assert(win(2, 2) === "-|from:0|cols:2", `two panels: both panels, surface retires (${win(2, 2)})`);
assert(win(3, 2) === "-|from:1|cols:2", `three panels: the top two only (${win(3, 2)})`);
assert(win(6, 2) === "-|from:4|cols:2", `six panels: still the top two (${win(6, 2)})`);

// One column — below 768px, exactly one cell, always the newest.
assert(win(0, 1) === "surface|from:0|cols:1", `mobile, no panels: the surface (${win(0, 1)})`);
assert(win(1, 1) === "-|from:0|cols:1", `mobile, one panel: the panel replaces the surface (${win(1, 1)})`);
assert(win(3, 1) === "-|from:2|cols:1", `mobile, three panels: the top one (${win(3, 1)})`);

assert(win(2, 0) === win(2, 1), "a nonsensical column budget floors at one");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll panel-stack tests passed");
