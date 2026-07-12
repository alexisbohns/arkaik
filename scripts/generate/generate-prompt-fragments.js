#!/usr/bin/env node

/**
 * Generates lib/prompts/generated/schema.ts: the enum ID lists and the
 * SCHEMA_BLOCK prompt fragment, both derived from @arkaik/schema, replacing
 * the hand-maintained copies that used to live in lib/prompts/blocks.ts
 * (docs/spec/toolchain.md § @arkaik/schema).
 */

const fs = require("fs");
const path = require("path");
const { loadSchemaPackage, cleanup } = require("./load-schema-package");
const { buildTypesBlock } = require("./build-types-block");

const ROOT = path.join(__dirname, "..", "..");
const OUT_FILE = path.join(ROOT, "lib", "prompts", "generated", "schema.ts");

const HEADER = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Built from packages/schema/src via \`npm run generate\`
// (docs/spec/toolchain.md § @arkaik/schema).
`;

function idArrayLiteral(name, ids) {
  return `export const ${name} = [${ids.map((v) => JSON.stringify(v)).join(", ")}] as const;`;
}

function generate() {
  const schemaPackage = loadSchemaPackage();
  const { SPECIES_IDS, STATUS_IDS, PLATFORM_IDS, EDGE_TYPE_IDS, SPECIES_PREFIXES } = schemaPackage;
  const typesBlock = buildTypesBlock(schemaPackage);
  cleanup();

  const speciesPrefixEntries = SPECIES_IDS.map((id) => {
    return `  ${JSON.stringify(id)}: ${JSON.stringify(SPECIES_PREFIXES[id])},`;
  }).join("\n");

  const content = `${HEADER}
${idArrayLiteral("SPECIES_IDS", SPECIES_IDS)}
${idArrayLiteral("STATUS_IDS", STATUS_IDS)}
${idArrayLiteral("PLATFORM_IDS", PLATFORM_IDS)}
${idArrayLiteral("EDGE_TYPE_IDS", EDGE_TYPE_IDS)}

export const SPECIES_PREFIXES: Record<(typeof SPECIES_IDS)[number], string> = {
${speciesPrefixEntries}
};

export const SCHEMA_BLOCK = \`## TypeScript Types (ProjectBundle Schema)

\\\`\\\`\\\`typescript
${typesBlock}
\\\`\\\`\\\`\`;
`;

  fs.writeFileSync(OUT_FILE, content);
  console.log(`generated ${path.relative(ROOT, OUT_FILE)}`);
}

generate();
