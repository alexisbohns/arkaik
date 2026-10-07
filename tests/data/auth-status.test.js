#!/usr/bin/env node

/**
 * `GET /api/auth/status` as one shared query (lib/data/auth-status.ts, #429).
 *
 * `useAuthStatus` used to fetch per mounted consumer — six requests on the
 * `/projects` page for one answer. These tests pin what makes the shared query
 * a drop-in: concurrent consumers share one request, the hosted-availability
 * gate is still set from the answer, a failure still degrades to
 * "unconfigured" without retrying, and the listing is marked stale once when
 * the account becomes known rather than once per consumer.
 */

const fs = require("fs");
const { loadProjectQueries, BUILD_DIR } = require("./load-project-queries");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const USER = { id: "42", name: "Ada", email: null, image: null };

function respondWith(body, status = 200) {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  return requests;
}

async function main() {
  const { authStatus, availability, queryClient, core } = loadProjectQueries();
  const { createQueryClient, setQueryClientForTests } = queryClient;

  /** A fresh cache, observed for the listing's invalidations. */
  function freshClient() {
    const client = createQueryClient();
    setQueryClientForTests(client);
    const invalidations = [];
    const original = client.invalidateQueries.bind(client);
    client.invalidateQueries = (filters, options) => {
      invalidations.push(JSON.stringify(filters?.queryKey));
      return original(filters, options);
    };
    return { client, invalidations };
  }

  // --- One request, however many consumers --------------------------------------
  {
    const { client, invalidations } = freshClient();
    const requests = respondWith({ configured: true, user: USER });
    const consumers = Array.from({ length: 6 }, () =>
      new core.QueryObserver(client, authStatus.authStatusQueryOptions()),
    );
    const unsubscribes = consumers.map((observer) => observer.subscribe(() => {}));
    await client.fetchQuery(authStatus.authStatusQueryOptions());
    check("six mounted consumers make ONE request", requests.length === 1, `${requests.length} requests`);
    check(
      "…and all read the signed-in answer",
      consumers.every((o) => o.getCurrentResult().data?.state === "signed-in"),
    );
    check("the answer opens the hosted-availability gate", availability.isHostedAvailable() === true);
    check(
      "…naming the account, which the persisted cache is scoped to",
      availability.isHostedAvailable() === true && (await availability.whenHostedAccountKnown()) === "42",
    );
    check(
      "the listing is marked stale once the account is known",
      invalidations.filter((k) => k === '["projects"]').length === 1,
      invalidations.join(" | "),
    );

    // A refetch that answers the same account must not re-mark the listing.
    await client.refetchQueries({ queryKey: authStatus.authStatusKey() });
    check(
      "…and not again on a refetch that only confirms it",
      requests.length === 2 && invalidations.filter((k) => k === '["projects"]').length === 1,
      `${requests.length} requests | ${invalidations.join(" | ")}`,
    );
    unsubscribes.forEach((u) => u());
    client.clear();
  }

  // An older server's status has no id: the user is signed in, unnamed.
  {
    const { client } = freshClient();
    respondWith({ configured: true, user: { name: "Ada", email: null, image: null } });
    const status = await client.fetchQuery(authStatus.authStatusQueryOptions());
    check(
      "a status without an id is signed in with no account key — never a shared one",
      status.state === "signed-in" && status.user.id === null &&
        availability.isHostedAvailable() === true && (await availability.whenHostedAccountKnown()) === null,
      JSON.stringify(status),
    );
    client.clear();
  }

  // --- Signed out, unconfigured, failing -------------------------------------------
  {
    const { client, invalidations } = freshClient();
    respondWith({ configured: true, user: null });
    const status = await client.fetchQuery(authStatus.authStatusQueryOptions());
    check(
      "signed out closes the gate and leaves the listing alone",
      status.state === "signed-out" && availability.isHostedAvailable() === false && invalidations.length === 0,
      `${JSON.stringify(status)} | ${invalidations.join(" | ")}`,
    );
    check("…and names no account", (await availability.whenHostedAccountKnown()) === null);
    client.clear();
  }
  {
    const { client } = freshClient();
    respondWith({ configured: false, user: null });
    const status = await client.fetchQuery(authStatus.authStatusQueryOptions());
    check("no auth configured reads as unconfigured", status.state === "unconfigured");
    client.clear();
  }
  {
    const { client } = freshClient();
    availability.setHostedAvailable(true);
    const requests = respondWith({ error: "down" }, 500);
    const status = await client.fetchQuery(authStatus.authStatusQueryOptions());
    check(
      "a failing endpoint degrades to unconfigured with the gate closed — no retry",
      status.state === "unconfigured" && availability.isHostedAvailable() === false && requests.length === 1,
      `${JSON.stringify(status)} | ${requests.length} requests`,
    );
    client.clear();
  }

  setQueryClientForTests(null);
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} auth-status test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll auth-status tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
