#!/usr/bin/env node

/**
 * What "create" means per section (lib/data/create-target.ts).
 *
 * The rule that matters most here is the last one: creating a Synked project
 * runs a backup immediately, but a FAILED backup must not fail the creation.
 * The user asked for a project; they get a project. It just lands in Lokal
 * instead, and we tell them why.
 */

const fs = require("fs");
const { loadProjectSections, BUILD_DIR } = require("./load-project-sections");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BUNDLE = { project: { id: "local-1", title: "Draft" }, nodes: [], edges: [] };

/** Records every effect the module reaches for, so a test can prove routing. */
function makeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      saveLocal: async (bundle) => {
        calls.push(`saveLocal:${bundle.project.id}`);
        return bundle.project.id;
      },
      importHosted: async (bundle) => {
        calls.push(`importHosted:${bundle.project.id}`);
        return "prj_server";
      },
      backupNow: async (id) => {
        calls.push(`backupNow:${id}`);
      },
      ...overrides,
    },
  };
}

async function main() {
  const { createTarget } = loadProjectSections();
  const { parseCreateTarget, createInTarget } = createTarget;

  // --- parseCreateTarget ---------------------------------------------------
  check("parses hosted", parseCreateTarget("hosted") === "hosted");
  check("parses synked", parseCreateTarget("synked") === "synked");
  check("parses lokal", parseCreateTarget("lokal") === "lokal");
  check("rejects an unknown value", parseCreateTarget("wat") === null);
  check("rejects null", parseCreateTarget(null) === null);
  check("rejects an empty string", parseCreateTarget("") === null);

  // --- hosted --------------------------------------------------------------
  {
    const { calls, deps } = makeDeps();
    const result = await createInTarget("hosted", BUNDLE, deps);
    check("hosted uses importHosted only", calls.join(",") === "importHosted:local-1");
    check("hosted returns the server id", result.id === "prj_server");
    check("hosted reports no backup error", result.backupError === null);
  }

  // --- synked --------------------------------------------------------------
  {
    const { calls, deps } = makeDeps();
    const result = await createInTarget("synked", BUNDLE, deps);
    check("synked saves locally then backs up", calls.join(",") === "saveLocal:local-1,backupNow:local-1");
    check("synked returns the local id", result.id === "local-1");
    check("synked reports no backup error on success", result.backupError === null);
  }

  // --- lokal ---------------------------------------------------------------
  {
    const { calls, deps } = makeDeps();
    const result = await createInTarget("lokal", BUNDLE, deps);
    check("lokal saves locally and never backs up", calls.join(",") === "saveLocal:local-1");
    check("lokal returns the local id", result.id === "local-1");
    check("lokal reports no backup error", result.backupError === null);
  }

  // --- a failed backup must not fail the creation --------------------------
  {
    const { calls, deps } = makeDeps({
      backupNow: async (id) => {
        calls.push(`backupNow:${id}`);
        throw new Error("Entity limit exceeded");
      },
    });
    const result = await createInTarget("synked", BUNDLE, deps);
    check("a failed backup still returns the created id", result.id === "local-1");
    check("a failed backup is reported, not thrown", result.backupError === "Entity limit exceeded");
    check("a failed backup still ran saveLocal first", calls[0] === "saveLocal:local-1");
  }

  // --- a failed save DOES fail the creation --------------------------------
  {
    const { deps } = makeDeps({
      saveLocal: async () => {
        throw new Error("Disk full");
      },
    });
    let threw = null;
    try {
      await createInTarget("lokal", BUNDLE, deps);
    } catch (err) {
      threw = err.message;
    }
    check("a failed save rejects", threw === "Disk full");
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  console.log(failures === 0 ? "\nAll create-target tests passed." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
