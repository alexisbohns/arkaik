// Import a bundle into a persistent Chromium profile, once.
//   node import.mjs <profile-dir> <bundle> [port] [project-id]
// Skips if the project already shows on /projects. IndexedDB is per profile: every author
// imports once into their own profile dir. Prefer a PRODUCTION export (seeds hide the
// multi-platform, long-text and empty cases) re-id'd so it cannot clash, plus a few edge
// records planted by hand when prod has none (the quality run planted an accepted risk,
// a resolved and a refuted finding, a missing linked node).
import { chromium } from "playwright";
import path from "node:path";

const [profile, bundle, port = "4571", project = "pebbles-prod"] = process.argv.slice(2);
if (!profile || !bundle) {
  console.log("usage: node import.mjs <profile-dir> <bundle> [port] [project-id]");
  process.exit(1);
}
const ctx = await chromium.launchPersistentContext(path.resolve(profile), { viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`http://localhost:${port}/projects`, { waitUntil: "load", timeout: 180000 });
await page.waitForTimeout(2500);
const has = await page.locator(`a[href*="/project/${project}"]`).count();
if (has) {
  console.log("already imported");
} else {
  await page.locator('input[type="file"]').first().setInputFiles(path.resolve(bundle));
  await page.waitForURL(/\/project\/[^/]+\/overview/, { timeout: 180000 });
  console.log("imported →", page.url());
}
await ctx.close();
