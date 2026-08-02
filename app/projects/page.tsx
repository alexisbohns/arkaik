"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthButton } from "@/components/auth/AuthButton";
import { getProvider } from "@/lib/data/provider-registry";
import type { Project, ProjectBundle } from "@/lib/data/types";
import type { ProjectSummary } from "@/lib/data/data-provider";
import { exportProject as exportProjectBundle } from "@/lib/utils/export";
import { createRemoteProvider } from "@/lib/data/remote-provider";
import { importProjectFromFile, parseBundleFromFile } from "@/lib/utils/export";
import { CreateProjectForm } from "@/components/panels/CreateProjectForm";
import { RestoreDialog } from "@/components/sync/RestoreDialog";
import { SynkOnboardingBanner } from "@/components/sync/SynkOnboardingBanner";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { ProjectSection } from "@/components/projects/ProjectSection";
import { groupBySection } from "@/lib/data/project-sections";
import {
  createInTarget,
  parseCreateTarget,
  type CreateTarget,
} from "@/lib/data/create-target";
import { syncManager } from "@/lib/sync/sync-manager";
import { useAuthStatus } from "@/lib/hooks/useAuthStatus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import pebbles from "@/seed/pebbles.json";
import arkaikSelfMap from "@/seed/arkaik-self-map.json";

type ExampleSeed = "pebbles" | "arkaik";

const EXAMPLE_SEEDS: Record<ExampleSeed, { fileName: string; data: unknown }> = {
  pebbles: { fileName: "pebbles.json", data: pebbles },
  arkaik: { fileName: "arkaik-self-map.json", data: arkaikSelfMap },
};

/** Where a `?import=` arrival from /generate says the file is headed. */
const IMPORT_PROMPT_DESTINATION: Record<CreateTarget, string> = {
  hosted: "It will land in your account.",
  synked: "It will land in this browser, backed up to Synk.",
  lokal: "It will land in this browser only.",
};

/** The injected effects `createInTarget` routes between. Module scope on purpose:
 *  it captures nothing from the component, and every provider it reaches for is
 *  itself module-level, so hoisting it makes that independence obvious. */
const targetDeps = {
  saveLocal: async (bundle: ProjectBundle) => {
    await getProvider().saveProject(bundle);
    return bundle.project.id;
  },
  importHosted: async (bundle: ProjectBundle) => {
    const created = await createRemoteProvider().importProject(bundle);
    return created.id;
  },
  backupNow: (projectId: string) => syncManager.backupNow(projectId),
};

/**
 * `useSearchParams` opts the tree out of prerendering, so the page body sits
 * behind a Suspense boundary — without it `next build` fails on `/projects`.
 *
 * The header stays OUTSIDE the boundary: it needs no search params, and leaving
 * it inside meant the fallback blanked the logo, the auth button and the theme
 * toggle, so hydration flashed an empty white page instead of the chrome.
 */
export default function ProjectsPage() {
  return (
    <div className="flex flex-1 flex-col font-sans">
      <ProjectsHeader />
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        }
      >
        <ProjectsPageBody />
      </Suspense>
    </div>
  );
}

function ProjectsHeader() {
  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <Link href="/" aria-label="Go to home" className="inline-flex items-center">
        <ArkaikLogo className="w-20 shrink-0" />
      </Link>
      <div className="flex items-center gap-2">
        <AuthButton />
        <ThemeToggle />
      </div>
    </header>
  );
}

function ProjectsPageBody() {
  const router = useRouter();
  const auth = useAuthStatus();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const searchParams = useSearchParams();
  /** Ids of projects with a Synk backup — the ONLY thing that separates Synked from Lokal. */
  const [backedUpIds, setBackedUpIds] = useState<Set<string>>(new Set());
  /** Which section the in-flight create/import is destined for. */
  const [createTarget, setCreateTarget] = useState<CreateTarget>("lokal");
  /**
   * Which section the file picker was opened for. A ref rather than state
   * because the value has to survive the trip out to the OS dialog and back
   * into a change event, and nothing rendered depends on it — turning it into
   * state would buy a re-render and change nothing on screen.
   */
  const importTargetRef = useRef<CreateTarget>("lokal");
  /** Set when we arrive from /generate with `?import=`; drives the inline prompt. */
  const [importPrompt, setImportPrompt] = useState<CreateTarget | null>(null);
  const signedIn = auth.state === "signed-in";
  /**
   * One loading state for the whole body, covering BOTH unknowns.
   *
   * `signedIn` is false while auth is still resolving, which is indistinguishable
   * from signed-out — so without this the signed-out branch renders first and
   * every signed-in user watches the page-level button row this feature removes
   * appear and then vanish. Folding the auth wait into the same "Loading…" the
   * project listing already shows keeps it to one spinner rather than two.
   */
  const showLoading = loading || auth.state === "loading";
  /** Hosting a project needs somewhere to put it — i.e. a signed-in account. */
  const canHost = signedIn;

  /**
   * Copy a browser-held project into the account.
   *
   * A COPY, not a move: the local original is left exactly where it is. The
   * hosted project gets a new server-owned id, so the two are genuinely
   * separate afterwards — and if anything goes wrong the user has lost nothing.
   * Deleting the local one is left to them, deliberately.
   */
  async function moveToAccount(summary: ProjectSummary) {
    setMoving(summary.project.id);
    setError(null);
    try {
      const bundle = await exportProjectBundle(summary.project.id);
      const created = await createRemoteProvider().importProject(bundle);
      toast.success(`"${bundle.project.title}" is now in your account.`);
      await loadProjects();
      router.push(`/project/${created.id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to move project to account:", err);
      setError(err instanceof Error ? err.message : "Could not move this project to your account.");
    } finally {
      setMoving(null);
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Request sequence numbers for the two overlapping loaders below.
   *
   * Both are fired from several places now — mount, the sync subscription,
   * creation and import — so two can easily be in flight at once, and the
   * network does not promise they resolve in the order they were sent. Without
   * this, an older response can land last and overwrite newer state: a project
   * that was just backed up visibly hops back to Lokal and the banner offers to
   * back it up again. Only the most recently issued request may write.
   */
  const projectsSeq = useRef(0);
  const backedUpSeq = useRef(0);

  /**
   * `signedIn` is a real dependency, not decoration — do not "simplify" it out.
   *
   * The listing waits on `whenHostedAvailabilityKnown()`, which gives up and
   * answers "local only" after a timeout. On a slow `/api/auth/status` the
   * first listing therefore returns local projects only, and moments later auth
   * resolves signed-in and the page switches to three sections — with Hosted
   * permanently empty and no way back short of a manual reload. Re-listing when
   * `signedIn` flips true is the fix; the sequence guard above keeps the two
   * overlapping listings from fighting.
   */
  const loadProjects = useCallback(async () => {
    const mine = ++projectsSeq.current;
    setLoading(true);
    try {
      const list = await getProvider().listProjects();
      if (projectsSeq.current !== mine) return;
      setProjects(list);
    } catch (err) {
      if (projectsSeq.current !== mine) return;
      console.error("[ProjectsPage] Failed to load projects:", err);
      setError("Failed to load projects");
    } finally {
      if (projectsSeq.current === mine) setLoading(false);
    }
    // `signedIn` is not referenced in the body — the dependency is what makes
    // the re-listing happen, so exhaustive-deps calls it unnecessary. It is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  /**
   * The set of project ids Synk holds a backup for.
   *
   * This used to live inside `SynkOnboardingBanner`. It moved up here because
   * the sections need the same answer: a local project with a backup is Synked,
   * without one it is Lokal. Two independent fetches could disagree, and the
   * banner would then offer to back up a project already sitting under "Synked".
   */
  const loadBackedUpIds = useCallback(async () => {
    const mine = ++backedUpSeq.current;
    // Note the asymmetry with the failure paths below, which is deliberate:
    // signed out means there are genuinely no backups, while a failed request
    // means we do not KNOW — and not-knowing must not look like
    // not-backed-up. Emptying the set on a blip would march every Synked
    // project across into Lokal and have the banner offer to back them all up
    // again, so a failure keeps whatever we last knew.
    if (!signedIn) {
      setBackedUpIds(new Set());
      return;
    }
    try {
      const res = await fetch("/api/synk/projects", { cache: "no-store" });
      if (backedUpSeq.current !== mine || !res.ok) return;
      const body = (await res.json()) as { projects?: Array<{ project_id: string }> };
      if (backedUpSeq.current !== mine) return;
      setBackedUpIds(new Set((body.projects ?? []).map((p) => p.project_id)));
    } catch {
      // Keep the previous set — see above.
    }
  }, [signedIn]);

  useEffect(() => {
    void loadBackedUpIds();
  }, [loadBackedUpIds]);

  /**
   * A project that just got backed up — via the banner, the per-card control, or
   * a Synked creation — must hop from Lokal to Synked without a page reload.
   *
   * The listener is deliberately picky. `syncManager` emits on EVERY status
   * change: one backup alone walks pending → syncing → backed-up, sign-in
   * hydration seeds a status per project, and any local edit anywhere sets
   * pending through the mutation debounce. Refetching on each of those would
   * turn a free re-render into a storm of no-store GETs. Only a project NEWLY
   * reaching `backed-up` can change the Synked/Lokal split, so only that
   * refetches.
   */
  const projectsRef = useRef<ProjectSummary[]>(projects);
  projectsRef.current = projects;
  const backedUpStatusRef = useRef<Set<string>>(new Set());

  useEffect(
    () =>
      syncManager.subscribe(() => {
        const seen = backedUpStatusRef.current;
        let isNew = false;
        const next = new Set<string>();
        for (const summary of projectsRef.current) {
          const id = summary.project.id;
          if (syncManager.getStatus(id).state !== "backed-up") continue;
          next.add(id);
          if (!seen.has(id)) isNew = true;
        }
        backedUpStatusRef.current = next;
        if (isNew) void loadBackedUpIds();
      }),
    [loadBackedUpIds]
  );

  // Coming back from /generate with a target in hand. We do NOT open the picker
  // here: a programmatic click in a mount effect has no transient user
  // activation, so browsers routinely block the dialog — and with the param
  // already stripped the user would be left with nothing at all. Instead we
  // remember the target and render an inline prompt whose button supplies the
  // click, which always works.
  useEffect(() => {
    const target = parseCreateTarget(searchParams.get("import"));
    if (!target) return;
    setImportPrompt(target);
    // `replaceState` rather than `router.replace`: this is a cosmetic URL
    // cleanup, and routing through Next would re-run this effect via a new
    // `searchParams` object for no benefit. Other params are preserved — only
    // `import` is consumed here.
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("import");
    const query = rest.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
  }, [searchParams]);

  async function createProject(project: Pick<Project, "title" | "description">) {
    setError(null);
    const now = new Date().toISOString();
    const bundle: ProjectBundle = {
      project: {
        id: crypto.randomUUID(),
        title: project.title,
        description: project.description,
        // Card rendering is per map now (spec/maps.md § Display Options), so a
        // fresh project seeds no legacy `view_card_variant` — the defaults are
        // what "compact" used to mean.
        metadata: {},
        created_at: now,
        updated_at: now,
        archived_at: null,
      },
      nodes: [],
      edges: [],
    };

    try {
      const { id, backupError } = await createInTarget(createTarget, bundle, targetDeps);
      if (backupError) toast.error(`Created, but the backup failed: ${backupError}`);
      await loadProjects();
      await loadBackedUpIds();
      router.push(`/project/${id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to create project:", err);
      setError(err instanceof Error ? err.message : "Could not create this project.");
    }
  }

  function openImportPicker(target: CreateTarget) {
    importTargetRef.current = target;
    fileInputRef.current?.click();
  }

  /**
   * The one import path, shared by the file picker and the example seeds.
   *
   * Both end up in the same place — a bundle, routed to a target — so they run
   * the same code rather than two lookalike copies that can drift.
   */
  async function runImport(file: File, target: CreateTarget, failureMessage: string) {
    setImporting(true);
    setError(null);
    try {
      // Same router as creation, so "what synked means" has exactly one
      // definition. Only `saveLocal` differs: the local import path does its own
      // id-uniquing against what is already in this browser, which a hosted
      // import must not do, so it takes the file rather than the parsed bundle.
      const bundle = await parseBundleFromFile(file);
      const { id, backupError } = await createInTarget(target, bundle, {
        ...targetDeps,
        saveLocal: async () => (await importProjectFromFile(file)).id,
      });

      if (backupError) toast.error(`Imported, but the backup failed: ${backupError}`);
      setImportPrompt(null);
      await loadProjects();
      await loadBackedUpIds();
      router.push(`/project/${id}`);
    } catch (err) {
      console.error(`[ProjectsPage] ${failureMessage}:`, err);
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setImporting(false);
    }
  }

  async function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const MAX_IMPORT_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_IMPORT_SIZE) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 5 MB.`);
      return;
    }

    await runImport(file, importTargetRef.current, "Failed to import project JSON");
  }

  /**
   * An example project is a Lokal project by definition — it is a bundle we
   * ship, written to this browser — so it goes through the same import as a
   * hand-picked file, with the target fixed. No size check: the seeds are ours.
   */
  async function handleImportExample(seed: ExampleSeed) {
    const selected = EXAMPLE_SEEDS[seed];
    const file = new File([JSON.stringify(selected.data)], selected.fileName, {
      type: "application/json",
    });
    await runImport(file, "lokal", "Failed to import example project");
  }

  const grouped = groupBySection(projects, backedUpIds);

  const openCreateDialog = (target: CreateTarget) => {
    setCreateTarget(target);
    setCreateOpen(true);
  };

  /** The example seeds. Lokal by nature, so it appears only where Lokal is empty. */
  const examplePicker = (
    <Select
      disabled={importing}
      onValueChange={(value) => {
        void handleImportExample(value as ExampleSeed);
      }}
    >
      <SelectTrigger className="w-[220px] cursor-pointer" aria-label="Import example project">
        <SelectValue placeholder={importing ? "Importing..." : "Import example project"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="pebbles">Pebbles</SelectItem>
        <SelectItem value="arkaik">Arkaik</SelectItem>
      </SelectContent>
    </Select>
  );

  // `ProjectSection` calls this via `items.map(renderCard)`, so it must set the key.
  // The card is a link to the project now; publishing, repository links and
  // deletion all live inside it (the sidebar footer and the Settings page), so
  // the listing has nothing left to wire but the one thing you cannot do from
  // inside a local project — moving it into the account.
  const renderCard = (summary: ProjectSummary) => (
    <ProjectCard
      key={summary.project.id}
      summary={summary}
      canHost={canHost}
      moving={moving === summary.project.id}
      onMoveToAccount={() => void moveToAccount(summary)}
    />
  );

  return (
    <>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Projects</h1>
          {/* One shared picker: `importTargetRef` carries which section asked. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFileChange}
            className="hidden"
          />
          {/* Signed out there is only one kind of project, so the sole control
              sits up here rather than under a heading that says nothing. */}
          {!showLoading && !signedIn && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="cursor-pointer"
                disabled={importing}
                onClick={() => openImportPicker("lokal")}
              >
                {importing ? "Importing..." : "Import JSON"}
              </Button>
              <Button variant="outline" className="cursor-pointer" asChild>
                <Link href="/generate?target=lokal">Generate with AI</Link>
              </Button>
              <Button className="cursor-pointer" onClick={() => openCreateDialog("lokal")}>
                Create project
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* The /generate round trip landing. Persistent rather than an auto-opened
            picker, so the click that opens the dialog comes from the user. */}
        {importPrompt && (
          <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex items-start gap-2">
              <UploadIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Import your generated JSON</p>
                <p className="text-xs text-muted-foreground">
                  {IMPORT_PROMPT_DESTINATION[importPrompt]}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                className="cursor-pointer"
                disabled={importing}
                onClick={() => openImportPicker(importPrompt)}
              >
                {importing ? "Importing..." : "Choose file"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 cursor-pointer"
                aria-label="Dismiss import prompt"
                onClick={() => setImportPrompt(null)}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Only relevant when something is actually un-backed-up and local. The
            banner gets the FULL list and filters it itself with `backedUpIds`,
            so it stays correct on its own terms rather than depending on this
            caller having pre-filtered. */}
        {!showLoading && grouped.lokal.length > 0 && (
          <SynkOnboardingBanner projects={projects} backedUpIds={backedUpIds} />
        )}

        {showLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : !signedIn ? (
          /* Signed out: no sections. Hosted and Synked are impossible without an
             account, and the local-first promise is that signing in ADDS things
             rather than rearranging what was already there. */
          grouped.lokal.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
              <p className="max-w-xs text-sm text-muted-foreground">
                No projects yet. Create one, import your JSON, or load an example project.
              </p>
              {/* A signed-out visitor with nothing is exactly who the example is
                  for — without this the empty state is a dead end. */}
              {examplePicker}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {grouped.lokal.map(renderCard)}
            </div>
          )
        ) : (
          <>
            <ProjectSection
              target="hosted"
              items={grouped.hosted}
              renderCard={renderCard}
              disabled={importing}
              onCreate={() => openCreateDialog("hosted")}
              onImport={() => openImportPicker("hosted")}
            />

            <ProjectSection
              target="synked"
              items={grouped.synked}
              renderCard={renderCard}
              disabled={importing}
              onCreate={() => openCreateDialog("synked")}
              onImport={() => openImportPicker("synked")}
              onRestore={() => setRestoreOpen(true)}
            />

            <ProjectSection
              target="lokal"
              items={grouped.lokal}
              renderCard={renderCard}
              disabled={importing}
              onCreate={() => openCreateDialog("lokal")}
              onImport={() => openImportPicker("lokal")}
              emptyExtra={examplePicker}
            />
          </>
        )}
      </main>

      <CreateProjectForm open={createOpen} onOpenChange={setCreateOpen} onSubmit={createProject} />

      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} />
    </>
  );
}
