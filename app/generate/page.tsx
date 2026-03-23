"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Lightbulb, FileText, GitBranch } from "lucide-react";
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

export default function GeneratePage() {
  const [config, setConfig] = useState<PromptConfig>(DEFAULT_CONFIG);
  const [selectedUseCase, setSelectedUseCase] = useState<UseCase | null>(null);

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
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-sm font-semibold">Generate with AI</h1>
        </div>
        <ThemeToggle />
      </header>

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
          </div>

          {/* Mobile output */}
          <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4 lg:hidden">
            <PromptOutput prompt={prompt} tokenCount={tokenCount} compact />
          </div>
        </main>
      )}
    </div>
  );
}
