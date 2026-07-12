#!/usr/bin/env node

/**
 * Integration test for the Synk auth guard (docs/spec/services.md § Synk → Auth;
 * issue #241 acceptance: "unauthenticated request to a session-guarded test
 * route → 401").
 *
 * The route under test is app/api/synk/ping/route.ts — the smallest expression
 * of the session check the real Synk handlers will copy. We transpile it with
 * the TypeScript compiler (the same bundler-free approach as the other loaders
 * in tests/) and stub its two imports:
 *
 *   - `next/server`          → a tiny NextResponse.json shim exposing `.status`
 *                              and `.json()`, so we can read the response.
 *   - `@/lib/services/auth`  → a controllable `getSession()`.
 *
 * Stubbing at the getSession boundary is deliberate: the 401 path is pure guard
 * logic and needs no live OAuth round-trip, no database, and no next-auth (which
 * is ESM-only and cannot be required under this CommonJS transpile). We assert
 * both the unauthenticated 401 and the authenticated 200 — the exact contract
 * the Synk API depends on.
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const SRC_FILE = path.join(ROOT, "app", "api", "synk", "ping", "route.ts");
const BUILD_DIR = path.join(__dirname, ".test-build-auth-guard");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Minimal stand-in for Next's NextResponse.json(). */
class StubResponse {
  constructor(body, init) {
    this.status = (init && init.status) || 200;
    this._body = body;
  }
  async json() {
    return this._body;
  }
}

// Controls what the stubbed getSession() returns for the current assertion.
let currentSession = null;

const STUBS = {
  "next/server": {
    NextResponse: {
      json: (body, init) => new StubResponse(body, init),
    },
  },
  "@/lib/services/auth": {
    getSession: async () => currentSession,
  },
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

function loadRoute() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(SRC_FILE, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "route.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const outFile = path.join(BUILD_DIR, "route.js");
  fs.writeFileSync(outFile, outputText);
  delete require.cache[outFile];
  return require(outFile);
}

async function main() {
  const restore = installStubs();
  try {
    const route = loadRoute();
    check("route exports a GET handler", typeof route.GET === "function");

    // --- Unauthenticated → 401 (the acceptance criterion) -------------------
    currentSession = null;
    const unauthed = await route.GET();
    check("unauthenticated request returns 401", unauthed.status === 401, `got ${unauthed.status}`);
    const unauthedBody = await unauthed.json();
    check(
      "401 body carries an unauthorized error",
      unauthedBody && unauthedBody.error === "unauthorized",
      JSON.stringify(unauthedBody),
    );
    check("401 response does not leak ok/user", !("ok" in unauthedBody), JSON.stringify(unauthedBody));

    // --- Authenticated → 200 { ok, user } (the pattern Synk copies) ---------
    currentSession = { user: { id: "user-123", name: "Ada", email: "ada@example.com" } };
    const authed = await route.GET();
    check("authenticated request returns 200", authed.status === 200, `got ${authed.status}`);
    const authedBody = await authed.json();
    check("200 body reports ok:true", authedBody && authedBody.ok === true, JSON.stringify(authedBody));
    check(
      "200 body echoes the session user (owner scoping)",
      authedBody && authedBody.user && authedBody.user.id === "user-123",
      JSON.stringify(authedBody),
    );
  } finally {
    restore();
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll auth-guard checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
