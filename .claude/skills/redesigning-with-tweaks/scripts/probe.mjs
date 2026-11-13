// Playwright probes for a tweaker build. Run from a scratch dir with playwright installed.
//
//   node probe.mjs shoot  <out-dir> <url>... --scroller <css> [--el <css>] [--width 400] [--dark] [--profile <dir>]
//       Full-height shot of <el> (default: the section holding the scroller) per URL;
//       reports any horizontal overflow at that width.
//   node probe.mjs scroll <url>... --scroller <css>
//       Wheels over 4 points of the scroller; prints every URL where scrollTop stays 0,
//       with the element chain under the pointer (finds overflow:hidden / wheel traps).
//   node probe.mjs radius <url> --el <css>
//       Samples border-radius every frame through a hover-in and hover-out spring
//       (finds 999px morphs that overshoot below 0 and flash square corners).
//   node probe.mjs stack  <url> --open <css> --el <css>
//       Clicks <open>, then checks <el> is the topmost element at its own centre
//       (finds dropdowns trapped under later stacking contexts).
//
// Compose variants with the tweaker's URL recipe: append `?tw=section:id,...` to each URL.
// Use --profile with a persistent dir when the data lives in IndexedDB (import once, reuse).
// --dark sets prefers-color-scheme AND next-themes' stored "theme" (a class-based theme
// ignores colorScheme alone). Read-only is a URL, not a flag: shoot the surface that
// renders the component without its save path. --settle <ms> (default 2500) is the
// wait after load for client data (IndexedDB, queries) to render.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [mode, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = rest[i + 1];
  rest.splice(i, v && !v.startsWith("--") ? 2 : 1);
  return v && !v.startsWith("--") ? v : true;
};
const dark = flag("dark", false);
const profile = flag("profile", null);
const el = flag("el", null);
const scroller = flag("scroller", "main");
const width = Number(flag("width", 1440));
const opener = flag("open", null);

const options = { viewport: { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light" };
// Without --profile the browser is ours to close: closing only the context leaves
// Chromium running and the script never exits.
const browser = profile ? null : await chromium.launch();
const ctx = profile
  ? await chromium.launchPersistentContext(path.resolve(profile), options)
  : await browser.newContext(options);
const page = ctx.pages?.()[0] ?? (await ctx.newPage());
await page.setViewportSize({ width, height: 900 });
await page.addInitScript((isDark) => {
  try {
    localStorage.setItem("theme", isDark ? "dark" : "light");
  } catch {}
}, Boolean(dark));
// "load" plus a settle delay, not "networkidle": a page that keeps a request open
// (polling, a live feed) never goes idle and the probe hangs for minutes.
const settle = Number(flag("settle", 2500));
const go = async (url) => {
  await page.goto(url, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(settle);
};

if (mode === "shoot") {
  const [out, ...urls] = rest;
  fs.mkdirSync(out, { recursive: true });
  for (const [i, url] of urls.entries()) {
    await go(url);
    const inner = page.locator(scroller).first();
    const h = (await inner.count()) ? await inner.evaluate((e) => e.scrollHeight) : 900;
    await page.setViewportSize({ width, height: Math.min(h + 200, 4000) });
    await page.waitForTimeout(600);
    const target = page.locator(el ?? `section:has(${scroller})`).first();
    await target.screenshot({ path: `${out}/${String(i).padStart(2, "0")}${dark ? "-dark" : ""}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) console.log(`OVERFLOW ${url}: ${overflow}px wider than the viewport`);
    await page.setViewportSize({ width, height: 900 });
  }
} else if (mode === "scroll") {
  for (const url of rest) {
    await go(url);
    const s = page.locator(scroller).first();
    const box = await s.boundingBox();
    for (const y of [150, 350, 550, 700].filter((y) => y < box.height)) {
      await s.evaluate((e) => (e.scrollTop = 0));
      await page.mouse.move(box.x + box.width / 2, box.y + y);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(250);
      if ((await s.evaluate((e) => e.scrollTop)) === 0) {
        const chain = await page.evaluate(([x, yy]) => {
          const out = [];
          for (let e = document.elementFromPoint(x, yy); e && out.length < 6; e = e.parentElement) {
            const cs = getComputedStyle(e);
            out.push(`${e.tagName.toLowerCase()} overflow=${cs.overflowY} overscroll=${cs.overscrollBehaviorY}`);
          }
          return out.join(" < ");
        }, [box.x + box.width / 2, box.y + y]);
        console.log(`BLOCKED ${url} at y=${y}: ${chain}`);
      }
    }
  }
  console.log("scroll probe done");
} else if (mode === "radius") {
  await go(rest[0]);
  const target = page.locator(el).first();
  const b = await target.boundingBox();
  const sample = async () => {
    const v = [];
    for (let i = 0; i < 24; i++) {
      v.push(await target.evaluate((e) => getComputedStyle(e).borderTopLeftRadius));
      await page.waitForTimeout(12);
    }
    return v.join(" ");
  };
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  console.log("in :", await sample());
  await page.mouse.move(b.x + 300, b.y + 300);
  console.log("out:", await sample());
} else if (mode === "stack") {
  await go(rest[0]);
  await page.locator(opener).first().click();
  await page.waitForTimeout(600);
  const b = await page.locator(el).first().boundingBox();
  const top = await page.evaluate(([x, y, sel]) => !!document.elementFromPoint(x, y)?.closest(sel), [b.x + b.width / 2, b.y + b.height / 2, el]);
  console.log(top ? "OK: topmost" : "TRAPPED: something paints over it");
} else {
  console.log("modes: shoot | scroll | radius | stack");
}
await ctx.close();
await browser?.close();
