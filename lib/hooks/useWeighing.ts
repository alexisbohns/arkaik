"use client";

import { useCallback } from "react";
import type { WeighingEventInput, WeighingSection } from "@arkaik/schema";

import { invalidateProject } from "@/lib/data/project-queries";
import { getProvider } from "@/lib/data/provider-registry";
import { useProject } from "@/lib/hooks/useProject";

/**
 * The project's weighing section (docs/rfcs/weighing.md) and the one way to
 * write to it.
 *
 * The section is read off the project bundle the query cache already holds —
 * on a hosted project the server folded its events in, on a browser project
 * the local provider did — so reading costs nothing extra and every surface
 * that asks sees the same section.
 *
 * `record` sends one batch through the provider's `appendWeighingEvents`: the
 * schema's `planWeighingEvents` gate, a person stamped as the scorer, the
 * journal grown and the snapshot untouched. It resolves once the project has
 * been marked stale and refetched, so a caller that awaits it reads its own
 * write. It rejects with the gate's reasons (`unknown_criterion: …`) when
 * the batch is refused — all of it, or none — and the caller says so.
 */
export function useWeighing(projectId: string) {
  const { project } = useProject(projectId);
  const section: WeighingSection | undefined = project?.weighing;

  const record = useCallback(
    async (inputs: readonly WeighingEventInput[]) => {
      const provider = getProvider();
      if (!provider.appendWeighingEvents) throw new Error("This project cannot record assessments.");
      await provider.appendWeighingEvents(projectId, inputs);
      await invalidateProject(projectId);
    },
    [projectId],
  );

  return { section, record };
}
