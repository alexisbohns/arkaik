#!/usr/bin/env node

/**
 * Integration test for the landing page's signed-in redirect (app/page.tsx):
 * a visitor with a session never sees the pitch, they land on /projects.
 *
 * Same bundler-free technique as tests/services/auth-guard.test.js — transpile
 * the source with the TypeScript compiler and stub its imports at the module
 * boundary — with one addition for JSX: the page is compiled with a custom
 * factory (`__jsx`) installed as a global, so the markup collapses into inert
 * calls and no React runtime is needed to exercise the guard above it.
 *
 * The `force-dynamic` assertion is not ceremony. Drop that export and Next
 * prerenders the page at build time; `getSession()` degrades every failure
 * (including the dynamic-usage error) to "no session", so the signed-out page
 * would be baked in and the redirect would silently never fire for anyone.
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const SRC_FILE = path.join(ROOT, "app", "page.tsx");
const BUILD_DIR = path.join(__dirname, ".test-build-root-redirect");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Controls what the stubbed getSession() returns for the current assertion.
let currentSession = null;

/** Stand-in for next/navigation's redirect(), which signals by throwing. */
class RedirectSignal extends Error {
  constructor(url) {
    super(`NEXT_REDIRECT:${url}`);
    this.url = url;
  }
}

const STUBS = {
  "next/navigation": {
    redirect: (url) => {
      throw new RedirectSignal(url);
    },
  },
  "next/link": { default: () => null },
  // next/font/google returns a loaded-font object; the page only reads .className.
  "next/font/google": { Gochi_Hand: () => ({ className: "font-gochi" }) },
  "@/components/ui/button": { Button: () => null },
  "@/components/theme-toggle": { ThemeToggle: () => null },
  "@/components/branding/ArkaikLogoBoil": { ArkaikLogoBoil: () => null },
  "@/components/background/AsciiTerrainBackground": { AsciiTerrainBackground: () => null },
  "@/lib/services/auth": { getSession: async () => currentSession },
};

function installStubs() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) {
      return STUBS[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = originalLoad;
  };
}

function loadPage() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(SRC_FILE, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "page.tsx",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
      jsxFactory: "__jsx",
      jsxFragmentFactory: "__jsxFragment",
    },
  });

  const outFile = path.join(BUILD_DIR, "page.js");
  fs.writeFileSync(outFile, outputText);
  delete require.cache[outFile];
  return require(outFile);
}

async function main() {
  // The emitted markup calls these unqualified; a global keeps the element tree
  // inert so the test exercises the guard, not the rendering.
  globalThis.__jsx = (type, props, ...children) => ({ type, props, children });
  globalThis.__jsxFragment = "fragment";

  const restore = installStubs();
  try {
    const page = loadPage();
    check("page exports a default component", typeof page.default === "function");
    check(
      "page opts out of static prerendering",
      page.dynamic === "force-dynamic",
      `dynamic = ${JSON.stringify(page.dynamic)}`,
    );

    // --- Signed in → redirected to /projects (the acceptance criterion) -----
    currentSession = { user: { id: "user-123", name: "Ada" } };
    let redirected = null;
    try {
      await page.default();
    } catch (err) {
      if (!(err instanceof RedirectSignal)) throw err;
      redirected = err.url;
    }
    check("signed-in visitor is redirected", redirected !== null, "page rendered instead");
    check("redirect target is /projects", redirected === "/projects", `got ${redirected}`);

    // --- Signed out → the landing page still renders ------------------------
    currentSession = null;
    let signedOutTree = null;
    try {
      signedOutTree = await page.default();
    } catch (err) {
      if (!(err instanceof RedirectSignal)) throw err;
      check("signed-out visitor is not redirected", false, `redirected to ${err.url}`);
    }
    check("signed-out visitor still gets the landing page", signedOutTree !== null);

    // --- Auth unconfigured (local-first build) → identical to signed out ----
    // getSession() answers null without touching env or Postgres; the page must
    // not care that the difference exists.
    currentSession = undefined;
    let localFirstTree = null;
    try {
      localFirstTree = await page.default();
    } catch (err) {
      if (!(err instanceof RedirectSignal)) throw err;
      check("local-first build is not redirected", false, `redirected to ${err.url}`);
    }
    check("local-first build still gets the landing page", localFirstTree !== null);
  } finally {
    restore();
    delete globalThis.__jsx;
    delete globalThis.__jsxFragment;
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll root-redirect checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
