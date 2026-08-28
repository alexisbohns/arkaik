/**
 * The Quality page's projections.
 *
 * Everything here reads `bundle.quality` and a resolved Kritik library and
 * returns plain data. Not one scale is reimplemented: severity, priority,
 * grades and the comparative matrix all come from `@arkaik/schema`, which is
 * where the CLI and MCP read them too. A second implementation of `severityOf`
 * living in the app would be a second answer to "how bad is this", and the two
 * would drift the first time a pack moved a bucket.
 *
 * These live app-side rather than in the schema package for the reason
 * `coverage.ts`, `delivery.ts` and `pyramid.ts` do: they are page shapes with
 * one consumer. `deriveQualityMatrix` is in the schema package because
 * `arkaik kritik matrix` and `kritik_matrix` both call it.
 */

import {
  isOpenFinding,
  priorityOf,
  severityOf,
  type FindingPriority,
  type FindingSeverity,
  type FindingStatus,
  type KritikCriterion,
  type KritikDomain,
  type KritikLibrary,
  type QualityFinding,
  type QualitySection,
  type RemediationCost,
} from "@arkaik/schema";

/** A finding with everything the board renders, resolved once. */
export interface FindingRow {
  id: string;
  criterionId: string;
  /** The criterion's name from the pack, falling back to its id. */
  criterionName: string;
  /** Owning domain code, `""` when the pack does not define the criterion. */
  domain: string;
  domainName: string;
  surface: string;
  title: string;
  detail: string;
  evidence: string;
  impact: number;
  likelihood: number;
  /** `impact x likelihood` — the number the severity bucket is read from. */
  risk: number;
  cost: RemediationCost;
  severity: FindingSeverity;
  priority: FindingPriority;
  status: FindingStatus;
  open: boolean;
  /** Always an array; a finding with no links is `[]`, never `undefined`. */
  nodeIds: string[];
  issueUrl?: string;
  /**
   * Carried through as the schema declares it rather than restated: the verdict
   * is a closed set the refutation pass owns, and a widened copy here would let
   * the board render a verdict the pack never issues.
   */
  verification?: QualityFinding["verification"];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** `criterion id -> criterion`, built once per projection pass. */
function criteriaById(library?: KritikLibrary): Map<string, KritikCriterion> {
  const index = new Map<string, KritikCriterion>();
  for (const criterion of asArray<KritikCriterion>(library?.criteria)) {
    if (typeof criterion?.id === "string") index.set(criterion.id, criterion);
  }
  return index;
}

/** `domain code -> display name`, falling back to the code itself. */
function domainNames(library?: KritikLibrary): Map<string, string> {
  const index = new Map<string, string>();
  for (const domain of asArray<KritikDomain>(library?.domains)) {
    if (typeof domain?.code === "string") index.set(domain.code, domain.name ?? domain.code);
  }
  return index;
}

/**
 * Every finding, denormalized.
 *
 * The single place a finding is flattened. The board, the node index and the
 * criterion panel all consume this rather than walking `section.findings`
 * again, so severity is computed once per finding and the three surfaces
 * cannot disagree about what a finding is.
 *
 * A finding whose `criterion_id` the pack does not define gets `domain: ""`.
 * That is deliberate and matches `deriveQualityMatrix`, which drops it from
 * every cell: nobody wrote a weight for it, so it cannot be scored into a
 * domain. It is still a row, because a finding the UI cannot place is still a
 * finding somebody has to act on — dropping it here would make it invisible.
 */
export function buildFindingRows(
  section: Pick<QualitySection, "findings"> | undefined,
  library?: KritikLibrary,
): FindingRow[] {
  const criteria = criteriaById(library);
  const names = domainNames(library);

  return asArray<QualityFinding>(section?.findings).map((finding) => {
    const criterion = criteria.get(finding.criterion_id);
    const domain = typeof criterion?.domain === "string" ? criterion.domain : "";
    const impact = typeof finding.impact === "number" ? finding.impact : 0;
    const likelihood = typeof finding.likelihood === "number" ? finding.likelihood : 0;

    return {
      id: finding.id,
      criterionId: finding.criterion_id,
      criterionName: (criterion?.name as string | undefined) ?? finding.criterion_id,
      domain,
      domainName: names.get(domain) ?? domain,
      surface: finding.surface,
      title: finding.title,
      detail: finding.detail,
      evidence: finding.evidence,
      impact,
      likelihood,
      risk: impact * likelihood,
      cost: finding.cost,
      severity: severityOf(finding, library),
      priority: priorityOf(finding, library),
      status: finding.status ?? "open",
      open: isOpenFinding(finding),
      nodeIds: asArray<string>(finding.node_ids),
      issueUrl: finding.issue_url,
      verification: finding.verification,
    };
  });
}
