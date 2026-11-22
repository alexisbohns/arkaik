import { ANSWER_TYPE_IDS, type AnswerTypeId } from "@arkaik/schema";

/**
 * The six answer types as the interface says them: a label, and one line that
 * tells them apart (docs/rfcs/stake-architecture.md § 3). An option's answer
 * type is read from the kind of stake it addresses and never stored.
 */
const ANSWER_TYPE_COPY: Record<AnswerTypeId, { label: string; hint: string }> = {
  fix: { label: "Fix", hint: "Makes a bug work the way it was expected to." },
  enhancement: { label: "Enhancement", hint: "Smooths a friction in something that already works." },
  feature: { label: "Feature", hint: "Gives people a value they expect, want or would enjoy." },
  diligence: { label: "Diligence", hint: "Meets a requirement from outside." },
  mitigation: { label: "Mitigation", hint: "Lowers a risk that cannot be removed." },
  resolution: { label: "Resolution", hint: "Closes a flaw of our own making." },
};

export const ANSWER_TYPES = ANSWER_TYPE_IDS.map((id) => ({
  id,
  label: ANSWER_TYPE_COPY[id].label,
  hint: ANSWER_TYPE_COPY[id].hint,
}));

export const ANSWER_TYPE_LABELS: Record<AnswerTypeId, string> = Object.fromEntries(
  ANSWER_TYPES.map((entry) => [entry.id, entry.label]),
) as Record<AnswerTypeId, string>;

export type { AnswerTypeId };
