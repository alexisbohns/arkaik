/**
 * The work-unit manifest — bootstrap's unit of resumability.
 *
 * Unit status lives on disk, not in a session, so a killed run picks up at the
 * first `pending` unit instead of starting over. `plan` is repo-agnostic: with
 * no recon profile it emits only the wave-0 recon unit, and re-running after
 * recon expands waves 1–3 from whatever areas and eras that profile declares.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { at, ensureDir, FRAGMENTS_DIR, MANIFEST_FILE, PLAN_DIR, PROFILE_FILE } from "./paths";
import { assertValidProfile } from "./profile-validate";

export type UnitStatus = "pending" | "done" | "rejected";

export interface WorkUnit {
  /** Stable, filesystem-safe: also names the fragment file. */
  id: string;
  wave: 0 | 1 | 2 | 3;
  title: string;
  /** What the agent is asked to produce, in words. */
  scope: string;
  /** How `bootstrap slice` resolves this unit's corpus subset. */
  slice: { paths?: string[]; eras?: string[]; docs?: boolean };
  /** Where the agent writes its fragment, repo-relative. */
  fragment: string;
  status: UnitStatus;
}

export interface Manifest {
  version: 1;
  mode: "greenfield" | "brownfield";
  bundle: string;
  units: WorkUnit[];
}

export interface Profile {
  products?: Array<{ id: string; title: string }>;
  platforms?: string[];
  areas?: Array<{ id: string; title: string; paths: string[] }>;
  eras?: Array<{ slug: string; title: string; from?: string; to?: string }>;
}

/**
 * profile.json is agent-written, so a raw `JSON.parse` failure is the likely
 * failure mode — naming the file (not just "Unexpected end of JSON input")
 * matters when manifest.json and the bundle are also in play. Matches
 * `detectMode`'s error style below.
 */
export function readProfile(cwd: string): Profile | null {
  const file = at(cwd, PROFILE_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Profile;
  } catch (err) {
    throw new Error(`cannot read ${PROFILE_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function readManifest(cwd: string): Manifest | null {
  const file = at(cwd, MANIFEST_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch (err) {
    throw new Error(`cannot read ${MANIFEST_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function writeManifest(cwd: string, manifest: Manifest): void {
  ensureDir(at(cwd, PLAN_DIR));
  ensureDir(at(cwd, FRAGMENTS_DIR));
  writeFileSync(at(cwd, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Greenfield vs brownfield: the spec's rule is "no bundle, OR A STUB" — an
 * `arkaik init` scaffold is a real file with zero nodes, so `existsSync`
 * alone would misclassify it as brownfield and send agents into reconcile
 * mode against nothing. Only a bundle that already carries nodes is
 * brownfield. A bundle file that exists but can't be parsed as JSON is a
 * real problem, not a mode to silently guess at, so it throws instead of
 * defaulting either way.
 *
 * `bundlePath` is resolved with `path.resolve`, not `at`/`path.join`: unlike
 * the fixed `.arkaik/...` constants in ./paths, this value comes straight
 * from `--bundle` and may already be absolute. `path.join(cwd, "/abs/x")`
 * mangles an absolute path into `<cwd>/abs/x`; `path.resolve` returns an
 * absolute second argument unchanged, so it's the correct join for both
 * relative and absolute input. `bootstrap merge` (Task 6) resolves the same
 * `manifest.bundle` field the same way — keep the two in agreement.
 */
export function detectMode(cwd: string, bundlePath: string): Manifest["mode"] {
  const file = path.resolve(cwd, bundlePath);
  if (!existsSync(file)) return "greenfield";
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`cannot read bundle at ${bundlePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const nodes =
    parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { nodes?: unknown }).nodes)
      ? (parsed as { nodes: unknown[] }).nodes
      : [];
  return nodes.length === 0 ? "greenfield" : "brownfield";
}

function unit(id: string, wave: WorkUnit["wave"], title: string, scope: string, slice: WorkUnit["slice"]): WorkUnit {
  return { id, wave, title, scope, slice, fragment: `${FRAGMENTS_DIR}/${id}.json`, status: "pending" };
}

const RECON_SCOPE =
  "Read the corpus and the repo. Write .arkaik/bootstrap/profile.json declaring products, the platform axis, " +
  "the areas to fan out over (id, title, code paths), and the thematic eras the merged PRs fall into. " +
  "Then re-run `arkaik bootstrap plan` to expand waves 1-3.";

/**
 * Build the manifest for this repo. `previous` (when given) carries unit
 * statuses forward so re-planning after recon never loses completed work —
 * but only for a unit whose `slice` is unchanged from the last plan (see
 * `sameSlice` below for why `slice` alone is the right key).
 */
export function planUnits(options: {
  mode: Manifest["mode"];
  bundle: string;
  profile: Profile | null;
  previous: Manifest | null;
}): Manifest {
  const { mode, bundle, profile, previous } = options;

  // Everything below reaches either a filesystem path (id -> fragment file)
  // or a token-budget decision (paths/eras -> what an agent reads), and all
  // of it is agent-written, not code-written — fail loudly and specifically
  // rather than crash on a raw JS error or silently do the wrong thing. See
  // profile-validate.ts for the full checklist.
  assertValidProfile(profile);

  const units: WorkUnit[] = [unit("w0-recon", 0, "Recon", RECON_SCOPE, { docs: true })];

  for (const area of profile?.areas ?? []) {
    units.push(
      unit(
        `w1-${area.id}`,
        1,
        `Anatomy — ${area.title}`,
        mode === "brownfield"
          ? `Reconcile the existing map for ${area.title} against the code. Emit add/update/retire; never delete.`
          : `Map the anatomy of ${area.title}: flows, views, data models, API endpoints, and the edges between them.`,
        { paths: area.paths },
      ),
    );
  }

  for (const area of profile?.areas ?? []) {
    units.push(
      unit(
        `w2-${area.id}`,
        2,
        `Acceptances — ${area.title}`,
        `Write acceptances for ${area.title}: one Given/When/Then each, 1-3 value elements, covers edges to real nodes, ` +
          `platform scoping per the platform axis in profile.json.`,
        { paths: area.paths },
      ),
    );
  }

  for (const era of profile?.eras ?? []) {
    units.push(
      unit(
        `w3-${era.slug}`,
        3,
        `Story — ${era.title}`,
        `Turn this era's user-visible PRs into deliverables and tag the era as a release. A PR with a Lab Note is ` +
          `user-visible by definition; judge the rest.`,
        { eras: [era.slug] },
      ),
    );
  }

  // Gated on recon having run at all, not on eras existing: the decisions
  // unit mines design docs and the status-arc unit arcs anatomy nodes,
  // neither of which reads era boundaries. A profile with real areas but
  // zero eras (a young repo, or one recon judged has no story worth
  // splitting yet) should still get both — gating on `eras.length` silently
  // dropped decision-mining and status arcs for exactly that repo shape.
  if (profile) {
    units.push(
      unit("w3-decisions", 3, "Story — decisions", "Mine decisions from the design docs; emit DEC- nodes, their edges, and their events.", {
        docs: true,
      }),
      unit("w3-status-arcs", 3, "Story — status arcs", "Give each anatomy node an honest 1-3 event status arc ending at its snapshot status.", {
        docs: false,
      }),
    );
  }

  // Ids come from profile.json (area ids, era slugs) alongside two hardcoded
  // wave-3 ids ("decisions", "status-arcs"). Any collision — two areas
  // sharing an id, two eras sharing a slug, or an era slug landing on one of
  // the reserved wave-3 names — would mint two units pointing at the same
  // fragment file, silently losing whichever agent's output the other one's
  // write clobbers. Catch it here, not when `merge` finds a fragment that
  // doesn't match the unit that supposedly produced it. Ids are already
  // lowercase-only (assertSafeId), so this comparison needs no normalizing.
  const seen = new Set<string>();
  for (const u of units) {
    if (seen.has(u.id)) {
      throw new Error(
        `duplicate work-unit id "${u.id}" — check profile.json for a repeated area id or era slug (or one that ` +
          'collides with the reserved "decisions" / "status-arcs" era names).',
      );
    }
    seen.add(u.id);
  }

  const previousById = new Map((previous?.units ?? []).map((u) => [u.id, u]));
  for (const u of units) {
    const before = previousById.get(u.id);
    if (before && sameSlice(before, u)) u.status = before.status;
  }

  return { version: 1, mode, bundle, units };
}

/**
 * Whether `next`'s slice is unchanged from `before`'s — the ONLY test for
 * carrying a unit's status forward on re-plan. `slice` is what determines
 * whether the fragment already on disk is still correct: it's the exact
 * corpus subset (`bootstrap slice`) the agent read to produce it. If a
 * profile edit changes an area's `paths` (or an era's slug), the old
 * fragment was written against different input, so this returns `false` and
 * the unit resets to `pending`.
 *
 * `scope` and `title` are deliberately NOT compared, even though an earlier
 * version of this function compared both. Both are presentation, generated
 * from templates, never hand-edited — they can change for reasons that have
 * nothing to do with the fragment's validity:
 *  - `scope`'s wave-1 text is mode-dependent ("map the anatomy" vs.
 *    "reconcile the existing map"). Comparing it meant a plain
 *    greenfield -> brownfield mode flip — which happens every time `merge`
 *    lands wave-1 nodes and `plan` runs again — resurrected every finished
 *    wave-1 unit back to `pending`, even though nothing the agent read
 *    changed and the fragment is still exactly right. Under `plan --issues`
 *    (Task 8) that means re-filing a GitHub issue for work already merged.
 *  - `title`'s wave-3 era text is a pure display string; renaming an era for
 *    cosmetic reasons forced a full redo of an otherwise-valid fragment.
 *
 * Compares via `JSON.stringify`, which is key-order sensitive: today every
 * slice literal in this file has exactly one key (`paths`, `eras`, or
 * `docs`), so order can never differ between two calls to `unit()`. If a
 * future slice ever grows a second key, an equivalent slice built with keys
 * in a different order would compare as "changed" even though nothing an
 * agent reads actually did — worth a real deep-equality check at that point,
 * not before.
 */
function sameSlice(before: WorkUnit, next: WorkUnit): boolean {
  return JSON.stringify(before.slice) === JSON.stringify(next.slice);
}
