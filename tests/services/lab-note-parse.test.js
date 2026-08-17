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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
