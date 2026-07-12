import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarIcon, GitBranchIcon, ImageOffIcon, InfoIcon, WorkflowIcon } from "lucide-react";

import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { ImportSnapshotButton } from "@/components/publik/ImportSnapshotButton";
import { fetchSnapshotSummary, servicesConfigured, type SnapshotSummary } from "@/lib/services/publik";
import { summarizeBundle, type ConformanceLevel } from "@/lib/utils/publik-preview";

/**
 * `/p/{id}` — the human-facing half of Publik (docs/spec/services.md § Publik
 * → Surfaces). A *preview* page, not a server-rendered graph: full read-only
 * rendering needs the provider-injection seam and is out of M4 scope. This
 * page shows just enough to decide whether to import — title, description,
 * node/edge counts, a format-level badge, the created date, the no-retention
 * disclaimer, and the "Import into arkaik" action.
 *
 * Node runtime + force-dynamic: reads Postgres directly through
 * lib/services/publik.ts (same process, no HTTP self-call) and must never be
 * statically prerendered — the snapshot is a runtime fact.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PublikSnapshotPageProps {
  params: Promise<{ id: string }>;
}

type SnapshotLookup =
  | { status: "unconfigured" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "found"; summary: SnapshotSummary };

/**
 * `cache()` dedupes the Postgres lookup within a single request — both
 * `generateMetadata` and the page component need it, and React's per-request
 * cache means it only actually runs once.
 */
const lookupSnapshot = cache(async (id: string): Promise<SnapshotLookup> => {
  if (!servicesConfigured()) return { status: "unconfigured" };
  try {
    const summary = await fetchSnapshotSummary(id);
    return summary ? { status: "found", summary } : { status: "not-found" };
  } catch (err) {
    console.error("[p/[id]] Failed to fetch snapshot:", err instanceof Error ? err.message : "unknown error");
    return { status: "error" };
  }
});

const LEVEL_LABELS: Record<ConformanceLevel, string> = {
  0: "Level 0 · Static snapshot",
  1: "Level 1 · Versioned snapshot",
  2: "Level 2 · Snapshot + journal",
};

export async function generateMetadata({ params }: PublikSnapshotPageProps): Promise<Metadata> {
  const { id } = await params;
  const lookup = await lookupSnapshot(id);

  if (lookup.status !== "found") {
    return { title: "Shared project | arkaik" };
  }

  const { title, description } = summarizeBundle(lookup.summary.bundle);
  return {
    title: `${title} | arkaik`,
    description: description ?? `A shared arkaik product graph: ${title}.`,
    // Unlisted by design (docs/spec/services.md § Security & Privacy: "reads
    // are by unguessable id only") — keep snapshots out of search indexes.
    robots: { index: false, follow: false },
  };
}

function formatCreatedDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function PageChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background font-sans">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/" aria-label="Go to arkaik home" className="inline-flex items-center">
          <ArkaikLogo className="w-20 shrink-0" />
        </Link>
        <ThemeToggle />
      </header>
      {children}
    </div>
  );
}

function MessageShell({ title, description }: { title: string; description: string }) {
  return (
    <PageChrome>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Link href="/" className="text-sm underline underline-offset-4">
          Back to arkaik
        </Link>
      </main>
    </PageChrome>
  );
}

export default async function PublikSnapshotPage({ params }: PublikSnapshotPageProps) {
  const { id } = await params;
  const lookup = await lookupSnapshot(id);

  if (lookup.status === "unconfigured") {
    return (
      <MessageShell
        title="Sharing is not available"
        description="This arkaik deployment does not have hosted sharing (Publik) configured. Ask the site operator to set DATABASE_URL to enable shared snapshots."
      />
    );
  }

  if (lookup.status === "error") {
    return (
      <MessageShell
        title="Something went wrong"
        description="This snapshot could not be loaded right now. Please try again shortly."
      />
    );
  }

  if (lookup.status === "not-found") {
    notFound();
  }

  const { summary } = lookup;
  const { title, description, nodeCount, edgeCount, conformanceLevel, previewAsset } = summarizeBundle(
    summary.bundle,
  );

  return (
    <PageChrome>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="overflow-hidden rounded-xl border bg-card">
          {previewAsset.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary data:/absolute-URL source, not a static/optimizable asset
            <img src={previewAsset.src} alt={`${title} preview`} className="h-56 w-full object-cover" />
          ) : previewAsset.kind === "placeholder" ? (
            <div className="flex h-56 w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
              <ImageOffIcon className="size-8" />
              <p className="text-xs">Preview image not available in this view</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold">{title}</h1>
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
              </div>
              <Badge variant="secondary" className="shrink-0">
                {LEVEL_LABELS[conformanceLevel]}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <WorkflowIcon className="size-4" />
                {nodeCount} node{nodeCount === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <GitBranchIcon className="size-4" />
                {edgeCount} edge{edgeCount === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="size-4" />
                Published {formatCreatedDate(summary.createdAt)}
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
              <p>
                Anyone with this link can view and import a copy of this project. It carries no edit history —
                the journal is never published — and arkaik makes no retention guarantee; this snapshot may be
                removed at any time.
              </p>
            </div>

            <ImportSnapshotButton snapshotId={id} suggestedFileName={`${title}.json`} />
          </div>
        </div>
      </main>
    </PageChrome>
  );
}
