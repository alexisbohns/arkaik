/**
 * `arkaik open [--out <path>] [--no-open] [path]`.
 *
 * Validate, then hand off to arkaik.app import (docs/spec/toolchain.md § the
 * CLI). Runs the exact same shape + semantic + snapshot<->journal cross-check
 * as `arkaik validate` (`../lib/bundle-validate`'s `validateBundleAt`, shared
 * so the two checks can never drift) and only on success proceeds:
 *
 *  1. INVALID bundle: print the findings, exit non-zero. Nothing is packed,
 *     nothing is written, no browser is opened;
 *  2. VALID bundle: pack it (`../commands/pack`'s `runPack`, default settings
 *     — journal embedded, no asset inlining) to `--out` when given, else to a
 *     fresh temp file under `os.tmpdir()` (the app needs a single file to
 *     import; the CLI has no way to drop a stream into a browser's file
 *     picker, so a real file on disk is the handoff artifact);
 *  3. open the browser to the arkaik.app import surface
 *     (https://arkaik.app/projects — the app's project list, which has an
 *     "Import JSON" file picker; there is no dedicated /import route yet) via
 *     the injectable `opener` seam, then print the packed file's path and the
 *     URL so a human (or an agent) can complete the drag-in.
 *
 * The opener is ALWAYS an injected seam (`RunOpenOptions.opener`, defaulting
 * to a real `open`/`xdg-open`/`start` spawn) and `--no-open` skips calling it
 * entirely — together these are what keep tests/CI from ever launching a real
 * browser.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateBundleAt, type BundleValidation } from "../lib/bundle-validate";
import { formatFinding } from "./validate";
import { runPack } from "./pack";

const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";

/** The app's project list — has an "Import JSON" file picker. No dedicated /import route exists yet. */
export const OPEN_URL = "https://arkaik.app/projects";

const USAGE = `arkaik open [--out <path>] [--no-open] [path]

Validate the bundle (shape + semantic + snapshot<->journal cross-checks, same
as "arkaik validate"), and only on success pack it and hand off to arkaik.app
import: the packed bundle is written to disk and a browser is opened to
${OPEN_URL} (the project list's "Import JSON" picker). On an invalid bundle,
findings are printed and nothing is packed, written, or opened.

Arguments:
  path            Path to the bundle JSON file (default: ${DEFAULT_BUNDLE_PATH}).

Options:
  --out <path>    Write the packed bundle here instead of a temp file.
  --no-open       Skip launching the browser; still packs and reports the URL.
  -h, --help      Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * The real platform opener — `open` (macOS), `start` (Windows), else
 * `xdg-open`. Detached, best-effort: the URL is always printed too, so a
 * missing opener binary (e.g. no `xdg-open` on a headless box) degrades to a
 * silent no-op rather than an unhandled 'error' event crashing the CLI.
 */
function defaultOpener(url: string): void {
  const platform = process.platform;
  const child =
    platform === "darwin"
      ? spawn("open", [url], { detached: true, stdio: "ignore" })
      : platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
        : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

export interface RunOpenOptions {
  /** Path to the bundle JSON file (default: docs/arkaik/bundle.json), resolved against `cwd`. */
  path?: string;
  /** Write the packed bundle here instead of a fresh temp file. Resolved against `cwd`. */
  out?: string;
  /** Skip the handoff (no browser launch); still validates, packs, and reports. */
  noOpen?: boolean;
  /** Base directory `path`/`out` resolve against (default: process.cwd()). */
  cwd?: string;
  /** The browser-launch seam. Default: the real platform opener. Tests inject a mock/no-op. */
  opener?: (url: string) => void | Promise<void>;
}

export interface RunOpenResult {
  ok: boolean;
  /** Set when `ok` is false — a fatal error (bad path/JSON) before validation could even run. */
  fatal?: string;
  bundlePath: string;
  valid: boolean;
  errorLines: string[];
  warningLines: string[];
  /** Set only when `valid` — the path the packed bundle was written to (temp file, or --out). */
  outPath?: string;
  /** Set only when `valid` — the arkaik.app URL the handoff points at. */
  url?: string;
  /** True iff the opener seam was actually invoked (never true with --no-open). */
  opened: boolean;
}

function fatalResult(bundlePath: string, message: string): RunOpenResult {
  return { ok: false, fatal: message, bundlePath, valid: false, errorLines: [], warningLines: [], opened: false };
}

/**
 * Validate the bundle at `options.path`, and only on success pack + hand it
 * off. On an invalid bundle, no file is written and the opener is never
 * called.
 */
export async function runOpen(options: RunOpenOptions = {}): Promise<RunOpenResult> {
  const cwd = options.cwd ?? process.cwd();
  const filePath = resolve(cwd, options.path ?? DEFAULT_BUNDLE_PATH);
  const noOpen = options.noOpen ?? false;

  let v: BundleValidation;
  try {
    v = validateBundleAt(filePath);
  } catch (e) {
    return fatalResult(filePath, (e as Error).message);
  }

  const warningLines = v.result.warnings.map(formatFinding);
  const errorLines = [
    ...v.sidecarFindings.map((f) => `ERROR [${f.rule}] line ${f.line}: ${f.message}`),
    ...v.result.errors.map(formatFinding),
  ];

  if (!v.valid) {
    return { ok: true, bundlePath: filePath, valid: false, errorLines, warningLines, opened: false };
  }

  const packed = runPack({ path: filePath, out: options.out, cwd });
  if (!packed.ok) {
    return fatalResult(filePath, packed.fatal ?? "pack failed");
  }

  let outPath = packed.outPath;
  if (outPath === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "arkaik-open-"));
    outPath = join(dir, "bundle.json");
    writeFileSync(outPath, packed.output);
  }

  let opened = false;
  if (!noOpen) {
    const opener = options.opener ?? defaultOpener;
    await opener(OPEN_URL);
    opened = true;
  }

  return { ok: true, bundlePath: filePath, valid: true, errorLines, warningLines, outPath, url: OPEN_URL, opened };
}

export function runOpenCli(args: string[]): void {
  let out: string | undefined;
  let noOpen = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--no-open") {
      noOpen = true;
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

  runOpen({ path: filePath, out, noOpen })
    .then((result) => {
      if (!result.ok) fail(`FATAL: ${result.fatal}`);

      if (result.warningLines.length > 0) {
        console.error(`Warnings: ${result.warningLines.length}`);
        result.warningLines.forEach((w) => console.error(`  ${w}`));
      }

      if (!result.valid) {
        console.error(`Errors: ${result.errorLines.length}`);
        result.errorLines.forEach((e) => console.error(`  ${e}`));
        console.error("\nInvalid bundle — not packed, not opened.");
        process.exit(1);
      }

      console.log(`Packed -> ${result.outPath}`);
      if (result.opened) {
        console.log(`Opened ${result.url}`);
      } else {
        console.log(`Import at ${result.url} (drag in ${result.outPath})`);
      }
      process.exit(0);
    })
    .catch((e: unknown) => fail(`FATAL: ${(e as Error).message}`));
}
