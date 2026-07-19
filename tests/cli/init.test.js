#!/usr/bin/env node

/**
 * Exercises `arkaik init` (issue #220) by spawning the built CLI
 * (packages/cli/dist/index.js) with `cwd` pointed at a fresh `fs.mkdtemp`
 * directory under `os.tmpdir()` — never the arkaik repo itself, so a bug here
 * can't scaffold stray files into this working tree.
 *
 * Covers:
 *  - a plain `init` scaffolds docs/arkaik/{bundle.json,journal.jsonl,assets/},
 *    a canonical + validateBundle()-valid bundle, and the .gitattributes
 *    union-merge line;
 *  - re-running `init` is idempotent: no duplicated .gitattributes line, and
 *    the bundle is left byte-identical (not regenerated with a fresh
 *    timestamp);
 *  - the skill installs as `SKILL.md` (rendered, no `{{...}}` left, product
 *    name substituted) alongside its generated `references/schema.md` and
 *    `scripts/validate-bundle.js`;
 *  - `--update` upgrades an older-stamped SKILL.md and is a no-op when the
 *    packaged version is already current, without touching bundle/journal.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

const { serializeBundle, validateBundle } = require("../schema/load-schema").loadSchema();

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

let failures = 0;
let passes = 0;

function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}`);
    if (detail) console.log(detail);
  }
}

const dir = mkdtempSync(path.join(tmpdir(), "arkaik-init-"));

const BUNDLE_REL = path.join("docs", "arkaik", "bundle.json");
const JOURNAL_REL = path.join("docs", "arkaik", "journal.jsonl");
const ASSETS_DIR_REL = path.join("docs", "arkaik", "assets");
const SKILL_DIR_REL = path.join(".claude", "skills", "arkaik");

const bundlePath = path.join(dir, BUNDLE_REL);
const journalPath = path.join(dir, JOURNAL_REL);
const assetsDirPath = path.join(dir, ASSETS_DIR_REL);
const gitAttributesPath = path.join(dir, ".gitattributes");
const skillPath = path.join(dir, SKILL_DIR_REL, "SKILL.md");
const schemaRefPath = path.join(dir, SKILL_DIR_REL, "references", "schema.md");
const validatorScriptPath = path.join(dir, SKILL_DIR_REL, "scripts", "validate-bundle.js");

// ---------------------------------------------------------------------------
// Plain `init` scaffolds everything.
// ---------------------------------------------------------------------------
{
  const result = runCli(["init", "--product", "Widget Co"], dir);
  check("init exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);

  check("bundle.json created", existsSync(bundlePath));
  check("journal.jsonl created", existsSync(journalPath));
  check("assets/ dir created", existsSync(assetsDirPath));
  check(".gitattributes created", existsSync(gitAttributesPath));
  check("SKILL.md installed", existsSync(skillPath));
  check("references/schema.md installed", existsSync(schemaRefPath));
  check("scripts/validate-bundle.js installed", existsSync(validatorScriptPath));

  const journalContent = readFileSync(journalPath, "utf8");
  check("journal.jsonl is empty", journalContent === "");

  const bundleContent = readFileSync(bundlePath, "utf8");
  const parsed = JSON.parse(bundleContent);
  check(
    "bundle.json is canonical (matches serializeBundle)",
    serializeBundle(parsed) === bundleContent,
    `got:\n${bundleContent}`,
  );
  const validation = validateBundle(parsed);
  check("bundle.json passes validateBundle", validation.valid, JSON.stringify(validation.errors));
  check("bundle.json title is the product name", parsed.project.title === "Widget Co");
  check("bundle.json id is kebab-cased from the product name", parsed.project.id === "widget-co");
  check("bundle.json schema_version is 1", parsed.schema_version === 1);
  check("bundle.json has no nodes/edges", parsed.nodes.length === 0 && parsed.edges.length === 0);

  const gitAttributes = readFileSync(gitAttributesPath, "utf8");
  const expectedLine = `${JOURNAL_REL.split(path.sep).join("/")} merge=union`;
  check(
    ".gitattributes has the union-merge line",
    gitAttributes.split(/\r?\n/).includes(expectedLine),
    `got:\n${gitAttributes}`,
  );

  const skill = readFileSync(skillPath, "utf8");
  check("SKILL.md has no leftover {{...}} placeholders", !/\{\{[A-Z_]+\}\}/.test(skill));
  check("SKILL.md substitutes the product name", skill.includes("Widget Co"));
  check("SKILL.md substitutes the bundle path", skill.includes("docs/arkaik/bundle.json"));
  check("SKILL.md substitutes the journal path", skill.includes("docs/arkaik/journal.jsonl"));
  check("SKILL.md frontmatter carries a version stamp", /^version:\s*\d+\.\d+\.\d+/m.test(skill));

  const valuesRefPath = path.join(dir, SKILL_DIR_REL, "references", "values.md");
  check("references/values.md installed", existsSync(valuesRefPath));
  check("SKILL.md contains the Acceptances section", skill.includes("## Acceptances — the parity layer"));
  check("SKILL.md contains the Value mapping section", skill.includes("### Value mapping"));
  check("SKILL.md frontmatter version is 3.0.0", /^version:\s*3\.0\.0/m.test(skill));
  check(
    "SKILL.md example renders the kebab-case PROJECT_ID (not the display name)",
    skill.includes('"project_id": "widget-co"'),
    skill,
  );
}

// ---------------------------------------------------------------------------
// `init --no-values` renders the skill without the value-mapping guidance and
// skips references/values.md, in an otherwise-fresh tmpdir.
// ---------------------------------------------------------------------------
{
  const noValuesDir = mkdtempSync(path.join(tmpdir(), "arkaik-init-no-values-"));
  const result = runCli(["init", "--product", "Widget Co", "--no-values"], noValuesDir);
  check("init --no-values exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);

  const noValuesSkillPath = path.join(noValuesDir, SKILL_DIR_REL, "SKILL.md");
  const noValuesValuesRefPath = path.join(noValuesDir, SKILL_DIR_REL, "references", "values.md");
  check("SKILL.md installed under --no-values", existsSync(noValuesSkillPath));

  const noValuesSkill = readFileSync(noValuesSkillPath, "utf8");
  check("--no-values SKILL.md does not contain Value mapping section", !noValuesSkill.includes("### Value mapping"));
  check("--no-values SKILL.md does not contain the values markers", !noValuesSkill.includes("<!-- values:start -->"));
  check("--no-values does not install references/values.md", !existsSync(noValuesValuesRefPath));

  // Regression guard against an over-greedy strip regex swallowing adjacent
  // sections instead of just the marker-delimited block.
  check(
    "--no-values SKILL.md still contains the Acceptances section",
    noValuesSkill.includes("## Acceptances — the parity layer"),
    noValuesSkill,
  );
  check(
    "--no-values SKILL.md still contains the Full Schema Reference section",
    noValuesSkill.includes("## Full Schema Reference"),
    noValuesSkill,
  );
  check(
    "--no-values SKILL.md has no double-blank-line artifact from the strip",
    !/\n\n\n/.test(noValuesSkill),
    JSON.stringify(noValuesSkill.slice(noValuesSkill.indexOf("in the journal.") - 20, noValuesSkill.indexOf("in the journal.") + 80)),
  );

  rmSync(noValuesDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Re-running plain `init` is idempotent: no duplicate .gitattributes line,
// bundle/journal/skill left untouched (bundle would carry a fresh timestamp
// if it were regenerated, so byte-identity is a meaningful check).
// ---------------------------------------------------------------------------
{
  const bundleBefore = readFileSync(bundlePath, "utf8");
  const gitAttributesBefore = readFileSync(gitAttributesPath, "utf8");
  const skillBefore = readFileSync(skillPath, "utf8");

  const result = runCli(["init", "--product", "Widget Co"], dir);
  check("second init exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);

  const bundleAfter = readFileSync(bundlePath, "utf8");
  const gitAttributesAfter = readFileSync(gitAttributesPath, "utf8");
  const skillAfter = readFileSync(skillPath, "utf8");

  check("re-run leaves bundle.json byte-identical", bundleAfter === bundleBefore);
  check("re-run leaves SKILL.md byte-identical (no --update)", skillAfter === skillBefore);

  const lineCount = gitAttributesAfter
    .split(/\r?\n/)
    .filter((l) => l === `${JOURNAL_REL.split(path.sep).join("/")} merge=union`).length;
  check("re-run does not duplicate the .gitattributes line", lineCount === 1, gitAttributesAfter);
  check(".gitattributes unchanged on re-run", gitAttributesAfter === gitAttributesBefore);
}

// ---------------------------------------------------------------------------
// `--update`: upgrades an older-stamped SKILL.md, is a no-op at the same
// version, and never touches the bundle or journal.
// ---------------------------------------------------------------------------
{
  const bundleBefore = readFileSync(bundlePath, "utf8");
  const journalBefore = readFileSync(journalPath, "utf8");

  const original = readFileSync(skillPath, "utf8");
  const currentVersionMatch = original.match(/^version:\s*(\S+)/m);
  const currentVersion = currentVersionMatch ? currentVersionMatch[1] : null;
  check("captured the packaged skill version", currentVersion !== null, original.slice(0, 200));

  // Simulate an older installed version.
  const downgraded = original.replace(/^version:\s*\S+/m, "version: 0.0.1");
  writeFileSync(skillPath, downgraded);

  const upgradeResult = runCli(["init", "--update", "--product", "Widget Co"], dir);
  check("update exits 0", upgradeResult.status === 0, `${upgradeResult.stdout}\n${upgradeResult.stderr}`);

  const upgraded = readFileSync(skillPath, "utf8");
  check(
    "--update re-renders the skill back to the packaged version",
    new RegExp(`^version:\\s*${currentVersion?.replace(/\./g, "\\.")}`, "m").test(upgraded),
    upgraded.slice(0, 200),
  );
  check("--update output mentions the upgrade", /Upgraded skill/i.test(upgradeResult.stdout), upgradeResult.stdout);

  // Same-version re-run is a no-op.
  const noopResult = runCli(["init", "--update", "--product", "Widget Co"], dir);
  check("no-op update exits 0", noopResult.status === 0);
  check(
    "no-op update prints an already-up-to-date message",
    /already up to date/i.test(noopResult.stdout),
    noopResult.stdout,
  );
  const afterNoop = readFileSync(skillPath, "utf8");
  check("no-op update leaves SKILL.md unchanged", afterNoop === upgraded);

  check("--update never touches bundle.json", readFileSync(bundlePath, "utf8") === bundleBefore);
  check("--update never touches journal.jsonl", readFileSync(journalPath, "utf8") === journalBefore);
}

// ---------------------------------------------------------------------------
// `--update --no-values` on a skill previously installed WITH values: a
// same-version run is a no-op (values.md untouched, per USAGE text); an
// actual version upgrade removes the now-lingering references/values.md,
// not just skips writing a fresh copy.
// ---------------------------------------------------------------------------
{
  const upgradeDir = mkdtempSync(path.join(tmpdir(), "arkaik-init-novalues-upgrade-"));
  const initResult = runCli(["init", "--product", "Widget Co"], upgradeDir);
  check("no-values-upgrade: initial init exits 0", initResult.status === 0, `${initResult.stdout}\n${initResult.stderr}`);

  const upgradeSkillPath = path.join(upgradeDir, SKILL_DIR_REL, "SKILL.md");
  const upgradeValuesRefPath = path.join(upgradeDir, SKILL_DIR_REL, "references", "values.md");
  check("no-values-upgrade: references/values.md present before the --no-values update", existsSync(upgradeValuesRefPath));

  // Same-version `--update --no-values` is documented as a no-op: it must not
  // touch an already-installed values.md.
  const noopResult = runCli(["init", "--update", "--no-values", "--product", "Widget Co"], upgradeDir);
  check("no-values-upgrade: same-version --update --no-values exits 0", noopResult.status === 0, `${noopResult.stdout}\n${noopResult.stderr}`);
  check(
    "no-values-upgrade: same-version --update --no-values prints the up-to-date message",
    /already up to date/i.test(noopResult.stdout),
    noopResult.stdout,
  );
  check(
    "no-values-upgrade: same-version --update --no-values leaves references/values.md in place",
    existsSync(upgradeValuesRefPath),
  );

  // Simulate an older installed version so `--update` actually re-renders.
  const beforeUpgrade = readFileSync(upgradeSkillPath, "utf8");
  writeFileSync(upgradeSkillPath, beforeUpgrade.replace(/^version:\s*\S+/m, "version: 0.0.1"));

  const upgradeResult = runCli(["init", "--update", "--no-values", "--product", "Widget Co"], upgradeDir);
  check(
    "no-values-upgrade: version-bumping --update --no-values exits 0",
    upgradeResult.status === 0,
    `${upgradeResult.stdout}\n${upgradeResult.stderr}`,
  );
  check(
    "no-values-upgrade: references/values.md removed once the skill actually re-renders",
    !existsSync(upgradeValuesRefPath),
  );
  const upgradedSkill = readFileSync(upgradeSkillPath, "utf8");
  check(
    "no-values-upgrade: re-rendered SKILL.md has no Value mapping section",
    !upgradedSkill.includes("### Value mapping"),
  );

  rmSync(upgradeDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// `--update` with no prior install falls back to a fresh install.
// ---------------------------------------------------------------------------
{
  const freshDir = mkdtempSync(path.join(tmpdir(), "arkaik-init-update-fresh-"));
  const result = runCli(["init", "--update", "--product", "Fresh Co"], freshDir);
  check("update with no prior install exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);
  check(
    "update with no prior install installs SKILL.md",
    existsSync(path.join(freshDir, SKILL_DIR_REL, "SKILL.md")),
  );
  check(
    "update with no prior install does NOT scaffold the bundle",
    !existsSync(path.join(freshDir, BUNDLE_REL)),
  );
  rmSync(freshDir, { recursive: true, force: true });
}

rmSync(dir, { recursive: true, force: true });

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);
