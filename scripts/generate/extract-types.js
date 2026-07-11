/**
 * Extracts the verbatim source text of exported `interface`/`type` declarations
 * from a @arkaik/schema source file, by name. Used to build the TypeScript type
 * listings embedded in the skill's schema reference and the prompt generator's
 * schema block — both are textual views of the same canonical zod source, not
 * a second definition of it.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const SCHEMA_SRC = path.join(__dirname, "..", "..", "packages", "schema", "src");

function extractDeclarations(fileName, names) {
  const sourceText = fs.readFileSync(path.join(SCHEMA_SRC, fileName), "utf8");
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const found = new Map();

  for (const node of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) continue;
    const name = node.name.text;
    if (!names.includes(name)) continue;
    found.set(name, node.getText(sourceFile).replace(/^export\s+/, ""));
  }

  const missing = names.filter((n) => !found.has(n));
  if (missing.length > 0) {
    throw new Error(`extract-types: could not find ${missing.join(", ")} in ${fileName}`);
  }
  return names.map((n) => found.get(n));
}

module.exports = { extractDeclarations };
