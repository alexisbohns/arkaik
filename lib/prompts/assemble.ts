import type { PromptConfig } from "./types";
import {
  CONTEXT_BLOCK,
  SCHEMA_BLOCK,
  RULES_BLOCK,
  EXAMPLE_BLOCK,
  ROLE_FROM_PITCH,
  ROLE_FROM_PLAN,
  ROLE_EXTEND,
  TASK_FROM_PITCH,
  TASK_FROM_PLAN,
  TASK_EXTEND,
  OUTPUT_FORMAT,
  OUTPUT_FORMAT_CLAUDE,
} from "./blocks";

function getRoleBlock(config: PromptConfig): string {
  switch (config.useCase) {
    case "from-pitch":
      return ROLE_FROM_PITCH;
    case "from-plan":
      return ROLE_FROM_PLAN;
    case "extend-map":
      return ROLE_EXTEND;
  }
}

function getTaskBlock(config: PromptConfig): string {
  switch (config.useCase) {
    case "from-pitch":
      return TASK_FROM_PITCH;
    case "from-plan":
      return TASK_FROM_PLAN;
    case "extend-map":
      return TASK_EXTEND;
  }
}

function getOutputBlock(config: PromptConfig): string {
  if (config.targetLlm === "claude") return OUTPUT_FORMAT_CLAUDE;
  return OUTPUT_FORMAT;
}

function formatPlatforms(platforms: string[]): string {
  if (platforms.length === 0) return "web";
  if (platforms.length === 3) return "all (web, iOS, Android)";
  return platforms.join(", ");
}

function buildUserInputFromPitch(config: PromptConfig): string {
  const lines: string[] = ["## User Input\n"];
  lines.push(`**Product pitch:** ${config.pitch || "{{YOUR_PRODUCT_PITCH}}"}`);
  lines.push(`**Target platforms:** ${formatPlatforms(config.platforms)}`);
  lines.push(`**Default status for all nodes:** ${config.defaultStatus}`);

  const depthLabels = { overview: "High-level overview", detailed: "Detailed with sub-flows", comprehensive: "Comprehensive — all layers including data models and API endpoints" };
  lines.push(`**Desired depth:** ${depthLabels[config.depth || "detailed"]}`);

  if (config.focusAreas) {
    lines.push(`**Focus areas:** ${config.focusAreas}`);
  }

  if (config.projectTitle) {
    lines.push(`**Project title:** ${config.projectTitle}`);
  }
  if (config.projectDescription) {
    lines.push(`**Project description:** ${config.projectDescription}`);
  }

  return lines.join("\n");
}

function buildUserInputFromPlan(config: PromptConfig): string {
  const lines: string[] = ["## User Input\n"];
  lines.push(`**Project title:** ${config.projectTitle || "{{PROJECT_TITLE}}"}`);
  if (config.projectDescription) {
    lines.push(`**Project description:** ${config.projectDescription}`);
  }
  lines.push(`**Target platforms:** ${formatPlatforms(config.platforms)}`);
  lines.push(`**Default status for all nodes:** ${config.defaultStatus}`);

  const typeLabels: Record<string, string> = {
    mermaid: "Mermaid diagram",
    "screen-list": "Screen / page list",
    flowchart: "Flowchart",
    spec: "Specification document",
    other: "Other",
  };
  lines.push(`**Source material type:** ${typeLabels[config.sourceType || "other"]}`);
  lines.push(`\n**Source material:**\n\`\`\`\n${config.sourceMaterial || "{{PASTE_YOUR_SOURCE_MATERIAL_HERE}}"}\n\`\`\``);

  if (config.additionalContext) {
    lines.push(`\n**Additional context:** ${config.additionalContext}`);
  }

  return lines.join("\n");
}

function buildUserInputExtend(config: PromptConfig): string {
  const lines: string[] = ["## User Input\n"];
  lines.push(`**Target platforms for new nodes:** ${formatPlatforms(config.platforms)}`);
  lines.push(`**Status for new nodes:** ${config.defaultStatus}`);

  lines.push(`\n**Existing ProjectBundle:**\n\`\`\`json\n${config.existingBundle || "{{PASTE_YOUR_EXISTING_PROJECT_BUNDLE_JSON_HERE}}"}\n\`\`\``);
  lines.push(`\n**What to add:** ${config.extensionDescription || "{{DESCRIBE_WHAT_TO_ADD}}"}`);

  if (config.connectionPoint) {
    lines.push(`**Where to connect:** ${config.connectionPoint}`);
  }

  if (config.updatePlaylists !== false) {
    lines.push(`**Update existing playlists:** Yes — integrate new nodes into relevant existing flow playlists where appropriate.`);
  }

  return lines.join("\n");
}

function getUserInputBlock(config: PromptConfig): string {
  switch (config.useCase) {
    case "from-pitch":
      return buildUserInputFromPitch(config);
    case "from-plan":
      return buildUserInputFromPlan(config);
    case "extend-map":
      return buildUserInputExtend(config);
  }
}

export function assemblePrompt(config: PromptConfig): string {
  const sections: string[] = [];

  sections.push(getRoleBlock(config));
  sections.push(CONTEXT_BLOCK);

  if (config.includeSchema !== false) {
    sections.push(SCHEMA_BLOCK);
  }

  sections.push(RULES_BLOCK);

  if (config.includeExample !== false) {
    sections.push(EXAMPLE_BLOCK);
  }

  sections.push(getTaskBlock(config));
  sections.push(getUserInputBlock(config));

  if (config.customInstructions) {
    sections.push(`## Additional Instructions\n\n${config.customInstructions}`);
  }

  sections.push(getOutputBlock(config));

  return sections.join("\n\n---\n\n");
}

/** Rough token estimate: ~1.3 tokens per word for English text + JSON. */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.round(words * 1.3);
}
