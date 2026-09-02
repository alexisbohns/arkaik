/**
 * `arkaik pack [--no-journal] [--no-quality] [--inline-assets] [--audit <id>]
 *              [--root <dir>] [--out <path>] [path]`.
 *
 * Produces a SINGLE self-contained interchange bundle (docs/spec/journal.md §
 * Interchange: embedded journal[]; docs/spec/bundle-format.md § Asset Values):
 *  1. read the bundle at `path` plus its sibling `journal.jsonl` sidecar;
 *  2. journal embedding — by default the bundle's `journal[]` is set to
 *     `loadJournalEvents(bundle, path)`: the embedded journal when the source
 *     bundle already carries one, otherwise the sidecar (exactly the
 *     embedded-wins-else-sidecar precedence `arkaik validate` folds by, see
 *     lib/journal-io.ts). `--no-journal` strips `journal[]` instead — the
 *     Publik-safe posture (docs/spec/journal.md:41);
 *  3. quality folding — `docs/quality/` is the canonical home of a project's
 *     audit data exactly as `journal.jsonl` is for its history (docs/rfcs/
 *     kritik.md § 8.3), with `bundle.quality` as the interchange projection.
 *     So the sidecars belonging to the *packed bundle's own* repo root are
 *     merged into `quality`: assessments latest-wins per (criterion x
 *     surface) across every audit, findings pooled, the derived `severity`
 *     and `priority` dropped (`lib/kritik-io.ts`). A repo with no audits or
 *     no profile is reported and skipped, never failed — quality is additive
 *     to a bundle, and a half-installed Kritik must not break `pack`. The
 *     source `docs/quality/` tree is only ever READ. `--no-quality` DELETES
 *     `quality` instead, exactly as `--no-journal` deletes `journal[]`: a
 *     posture that only declined to fold would still ship a section the
 *     source bundle already carried, which is the case `arkaik push` exists
 *     to prevent. `--audit <id>` pins one audit's snapshot instead of the
 *     merge, and `--root <dir>` overrides the repo root the sidecars are
 *     looked for under (see `resolveQualityRoot` — the default follows the
 *     bundle, not the cwd);
 *  4. `--inline-assets` (OFF by default, local-only in v1): every
 *     `metadata.platformScreenshots` value that is a *relative path* (no URI
 *     scheme, no leading `/` — docs/spec/bundle-format.md § Asset Values) is
 *     read from disk (resolved against the bundle's directory) and rewritten
 *     to a `data:` URI, base64-encoded, with a best-effort mime type from the
 *     extension. Absolute `https://` URLs and existing `data:` URIs are left
 *     untouched. Uploading to a hosted bucket is OUT OF SCOPE for v1 — only
 *     local relative-path assets can be inlined;
 *  5. the (possibly mutated) bundle object — never reconstructed as
 *     `{project,nodes,edges}` — is written out via `serializeBundle`, so it
 *     lands in canonical form (top-level key order incl. `journal`) and every
 *     unknown top-level key / unknown field round-trips untouched (the
 *     `rewriteBundleProjectId` defect, docs/spec/bundle-format.md:40, this
 *     command must not repeat).
 *
 * Output goes to `--out <path>` when given, else to stdout (so `arkaik pack |
 * ...` composes); status/warning lines always go to stderr so stdout stays
 * pure bundle JSON in the no-`--out` case.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { serializeBundle } from "@arkaik/schema";
import { readBundle } from "../lib/bundle-io";
import { loadJournalEvents } from "../lib/journal-io";
import { foldQualitySection, resolveQualityRoot } from "../lib/kritik-io";

const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";

const USAGE = `arkaik pack [--no-journal] [--no-quality] [--inline-assets] [--audit <id>]
            [--root <dir>] [--out <path>] [path]

Produce a single self-contained interchange bundle: fold in the sidecar
journal (or keep an existing embedded one), fold docs/quality/ into the
quality section, and, with --inline-assets, inline local screenshot files as
data: URIs. Written canonically via serializeBundle. Unknown top-level keys
and unknown fields always round-trip.

Arguments:
  path              Path to the bundle JSON file (default: ${DEFAULT_BUNDLE_PATH}).

Options:
  --no-journal      Omit the embedded journal[] (Publik-safe posture — history
                     stays private unless explicitly included). Default: the
                     journal IS embedded (that is the point of a single-file
                     interchange) — embedded wins over the sidecar when the
                     bundle already carries one, otherwise the sidecar is used
                     (same precedence "arkaik validate" folds by).
  --no-quality      DELETE the quality section rather than folding one in —
                     not merely "skip the fold", because the source bundle may
                     already carry a section of its own and that one goes too.
                     For any bundle that must not travel with open findings:
                     a finding names an unfixed vulnerability and the file to
                     find it in. ("arkaik push" packs this way by default;
                     its --include-quality opts back in.)
                     Default: docs/quality/ IS folded in.
  --inline-assets   Convert relative-path metadata.platformScreenshots values
                     into data: URIs by reading the file from disk (resolved
                     against the bundle's directory). Absolute https:// URLs
                     and existing data: URIs are left as-is. v1 scope: local
                     files only — uploading a remote/hosted copy is not
                     implemented.
  --audit <id>      Pin ONE audit's snapshot instead of the default merge.
                     They answer different questions: the merge (every audit,
                     latest score per criterion x surface) answers "where does
                     the product stand", while a pinned audit answers "how did
                     that audit go" — the question its own matrix.json
                     answers. An id that is not on disk is an error, not an
                     empty section.
  --root <dir>      Where docs/quality/ lives. Default: NOT the current
                     directory — it is derived from the bundle's own path, so
                     packing <repo>/docs/arkaik/bundle.json folds <repo>'s
                     audits whatever directory you run from. Only a bundle
                     kept outside that conventional layout falls back to the
                     cwd, and that is the case this flag is for.
  --out <path>      Write the packed bundle here instead of stdout.
  -h, --help        Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
};

function mimeForExtension(ext: string): string {
  return MIME_BY_EXTENSION[ext.toLowerCase()] ?? "application/octet-stream";
}

/** No URI scheme and no leading `/` — docs/spec/bundle-format.md § Asset Values. */
const URI_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
function isRelativeAssetPath(value: string): boolean {
  return value.length > 0 && !URI_SCHEME_RE.test(value) && !value.startsWith("/");
}

export interface InlinedAsset {
  nodeId: string;
  platform: string;
  path: string;
}

export interface RunPackOptions {
  /** Path to the bundle JSON file (default: docs/arkaik/bundle.json), resolved against `cwd`. */
  path?: string;
  /** Write the packed bundle here instead of returning it for the caller to print. Resolved against `cwd`. */
  out?: string;
  /** Strip the embedded journal[] instead of embedding it. */
  noJournal?: boolean;
  /** Inline local relative-path screenshot assets as data: URIs. */
  inlineAssets?: boolean;
  /** Delete `quality` rather than folding docs/quality/ in — including a section the source bundle already carried. The Publik-safe posture, as `noJournal` is for history. */
  noQuality?: boolean;
  /** Pin one audit's snapshot instead of merging every audit into current state. */
  audit?: string;
  /** Repo root holding docs/quality/, resolved against `cwd`. Default: NOT `cwd` — {@link resolveQualityRoot} derives it from the bundle's own path, with `cwd` only as the fallback for a bundle outside `docs/arkaik/`. */
  root?: string;
  /** Base directory `path`/`out` resolve against (default: process.cwd()). */
  cwd?: string;
}

export interface RunPackResult {
  ok: boolean;
  /** Set when `ok` is false — a fatal error before packing could complete. */
  fatal?: string;
  bundlePath: string;
  /** Set only when `--out` was given — the resolved path the packed bundle was written to. */
  outPath?: string;
  journalIncluded: boolean;
  journalEventCount: number;
  inlinedAssets: InlinedAsset[];
  /** Non-fatal notices — e.g. an asset referenced by a relative path that was not found on disk. */
  assetWarnings: string[];
  /** Whether a `quality` section was actually folded in. Absent with `noQuality`. */
  qualityFolded?: boolean;
  /** What the quality fold did — folded, skipped, or nothing to fold. Absent with `noQuality`. */
  qualityNotice?: string;
  /** The canonical packed bundle text (serializeBundle output), always populated on success. */
  output: string;
}

function fatalResult(bundlePath: string, message: string): RunPackResult {
  return {
    ok: false,
    fatal: message,
    bundlePath,
    journalIncluded: false,
    journalEventCount: 0,
    inlinedAssets: [],
    assetWarnings: [],
    output: "",
  };
}

/**
 * Pack the bundle at `options.path` into a single self-contained interchange
 * file. Pure with respect to the source bundle file (never mutates it) — only
 * `--out` writes anything to disk.
 */
export function runPack(options: RunPackOptions = {}): RunPackResult {
  const cwd = options.cwd ?? process.cwd();
  const filePath = resolve(cwd, options.path ?? DEFAULT_BUNDLE_PATH);
  const noJournal = options.noJournal ?? false;
  const inlineAssets = options.inlineAssets ?? false;

  let bundle: Record<string, unknown>;
  try {
    bundle = readBundle(filePath);
  } catch (e) {
    return fatalResult(filePath, (e as Error).message);
  }

  let journalIncluded = false;
  let journalEventCount = 0;
  if (noJournal) {
    delete bundle.journal;
  } else {
    const events = loadJournalEvents(bundle, filePath);
    if (events.length > 0) {
      bundle.journal = events;
      journalIncluded = true;
      journalEventCount = events.length;
    }
  }

  let qualityFolded: boolean | undefined;
  let qualityNotice: string | undefined;
  if (options.noQuality ?? false) {
    // `delete`, not "don't fold" — mirroring the journal branch above. A
    // source bundle may already carry a hand-written `quality` section, and
    // declining to add one would still hand `arkaik push` the old one to send.
    delete bundle.quality;
  } else {
    const root = resolveQualityRoot({ root: options.root, bundlePath: filePath, fallback: cwd });
    try {
      const fold = foldQualitySection(bundle, root, options.audit);
      qualityFolded = fold.folded;
      qualityNotice = fold.notice;
    } catch (e) {
      return fatalResult(filePath, (e as Error).message);
    }
  }

  const inlinedAssets: InlinedAsset[] = [];
  const assetWarnings: string[] = [];
  if (inlineAssets) {
    const bundleDir = dirname(filePath);
    const nodes = Array.isArray(bundle.nodes) ? (bundle.nodes as Record<string, unknown>[]) : [];
    for (const node of nodes) {
      const nodeId = typeof node.id === "string" ? node.id : "?";
      const metadata = node.metadata;
      if (metadata === null || typeof metadata !== "object") continue;
      const screenshots = (metadata as Record<string, unknown>).platformScreenshots;
      if (screenshots === null || typeof screenshots !== "object" || Array.isArray(screenshots)) continue;
      const map = screenshots as Record<string, unknown>;

      for (const [platform, value] of Object.entries(map)) {
        if (typeof value !== "string" || !isRelativeAssetPath(value)) continue;
        const assetPath = resolve(bundleDir, value);
        if (!existsSync(assetPath)) {
          assetWarnings.push(`${nodeId}/${platform}: asset not found at ${assetPath} — left as-is`);
          continue;
        }
        const bytes = readFileSync(assetPath);
        const mime = mimeForExtension(extname(assetPath));
        map[platform] = `data:${mime};base64,${bytes.toString("base64")}`;
        inlinedAssets.push({ nodeId, platform, path: value });
      }
    }
  }

  const output = serializeBundle(bundle as unknown as Parameters<typeof serializeBundle>[0]);

  let outPath: string | undefined;
  if (options.out !== undefined) {
    outPath = resolve(cwd, options.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, output);
  }

  return { ok: true, bundlePath: filePath, outPath, journalIncluded, journalEventCount, inlinedAssets, assetWarnings, qualityFolded, qualityNotice, output };
}

export function runPackCli(args: string[]): void {
  let noJournal = false;
  let noQuality = false;
  let inlineAssets = false;
  let audit: string | undefined;
  let root: string | undefined;
  let out: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--no-journal") {
      noJournal = true;
    } else if (arg === "--no-quality") {
      noQuality = true;
    } else if (arg === "--inline-assets") {
      inlineAssets = true;
    } else if (arg === "--audit") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --audit\n\n${USAGE}`);
      audit = value;
    } else if (arg === "--root") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --root\n\n${USAGE}`);
      root = value;
    } else if (arg === "--out") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --out\n\n${USAGE}`);
      out = value;
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      positionals.push(arg);
    }
  }

  // `--audit` names WHAT to fold and `--no-quality` says don't fold; whichever
  // the user meant, the other half of the command is not what they think it
  // is. Deliberately NOT extended to `--root` + `--no-quality`: `--root` names
  // WHERE to look, which is inert rather than contradictory when nothing is
  // looked up, and it is exactly the sort of flag a wrapper script or Makefile
  // sets unconditionally. Refusing that would break a reasonable pattern to
  // make a point.
  if (noQuality && audit !== undefined) {
    fail(`--audit and --no-quality contradict each other: one names an audit to fold, the other removes the section\n\n${USAGE}`);
  }

  const filePath = positionals[0] ?? DEFAULT_BUNDLE_PATH;
  const result = runPack({ path: filePath, out, noJournal, inlineAssets, noQuality, audit, root });
  if (!result.ok) fail(`FATAL: ${result.fatal}`);

  if (result.journalIncluded) {
    console.error(`Journal: embedded ${result.journalEventCount} event(s)`);
  } else if (noJournal) {
    console.error("Journal: omitted (--no-journal)");
  } else {
    console.error("Journal: none to embed (no embedded journal, no sidecar)");
  }
  if (result.qualityNotice !== undefined) {
    console.error(result.qualityNotice);
  }
  for (const asset of result.inlinedAssets) {
    console.error(`Inlined asset: ${asset.nodeId}/${asset.platform} (${asset.path})`);
  }
  for (const warning of result.assetWarnings) {
    console.error(`WARN: ${warning}`);
  }

  if (result.outPath !== undefined) {
    console.error(`Packed -> ${result.outPath}`);
  } else {
    process.stdout.write(result.output);
  }
  process.exit(0);
}
