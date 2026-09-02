/**
 * The two things `arkaik kritik` needs from its environment that a pure module
 * cannot supply: **where the criteria pack is**, and **whether this repo keeps
 * a journal to record quality events in**.
 *
 * Everything else — the model, the projections, the operations, the audit-file
 * layer — is `@arkaik/schema`, shared verbatim with the plugin scripts and the
 * MCP tools. This file is the seam, and it is exported through `arkaik/io`
 * (docs/spec/mcp.md § Reuse Seams) so the MCP server resolves the pack and the
 * journal exactly the way the CLI does rather than growing a second answer.
 */

import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeEvent,
  mergeKritikLibrary,
  type EventInput,
  type JournalEvent,
  type KritikLibrary,
} from "@arkaik/schema";
import {
  listAuditIds,
  loadAuditQualitySection,
  loadCurrentQualitySection,
  requireAudit,
} from "@arkaik/schema/src/cli/kritik-audit";
import {
  PACK_FILE,
  QUALITY_DIR,
  auditsDir,
  loadOverlay,
  loadProfile,
  profilePath,
  readJson,
} from "@arkaik/schema/src/cli/kritik-paths";
import { readBundle } from "./bundle-io";
import { appendJournalEvent, ensureJournalBaseline, journalPathFor } from "./journal-io";

/** Every quality event this CLI writes carries this actor unless told otherwise. */
export const KRITIK_ACTOR = "arkaik-cli";

export const DEFAULT_BUNDLE_PATH = join("docs", "arkaik", "bundle.json");

/**
 * A project may vendor its own copy of the pack here to pin a version
 * independent of the CLI it happens to be running. Checked first for exactly
 * that reason: the pack a score was taken against decides what the score means,
 * so the project gets to say which one, not whichever `npx` resolved today.
 */
export const VENDORED_PACK = join(QUALITY_DIR, PACK_FILE);

/**
 * The pack shipped inside the CLI, placed beside this module's own output
 * location by build.js (dist/index.js -> dist/assets/kritik/library.json), the
 * same way `arkaik init` carries the agent skill.
 */
const BUNDLED_PACK = join(dirname(fileURLToPath(import.meta.url)), "assets", "kritik", "library.json");

/** Where the pack came from, so a command can say which one it used. */
export interface ResolvedPack {
  library: KritikLibrary;
  path: string;
  vendored: boolean;
}

/** The criteria pack: the project's vendored copy if it has one, else the shipped one. */
export function resolvePack(root: string): ResolvedPack {
  const vendored = join(root, VENDORED_PACK);
  if (existsSync(vendored)) return { library: readJson<KritikLibrary>(vendored), path: vendored, vendored: true };
  if (!existsSync(BUNDLED_PACK)) {
    throw new Error(
      `no criteria pack found. Looked in:\n  ${vendored}\n  ${BUNDLED_PACK}\n` +
        `The second is shipped with this CLI, so its absence means a broken install — reinstall \`arkaik\`.`,
    );
  }
  return { library: readJson<KritikLibrary>(BUNDLED_PACK), path: BUNDLED_PACK, vendored: false };
}

/** Pack ⊕ this project's overlay — the library every verb actually scores against. */
export function loadKritikLibrary(root: string): { library: KritikLibrary; pack: ResolvedPack } {
  const pack = resolvePack(root);
  return { library: mergeKritikLibrary(pack.library, loadOverlay(root)), pack };
}

/**
 * Where this repo's journal would be, and whether it exists.
 *
 * Kritik does not require an Arkaik map, and starting a journal just to hold
 * quality events is not a decision a quality verb gets to make — so an absent
 * bundle means the events are skipped, loudly, not that the command fails.
 */
export function resolveJournal(root: string, bundlePath?: string): { bundlePath: string; journalPath: string; present: boolean } {
  const resolved = bundlePath ?? join(root, DEFAULT_BUNDLE_PATH);
  return { bundlePath: resolved, journalPath: journalPathFor(resolved), present: existsSync(resolved) };
}

/**
 * Append quality events to the journal sidecar, or report that there was none.
 *
 * The baseline adoption (#357) runs first for the same reason every other
 * writer runs it: this append is what makes a journal-less bundle's journal
 * non-empty and therefore cross-checked, and a project whose nodes predate
 * journaling would otherwise be flipped to permanently INVALID by its first
 * quality event.
 */
export function appendQualityEvents(
  root: string,
  inputs: readonly EventInput[],
  options: { actor?: string; bundlePath?: string } = {},
): { journalPath?: string; events: JournalEvent[]; baseline?: JournalEvent } {
  if (inputs.length === 0) return { events: [] };
  const actor = options.actor ?? KRITIK_ACTOR;
  const journal = resolveJournal(root, options.bundlePath);
  if (!journal.present) return { events: [] };

  const bundle = readBundle(journal.bundlePath);
  const baseline = ensureJournalBaseline(journal.journalPath, bundle, actor);
  const events = inputs.map((input) => makeEvent(input.type, input.payload, { actor }));
  for (const event of events) appendJournalEvent(journal.journalPath, event);
  return { journalPath: journal.journalPath, events, ...(baseline !== undefined ? { baseline } : {}) };
}

/**
 * Is this value a `quality` section, as opposed to merely present?
 *
 * "A section" means a non-null object and nothing else. `null` is the
 * reachable wrong answer — `JSON.stringify` writes it, hand-editing produces
 * it — and a bare presence check treats it as one. Shared with
 * `commands/restore.ts`'s loss guard so both sides of that comparison test
 * the same thing; a guard that fails open on a shape it never considered is
 * not a guard.
 */
export function isQualitySection(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What {@link foldQualitySection} did, for a caller that wants the fact rather than the sentence. */
export interface FoldQualityResult {
  /** A section was built from `docs/quality/` and written onto the bundle. */
  folded: boolean;
  /**
   * The fold produced nothing AND the bundle arrived carrying its own
   * section, which is therefore still on it. The case `arkaik restore`'s
   * quality-loss guard cannot see, because the outbound bundle does have a
   * section — just not one this fold made.
   */
  carriedSection: boolean;
  notice: string;
}

/**
 * Fold the repo's quality sidecars into a bundle's `quality` section.
 *
 * The projection is `@arkaik/schema`'s; what lives here is only what "being
 * the CLI's environment" means — resolving the effective pack, and turning
 * "there is nothing to fold" into a line a human can act on. With no
 * `auditId` that projection is the merge across every audit
 * (`loadCurrentQualitySection`); with one it is that audit's snapshot
 * (`loadAuditQualitySection`).
 *
 * MUTATES `bundle`, setting `bundle.quality` in place — the opposite of
 * `stripJournal`/`stripQuality`'s copy-and-return, and the reason the name is
 * a verb. `runPack` already owns a throwaway parse of the source file, and
 * what its caller wants back is the notice, not a second object to reconcile.
 *
 * THREE states return `folded: false` with a notice and leave the bundle
 * untouched rather than throwing: absent audits, an absent profile, and a
 * criteria pack that cannot be resolved. The first two are ordinary
 * mid-installation states. The third is a broken install or a vendored file
 * nobody committed — a fact about the machine, not about this bundle, and the
 * one failure mode a user cannot fix from inside their repo. None of them is
 * a reason for `arkaik pack` to fail, because quality is additive to a
 * bundle: a project with nothing to do with Kritik must still pack.
 *
 * "Leave the bundle untouched" is literal, and it is the half that used to go
 * unsaid: a section the bundle ALREADY CARRIED survives a failed fold and
 * ships. That is deliberate — it is what makes `arkaik restore <backup-path>`
 * put back the quality half of what it is undoing — but reporting it as
 * "none to fold" told the operator the opposite of what happened. So every
 * non-folding return says which of the two it was, and `carriedSection` is
 * the field a caller reads instead of the prose.
 *
 * What DOES throw is what is wrong with THIS command's inputs: a *malformed*
 * sidecar, and a named `auditId` that is not on disk. The second is checked
 * first, before any of the it-is-fine-to-have-nothing returns can swallow it
 * — a typo'd `--audit` in a repo that happens to have no audits is still a
 * typo.
 */
export function foldQualitySection(
  bundle: Record<string, unknown>,
  root: string,
  auditId?: string,
): FoldQualityResult {
  /**
   * A non-folding outcome, saying whether the bundle's own section survived.
   *
   * The distinction is invisible from the notice's first line and it changes
   * what ships: "nothing to fold and nothing was there" sends no section,
   * while "nothing to fold, so what you brought was kept" sends whatever the
   * source file carried — including, on `arkaik restore`, a section the
   * quality-loss guard will then not fire on, because the outbound bundle
   * does have one.
   */
  const notFolded = (reason: string): FoldQualityResult => {
    const carriedSection = isQualitySection(bundle.quality);
    return {
      folded: false,
      carriedSection,
      notice: carriedSection
        ? `Quality: ${reason}\n  Kept the quality section this bundle already carried — nothing replaced it.`
        : `Quality: ${reason}`,
    };
  };

  if (auditId !== undefined) requireAudit(root, auditId);

  const auditIds = listAuditIds(root);
  if (auditIds.length === 0) {
    return notFolded(`none to fold — no audits under ${auditsDir(root)} (run \`arkaik kritik score\` to open one)`);
  }
  // `!profile`, not `=== null`, so this and the merge's own guard
  // (`loadCurrentQualitySection`) refuse exactly the same set. A profile.json
  // holding `false`, `0` or `""` is valid JSON and falsy: a `=== null` check
  // here would wave it through, the merge would refuse it, and the fallback
  // below would report the wrong cause.
  if (!loadProfile(root)) {
    return notFolded(`skipped, no profile — nothing at ${profilePath(root)} (run \`arkaik kritik profile\`)`);
  }

  // Loud, not fatal. `resolvePack` already explains itself well ("its absence
  // means a broken install — reinstall `arkaik`"); what it must not do is take
  // `arkaik pack` down with it, on a bundle that may have nothing to do with
  // quality. Its wording is reused verbatim rather than paraphrased, so there
  // is exactly one explanation of a missing pack in the CLI.
  let library: KritikLibrary;
  try {
    ({ library } = loadKritikLibrary(root));
  } catch (e) {
    // "skipped, no pack" rather than a bare "skipped —": the profile notice
    // above shares that prefix, and an agent prefix-matching the skill's
    // table would otherwise diagnose a missing profile and run `arkaik kritik
    // profile` against a broken install.
    return notFolded(`skipped, no pack — ${(e as Error).message}`);
  }

  const section =
    auditId === undefined
      ? loadCurrentQualitySection(root, library)
      : loadAuditQualitySection(root, auditId, library);

  // Defence against divergence, not dead code, and not a proof of
  // impossibility. The merge returns `undefined` for exactly the two states
  // the guards above refuse, so this cannot fire while all four conditions
  // agree — but that agreement lives in two functions in two packages, and
  // this is what catches them drifting. Handled rather than cast away: a
  // guard weakened upstream then surfaces as a notice naming both candidate
  // causes, instead of `undefined` typed into `bundle.quality`.
  if (section === undefined) {
    return notFolded(`nothing to fold — no audits under ${auditsDir(root)}, or no profile at ${profilePath(root)}`);
  }

  bundle.quality = section;
  const count = auditId === undefined ? auditIds.length : 1;
  return {
    folded: true,
    carriedSection: false,
    notice: `Quality: folded ${section.assessments.length} assessment(s), ${section.findings.length} finding(s) from ${count} audit(s)`,
  };
}

/**
 * The repo root whose `docs/quality/` belongs to a given bundle file.
 *
 * Derived from the bundle, NOT from the cwd, so every input a verb assembles
 * comes from the same place: `loadJournalEvents` finds the journal as a
 * sibling of the bundle, `arkaik pack`'s asset inlining resolves against the
 * bundle's own directory, and quality resolves against the repo that bundle
 * lives in. Rooting this at the cwd instead would let `cd /a && arkaik pack
 * /b/docs/arkaik/bundle.json` fold /a's audit into /b's bundle — quality data
 * from a project the output has nothing to do with. `arkaik restore` shares
 * this for the same reason and with more at stake: there, the wrong root
 * sends one repo's findings to another repo's hosted project.
 *
 * Only the conventional `<root>/docs/arkaik/<file>` layout is recognised: the
 * one `arkaik init` writes and {@link DEFAULT_BUNDLE_PATH} names. A bundle
 * kept anywhere else has no root to discover, so the cwd stands in and `root`
 * says otherwise. That the `kritik` verb family is cwd-rooted is not a
 * counterexample — those verbs have no bundle path to derive from.
 *
 * It lives here, beside "where is the pack" and "where is the journal",
 * because "which repo owns this bundle" is the same class of question: what
 * being the CLI's environment means, rather than anything a projection knows.
 *
 * Shared by the CLI and the MCP server (`packages/mcp/src/index.ts` calls
 * this directly via the `arkaik/io` barrel) — before #400 they were two
 * separate functions answering the same question differently, one drifting
 * from the other. Reconciling them collapsed one difference on purpose: the
 * CLI now honors `$ARKAIK_QUALITY_ROOT` too, which it previously ignored —
 * and since the env var outranks layout detection, a value exported for one
 * repo's MCP config redirects `arkaik kritik` in EVERY repo until unset;
 * `--root` still wins over it per invocation. The one remaining deliberate
 * difference between the
 * callers is `fallback`: the CLI passes its cwd, meaningful because a person
 * typed the command inside a repo; the MCP server passes the bundle's own
 * directory, because it has no meaningful cwd — the agent host chose it, not
 * someone operating inside a repo. `root` is CLI-only (its `--root` flag);
 * the MCP server never has one to pass.
 */
export function resolveQualityRoot(options: {
  /** Explicit override, resolved against `fallback` — e.g. the CLI's `--root` flag. Wins outright. */
  root?: string;
  /** Environment to read `$ARKAIK_QUALITY_ROOT` from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** The bundle's own path — the conventional `<root>/docs/arkaik/<file>` layout is detected from its directory. */
  bundlePath: string;
  /** Where an unconventional layout falls back: the CLI's cwd, or the MCP server's bundle dir. */
  fallback: string;
}): string {
  if (options.root !== undefined) return resolve(options.fallback, options.root);
  const envRoot = (options.env ?? process.env).ARKAIK_QUALITY_ROOT;
  if (envRoot) return resolve(envRoot);
  const dir = dirname(options.bundlePath);
  if (basename(dir) === "arkaik" && basename(dirname(dir)) === "docs") return resolve(dir, "..", "..");
  return options.fallback;
}
