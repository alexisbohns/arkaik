import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MarkdownContent } from "@/components/docs/MarkdownContent";
import { getAllDocEntries, getDocBySlugParts } from "@/lib/utils/docs";

interface DocsSlugPageProps {
  params: Promise<{ slug: string[] }>;
}

export const runtime = "nodejs";

export async function generateStaticParams() {
  const entries = await getAllDocEntries();

  return entries
    .filter((entry) => entry.slugParts.length > 0)
    .map((entry) => ({ slug: entry.slugParts }));
}

export async function generateMetadata({ params }: DocsSlugPageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDocBySlugParts(slug);

  return {
    title: doc ? `${doc.title} | arkaik docs` : "Documentation | arkaik",
    description: doc?.title ? `${doc.title} documentation` : "Arkaik documentation",
  };
}

export default async function DocsSlugPage({ params }: DocsSlugPageProps) {
  const { slug } = await params;
  const doc = await getDocBySlugParts(slug);

  if (!doc) {
    redirect("/docs");
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <MarkdownContent source={doc.content} />
    </main>
  );
}
