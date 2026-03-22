import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarkdownContent } from "@/components/docs/MarkdownContent";
import { getDocBySlugParts } from "@/lib/utils/docs";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getDocBySlugParts([]);

  return {
    title: doc ? `${doc.title} | arkaik docs` : "Documentation | arkaik",
    description: "Arkaik documentation",
  };
}

export default async function DocsHomePage() {
  const doc = await getDocBySlugParts([]);
  if (!doc) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <MarkdownContent source={doc.content} />
    </main>
  );
}
