/**
 * The weighing section's validator rules — warnings only, never import-blocking.
 *
 * Same leniency doctrine as the Kritik block in {@link ./validate}: a weighing
 * section is written by scorers and edited by hand between them, so a set the
 * project retired, a cell scored on an acceptance since deleted, a level a
 * scorer got wrong — all of them are ordinary states of a living section, and
 * none may fail an import or a CI gate. Every projection already degrades to a
 * blank cell.
 *
 * Kept in its own zod-free module so `validate.ts` (which the standalone
 * validator bundles) grows by a call, not by a hundred lines.
 */

import {
  BUILT_IN_MATRICES,
  BUILT_IN_SETS,
  POSITIONING_SET_ID,
  isOlderMajorRef,
  isWeighingMatrixShape,
  isWeighingSetShape,
  resolveWeighing,
  setOfRef,
  weighingScaleOf,
} from "./weighing-library";
import {
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_SET_SAVED,
  SCORER_KINDS,
  STORED_SCORER_KINDS,
  assessmentKey,
  WEIGHING_PROBABILITY_FIELDS,
  isWeighingAssessmentShape,
  isWeighingProbability,
  majorOf,
  splitSetRef,
  stakeSpeciesDeclaredBy,
  type WeighingSection,
} from "./weighing";
import { STAKE_SPECIES_IDS, type StakeSpeciesId } from "./stake";

export interface WeighingFinding {
  path: string;
  rule: string;
  message: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Check a `weighing` section against the graph it sits in.
 *
 * @param nodeSpecies node id → species, for the "subject is an acceptance" check.
 * @param stakeSpecies stake id → stake kind, for the "the set scores this kind of stake" check.
 * @param journal the bundle's embedded journal, for the actor check on `weighing.*` events.
 */
export function validateWeighingSection(
  section: unknown,
  nodeSpecies: ReadonlyMap<string, string>,
  journal: readonly unknown[],
  /** stake id → its `metadata.stake_species`, for the "the set scores this kind of stake" check. A stake absent from it has no kind. */
  stakeSpecies: ReadonlyMap<string, string | undefined> = new Map(),
): WeighingFinding[] {
  const out: WeighingFinding[] = [];
  const warn = (path: string, rule: string, message: string) => out.push({ path, rule, message });

  if (section !== undefined && section !== null && !isObject(section)) {
    warn("weighing", "weighing-section-shape", "The weighing section is not an object — it is ignored");
  }

  if (isObject(section)) {
    for (const list of ["sets", "matrices", "assessments"] as const) {
      if (section[list] !== undefined && !Array.isArray(section[list])) {
        warn(`weighing.${list}`, "weighing-section-shape", `weighing.${list} is not an array — it is ignored`);
      }
    }
    const sets = Array.isArray(section.sets) ? section.sets : [];
    const matrices = Array.isArray(section.matrices) ? section.matrices : [];
    const assessments = Array.isArray(section.assessments) ? section.assessments : [];
    const resolved = resolveWeighing(section as Partial<WeighingSection>);

    /**
     * Resolve a set ref, and say why when it does not: the set is not in the
     * library at all, or it is but at another major (levels are comparable only
     * within a major). Warns once, at `path`, and returns the set or undefined.
     */
    const resolveRef = (ref: string, path: string, who: string, unknownRule: string) => {
      const set = setOfRef(resolved, ref);
      if (set !== undefined) return set;
      const named = resolved.sets.find((candidate) => candidate.id === splitSetRef(ref).id);
      if (named !== undefined) {
        warn(path, "weighing-set-ref-major", `${who} names ${ref}, but "${named.id}" is at ${named.version} — levels are comparable only within a major, so the ref resolves to nothing`);
      } else {
        warn(path, unknownRule, `${who} names set "${ref}", which is neither built in nor in this section`);
      }
      return undefined;
    };
    // The ids a matrix points its positioning at — the one id a positioning set may carry.
    const positioningIds = new Set(
      resolved.matrices.map((matrix) => matrix.positioning).filter((id): id is string => typeof id === "string"),
    );
    const checkStatus = (path: string, who: string, entry: Record<string, unknown>) => {
      if (entry.status !== undefined && entry.status !== "draft" && entry.status !== "active") {
        warn(`${path}.status`, "weighing-set-status", `${who}: status ${JSON.stringify(entry.status)} is not "draft" or "active" — it is read as a draft, which feeds no roll-up`);
      }
    };
    const isLevelMap = (value: unknown) => isObject(value) && Object.values(value).every((anchor) => typeof anchor === "string");

    // Pinned built-ins are library content: a project cannot redefine them.
    // Only shape-valid entries are counted for "the first wins", because only
    // those can win: a malformed earlier entry never shadows a good later one.
    const seenSets = new Set<string>();
    sets.forEach((entry, index) => {
      const path = `weighing.sets[${index}]`;
      if (!isObject(entry)) {
        warn(path, "weighing-set-shape", "A set is not an object — it is ignored");
        return;
      }
      const who = `Set "${String(entry.id)}"`;
      const wellFormed = isWeighingSetShape(entry);
      if (!wellFormed) {
        warn(path, "weighing-set-shape", `${who} needs a string id and version, a criteria array and a scale object (a positioning may leave the scale out) — it is ignored`);
      }
      if (typeof entry.id === "string") {
        if (BUILT_IN_SETS.some((set) => set.id === entry.id)) {
          warn(`${path}.id`, "weighing-pinned-set-redefined", `${who} is built in and pinned by version — the project's copy is ignored`);
        } else if (wellFormed) {
          if (seenSets.has(entry.id)) warn(`${path}.id`, "weighing-duplicate-set", `Duplicate set id "${entry.id}" — the first well-formed one wins, this one is ignored`);
          seenSets.add(entry.id);
        }
      }
      checkStatus(path, who, entry);

      if (entry.stake_species !== undefined) {
        const declared = entry.stake_species;
        if (!Array.isArray(declared) || !declared.every((kind) => (STAKE_SPECIES_IDS as readonly unknown[]).includes(kind))) {
          warn(`${path}.stake_species`, "weighing-set-stake-species", `${who}: stake_species must be an array of ${STAKE_SPECIES_IDS.join(", ")} — what it does not name, it does not score`);
        }
      }

      if (isObject(entry.scale)) {
        const scale = entry.scale;
        if (typeof scale.min !== "number" || typeof scale.max !== "number" || !isLevelMap(scale.anchors)) {
          warn(`${path}.scale`, "weighing-scale-shape", `${who}: a scale needs a numeric min and max and an anchors object of strings`);
        }
      }
      if (Array.isArray(entry.criteria)) {
        entry.criteria.forEach((criterion, at) => {
          const cpath = `${path}.criteria[${at}]`;
          if (!isObject(criterion) || typeof criterion.id !== "string" || (criterion.anchors !== undefined && !isLevelMap(criterion.anchors))) {
            warn(cpath, "weighing-criterion-shape", `${who}: criterion ${at} needs a string id, and its anchors (if any) must be an object of strings`);
          }
        });
      }

      // A positioning is found by its id (docs/rfcs/weighing.md § 9): slice 1 fixes it
      // at the id the matrices point to, so a renamed one would silently never apply.
      if (entry.role === "positioning" && !(typeof entry.id === "string" && positioningIds.has(entry.id))) {
        warn(`${path}.id`, "weighing-positioning-id", `A positioning set must have the id "${POSITIONING_SET_ID}" (the one a matrix points at) — "${String(entry.id)}" would never be applied`);
      } else if (entry.role !== "positioning" && entry.id === POSITIONING_SET_ID) {
        warn(`${path}.role`, "weighing-positioning-id", `Set "${POSITIONING_SET_ID}" is where a matrix looks for its positioning, but its role is ${JSON.stringify(entry.role)}, not "positioning" — it would never be applied`);
      }

      if (entry.role === "positioning") {
        const ruler =
          typeof entry.extends === "string"
            ? resolveRef(entry.extends, `${path}.extends`, `Positioning "${String(entry.id)}"`, "weighing-positioning-unknown-ruler")
            : undefined;
        if (typeof entry.extends !== "string") {
          warn(`${path}.extends`, "weighing-positioning-unknown-ruler", `Positioning "${String(entry.id)}" does not say which set it re-weights — set extends to e.g. value-contribution@2`);
        } else if (ruler !== undefined && ruler.role === "positioning") {
          warn(`${path}.extends`, "weighing-positioning-unknown-ruler", `Positioning "${String(entry.id)}" extends "${entry.extends}", which is itself a positioning — it must extend a criteria set such as value-contribution@2`);
        } else if (ruler !== undefined && isOlderMajorRef(resolved, entry.extends)) {
          // Its weights still apply (elements keep their ids across majors), but its words were written for the old ruler.
          warn(`${path}.extends`, "weighing-positioning-old-ruler", `Positioning "${String(entry.id)}" extends ${entry.extends}, an older ruler — its weights still apply, but read its level descriptions against ${ruler.id}'s current major and save it again`);
        }
        const known = new Set(ruler !== undefined && ruler.role !== "positioning" ? ruler.criteria.map((criterion) => criterion?.id) : []);
        (Array.isArray(entry.criteria) ? entry.criteria : []).forEach((criterion, at) => {
          if (!isObject(criterion)) return;
          const cpath = `${path}.criteria[${at}]`;
          if (known.size > 0 && typeof criterion.id === "string" && !known.has(criterion.id)) {
            warn(`${cpath}.id`, "weighing-positioning-unknown-element", `Positioning names "${criterion.id}", which is not in ${String(entry.extends)}`);
          }
          if (criterion.weight !== undefined && (typeof criterion.weight !== "number" || !(criterion.weight > 0))) {
            warn(`${cpath}.weight`, "weighing-positioning-weight", `Positioning weight for "${String(criterion.id)}" must be a number above 0 — leave the element out to leave it unpositioned`);
          }
        });
      }
    });

    const seenMatrices = new Set<string>();
    matrices.forEach((entry, index) => {
      const path = `weighing.matrices[${index}]`;
      if (!isObject(entry)) {
        warn(path, "weighing-matrix-shape", "A matrix is not an object — it is ignored");
        return;
      }
      const who = `Matrix "${String(entry.id)}"`;
      const wellFormed = isWeighingMatrixShape(entry);
      if (!wellFormed) {
        warn(path, "weighing-matrix-shape", `${who} needs a string id, a set ref and a subjects object of kind query or list — it is ignored`);
      }
      if (typeof entry.id === "string") {
        if (BUILT_IN_MATRICES.some((matrix) => matrix.id === entry.id)) {
          warn(`${path}.id`, "weighing-pinned-matrix-redefined", `${who} is built in — the project's copy is ignored`);
        } else if (wellFormed) {
          if (seenMatrices.has(entry.id)) warn(`${path}.id`, "weighing-duplicate-matrix", `Duplicate matrix id "${entry.id}" — the first well-formed one wins, this one is ignored`);
          seenMatrices.add(entry.id);
        }
      }
      checkStatus(path, who, entry);
      if (wellFormed && resolveRef(entry.set, `${path}.set`, who, "weighing-unknown-set") !== undefined && isOlderMajorRef(resolved, entry.set)) {
        warn(`${path}.set`, "weighing-matrix-old-ruler", `${who} reads ${entry.set}, an older ruler — its levels still read, but nothing new can be scored on it; point it at the current major`);
      }
    });

    const seenCells = new Set<string>();
    assessments.forEach((entry, index) => {
      const path = `weighing.assessments[${index}]`;
      const label = `Assessment ${index}`;
      if (!isWeighingAssessmentShape(entry)) {
        warn(path, "weighing-assessment-shape", `${label}: not an object with a string matrix, subject and criterion — it cannot be addressed, so every reader skips it`);
        return;
      }
      if (typeof entry.ts !== "string" || Number.isNaN(Date.parse(entry.ts))) {
        warn(`${path}.ts`, "weighing-assessment-ts", `${label}: ts must be an ISO 8601 string — without it "latest wins" cannot order this row`);
      }
      const matrix = resolved.matrices.find((candidate) => candidate.id === entry.matrix);
      if (matrix === undefined) {
        warn(`${path}.matrix`, "weighing-unknown-matrix", `${label}: matrix "${entry.matrix}" is not defined`);
      }
      // A matrix whose ref resolves to nothing was already warned about once, at the matrix.
      const set = matrix === undefined ? undefined : setOfRef(resolved, matrix.set);
      const criterion = set?.criteria.find((candidate) => candidate?.id === entry.criterion);
      if (set !== undefined && criterion === undefined) {
        warn(`${path}.criterion`, "weighing-unknown-criterion", `${label}: criterion "${entry.criterion}" is not in set "${set.id}"`);
      }
      if (criterion !== undefined && typeof criterion.superseded_by === "string" && criterion.superseded_by !== "") {
        warn(`${path}.criterion`, "weighing-retired-criterion", `${label}: criterion "${criterion.id}" is retired — superseded by "${criterion.superseded_by}"`);
      }
      const scale = set === undefined ? undefined : weighingScaleOf(set, resolved);
      const min = typeof scale?.min === "number" ? scale.min : -3;
      const max = typeof scale?.max === "number" ? scale.max : 3;
      if (typeof entry.level !== "number" || !Number.isInteger(entry.level) || entry.level < min || entry.level > max) {
        warn(`${path}.level`, "weighing-level-range", `${label}: level must be an integer ${min}..${max} (a blank cell is the absence of the row; 0 means weighed and unrelated)`);
      }
      if (![0, 1, 2, 3].includes(entry.confidence as number)) {
        warn(`${path}.confidence`, "weighing-confidence-range", `${label}: confidence must be 0, 1, 2 or 3`);
      }
      const scorer = isObject(entry.scorer) ? entry.scorer : undefined;
      if (scorer === undefined || typeof scorer.kind !== "string" || typeof scorer.id !== "string" || scorer.id === "") {
        warn(`${path}.scorer`, "weighing-scorer-missing", `${label}: no scorer with a string kind and id — human, agent and rule levels become indistinguishable, and the row can win no cell`);
      } else if (!(SCORER_KINDS as readonly string[]).includes(scorer.kind)) {
        warn(`${path}.scorer.kind`, "weighing-scorer-kind", `${label}: scorer kind "${scorer.kind}" is not one of ${SCORER_KINDS.join(", ")} — it ranks below every other scorer`);
      } else if (!(STORED_SCORER_KINDS as readonly string[]).includes(scorer.kind)) {
        warn(`${path}.scorer.kind`, "weighing-rule-stored", `${label}: scorer kind "${scorer.kind}" is never stored — a seeding rule is computed on read`);
      }
      if (matrix?.subjects.kind === "query") {
        const species = nodeSpecies.get(entry.subject);
        if (species === undefined) {
          warn(`${path}.subject`, "weighing-unknown-subject", `${label}: subject "${entry.subject}" is not a node in this bundle`);
        } else if (species !== matrix.subjects.species) {
          warn(`${path}.subject`, "weighing-subject-species", `${label}: subject "${entry.subject}" is a ${species}, and matrix "${matrix.id}" judges ${String(matrix.subjects.species)} nodes`);
        } else if (species === "stake" && set !== undefined) {
          // The reference declares what it scores: a stake of a kind the set does not declare (a requirement,
          // a risk, a defect) is read against Kritik, never weighed here.
          const kind = stakeSpecies.get(entry.subject);
          if (kind === undefined || !stakeSpeciesDeclaredBy(set).includes(kind as StakeSpeciesId)) {
            warn(
              `${path}.subject`,
              "weighing-subject-stake-species",
              `${label}: stake "${entry.subject}" is ${kind === undefined ? "of no stake kind" : `a ${kind}`}, and set "${set.id}" does not declare it scores that — a requirement, risk or defect is read against Kritik criteria, never weighed`,
            );
          }
        }
      }
      if (entry.evidence !== undefined && typeof entry.evidence !== "string") {
        warn(`${path}.evidence`, "weighing-evidence-type", `${label}: evidence must be a markdown string`);
      } else if ((entry.confidence === 2 || entry.confidence === 3) && (entry.evidence === undefined || entry.evidence.trim() === "")) {
        warn(`${path}.evidence`, "weighing-no-evidence", `${label}: confidence ${String(entry.confidence)} claims evidence and cites none`);
      }
      for (const field of WEIGHING_PROBABILITY_FIELDS) {
        if (entry[field] !== undefined && !isWeighingProbability(entry[field])) {
          warn(`${path}.${field}`, "weighing-probability-shape", `${label}: ${field} must be a number from 0 to 1 — it is ignored`);
        }
      }
      if (entry.refs !== undefined && !(Array.isArray(entry.refs) && entry.refs.every((ref) => typeof ref === "string"))) {
        warn(`${path}.refs`, "weighing-refs-type", `${label}: refs must be an array of id strings`);
      }
      if (
        entry.basis !== undefined &&
        !(isObject(entry.basis) && ["fingerprint", "commit", "set_version"].every((key) => (entry.basis as Record<string, unknown>)[key] === undefined || typeof (entry.basis as Record<string, unknown>)[key] === "string"))
      ) {
        warn(`${path}.basis`, "weighing-basis-shape", `${label}: basis must be an object whose fingerprint, commit and set_version are strings`);
      }
      if (scorer !== undefined && typeof scorer.kind === "string") {
        const key = assessmentKey(entry);
        if (seenCells.has(key)) {
          warn(path, "weighing-duplicate-assessment", `${label}: a second ${scorer.kind} score for the same cell — the section stores latest-per-scorer-kind, so this cell is ambiguous`);
        }
        seenCells.add(key);
      }
      const setVersion = isObject(entry.basis) && typeof entry.basis.set_version === "string" ? entry.basis.set_version : undefined;
      if (set !== undefined && setVersion !== undefined && majorOf(setVersion) !== majorOf(set.version)) {
        warn(`${path}.basis.set_version`, "weighing-set-major", `${label}: scored against ${set.id} ${setVersion}, and the set is now ${set.version} — levels are comparable only within a major`);
      }
    });
  }

  journal.forEach((entry, index) => {
    if (!isObject(entry)) return;
    const type = typeof entry.type === "string" ? entry.type : "";
    if (type !== WEIGHING_ASSESSMENT_RECORDED && type !== WEIGHING_SET_SAVED) return;
    if (typeof entry.actor !== "string" || entry.actor.trim() === "") {
      warn(`journal[${index}].actor`, "weighing-event-no-actor", `Journal event ${index}: ${type} has no actor — human, agent and CI scores become indistinguishable`);
    }
  });

  return out;
}
