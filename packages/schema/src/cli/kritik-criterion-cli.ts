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
import { mergeKritikLibrary, type KritikCriterion } from "../quality";
import { renderIssue } from "../quality-ops";
import { die, loadOverlay, loadPack, readJson } from "./kritik-paths";
import { CRITERION_TEMPLATE, addCriterionToOverlay, buildCriterion, type CriterionDraft } from "./kritik-overlay";

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

/**
 * Print a criterion's prefilled issue skeleton.
 *
 * The filling itself is `renderIssue` in quality-ops.ts, shared verbatim with
 * `arkaik kritik issue` and the `kritik_issue` MCP tool — a skeleton that came
 * out differently depending on which entry point emitted it would be a
 * different issue, not a formatting detail.
 */
function emitIssue(root: string, scriptDir: string, criterionId: string, surface: string, level: string): void {
  const library = mergeKritikLibrary(loadPack(scriptDir, root), loadOverlay(root));
  const criterion = (library.criteria ?? []).find((c) => c.id === criterionId);
  if (!criterion) {
    die(
      `scaffold-criterion: no criterion "${criterionId}" in the pack or the overlay.\n` +
        `Known ids start with: ${(library.criteria ?? []).slice(0, 6).map((c) => c.id).join(", ")}…`,
    );
  }
  const rendered = renderIssue(criterion, { surface, level });
  process.stdout.write(`Title: ${rendered.title}\n`);
  process.stdout.write(`Labels: ${rendered.labels.join(", ")}\n\n`);
  process.stdout.write(`${rendered.body}\n`);
  if (rendered.remediation) process.stdout.write(`\n<!-- Typical remediation: ${rendered.remediation} -->\n`);
}

/**
 * Map this script's flag bags onto a {@link CriterionDraft}. The criterion
 * itself is built by `kritik-overlay.ts`, shared with `arkaik kritik criterion
 * add` — the flags are this entry point's business; the shape is not.
 */
function draftFrom(single: Record<string, string>, many: Record<string, string[]>): CriterionDraft {
  const anchors: Record<string, string> = {};
  for (const spec of many.anchor) {
    const at = spec.indexOf("=");
    if (at <= 0) die(`scaffold-criterion: --anchor wants lN=<text> (got "${spec}")`);
    anchors[spec.slice(0, at).trim()] = spec.slice(at + 1);
  }
  return {
    id: single.id ?? "",
    domain: single.domain ?? "",
    ...(single.subcategory ? { subcategory: single.subcategory } : {}),
    name: single.name ?? "",
    question: single.question ?? "",
    ...(single.definition ? { definition: single.definition } : {}),
    ...(single.rationale ? { rationale: single.rationale } : {}),
    appliesTo: (single["applies-to"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    anchors,
    ...(single.weight ? { weight: Number(single.weight) } : {}),
    ...(single.impact ? { impact: Number(single.impact) } : {}),
    signals: many.signal,
    checklist: many.check,
    ...(single.remediation ? { remediation: single.remediation } : {}),
    labels: many.label,
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
    process.stdout.write(`${JSON.stringify(CRITERION_TEMPLATE, null, 2)}\n`);
    return;
  }

  const root = single.root ?? process.cwd();

  if (single["emit-issue"]) {
    if (!single.surface) die(`scaffold-criterion: --emit-issue needs --surface`);
    emitIssue(root, scriptDir, single["emit-issue"], single.surface, single.level ?? "");
    return;
  }

  let criterion: KritikCriterion;
  try {
    criterion = single.from
      ? (() => {
          if (!existsSync(single.from)) die(`scaffold-criterion: no file at ${single.from}`);
          return readJson<KritikCriterion>(single.from);
        })()
      : buildCriterion(draftFrom(single, many));
  } catch (error) {
    return die(`scaffold-criterion: ${(error as Error).message}`);
  }

  const pack = loadPack(scriptDir, root);
  let written: ReturnType<typeof addCriterionToOverlay>;
  try {
    written = addCriterionToOverlay(root, pack, criterion, {
      force: flags.has("force"),
      ...(single["domain-name"] ? { domainName: single["domain-name"] } : {}),
    });
  } catch (error) {
    return die(`scaffold-criterion: ${(error as Error).message}`);
  }

  process.stdout.write(
    `wrote ${written.path}\n` +
      `${criterion.id} (${criterion.domain}) — applies to ${(criterion.applies_to ?? []).join(", ") || "every surface"}\n` +
      `issue skeleton: node scaffold-criterion.js --emit-issue ${criterion.id} --surface <surface>\n`,
  );
}

main();
