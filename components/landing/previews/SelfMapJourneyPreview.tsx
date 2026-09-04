import { SELF_MAP_DEFINITION } from "@/components/landing/previews/definitions";
import { JourneyPreviewCanvas } from "@/components/landing/previews/client/JourneyPreviewCanvas";
import type { PreviewProps } from "@/components/landing/previews/types";

const COLLAPSED: readonly string[] = [];

/** Every top-level flow of Arkaik as a collapsed card — the whole product at a glance. */
export function SelfMapJourneyPreview({ bundle }: PreviewProps) {
  return <JourneyPreviewCanvas bundle={bundle} definition={SELF_MAP_DEFINITION} expandedFlowIds={COLLAPSED} />;
}
