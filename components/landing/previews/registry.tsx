import type { ComponentType } from "react";
import type { PreviewId } from "@/components/landing/previews/ids";
import type { PreviewProps } from "@/components/landing/previews/types";
import { AcceptanceMatrixPreview } from "./AcceptanceMatrixPreview";
import { AgentSkillDiffPreview } from "./AgentSkillDiffPreview";
import { DecisionChainPreview } from "./DecisionChainPreview";
import { DeliveryBoardPreview } from "./DeliveryBoardPreview";
import { FindingsBoardPreview } from "./FindingsBoardPreview";
import { JournalChangelogPreview } from "./JournalChangelogPreview";
import { JourneyMapPreview } from "./JourneyMapPreview";
import { OverviewCardsPreview } from "./OverviewCardsPreview";
import { PlatformStatusesPreview } from "./PlatformStatusesPreview";
import { QualityMatrixPreview } from "./QualityMatrixPreview";
import { SystemMapPreview } from "./SystemMapPreview";
import { ValuePyramidPreview } from "./ValuePyramidPreview";

/**
 * Id → component. `Record<PreviewId, …>` is the coverage gate: an id added to
 * the catalogue without a component here is a type error, not an empty frame.
 */
export const PREVIEW_REGISTRY: Record<PreviewId, ComponentType<PreviewProps>> = {
  "journey-map": JourneyMapPreview,
  "system-map": SystemMapPreview,
  "delivery-board": DeliveryBoardPreview,
  "overview-cards": OverviewCardsPreview,
  "platform-statuses": PlatformStatusesPreview,
  "acceptance-matrix": AcceptanceMatrixPreview,
  "value-pyramid": ValuePyramidPreview,
  "decision-chain": DecisionChainPreview,
  "journal-changelog": JournalChangelogPreview,
  "quality-matrix": QualityMatrixPreview,
  "findings-board": FindingsBoardPreview,
  "agent-skill-diff": AgentSkillDiffPreview,
};
