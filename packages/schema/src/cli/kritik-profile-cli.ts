/**
 * Entry point for the standalone `init-profile.js` build artifact — Kritik's
 * install-time surface picker (RFC § 6, capability 1).
 *
 * Installing Kritik into a repo has exactly one required decision: **what are
 * this product's surfaces?** Everything downstream is shaped by the answer —
 * each criterion's `applies_to` intersects the selected list to produce the
 * audit's cell set, and the matrix has exactly these columns. A single-surface
 * app picks one and every cell collapses to one column; a monorepo picks many.
 *
 * The picker is deliberately not interactive here. An agent installing this
 * plugin can see the repo and should *propose* a surface list rather than
 * interrogate the user, so the script takes the decision as arguments and owns
 * only the part that must not be improvised: validating it and writing it
 * somewhere the other scripts will find it.
 *
 * Usage:
 *   node init-profile.js --surface <id>[:<title>[:<platform>]] [...] [--weight CODE=n] [...]
 *   node init-profile.js --config <path.json>
 */

import { existsSync } from "node:fs";
import type { QualityProfile, SurfaceDef } from "../quality";
import { parseSurfaceSpec } from "../quality-ops";
import { die, profilePath, readJson, writeJson } from "./kritik-paths";

const USAGE = `init-profile.js — write this project's Kritik profile (its surfaces and domain weights)

Usage:
  node init-profile.js --surface <id>[:<title>[:<platform>]] [--surface ...] [--weight <CODE>=<n>] [...]
  node init-profile.js --config <path.json>

  --surface   one audit target. \`id\` is what assessments reference; \`title\` is
              what the matrix column reads; \`platform\` (web|ios|android) is the
              optional bridge to the Arkaik product map, for surfaces that ship
              views. Omit it for a database contract, an admin back-office, a CLI.
  --weight    how hard this product is graded on a domain (default 1 for all).
              e.g. --weight SEC=2 --weight PRV=2
  --config    read {"surfaces":[...],"domain_weights":{...}} from a file instead
  --root      repo root to write into (default: the current directory)
  --force     overwrite an existing profile

Writes docs/quality/profile.json

Examples:
  node init-profile.js --surface web:Web app:web
  node init-profile.js --surface web:Web:web --surface ios:iOS:ios \\
                       --surface supabase:Database contract --weight SEC=2`;

/** `id[:title[:platform]]`, validated by the shared parser so the CLI and this
 * script accept exactly one surface vocabulary. */
function parseSurface(spec: string): SurfaceDef {
  try {
    return parseSurfaceSpec(spec);
  } catch (error) {
    return die(`init-profile: ${(error as Error).message}`);
  }
}

function parseWeight(spec: string): [string, number] {
  const at = spec.indexOf("=");
  if (at <= 0) die(`init-profile: --weight wants CODE=number (got "${spec}")`);
  const code = spec.slice(0, at).trim();
  const value = Number(spec.slice(at + 1));
  if (!Number.isFinite(value) || value <= 0) die(`init-profile: weight for "${code}" must be a positive number (got "${spec}")`);
  return [code, value];
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const surfaces: SurfaceDef[] = [];
  const weights: Record<string, number> = {};
  let root = process.cwd();
  let config: string | undefined;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--surface") surfaces.push(parseSurface(argv[++i] ?? ""));
    else if (arg === "--weight") {
      const [code, value] = parseWeight(argv[++i] ?? "");
      weights[code] = value;
    } else if (arg === "--config") config = argv[++i];
    else if (arg === "--root") root = argv[++i] ?? root;
    else if (arg === "--force") force = true;
    else die(`init-profile: unknown option ${arg}\n\n${USAGE}`);
  }

  let profile: QualityProfile;
  if (config !== undefined) {
    if (!existsSync(config)) die(`init-profile: no config at ${config}`);
    const loaded = readJson<QualityProfile>(config);
    if (!Array.isArray(loaded?.surfaces) || loaded.surfaces.length === 0) {
      die(`init-profile: ${config} declares no surfaces`);
    }
    profile = loaded;
  } else {
    if (surfaces.length === 0) die(`init-profile: at least one --surface is required\n\n${USAGE}`);
    const seen = new Set<string>();
    for (const surface of surfaces) {
      if (seen.has(surface.id)) die(`init-profile: duplicate surface id "${surface.id}"`);
      seen.add(surface.id);
    }
    profile = Object.keys(weights).length > 0 ? { surfaces, domain_weights: weights } : { surfaces };
  }

  const path = profilePath(root);
  if (existsSync(path) && !force) {
    die(
      `init-profile: ${path} already exists.\n` +
        `Changing the surface list invalidates every score recorded against the old one, so this refuses by default.\n` +
        `Pass --force if that is genuinely what you want.`,
    );
  }

  writeJson(path, profile);
  process.stdout.write(
    `wrote ${path}\n` +
      `${profile.surfaces.length} surface${profile.surfaces.length === 1 ? "" : "s"}: ` +
      `${profile.surfaces.map((s) => s.id).join(", ")}\n` +
      (profile.domain_weights && Object.keys(profile.domain_weights).length > 0
        ? `weights: ${Object.entries(profile.domain_weights).map(([k, v]) => `${k}=${v}`).join(" ")}\n`
        : `weights: 1 across every domain\n`),
  );
}

main();
