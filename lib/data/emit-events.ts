/**
 * App binding of the shared journal event derivation (issue #218). The
 * derivation itself lives in `@arkaik/schema` (`packages/schema/src/derive.ts`)
 * so every dual-writer — this app, the CLI, the MCP server — shares one
 * implementation; this module only stamps the app's actor. The *append* (the
 * `journals` store write) lives in `./db.ts`; the wiring into each mutation
 * lives in `./local-provider.ts`.
 */

import { toJournalEvents as deriveJournalEvents, type EventInput, type JournalEvent } from "@arkaik/schema";

export {
  diffNodeUpdate,
  edgeAddedInput,
  edgeRemovedInput,
  nodeCreatedInput,
  nodeDeletedInput,
  type EventInput,
} from "@arkaik/schema";

/**
 * Stable actor stamped on every app-emitted event (the envelope's `actor`,
 * docs/spec/journal.md § Event Envelope) — the app's counterpart to the CLI's
 * `"arkaik-cli"` and the skill's `"claude-code"`.
 */
export const APP_ACTOR = "arkaik-app";

/** Stamp each {@link EventInput} into a validated {@link JournalEvent} with the app actor. */
export function toJournalEvents(inputs: readonly EventInput[]): JournalEvent[] {
  return deriveJournalEvents(inputs, APP_ACTOR);
}
