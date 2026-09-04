import { JOURNEY_DEFINITION } from "@/components/landing/previews/definitions";
import { JourneyPreviewCanvas } from "@/components/landing/previews/client/JourneyPreviewCanvas";
import type { PreviewProps } from "@/components/landing/previews/types";

const EXPANDED = [JOURNEY_DEFINITION.root_node_id!];

/** One flow of Arkaik's own journey, expanded. The bundle arrives sliced to its closure. */
export function JourneyMapPreview({ bundle }: PreviewProps) {
  return <JourneyPreviewCanvas bundle={bundle} definition={JOURNEY_DEFINITION} expandedFlowIds={EXPANDED} />;
}
