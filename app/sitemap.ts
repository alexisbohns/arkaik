import type { MetadataRoute } from "next";
import { SEED_PROJECT_ID } from "@/lib/data/seed-project-id";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://arkaik.app";

  return [
    { url: base, lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
    { url: `${base}/projects`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/project/${SEED_PROJECT_ID}`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/generate`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/docs/architecture`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/graph-model`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/data-layer`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/conventions`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/docs/vision`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
  ];
}
