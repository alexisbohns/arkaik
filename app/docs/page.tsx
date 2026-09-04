import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsArticle } from "@/components/docs/DocsArticle";
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

  return <DocsArticle title={doc.title} source={doc.content} />;
}
