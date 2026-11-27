#!/usr/bin/env node

/**
 * TLS pinning for a self-hosted Postgres with a private CA (db/pg-config.js and
 * its twin `pgConfig` in lib/services/db.ts; docs/spec/services.md §
 * Self-hosted Postgres with a private CA).
 *
 * Deliberately DATABASE-FREE, so it runs in CI's fast `build` job. What is at
 * stake is whether the app trusts the right server, and that should fail on a
 * laptop with no Postgres running.
 *
 * Three things are held here:
 *   1. the JS and TS twins answer every case identically;
 *   2. without DATABASE_CA_CERT nothing changes — Neon, CI and localhost
 *      connection strings pass through byte for byte;
 *   3. end to end, through a real `pg` Client against a stand-in server that
 *      answers Postgres's SSLRequest and then speaks TLS: with the CA pinned,
 *      the handshake succeeds EVEN THOUGH the URL still says
 *      `?sslmode=require` (node-postgres lets the URL override `ssl`, which is
 *      the trap the stripping exists for), and a server signed by any other CA
 *      is refused. The host is an IP, as a Coolify box often is: node-postgres
 *      sends no SNI then, and Node would check the certificate against
 *      "localhost" unless the identity check is pinned to the dialled host.
 *
 * The certificates are minted at test time with the openssl CLI into a temp
 * dir, so no private key is committed.
 */

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const tls = require("tls");
const { execFileSync } = require("child_process");
const ts = require("typescript");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-pg-config");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

// --- load both twins ---------------------------------------------------------

const js = require(path.join(ROOT, "db", "pg-config.js"));

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));
fs.writeFileSync(path.join(BUILD_DIR, "server-only-stub.js"), "module.exports = {};\n");
const { outputText } = ts.transpileModule(fs.readFileSync(path.join(ROOT, "lib", "services", "db.ts"), "utf8"), {
  fileName: "db.ts",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
});
fs.writeFileSync(
  path.join(BUILD_DIR, "db.js"),
  outputText.replace(/require\((['"])server-only\1\)/g, 'require("./server-only-stub.js")'),
);
const tsTwin = require(path.join(BUILD_DIR, "db.js"));

function outcome(fn, url, env) {
  try {
    return { value: fn(url, env) };
  } catch (err) {
    return { error: err.message };
  }
}

// --- certificates --------------------------------------------------------------

const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "arkaik-pg-config-"));
function openssl(args) {
  execFileSync("openssl", args, { cwd: certDir, stdio: ["ignore", "ignore", "pipe"] });
}
function mintCa(name) {
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${name}`,
    "-keyout", `${name}.key`, "-out", `${name}.crt`]);
}
mintCa("ca");
mintCa("other-ca");
fs.writeFileSync(path.join(certDir, "san.ext"), "subjectAltName=IP:127.0.0.1\n");
openssl(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=pg-test", "-keyout", "server.key", "-out", "server.csr"]);
openssl(["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial",
  "-days", "2", "-extfile", "san.ext", "-out", "server.crt"]);
const read = (name) => fs.readFileSync(path.join(certDir, name), "utf8");
const CA = read("ca.crt");
const OTHER_CA = read("other-ca.crt");

// --- 1 + 2: the pure function -----------------------------------------------------

const NEON = "postgres://owner:p%40ss@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const COOLIFY = "postgres://arkaik_app:secret@51.255.207.98:23693/arkaik?sslmode=require";

const cases = [
  ["no CA: Neon URL untouched", NEON, {}],
  ["no CA: blank CA is no CA", NEON, { DATABASE_CA_CERT: "   " }],
  ["CA: ssl params stripped, others kept", NEON, { DATABASE_CA_CERT: CA }],
  ["CA: only param stripped leaves no '?'", COOLIFY, { DATABASE_CA_CERT: CA }],
  ["CA: literal \\n escapes accepted", COOLIFY, { DATABASE_CA_CERT: CA.trim().replace(/\n/g, "\\n") }],
  ["CA: base64 refused", COOLIFY, { DATABASE_CA_CERT: Buffer.from(CA).toString("base64") }],
  ["CA: non-URL refused", "host=localhost dbname=arkaik", { DATABASE_CA_CERT: CA }],
];

for (const [name, url, env] of cases) {
  const a = outcome(js.pgConfig, url, env);
  const b = outcome(tsTwin.pgConfig, url, env);
  check(`twins agree — ${name}`, JSON.stringify(a) === JSON.stringify(b), `js=${JSON.stringify(a)}\n      ts=${JSON.stringify(b)}`);
}

check("no CA → connection string passes through byte for byte",
  JSON.stringify(js.pgConfig(NEON, {})) === JSON.stringify({ connectionString: NEON }));

const neonPinned = js.pgConfig(NEON, { DATABASE_CA_CERT: CA });
check("CA → sslmode removed, channel_binding and password encoding kept",
  neonPinned.connectionString ===
    "postgres://owner:p%40ss@ep-x.eu-central-1.aws.neon.tech/neondb?channel_binding=require",
  neonPinned.connectionString);
check("CA → verification stays ON", neonPinned.ssl.rejectUnauthorized === true && neonPinned.ssl.ca === CA.trim() + "\n");
check("CA → identity check pinned to the URL's host",
  typeof neonPinned.ssl.checkServerIdentity === "function" &&
    typeof tsTwin.pgConfig(NEON, { DATABASE_CA_CERT: CA }).ssl.checkServerIdentity === "function");
check("CA → URL with sslmode only ends without a dangling '?'",
  js.pgConfig(COOLIFY, { DATABASE_CA_CERT: CA }).connectionString ===
    "postgres://arkaik_app:secret@51.255.207.98:23693/arkaik");
check("escaped CA decodes to the same PEM",
  js.pgConfig(COOLIFY, { DATABASE_CA_CERT: CA.trim().replace(/\n/g, "\\n") }).ssl.ca === CA.trim() + "\n");
check("base64 CA is refused with a message naming the rule",
  /base64-encoded copy is not/.test(outcome(js.pgConfig, COOLIFY, { DATABASE_CA_CERT: Buffer.from(CA).toString("base64") }).error ?? ""));

// --- 3: a real pg Client against a TLS stand-in -----------------------------------

/**
 * A server that answers SSLRequest with 'S', upgrades to TLS with the minted
 * server certificate, and reports whether a TLS session was established (then
 * hangs up — no Postgres behind it).
 */
function standIn() {
  const handshakes = [];
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      socket.write("S");
      const secure = new tls.TLSSocket(socket, { isServer: true, key: read("server.key"), cert: read("server.crt") });
      secure.on("secure", () => {
        handshakes.push(true);
        secure.destroy();
      });
      secure.on("error", () => {});
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, handshakes })));
}

async function tryConnect(config) {
  const client = new Client({ ...config, connectionTimeoutMillis: 5000 });
  client.on("error", () => {});
  try {
    await client.connect();
    return "connected";
  } catch (err) {
    return err.message;
  } finally {
    client.end().catch(() => {});
  }
}

async function endToEnd() {
  const { server, handshakes } = await standIn();
  const { port } = server.address();
  const url = `postgres://arkaik_app:secret@127.0.0.1:${port}/arkaik?sslmode=require`;

  const before = handshakes.length;
  const pinned = await tryConnect(js.pgConfig(url, { DATABASE_CA_CERT: CA }));
  check("pinned CA + ?sslmode=require in the URL → TLS handshake succeeds",
    handshakes.length === before + 1 && !/certificate|self.signed|verify/i.test(pinned), pinned);

  const unpinned = await tryConnect(js.pgConfig(url, {}));
  check("no CA → the private certificate is refused (the original failure)",
    /certificate|verify/i.test(unpinned), unpinned);

  const wrong = await tryConnect(js.pgConfig(url, { DATABASE_CA_CERT: OTHER_CA }));
  check("a different CA → refused, so pinning is not trust-anything",
    /certificate|verify|signature/i.test(wrong), wrong);

  // The certificate names IP 127.0.0.1 only: dialled by another name, it must
  // be refused even with the right CA. This is the identity check working.
  const wrongName = await tryConnect(
    js.pgConfig(`postgres://arkaik_app:secret@localhost:${port}/arkaik?sslmode=require`, { DATABASE_CA_CERT: CA }),
  );
  check("right CA, wrong host name → refused (identity is checked, not just the chain)",
    /altnames|does not match/i.test(wrongName), wrongName);

  const tsPinned = await tryConnect(tsTwin.pgConfig(url, { DATABASE_CA_CERT: CA }));
  check("the TS twin (the app's pool) connects the same way",
    !/certificate|self.signed|verify/i.test(tsPinned), tsPinned);

  server.close();
}

endToEnd()
  .catch((err) => {
    failures++;
    console.log(`FAIL: end-to-end threw: ${err.stack || err.message}`);
  })
  .finally(() => {
    fs.rmSync(certDir, { recursive: true, force: true });
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    if (failures) {
      console.log(`\n${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll pg-config checks passed.");
  });
