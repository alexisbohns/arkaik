/**
 * `arkaik init [--product <name>] [--bundle <path>] [--journal <path>]
 *              [--skills-dir <path>] [--update]`
 *
 * Scaffolds `docs/arkaik/` in the current working directory (the target
 * repo), configures `.gitattributes` for the journal's union merge
 * (docs/spec/journal.md § Storage Shapes), and installs the Arkaik agent
 * skill as a *render* (not a copy) into the repo's skills directory
 * (docs/spec/toolchain.md § Skill Distribution).
 *
 * The skill template (`skill.md`) and its two generated siblings
 * (`references/schema.md`, `scripts/validate-bundle.js`) live once at
 * `docs/arkaik-skill/` and are copied into `dist/assets/skill/` at CLI build
 * time (see build.js) — this module resolves them relative to its own
 * bundled location (`import.meta.url`) so the published CLI carries them
 * with no drift and nothing new committed to the repo.
 *
 * Idempotent and non-destructive by default: every scaffolded artifact
 * (bundle, journal, assets dir, skill) is created only if missing — a plain
 * re-run never clobbers local edits. `--update` is the one sanctioned way to
 * upgrade an already-installed skill (+ its generated assets), gated on the
 * `version` frontmatter stamp; it never touches the bundle or journal.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeBundle, validateBundle, type ProjectBundle } from "@arkaik/schema";

const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";
const DEFAULT_JOURNAL_PATH = "docs/arkaik/journal.jsonl";
const DEFAULT_SKILLS_DIR = ".claude/skills/arkaik";

// The skill template + generated siblings, copied next to this bundled file's
// own output location by build.js (dist/index.js -> dist/assets/skill/).
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets", "skill");

const USAGE = `arkaik init [--product <name>] [--bundle <path>] [--journal <path>] [--skills-dir <path>] [--update]

Scaffold docs/arkaik/ (bundle.json, journal.jsonl, assets/) in the current
directory, configure .gitattributes for the journal's union merge, and
install the Arkaik agent skill (rendered SKILL.md + its generated reference
and validator) into the repo's skills directory.

Safe to re-run: existing bundle/journal/skill files are left untouched unless
--update is given, which upgrades only the skill + its generated assets when
a newer version is packaged (never the bundle or journal).

Options:
  --product <name>      Product name rendered into the skill and used for the
                         scaffolded bundle's title (default: derived from the
                         current directory name).
  --bundle <path>       Path to the bundle snapshot (default: ${DEFAULT_BUNDLE_PATH}).
  --journal <path>      Path to the journal sidecar (default: ${DEFAULT_JOURNAL_PATH}).
  --skills-dir <path>   Directory to install the skill into (default: ${DEFAULT_SKILLS_DIR}).
  --update              Re-render the skill + its generated assets when the
                         packaged version is newer than what's installed;
                         no-op when already current. Never touches the
                         bundle or journal.
  --no-values           Render the skill without the value-mapping guidance
                        (and skip references/values.md).
  -h, --help             Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

interface InitOptions {
  product?: string;
  bundle?: string;
  journal?: string;
  skillsDir?: string;
  update: boolean;
  noValues: boolean;
}

function parseArgs(args: string[]): InitOptions {
  const opts: InitOptions = { update: false, noValues: false };

  const nextValue = (i: number, flag: string): string => {
    const value = args[i];
    if (value === undefined) fail(`Missing value for ${flag}\n\n${USAGE}`);
    return value;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--update") {
      opts.update = true;
    } else if (arg === "--no-values") {
      opts.noValues = true;
    } else if (arg === "--product") {
      opts.product = nextValue(++i, arg);
    } else if (arg === "--bundle") {
      opts.bundle = nextValue(++i, arg);
    } else if (arg === "--journal") {
      opts.journal = nextValue(++i, arg);
    } else if (arg === "--skills-dir") {
      opts.skillsDir = nextValue(++i, arg);
    } else {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    }
  }
  return opts;
}

/** Title-case the current directory name as a fallback product name. */
function defaultProductName(): string {
  const words = basename(process.cwd())
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (words.length === 0) return "Untitled Project";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Derive a kebab-case project id from a human-readable product name. */
function kebabCase(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/** Write `content` to `path` only if it doesn't already exist. */
function writeIfAbsent(path: string, content: string, label: string): void {
  if (existsSync(path)) {
    console.log(`Skipping ${label} (already exists): ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`Created ${path}`);
}

/** Scaffold a minimal, valid Level-1 bundle snapshot at `bundlePath`. */
function scaffoldBundle(bundlePath: string, productName: string): void {
  if (existsSync(bundlePath)) {
    console.log(`Skipping bundle (already exists): ${bundlePath}`);
    return;
  }
  const now = new Date().toISOString();
  const bundle: ProjectBundle = {
    schema_version: 1,
    project: {
      id: kebabCase(productName),
      title: productName,
      created_at: now,
      updated_at: now,
    },
    nodes: [],
    edges: [],
  };

  const result = validateBundle(bundle);
  if (!result.valid) {
    // Should be unreachable — a minimal bundle with no nodes/edges satisfies
    // every semantic rule. Fail loudly rather than write something broken.
    fail(`internal error: scaffolded bundle failed validation:\n${result.errors.map((e) => e.message).join("\n")}`);
  }

  mkdirSync(dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, serializeBundle(bundle));
  console.log(`Created ${bundlePath}`);
}

/** Idempotently add the journal's union-merge rule to .gitattributes. */
function ensureGitAttributes(journalRelPath: string): void {
  const line = `${journalRelPath} merge=union`;
  const gitAttributesPath = resolve(process.cwd(), ".gitattributes");

  if (!existsSync(gitAttributesPath)) {
    writeFileSync(gitAttributesPath, `${line}\n`);
    console.log(`Created .gitattributes with: ${line}`);
    return;
  }

  const content = readFileSync(gitAttributesPath, "utf8");
  if (content.split(/\r?\n/).includes(line)) {
    console.log(".gitattributes already has the journal union-merge rule.");
    return;
  }

  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  writeFileSync(gitAttributesPath, `${content}${separator}${line}\n`);
  console.log(`Added to .gitattributes: ${line}`);
}

/** Extract the `version:` value from a skill file's YAML frontmatter. */
function extractVersion(content: string): string | undefined {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : content;
  return frontmatter.match(/^version:\s*(\S+)\s*$/m)?.[1];
}

/** Compare two dot-separated version strings numerically, part by part. */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const partsB = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

/** Strip the value-mapping guidance block (marker-delimited in skill.md). */
function stripValuesSection(content: string): string {
  return content.replace(/<!-- values:start -->[\s\S]*?<!-- values:end -->\n?/g, "");
}

/** Render the packaged skill template + copy its generated siblings into `skillsDirPath`. */
function renderAndWriteSkill(skillsDirPath: string, vars: Record<string, string>, noValues: boolean): string {
  const rawSkill = readFileSync(join(ASSET_DIR, "skill.md"), "utf8");
  const template = noValues ? stripValuesSection(rawSkill) : rawSkill;

  mkdirSync(join(skillsDirPath, "references"), { recursive: true });
  mkdirSync(join(skillsDirPath, "scripts"), { recursive: true });

  writeFileSync(join(skillsDirPath, "SKILL.md"), renderTemplate(template, vars));
  copyFileSync(join(ASSET_DIR, "references", "schema.md"), join(skillsDirPath, "references", "schema.md"));
  if (!noValues) {
    copyFileSync(join(ASSET_DIR, "references", "values.md"), join(skillsDirPath, "references", "values.md"));
  }
  copyFileSync(join(ASSET_DIR, "scripts", "validate-bundle.js"), join(skillsDirPath, "scripts", "validate-bundle.js"));

  return extractVersion(rawSkill) ?? "unknown";
}

/** Plain `init`: install the skill only if it isn't there yet. */
function installSkill(skillsDirPath: string, vars: Record<string, string>, noValues: boolean): void {
  const skillPath = join(skillsDirPath, "SKILL.md");
  if (existsSync(skillPath)) {
    console.log(`Skipping skill install (already exists): ${skillPath}. Use \`arkaik init --update\` to upgrade.`);
    return;
  }
  const version = renderAndWriteSkill(skillsDirPath, vars, noValues);
  console.log(`Installed skill v${version} -> ${skillPath}`);
}

/** `--update`: upgrade the skill + generated assets only if the packaged version is newer. */
function updateSkill(skillsDirPath: string, vars: Record<string, string>, noValues: boolean): void {
  const packagedVersion = extractVersion(readFileSync(join(ASSET_DIR, "skill.md"), "utf8"));
  const skillPath = join(skillsDirPath, "SKILL.md");

  if (!existsSync(skillPath)) {
    const version = renderAndWriteSkill(skillsDirPath, vars, noValues);
    console.log(`No existing skill found at ${skillPath}; installed v${version}.`);
    return;
  }

  const installedVersion = extractVersion(readFileSync(skillPath, "utf8"));
  if (
    installedVersion !== undefined &&
    packagedVersion !== undefined &&
    compareVersions(packagedVersion, installedVersion) <= 0
  ) {
    console.log(`Skill already up to date (v${installedVersion}).`);
    return;
  }

  const version = renderAndWriteSkill(skillsDirPath, vars, noValues);
  console.log(`Upgraded skill v${installedVersion ?? "unknown"} -> v${version}.`);
}

export function runInit(args: string[]): void {
  const opts = parseArgs(args);
  const productName = opts.product ?? defaultProductName();
  const bundleRelPath = opts.bundle ?? DEFAULT_BUNDLE_PATH;
  const journalRelPath = opts.journal ?? DEFAULT_JOURNAL_PATH;
  const skillsDirRelPath = opts.skillsDir ?? DEFAULT_SKILLS_DIR;

  const cwd = process.cwd();
  const bundlePath = resolve(cwd, bundleRelPath);
  const journalPath = resolve(cwd, journalRelPath);
  const skillsDirPath = resolve(cwd, skillsDirRelPath);

  const vars = { PRODUCT_NAME: productName, BUNDLE_PATH: bundleRelPath, JOURNAL_PATH: journalRelPath };

  if (opts.update) {
    updateSkill(skillsDirPath, vars, opts.noValues);
    return;
  }

  scaffoldBundle(bundlePath, productName);
  writeIfAbsent(journalPath, "", "journal");
  writeIfAbsent(join(dirname(bundlePath), "assets", ".gitkeep"), "", "assets dir");
  ensureGitAttributes(journalRelPath);
  installSkill(skillsDirPath, vars, opts.noValues);
}
