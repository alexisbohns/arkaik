#!/usr/bin/env node

/**
 * The Lab Note wire contract, arkaik side (lib/services/github/lab-note-parse.ts).
 *
 * A TS port of ariko's scripts/lab-note/lib.mjs extraction + validation: the
 * behaviors asserted here are the REFERENCE behaviors (first fence wins, no
 * section → null, en.title/en.summary required, unquoted-colon hint), so a
 * divergence between the two parsers shows up as a failure here, not as a
 * note that posts in one pipeline and refuses in the other.
 */

const { loadLabNoteParse, BUILD_DIR } = require("./load-lab-note-parse");
const fs = require("fs");

const { extractLabNoteYaml, parseLabNote } = loadLabNoteParse();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

function body(...sectionLines) {
  return ["Some PR description.", "", "## Lab Note", "", ...sectionLines].join("\n");
}

const FULL = body(
  "```yaml",
  "en:",
  '  title: "Heads up: it moved"',
  '  summary: "The button lives in the toolbar now."',
  "fr:",
  '  title: "Attention : ça a bougé"',
  "  summary: \"Le bouton vit dans la barre d'outils.\"",
  "suggested:",
  "  molecule: pbbls",
  "  type: improvement",
  "  tags: [changelog]",
  "```",
  "",
  "## Another section",
  "more text",
);

// --- extraction ------------------------------------------------------------
check("no section → null", extractLabNoteYaml("just a PR body") === null);
check("empty body → null", extractLabNoteYaml("") === null);
check("section without a fence → null", extractLabNoteYaml(body("no fence here")) === null);
check("heading prefix matches (## Lab Notes …)", extractLabNoteYaml(["## Lab Notes and details", "```yaml", "en:", '  title: "T"', '  summary: "S"', "```"].join("\n")) !== null);

const extracted = extractLabNoteYaml(FULL);
check("extracts the fence body", typeof extracted === "string" && extracted.includes("Heads up"));
check("section ends at the next ## heading", !extracted.includes("Another section"));

const TWO_FENCES = body("```yaml", "en:", '  title: "First"', '  summary: "S1"', "```", "", "```yaml", "en:", '  title: "Second"', '  summary: "S2"', "```");
const firstWins = extractLabNoteYaml(TWO_FENCES);
check("first fence wins, extras ignored", firstWins.includes("First") && !firstWins.includes("Second"));

// --- parsing ---------------------------------------------------------------
const full = parseLabNote(extracted);
check("full note parses", full.ok, full.ok ? "" : full.error);
check("quoted colons survive", full.ok && full.note.en.title === "Heads up: it moved");
check("fr adaptation kept", full.ok && full.note.fr.title === "Attention : ça a bougé" && full.note.fr.summary === "Le bouton vit dans la barre d'outils.");
check("suggested normalized", full.ok && full.note.suggested.molecule === "pbbls" && full.note.suggested.type === "improvement" && full.note.suggested.tags.join(",") === "changelog");

const noTitle = parseLabNote(["en:", '  summary: "S"'].join("\n"));
check("missing en.title refused by name", !noTitle.ok && noTitle.error === "en.title is required", noTitle.error);
const noSummary = parseLabNote(["en:", '  title: "T"'].join("\n"));
check("missing en.summary refused by name", !noSummary.ok && noSummary.error === "en.summary is required", noSummary.error);

const enOnly = parseLabNote(["en:", '  title: "T"', '  summary: "S"'].join("\n"));
check("fr omitted when absent", enOnly.ok && enOnly.note.fr === undefined, JSON.stringify(enOnly));
check("suggested omitted when absent", enOnly.ok && enOnly.note.suggested === undefined);

const unknownKeys = parseLabNote(["en:", '  title: "T"', '  summary: "S"', "future_key: whatever"].join("\n"));
check("unknown top-level keys ignored", unknownKeys.ok && unknownKeys.note.future_key === undefined);

const unquoted = parseLabNote(["en:", "  title: Heads up: it moved", '  summary: "S"'].join("\n"));
check("unquoted colon fails with the quoting hint", !unquoted.ok && unquoted.error.includes('wrapped in "quotes"'), unquoted.ok ? "parsed" : unquoted.error);

const notMapping = parseLabNote("- just\n- a list");
check("non-mapping refused", !notMapping.ok && notMapping.error.includes("mapping"));

// --- nodes: what the change touched, in the author's own words -------------
//
// The mention grammar only ever names acceptances, so a deliverable built from
// mentions alone can never list the views, flows, endpoints and models a
// replayed history lists. This is the key that lets an author say so. It is
// arkaik-specific and therefore an UNKNOWN top-level key everywhere else, which
// the shared contract already ignores — no other pipeline has to learn it.
const nodes = parseLabNote(
  ["en:", '  title: "T"', '  summary: "S"', "nodes: [V-record-photo, F-record-flow]"].join("\n"),
);
check(
  "a nodes list is read as written",
  nodes.ok && JSON.stringify(nodes.note.nodes) === '["V-record-photo","F-record-flow"]',
  JSON.stringify(nodes),
);
check("nodes omitted when absent", enOnly.ok && enOnly.note.nodes === undefined, JSON.stringify(enOnly));

const nodesBlock = parseLabNote(
  ["en:", '  title: "T"', '  summary: "S"', "nodes:", "  - V-a", "  -  V-b  "].join("\n"),
);
check(
  "the block form is the same list, trimmed",
  nodesBlock.ok && JSON.stringify(nodesBlock.note.nodes) === '["V-a","V-b"]',
  JSON.stringify(nodesBlock),
);

const nodesDupes = parseLabNote(
  ["en:", '  title: "T"', '  summary: "S"', "nodes: [V-a, V-b, V-a]"].join("\n"),
);
check(
  "a repeated id is listed once, in first-written order",
  nodesDupes.ok && JSON.stringify(nodesDupes.note.nodes) === '["V-a","V-b"]',
  JSON.stringify(nodesDupes),
);

// A malformed OPTIONAL key must never cost the note. The whole entry would be
// lost — the changelog line, both languages, the federation envelope — over a
// field whose entire job is to add detail to it.
const nodesJunk = parseLabNote(
  ["en:", '  title: "T"', '  summary: "S"', "nodes: V-not-a-list"].join("\n"),
);
check(
  "a nodes value that is not a list is dropped, and the note still parses",
  nodesJunk.ok && nodesJunk.note.nodes === undefined,
  JSON.stringify(nodesJunk),
);
const nodesMixed = parseLabNote(
  ["en:", '  title: "T"', '  summary: "S"', "nodes: [V-a, 42, \"\"]"].join("\n"),
);
check(
  "unusable entries are dropped one by one rather than taking the usable ones with them",
  nodesMixed.ok && JSON.stringify(nodesMixed.note.nodes) === '["V-a"]',
  JSON.stringify(nodesMixed),
);
const nodesEmpty = parseLabNote(["en:", '  title: "T"', '  summary: "S"', "nodes: []"].join("\n"));
check(
  "an empty list is omitted rather than stored as one more shape for nothing",
  nodesEmpty.ok && nodesEmpty.note.nodes === undefined,
  JSON.stringify(nodesEmpty),
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
