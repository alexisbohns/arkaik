import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";

export type UseCase = "from-pitch" | "from-plan" | "extend-map";

export type Depth = "overview" | "detailed" | "comprehensive";

export type SourceType = "mermaid" | "screen-list" | "flowchart" | "spec" | "other";

export type TargetLlm = "claude" | "chatgpt" | "gemini" | "any";

export interface PromptConfig {
  useCase: UseCase;
  projectTitle: string;
  projectDescription?: string;
  platforms: PlatformId[];
  defaultStatus: StatusId;

  // UC1: From Pitch
  pitch?: string;
  depth?: Depth;
  focusAreas?: string;

  // UC2: From Structured Plan
  sourceType?: SourceType;
  sourceMaterial?: string;
  additionalContext?: string;

  // UC3: Extend Existing Map
  existingBundle?: string;
  extensionDescription?: string;
  connectionPoint?: string;
  updatePlaylists?: boolean;

  // Advanced
  includeSchema?: boolean;
  includeExample?: boolean;
  targetLlm?: TargetLlm;
  customInstructions?: string;
}

export const USE_CASES = [
  {
    id: "from-pitch" as const,
    label: "Start from a pitch",
    description: "Describe your product idea and let the LLM imagine the full architecture",
    icon: "Lightbulb",
  },
  {
    id: "from-plan" as const,
    label: "Convert an existing plan",
    description: "Paste a Mermaid diagram, screen list, or specification to translate",
    icon: "FileText",
  },
  {
    id: "extend-map" as const,
    label: "Extend an existing map",
    description: "Add new features to an existing Arkaik project",
    icon: "GitBranch",
  },
] as const;

export const DEPTH_OPTIONS = [
  { id: "overview" as const, label: "High-level overview" },
  { id: "detailed" as const, label: "Detailed with sub-flows" },
  { id: "comprehensive" as const, label: "Comprehensive (all layers)" },
] as const;

export const SOURCE_TYPE_OPTIONS = [
  { id: "mermaid" as const, label: "Mermaid diagram" },
  { id: "screen-list" as const, label: "Screen / page list" },
  { id: "flowchart" as const, label: "Flowchart" },
  { id: "spec" as const, label: "Specification document" },
  { id: "other" as const, label: "Other" },
] as const;

export const TARGET_LLM_OPTIONS = [
  { id: "any" as const, label: "Any LLM" },
  { id: "claude" as const, label: "Claude" },
  { id: "chatgpt" as const, label: "ChatGPT" },
  { id: "gemini" as const, label: "Gemini" },
] as const;
