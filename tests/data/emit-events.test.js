#!/usr/bin/env node

/**
 * Unit tests for the app-side journal event derivation (lib/data/emit-events.ts,
 * issue #218) — the pure half of the provider's dual-write. Structured as a pure
 * function precisely so it can be exercised WITHOUT a real IndexedDB (no
 * fake-indexeddb dev dependency): the Dexie append is a thin `journals`-row
 * write covered by the append helper's contract; the interesting logic (the
 * per-key diff, the screenshot exclusion, the status-vs-updated-vs-ref decision)
 * lives here and is tested directly.
 *
 * Covers the issue's acceptance list:
 *  - create → node.created;
 *  - status change → project-level node.status_changed (no platform);
 *  - per-platform status → node.status_changed + platform;
 *  - note edit on a node WITH a screenshot → node.updated with the PATH only and
 *    NO data-URI anywhere in the event;
 *  - delete node with edges → single node.deleted, no edge.removed;
 *  - ref add/remove → ref.added / ref.removed;
 *  - the resulting (snapshot, journal) passes crossCheckJournal + validateBundle.
 */

const path = require("path");
const fs = require("fs");
const { loadEmitEvents, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-emit-events");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function main() {
  const emit = loadEmitEvents();
  // Built by loadEmitEvents() above; require the same instance so makeEvent and
  // crossCheckJournal share module state.
  const { crossCheckJournal, validateBundle } = require(path.join(SCHEMA_BUILD_DIR, "index.js"));
  const {
    nodeCreatedInput,
    nodeDeletedInput,
    edgeAddedInput,
    edgeRemovedInput,
    diffNodeUpdate,
    toJournalEvents,
    APP_ACTOR,
  } = emit;

  const PROJECT_ID = "p1";
  const baseNode = {
    id: "V-home",
    project_id: PROJECT_ID,
    species: "view",
    title: "Home",
    status: "idea",
    platforms: ["web", "ios"],
  };

  // --- create → node.created ------------------------------------------------
  {
    const [ev] = toJournalEvents([nodeCreatedInput(baseNode)]);
    check(
      "createNode → node.created with node_id/species/title",
      ev.type === "node.created" && ev.node_id === "V-home" && ev.species === "view" && ev.title === "Home",
      JSON.stringify(ev),
    );
    check("node.created carries the app actor + a ULID id", ev.actor === APP_ACTOR && ULID_RE.test(ev.id));
  }

  // --- status change → project-level node.status_changed --------------------
  {
    const inputs = diffNodeUpdate({ ...baseNode, status: "development" }, { status: "live" });
    check("status change yields exactly one event", inputs.length === 1, JSON.stringify(inputs));
    const p = inputs[0];
    check(
      "status change → node.status_changed (project-level, no platform)",
      p.type === "node.status_changed" &&
        p.payload.from === "development" &&
        p.payload.to === "live" &&
        p.payload.platform === undefined,
      JSON.stringify(p),
    );
    // The to must equal the new snapshot status — the cross-check's anchor.
    const [ev] = toJournalEvents(inputs);
    check("makeEvent validates the status_changed payload", ev.type === "node.status_changed" && ev.to === "live");
  }

  // --- per-platform status → node.status_changed + platform -----------------
  {
    const current = { ...baseNode, status: "development", metadata: { platformStatuses: { ios: "development" } } };
    const patch = { metadata: { platformStatuses: { ios: "live" }, platformNotes: {}, platformScreenshots: {} } };
    const inputs = diffNodeUpdate(current, patch);
    check("per-platform status change yields one event", inputs.length === 1, JSON.stringify(inputs));
    const p = inputs[0];
    check(
      "per-platform status → node.status_changed with platform",
      p.type === "node.status_changed" && p.payload.platform === "ios" && p.payload.from === "development" && p.payload.to === "live",
      JSON.stringify(p),
    );

    // Newly-added platform override: missing endpoint falls back to node status,
    // so both from/to stay valid statuses (schema requires it).
    const added = diffNodeUpdate(
      { ...baseNode, status: "development" },
      { metadata: { platformStatuses: { ios: "live" } } },
    );
    check(
      "added platform override falls back to node status for `from`",
      added.length === 1 && added[0].payload.from === "development" && added[0].payload.to === "live" && added[0].payload.platform === "ios",
      JSON.stringify(added),
    );
    // And it must survive makeEvent validation.
    let ok = true;
    try {
      toJournalEvents(added);
    } catch {
      ok = false;
    }
    check("added platform override validates via makeEvent", ok);
  }

  // --- note edit on a node WITH a screenshot: path only, NO data-URI --------
  {
    const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    // NodeDetailPanel.handleNotesChange rewrites the WHOLE metadata object,
    // carrying the untouched screenshot forward — the exact drag-in hazard.
    const current = {
      ...baseNode,
      metadata: { platformNotes: { web: "old" }, platformScreenshots: { web: dataUri } },
    };
    const patch = {
      metadata: { platformNotes: { web: "new" }, platformStatuses: {}, platformScreenshots: { web: dataUri } },
    };
    const inputs = diffNodeUpdate(current, patch);
    const events = toJournalEvents(inputs);
    check("note edit → exactly one node.updated", inputs.length === 1 && inputs[0].type === "node.updated", JSON.stringify(inputs));
    check(
      "node.updated records only the note PATH",
      JSON.stringify(inputs[0].payload.fields) === JSON.stringify(["metadata.platformNotes.web"]),
      JSON.stringify(inputs[0].payload),
    );
    check("node.updated for a metadata path carries no from/to", inputs[0].payload.from === undefined && inputs[0].payload.to === undefined);
    check("the screenshot data-URI is NOWHERE in the emitted event", !JSON.stringify(events).includes(dataUri));

    // And a screenshot CHANGE records only its path — never the old/new blob.
    const scOld = "data:image/png;base64,OLDSHOT";
    const scNew = "data:image/png;base64,NEWSHOT";
    const scInputs = diffNodeUpdate(
      { ...baseNode, metadata: { platformScreenshots: { web: scOld } } },
      { metadata: { platformScreenshots: { web: scNew }, platformNotes: {}, platformStatuses: {} } },
    );
    const scStr = JSON.stringify(toJournalEvents(scInputs));
    check(
      "screenshot change → node.updated path only, no blob",
      scInputs.length === 1 &&
        JSON.stringify(scInputs[0].payload.fields) === JSON.stringify(["metadata.platformScreenshots.web"]) &&
        !scStr.includes(scOld) &&
        !scStr.includes(scNew),
      scStr,
    );
  }

  // --- a title rename keeps from/to (single short top-level scalar) ----------
  {
    const inputs = diffNodeUpdate(baseNode, { title: "Home v2" });
    check(
      "title rename → node.updated fields:[title] with from/to",
      inputs.length === 1 &&
        inputs[0].type === "node.updated" &&
        JSON.stringify(inputs[0].payload.fields) === JSON.stringify(["title"]) &&
        inputs[0].payload.from === "Home" &&
        inputs[0].payload.to === "Home v2",
      JSON.stringify(inputs),
    );
  }

  // --- delete node with edges → single node.deleted, no edge.removed --------
  {
    // The provider cascade-deletes edges but emits ONLY node.deleted; there is
    // no edge.removed builder invoked on that path (docs/spec/journal.md:71).
    const events = toJournalEvents([nodeDeletedInput("V-home")]);
    check(
      "deleteNode with edges → single node.deleted, no edge.removed",
      events.length === 1 && events[0].type === "node.deleted" && events[0].node_id === "V-home" && !JSON.stringify(events).includes("edge.removed"),
      JSON.stringify(events),
    );
  }

  // --- ref add / remove → ref.added / ref.removed ---------------------------
  {
    const refA = { id: "gh-1", type: "github-issue", url: "https://example.com/1" };
    const refB = { id: "gh-2", type: "github-pr", url: "https://example.com/2" };
    const added = diffNodeUpdate({ ...baseNode, metadata: { refs: [refA] } }, { metadata: { refs: [refA, refB] } });
    check(
      "ref gained → ref.added with ref_id/ref_type/url",
      added.length === 1 && added[0].type === "ref.added" && added[0].payload.ref_id === "gh-2" && added[0].payload.ref_type === "github-pr" && added[0].payload.url === "https://example.com/2",
      JSON.stringify(added),
    );
    const removed = diffNodeUpdate({ ...baseNode, metadata: { refs: [refA, refB] } }, { metadata: { refs: [refA] } });
    check(
      "ref lost → ref.removed with ref_id",
      removed.length === 1 && removed[0].type === "ref.removed" && removed[0].payload.ref_id === "gh-2",
      JSON.stringify(removed),
    );
  }

  // --- the full app-authored (snapshot, journal) passes the cross-check -----
  {
    const iso = "2026-01-01T00:00:00.000Z";
    const nHome = { id: "V-home", project_id: PROJECT_ID, species: "view", title: "Home", status: "live", platforms: ["web"] };
    const nSet = { id: "V-settings", project_id: PROJECT_ID, species: "view", title: "Settings", status: "development", platforms: ["web"] };
    const edge = { id: "e-V-home-V-settings", project_id: PROJECT_ID, source_id: "V-home", target_id: "V-settings", edge_type: "composes" };

    // Replay emission in creation order, exactly as the provider would.
    const journal = [
      ...toJournalEvents([nodeCreatedInput({ ...nHome, status: "idea" })]),
      ...toJournalEvents([nodeCreatedInput({ ...nSet, status: "idea" })]),
      ...toJournalEvents([edgeAddedInput(edge)]),
      ...toJournalEvents(diffNodeUpdate({ ...nHome, status: "idea" }, { status: "live" })),
      ...toJournalEvents(diffNodeUpdate({ ...nSet, status: "idea" }, { status: "development" })),
    ];

    const bundle = {
      project: { id: PROJECT_ID, title: "P", created_at: iso, updated_at: iso, archived_at: null },
      nodes: [nHome, nSet],
      edges: [edge],
      journal,
    };

    const crossFindings = crossCheckJournal(bundle);
    check("app-emitted journal passes crossCheckJournal", crossFindings.length === 0, JSON.stringify(crossFindings));
    const { valid, errors } = validateBundle(bundle);
    check("app-authored bundle passes validateBundle", valid, JSON.stringify(errors));
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} emit-events test(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll emit-events tests passed.`);
}

main();
