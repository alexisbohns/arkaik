/**
 * Entry point for the standalone `scaffold-criterion.js` build artifact — the
 * custom-criterion scaffolder (RFC § 6, capability 2).
 *
 * The pack is written for a product *class*. When this product has a quality
 * concern the pack does not name — a house convention that actually matters, a
 * regulation specific to one market, a domain rule — it goes in the project's
 * own overlay at `docs/quality/criteria.custom.json`, layered over the pack at
 * load. **A pack upgrade rewrites the pack and never touches the overlay**,
 * which is the entire reason the two are separate files.
 *
 * Two modes, because two different callers need this:
 *   - `--emit-issue <id> --surface <s>` prints a criterion's prefilled issue
 *     skeleton (pack or custom — the overlay is merged first, so custom
 *     criteria get an issue skeleton exactly like pack ones).
 *   - everything else scaffolds a criterion into the overlay.
 *
 * Usage:
 *   node scaffold-criterion.js --id X-01 --domain SEC --name "..." --question "..." \
 *        --applies-to web,ios --anchor l0="..." ... [--weight 2] [--impact 4]
 *   node scaffold-criterion.js --emit-issue SEC-01 --surface web
 *   node scaffold-criterion.js --template > my-criterion.json
 *   node scaffold-criterion.js --from my-criterion.json
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  mergeKritikLibrary,
  type KritikCriterion,
  type KritikOverlay,
} from "../quality";
import { die, loadOverlay, loadPack, overlayPath, readJson, writeJson } from "./kritik-paths";

const ANCHOR_KEYS = ["l0", "l1", "l2", "l3", "l4"] as const;

const USAGE = `scaffold-criterion.js — add a project-specific Kritik criterion, or print an issue skeleton

Usage:
  node scaffold-criterion.js --id <ID> --domain <CODE> --name <text> --question <text> \\
       --applies-to <s1,s2> --anchor l0=<text> --anchor l1=<text> ... [options]
  node scaffold-criterion.js --from <criterion.json>
  node scaffold-criterion.js --template
  node scaffold-criterion.js --emit-issue <CRITERION-ID> --surface <surface> [--level <n>]

Scaffolding options:
  --id           project-reserved namespace, e.g. X-01 (never a pack id)
  --domain       owning domain code — an existing one (SEC, PRV, …) or your own
  --domain-name  display name, required only when --domain is a new code
  --name         short criterion name
  --question     the criterion as one auditable question
  --definition   what good looks like
  --rationale    why it matters for this product
  --applies-to   comma-separated surface ids
  --anchor       lN=<text>, five times (l0..l4) — what each level looks like HERE
  --weight       1-3, weight in the domain roll-up (default 1)
  --impact       1-5, seeds finding severity (default 3)
  --signal       a mechanically checkable hook; repeatable
  --check        a concrete audit step; repeatable
  --remediation  the typical fix path
  --label        an issue label; repeatable (default: quality)
  --root         repo root (default: the current directory)
  --force        replace an existing criterion with this id

Writes docs/quality/criteria.custom.json`;

const TEMPLATE: KritikCriterion = {
  id: "X-01",
  domain: "ARC",
  subcategory: "conventions",
  name: "Short criterion name",
  question: "The criterion as one question an auditor can actually answer?",
  definition: "What good looks like on this surface, concretely.",
  rationale: "Why this matters for this product in particular.",
  applies_to: ["web"],
  level_anchors: {
    l0: "Not addressed at all.",
    l1: "Addressed accidentally or in one spot; no visible intent.",
    l2: "Deliberately addressed; visible intent; known gaps.",
    l3: "Systematic across the surface; tested or reviewed.",
    l4: "Enforced by automation or a CI gate; drift is detected, not hoped against.",
  },
  default_impact: 3,
  weight: 1,
  references: [],
  checklist: ["The grep, file, or flow an auditor should actually run."],
  signals: ["A check that can run between audits and fail mechanically."],
  remediation: "The typical fix path.",
  issue: {
    title_template: "[Quality] X-01 <name> at level {observed_level} on {surface} (target {target_level})",
    labels: ["quality"],
    body_skeleton:
      "## Quality finding: X-01 <name>\n\n**Surface:** {surface}\n**Observed level:** {observed_level}\n**Target level:** {target_level}\n\n### Evidence\n{evidence_bullets_with_file_paths}\n\n### Remediation\n- [ ] {remediation_step_1}\n\n### Acceptance criteria\n- [ ] Target anchor holds: {target_anchor_text}",
  },
};

function collect(argv: string[]) {
  const single: Record<string, string> = {};
  const many: Record<string, string[]> = { signal: [], check: [], label: [], anchor: [] };
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) die(`scaffold-criterion: unexpected argument "${arg}"\n\n${USAGE}`);
    const key = arg.slice(2);
    if (key === "template" || key === "force" || key === "help") {
      flags.add(key);
      continue;
    }
    const value = argv[++i];
    if (value === undefined) die(`scaffold-criterion: --${key} needs a value`);
    if (key in many) many[key].push(value);
    else single[key] = value;
  }
  return { single, many, flags };
}

/** Fill `{placeholder}` tokens we actually know; leave the rest for the author. */
function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

function emitIssue(root: string, scriptDir: string, criterionId: string, surface: string, level: string): void {
  const library = mergeKritikLibrary(loadPack(scriptDir), loadOverlay(root));
  const criterion = (library.criteria ?? []).find((c) => c.id === criterionId);
  if (!criterion) {
    die(
      `scaffold-criterion: no criterion "${criterionId}" in the pack or the overlay.\n` +
        `Known ids start with: ${(library.criteria ?? []).slice(0, 6).map((c) => c.id).join(", ")}…`,
    );
  }
  const anchors = criterion.level_anchors ?? {};
  const observed = level === "" ? "{observed_level}" : level;
  const target = level === "" ? "{target_level}" : String(Math.min(Number(level) + 1, 4));
  const values: Record<string, string> = {
    surface,
    observed_level: observed,
    target_level: target,
    observed_level_name: anchors[`l${observed}`] ?? "{observed_level_name}",
    target_anchor_text: anchors[`l${target}`] ?? "{target_anchor_text}",
    impact: String(criterion.default_impact ?? 3),
  };
  const issue = criterion.issue ?? {};
  const title = fillTemplate(issue.title_template ?? `[Quality] ${criterion.id} on {surface}`, values);
  const labels = [...(issue.labels ?? ["quality"]), surface];
  process.stdout.write(`Title: ${title}\n`);
  process.stdout.write(`Labels: ${labels.join(", ")}\n\n`);
  process.stdout.write(`${fillTemplate(issue.body_skeleton ?? "", values)}\n`);
  if (criterion.remediation) process.stdout.write(`\n<!-- Typical remediation: ${criterion.remediation} -->\n`);
}

function buildCriterion(single: Record<string, string>, many: Record<string, string[]>): KritikCriterion {
  const required = ["id", "domain", "name", "question", "applies-to"];
  for (const key of required) {
    if (!single[key]) die(`scaffold-criterion: --${key} is required\n\n${USAGE}`);
  }
  const id = single.id;
  const anchors: Record<string, string> = {};
  for (const spec of many.anchor) {
    const at = spec.indexOf("=");
    if (at <= 0) die(`scaffold-criterion: --anchor wants lN=<text> (got "${spec}")`);
    anchors[spec.slice(0, at).trim()] = spec.slice(at + 1);
  }
  const missing = ANCHOR_KEYS.filter((key) => !anchors[key]);
  if (missing.length > 0) {
    die(
      `scaffold-criterion: missing anchors ${missing.join(", ")}.\n` +
        `All five are required: a criterion without observable descriptions of each level cannot be scored consistently,\n` +
        `and an inconsistently scored criterion makes its whole row incomparable.`,
    );
  }
  const weight = single.weight ? Number(single.weight) : 1;
  if (!Number.isInteger(weight) || weight < 1 || weight > 3) die(`scaffold-criterion: --weight must be 1, 2 or 3`);
  const impact = single.impact ? Number(single.impact) : 3;
  if (!Number.isInteger(impact) || impact < 1 || impact > 5) die(`scaffold-criterion: --impact must be 1-5`);

  const labels = many.label.length > 0 ? many.label : ["quality"];
  return {
    id,
    domain: single.domain,
    ...(single.subcategory ? { subcategory: single.subcategory } : {}),
    name: single.name,
    question: single.question,
    ...(single.definition ? { definition: single.definition } : {}),
    ...(single.rationale ? { rationale: single.rationale } : {}),
    applies_to: single["applies-to"].split(",").map((s) => s.trim()).filter(Boolean),
    level_anchors: anchors,
    default_impact: impact,
    weight,
    references: [],
    checklist: many.check,
    signals: many.signal,
    ...(single.remediation ? { remediation: single.remediation } : {}),
    issue: {
      title_template: `[Quality] ${id} ${single.name} at level {observed_level} on {surface} (target {target_level})`,
      labels,
      body_skeleton:
        `## Quality finding: ${id} ${single.name}\n\n` +
        `**Surface:** {surface}\n**Observed level:** {observed_level}\n**Target level:** {target_level}\n` +
        `**Severity seed:** impact {impact} x likelihood {likelihood}\n\n` +
        `### Evidence\n{evidence_bullets_with_file_paths}\n\n` +
        `### Risk\n{risk_narrative}\n\n` +
        `### Remediation\n- [ ] {remediation_step_1}\n\n` +
        `### Acceptance criteria\n- [ ] Target anchor holds: {target_anchor_text}`,
    },
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const scriptDir = dirname(resolve(process.argv[1] ?? "."));
  const { single, many, flags } = collect(argv);

  if (flags.has("help") || argv.length === 0) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(argv.length === 0 ? 1 : 0);
  }
  if (flags.has("template")) {
    process.stdout.write(`${JSON.stringify(TEMPLATE, null, 2)}\n`);
    return;
  }

  const root = single.root ?? process.cwd();

  if (single["emit-issue"]) {
    if (!single.surface) die(`scaffold-criterion: --emit-issue needs --surface`);
    emitIssue(root, scriptDir, single["emit-issue"], single.surface, single.level ?? "");
    return;
  }

  const criterion = single.from
    ? (() => {
        if (!existsSync(single.from)) die(`scaffold-criterion: no file at ${single.from}`);
        return readJson<KritikCriterion>(single.from);
      })()
    : buildCriterion(single, many);

  if (typeof criterion.id !== "string" || criterion.id === "") die(`scaffold-criterion: the criterion has no id`);

  // A custom criterion that shadows a pack id silently changes what a score
  // recorded last audit means. Allowed, because "merged over" is the contract —
  // but never by accident.
  const pack = loadPack(scriptDir);
  if ((pack.criteria ?? []).some((c) => c.id === criterion.id) && !flags.has("force")) {
    die(
      `scaffold-criterion: "${criterion.id}" is already a pack criterion.\n` +
        `Overriding it changes what every score recorded against that id means.\n` +
        `Use a project-reserved id (X-01, X-02, …) instead, or pass --force if the override is deliberate.`,
    );
  }

  const path = overlayPath(root);
  const overlay: KritikOverlay = loadOverlay(root) ?? { extends: pack.version, criteria: [] };
  overlay.criteria = Array.isArray(overlay.criteria) ? overlay.criteria : [];

  const at = overlay.criteria.findIndex((c) => c?.id === criterion.id);
  if (at >= 0 && !flags.has("force")) {
    die(`scaffold-criterion: "${criterion.id}" is already in the overlay — pass --force to replace it`);
  }
  if (at >= 0) overlay.criteria[at] = criterion;
  else overlay.criteria.push(criterion);

  // A criterion in a domain nobody declared would roll up into a row with no
  // name. Add the domain when the author named one.
  const domainCode = criterion.domain;
  const knownDomain =
    (pack.domains ?? []).some((d) => d.code === domainCode) ||
    (overlay.domains ?? []).some((d) => d.code === domainCode);
  if (!knownDomain) {
    const domainName = single["domain-name"];
    if (!domainName) {
      die(
        `scaffold-criterion: "${domainCode}" is not a pack domain and the overlay does not define it.\n` +
          `Pass --domain-name "<display name>" to define it, or use an existing domain code.`,
      );
    }
    overlay.domains = [...(overlay.domains ?? []), { code: domainCode, name: domainName }];
  }

  writeJson(path, overlay);
  process.stdout.write(
    `wrote ${path}\n` +
      `${criterion.id} (${criterion.domain}) — applies to ${(criterion.applies_to ?? []).join(", ") || "every surface"}\n` +
      `issue skeleton: node scaffold-criterion.js --emit-issue ${criterion.id} --surface <surface>\n`,
  );
}

main();
