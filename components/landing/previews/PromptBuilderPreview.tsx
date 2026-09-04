import { CodeBlock } from "@/components/landing/previews/CodeBlock";
import { ReadOnlyUseCasePicker } from "@/components/landing/previews/client/ReadOnlyUseCasePicker";
import type { PreviewProps } from "@/components/landing/previews/types";
import { assemblePrompt } from "@/lib/prompts/assemble";
import type { UseCase } from "@/lib/prompts/types";

const SELECTED: UseCase = "from-pitch";
/** How much of the assembled prompt the frame shows before it fades. */
const EXCERPT_LINES = 16;

/**
 * The generate page's use-case picker with one case selected, and the head of
 * the prompt `assemblePrompt` really builds for it. The pitch is the Pebbles
 * project's own description; nothing here is marketing copy.
 */
export function PromptBuilderPreview({ bundle }: PreviewProps) {
  const prompt = assemblePrompt({
    useCase: SELECTED,
    projectTitle: bundle.project.title,
    projectDescription: bundle.project.description,
    platforms: ["ios", "web", "android"],
    defaultStatus: "idea",
    pitch: bundle.project.description ?? bundle.project.title,
    depth: "detailed",
    includeSchema: false,
    includeExample: false,
  });
  const lines = prompt.split("\n").slice(0, EXCERPT_LINES).map((text) => ({ text }));
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      <ReadOnlyUseCasePicker selected={SELECTED} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <CodeBlock title="prompt" lines={lines} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
      </div>
    </div>
  );
}
