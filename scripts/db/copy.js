#!/usr/bin/env node

/**
 * Copies the whole arkaik database from one Postgres to another — written for
 * the move off Neon onto a self-hosted (Coolify) Postgres, and for rehearsing
 * that move as often as needed before the cutover (docs/spec/services.md §
 * Moving to another Postgres).
 *
 *   SOURCE_DATABASE_URL=postgres://…neon…   \
 *   TARGET_DATABASE_URL=postgres://arkaik_app:…@host:port/arkaik \
 *   TARGET_CA_FILE=./coolify-ca.crt          \
 *   npm run db:copy [-- --verify-only]
 *
 * What it does, in order, stopping at the first problem:
 *   1. connects to both and prints each server's version; refuses a target
 *      whose `public` schema already holds a table (restore into an empty
 *      database, or drop and recreate it first — nothing here deletes data);
 *   2. `pg_dump --format=custom --schema=public --no-owner --no-acl` of the
 *      source to a temp file. Only `public`: every arkaik table lives there,
 *      and a provider's own schemas (Neon creates `neon_auth`) stay behind.
 *      Every object is re-owned by the TARGET's login role on restore (the
 *      app's own role, never the superuser);
 *   3. `pg_restore --single-transaction --exit-on-error` into the target — a
 *      failure leaves the target exactly as empty as it was;
 *   4. compares an exact `count(*)` of every table on both sides, and the
 *      `_migrations` ledger, and exits non-zero on any difference.
 *
 * `--verify-only` runs step 4 alone, for the final check after the cutover
 * dump. The `_migrations` table travels with the data, so `npm run db:migrate`
 * against the target afterwards reports "up to date".
 *
 * TLS: the target is verified against TARGET_CA_FILE (full verification, chain
 * and host/IP) when given; the source keeps whatever its URL says. Passwords
 * reach pg_dump/pg_restore through PGPASSWORD, never the command line, so they
 * do not show up in `ps`.
 *
 * Needs pg_dump and pg_restore on PATH, of a major version at least the
 * source's (`brew install libpq` and add its bin to PATH, on a Mac).
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("pg");
const { pgConfig } = require("../../db/pg-config");

function fail(message) {
  console.error(`\n[db:copy] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[db:copy] ${message}`);
}

const verifyOnly = process.argv.includes("--verify-only");
const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;
const caFile = process.env.TARGET_CA_FILE;

if (!sourceUrl || !targetUrl) {
  fail("SOURCE_DATABASE_URL and TARGET_DATABASE_URL are both required. See the header of scripts/db/copy.js.");
}
if (sourceUrl === targetUrl) fail("SOURCE_DATABASE_URL and TARGET_DATABASE_URL are the same database.");

let caPem;
if (caFile) {
  try {
    caPem = fs.readFileSync(caFile, "utf8");
  } catch (err) {
    fail(`TARGET_CA_FILE cannot be read: ${err.message}`);
  }
}

const sourceConfig = pgConfig(sourceUrl, {});
const targetConfig = pgConfig(targetUrl, { DATABASE_CA_CERT: caPem });

/** Where a URL points, for printing — never the password. */
function describe(url) {
  const u = new URL(url);
  return `${u.username || "(default user)"}@${u.hostname}:${u.port || 5432}${u.pathname}`;
}

/**
 * A libpq-ready URL without its password, plus the env carrying it. For the
 * target with a CA, TLS is pinned the libpq way: verify-full + sslrootcert.
 */
function libpqTarget(url, caPath) {
  const u = new URL(url);
  const password = decodeURIComponent(u.password);
  u.password = "";
  if (caPath) {
    for (const name of ["ssl", "sslmode", "sslrootcert", "uselibpqcompat"]) u.searchParams.delete(name);
    u.searchParams.set("sslmode", "verify-full");
    u.searchParams.set("sslrootcert", caPath);
  }
  // uselibpqcompat is a node-postgres-only parameter libpq would reject.
  u.searchParams.delete("uselibpqcompat");
  // libpq verifies against ~/.postgresql/root.crt unless told otherwise; a
  // provider with a public certificate (Neon) needs the system's roots.
  const mode = u.searchParams.get("sslmode");
  if ((mode === "verify-full" || mode === "verify-ca") && !u.searchParams.get("sslrootcert")) {
    u.searchParams.set("sslrootcert", "system");
  }
  return { url: u.toString(), env: { ...process.env, PGPASSWORD: password } };
}

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, { env, stdio: ["ignore", "inherit", "inherit"] });
  if (result.error) {
    if (result.error.code === "ENOENT") fail(`${cmd} is not on PATH. See the header of scripts/db/copy.js.`);
    fail(`${cmd} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) fail(`${cmd} exited with status ${result.status}.`);
}

function toolMajor(cmd) {
  const result = spawnSync(cmd, ["--version"], { encoding: "utf8" });
  if (result.error) fail(`${cmd} is not on PATH. See the header of scripts/db/copy.js.`);
  const match = /(\d+)(?:\.\d+)?/.exec(result.stdout);
  return match ? Number(match[1]) : NaN;
}

async function connect(config, label) {
  const client = new Client(config);
  try {
    await client.connect();
  } catch (err) {
    fail(`could not connect to the ${label}: ${err.message}`);
  }
  return client;
}

async function serverMajor(client) {
  const { rows } = await client.query("show server_version_num");
  return Math.floor(Number(rows[0].server_version_num) / 10000);
}

async function publicTables(client) {
  const { rows } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  return rows.map((row) => row.table_name);
}

async function counts(client, tables) {
  const out = new Map();
  for (const table of tables) {
    // Identifiers cannot be $-params; these names come from the catalog, and
    // are quoted with any embedded quote doubled.
    const ident = `"${table.replace(/"/g, '""')}"`;
    const { rows } = await client.query(`select count(*)::bigint as n from public.${ident}`);
    out.set(table, String(rows[0].n));
  }
  return out;
}

async function migrationsLedger(client) {
  try {
    const { rows } = await client.query("select filename from _migrations order by filename");
    return rows.map((row) => row.filename).join(",");
  } catch {
    return "(no _migrations table)";
  }
}

async function verify(source, target) {
  const sourceTables = await publicTables(source);
  const targetTables = await publicTables(target);
  const missing = sourceTables.filter((t) => !targetTables.includes(t));
  const extra = targetTables.filter((t) => !sourceTables.includes(t));

  const sourceCounts = await counts(source, sourceTables);
  const targetCounts = await counts(
    target,
    sourceTables.filter((t) => targetTables.includes(t)),
  );

  let problems = 0;
  const width = Math.max(...sourceTables.map((t) => t.length), 5);
  log(`${"table".padEnd(width)}  ${"source".padStart(10)}  ${"target".padStart(10)}`);
  for (const table of sourceTables) {
    const s = sourceCounts.get(table);
    const t = targetCounts.get(table) ?? "missing";
    const ok = s === t;
    if (!ok) problems += 1;
    log(`${table.padEnd(width)}  ${s.padStart(10)}  ${t.padStart(10)}${ok ? "" : "   <-- differs"}`);
  }
  for (const table of extra) {
    problems += 1;
    log(`${table.padEnd(width)}  ${"absent".padStart(10)}  ${"present".padStart(10)}   <-- only on target`);
  }
  if (missing.length) log(`missing on target: ${missing.join(", ")}`);

  const ledgerSource = await migrationsLedger(source);
  const ledgerTarget = await migrationsLedger(target);
  if (ledgerSource !== ledgerTarget) {
    problems += 1;
    log("_migrations ledgers differ between source and target.");
  }

  if (problems) fail(`verification found ${problems} difference(s).`);
  log(`verified — ${sourceTables.length} tables match row for row, and the _migrations ledgers agree.`);
}

async function main() {
  log(`source: ${describe(sourceUrl)}`);
  log(`target: ${describe(targetUrl)}${caPem ? " (TLS pinned to TARGET_CA_FILE)" : ""}`);

  const source = await connect(sourceConfig, "source");
  const target = await connect(targetConfig, "target");
  const sourceVersion = await serverMajor(source);
  const targetVersion = await serverMajor(target);
  log(`server versions: source ${sourceVersion}, target ${targetVersion}`);

  try {
    if (!verifyOnly) {
      if (targetVersion < sourceVersion) {
        fail(
          `the target runs Postgres ${targetVersion}, older than the source's ${sourceVersion}. ` +
            "A dump only restores reliably onto the same or a newer major version.",
        );
      }
      const existing = await publicTables(target);
      if (existing.length) {
        fail(
          `the target's public schema already holds ${existing.length} table(s) (${existing.slice(0, 5).join(", ")}…). ` +
            "Restore into an empty database; this script never deletes data.",
        );
      }
      for (const tool of ["pg_dump", "pg_restore"]) {
        const major = toolMajor(tool);
        if (!(major >= sourceVersion)) {
          fail(`${tool} is version ${major}; it must be at least the source server's ${sourceVersion}.`);
        }
      }

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arkaik-db-copy-"));
      const dumpFile = path.join(dir, "arkaik.dump");
      let caPath;
      if (caPem) {
        caPath = path.join(dir, "ca.crt");
        fs.writeFileSync(caPath, caPem, { mode: 0o600 });
      }
      try {
        const from = libpqTarget(sourceUrl);
        log("dumping the source…");
        run("pg_dump", ["--format=custom", "--schema=public", "--no-owner", "--no-acl", `--file=${dumpFile}`, `--dbname=${from.url}`], from.env);
        log(`dump written (${(fs.statSync(dumpFile).size / 1024).toFixed(0)} KiB). restoring into the target…`);
        // A one-schema dump carries `CREATE SCHEMA public`, which every target
        // already has. Restore from the dump's table of contents minus that
        // one entry, so the restore can stay all-or-nothing.
        const toc = spawnSync("pg_restore", ["--list", dumpFile], { encoding: "utf8" });
        if (toc.status !== 0) fail(`pg_restore --list failed: ${toc.stderr}`);
        const listFile = path.join(dir, "restore.list");
        fs.writeFileSync(
          listFile,
          toc.stdout
            .split("\n")
            .filter((line) => !/^\d+;.*\bSCHEMA - public\b/.test(line))
            .join("\n"),
        );
        const to = libpqTarget(targetUrl, caPath);
        run(
          "pg_restore",
          [
            "--no-owner",
            "--no-acl",
            "--single-transaction",
            "--exit-on-error",
            `--use-list=${listFile}`,
            `--dbname=${to.url}`,
            dumpFile,
          ],
          to.env,
        );
        log("restored.");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    await verify(source, target);
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

main().catch((err) => fail(err.stack || err.message));
