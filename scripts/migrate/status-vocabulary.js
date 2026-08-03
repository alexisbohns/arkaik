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
  const { migrateStatusVocabulary, STATUS_VOCABULARY_VERSION } = loadSchemaPackage();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // One transaction around the whole run, with SELECT … FOR UPDATE: every
    // project row stays locked until commit, so a concurrent hosted write
    // cannot slip a snapshot change between our read and our write (the
    // classic lost update). The table is small — hosted tier limits cap the
    // project count — so holding the locks for the run is fine.
    await client.query("begin");
    const { rows } = await client.query(
      "select id, snapshot, schema_version from graph_projects for update",
    );
    let changed = 0;
    for (const row of rows) {
      try {
        const migrated = migrateStatusVocabulary(row.snapshot);
        // Same reference back = a clean v3 snapshot; nothing to write. Anything
        // pre-v3 always comes back as a new object (the stamp alone changes it).
        if (migrated === row.snapshot) continue;
        changed++;
        // What kind of change, decidable from the snapshot's DECLARED version
        // (the vintage the migration itself gates on — the bookkeeping column
        // defaults to 2 and may disagree): pre-v3 rows take the full remap and
        // the stamp; v3-or-later rows only had dead-id aliases repaired.
        const declared = row.snapshot ? row.snapshot.schema_version : undefined;
        const reason =
          typeof declared === "number" && declared >= STATUS_VOCABULARY_VERSION
            ? "(alias repair)"
            : `(v${declared ?? "?"} -> v${STATUS_VOCABULARY_VERSION})`;
        if (dryRun) {
          console.log(`[dry-run] would migrate ${row.id} ${reason}`);
          continue;
        }
        console.log(`migrating ${row.id} ${reason}`);
        // Stamp the bookkeeping column too, so it agrees with the snapshot.
        await client.query(
          "update graph_projects set snapshot = $1, schema_version = $2 where id = $3",
          [JSON.stringify(migrated), migrated.schema_version, row.id],
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`while migrating row ${row.id}: ${detail}`);
      }
    }
    // A dry run writes nothing; rolling back also releases the locks either way
    // on the error path below.
    await client.query(dryRun ? "rollback" : "commit");
    console.log(
      dryRun
        ? `[dry-run] ${changed} of ${rows.length} snapshot(s) would be migrated.`
        : `${changed} of ${rows.length} snapshot(s) migrated to the v3 status vocabulary.`,
    );
  } catch (err) {
    // Nothing partial may survive: roll the whole transaction back, then let
    // the outer handler report and exit 1.
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
    cleanup();
  }
}

main().catch((err) => {
  cleanup();
  fail(err instanceof Error ? err.stack || err.message : String(err));
});
