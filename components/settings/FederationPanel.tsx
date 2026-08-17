"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectBundle, ProjectMetadata } from "@/lib/data/types";

/**
 * Federation settings (slice 3): the plant slug that opts this project's
 * journal into the pollen feed (`GET …/pollen`, docs/spec/services.md
 * § Pollen feed). One field, stored at `project.metadata.pollen.plant` —
 * present means the feed is served, absent means it is off.
 *
 * Same write path as ProductManagerPanel: the whole current metadata spread
 * back with the one key changed, because the project PATCH replaces
 * `metadata` wholesale and a partial send would silently drop maps, display
 * options and products.
 */

const PLANT_SLUG = /^[a-z0-9][a-z0-9-]*$/;

interface FederationPanelProps {
  project: ProjectBundle | undefined;
  updateProject: (patch: { metadata: ProjectMetadata }) => Promise<unknown>;
}

export function FederationPanel({ project, updateProject }: FederationPanelProps) {
  const stored = project?.project.metadata?.pollen?.plant ?? "";
  const [slug, setSlug] = useState(stored);
  const [saving, setSaving] = useState(false);

  // Adopt the stored value once the bundle loads (or after an outside change);
  // a half-typed edit is never clobbered because the sync only fires when the
  // STORED value moves.
  useEffect(() => {
    setSlug(stored);
  }, [stored]);

  const trimmed = slug.trim();
  const valid = trimmed === "" || PLANT_SLUG.test(trimmed);
  const dirty = trimmed !== stored;

  async function handleSave() {
    if (saving || !valid || !dirty) return;
    setSaving(true);
    try {
      const metadata: ProjectMetadata = { ...(project?.project.metadata ?? {}) };
      if (trimmed === "") delete metadata.pollen;
      else metadata.pollen = { ...(metadata.pollen ?? {}), plant: trimmed };
      await updateProject({ metadata });
      toast.success(trimmed === "" ? "Federation feed turned off." : `Feed enabled for plant:${trimmed}.`);
    } catch (err) {
      console.error("[FederationPanel] Failed to save plant slug:", err);
      toast.error(err instanceof Error ? err.message : "Could not save the federation settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="pbbls"
          aria-label="Plant slug"
          aria-invalid={!valid}
          disabled={!project || saving}
          className="sm:max-w-60"
        />
        <Button
          className="shrink-0 cursor-pointer"
          disabled={!project || saving || !valid || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {!valid && (
        <p className="text-sm text-destructive">
          A plant slug is lowercase letters, digits and hyphens, starting with a letter or digit.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Serves this project&rsquo;s journal as a pollen feed for the Ariko federation. Leave empty
        to keep the feed off.
      </p>
    </div>
  );
}
