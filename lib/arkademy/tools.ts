import { BMC_TOOL_ID } from "./constants";
import type { ArkademyDocument, ToolId } from "./schema";

/** The Arkademy's own pages. Every tool has a folder of its own under it. */
export const ARKADEMY_PATH = "/arkademy";

/** The cover of each tool the app has pages for. A tool without a path gets no card. */
export const ARKADEMY_TOOL_PATHS: Record<ToolId, string> = {
  [BMC_TOOL_ID]: "/arkademy/business-model-canvas",
};

/** Where a visitor answers the Business Model Canvas for their own product (part 4). */
export const BMC_YOURS_PATH = `${ARKADEMY_TOOL_PATHS[BMC_TOOL_ID]}/yours`;

/** An example's tour, without a step (part 3's `tourHref` adds `?step=`). */
export function bmcTourPath(companyId: string): string {
  return `${ARKADEMY_TOOL_PATHS[BMC_TOOL_ID]}/tour/${encodeURIComponent(companyId)}`;
}

export interface ArkademyToolCard {
  id: ToolId;
  href: string;
  title: string;
  tagline: string;
  exampleCount: number;
}

/** The shell's cards: every tool in the document that has pages, in document order. */
export function arkademyToolCards(document: ArkademyDocument): ArkademyToolCard[] {
  return document.tools
    .filter((tool) => Object.prototype.hasOwnProperty.call(ARKADEMY_TOOL_PATHS, tool.id))
    .map((tool) => ({
      id: tool.id,
      href: ARKADEMY_TOOL_PATHS[tool.id],
      title: tool.title,
      tagline: tool.tagline,
      exampleCount: tool.examples.length,
    }));
}
