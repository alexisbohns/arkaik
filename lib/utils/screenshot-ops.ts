import type { MutationOp } from "@arkaik/schema";

/**
 * A screenshot write, as the op itself. The node panel hands it up unchanged
 * and a surface forwards it to `applyMutations`, so `decideScreenshot` decides
 * once and the journal gets its `screenshot.recorded` / `screenshot.removed`
 * event — the one thing a `platformScreenshots` patch through `update_node`
 * never did.
 *
 * Derived from the schema's `MutationOp` rather than spelled out, so a field
 * added to either op reaches the panel's type without a second edit. The panel
 * narrows two fields: it is always a person (`source: "manual"`) handing over
 * a URL or an image data URI (`form`), never CI and never a bundle path.
 */
export type ScreenshotPanelOp =
  | (Extract<MutationOp, { op: "record_screenshot" }> & { source: "manual"; form: "url" | "data" })
  | Extract<MutationOp, { op: "remove_screenshot" }>;
