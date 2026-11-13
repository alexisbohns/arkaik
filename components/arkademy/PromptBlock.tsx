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
 *
 * Drawn on M3's inverse surface (the cover's m3-expressive.css): an
 * emphasized headline, a medium copy button in the inverse primary, and the
 * text on a well a step lighter than the panel.
 */
export function PromptBlock({ label, text }: PromptBlockProps) {
  return (
    <section aria-labelledby="prompt-title" className="mx-inverse min-w-0 p-5 sm:p-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="prompt-title" className="mx-headline-l text-balance">
          {label}
        </h2>
        <CopyButton text={promptForDisplay(text)} label="Copy the prompt" what="the prompt" className="mx-btn mx-btn--m mx-btn--inverse" />
      </div>
      <CodeBlock lines={promptLines(text).map((line) => ({ text: line }))} wrap className="mx-code mt-6 sm:mt-8" />
    </section>
  );
}
