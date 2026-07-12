/**
 * `arkaik pack [--no-journal] [--inline-assets] [--out <path>] [path]`.
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
 *  3. `--inline-assets` (OFF by default, local-only in v1): every
 *     `metadata.platformScreenshots` value that is a *relative path* (no URI
 *     scheme, no leading `/` — docs/spec/bundle-format.md § Asset Values) is
 *     read from disk (resolved against the bundle's directory) and rewritten
 *     to a `data:` URI, base64-encoded, with a best-effort mime type from the
 *     extension. Absolute `https://` URLs and existing `data:` URIs are left
 *     untouched. Uploading to a hosted bucket is OUT OF SCOPE for v1 — only
 *     local relative-path assets can be inlined;
 *  4. the (possibly mutated) bundle object — never reconstructed as
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

const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";

const USAGE = `arkaik pack [--no-journal] [--inline-assets] [--out <path>] [path]

Produce a single self-contained interchange bundle: fold in the sidecar
journal (or keep an existing embedded one) and, with --inline-assets, inline
local screenshot files as data: URIs. Written canonically via serializeBundle.
Unknown top-level keys and unknown fields always round-trip.

Arguments:
  path              Path to the bundle JSON file (default: ${DEFAULT_BUNDLE_PATH}).

Options:
  --no-journal      Omit the embedded journal[] (Publik-safe posture — history
                     stays private unless explicitly included). Default: the
                     journal IS embedded (that is the point of a single-file
                     interchange) — embedded wins over the sidecar when the
                     bundle already carries one, otherwise the sidecar is used
                     (same precedence "arkaik validate" folds by).
  --inline-assets   Convert relative-path metadata.platformScreenshots values
                     into data: URIs by reading the file from disk (resolved
                     against the bundle's directory). Absolute https:// URLs
                     and existing data: URIs are left as-is. v1 scope: local
                     files only — uploading a remote/hosted copy is not
                     implemented.
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

  return { ok: true, bundlePath: filePath, outPath, journalIncluded, journalEventCount, inlinedAssets, assetWarnings, output };
}

export function runPackCli(args: string[]): void {
  let noJournal = false;
  let inlineAssets = false;
  let out: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--no-journal") {
      noJournal = true;
    } else if (arg === "--inline-assets") {
      inlineAssets = true;
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

  const filePath = positionals[0] ?? DEFAULT_BUNDLE_PATH;
  const result = runPack({ path: filePath, out, noJournal, inlineAssets });
  if (!result.ok) fail(`FATAL: ${result.fatal}`);

  if (result.journalIncluded) {
    console.error(`Journal: embedded ${result.journalEventCount} event(s)`);
  } else if (noJournal) {
    console.error("Journal: omitted (--no-journal)");
  } else {
    console.error("Journal: none to embed (no embedded journal, no sidecar)");
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
