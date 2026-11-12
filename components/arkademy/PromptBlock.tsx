import { ARKADEMY_SECTION_TITLE } from "@/components/arkademy/ArkademyChrome";
import { CopyButton } from "@/components/arkademy/CopyButton";
import { CodeBlock } from "@/components/landing/previews/CodeBlock";
import { promptForDisplay, promptLines } from "@/lib/arkademy/prompt";

interface PromptBlockProps {
  /** `tool.prompt.label`, the section's `h2`. */
  label: string;
  /** `tool.prompt.text`, PROMPT_TOKEN included. */
  text: string;
}

/**
 * The cover's baseline prompt section: its label as an `h2` beside a copy
 * button, then the text in the landing's mono block, a line per line,
 * wrapped, with the paragraph's place shown as `[your paragraph]`. The button
 * copies exactly what is shown.
 */
export function PromptBlock({ label, text }: PromptBlockProps) {
  return (
    <section aria-labelledby="prompt-title" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="prompt-title" className={ARKADEMY_SECTION_TITLE}>
          {label}
        </h2>
        <CopyButton text={promptForDisplay(text)} label="Copy the prompt" what="the prompt" />
      </div>
      <CodeBlock lines={promptLines(text).map((line) => ({ text: line }))} wrap className="mt-4 bg-card" />
    </section>
  );
}
