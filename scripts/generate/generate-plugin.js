#!/usr/bin/env node

/**
 * Packages the same generated skill assets docs/arkaik-skill/ produces as a
 * Claude Code plugin — the second distribution channel alongside `arkaik
 * init` (docs/spec/toolchain.md § Skill Distribution "second channel",
 * issue #224). Copies docs/arkaik-skill/{skill.md,references/schema.md,
 * scripts/validate-bundle.js} byte-for-byte into
 * plugin/skills/arkaik/{SKILL.md,references/schema.md,scripts/validate-bundle.js}
 * so there is a single source of truth: the skill ships *unrendered* (see
 * plugin/README.md for why). Must run after generate-schema-doc.js and
 * build-validator.js so it copies their freshly regenerated output, not
 * stale content.
 *
 * Also (re)writes the plugin manifest (plugin.json) in full, stamping its
 * `version` from the skill frontmatter's `version` field so the plugin and
 * skill versions can never drift.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SKILL_SRC_DIR = path.join(ROOT, "docs", "arkaik-skill");
const PLUGIN_DIR = path.join(ROOT, "plugin");
const SKILL_DEST_DIR = path.join(PLUGIN_DIR, "skills", "arkaik");
const MANIFEST_FILE = path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json");

/** Extract the `version:` value from a skill file's YAML frontmatter. */
function extractVersion(skillContent) {
  const frontmatterMatch = skillContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : skillContent;
  const versionMatch = frontmatter.match(/^version:\s*(\S+)\s*$/m);
  if (!versionMatch) {
    throw new Error(`generate-plugin: no "version" field found in ${path.join(SKILL_SRC_DIR, "skill.md")} frontmatter`);
  }
  return versionMatch[1];
}

/** Byte-identical copies — no rendering. Per-project templating stays the `arkaik init` channel's job. */
function copySkillAssets() {
  fs.mkdirSync(path.join(SKILL_DEST_DIR, "references"), { recursive: true });
  fs.mkdirSync(path.join(SKILL_DEST_DIR, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(SKILL_SRC_DIR, "skill.md"), path.join(SKILL_DEST_DIR, "SKILL.md"));
  fs.copyFileSync(path.join(SKILL_SRC_DIR, "references", "schema.md"), path.join(SKILL_DEST_DIR, "references", "schema.md"));
  fs.copyFileSync(path.join(SKILL_SRC_DIR, "scripts", "validate-bundle.js"), path.join(SKILL_DEST_DIR, "scripts", "validate-bundle.js"));
  fs.chmodSync(path.join(SKILL_DEST_DIR, "scripts", "validate-bundle.js"), 0o755);
}

/** Regenerate plugin.json in full so its `version` can never drift from the skill's. */
function writeManifest(version) {
  const manifest = {
    name: "arkaik",
    displayName: "Arkaik",
    version,
    description:
      "Agent skill that maintains the Arkaik product graph map (ProjectBundle JSON) — surgical node/edge patches paired with dual-write journal events, gated by the bundled validator. Ships unrendered; see the plugin README for the per-project path defaults.",
    author: { name: "Arkaik" },
    homepage: "https://arkaik.app",
    repository: "https://github.com/alexisbohns/arkaik",
    license: "MIT",
    keywords: ["arkaik", "product-map", "architecture", "journal"],
  };
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");
}

function generate() {
  const skillContent = fs.readFileSync(path.join(SKILL_SRC_DIR, "skill.md"), "utf8");
  const version = extractVersion(skillContent);
  copySkillAssets();
  writeManifest(version);
  console.log(`generated plugin v${version} -> ${path.relative(ROOT, PLUGIN_DIR)}`);
}

generate();
