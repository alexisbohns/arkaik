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
 *    packaged version is already current, without touching bundle/journal;
 *  - `--bootstrap` opt-in installs the one-time bootstrap skill (rendered
 *    SKILL.md + verbatim references) beside the arkaik skill, and
 *    `--remove-bootstrap` removes exactly that directory — remove-only,
 *    idempotent, and refusing to combine with `--bootstrap`.
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
  // Derived from the authored skill rather than pinned to a literal: the point
  // is that `init` installs the packaged version, not that the version is any
  // particular number. A literal here goes stale on every skill bump and fails
  // CI for a change that was deliberate.
  const authoredSkill = readFileSync(path.join(ROOT, "docs", "arkaik-skill", "skill.md"), "utf8");
  const authoredVersion = authoredSkill.match(/^version:\s*(\S+)/m)?.[1];
  check(
    `SKILL.md frontmatter version matches the authored skill (${authoredVersion})`,
    Boolean(authoredVersion) && new RegExp(`^version:\\s*${authoredVersion}$`, "m").test(skill),
    skill.slice(0, 200),
  );
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

// ---------------------------------------------------------------------------
// `--bootstrap` installs the one-time bootstrap skill on demand (never by
// default), renders it like the maintenance skill, upgrades version-gated
// under `--update`, and `--remove-bootstrap` removes it cleanly — and only it.
// ---------------------------------------------------------------------------
{
  const bootstrapDir = mkdtempSync(path.join(tmpdir(), "arkaik-init-bootstrap-"));
  try {
    const bootstrapSkillDir = path.join(bootstrapDir, ".claude", "skills", "arkaik-bootstrap");
    // Installed filename is SKILL.md (uppercase) — a lowercase existsSync
    // would pass on macOS's case-insensitive FS and fail on CI's Linux.
    const bootstrapSkillMdPath = path.join(bootstrapSkillDir, "SKILL.md");

    const plain = runCli(["init", "--product", "Demo"], bootstrapDir);
    check("bootstrap block: plain init exits 0", plain.status === 0, `${plain.stdout}\n${plain.stderr}`);
    check(
      "plain init does NOT install the bootstrap skill",
      !existsSync(bootstrapSkillDir),
      "bootstrap skill was installed without being asked for",
    );

    const withBootstrap = runCli(["init", "--product", "Demo", "--bootstrap"], bootstrapDir);
    check("init --bootstrap exits 0", withBootstrap.status === 0, `${withBootstrap.stdout}\n${withBootstrap.stderr}`);
    check("bootstrap SKILL.md installed", existsSync(bootstrapSkillMdPath), "SKILL.md missing");
    check(
      "bootstrap references/fragments.md installed",
      existsSync(path.join(bootstrapSkillDir, "references", "fragments.md")),
      "references/fragments.md missing",
    );
    check(
      "bootstrap references/waves.md installed",
      existsSync(path.join(bootstrapSkillDir, "references", "waves.md")),
      "references/waves.md missing",
    );

    // Guarded read: a missing install reports as FAILed checks below instead
    // of an ENOENT crash that would hide the rest of the suite.
    const bootstrapSkill = existsSync(bootstrapSkillMdPath) ? readFileSync(bootstrapSkillMdPath, "utf8") : "";
    check(
      "bootstrap SKILL.md is rendered (no leftover {{...}} placeholders)",
      bootstrapSkill !== "" && !/\{\{[A-Z_]+\}\}/.test(bootstrapSkill),
      bootstrapSkill.slice(0, 200),
    );
    check("bootstrap SKILL.md substitutes the product name", bootstrapSkill.includes("Demo"), bootstrapSkill.slice(0, 200));
    check(
      "bootstrap SKILL.md frontmatter carries a version stamp",
      /^version:\s*\d+\.\d+\.\d+/m.test(bootstrapSkill),
      bootstrapSkill.slice(0, 200),
    );
    // Derived from the authored skill rather than pinned to a literal, like
    // the maintenance-skill version check above.
    const authoredBootstrap = readFileSync(path.join(ROOT, "docs", "arkaik-bootstrap-skill", "skill.md"), "utf8");
    const authoredBootstrapVersion = authoredBootstrap.match(/^version:\s*(\S+)/m)?.[1];
    check(
      `bootstrap SKILL.md version matches the authored skill (${authoredBootstrapVersion})`,
      Boolean(authoredBootstrapVersion) &&
        new RegExp(`^version:\\s*${authoredBootstrapVersion.replace(/\./g, "\\.")}$`, "m").test(bootstrapSkill),
      bootstrapSkill.slice(0, 200),
    );

    // Re-running `--bootstrap` is install-if-absent, like the maintenance
    // skill under a plain init: the installed file is left byte-identical.
    const rerun = runCli(["init", "--product", "Demo", "--bootstrap"], bootstrapDir);
    check("re-run init --bootstrap exits 0", rerun.status === 0, `${rerun.stdout}\n${rerun.stderr}`);
    const afterRerun = existsSync(bootstrapSkillMdPath) ? readFileSync(bootstrapSkillMdPath, "utf8") : "";
    check(
      "re-run leaves bootstrap SKILL.md byte-identical",
      afterRerun !== "" && afterRerun === bootstrapSkill,
      rerun.stdout,
    );

    // `--update --bootstrap` mirrors the maintenance skill's version gate:
    // an older-stamped install is re-rendered to the packaged version.
    if (bootstrapSkill !== "") {
      writeFileSync(bootstrapSkillMdPath, bootstrapSkill.replace(/^version:\s*\S+/m, "version: 0.0.1"));
    }
    const updateResult = runCli(["init", "--update", "--bootstrap", "--product", "Demo"], bootstrapDir);
    check("init --update --bootstrap exits 0", updateResult.status === 0, `${updateResult.stdout}\n${updateResult.stderr}`);
    const upgradedBootstrap = existsSync(bootstrapSkillMdPath) ? readFileSync(bootstrapSkillMdPath, "utf8") : "";
    check(
      "--update --bootstrap re-renders the bootstrap skill to the packaged version",
      Boolean(authoredBootstrapVersion) &&
        new RegExp(`^version:\\s*${authoredBootstrapVersion.replace(/\./g, "\\.")}$`, "m").test(upgradedBootstrap),
      upgradedBootstrap.slice(0, 200),
    );

    // Removal: only the bootstrap dir goes; the maintenance skill survives.
    const removed = runCli(["init", "--remove-bootstrap"], bootstrapDir);
    check("init --remove-bootstrap exits 0", removed.status === 0, `${removed.stdout}\n${removed.stderr}`);
    check("--remove-bootstrap prints what it removed", /removed/i.test(removed.stdout), removed.stdout);
    check("bootstrap skill removed", !existsSync(bootstrapSkillDir), "skill dir still present");
    check(
      "the maintenance skill survives removal",
      existsSync(path.join(bootstrapDir, SKILL_DIR_REL, "SKILL.md")),
      "maintenance skill was collateral damage",
    );

    // A second removal on the now-clean dir is idempotent: exit 0 + a notice.
    const removedAgain = runCli(["init", "--remove-bootstrap"], bootstrapDir);
    check("second --remove-bootstrap exits 0", removedAgain.status === 0, `${removedAgain.stdout}\n${removedAgain.stderr}`);
    check(
      "second --remove-bootstrap prints a nothing-to-remove notice",
      /nothing to remove/i.test(removedAgain.stdout),
      removedAgain.stdout,
    );
  } finally {
    rmSync(bootstrapDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// A custom `--skills-dir` moves the bootstrap skill with it: it installs and
// is removed as a SIBLING of the given dir (x/arkaik-bootstrap for
// --skills-dir x/arkaik), never nested inside the arkaik skill.
// ---------------------------------------------------------------------------
{
  const customDir = mkdtempSync(path.join(tmpdir(), "arkaik-init-bootstrap-skillsdir-"));
  try {
    const customSkillsDir = path.join("custom", "skills", "arkaik");
    const customBootstrapDir = path.join(customDir, "custom", "skills", "arkaik-bootstrap");

    const installed = runCli(
      ["init", "--product", "Custom Co", "--skills-dir", customSkillsDir, "--bootstrap"],
      customDir,
    );
    check(
      "custom skills-dir: init --bootstrap exits 0",
      installed.status === 0,
      `${installed.stdout}\n${installed.stderr}`,
    );
    check(
      "custom skills-dir: bootstrap skill installs as a sibling of the skills dir",
      existsSync(path.join(customBootstrapDir, "SKILL.md")),
      "custom/skills/arkaik-bootstrap/SKILL.md missing",
    );

    const removed = runCli(["init", "--remove-bootstrap", "--skills-dir", customSkillsDir], customDir);
    check(
      "custom skills-dir: --remove-bootstrap exits 0",
      removed.status === 0,
      `${removed.stdout}\n${removed.stderr}`,
    );
    check("custom skills-dir: sibling bootstrap dir removed", !existsSync(customBootstrapDir), "skill dir still present");
    check(
      "custom skills-dir: the maintenance skill survives removal",
      existsSync(path.join(customDir, customSkillsDir, "SKILL.md")),
      "maintenance skill was collateral damage",
    );
  } finally {
    rmSync(customDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// `--remove-bootstrap` is remove-only: in a fresh directory it must not
// scaffold anything as a side effect of a removal.
// ---------------------------------------------------------------------------
{
  const removeOnlyDir = mkdtempSync(path.join(tmpdir(), "arkaik-init-remove-only-"));
  try {
    const result = runCli(["init", "--remove-bootstrap"], removeOnlyDir);
    check("--remove-bootstrap in a fresh dir exits 0", result.status === 0, `${result.stdout}\n${result.stderr}`);
    check(
      "--remove-bootstrap in a fresh dir does not scaffold the bundle",
      !existsSync(path.join(removeOnlyDir, BUNDLE_REL)),
      "removal scaffolded docs/arkaik/bundle.json",
    );
    check(
      "--remove-bootstrap in a fresh dir does not install the maintenance skill",
      !existsSync(path.join(removeOnlyDir, SKILL_DIR_REL, "SKILL.md")),
      "removal installed the maintenance skill",
    );
  } finally {
    rmSync(removeOnlyDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// `--bootstrap --remove-bootstrap` together is contradictory: refuse loudly,
// scaffold nothing.
// ---------------------------------------------------------------------------
{
  const conflictDir = mkdtempSync(path.join(tmpdir(), "arkaik-init-bootstrap-conflict-"));
  try {
    const result = runCli(["init", "--bootstrap", "--remove-bootstrap"], conflictDir);
    check(
      "--bootstrap with --remove-bootstrap exits non-zero",
      result.status !== 0,
      `${result.stdout}\n${result.stderr}`,
    );
    check(
      "--bootstrap with --remove-bootstrap explains the contradiction",
      /contradictory/i.test(result.stderr),
      result.stderr,
    );
    check(
      "conflicting flags scaffold nothing",
      !existsSync(path.join(conflictDir, BUNDLE_REL)),
      "conflicting flags still scaffolded the bundle",
    );
  } finally {
    rmSync(conflictDir, { recursive: true, force: true });
  }
}

rmSync(dir, { recursive: true, force: true });

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);
