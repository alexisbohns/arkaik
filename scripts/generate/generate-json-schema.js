#!/usr/bin/env node

/**
 * Generates public/schema/project-bundle.json from @arkaik/schema's zod
 * definitions via zod's native JSON Schema output (docs/spec/toolchain.md
 * § @arkaik/schema). The bundle root and Project definitions get
 * unknown-field tolerance per docs/spec/bundle-format.md's Schema Versioning
 * section: v1 declared `additionalProperties: false` on both, which makes
 * every bundle carrying schema_version/journal/project.version
 * non-conformant by construction; v2 relaxes that.
 */

const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const { loadSchemaPackage, cleanup } = require("./load-schema-package");

const ROOT = path.join(__dirname, "..", "..");
const OUT_FILE = path.join(ROOT, "public", "schema", "project-bundle.json");
const SCHEMA_ID = "https://arkaik.app/schema/project-bundle.json";
const SCHEMA_VERSION = 2;

const KEY_ORDER = [
  "$schema",
  "$id",
  "version",
  "title",
  "description",
  "type",
  "required",
  "additionalProperties",
  "properties",
  "$defs",
];

function reorder(obj, order) {
  const out = {};
  for (const key of order) {
    if (key in obj) out[key] = obj[key];
  }
  for (const key of Object.keys(obj)) {
    if (!(key in out)) out[key] = obj[key];
  }
  return out;
}

function generate() {
  const { ProjectBundleSchema } = loadSchemaPackage();
  const schema = z.toJSONSchema(ProjectBundleSchema);

  schema.$id = SCHEMA_ID;
  schema.version = SCHEMA_VERSION;

  if (schema.additionalProperties === false) {
    schema.additionalProperties = true;
  }
  const projectDef = schema.$defs && schema.$defs.Project;
  if (projectDef && projectDef.additionalProperties === false) {
    projectDef.additionalProperties = true;
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(reorder(schema, KEY_ORDER), null, 2) + "\n");
  cleanup();
  console.log(`generated ${path.relative(ROOT, OUT_FILE)}`);
}

generate();
