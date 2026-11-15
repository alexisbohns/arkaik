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
  resolveWeighing,
  setOfRef,
} from "./weighing-library";
import {
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_SET_SAVED,
  assessmentKey,
  majorOf,
  STORED_SCORER_KINDS,
  type WeighingSection,
} from "./weighing";

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
 * @param journal the bundle's embedded journal, for the actor check on `weighing.*` events.
 */
export function validateWeighingSection(
  section: unknown,
  nodeSpecies: ReadonlyMap<string, string>,
  journal: readonly unknown[],
): WeighingFinding[] {
  const out: WeighingFinding[] = [];
  const warn = (path: string, rule: string, message: string) => out.push({ path, rule, message });

  if (isObject(section)) {
    const sets = Array.isArray(section.sets) ? section.sets : [];
    const matrices = Array.isArray(section.matrices) ? section.matrices : [];
    const assessments = Array.isArray(section.assessments) ? section.assessments : [];
    const resolved = resolveWeighing(section as Partial<WeighingSection>);

    // Pinned built-ins are library content: a project cannot redefine them.
    const seenSets = new Set<string>();
    sets.forEach((entry, index) => {
      if (!isObject(entry) || typeof entry.id !== "string") return;
      const path = `weighing.sets[${index}]`;
      if (BUILT_IN_SETS.some((set) => set.id === entry.id)) {
        warn(`${path}.id`, "weighing-pinned-set-redefined", `Set "${entry.id}" is built in and pinned by version — the project's copy is ignored`);
      } else if (seenSets.has(entry.id)) {
        warn(`${path}.id`, "weighing-duplicate-set", `Duplicate set id "${entry.id}" — the first wins`);
      }
      seenSets.add(entry.id);

      if (entry.role === "positioning") {
        const ruler = typeof entry.extends === "string" ? setOfRef(resolved, entry.extends) : undefined;
        const known = new Set((ruler?.criteria ?? []).map((criterion) => criterion.id));
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
      if (!isObject(entry) || typeof entry.id !== "string") return;
      const path = `weighing.matrices[${index}]`;
      if (BUILT_IN_MATRICES.some((matrix) => matrix.id === entry.id)) {
        warn(`${path}.id`, "weighing-pinned-matrix-redefined", `Matrix "${entry.id}" is built in — the project's copy is ignored`);
      } else if (seenMatrices.has(entry.id)) {
        warn(`${path}.id`, "weighing-duplicate-matrix", `Duplicate matrix id "${entry.id}" — the first wins`);
      }
      seenMatrices.add(entry.id);
      if (typeof entry.set === "string" && setOfRef(resolved, entry.set) === undefined) {
        warn(`${path}.set`, "weighing-unknown-set", `Matrix "${entry.id}" names set "${entry.set}", which is neither built in nor in this section`);
      }
    });

    const seenCells = new Set<string>();
    assessments.forEach((entry, index) => {
      if (!isObject(entry)) return;
      const path = `weighing.assessments[${index}]`;
      const label = `Assessment ${index}`;
      const matrix = resolved.matrices.find((candidate) => candidate.id === entry.matrix);
      if (matrix === undefined) {
        warn(`${path}.matrix`, "weighing-unknown-matrix", `${label}: matrix "${String(entry.matrix)}" is not defined`);
      }
      const set = matrix === undefined ? undefined : setOfRef(resolved, matrix.set);
      const criterion = set?.criteria.find((candidate) => candidate.id === entry.criterion);
      if (set !== undefined && criterion === undefined) {
        warn(`${path}.criterion`, "weighing-unknown-criterion", `${label}: criterion "${String(entry.criterion)}" is not in set "${set.id}"`);
      }
      if (criterion !== undefined && typeof criterion.superseded_by === "string" && criterion.superseded_by !== "") {
        warn(`${path}.criterion`, "weighing-retired-criterion", `${label}: criterion "${criterion.id}" is retired — superseded by "${criterion.superseded_by}"`);
      }
      const min = set?.scale.min ?? -3;
      const max = set?.scale.max ?? 3;
      if (typeof entry.level !== "number" || !Number.isInteger(entry.level) || entry.level < min || entry.level > max) {
        warn(`${path}.level`, "weighing-level-range", `${label}: level must be an integer ${min}..${max} (a blank cell is the absence of the row; 0 means weighed and unrelated)`);
      }
      if (![0, 1, 2, 3].includes(entry.confidence as number)) {
        warn(`${path}.confidence`, "weighing-confidence-range", `${label}: confidence must be 0, 1, 2 or 3`);
      }
      const scorer = isObject(entry.scorer) ? entry.scorer : undefined;
      if (scorer === undefined || typeof scorer.kind !== "string" || typeof scorer.id !== "string" || scorer.id === "") {
        warn(`${path}.scorer`, "weighing-scorer-missing", `${label}: no scorer — human, agent and rule levels become indistinguishable`);
      } else if (!(STORED_SCORER_KINDS as readonly string[]).includes(scorer.kind)) {
        warn(`${path}.scorer.kind`, "weighing-rule-stored", `${label}: scorer kind "${scorer.kind}" is never stored — a seeding rule is computed on read`);
      }
      if (matrix?.subjects.kind === "query" && typeof entry.subject === "string") {
        const species = nodeSpecies.get(entry.subject);
        if (species === undefined) {
          warn(`${path}.subject`, "weighing-unknown-subject", `${label}: subject "${entry.subject}" is not a node in this bundle`);
        } else if (species !== matrix.subjects.species) {
          warn(`${path}.subject`, "weighing-subject-species", `${label}: subject "${entry.subject}" is a ${species}, and matrix "${matrix.id}" judges ${matrix.subjects.species} nodes`);
        }
      }
      if ((entry.confidence === 2 || entry.confidence === 3) && (typeof entry.evidence !== "string" || entry.evidence.trim() === "")) {
        warn(`${path}.evidence`, "weighing-no-evidence", `${label}: confidence ${String(entry.confidence)} claims evidence and cites none`);
      }
      if (typeof entry.matrix === "string" && typeof entry.subject === "string" && typeof entry.criterion === "string" && scorer !== undefined && typeof scorer.kind === "string") {
        const key = assessmentKey({ matrix: entry.matrix, subject: entry.subject, criterion: entry.criterion, scorer: { kind: scorer.kind as "human", id: "" } });
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
