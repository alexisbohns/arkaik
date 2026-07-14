import { redirect } from "next/navigation";

interface CanvasPageProps {
  params: Promise<{ id: string }>;
}

/** The canvas grew up into the Journey map — old links keep working. */
export default async function CanvasPage({ params }: CanvasPageProps) {
  const { id } = await params;
  redirect(`/project/${id}/maps/journey`);
}
