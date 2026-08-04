/**
 * The work-unit manifest — bootstrap's unit of resumability.
 *
 * Unit status lives on disk, not in a session, so a killed run picks up at the
 * first `pending` unit instead of starting over. `plan` is repo-agnostic: with
 * no recon profile it emits only the wave-0 recon unit, and re-running after
 * recon expands waves 1–3 from whatever areas and eras that profile declares.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { at, ensureDir, FRAGMENTS_DIR, MANIFEST_FILE, PLAN_DIR, PROFILE_FILE } from "./paths";

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

export function readProfile(cwd: string): Profile | null {
  const file = at(cwd, PROFILE_FILE);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Profile;
}

export function readManifest(cwd: string): Manifest | null {
  const file = at(cwd, MANIFEST_FILE);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
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
 */
export function detectMode(cwd: string, bundlePath: string): Manifest["mode"] {
  const file = at(cwd, bundlePath);
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

/** Letters, digits and hyphens only — no `/`, no `..`, no whitespace. */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Area ids and era slugs come from profile.json — written by an agent, not
 * by this code — and become fragment filenames verbatim
 * (`${FRAGMENTS_DIR}/${id}.json`). An id containing `/` or `..` would make
 * that path escape the fragments directory; whitespace or other punctuation
 * just means "not what a human meant to type." Reject rather than sanitize:
 * silently mangling the id would let two different-looking ids collide
 * without anyone noticing.
 */
function assertSafeId(kind: "area" | "era", id: unknown): void {
  if (typeof id !== "string" || !SAFE_ID_RE.test(id)) {
    throw new Error(
      `profile.json has an unsafe ${kind} id: ${JSON.stringify(id)}. Work-unit ids become fragment filenames ` +
        `under ${FRAGMENTS_DIR}/, so they must contain only letters, digits and hyphens (no "/", "..", or ` +
        "whitespace). Fix profile.json and re-run `arkaik bootstrap plan`.",
    );
  }
}

/**
 * Build the manifest for this repo. `previous` (when given) carries unit
 * statuses forward so re-planning after recon never loses completed work —
 * but only for a unit whose title/scope/slice is unchanged from the last
 * plan. If the profile edited an area's paths (or an era's slug) since then,
 * the old fragment on disk was written against the old definition; carrying
 * `done` forward would let `merge` consume that stale output with no signal
 * anything is wrong, so the unit resets to `pending` instead.
 */
export function planUnits(options: {
  mode: Manifest["mode"];
  bundle: string;
  profile: Profile | null;
  previous: Manifest | null;
}): Manifest {
  const { mode, bundle, profile, previous } = options;

  for (const area of profile?.areas ?? []) assertSafeId("area", area.id);
  for (const era of profile?.eras ?? []) assertSafeId("era", era.slug);

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
  // doesn't match the unit that supposedly produced it.
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
    if (!before) continue;
    const sameDefinition =
      before.title === u.title && before.scope === u.scope && JSON.stringify(before.slice) === JSON.stringify(u.slice);
    if (sameDefinition) u.status = before.status;
  }

  return { version: 1, mode, bundle, units };
}
