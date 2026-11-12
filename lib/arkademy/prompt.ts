import { PROMPT_TOKEN } from "./schema";

/** What the cover shows, and the copy button copies, where the paragraph goes. */
export const PROMPT_PLACEHOLDER = "[your paragraph]";

/** The baseline prompt with `PROMPT_TOKEN` shown as `PROMPT_PLACEHOLDER`. */
export function promptForDisplay(text: string): string {
  return text.split(PROMPT_TOKEN).join(PROMPT_PLACEHOLDER);
}

/** `promptForDisplay`, one entry per line, for a block that draws lines. */
export function promptLines(text: string): string[] {
  return promptForDisplay(text).split(/\r?\n/);
}
