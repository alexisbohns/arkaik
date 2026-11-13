// Shoot every surface of an exploration for one tweaker recipe — hand it to the authors.
// ADAPT the SURFACES table below: one entry per surface AND per edge record (the table
// here is the quality run's: a finding with linked nodes, an accepted risk, a scoped and
// an unscoped criterion). An author shoots everything with one command.
//
//   node shoot.mjs <profile-dir> <out-dir> "<recipe>" [--only matrix,cell,findings,finding,finding-accepted,criterion,criterion-all] [--dark] [--width 400] [--port 4571] [--readonly]
//
// <recipe> is the tweaker's `?tw=` value without `?tw=` (e.g. "matrix-card:bold-pages-tile,look:calm",
// "preset:lead-calm"), or "base".
// Run `node import.mjs <profile-dir>` once first. Every shot is the FULL scroll height of its surface.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith("--") ? 2 : 1);
  return v && !v.startsWith("--") ? v : true;
};
const dark = flag("dark", false);
const width = Number(flag("width", 1440));
const port = flag("port", "4571");
const only = flag("only", null);
const [profile, out, recipe = "base"] = args;
if (!profile || !out) {
  console.log('usage: node shoot.mjs <profile-dir> <out-dir> "<recipe>" [--only …] [--dark] [--width 400]');
  process.exit(1);
}

const P = `http://localhost:${port}/project/pebbles-prod/quality`;
const tw = `tw=${encodeURIComponent(recipe)}`;
// ADAPT. Each surface: URL, and either `panel` (shoots the panel section) or `scroller` (shoots the page).
const SURFACES = {
  matrix: { url: `${P}/matrix?${tw}`, el: "main", scroller: '[data-quality-page="matrix"]' },
  cell: { url: `${P}/matrix?cell=${encodeURIComponent("PLT|supabase")}&${tw}`, panel: "cell" },
  findings: { url: `${P}/findings?${tw}`, el: "main", scroller: '[data-quality-page="findings"]' },
  // A finding with linked nodes (one missing), an issue link, a long verification note.
  finding: { url: `${P}/findings?finding=F-2026-08-PLT-supabase-02&${tw}`, panel: "finding" },
  // An accepted risk.
  "finding-accepted": { url: `${P}/findings?finding=F-2026-08-PLT-supabase-04&${tw}`, panel: "finding" },
  // Scoped to one surface: one assessment, a scored level, 3 findings (accepted, resolved, open).
  criterion: { url: `${P}/findings?criterion=PLT-08&csurface=supabase&${tw}`, panel: "criterion" },
  // Unscoped: evidence by surface, no single scored level.
  "criterion-all": { url: `${P}/findings?criterion=PLT-08&${tw}`, panel: "criterion" },
};

fs.mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(path.resolve(profile), {
  viewport: { width, height: 1000 },
  colorScheme: dark ? "dark" : "light",
});
await ctx.addInitScript((isDark) => {
  try {
    localStorage.setItem("theme", isDark ? "dark" : "light");
  } catch {}
}, Boolean(dark));
const page = ctx.pages()[0] ?? (await ctx.newPage());

const names = only ? only.split(",") : Object.keys(SURFACES);
for (const name of names) {
  const s = SURFACES[name];
  if (!s) {
    console.log(`unknown surface ${name}`);
    continue;
  }
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(s.url, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(3500);
  const file = `${out}/${name}${dark ? "-dark" : ""}${width !== 1440 ? `-${width}` : ""}.png`;
  // Grow the viewport to the scroller's full height so one shot holds everything.
  const scrollerSel = s.panel ? `[data-quality-panel="${s.panel}"]` : s.scroller;
  const scroller = page.locator(scrollerSel).first();
  if (!(await scroller.count())) {
    console.log(`MISSING ${name}: ${scrollerSel} not found at ${s.url}`);
    await page.screenshot({ path: file });
    continue;
  }
  const extra = await scroller.evaluate((e) => {
    let el = e;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) return el.scrollHeight - el.clientHeight;
      el = el.parentElement;
    }
    return 0;
  });
  await page.setViewportSize({ width, height: Math.min(1000 + extra, 6000) });
  await page.waitForTimeout(700);
  if (s.panel) {
    const section = page.locator(`section:has([data-quality-panel="${s.panel}"])`).last();
    await section.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log(`${file}${overflow > 0 ? `  OVERFLOW ${overflow}px` : ""}`);
}
await ctx.close();
