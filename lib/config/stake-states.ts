import { STAKE_STATES, type StakeStateId } from "@arkaik/schema";

/**
 * The six derived states of a stake as the interface says them: a label, and
 * one line that tells them apart (docs/rfcs/stake-architecture.md § 8). They are
 * read off the graph by `deriveStakeProof` and never stored.
 */
const STAKE_STATE_COPY: Record<StakeStateId, { label: string; hint: string }> = {
  raised: { label: "Raised", hint: "A signal was qualified into a stake. Nothing addresses it yet." },
  considered: { label: "Considered", hint: "It has been evaluated, or an option or a candidate addresses it." },
  promised: { label: "Promised", hint: "A decision chose an answer and it has a definition of done." },
  "verified-not-delivered": { label: "Verified, not delivered", hint: "The definition of done passes, and the delivery it needs is still missing." },
  "partly-addressed": { label: "Partly addressed", hint: "The proof holds on some platforms, not on every one the answer concerns." },
  addressed: { label: "Addressed", hint: "Every half the kind needs holds on every platform concerned." },
};

export const STAKE_STATE_LABELS: Record<StakeStateId, string> = Object.fromEntries(
  STAKE_STATES.map((id) => [id, STAKE_STATE_COPY[id].label]),
) as Record<StakeStateId, string>;

export const STAKE_STATE_HINTS: Record<StakeStateId, string> = Object.fromEntries(
  STAKE_STATES.map((id) => [id, STAKE_STATE_COPY[id].hint]),
) as Record<StakeStateId, string>;
