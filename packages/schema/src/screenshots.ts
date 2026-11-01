/**
 * Screenshots as events (docs/superpowers/specs/2026-11-01-screenshot-events-design.md).
 *
 * The one decision every writer shares. {@link decideScreenshot} is the
 * function `applyOps` (mutate.ts) and the hosted door's planner
 * (lib/services/graph/screenshots.ts) call to apply, skip or refuse a
 * `record_screenshot` op; the planner runs it over a read snapshot to report
 * skips and refusals to its caller before the ops run. Two callers, one rule —
 * the reason this is not inlined in either.
 *
 * Deliberately **zod-free** (type-only imports): `crossCheckJournal` reads the
 * reducers below, and `validate.ts` bundles that into the
 * standalone validator.
 *
 * ## The ingest rule (spec § 4)
 * - a `manual` shot is always accepted and becomes current;
 * - a `ci` shot is accepted only if its `order` is at least the slot's
 *   `ci_order` watermark — a re-run or a rebase arriving late is a
 *   `stale_order` skip, never a late overwrite;
 * - the same value again is an `unchanged` skip, so a re-run writes nothing.
 */

import type { Node } from "./bundle";
import type { PlatformId } from "./ids";
import type { JournalEvent, ScreenshotForm, ScreenshotSource } from "./journal";
// The only value import. Never call it at module load: journal.ts will import this module back (cycle), and the CommonJS test loader only tolerates that for calls made inside functions.
import { orderEvents } from "./journal";

/** The caller-supplied shape of a `record_screenshot` op, before any node is consulted. */
export interface ScreenshotInput {
  node_id: string;
  platform: PlatformId;
  source: ScreenshotSource;
  form: ScreenshotForm;
  /** The slot value: an `https://` URL, a relative path, or an image data URI — per `form`. */
  value: string;
  commit?: string;
  order?: number;
  detail?: string;
}

export type ScreenshotRefusalCode = "node_not_found" | "not_shot_bearing" | "platform_not_applicable" | "invalid_screenshot";
export type ScreenshotSkipReason = "stale_order" | "unchanged";

export type ScreenshotDecision =
  | { kind: "apply" }
  | { kind: "skip"; reason: ScreenshotSkipReason }
  | { kind: "refuse"; code: ScreenshotRefusalCode; message: string };

/** Species that carry screenshots: a view is what people see, an acceptance is one of its render variants. */
export const SHOT_BEARING_SPECIES: readonly string[] = ["view", "acceptance"];

const HTTPS = /^https:\/\/\S+$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const IMAGE_DATA_URI = /^data:image\/[a-z0-9.+-]+[;,]/i;

/**
 * Whether `value` is a well-formed slot value for `form` (docs/spec/bundle-format.md § Asset Values).
 * A path is resolved against the bundle's directory, so it may not climb out of it, and a Windows drive path reads as a scheme and is refused.
 */
export function isValidScreenshotValue(form: ScreenshotForm, value: string): boolean {
  if (value === "" || /[\u0000-\u001f\u007f]/.test(value)) return false;
  switch (form) {
    case "url":
      return HTTPS.test(value);
    case "path":
      return !value.startsWith("/") && !HAS_SCHEME.test(value) && !/(^|\/)\.\.(\/|$)/.test(value);
    case "data":
      return IMAGE_DATA_URI.test(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The shared loose reader of a slot's value and CI watermark; a hand-edited bundle cannot make it throw. */
export function readSlot(node: Node, platform: PlatformId): { value: string | undefined; ciOrder: number | undefined } {
  const md = isRecord(node.metadata) ? node.metadata : {};
  const shots = isRecord(md.platformScreenshots) ? md.platformScreenshots : {};
  const metas = isRecord(md.platformScreenshotMeta) ? md.platformScreenshotMeta : {};
  const meta = isRecord(metas[platform]) ? metas[platform] : {};
  const rawValue = shots[platform];
  const value = typeof rawValue === "string" ? rawValue : undefined;
  const rawOrder = meta.ci_order;
  const ciOrder = typeof rawOrder === "number" ? rawOrder : undefined;
  return { value, ciOrder };
}

/**
 * Decide one `record_screenshot` against the node it names. `node` is
 * `undefined` when the id matched nothing. Pure; never throws.
 */
export function decideScreenshot(node: Node | undefined, input: ScreenshotInput): ScreenshotDecision {
  if (!node) return { kind: "refuse", code: "node_not_found", message: `Node ${input.node_id} not found` };
  if (!SHOT_BEARING_SPECIES.includes(node.species)) {
    return { kind: "refuse", code: "not_shot_bearing", message: `${node.id} is a ${node.species}; only views and acceptances carry screenshots` };
  }
  if (!node.platforms.includes(input.platform)) {
    return {
      kind: "refuse",
      code: "platform_not_applicable",
      message: `${input.platform} is not a platform of ${node.id} (${node.platforms.length > 0 ? `lists: ${node.platforms.join(", ")}` : "lists none"})`,
    };
  }
  if (!isValidScreenshotValue(input.form, input.value)) {
    return { kind: "refuse", code: "invalid_screenshot", message: `value is not a well-formed ${input.form} screenshot` };
  }
  if (input.source === "ci" && (typeof input.order !== "number" || !Number.isInteger(input.order) || input.order < 0)) {
    return { kind: "refuse", code: "invalid_screenshot", message: "a ci screenshot needs a non-negative integer order" };
  }
  const slot = readSlot(node, input.platform);
  if (input.source === "ci" && slot.ciOrder !== undefined && typeof input.order === "number" && input.order < slot.ciOrder) {
    return { kind: "skip", reason: "stale_order" };
  }
  if (slot.value === input.value) return { kind: "skip", reason: "unchanged" };
  return { kind: "apply" };
}

// ---------------------------------------------------------------------------
// History reducers
// ---------------------------------------------------------------------------

/** Every `screenshot.*` event for one slot, in `(ts, id)` order. */
export function screenshotHistory(events: readonly JournalEvent[], nodeId: string, platform: PlatformId): JournalEvent[] {
  return orderEvents(
    events.filter(
      (ev) => (ev.type === "screenshot.recorded" || ev.type === "screenshot.removed") && ev.node_id === nodeId && ev.platform === platform,
    ),
  );
}

/**
 * The event that explains the slot's current value: the last
 * `screenshot.recorded` unless a `screenshot.removed` came after it, in which
 * case `null`. `undefined` when the journal says nothing about the slot (a
 * legacy shot written through `update_node`, or no shot at all).
 */
export function currentScreenshot(events: readonly JournalEvent[], nodeId: string, platform: PlatformId): JournalEvent | null | undefined {
  return reduceScreenshotSlots(orderEvents(events)).get(nodeId)?.get(platform);
}

/** Last screenshot event per (node, platform) over events already in (ts, id) order: the last `screenshot.recorded`, or `null` after a `screenshot.removed`. Slots the journal never mentions are absent. */
export function reduceScreenshotSlots(ordered: readonly JournalEvent[]): Map<string, Map<string, JournalEvent | null>> {
  const slots = new Map<string, Map<string, JournalEvent | null>>();
  for (const ev of ordered) {
    if (ev.type !== "screenshot.recorded" && ev.type !== "screenshot.removed") continue;
    if (typeof ev.node_id !== "string" || typeof ev.platform !== "string") continue;
    let byPlatform = slots.get(ev.node_id);
    if (!byPlatform) { byPlatform = new Map(); slots.set(ev.node_id, byPlatform); }
    byPlatform.set(ev.platform, ev.type === "screenshot.removed" ? null : ev);
  }
  return slots;
}
