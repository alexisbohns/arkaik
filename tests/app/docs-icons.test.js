#!/usr/bin/env node

/**
 * The docs sidebar's per-page glyphs (lib/config/docs-icons.ts + `icon:`
 * frontmatter).
 *
 * Two things worth pinning. The registry is an allowlist rather than a dynamic
 * `lucide-react` lookup, and an allowlist only helps if unknown names actually
 * fall back instead of rendering `undefined` as a component — a crash in the
 * sidebar, i.e. in every docs page at once.
 *
 * And the frontmatter side has no compiler behind it: `icon: telescop` is a
 * valid YAML string, so nothing but this suite notices that one page quietly
 * lost its icon. So the second half walks the real published docs and checks
 * every name they ask for is one the registry answers to.
 *
 * Loaded the bundler-free way (tests/app/load-panel-utils.js): transpile the
 * module, stub its one import at the module boundary. `lucide-react` is stubbed
 * because Node cannot require an ESM React component module here, and because
 * what the icons *look like* is not what this suite is about.
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const DOCS_DIR = path.join(ROOT, "docs");
const BUILD_DIR = path.join(__dirname, `.test-build-docs-icons-${process.pid}`);

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

/**
 * Every `*Icon` export resolves to a marker carrying its own name, so a mapping
 * that points at the wrong glyph is still visible in a failure message.
 */
const lucideStub = new Proxy({}, {
  get: (_target, name) => (typeof name === "string" ? { __icon: name } : undefined),
  has: () => true,
});

function loadDocsIcons() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "config", "docs-icons.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "docs-icons.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const outPath = path.join(BUILD_DIR, "docs-icons.js");
  fs.writeFileSync(outPath, outputText);

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "lucide-react") return lucideStub;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[outPath];
    return require(outPath);
  } finally {
    Module._load = originalLoad;
  }
}

const { DOC_ICONS, DEFAULT_DOC_ICON, DEFAULT_DOC_SECTION_ICON, resolveDocIcon } = loadDocsIcons();

// --- the registry ---
const names = Object.keys(DOC_ICONS);
assert(names.length > 0, "the registry offers some glyphs to choose from");
assert(
  names.every((name) => Boolean(DOC_ICONS[name])),
  "every registered name resolves to a component",
);
assert(
  names.every((name) => name === name.toLowerCase()),
  "names are lower-case, because that is how resolution folds them",
);
assert(Boolean(DEFAULT_DOC_ICON) && Boolean(DEFAULT_DOC_SECTION_ICON), "both fallbacks exist");

// --- resolution ---
assert(resolveDocIcon("map", DEFAULT_DOC_ICON) === DOC_ICONS.map, "a registered name resolves to its glyph");
assert(resolveDocIcon(" Map ", DEFAULT_DOC_ICON) === DOC_ICONS.map, "resolution trims and folds case");
assert(
  resolveDocIcon(undefined, DEFAULT_DOC_ICON) === DEFAULT_DOC_ICON,
  "a page that names no icon falls back",
);
assert(
  resolveDocIcon("telescop", DEFAULT_DOC_ICON) === DEFAULT_DOC_ICON,
  "a typo costs the row its glyph, not the whole sidebar",
);
assert(
  resolveDocIcon("constructor", DEFAULT_DOC_ICON) === DEFAULT_DOC_ICON,
  "an inherited Object property is not a glyph",
);

// --- what the real docs ask for ---
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(next);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [next] : [];
  });
}

/** The `icon:` line of a file's leading frontmatter block, if it has one. */
function frontmatterIcon(markdown) {
  if (!markdown.startsWith("---\n")) return null;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return null;
  const match = markdown.slice(4, end + 1).match(/^icon:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

const unknown = [];
let iconed = 0;
for (const filePath of walk(DOCS_DIR)) {
  const icon = frontmatterIcon(fs.readFileSync(filePath, "utf8"));
  if (!icon) continue;
  iconed += 1;
  if (!Object.hasOwn(DOC_ICONS, icon)) unknown.push(`${path.relative(ROOT, filePath)} → ${icon}`);
}

assert(iconed > 0, `some docs name an icon (${iconed} do)`);
assert(
  unknown.length === 0,
  `every icon named in frontmatter is registered (unknown: ${unknown.join(", ") || "none"})`,
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} docs-icons check(s) failed`);
  process.exit(1);
}
console.log("\nAll docs-icons tests passed");
