/**
 * A drift guard, not a runtime test: `packages/mcp` cannot import `lib/` (the
 * Next.js app), so `packages/mcp/src/store.ts`'s `HostedQualityInput` and
 * `QualityEventRefusal` are hand-maintained structural copies of
 * `lib/services/graph/quality-events.ts`'s `QualityEventInput` and
 * `QualityEventRefusal` (issue #473). Nothing enforces that copy stays exact
 * except this file: if the two unions diverge, `tsc` fails right here with
 * TS2322 rather than the drift silently making a hosted MCP tool accept (or
 * refuse) a shape the server disagrees with.
 *
 * Checked by `npx tsc --noEmit -p .` (root tsconfig — `include` is
 * `**\/*.ts` with no exclusion for `tests/`) and, transitively, by CI's
 * "Build" step (`npm run build`, i.e. `next build`), which runs a full
 * type-check over the same tsconfig and fails the build on any error here —
 * confirmed by deliberately breaking this file and watching `next build`
 * report it before restoring.
 *
 * `Equal` is invariant both ways (`[A] extends [B]` AND `[B] extends [A]`,
 * each wrapped in a tuple to defeat distributive conditional types over a
 * union) — a one-directional `extends` would let the client union be
 * SUPERSET of the server's and still pass, which is exactly the kind of
 * drift (an extra member the server would 400 on) this exists to catch.
 */
import type { QualityEventInput, QualityEventRefusal as ServerRefusal } from "@/lib/services/graph/quality-events";
import type { HostedQualityInput, QualityEventRefusal as ClientRefusal } from "../../packages/mcp/src/store";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const inputs: Equal<QualityEventInput, HostedQualityInput> = true;
export const refusals: Equal<ServerRefusal, ClientRefusal> = true;
