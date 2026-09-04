import { MarkdownContent } from "@/components/docs/MarkdownContent";
import { gochiHand } from "@/lib/fonts";

interface DocsArticleProps {
  title: string;
  source: string;
}

/**
 * Strip the document's opening `# Heading`.
 *
 * The title is now chrome — rendered above, in the handwritten face — and the
 * markdown body still carries the same heading it always did, because that
 * heading is what `docs.ts` derives the title *from* and what the file looks
 * like on GitHub. Rendering both would print the page name twice.
 *
 * Only the *first* heading, and only when nothing but blank lines and
 * frontmatter-adjacent whitespace precede it: a `#` further down is a real
 * section of the prose and stays.
 */
function stripLeadingHeading(source: string): string {
  const match = source.match(/^\s*#\s+.*(?:\r?\n|$)/);
  return match ? source.slice(match[0].length).replace(/^\s*\n/, "") : source;
}

/**
 * A documentation page: its name in the handwritten face, then its prose.
 *
 * Shared by `/docs` and `/docs/[...slug]` so the two cannot drift — they render
 * the same document type and differ only in which one they looked up.
 */
export function DocsArticle({ title, source }: DocsArticleProps) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 md:px-8 md:pb-8">
      <h1
        className={`${gochiHand.className} mb-8 max-w-[70ch] text-[2.75rem] leading-[1.1] text-foreground md:text-[3.25rem]`}
      >
        {title}
      </h1>
      <MarkdownContent source={stripLeadingHeading(source)} />
    </main>
  );
}
