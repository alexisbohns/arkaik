"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { PLATFORMS } from "@/lib/config/platforms";
import { STATUSES } from "@/lib/config/statuses";
import {
  DEPTH_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  TARGET_LLM_OPTIONS,
} from "@/lib/prompts/types";
import type { PromptConfig } from "@/lib/prompts/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";

interface PromptBuilderFormProps {
  config: PromptConfig;
  onChange: React.Dispatch<React.SetStateAction<PromptConfig>>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      {children}
    </div>
  );
}

export function PromptBuilderForm({ config, onChange }: PromptBuilderFormProps) {
  function update(patch: Partial<PromptConfig>) {
    onChange((prev) => ({ ...prev, ...patch }));
  }

  function handlePlatformToggle(platformId: PlatformId) {
    const current = config.platforms;
    const next = current.includes(platformId)
      ? current.filter((p) => p !== platformId)
      : [...current, platformId];
    if (next.length > 0) update({ platforms: next });
  }

  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card/70 p-4 md:p-6">
      {/* Common fields */}
      <Field label="Project title">
        <Input
          value={config.projectTitle}
          onChange={(e) => update({ projectTitle: e.target.value })}
          placeholder="My Product"
        />
      </Field>

      <Field label="Project description (optional)">
        <textarea
          value={config.projectDescription || ""}
          onChange={(e) => update({ projectDescription: e.target.value })}
          placeholder="Brief description of what this product does..."
          rows={2}
          className="border-input bg-transparent text-sm text-foreground leading-relaxed resize-none rounded-md border px-3 py-2 outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50"
        />
      </Field>

      <Field label="Target platforms">
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => {
            const selected = config.platforms.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handlePlatformToggle(p.id)}
                aria-pressed={selected}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground border border-input hover:bg-muted/50"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Default status for new nodes">
        <Select value={config.defaultStatus} onValueChange={(v) => update({ defaultStatus: v as StatusId })}>
          <SelectTrigger aria-label="Default status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Use-case specific fields */}
      {config.useCase === "from-pitch" && (
        <>
          <Field label="Product pitch">
            <textarea
              value={config.pitch || ""}
              onChange={(e) => update({ pitch: e.target.value })}
              placeholder="Describe your product idea... What does it do? Who is it for? What are the main features?"
              rows={6}
              className="border-input bg-transparent text-sm text-foreground leading-relaxed resize-y rounded-md border px-3 py-2 outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50"
            />
          </Field>

          <Field label="Desired depth">
            <Select value={config.depth || "detailed"} onValueChange={(v) => update({ depth: v as PromptConfig["depth"] })}>
              <SelectTrigger aria-label="Depth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPTH_OPTIONS.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Focus areas (optional)">
            <Input
              value={config.focusAreas || ""}
              onChange={(e) => update({ focusAreas: e.target.value })}
              placeholder="e.g., onboarding, payment, social features"
            />
          </Field>
        </>
      )}

      {config.useCase === "from-plan" && (
        <>
          <Field label="Source material type">
            <Select value={config.sourceType || "other"} onValueChange={(v) => update({ sourceType: v as PromptConfig["sourceType"] })}>
              <SelectTrigger aria-label="Source type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_TYPE_OPTIONS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Source material">
            <textarea
              value={config.sourceMaterial || ""}
              onChange={(e) => update({ sourceMaterial: e.target.value })}
              placeholder="Paste your Mermaid diagram, screen list, flowchart, or specification here..."
              rows={10}
              className="border-input bg-transparent text-sm text-foreground font-mono leading-relaxed resize-y rounded-md border px-3 py-2 outline-none placeholder:text-muted-foreground placeholder:font-sans focus:ring-[3px] focus:ring-ring/50"
            />
          </Field>

          <Field label="Additional context (optional)">
            <textarea
              value={config.additionalContext || ""}
              onChange={(e) => update({ additionalContext: e.target.value })}
              placeholder="Any extra context that helps interpret the source material..."
              rows={3}
              className="border-input bg-transparent text-sm text-foreground leading-relaxed resize-none rounded-md border px-3 py-2 outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50"
            />
          </Field>
        </>
      )}

      {config.useCase === "extend-map" && (
        <>
          <Field label="Existing project bundle (JSON)">
            <textarea
              value={config.existingBundle || ""}
              onChange={(e) => update({ existingBundle: e.target.value })}
              placeholder='Paste the exported JSON of your existing Arkaik project here... (use "Export JSON" in the project menu)'
              rows={8}
              className="border-input bg-transparent text-sm text-foreground font-mono leading-relaxed resize-y rounded-md border px-3 py-2 outline-none placeholder:text-muted-foreground placeholder:font-sans focus:ring-[3px] focus:ring-ring/50"
            />
          </Field>

          <Field label="What to add">
            <textarea
              value={config.extensionDescription || ""}
              onChange={(e) => update({ extensionDescription: e.target.value })}
              placeholder="Describe what you want to add... e.g., 'Add a settings flow with profile editing, notification preferences, and account deletion'"
              rows={4}
              className="border-input bg-transparent text-sm text-foreground leading-relaxed resize-y rounded-md border px-3 py-2 outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50"
            />
          </Field>

          <Field label="Connection point (optional)">
            <Input
              value={config.connectionPoint || ""}
              onChange={(e) => update({ connectionPoint: e.target.value })}
              placeholder="e.g., from V-dashboard, add to F-main-flow"
            />
          </Field>
        </>
      )}

      {/* Advanced options */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
            Advanced options
            <ChevronDown className="size-3.5" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4 pt-3">
          <Field label="Target LLM">
            <Select value={config.targetLlm || "any"} onValueChange={(v) => update({ targetLlm: v as PromptConfig["targetLlm"] })}>
              <SelectTrigger aria-label="Target LLM">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_LLM_OPTIONS.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.includeSchema !== false}
                onChange={(e) => update({ includeSchema: e.target.checked })}
                className="rounded border-input"
              />
              Include schema
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.includeExample !== false}
                onChange={(e) => update({ includeExample: e.target.checked })}
                className="rounded border-input"
              />
              Include example
            </label>
          </div>

          <Field label="Custom instructions (optional)">
            <textarea
              value={config.customInstructions || ""}
              onChange={(e) => update({ customInstructions: e.target.value })}
              placeholder="Any additional instructions for the LLM..."
              rows={3}
              className="border-input bg-transparent text-sm text-foreground leading-relaxed resize-none rounded-md border px-3 py-2 outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50"
            />
          </Field>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
