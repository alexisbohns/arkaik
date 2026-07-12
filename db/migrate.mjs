#!/usr/bin/env node

/**
 * Idempotent Postgres migration runner (docs/spec/services.md § Backend —
 * Decision Record → "Migrations").
 *
 * Applies every pending `db/migrations/NNN_name.sql` file in filename order,
 * each in its own transaction, and records the filename + applied_at in the
 * `_migrations` bookkeeping table. Re-running is a no-op: already-applied
 * files are skipped, so `npm run db:migrate` is safe to run repeatedly (the
 * CI "services" job runs it twice as an idempotency gate).
 *
 * Plain Node + `pg` (no ORM / migration framework): the same `pg` client that
 * backs the service route handlers works against the CI Postgres service
 * container and any self-hosted Postgres (Inkognito).
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function fail(message) {
  console.error(`\n[db:migrate] ${message}`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  fail(
    "DATABASE_URL is not set. Services require a Postgres connection string; " +
      "the local-first app runs without one. Copy .env.example to .env.local " +
      "and set DATABASE_URL, or export it inline. See docs/spec/services.md.",
  );
}

async function listMigrationFiles() {
  let entries;
  try {
    entries = await readdir(MIGRATIONS_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  // Filename order is migration order (001_, 002_, …). A plain lexical sort is
  // correct given the zero-padded NNN_ prefix convention.
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

async function main() {
  const files = await listMigrationFiles();

  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (err) {
    fail(`Could not connect to Postgres at DATABASE_URL: ${err.message}`);
  }

  let appliedCount = 0;
  try {
    // Bootstrap the bookkeeping table so we can read applied state even on a
    // pristine database (the first migration also declares it, idempotently).
    await client.query(
      `create table if not exists _migrations (
         filename   text primary key,
         applied_at timestamptz not null default now()
       )`,
    );

    const { rows } = await client.query("select filename from _migrations");
    const applied = new Set(rows.map((row) => row.filename));

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`[db:migrate] skip    ${filename} (already applied)`);
        continue;
      }

      const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into _migrations (filename) values ($1)", [filename]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw new Error(`migration ${filename} failed: ${err.message}`);
      }

      appliedCount += 1;
      console.log(`[db:migrate] applied ${filename}`);
    }
  } catch (err) {
    await client.end();
    fail(err.message);
    return;
  }

  await client.end();

  if (appliedCount === 0) {
    console.log("[db:migrate] up to date — no pending migrations.");
  } else {
    console.log(`[db:migrate] done — applied ${appliedCount} migration(s).`);
  }
}

main().catch((err) => fail(err.stack || err.message));
