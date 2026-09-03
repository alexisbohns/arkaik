"use client";

import { useMemo } from "react";
import { DeliveryBoard } from "@/components/delivery/DeliveryBoard";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { SPECIES } from "@/lib/config/species";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import { sliceBundle } from "@/lib/landing/slice";
import { computeDeliveryItems, groupItemsByStatus } from "@/lib/utils/delivery";

const COLUMNS: StatusId[] = ["idea", "development", "live"];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label])) as Record<StatusId, string>;
const SPECIES_LABEL = Object.fromEntries(SPECIES.map((s) => [s.id, s.label]));
const SPECIES_DESCRIPTION = Object.fromEntries(SPECIES.map((s) => [s.id, s.description]));

/** Three columns of the real board over five Pebbles views; one of them sits in two columns. */
export function DeliveryBoardPreview({ bundle }: PreviewProps) {
  const columns = useMemo(() => {
    const slice = sliceBundle(bundle, FIXTURES["delivery-board"].nodeIds!);
    const grouped = groupItemsByStatus(computeDeliveryItems(slice.nodes, ["view"]), COLUMNS);
    return COLUMNS.map((status) => ({ status, label: STATUS_LABEL[status], items: grouped.get(status) ?? [] }));
  }, [bundle]);

  return (
    <div className="h-full overflow-x-auto p-3">
      <DeliveryBoard columns={columns} speciesLabelById={SPECIES_LABEL} speciesDescriptionById={SPECIES_DESCRIPTION} onSelectItem={() => {}} />
    </div>
  );
}
