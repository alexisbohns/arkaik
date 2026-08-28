/**
 * The project-local criteria overlay — `docs/quality/criteria.custom.json`.
 *
 * The pack is written for a product *class*. When this product has a quality
 * concern the pack does not name, it goes here instead, layered over the pack
 * at load. **A pack upgrade rewrites the pack and never touches this file**,
 * which is the entire reason the two are separate.
 *
 * Building a criterion and adding it to the overlay live here rather than in
 * either caller, because `scaffold-criterion.js` and `arkaik kritik criterion
 * add` must produce the *same file*. Two scaffolders emitting subtly different
 * criteria — one with an issue skeleton, one without; one enforcing five
 * anchors, one not — is exactly the drift that makes a matrix incomparable
 * across the audits that used each.
 *
 * Throws rather than exiting: the caller frames the failure (`die` for a
 * script, a usage message for the CLI, a `ToolError` for MCP).
 */

import { loadOverlay, overlayPath, writeJson } from "./kritik-paths";
import type { KritikCriterion, KritikLibrary, KritikOverlay } from "../quality";

/** Every maturity level needs an observable description; there is no partial set. */
export const ANCHOR_KEYS = ["l0", "l1", "l2", "l3", "l4"] as const;

/** A criterion as a caller describes it, before it becomes a {@link KritikCriterion}. */
export interface CriterionDraft {
  id: string;
  domain: string;
  subcategory?: string;
  name: string;
  question: string;
  definition?: string;
  rationale?: string;
  appliesTo: string[];
  /** `l0`…`l4`; all five required. */
  anchors: Record<string, string>;
  /** Weight in the domain roll-up, 1–3 (default 1). */
  weight?: number;
  /** Seeds finding severity, 1–5 (default 3). */
  impact?: number;
  signals?: string[];
  checklist?: string[];
  remediation?: string;
  /** Issue labels (default `["quality"]`). */
  labels?: string[];
}

/** The scaffolding starting point `--template` prints. */
export const CRITERION_TEMPLATE: KritikCriterion = {
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

/**
 * Turn a draft into a criterion, or refuse.
 *
 * All five anchors are required: a criterion without observable descriptions of
 * each level cannot be scored consistently, and an inconsistently scored
 * criterion makes its whole row incomparable — which is the one thing a matrix
 * exists to provide.
 *
 * The issue skeleton is generated rather than asked for. Every pack criterion
 * ships one, so a custom criterion without one would be the only kind that
 * cannot be filed, and "the custom criterion behaves exactly like a pack
 * criterion" is the acceptance condition this whole overlay exists to meet.
 */
export function buildCriterion(draft: CriterionDraft): KritikCriterion {
  for (const [label, value] of [
    ["id", draft.id],
    ["domain", draft.domain],
    ["name", draft.name],
    ["question", draft.question],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`--${label} is required`);
  }
  if (draft.appliesTo.length === 0) throw new Error(`--applies-to is required — a criterion applies to at least one surface`);

  const missing = ANCHOR_KEYS.filter((key) => !draft.anchors[key]);
  if (missing.length > 0) {
    throw new Error(
      `missing anchors ${missing.join(", ")}.\n` +
        `All five are required: a criterion without observable descriptions of each level cannot be scored consistently,\n` +
        `and an inconsistently scored criterion makes its whole row incomparable.`,
    );
  }

  const weight = draft.weight ?? 1;
  if (!Number.isInteger(weight) || weight < 1 || weight > 3) throw new Error(`--weight must be 1, 2 or 3`);
  const impact = draft.impact ?? 3;
  if (!Number.isInteger(impact) || impact < 1 || impact > 5) throw new Error(`--impact must be 1-5`);

  const { id, name } = draft;
  return {
    id,
    domain: draft.domain,
    ...(draft.subcategory ? { subcategory: draft.subcategory } : {}),
    name,
    question: draft.question,
    ...(draft.definition ? { definition: draft.definition } : {}),
    ...(draft.rationale ? { rationale: draft.rationale } : {}),
    applies_to: draft.appliesTo,
    level_anchors: draft.anchors,
    default_impact: impact,
    weight,
    references: [],
    checklist: draft.checklist ?? [],
    signals: draft.signals ?? [],
    ...(draft.remediation ? { remediation: draft.remediation } : {}),
    issue: {
      title_template: `[Quality] ${id} ${name} at level {observed_level} on {surface} (target {target_level})`,
      labels: draft.labels && draft.labels.length > 0 ? draft.labels : ["quality"],
      body_skeleton:
        `## Quality finding: ${id} ${name}\n\n` +
        `**Surface:** {surface}\n**Observed level:** {observed_level}\n**Target level:** {target_level}\n` +
        `**Severity seed:** impact {impact} x likelihood {likelihood}\n\n` +
        `### Evidence\n{evidence_bullets_with_file_paths}\n\n` +
        `### Risk\n{risk_narrative}\n\n` +
        `### Remediation\n- [ ] {remediation_step_1}\n\n` +
        `### Acceptance criteria\n- [ ] Target anchor holds: {target_anchor_text}`,
    },
  };
}

/** What {@link addCriterionToOverlay} did, so the caller can report it. */
export interface OverlayWrite {
  path: string;
  overlay: KritikOverlay;
  /** True when the criterion replaced one already in the overlay. */
  replaced: boolean;
  /** The domain this write had to declare, when the criterion introduced one. */
  addedDomain?: string;
}

/**
 * Write a criterion into the project's overlay, guarding the two ways this goes
 * wrong quietly.
 *
 * **Shadowing a pack id** silently changes what a score recorded last audit
 * means — allowed, because "merged over" is the contract, but never by
 * accident. **A criterion in a domain nobody declared** rolls up into a row
 * with no name, so a new domain code must arrive with a display name.
 */
export function addCriterionToOverlay(
  root: string,
  pack: KritikLibrary,
  criterion: KritikCriterion,
  options: { force?: boolean; domainName?: string } = {},
): OverlayWrite {
  if (typeof criterion.id !== "string" || criterion.id === "") throw new Error(`the criterion has no id`);

  if ((pack.criteria ?? []).some((c) => c.id === criterion.id) && !options.force) {
    throw new Error(
      `"${criterion.id}" is already a pack criterion.\n` +
        `Overriding it changes what every score recorded against that id means.\n` +
        `Use a project-reserved id (X-01, X-02, …) instead, or pass --force if the override is deliberate.`,
    );
  }

  const path = overlayPath(root);
  const overlay: KritikOverlay = loadOverlay(root) ?? { extends: pack.version, criteria: [] };
  overlay.criteria = Array.isArray(overlay.criteria) ? overlay.criteria : [];

  const at = overlay.criteria.findIndex((c) => c?.id === criterion.id);
  if (at >= 0 && !options.force) {
    throw new Error(`"${criterion.id}" is already in the overlay — pass --force to replace it`);
  }
  if (at >= 0) overlay.criteria[at] = criterion;
  else overlay.criteria.push(criterion);

  const domainCode = criterion.domain;
  const knownDomain =
    (pack.domains ?? []).some((d) => d.code === domainCode) ||
    (overlay.domains ?? []).some((d) => d.code === domainCode);
  let addedDomain: string | undefined;
  if (!knownDomain) {
    if (!options.domainName) {
      throw new Error(
        `"${domainCode}" is not a pack domain and the overlay does not define it.\n` +
          `Pass --domain-name "<display name>" to define it, or use an existing domain code.`,
      );
    }
    overlay.domains = [...(overlay.domains ?? []), { code: domainCode, name: options.domainName }];
    addedDomain = domainCode;
  }

  writeJson(path, overlay);
  return { path, overlay, replaced: at >= 0, ...(addedDomain !== undefined ? { addedDomain } : {}) };
}
