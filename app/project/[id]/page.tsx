import { redirect } from "next/navigation";

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

/** A project opens on the global picture — the Overview (vision.md § IA, CP-E). */
export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params;
  redirect(`/project/${id}/overview`);
}
