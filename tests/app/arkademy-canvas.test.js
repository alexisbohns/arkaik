#!/usr/bin/env node

/**
 * Your own canvas's pure side (lib/arkademy/): the inspirations, the draft's
 * reducer, browser storage's parse and serialise, and the three exports.
 * DB-free, so it runs in CI's `build` job.
 *
 * Cases that the fictional fixture (tests/fixtures/arkademy/document.json)
 * does not hold are built in memory; the fixture itself is never edited.
 */

const fs = require("fs");
const path = require("path");
const { loadArkademy, cleanup } = require("./load-arkademy");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");

const A = loadArkademy();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}
function same(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

const document = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const validation = A.validateArkademyDocument(document, { now: new Date("2026-11-12T00:00:00Z") });
check("the fixture validates", validation.ok, JSON.stringify(validation.errors));
const tool = document.tools[0];
const index = A.indexArkademy(validation.document);

// --- inspirations -------------------------------------------------------------------
{
  const { inspirationCatalog, availableInspirations, answerFromLabel, companiesLine, INSPIRATIONS_SHOWN } = A;
  const catalog = inspirationCatalog(index);
  same("catalog: one list per question, canonical order", Object.keys(catalog), A.BMC_QUESTION_KEYS);
  same(
    "catalog: channels, most shared first, the unused stall absent",
    catalog.ch.map((item) => item.entity),
    ["word-of-mouth", "app-stores"],
  );
  same(
    "catalog: companies in example order, with their names",
    catalog.ch[0].companies,
    [
      { id: "crumb-and-co", name: "Crumb & Co" },
      { id: "tidewise", name: "Tidewise" },
      { id: "inkwell", name: "Inkwell" },
    ],
  );
  same("catalog: an entity's neutral label, never a company's wording", catalog.ch[1].label, "app stores");
  same(
    "catalog: a tie on companies sorts by label",
    catalog.ka.map((item) => item.label),
    [
      "baking overnight",
      "packing orders",
      "planning delivery rounds",
      "shipping small improvements",
      "sourcing flour",
      "taking orders",
      "updating the tables every season",
    ],
  );
  same("catalog: shared revenue first", catalog.rev.map((item) => item.entity), ["subscriptions"]);
  check("catalog: only entities of the question's kind", catalog.seg.every((item) => item.entity !== "word-of-mouth"));
  check(
    "catalog: an inspiration carries no note",
    Object.values(catalog).every((list) => list.every((item) => Object.keys(item).join() === "entity,label,companies")),
  );

  // Ties on label too sort by id; labels compare without case or accents.
  const tie = JSON.parse(JSON.stringify(validation.document));
  tie.entities.push({ id: "b-zz", kind: "partner", label: "Local millers" }, { id: "a-zz", kind: "partner", label: "local millers" });
  tie.uses.push(
    { tool: "business-model-canvas", company: "tidewise", question: "kp", entity: "b-zz", text: "the mill", order: 1 },
    { tool: "business-model-canvas", company: "inkwell", question: "kp", entity: "a-zz", text: "a mill", order: 1 },
  );
  same(
    "catalog: same count and same label (any case) fall back to the id",
    inspirationCatalog(A.indexArkademy(tie)).kp.map((item) => item.entity),
    ["cloud-host", "harbour-offices", "a-zz", "b-zz", "local-millers"],
  );

  same("show six before Show all", INSPIRATIONS_SHOWN, 6);

  const channels = catalog.ch;
  same(
    "available: drops an entity already added",
    availableInspirations(channels, [{ text: "telling friends", inspiration: { entity: "word-of-mouth" } }]).map((i) => i.entity),
    ["app-stores"],
  );
  same(
    "available: drops a label typed as an answer, any case",
    availableInspirations(channels, [{ text: "  App Stores " }]).map((i) => i.entity),
    ["word-of-mouth"],
  );
  same("available: nothing to drop", availableInspirations(channels, []).length, 2);

  same("answerFromLabel: sentence case lowered", answerFromLabel("A product map that stays true"), "a product map that stays true");
  same("answerFromLabel: a name with an inner capital kept", answerFromLabel("GitHub sponsors"), "GitHub sponsors");
  same("answerFromLabel: an acronym kept", answerFromLabel("AWS credits"), "AWS credits");
  same("answerFromLabel: already lower", answerFromLabel("word of mouth"), "word of mouth");
  same("answerFromLabel: one capital letter alone is lowered", answerFromLabel("X"), "x");
  same("answerFromLabel: accents", answerFromLabel("École partners"), "école partners");
  same("answerFromLabel: trimmed", answerFromLabel("  Hosting "), "hosting");

  same("companiesLine: one", companiesLine([{ name: "Crumb & Co" }]), "Crumb & Co");
  same("companiesLine: two", companiesLine([{ name: "A" }, { name: "B" }]), "A and B");
  same("companiesLine: three", companiesLine([{ name: "A" }, { name: "B" }, { name: "C" }]), "A, B and C");
  same(
    "companiesLine: four or more",
    companiesLine([{ name: "Notion" }, { name: "Figma" }, { name: "C" }, { name: "D" }]),
    "Notion, Figma and 2 more",
  );
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-canvas test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-canvas tests passed.");
