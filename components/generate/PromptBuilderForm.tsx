"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { PlatformToggleGroup } from "@/components/panels/PlatformToggleGroup";
import {
  DEPTH_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  TARGET_LLM_OPTIONS,
} from "@/lib/prompts/types";
import type { PromptConfig } from "@/lib/prompts/types";
import type { StatusId } from "@/lib/config/statuses";

interface PromptBuilderFormProps {
  config: PromptConfig;
  onChange: React.Dispatch<React.SetStateAction<PromptConfig>>;
}

export function PromptBuilderForm({ config, onChange }: PromptBuilderFormProps) {
  // One prefix per mounted form, suffixed per control. The generate page mounts
  // a single builder today, but ids that collide across two mounts point every
  // label at the first form's controls, which is the failure mode `htmlFor` was
  // added to avoid in the first place.
  const fieldId = useId();

  function update(patch: Partial<PromptConfig>) {
    onChange((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card/70 p-4 md:p-6">
      {/* Common fields */}
      <Field label="Project title" htmlFor={`${fieldId}-title`}>
        <Input
          id={`${fieldId}-title`}
          value={config.projectTitle}
          onChange={(e) => update({ projectTitle: e.target.value })}
          placeholder="My Product"
        />
      </Field>

      <Field label="Project description (optional)" htmlFor={`${fieldId}-description`}>
        <Textarea
          id={`${fieldId}-description`}
          value={config.projectDescription || ""}
          onChange={(e) => update({ projectDescription: e.target.value })}
          placeholder="Brief description of what this product does..."
          rows={2}
          className="leading-relaxed resize-none"
        />
      </Field>

      {/* No `htmlFor`: a toggle group has no single control to point at, so the
          label stays an honest <span> and the group carries its own name. */}
      <Field label="Target platforms">
        <PlatformToggleGroup
          value={config.platforms}
          onChange={(platforms) => update({ platforms })}
          // The prompt is generated for at least one platform, so the last
          // selected chip cannot be turned off — the rule the old inline
          // handler spelled as `if (next.length > 0)`.
          minLength={1}
          ariaLabel="Target platforms"
        />
      </Field>

      <Field label="Default status for new nodes" htmlFor={`${fieldId}-default-status`}>
        <Select value={config.defaultStatus} onValueChange={(v) => update({ defaultStatus: v as StatusId })}>
          <SelectTrigger id={`${fieldId}-default-status`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* No icons: this picks a status for nodes that do not exist yet,
                so there is no state to colour. */}
            <StatusSelectItems showIcons={false} />
          </SelectContent>
        </Select>
      </Field>

      {/* Use-case specific fields */}
      {config.useCase === "from-pitch" && (
        <>
          <Field label="Product pitch" htmlFor={`${fieldId}-pitch`}>
            <Textarea
              id={`${fieldId}-pitch`}
              value={config.pitch || ""}
              onChange={(e) => update({ pitch: e.target.value })}
              placeholder="Describe your product idea... What does it do? Who is it for? What are the main features?"
              rows={6}
              className="leading-relaxed resize-y"
            />
          </Field>

          <Field label="Desired depth" htmlFor={`${fieldId}-depth`}>
            <Select value={config.depth || "detailed"} onValueChange={(v) => update({ depth: v as PromptConfig["depth"] })}>
              <SelectTrigger id={`${fieldId}-depth`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPTH_OPTIONS.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Focus areas (optional)" htmlFor={`${fieldId}-focus-areas`}>
            <Input
              id={`${fieldId}-focus-areas`}
              value={config.focusAreas || ""}
              onChange={(e) => update({ focusAreas: e.target.value })}
              placeholder="e.g., onboarding, payment, social features"
            />
          </Field>
        </>
      )}

      {config.useCase === "from-plan" && (
        <>
          <Field label="Source material type" htmlFor={`${fieldId}-source-type`}>
            <Select value={config.sourceType || "other"} onValueChange={(v) => update({ sourceType: v as PromptConfig["sourceType"] })}>
              <SelectTrigger id={`${fieldId}-source-type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_TYPE_OPTIONS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Source material" htmlFor={`${fieldId}-source-material`}>
            <Textarea
              id={`${fieldId}-source-material`}
              value={config.sourceMaterial || ""}
              onChange={(e) => update({ sourceMaterial: e.target.value })}
              placeholder="Paste your Mermaid diagram, screen list, flowchart, or specification here..."
              rows={10}
              className="font-mono leading-relaxed resize-y placeholder:font-sans"
            />
          </Field>

          <Field label="Additional context (optional)" htmlFor={`${fieldId}-additional-context`}>
            <Textarea
              id={`${fieldId}-additional-context`}
              value={config.additionalContext || ""}
              onChange={(e) => update({ additionalContext: e.target.value })}
              placeholder="Any extra context that helps interpret the source material..."
              rows={3}
              className="leading-relaxed resize-none"
            />
          </Field>
        </>
      )}

      {config.useCase === "extend-map" && (
        <>
          <Field label="Existing project bundle (JSON)" htmlFor={`${fieldId}-existing-bundle`}>
            <Textarea
              id={`${fieldId}-existing-bundle`}
              value={config.existingBundle || ""}
              onChange={(e) => update({ existingBundle: e.target.value })}
              placeholder='Paste the exported JSON of your existing Arkaik project here... (use "Export JSON" in the project menu)'
              rows={8}
              className="font-mono leading-relaxed resize-y placeholder:font-sans"
            />
          </Field>

          <Field label="What to add" htmlFor={`${fieldId}-extension`}>
            <Textarea
              id={`${fieldId}-extension`}
              value={config.extensionDescription || ""}
              onChange={(e) => update({ extensionDescription: e.target.value })}
              placeholder="Describe what you want to add... e.g., 'Add a settings flow with profile editing, notification preferences, and account deletion'"
              rows={4}
              className="leading-relaxed resize-y"
            />
          </Field>

          <Field label="Connection point (optional)" htmlFor={`${fieldId}-connection-point`}>
            <Input
              id={`${fieldId}-connection-point`}
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
          <Field label="Target LLM" htmlFor={`${fieldId}-target-llm`}>
            <Select value={config.targetLlm || "any"} onValueChange={(v) => update({ targetLlm: v as PromptConfig["targetLlm"] })}>
              <SelectTrigger id={`${fieldId}-target-llm`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_LLM_OPTIONS.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* `Label` rather than a native <label> wrapper: Radix's Checkbox is a
              <button>, and a native label does not toggle a button it wraps —
              only the explicit htmlFor/id pairing Radix forwards does. */}
          <div className="flex items-center gap-4">
            <Label htmlFor={`${fieldId}-include-schema`} className="text-sm font-normal">
              <Checkbox
                id={`${fieldId}-include-schema`}
                checked={config.includeSchema !== false}
                onCheckedChange={(checked) => update({ includeSchema: checked === true })}
              />
              Include schema
            </Label>
            <Label htmlFor={`${fieldId}-include-example`} className="text-sm font-normal">
              <Checkbox
                id={`${fieldId}-include-example`}
                checked={config.includeExample !== false}
                onCheckedChange={(checked) => update({ includeExample: checked === true })}
              />
              Include example
            </Label>
          </div>

          <Field label="Custom instructions (optional)" htmlFor={`${fieldId}-custom-instructions`}>
            <Textarea
              id={`${fieldId}-custom-instructions`}
              value={config.customInstructions || ""}
              onChange={(e) => update({ customInstructions: e.target.value })}
              placeholder="Any additional instructions for the LLM..."
              rows={3}
              className="leading-relaxed resize-none"
            />
          </Field>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
