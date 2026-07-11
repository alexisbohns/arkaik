#!/usr/bin/env node

/**
 * Regenerates the "Types" code block in docs/arkaik-skill/references/schema.md
 * between the GENERATED:SCHEMA marker comments, leaving every hand-written
 * section around it untouched (docs/spec/toolchain.md § @arkaik/schema:
 * "Schema reference fragment injected into the skill's references/schema.md
 * | Replaces: Hand-typed interface listings").
 */

const fs = require("fs");
const path = require("path");
const { loadSchemaPackage, cleanup } = require("./load-schema-package");
const { buildTypesBlock } = require("./build-types-block");

const ROOT = path.join(__dirname, "..", "..");
const DOC_FILE = path.join(ROOT, "docs", "arkaik-skill", "references", "schema.md");

const START_MARKER = "<!-- GENERATED:SCHEMA:START -->";
const END_MARKER = "<!-- GENERATED:SCHEMA:END -->";

function generate() {
  const schemaPackage = loadSchemaPackage();
  const typesBlock = buildTypesBlock(schemaPackage);
  cleanup();

  const doc = fs.readFileSync(DOC_FILE, "utf8");
  const startIdx = doc.indexOf(START_MARKER);
  const endIdx = doc.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`generate-schema-doc: could not find ${START_MARKER} / ${END_MARKER} markers in ${DOC_FILE}`);
  }

  const before = doc.slice(0, startIdx + START_MARKER.length);
  const after = doc.slice(endIdx);
  const generatedSection = `\n\`\`\`typescript\n${typesBlock}\n\`\`\`\n`;

  fs.writeFileSync(DOC_FILE, before + generatedSection + after);
  console.log(`generated ${path.relative(ROOT, DOC_FILE)}`);
}

generate();
