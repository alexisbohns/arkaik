import { SELF_MAP_DEFINITION } from "@/components/landing/previews/definitions";
import { JourneyPreviewCanvas } from "@/components/landing/previews/client/JourneyPreviewCanvas";
import type { PreviewProps } from "@/components/landing/previews/types";

/**
 * One deep flow of Arkaik's own journey with every sub-flow expanded — the
 * product's anatomy several levels down, as the built-in self-map draws it.
 * The bundle arrives sliced to the flow's closure (lib/landing/prepare.ts),
 * so "every flow in the bundle" is exactly the closure's flows.
 */
export function SelfMapJourneyPreview({ bundle }: PreviewProps) {
  const expanded = bundle.nodes.filter((node) => node.species === "flow").map((node) => node.id);
  return <JourneyPreviewCanvas bundle={bundle} definition={SELF_MAP_DEFINITION} expandedFlowIds={expanded} />;
}
