"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { PageError } from "@/components/layout/PageError";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { ProductManagerPanel } from "@/components/settings/ProductManagerPanel";
import { RepoLinksPanel } from "@/components/settings/RepoLinksPanel";
import { Button } from "@/components/ui/button";
import { isHostedProjectId } from "@/lib/data/remote-provider";
import { isSeedProjectId } from "@/lib/data/seed-project-id";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { archiveProject } from "@/lib/utils/export";

/**
 * The project's Settings page — the home for everything that configures a
 * project rather than describes it.
 *
 * It exists because the projects listing was carrying this work: every card had
 * a Repos button and a Delete button next to Open, which made a listing a
 * control panel and put a destructive action one mis-click from the common one.
 * Both moved here, and the card became the link it always should have been.
 *
 * Deletion sits in a Danger zone at the bottom, behind a confirmation, exactly
 * because it is the one action here you cannot undo from the UI.
 */
export default function ProjectSettingsPage() {
  const router = useRouter();
  const id = useProjectId();

  const { project, loading, error: projectError, reload: reloadProject, updateProject } = useProject(id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const title = project?.project.title ?? "Untitled project";
  /**
   * Repository links are a hosted-only feature: they live in the account
   * database and the webhook resolves against them, so a browser-held project
   * has nowhere to put one. Routing on the id prefix rather than on a fetched
   * flag keeps the answer available on the first render (lib/data/routing-provider.ts).
   */
  const hosted = isHostedProjectId(id);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await archiveProject(id);
      setDeleteOpen(false);
      toast.success(`"${title}" was deleted.`);
      // Back to the listing: staying would leave every other page in this
      // layout reading a project that is no longer there.
      router.push("/projects");
    } catch (err) {
      console.error("[ProjectSettingsPage] Failed to archive project:", err);
      toast.error(err instanceof Error ? err.message : "Could not delete this project.");
      setDeleting(false);
    }
  }

  /**
   * A settings page fed a project that failed to load is a page of wrong
   * answers (#362): the title falls back to "Untitled project" and the products
   * panel shows none, which reads as "you have no products" rather than "we
   * could not read them" — and the reader's fix for that is to declare them
   * again.
   *
   * No loading gate beside it, deliberately: every section here already handles
   * `project === undefined` while the read is in flight (that is what the
   * fallbacks are for), and it is only the FAILURE that is indistinguishable
   * from an answer.
   */
  if (projectError) {
    return (
      <PageError
        label="project settings"
        message={projectError}
        onRetry={() => void reloadProject()}
      />
    );
  }

  return (
    <>
      <PageShell title="Settings">
        <PageSurface maxWidth="max-w-3xl" contentClassName="flex flex-col gap-10">
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Linked repositories</h2>
              <p className="text-sm text-muted-foreground">
                Pull requests in these repositories can move {title}&rsquo;s acceptances. Naming
                the platform a repository — or one folder of it — builds for means a merge there
                marks only that platform shipped.
              </p>
            </div>
            {hosted ? (
              <RepoLinksPanel projectId={id} />
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                This project lives in this browser, so there is no account for a repository link
                to hang off. Move it to your account from the projects page and the links appear
                here.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Products</h2>
              <p className="text-sm text-muted-foreground">
                A project can describe a family of apps sharing one graph. Naming them lets every
                page scope to one &mdash; and lets a web-only dashboard stop dragging down your
                Android numbers.
              </p>
            </div>
            {/* The panel reads the node list itself: member counts and the
                reassignment a deletion offers both need it, and nothing else
                on this page does. */}
            <ProductManagerPanel projectId={id} project={project} updateProject={updateProject} />
          </section>

          {/* The seed's own archiveProject rejects with an error (the provider
              is the backstop), but a control that always fails isn't a
              control — the UI just doesn't offer deletion for the public map. */}
          {!isSeedProjectId(id) && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
                <p className="text-sm text-muted-foreground">
                  Actions here change the project itself, not what you are looking at.
                </p>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Delete this project</p>
                  <p className="text-sm text-muted-foreground">
                    {title} disappears from your projects, along with its nodes, edges and
                    history.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  className="shrink-0 cursor-pointer"
                  disabled={loading || deleting}
                  onClick={() => setDeleteOpen(true)}
                >
                  {deleting ? "Deleting…" : "Delete project"}
                </Button>
              </div>
            </section>
          )}
        </PageSurface>
      </PageShell>

      {!isSeedProjectId(id) && (
        <DeleteConfirmDialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (!open && !deleting) setDeleteOpen(false);
          }}
          title="Delete project"
          description={`Archive "${title}" and remove it from your list?`}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  );
}
