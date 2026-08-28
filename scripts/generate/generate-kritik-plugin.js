#!/usr/bin/env node

/**
 * Packages the Kritik quality layer as a Claude Code plugin — the second
 * marketplace entry alongside `arkaik` (docs/rfcs/kritik.md § 5), assembled
 * from canonical sources exactly the way generate-plugin.js assembles the
 * first one:
 *
 *   docs/kritik-skill/skill.md            -> skills/kritik/SKILL.md
 *   packages/kritik-library/SPEC.md       -> skills/kritik/references/framework.md
 *   packages/kritik-library/framework.json-> skills/kritik/references/library.json
 *
 * Nothing under plugin-kritik/ is hand-edited. The scripts are built by
 * build-kritik-scripts.js (which must run before this), the three files above
 * are byte-for-byte copies, and plugin.json is rewritten in full with its
 * `version` stamped from the skill frontmatter so the two can never drift.
 * CI's drift gate diffs the whole directory.
 *
 * The pack is **embedded, not depended on**: `@arkaik/kritik-library` stays a
 * private workspace package, and the plugin ships a copy, because a repo that
 * installs this plugin has no node_modules to resolve a dependency through.
 * Same answer, same reason, as the schema reference in the arkaik plugin.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SKILL_SRC_DIR = path.join(ROOT, "docs", "kritik-skill");
const LIBRARY_SRC_DIR = path.join(ROOT, "packages", "kritik-library");
const PLUGIN_DIR = path.join(ROOT, "plugin-kritik");
const SKILL_DEST_DIR = path.join(PLUGIN_DIR, "skills", "kritik");
const MANIFEST_FILE = path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json");

/** Extract the `version:` value from a skill file's YAML frontmatter. */
function extractVersion(skillContent) {
  const frontmatterMatch = skillContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : skillContent;
  const versionMatch = frontmatter.match(/^version:\s*(\S+)\s*$/m);
  if (!versionMatch) {
    throw new Error(`generate-kritik-plugin: no "version" field found in ${path.join(SKILL_SRC_DIR, "skill.md")} frontmatter`);
  }
  return versionMatch[1];
}

/**
 * Byte-identical copies. The skill ships unrendered, like the arkaik one — it
 * has no template parameters to render: every path it names is a fixed default
 * (`docs/quality/…`) and everything project-specific lives in profile.json,
 * which is data the install writes, not a substitution.
 */
function copySkillAssets() {
  fs.mkdirSync(path.join(SKILL_DEST_DIR, "references"), { recursive: true });
  fs.copyFileSync(path.join(SKILL_SRC_DIR, "skill.md"), path.join(SKILL_DEST_DIR, "SKILL.md"));
  fs.copyFileSync(path.join(LIBRARY_SRC_DIR, "SPEC.md"), path.join(SKILL_DEST_DIR, "references", "framework.md"));
  fs.copyFileSync(
    path.join(LIBRARY_SRC_DIR, "framework.json"),
    path.join(SKILL_DEST_DIR, "references", "library.json"),
  );
}

/** Regenerate plugin.json in full so its `version` can never drift from the skill's. */
function writeManifest(version) {
  const manifest = {
    name: "kritik",
    displayName: "Kritik",
    version,
    description:
      "Agent skill that audits a product's quality with the Kritik framework — a maturity score per criterion per surface backed by evidence, findings carrying risk and remediation cost, and a comparative matrix whose anti-averaging caps stop one open Critical from being averaged into a B. Ships the 88-criterion pack; projects pick their surfaces and add criteria of their own.",
    author: { name: "Arkaik" },
    homepage: "https://arkaik.app",
    repository: "https://github.com/alexisbohns/arkaik",
    license: "MIT",
    keywords: ["arkaik", "kritik", "quality", "audit", "security", "accessibility"],
  };
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");
}

function generate() {
  const skillContent = fs.readFileSync(path.join(SKILL_SRC_DIR, "skill.md"), "utf8");
  const version = extractVersion(skillContent);
  copySkillAssets();
  writeManifest(version);
  console.log(`generated kritik plugin v${version} -> ${path.relative(ROOT, PLUGIN_DIR)}`);
}

generate();
