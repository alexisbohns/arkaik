import type { Node } from "@xyflow/react";
import type { Size } from "@/lib/utils/journey-layout";

/** Every flow and view card is this wide (`w-60`). */
export const CARD_WIDTH = 240;

// Chrome every card pays: py-3 (24) + border-2 (4) + the title row (28).
const CARD_CHROME_HEIGHT = 56;
const CARD_GAP = 12; // gap-3 between a card's stacked blocks

/**
 * The size a Journey card will render at, summed block by block from the same
 * `data` the component reads — an estimate the canvas replaces with the
 * measured size as soon as React Flow reports one, so a drift here costs one
 * frame, never an overlap. Keep the constants in step with `FlowNode` and
 * `ViewNode`.
 */
export function estimateJourneyCardSize(node: Pick<Node, "type" | "data">): Size {
  const data = node.data as Record<string, unknown>;

  switch (node.type) {
    case "flow": {
      if (data.renderVariant === "branch") {
        // A condition is an inline pill (117×34 measured for "Signed in?"); a
        // junction is a dashed summary card (224×145 measured).
        return data.branchKind === "condition" ? { width: 160, height: 36 } : { width: 224, height: 145 };
      }
      // rings (the default): one 30px ring row; bars: three h-2 gauges on
      // gap-2 rows. Both fallbacks match the components' own.
      const platformBlock = data.platformDisplay === "bars" ? 58 : 30;
      // py-3 (24) + border-2 (4) + the flow's taller title row (38) + gap-3.
      return { width: CARD_WIDTH, height: 24 + 4 + 38 + CARD_GAP + platformBlock };
    }
    case "view": {
      const display = data.display as Record<string, unknown> | undefined;
      const platforms = (data.platforms as string[] | undefined) ?? [];
      const screenshots = data.platformScreenshots as Record<string, string> | undefined;
      const hasScreenshot = screenshots != null && Object.values(screenshots).some(Boolean);
      const hasCover = typeof data.coverUrl === "string";
      const showsImage = display?.images !== false && (hasScreenshot || hasCover);
      const showsRows = display?.view_platforms === "rows" && platforms.length > 0;
      const showsChips = display?.view_platforms !== "rows" && platforms.length > 0;
      const hasApi =
        ((data.apiInbound as unknown[] | undefined)?.length ?? 0) > 0 ||
        ((data.apiOutbound as unknown[] | undefined)?.length ?? 0) > 0;

      let height = CARD_CHROME_HEIGHT;
      if (showsImage) height += CARD_GAP + 112; // h-28
      // Rows are text-xs (20) on space-y-2 (8).
      if (showsRows) height += CARD_GAP + platforms.length * 20 + (platforms.length - 1) * 8;
      // The footer only exists when it has something in it: API chips, platform chips, or both.
      if (hasApi || showsChips) height += CARD_GAP + 36;

      return { width: CARD_WIDTH, height };
    }
    default:
      return { width: 180, height: 100 };
  }
}
