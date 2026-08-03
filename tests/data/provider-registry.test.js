#!/usr/bin/env node

/**
 * The provider seam (lib/data/provider-registry.ts, issue #243) and the routing
 * that now sits on it.
 *
 * `getProvider()` no longer returns the local provider directly — it returns a
 * ROUTER over the local and hosted backends, because a signed-in user has both
 * kinds of project at once. These tests pin the routing rule and, just as
 * importantly, that a purely local session still never touches the network.
 *
 * Routing is by id prefix (`prj_`), a total function of the id: hosted ids are
 * minted server-side in that namespace and `lib/utils/export.ts` refuses to give
 * a local project one. There is no cache here that could go stale.
 */

const fs = require("fs");
const { loadProviderRegistry, BUILD_DIR } = require("./load-provider-registry");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const HOSTED = "prj_abc123";
const LOCAL = "local-1";

const jsonResponse = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

async function main() {
  const reg = loadProviderRegistry();
  const { getProvider, setProvider, routing, remote, availability, calls, resetCalls } = reg;

  // --- The seam still works ------------------------------------------------
  const original = getProvider();
  check("getProvider() returns a provider", typeof original.getNodes === "function");

  const marker = { __marker: "swapped" };
  setProvider(marker);
  check("setProvider() swaps the active provider", getProvider() === marker);
  check("the swap persists across repeated calls", getProvider() === marker);
  setProvider(original);
  check("setProvider() can restore the default", getProvider() === original);

  // --- The seed branch (self-map cycle 4) ------------------------------------
  check("the seed id predicate matches only the reserved id",
    reg.seedProject.isSeedProjectId("arkaik-self-map") === true &&
    reg.seedProject.isSeedProjectId("prj_abc") === false &&
    reg.seedProject.isSeedProjectId("arkaik-self-map-2") === false);

  {
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({
        fetchImpl: async () => { throw new Error("seed calls must not reach the network"); },
      }),
      seed: reg.seedFake,
      isRemoteAvailable: () => true,
    });
    resetCalls();
    reg.resetSeedCalls();
    await router.getNodes("arkaik-self-map");
    await router.updateNode("arkaik-self-map", "V-projects", { title: "x" });
    check("seed-id calls reach the seed provider", reg.seedCalls.length === 2, reg.seedCalls.join(","));
    check("…and never the local provider", calls.length === 0, calls.join(","));
  }
  {
    // listProjects always leads with the seed — even when hosted fails.
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({ fetchImpl: async () => new Response("nope", { status: 500 }) }),
      seed: reg.seedFake,
      isRemoteAvailable: () => true,
    });
    const listed = await router.listProjects();
    check("the seed project is listed first", listed[0]?.seed === true, JSON.stringify(listed.map((p) => p.project.id)));
    check("…and a hosted failure still lists seed + local", listed.length === 2);
  }
  {
    // Signed out: seed + local, no network.
    let fetchCalls = 0;
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({ fetchImpl: async () => { fetchCalls++; throw new Error("no"); } }),
      seed: reg.seedFake,
      isRemoteAvailable: () => false,
    });
    const listed = await router.listProjects();
    check("signed out, the seed is still listed first and nothing hits the network",
      listed[0]?.seed === true && listed.length === 2 && fetchCalls === 0);
  }
  {
    // A router WITHOUT a seed option behaves exactly as before.
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({ fetchImpl: async () => { throw new Error("no"); } }),
      isRemoteAvailable: () => false,
    });
    resetCalls();
    await router.getNodes("arkaik-self-map");
    check("without a seed provider, the reserved id falls through to local", calls.length === 1, calls.join(","));
  }
  // --- Default wiring: getProvider()'s router includes the seed --------------
  // Runs here, after `setProvider(original)` above has already restored the
  // default router — so getProvider() still returns the real registry wiring,
  // not the `marker` used to test the setProvider() seam.
  {
    reg.resetSeedCalls();
    await getProvider().getNodes("arkaik-self-map");
    check("the default registry routes the seed id to the seed provider",
      reg.seedCalls.some((c) => c === "getNodes:arkaik-self-map"), reg.seedCalls.join(","));
    const listed = await getProvider().listProjects();
    check("the default listing leads with the seed project", listed[0]?.seed === true,
      JSON.stringify(listed.map((p) => p.project.id)));
  }

  // --- The routing rule ----------------------------------------------------
  check("a prj_ id is hosted", remote.isHostedProjectId(HOSTED) === true);
  check("a uuid id is not hosted", remote.isHostedProjectId("8f14e45f-ceea-467a-9f2a-1f0e6b8c4d21") === false);
  check("an authored id is not hosted", remote.isHostedProjectId("pebbles") === false);
  check("a lookalike id is not hosted (the prefix must lead)", remote.isHostedProjectId("project-prj_x") === false);

  // --- Local ids never reach the network -----------------------------------
  {
    let fetchCalls = 0;
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({
        fetchImpl: async () => {
          fetchCalls++;
          throw new Error("the network must not be reached for a local project");
        },
      }),
      isRemoteAvailable: () => true,
    });

    resetCalls();
    await router.getNodes(LOCAL);
    await router.updateNode(LOCAL, "V-a", { title: "x" });
    await router.deleteNode(LOCAL, "V-a");
    await router.deleteNodes(LOCAL, ["V-a"]);
    await router.deleteEdge(LOCAL, "e-a-b");
    await router.applyMutations(LOCAL, []);
    await router.createNode({ id: "V-b", project_id: LOCAL });
    await router.createEdge({ id: "e", project_id: LOCAL, source_id: "a", target_id: "b" });

    check("every local-id call reached the local provider", calls.length === 8, calls.join(","));
    check("no local-id call touched the network", fetchCalls === 0, String(fetchCalls));
    check(
      "each mutator forwarded its projectId to the backend",
      calls.every((c) => c.endsWith(`:${LOCAL}`)),
      calls.join(","),
    );
  }

  // --- Hosted ids go to the remote provider --------------------------------
  {
    const requests = [];
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({
        fetchImpl: async (url, init) => {
          requests.push(`${init?.method ?? "GET"} ${url}`);
          return jsonResponse({ nodes: [{ id: "V-a" }], edges: [], version: "2", journal: [] });
        },
      }),
      isRemoteAvailable: () => true,
    });

    resetCalls();
    await router.getNodes(HOSTED);
    await router.updateNode(HOSTED, "V-a", { title: "x" });

    check(
      "a hosted read went to the API",
      requests.some((r) => r.includes(`/api/graph/projects/${HOSTED}/nodes`)),
      requests.join(" | "),
    );
    check(
      "a hosted write went to the single mutations endpoint",
      requests.some((r) => r === `POST /api/graph/projects/${HOSTED}/mutations`),
      requests.join(" | "),
    );
    check("no hosted call reached the local provider", calls.length === 0, calls.join(","));
  }

  // --- listProjects merges, and degrades rather than blanking ---------------
  {
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({
        fetchImpl: async () =>
          jsonResponse({
            projects: [
              {
                id: HOSTED,
                title: "Hosted",
                nodeCount: 3,
                edgeCount: 2,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
      }),
      isRemoteAvailable: () => true,
    });

    const listed = await router.listProjects();
    check("listProjects merges both backends", listed.length === 2, JSON.stringify(listed.map((p) => p.project.id)));
    check("hosted entries are flagged hosted", listed.find((p) => p.project.id === HOSTED)?.hosted === true);
    check("local entries are not", listed.find((p) => p.project.id === LOCAL)?.hosted === false);
    check("hosted counts survive the mapping", listed.find((p) => p.project.id === HOSTED)?.nodeCount === 3);
  }
  {
    // A hosted failure must not blank the local list — losing sight of local
    // projects because the network blinked is the worse failure.
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({ fetchImpl: async () => new Response("nope", { status: 500 }) }),
      isRemoteAvailable: () => true,
    });
    const listed = await router.listProjects();
    check(
      "a hosted listing failure degrades to local only",
      listed.length === 1 && listed[0].hosted === false,
      JSON.stringify(listed),
    );
  }
  {
    let fetchCalls = 0;
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({
        fetchImpl: async () => {
          fetchCalls++;
          return jsonResponse({});
        },
      }),
      isRemoteAvailable: () => false,
    });
    const listed = await router.listProjects();
    check("signed out, listProjects never asks the account", fetchCalls === 0);
    check("signed out, the local list is still returned", listed.length === 1);
  }

  // --- Import always lands locally -----------------------------------------
  {
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({
        fetchImpl: async () => {
          throw new Error("import must not go to the account implicitly");
        },
      }),
      isRemoteAvailable: () => true,
    });
    resetCalls();
    await router.importProject({ project: { id: "imported", title: "T" }, nodes: [], edges: [] });
    check("importProject goes to the local provider", calls.includes("importProject:imported"), calls.join(","));
  }

  // --- Availability is awaited, not sampled --------------------------------
  // The page that lists projects mounts before `/api/auth/status` answers. If
  // `listProjects()` merely samples a flag at that instant it reads the "no
  // account" default and silently drops every hosted project — the /projects
  // page showing fewer projects than the in-project switcher.
  {
    let fetchCalls = 0;
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({
        fetchImpl: async () => {
          fetchCalls++;
          return jsonResponse({ projects: [] });
        },
      }),
      isRemoteAvailable: async () => false,
    });
    const listed = await router.listProjects();
    check("an async 'not available' is awaited, not treated as truthy", fetchCalls === 0, String(fetchCalls));
    check("...and the local list still comes back", listed.length === 1);
  }
  {
    const router = routing.createRoutingProvider({
      local: reg.localFake,
      remote: remote.createRemoteProvider({
        fetchImpl: async () =>
          jsonResponse({
            projects: [
              {
                id: HOSTED,
                title: "Hosted",
                nodeCount: 3,
                edgeCount: 2,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
      }),
      // Availability that only settles a tick later, exactly as the real auth
      // status does — the listing must wait for it.
      isRemoteAvailable: () => new Promise((resolve) => setTimeout(() => resolve(true), 5)),
    });
    const listed = await router.listProjects();
    check(
      "a listing started before auth resolves still includes hosted projects",
      listed.length === 2,
      JSON.stringify(listed.map((p) => p.project.id)),
    );
  }

  // --- The availability flag ------------------------------------------------
  check("hosted availability defaults to false", availability.isHostedAvailable() === false);
  availability.setHostedAvailable(true);
  check("hosted availability can be set", availability.isHostedAvailable() === true);
  availability.setHostedAvailable(false);
  check("hosted availability can be cleared", availability.isHostedAvailable() === false);

  // --- Waiting for the answer instead of guessing ---------------------------
  {
    const gate = availability.createHostedAvailability();
    let settled = null;
    void gate.whenKnown().then((value) => {
      settled = value;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    check("whenKnown() does not answer before the status is reported", settled === null, String(settled));

    gate.set(true);
    check("reporting the status answers waiters with it", (await gate.whenKnown()) === true);
    check("...and the sync read agrees", gate.isAvailable() === true);
  }
  {
    const gate = availability.createHostedAvailability();
    gate.set(false);
    check("once known, whenKnown() answers immediately", (await gate.whenKnown()) === false);
  }
  {
    // Nothing must hang forever on a surface where no one reports the status.
    const gate = availability.createHostedAvailability({ timeoutMs: 5 });
    const started = Date.now();
    const answer = await gate.whenKnown();
    check("whenKnown() gives up and answers with the default", answer === false);
    check("...promptly", Date.now() - started < 500, String(Date.now() - started));
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} provider-registry test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll provider-registry tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
