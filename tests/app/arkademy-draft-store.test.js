#!/usr/bin/env node

/**
 * Your own canvas's store (lib/hooks/useCanvasDraft.ts), in Node: a fake
 * `window` with an in-memory Storage and fake timers stand in for the browser.
 * Load, the write throttle, the flush on page hide and on leaving the page,
 * another tab's write, storage that is blocked, full or refuses writes, a
 * draft from a newer build, and an unreadable one.
 *
 * Loaded through tests/app/load-arkademy-tsx.js (the store imports
 * lib/arkademy/ with "@/" paths and React). DB-free: CI's build job.
 */

const { requireTsx } = require("./load-arkademy-tsx");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}
function same(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

const KEY = "arkaik:arkademy:bmc";
const UNREADABLE = "arkaik:arkademy:bmc:unreadable";

// --- the fake browser ------------------------------------------------------------------
class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.refuseWrites = false;
    this.writes = 0;
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    if (this.refuseWrites) throw new Error("QuotaExceededError");
    this.writes++;
    this.map.set(key, String(value));
  }
  removeItem(key) {
    if (this.refuseWrites) throw new Error("QuotaExceededError");
    this.map.delete(key);
  }
}

const browser = { storage: new MemoryStorage(), blocked: false, listeners: new Map() };
global.window = {
  get localStorage() {
    if (browser.blocked) throw new Error("SecurityError");
    return browser.storage;
  },
  addEventListener(type, fn) {
    if (!browser.listeners.has(type)) browser.listeners.set(type, new Set());
    browser.listeners.get(type).add(fn);
  },
  removeEventListener(type, fn) {
    browser.listeners.get(type)?.delete(fn);
  },
};
function fire(type, event = {}) {
  for (const fn of [...(browser.listeners.get(type) ?? [])]) fn(event);
}

const { canvasDraftStore, dispatchDraft, DRAFT_WRITE_DELAY_MS } = requireTsx("lib/hooks/useCanvasDraft.ts");

// Fake timers, installed after the modules load.
let now = 0;
let seq = 0;
const timers = new Map();
global.setTimeout = (fn, ms) => {
  timers.set(++seq, { fn, at: now + ms });
  return seq;
};
global.clearTimeout = (id) => timers.delete(id);
function advance(ms) {
  const until = now + ms;
  for (;;) {
    const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]);
    now = due[1].at;
    due[1].fn();
  }
  now = until;
}

/** A fresh browser, then a page that subscribes like `useCanvasDraft` does. */
function page({ stored = {}, blocked = false, refuseWrites = false } = {}) {
  browser.storage = new MemoryStorage();
  for (const [key, value] of Object.entries(stored)) browser.storage.map.set(key, value);
  browser.storage.refuseWrites = refuseWrites;
  browser.blocked = blocked;
  let renders = 0;
  const unsubscribe = canvasDraftStore.subscribe(() => renders++);
  return { view: () => canvasDraftStore.getSnapshot(), leave: unsubscribe, renders: () => renders };
}
const stored = () => browser.storage.getItem(KEY);
const storedDraft = () => JSON.parse(stored()).draft;
const envelope = (draft, v = 1) =>
  JSON.stringify({ v, draft: { name: "", answers: [], open: [], updatedAt: "", ...draft } });

// --- load ------------------------------------------------------------------------------
{
  same("before any page: loading", canvasDraftStore.getSnapshot().phase, "loading");
  const p = page();
  same("nothing stored: an empty draft, saved", [p.view().phase, p.view().draft.name, p.view().persistence, p.view().startStep], ["ready", "", "on", 1]);
  check("the subscriber is told once the draft is read", p.renders() >= 1);
  p.leave();
  same("the last page gone: loading again", canvasDraftStore.getSnapshot().phase, "loading");

  const q = page({ stored: { [KEY]: envelope({ name: "Tidy", answers: [{ id: "a1", question: "seg", text: "anglers" }] }) } });
  same("a stored draft is read, landing on the first unfinished step", [q.view().draft.name, q.view().startStep], ["Tidy", 2]);
  check("the probe leaves nothing behind", browser.storage.getItem("arkaik:arkademy:bmc:probe") === null);
  q.leave();
}

// --- the write throttle, page hide, leaving ------------------------------------------------
{
  const p = page();
  same("the throttle is 300 ms", DRAFT_WRITE_DELAY_MS, 300);
  dispatchDraft({ type: "rename", name: "T" });
  advance(299);
  same("not written before 300 ms", stored(), null);
  advance(1);
  same("written 300 ms after the first change", storedDraft().name, "T");

  dispatchDraft({ type: "rename", name: "Ti" });
  advance(200);
  dispatchDraft({ type: "rename", name: "Tid" });
  advance(100);
  same("typing without a pause is still written every 300 ms", storedDraft().name, "Tid");

  dispatchDraft({ type: "rename", name: "Tidy" });
  fire("pagehide");
  same("page hide writes a pending change at once", storedDraft().name, "Tidy");
  const writes = browser.storage.writes;
  fire("pagehide");
  same("page hide with nothing pending writes nothing", browser.storage.writes, writes);

  dispatchDraft({ type: "rename", name: "Tidy H" });
  p.leave();
  same("leaving the page (last unsubscribe) writes a pending change", storedDraft().name, "Tidy H");
  same("and no timer is left behind", timers.size, 0);
}
{
  const p = page({ stored: { [KEY]: envelope({ name: "Keep" }) } });
  dispatchDraft({ type: "reset" });
  advance(300);
  same("an empty draft removes the key", stored(), null);
  p.leave();
}

// --- another tab ------------------------------------------------------------------------
{
  const p = page({ stored: { [KEY]: envelope({ name: "Mine" }) } });
  fire("storage", { key: KEY, newValue: envelope({ name: "Theirs" }) });
  same("another tab's draft is adopted", p.view().draft.name, "Theirs");
  fire("storage", { key: "unrelated", newValue: "x" });
  same("another key is ignored", p.view().draft.name, "Theirs");
  fire("storage", { key: KEY, newValue: null });
  same("another tab started over: empty here too", p.view().draft.name, "");
  fire("storage", { key: KEY, newValue: envelope({ name: "Mine again" }) });
  fire("storage", { key: KEY, newValue: "{oops" });
  same("an unreadable value from another tab is not adopted", p.view().draft.name, "Mine again");
  p.leave();
}

// --- storage that refuses ------------------------------------------------------------------
{
  const p = page({ blocked: true });
  same("blocked storage: the canvas works in memory, not saved", [p.view().phase, p.view().persistence], ["ready", "unavailable"]);
  dispatchDraft({ type: "rename", name: "In memory" });
  advance(300);
  same("blocked storage: the draft still changes", p.view().draft.name, "In memory");
  p.leave();
}
{
  const p = page({ refuseWrites: true });
  same("a storage that reads but refuses writes is found at load (the probe)", p.view().persistence, "unavailable");
  p.leave();
}
{
  const p = page();
  browser.storage.refuseWrites = true;
  dispatchDraft({ type: "rename", name: "Full" });
  advance(300);
  same("a write that fails (quota): not saved, and said so", p.view().persistence, "unavailable");
  p.leave();
}

// --- a failed write is retried on the next change ---------------------------------------
{
  const p = page();
  browser.storage.refuseWrites = true;
  dispatchDraft({ type: "rename", name: "Full" });
  advance(300);
  same("full: not saved", p.view().persistence, "unavailable");
  browser.storage.refuseWrites = false;
  dispatchDraft({ type: "rename", name: "Full, then freed" });
  advance(300);
  same("space freed: the next change is written", storedDraft().name, "Full, then freed");
  same("and the notice clears", p.view().persistence, "on");
  p.leave();
}
{
  const p = page({ refuseWrites: true });
  browser.storage.refuseWrites = false;
  dispatchDraft({ type: "rename", name: "Probe failed at load" });
  advance(300);
  same("a probe that failed at load is retried too", [p.view().persistence, storedDraft().name], ["on", "Probe failed at load"]);
  p.leave();
}
{
  const p = page({ blocked: true, stored: { [KEY]: envelope({ name: "Unseen" }) } });
  browser.blocked = false;
  dispatchDraft({ type: "rename", name: "Would overwrite" });
  advance(300);
  same(
    "storage that could not be read at load is never written (it may hold a draft this page never saw)",
    [p.view().persistence, storedDraft().name],
    ["unavailable", "Unseen"],
  );
  p.leave();
}

// --- a newer build's draft, an unreadable one ---------------------------------------------
{
  const newer = JSON.stringify({ v: 2, draft: { name: "From the future", answers: [] } });
  const p = page({ stored: { [KEY]: newer } });
  same("newer: shown, not saved", [p.view().draft.name, p.view().persistence], ["From the future", "newer"]);
  dispatchDraft({ type: "rename", name: "Changed here" });
  advance(300);
  fire("pagehide");
  same("newer: never written over", stored(), newer);
  p.leave();
}
{
  const p = page({ stored: { [KEY]: "{oops" } });
  same("unreadable: an empty canvas", p.view().draft.name, "");
  same("unreadable: the value is copied aside before anything is written", browser.storage.getItem(UNREADABLE) !== null, true);
  p.leave();
}

if (failures > 0) {
  console.log(`\n${failures} arkademy-draft-store test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-draft-store tests passed.");
