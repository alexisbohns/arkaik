"use client";

import { Suspense, useMemo } from "react";
import { AcceptanceMatrix } from "@/components/acceptances/AcceptanceMatrix";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";

/**
 * The real matrix over the Pebbles acceptances, all groups expanded, so the
 * parity-gap rows the fixture pins are on screen. `AcceptanceMatrix` reads the
 * product override from the URL, hence the Suspense boundary.
 */
export function AcceptanceMatrixPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
    const pinned = new Set(FIXTURES["acceptance-matrix"].nodeIds!);
    const acceptances = bundle.nodes.filter((node) => node.species === "acceptance");
    // Pinned rows first, so the gap the copy talks about is the first thing seen.
    acceptances.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
    return { acceptances, nodesById };
  }, [bundle]);

  return (
    // Arbitrary property on purpose: globals.css traps the vertical wheel over every `.overflow-auto`.
    <div className="h-full [overflow:auto] p-3">
      <Suspense fallback={null}>
        <AcceptanceMatrix
          acceptances={props.acceptances}
          edges={bundle.edges}
          nodesById={props.nodesById}
          onSelect={() => {}}
          projectId={bundle.project.id}
          project={bundle}
          allExpanded
        />
      </Suspense>
    </div>
  );
}
