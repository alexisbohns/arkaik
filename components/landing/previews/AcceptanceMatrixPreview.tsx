import { Suspense } from "react";
import { FIXTURES } from "@/components/landing/fixtures";
import { ReadOnlyAcceptanceMatrix } from "@/components/landing/previews/client/ReadOnlyAcceptanceMatrix";
import type { PreviewProps } from "@/components/landing/previews/types";

/**
 * The real matrix over the Pebbles acceptances, all groups expanded, so the
 * parity-gap rows the fixture pins are on screen. `AcceptanceMatrix` reads the
 * product override from the URL, hence the Suspense boundary. A server
 * component: only the props the leaf renders cross to the client.
 */
export function AcceptanceMatrixPreview({ bundle }: PreviewProps) {
  const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
  const pinned = new Set(FIXTURES["acceptance-matrix"].nodeIds!);
  const acceptances = bundle.nodes.filter((node) => node.species === "acceptance");
  // Pinned rows first, so the gap the copy talks about is the first thing seen.
  acceptances.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));

  return (
    // Arbitrary property on purpose: globals.css traps the vertical wheel over every `.overflow-auto`.
    <div className="h-full [overflow:auto] p-3">
      <Suspense fallback={null}>
        <ReadOnlyAcceptanceMatrix
          acceptances={acceptances}
          edges={bundle.edges}
          nodesById={nodesById}
          projectId={bundle.project.id}
          // Neither `AcceptanceMatrix` nor `useEffectiveProduct` (nor the
          // product-scope resolver under it) reads `journal` — they only need
          // `project` and `products` — so the journal stays on the server.
          project={{ ...bundle, journal: [] }}
          allExpanded
        />
      </Suspense>
    </div>
  );
}
