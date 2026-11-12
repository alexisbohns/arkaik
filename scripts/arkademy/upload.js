#!/usr/bin/env node

/**
 * The Arkademy library's upload script (docs/arkademy.md). Run by hand:
 *
 *   npm run arkademy -- check    [file]                    validate only, no database
 *   npm run arkademy -- publish  [file] [--note "…"] [--yes]
 *   npm run arkademy -- status                            the last ten versions
 *   npm run arkademy -- rollback [--to N] [--yes]
 *
 * `file` defaults to $ARKADEMY_CONTENT, then arkademy-content/arkademy.json
 * under the repository root; a relative path is read from the directory the
 * command was started in. The database is DATABASE_URL, as for
 * `npm run db:migrate`. A write to any host but localhost needs --yes.
 *
 * Every write inserts a row into arkademy_documents (db/migrations/
 * 013_arkademy_documents.sql); nothing is ever updated or deleted. After a
 * publish or a rollback that wrote a row, the script asks the app to expire
 * its cached copy (POST /api/arkademy/revalidate) when ARKADEMY_SITE_URL and
 * ARKADEMY_REVALIDATE_SECRET are both set, and says whether the version is
 * live now or how long it can take. That call never fails the command: the
 * row is committed before it is made.
 *
 * lib/arkademy/*.ts is loaded through ./load-arkademy-lib.js, so this runs
 * from a checkout with dev dependencies installed (`typescript`).
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { loadArkademyLib, cleanup } = require("./load-arkademy-lib");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_FILE = path.join(ROOT, "arkademy-content", "arkademy.json");
const STATUS_LIMIT = 10;
/** A pretty-printed file may be larger than its compact JSON; past this it is not read at all. */
const MAX_FILE_FACTOR = 4;

const USAGE = `usage:
  npm run arkademy -- check    [file]
  npm run arkademy -- publish  [file] [--note "…"] [--yes]
  npm run arkademy -- status
  npm run arkademy -- rollback [--to N] [--yes]`;

class ScriptExit extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

let lib;
function arkademy() {
  if (!lib) lib = loadArkademyLib();
  return lib;
}

/** The canonical text of a validated document, its SHA-256 and its size. */
function canonical(document) {
  const text = JSON.stringify(document);
  return {
    text,
    sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
    sizeBytes: Buffer.byteLength(text, "utf8"),
  };
}

async function readCurrent(client) {
  const { rows } = await client.query(
    "select version, sha256 from arkademy_documents order by version desc limit 1",
  );
  return rows[0] ? { version: rows[0].version, sha256: rows[0].sha256 } : null;
}

async function inTransaction(client, fn) {
  await client.query("begin");
  try {
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Validates `document` and inserts it as the next version, unless it is
 * byte-for-byte the current one. `client` is a connected pg.Client.
 *
 * → { status: "invalid", errors, warnings }
 * → { status: "unchanged", version, warnings }
 * → { status: "published", version, sha256, sizeBytes, warnings }
 */
async function publishDocument(client, document, { note = null } = {}) {
  const { validateArkademyDocument, ARKADEMY_FORMAT_VERSION } = arkademy();
  const result = validateArkademyDocument(document);
  if (!result.ok) return { status: "invalid", errors: result.errors, warnings: result.warnings };
  const { text, sha256, sizeBytes } = canonical(result.document);

  return inTransaction(client, async () => {
    const current = await readCurrent(client);
    if (current && current.sha256 === sha256) {
      return { status: "unchanged", version: current.version, warnings: result.warnings };
    }
    const version = current ? current.version + 1 : 1;
    // Two concurrent publishes both compute this version; the second insert
    // fails on the primary key (23505) and the command line exits 1 with a
    // plain message (withClient). Nothing is lost.
    await client.query(
      `insert into arkademy_documents (version, format_version, document, sha256, size_bytes, note)
       values ($1, $2, $3::jsonb, $4, $5, $6)`,
      [version, ARKADEMY_FORMAT_VERSION, text, sha256, sizeBytes, note],
    );
    return { status: "published", version, sha256, sizeBytes, warnings: result.warnings };
  });
}

/**
 * Re-publishes an earlier version as a new one, with `restored_from` set.
 * The target is `to`, or the newest version below the current one whose
 * hash differs from the current hash. It is re-validated against today's
 * schema first (after the format upgrade), and refused if it fails.
 *
 * → { status: "empty" }                     no version at all
 * → { status: "nothing" }                   no earlier version differs from the current one
 * → { status: "missing", to }               `to` names no version
 * → { status: "invalid", to, errors, warnings }
 * → { status: "unchanged", version, to }    `to` holds the current document already
 * → { status: "rolled-back", version, to, sha256, sizeBytes, warnings }
 */
async function rollbackDocument(client, { to } = {}) {
  const { validateArkademyDocument, upgradeArkademyDocument, ARKADEMY_FORMAT_VERSION } = arkademy();
  return inTransaction(client, async () => {
    const current = await readCurrent(client);
    if (!current) return { status: "empty" };

    const columns = "version, format_version, document";
    const { rows } =
      to === undefined
        ? await client.query(
            `select ${columns} from arkademy_documents
             where version < $1 and sha256 <> $2 order by version desc limit 1`,
            [current.version, current.sha256],
          )
        : await client.query(`select ${columns} from arkademy_documents where version = $1`, [to]);
    const target = rows[0];
    if (!target) return to === undefined ? { status: "nothing" } : { status: "missing", to };

    const upgraded = upgradeArkademyDocument(target.document, target.format_version);
    if (!upgraded.ok) {
      return {
        status: "invalid",
        to: target.version,
        errors: [{ level: "error", path: "$", message: upgraded.message }],
        warnings: [],
      };
    }
    const result = validateArkademyDocument(upgraded.document);
    if (!result.ok) {
      return { status: "invalid", to: target.version, errors: result.errors, warnings: result.warnings };
    }
    const { text, sha256, sizeBytes } = canonical(result.document);
    if (sha256 === current.sha256) return { status: "unchanged", version: current.version, to: target.version };

    const version = current.version + 1;
    await client.query(
      `insert into arkademy_documents (version, format_version, document, sha256, size_bytes, note, restored_from)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
      [version, ARKADEMY_FORMAT_VERSION, text, sha256, sizeBytes, `rollback to v${target.version}`, target.version],
    );
    return { status: "rolled-back", version, to: target.version, sha256, sizeBytes, warnings: result.warnings };
  });
}

/** The newest `limit` versions, newest first, without their documents. */
async function listVersions(client, limit = STATUS_LIMIT) {
  const { rows } = await client.query(
    `select version, format_version, sha256, size_bytes, note, restored_from, uploaded_at
     from arkademy_documents order by version desc limit $1`,
    [limit],
  );
  return rows.map((row) => ({
    version: row.version,
    formatVersion: row.format_version,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    note: row.note,
    restoredFrom: row.restored_from,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Making a write live
// ---------------------------------------------------------------------------

/**
 * How long a version can wait when nothing expires the app's cache: the data
 * cache's period (ARKADEMY_CACHE_SECONDS in lib/services/arkademy.ts, an
 * hour) plus the route's CDN window (s-maxage=60 + stale-while-revalidate=60
 * in app/api/arkademy/route.ts). Keep these words in step with both.
 */
const WAIT_WITHOUT_REVALIDATE = "within an hour (the app's cache period), plus up to 2 minutes at the CDN";
const REVALIDATE_PATH = "/api/arkademy/revalidate";
const REVALIDATE_TIMEOUT_MS = 10_000;

/**
 * Asks the deployment at `siteUrl` to expire its cached library, with the
 * bearer `secret`. Never throws, never prints the secret.
 *
 * → { status: "unconfigured", missing }   one variable or both unset: nothing called
 * → { status: "live" }                    the route answered 204
 * → { status: "failed", reason }          anything else, said plainly
 */
async function requestRevalidation({
  siteUrl = process.env.ARKADEMY_SITE_URL,
  secret = process.env.ARKADEMY_REVALIDATE_SECRET,
  fetchImpl = globalThis.fetch,
  timeoutMs = REVALIDATE_TIMEOUT_MS,
} = {}) {
  const missing = [];
  if (!siteUrl) missing.push("ARKADEMY_SITE_URL");
  if (!secret) missing.push("ARKADEMY_REVALIDATE_SECRET");
  if (missing.length > 0) return { status: "unconfigured", missing };

  let url;
  try {
    url = new URL(REVALIDATE_PATH, siteUrl);
  } catch {
    return { status: "failed", reason: "ARKADEMY_SITE_URL is not a URL" };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
    return { status: "failed", reason: "ARKADEMY_SITE_URL must be https (the secret would travel in clear), or http on this machine" };
  }
  let response;
  try {
    response = await fetchImpl(url.href, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      // A redirect (say, to www.) is reported, never followed with the token.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const cause = err && err.cause ? `: ${describeError(err.cause)}` : "";
    return { status: "failed", reason: `the call to ${url.origin} failed (${describeError(err)}${cause})` };
  }
  if (response.status === 204) return { status: "live" };
  if (response.status === 401) {
    return { status: "failed", reason: `${url.origin} answered 401: the secret does not match the deployment's ARKADEMY_REVALIDATE_SECRET` };
  }
  if (response.status === 404) {
    return {
      status: "failed",
      reason: `${url.origin} answered 404: ARKADEMY_REVALIDATE_SECRET is not set on that deployment, or ARKADEMY_SITE_URL is not the app`,
    };
  }
  return { status: "failed", reason: `${url.origin} answered ${response.status}` };
}

/** The one line the script prints about when a written version is live. */
function revalidationLine(result) {
  if (result.status === "live") {
    return "live now: the app's cache is cleared (GET /api/arkademy may answer from the CDN for up to 2 more minutes)";
  }
  if (result.status === "unconfigured") {
    return (
      `not live yet: expect it ${WAIT_WITHOUT_REVALIDATE}. ` +
      `${result.missing.join(" and ")} ${result.missing.length === 1 ? "is" : "are"} not set; set ARKADEMY_SITE_URL ` +
      "and ARKADEMY_REVALIDATE_SECRET to make a publish live at once (docs/arkademy.md § Production)"
    );
  }
  return (
    `not live yet: ${result.reason}. The version is published; expect it ${WAIT_WITHOUT_REVALIDATE}. ` +
    "Check ARKADEMY_SITE_URL and ARKADEMY_REVALIDATE_SECRET (docs/arkademy.md § Production)"
  );
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

const OPTIONS = {
  check: [],
  publish: ["note", "yes"],
  status: [],
  rollback: ["to", "yes"],
};
const TAKES_FILE = new Set(["check", "publish"]);
/** The largest `version` the table's `int` column holds. */
const MAX_VERSION = 2147483647;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") throw new ScriptExit(USAGE, 2);
  if (!Object.hasOwn(OPTIONS, command)) throw new ScriptExit(`unknown command "${command}"\n${USAGE}`, 2);
  const args = { command, file: null, note: null, yes: false, to: undefined };
  const allowed = OPTIONS[command];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const [flag, inline] = arg.startsWith("--") ? arg.slice(2).split(/=(.*)/s) : [null, undefined];
    if (flag === null) {
      if (!TAKES_FILE.has(command) || args.file !== null) throw new ScriptExit(`unexpected argument "${arg}"\n${USAGE}`, 2);
      args.file = arg;
      continue;
    }
    if (!allowed.includes(flag)) throw new ScriptExit(`"${command}" takes no --${flag}\n${USAGE}`, 2);
    if (flag === "yes") {
      args.yes = true;
      continue;
    }
    // A value given as the next argument never starts with "--": in
    // `--note --yes` the owner forgot the note; `--note=--x` says it on purpose.
    const value = inline !== undefined ? inline : rest[index + 1];
    if (value === undefined || (inline === undefined && value.startsWith("--"))) {
      throw new ScriptExit(`--${flag} needs a value (write --${flag}=… for one that starts with --)\n${USAGE}`, 2);
    }
    if (inline === undefined) index += 1;
    if (flag === "note") args.note = value;
    if (flag === "to") {
      if (!/^[1-9][0-9]*$/.test(value) || Number(value) > MAX_VERSION) {
        throw new ScriptExit(`--to takes a version number from 1 to ${MAX_VERSION}, not "${value}"`, 2);
      }
      args.to = Number(value);
    }
  }
  return args;
}

function resolveFile(fileArg) {
  const chosen = fileArg ?? process.env.ARKADEMY_CONTENT ?? DEFAULT_FILE;
  // `npm run` starts scripts in the repository root; INIT_CWD is where the
  // owner typed the command, which is what a relative path means to them.
  return path.resolve(process.env.INIT_CWD || process.cwd(), chosen);
}

function readDocumentFile(file, maxBytes) {
  if (!fs.existsSync(file)) {
    throw new ScriptExit(
      `no file at ${file}\nPass a path, set ARKADEMY_CONTENT, or keep the library at arkademy-content/arkademy.json.`,
    );
  }
  const stat = fs.statSync(file);
  if (stat.isDirectory()) throw new ScriptExit(`${file} is a directory, not a file; name the JSON file inside it`);
  if (!stat.isFile()) throw new ScriptExit(`${file} is not a regular file`);
  if (stat.size > maxBytes * MAX_FILE_FACTOR) {
    throw new ScriptExit(`${file} is ${stat.size} bytes; the document may hold at most ${maxBytes} bytes of JSON`);
  }
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    const reason = err && err.code === "EACCES" ? "permission denied" : describeError(err);
    throw new ScriptExit(`${file} cannot be read: ${reason}${err && err.code ? ` (${err.code})` : ""}`);
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new ScriptExit(`${file} starts with a UTF-8 byte-order mark; save it as UTF-8 without one`);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ScriptExit(`${file} is not UTF-8 text; save it as UTF-8`);
  }
  try {
    return { text, input: JSON.parse(text) };
  } catch (err) {
    throw new ScriptExit(`${file} is not JSON: ${err.message}`);
  }
}

function printFindings({ errors = [], warnings = [] }) {
  for (const finding of warnings) console.log(`warning  ${finding.path}  ${finding.message}`);
  for (const finding of errors) console.error(`error    ${finding.path}  ${finding.message}`);
}

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Whether `host`, as pg resolved it, is this machine: a Unix-socket directory
 * (an absolute path), `localhost`, an address in 127.0.0.0/8, or ::1 in any
 * spelling. Everything else is remote, including a name that merely starts
 * with "localhost" and 0.0.0.0.
 */
function isLocalHost(host) {
  if (typeof host !== "string" || host === "") return false;
  if (host.startsWith("/")) return true;
  const bare = host.replace(/^\[(.*)\]$/, "$1").toLowerCase().replace(/\.$/, "");
  if (bare === "localhost") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(bare)) return true;
  if (/^::ffff:127(?:\.\d{1,3}){3}$/.test(bare)) return true;
  return /^(?:0{0,4}:){2,7}0{0,3}1$/.test(bare) && net.isIPv6(bare);
}

/**
 * The database a command will use, decided from the pg Client the driver
 * connects with — built here, not yet connected — so a `?host=` parameter or
 * PGHOST/PGDATABASE in the environment count exactly as they will when it
 * connects. What it returns for printing never holds the password.
 */
function databaseTarget(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new ScriptExit(
      "DATABASE_URL is not set. Pass it inline (DATABASE_URL=… npm run arkademy -- …) or with " +
        "node --env-file=.env.arkademy-prod scripts/arkademy/upload.js … (a file name Next never loads; see docs/arkademy.md)",
    );
  }
  const { Client } = require("pg");
  let client;
  try {
    client = new Client({ connectionString });
  } catch (err) {
    throw new ScriptExit(`DATABASE_URL cannot be used: ${describeError(err)}`);
  }
  const host = String(client.host ?? "");
  return {
    client,
    host,
    port: client.port,
    database: client.database ? String(client.database) : "(default)",
    local: isLocalHost(host),
  };
}

/**
 * A failure's reason, never empty: its message; or, for an AggregateError
 * with none (Node's when every address of `localhost` refuses), its errors'
 * messages joined; or its code (`ECONNREFUSED`).
 */
function describeError(err) {
  if (err && typeof err.message === "string" && err.message.trim() !== "") return err.message;
  if (err && Array.isArray(err.errors) && err.errors.length > 0) {
    const messages = [...new Set(err.errors.map((inner) => describeError(inner)))];
    return messages.join("; ");
  }
  if (err && typeof err.code === "string" && err.code !== "") return err.code;
  return "unknown error (no message or code)";
}

/** Connects the very Client `databaseTarget` resolved and announced. */
async function withClient(target, fn) {
  const { client } = target;
  try {
    await client.connect();
  } catch (err) {
    throw new ScriptExit(`could not connect to ${target.host}: ${describeError(err)}`);
  }
  try {
    return await fn(client);
  } catch (err) {
    if (err && err.code === "42P01") {
      throw new ScriptExit(`${err.message}: run npm run db:migrate against ${target.host} first`);
    }
    if (err && err.code === "23505") {
      // Two writes computed the same next version; the other one committed.
      const taken = /\(version\)=\((\d+)\)/.exec(err.detail || "");
      throw new ScriptExit(
        `another publish or rollback wrote ${taken ? `v${taken[1]}` : "the next version"} at the same moment; ` +
          "this run wrote nothing. Run status, then try again if it is still needed",
      );
    }
    if (err && typeof err.severity === "string" && typeof err.code === "string") {
      throw new ScriptExit(`Postgres refused: ${describeError(err)} (${err.code})`);
    }
    throw err;
  } finally {
    await client.end();
  }
}

function announce(target, { writes, yes }) {
  const where = target.host.startsWith("/") ? `the local socket in ${target.host}` : target.host;
  console.log(`database: ${target.database} on ${where}`);
  if (writes && !target.local && !yes) {
    throw new ScriptExit(`${target.host} is not this machine; add --yes to write to it`);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const { validateArkademyDocument, duplicateJsonKeys, MAX_DOCUMENT_BYTES } = arkademy();

  if (args.command === "check" || args.command === "publish") {
    const file = resolveFile(args.file);
    const { text, input } = readDocumentFile(file, MAX_DOCUMENT_BYTES);
    // JSON.parse keeps the last of two equal keys; the text shows both.
    const repeated = duplicateJsonKeys(text);
    const result = validateArkademyDocument(input);
    const errors = [...repeated, ...(result.ok ? [] : result.errors)];
    printFindings({ errors, warnings: result.warnings });
    if (errors.length > 0) throw new ScriptExit(`${plural(errors.length, "error")} in ${file}; nothing written`);
    const { document } = result;
    const { sizeBytes } = canonical(document);
    console.log(
      `valid: ${file} (${kilobytes(sizeBytes)}; ${plural(document.tools[0].examples.length, "example")}, ` +
        `${plural(document.entities.length, "entity", "entities")}, ${plural(document.uses.length, "use")}, ` +
        `${plural(result.warnings.length, "warning")})`,
    );
    if (args.command === "check") return 0;

    const target = databaseTarget();
    announce(target, { writes: true, yes: args.yes });
    const outcome = await withClient(target, (client) => publishDocument(client, input, { note: args.note }));
    if (outcome.status === "unchanged") {
      console.log(`unchanged (v${outcome.version})`);
      return 0;
    }
    if (outcome.status !== "published") {
      printFindings(outcome);
      throw new ScriptExit("the document did not validate; nothing written");
    }
    console.log(`published v${outcome.version} (${kilobytes(outcome.sizeBytes)}, ${plural(outcome.warnings.length, "warning")})`);
    console.log(revalidationLine(await requestRevalidation()));
    return 0;
  }

  const target = databaseTarget();
  if (args.command === "status") {
    announce(target, { writes: false });
    const versions = await withClient(target, (client) => listVersions(client, STATUS_LIMIT));
    if (versions.length === 0) {
      console.log("no version uploaded yet");
      return 0;
    }
    console.log("version  uploaded_at               size       sha256    from  note");
    for (const row of versions) {
      console.log(
        [
          `v${row.version}`.padEnd(7),
          row.uploadedAt.padEnd(24),
          kilobytes(row.sizeBytes).padStart(9),
          row.sha256.slice(0, 8),
          (row.restoredFrom === null ? "" : `v${row.restoredFrom}`).padEnd(4),
          row.note ?? "",
        ].join("  "),
      );
    }
    return 0;
  }

  // rollback
  announce(target, { writes: true, yes: args.yes });
  const outcome = await withClient(target, (client) => rollbackDocument(client, { to: args.to }));
  switch (outcome.status) {
    case "empty":
      throw new ScriptExit("nothing to roll back: no version has been uploaded");
    case "nothing":
      throw new ScriptExit("nothing to roll back to: no earlier version differs from the current one");
    case "missing":
      throw new ScriptExit(`there is no v${outcome.to}`);
    case "invalid":
      printFindings(outcome);
      throw new ScriptExit(`v${outcome.to} no longer passes today's schema; nothing written`);
    case "unchanged":
      console.log(`unchanged (v${outcome.version} already holds v${outcome.to}'s document)`);
      return 0;
    default:
      console.log(`rolled back: v${outcome.version} restores v${outcome.to}`);
      console.log(revalidationLine(await requestRevalidation()));
      return 0;
  }
}

module.exports = {
  publishDocument,
  rollbackDocument,
  listVersions,
  parseArgs,
  describeError,
  databaseTarget,
  isLocalHost,
  announce,
  requestRevalidation,
  revalidationLine,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      cleanup();
      process.exitCode = code;
    },
    (err) => {
      cleanup();
      if (err instanceof ScriptExit) {
        console.error(`[arkademy] ${err.message}`);
        process.exitCode = err.code;
      } else {
        console.error(`[arkademy] ${err && err.stack ? err.stack : err}`);
        process.exitCode = 1;
      }
    },
  );
}
