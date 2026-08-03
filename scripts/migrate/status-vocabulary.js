#!/usr/bin/env node

/**
 * One-shot: upgrade every graph_projects.snapshot to the v3 status vocabulary.
 * Run manually against prod (deploys do NOT run migrations):
 *   DATABASE_URL=... node scripts/migrate/status-vocabulary.js [--dry-run]
 *
 * Applies `migrateStatusVocabulary` (@arkaik/schema) to each stored snapshot:
 * pre-v3 snapshots get the full remap (old `backlog` someday pile → `idea`,
 * `prioritized` → new `backlog`, `blocked` → `development` + metadata.blocked_by)
 * and the `schema_version: 3` stamp; v3 snapshots only have the permanent
 * dead-id aliases repaired and come back as the SAME reference when clean, so
 * re-running is a no-op. The journal (graph_events) is history and is never
 * rewritten. `updated_at` is left alone — this is not a user edit.
 *
 * With --dry-run, rows that would change are logged and nothing is written.
 *
 * The schema package is TypeScript-source-only, so it is loaded through the
 * same transpile-on-the-fly loader the generators use
 * (scripts/generate/load-schema-package.js) — run from a checkout with dev
 * dependencies installed.
 */

const { Client } = require("pg");
const { loadSchemaPackage, cleanup } = require("../generate/load-schema-package");

const dryRun = process.argv.includes("--dry-run");

function fail(message) {
  console.error(`[status-vocabulary] ${message}`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  fail(
    "DATABASE_URL is not set. This one-shot runs manually against the hosted " +
      "Postgres (deploys do not run migrations): " +
      "DATABASE_URL=... node scripts/migrate/status-vocabulary.js [--dry-run]",
  );
}

async function main() {
  const { migrateStatusVocabulary } = loadSchemaPackage();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query("select id, snapshot from graph_projects");
    let changed = 0;
    for (const row of rows) {
      const migrated = migrateStatusVocabulary(row.snapshot);
      // Same reference back = a clean v3 snapshot; nothing to write. Anything
      // pre-v3 always comes back as a new object (the stamp alone changes it).
      if (migrated === row.snapshot) continue;
      changed++;
      if (dryRun) {
        console.log(`[dry-run] would migrate ${row.id}`);
        continue;
      }
      console.log(`migrating ${row.id}`);
      // Stamp the bookkeeping column too, so it agrees with the snapshot.
      await client.query(
        "update graph_projects set snapshot = $1, schema_version = $2 where id = $3",
        [JSON.stringify(migrated), migrated.schema_version, row.id],
      );
    }
    console.log(
      dryRun
        ? `[dry-run] ${changed} of ${rows.length} snapshot(s) would be migrated.`
        : `${changed} of ${rows.length} snapshot(s) migrated to the v3 status vocabulary.`,
    );
  } finally {
    await client.end();
    cleanup();
  }
}

main().catch((err) => {
  cleanup();
  fail(err instanceof Error ? err.stack || err.message : String(err));
});
