"use client";

/**
 * The Acceptances directory's body: the view the reader chose, drawn from the one
 * model (lib/utils/acceptances-model.ts). The page owns data, filters and the
 * view switch; this owns what goes under them.
 */
import type { Node } from "@/lib/data/types";
import type { AcceptancesModel } from "@/lib/utils/acceptances-model";
import type { DirectoryViewId } from "./directory-views";
import { ContentsView } from "./ContentsView";

export function AcceptancesDirectory({ model, view, onSelect }: { model: AcceptancesModel; view: DirectoryViewId; onSelect: (node: Node) => void }) {
  return (
    <div data-acceptances-page data-acceptances-view={view} className="flex min-h-full flex-col">
      <ContentsView mapping={model.mapping} onSelect={onSelect} />
    </div>
  );
}
