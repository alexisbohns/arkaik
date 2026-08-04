/**
 * The fragment contract — the file boundary where agents meet the CLI.
 *
 * An agent never reads the bundle and never writes it. It writes one of these,
 * and `merge` owns everything else: ID uniqueness, edge endpoint resolution,
 * journal construction, ordering. Shapes are checked here so a malformed
 * fragment fails with the unit's name attached rather than corrupting a merge.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { FRAGMENTS_DIR } from "./paths";
import type { Manifest, WorkUnit } from "./manifest";

/** A node as an agent writes it: no project_id, plus an optional `created_ts`. */
export interface FragmentNode extends Record<string, unknown> {
  id: string;
  species: string;
  title: string;
  /** When this surface first shipped — becomes the `node.created` ts. */
  created_ts?: string;
}

export interface FragmentEdge extends Record<string, unknown> {
  source_id: string;
  target_id: string;
  kind: string;
}

/** A brownfield reconcile patch. */
export interface FragmentUpdate extends Record<string, unknown> {
  id: string;
  patch: Record<string, unknown>;
  /**
   * When a status-changing patch took effect. Only consulted when `patch`
   * touches `status` (or `metadata.decision_status`) — merge then emits a
   * `node.status_changed` (or `decision.status_changed`) event so the
   * snapshot and the journal stay in agreement (`crossCheckJournal`'s
   * `journal-status-mismatch`/`journal-decision-status-mismatch`,
   * docs/spec/journal.md). Falls back to the merge's own fallback ts when
   * absent.
   *
   * That fallback is a ONE-SHOT budget per node, not a free pass: it's the
   * SAME constant value for every event minted anywhere in one merge
   * invocation (it never advances mid-run). A single status-changing
   * `update`/`retire` for a node can omit `changed_ts` safely — but a SECOND
   * one for the SAME node in the SAME run (two `update` entries, or an
   * `update` and a `retire`) that also omits it will collide at the
   * identical ts, and `merge` refuses rather than guess an order (see
   * `merge.ts`'s `orderSensitiveSeen`). Give every status-changing op past
   * the first, for the same node, its own explicit `changed_ts`.
   */
  changed_ts?: string;
}

/** A brownfield retire op. Never a delete — see merge.ts's file doc. */
export interface FragmentRetire extends Record<string, unknown> {
  id: string;
  reason: string;
  /**
   * When the retirement took effect — becomes the node.status_changed ts.
   * Same one-shot-per-node fallback-ts caveat as `FragmentUpdate.changed_ts`
   * above.
   */
  changed_ts?: string;
}

export interface Fragment {
  unit: string;
  wave: number;
  /** Greenfield anatomy / acceptance output. */
  nodes?: FragmentNode[];
  edges?: FragmentEdge[];
  /** Brownfield reconcile output. */
  add?: FragmentNode[];
  update?: FragmentUpdate[];
  retire?: FragmentRetire[];
  /** Story output. */
  events?: Array<Record<string, unknown>>;
}

export interface LoadedFragment {
  unit: WorkUnit;
  fragment: Fragment;
}

export interface FragmentProblem {
  unit: string;
  message: string;
}

export interface FragmentLoad {
  loaded: LoadedFragment[];
  problems: FragmentProblem[];
  missing: string[];
}

function isArrayOfObjects(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((v) => typeof v === "object" && v !== null && !Array.isArray(v)))
  );
}

/**
 * Lowercase kebab-case only — mirrors `profile-validate.ts`'s `SAFE_ID_RE`.
 * `plan` already enforces this on every id it mints (area ids and era slugs
 * come from profile.json; `w0-recon`/`w1-`/`w2-`/`w3-` prefixes are code
 * literals), so in the ordinary path every `unit.id` reaching this file is
 * already safe. It is re-checked here anyway: see `fragmentPathFor` below.
 */
const SAFE_UNIT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The fragment path for `unit`, derived from its `id` — deliberately NOT
 * from `unit.fragment`.
 *
 * **Carried forward from Task 3's review:** the manifest stores both `id`
 * (validated at `plan` time — lowercase kebab-case, no `/` or `..`) and
 * `fragment` (a plain string built from that same id, `${FRAGMENTS_DIR}/
 * ${id}.json`). But manifest.json is a JSON file on disk, edited between
 * `plan` and `merge` by whatever drives the resumable run — units get
 * marked `done`/`rejected` between waves (see manifest.ts's "resume" tests)
 * — and nothing stops that same edit from also rewriting `fragment` to a
 * path outside `FRAGMENTS_DIR`. Trusting the stored field would mean a
 * single edited line in an agent-writable file decides what file `merge`
 * reads or (nothing does today, but nothing should ever assume otherwise)
 * writes.
 *
 * The fix: ignore `unit.fragment` entirely and re-derive the path from
 * `unit.id`, re-validating that id against the same safe-id shape `plan`
 * already enforced — `id` could itself have been hand-edited into something
 * unsafe, and re-deriving from an untrusted id would just move the problem
 * rather than close it. A manifest.json edit can still flip a unit's
 * `status`, or its `fragment` field, freely; neither has any effect on what
 * gets read here.
 */
function fragmentPathFor(cwd: string, unitId: string): string {
  if (typeof unitId !== "string" || !SAFE_UNIT_ID_RE.test(unitId)) {
    throw new Error(
      `manifest.json has an unsafe work-unit id: ${JSON.stringify(unitId)}. Refusing to resolve a fragment path ` +
        "from it — ids must be lowercase kebab-case (letters, digits, hyphens only). Fix manifest.json, or re-run " +
        "`arkaik bootstrap plan`, and retry.",
    );
  }
  return path.join(cwd, FRAGMENTS_DIR, `${unitId}.json`);
}

/**
 * Load every fragment named by the manifest. Absent files are reported, not
 * fatal — a unit whose wave hasn't run yet is an ordinary, resumable state.
 */
export function loadFragments(cwd: string, manifest: Manifest): FragmentLoad {
  const loaded: LoadedFragment[] = [];
  const problems: FragmentProblem[] = [];
  const missing: string[] = [];

  for (const unit of manifest.units) {
    let file: string;
    try {
      file = fragmentPathFor(cwd, unit.id);
    } catch (err) {
      problems.push({ unit: String(unit.id), message: err instanceof Error ? err.message : String(err) });
      continue;
    }

    if (!existsSync(file)) {
      missing.push(unit.id);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      problems.push({ unit: unit.id, message: `not valid JSON: ${err instanceof Error ? err.message : "parse error"}` });
      continue;
    }
    // Arrays are `typeof === "object"` in JS, so a fragment file that is
    // literally a top-level JSON array would slip past a bare
    // `typeof !== "object" || null` check and get treated as a valid,
    // entirely empty fragment (every `fragment.nodes` etc. access on an
    // array is simply undefined) — silently discarding whatever the agent
    // actually wrote instead of failing loudly.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      problems.push({ unit: unit.id, message: "fragment must be a JSON object" });
      continue;
    }
    const fragment = parsed as Fragment;
    for (const key of ["nodes", "edges", "add", "update", "retire", "events"] as const) {
      if (!isArrayOfObjects(fragment[key])) {
        problems.push({ unit: unit.id, message: `\`${key}\` must be an array of objects` });
      }
    }
    loaded.push({ unit, fragment });
  }

  return { loaded, problems, missing };
}
