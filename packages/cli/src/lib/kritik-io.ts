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
import { dirname, join } from "node:path";
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
 * An *absent* profile and *absent* audits are ordinary mid-installation
 * states: each returns `folded: false` with a notice and leaves the bundle
 * alone, because quality is additive and neither is a reason for `arkaik
 * pack` to fail. What DOES throw: a *malformed* sidecar, and a named
 * `auditId` that is not on disk. The second is checked first, before either
 * of the it-is-fine-to-have-nothing returns can swallow it — a typo'd
 * `--audit` in a repo that happens to have no audits is still a typo.
 */
export function foldQualitySection(
  bundle: Record<string, unknown>,
  root: string,
  auditId?: string,
): { folded: boolean; notice: string } {
  if (auditId !== undefined) requireAudit(root, auditId);

  const auditIds = listAuditIds(root);
  if (auditIds.length === 0) {
    return {
      folded: false,
      notice: `Quality: none to fold — no audits under ${auditsDir(root)} (run \`arkaik kritik score\` to open one)`,
    };
  }
  if (loadProfile(root) === null) {
    return {
      folded: false,
      notice: `Quality: skipped — no profile at ${profilePath(root)} (run \`arkaik kritik profile\`)`,
    };
  }

  const { library } = loadKritikLibrary(root);
  const section =
    auditId === undefined
      ? loadCurrentQualitySection(root, library)
      : loadAuditQualitySection(root, auditId, library);

  // Unreachable today: the merge returns `undefined` only for no audits or no
  // profile, and both are ruled out by the guards above. Handled rather than
  // cast away so that deleting one of those guards fails here, loudly, instead
  // of typing `undefined` as a section and shipping an empty `quality` key.
  if (section === undefined) {
    return { folded: false, notice: `Quality: nothing to fold under ${auditsDir(root)}` };
  }

  bundle.quality = section;
  const count = auditId === undefined ? auditIds.length : 1;
  return {
    folded: true,
    notice: `Quality: folded ${section.assessments.length} assessment(s), ${section.findings.length} finding(s) from ${count} audit(s)`,
  };
}
