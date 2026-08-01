"use client";

import { Suspense, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Lightbulb, FileText, GitBranch } from "lucide-react";
import { parseCreateTarget, type CreateTarget } from "@/lib/data/create-target";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { PromptBuilderForm } from "@/components/generate/PromptBuilderForm";
import { PromptOutput } from "@/components/generate/PromptOutput";
import { assemblePrompt, estimateTokens } from "@/lib/prompts/assemble";
import type { PromptConfig, UseCase } from "@/lib/prompts/types";
import { USE_CASES } from "@/lib/prompts/types";

const USE_CASE_ICONS = {
  "from-pitch": Lightbulb,
  "from-plan": FileText,
  "extend-map": GitBranch,
} as const;

const DEFAULT_CONFIG: PromptConfig = {
  useCase: "from-pitch",
  projectTitle: "",
  projectDescription: "",
  platforms: ["web"],
  defaultStatus: "idea",
  depth: "detailed",
  includeSchema: true,
  includeExample: true,
  targetLlm: "any",
};

/** Where the section that sent the user here says the result will land.
 *  Keyed by `CreateTarget` so a new target cannot silently go undescribed. */
const DESTINATION: Record<CreateTarget, string> = {
  hosted: "This will land in your account.",
  synked: "This will land in this browser, backed up to Synk.",
  lokal: "This will land in this browser only.",
};

/**
 * `useSearchParams` opts the tree out of prerendering, so the page body sits
 * behind a Suspense boundary — without it `next build` fails on `/generate`.
 *
 * The fallback renders the same header shell rather than `null`: the header
 * carries the destination line, which does depend on the search params, so it
 * cannot simply be hoisted out — but blanking the whole chrome on hydration
 * would flash an empty page.
 */
export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="relative flex min-h-screen flex-col bg-background font-sans">
          <GenerateHeader />
        </div>
      }
    >
      <GeneratePageBody />
    </Suspense>
  );
}

function GenerateHeader({ destination }: { destination?: string }) {
  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <div className="flex items-center gap-3">
        {/* Plain /projects: leaving this page is not a statement that the user
            has JSON in hand, and a back arrow must never spring a file dialog. */}
        <Link
          href="/projects"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-sm font-semibold">Generate with AI</h1>
        {destination ? <p className="text-xs text-muted-foreground">{destination}</p> : null}
      </div>
      <ThemeToggle />
    </header>
  );
}

function GeneratePageBody() {
  const [config, setConfig] = useState<PromptConfig>(DEFAULT_CONFIG);
  const [selectedUseCase, setSelectedUseCase] = useState<UseCase | null>(null);
  const searchParams = useSearchParams();
  /**
   * Where the generated bundle should land once the user comes back to import
   * it. This page does not create anything — it builds a prompt the user runs
   * elsewhere — so the section's intent has to survive the round trip through
   * the URL. A missing or unrecognised value simply means "ask me on import".
   */
  const target = parseCreateTarget(searchParams.get("target"));

  /**
   * The explicit hand-off back to /projects. Separate from the back arrow on
   * purpose: this one is a statement that the user HAS the generated JSON, and
   * only it carries `?import=`.
   */
  const importHandoff = target ? (
    <Button variant="outline" size="sm" className="w-full cursor-pointer" asChild>
      <Link href={`/projects?import=${target}`}>I&apos;ve got my JSON — import it</Link>
    </Button>
  ) : null;

  const prompt = useMemo(() => {
    if (!selectedUseCase) return "";
    return assemblePrompt(config);
  }, [config, selectedUseCase]);

  const tokenCount = useMemo(() => estimateTokens(prompt), [prompt]);

  function handleUseCaseSelect(uc: UseCase) {
    setSelectedUseCase(uc);
    setConfig((prev) => ({ ...prev, useCase: uc }));
  }

  function handleBack() {
    setSelectedUseCase(null);
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background font-sans">
      <GenerateHeader destination={target ? DESTINATION[target] : undefined} />

      {!selectedUseCase ? (
        <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-semibold tracking-tight">What would you like to generate?</h2>
            <p className="mt-2 text-muted-foreground">
              Choose a mode and we&apos;ll build the perfect prompt for your LLM.
            </p>
          </div>

          <div className="grid w-full gap-4 sm:grid-cols-3">
            {USE_CASES.map((uc) => {
              const Icon = USE_CASE_ICONS[uc.id];
              return (
                <button
                  key={uc.id}
                  type="button"
                  onClick={() => handleUseCaseSelect(uc.id)}
                  className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon className="size-6 text-primary" />
                  <div>
                    <div className="font-medium">{uc.label}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{uc.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-6 py-6">
          {/* Form */}
          <div className="flex w-full flex-col gap-4 lg:w-1/2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="size-3.5 mr-1" />
                Back
              </Button>
              <span className="text-sm font-medium text-muted-foreground">
                {USE_CASES.find((uc) => uc.id === selectedUseCase)?.label}
              </span>
            </div>
            <PromptBuilderForm config={config} onChange={setConfig} />
          </div>

          {/* Output */}
          <div className="hidden lg:flex lg:w-1/2 lg:flex-col lg:gap-4">
            <PromptOutput prompt={prompt} tokenCount={tokenCount} />
            {importHandoff}
          </div>

          {/* Mobile output */}
          <div className="fixed bottom-0 left-0 right-0 flex flex-col gap-2 border-t bg-background p-4 lg:hidden">
            <PromptOutput prompt={prompt} tokenCount={tokenCount} compact />
            {importHandoff}
          </div>
        </main>
      )}
    </div>
  );
}
