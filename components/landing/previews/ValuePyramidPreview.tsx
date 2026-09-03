import { PyramidElementCard } from "@/components/pyramid/PyramidElementCard";
import { PyramidTierGroup } from "@/components/pyramid/PyramidTierGroup";
import type { PreviewProps } from "@/components/landing/previews/types";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { SEED_PROJECT_ID } from "@/lib/data/seed-project-id";
import { computePyramidAggregation } from "@/lib/utils/pyramid";

const VALUE_LABEL = Object.fromEntries(VALUES.map((v) => [v.id, v.label]));
const VALUE_DESCRIPTION = Object.fromEntries(VALUES.map((v) => [v.id, v.description]));

/**
 * One tier of the pyramid over every acceptance of Arkaik's own map: the tier
 * with the most addressed elements, its three most-covered elements as cards.
 * Cards link into the public self-map's acceptance matrix, pre-filtered.
 * A server component: only the props the leaf renders cross to the client.
 */
export function ValuePyramidPreview({ bundle }: PreviewProps) {
  const acceptances = bundle.nodes.filter((node) => node.species === "acceptance");
  const scored = computePyramidAggregation(acceptances).map((t) => ({
    ...t,
    addressed: t.elements.filter((e) => e.acceptanceCount > 0).length,
  }));
  scored.sort((a, b) => b.addressed - a.addressed);
  const best = scored[0];
  if (!best) return null;
  const elements = [...best.elements].sort((a, b) => b.acceptanceCount - a.acceptanceCount).slice(0, 3);
  const config = VALUE_TIERS_CONFIG.find((c) => c.id === best.tier);
  const label = config?.label ?? best.tier;
  const color = config?.color ?? "#94a3b8";

  return (
    <div className="h-full overflow-hidden p-4">
      <PyramidTierGroup label={label} color={color} elementCount={elements.length} addressedCount={best.addressed}>
        {elements.map((element) => (
          <PyramidElementCard
            key={element.value}
            element={element}
            label={VALUE_LABEL[element.value]}
            description={VALUE_DESCRIPTION[element.value]}
            href={`/project/${SEED_PROJECT_ID}/acceptances?value=${element.value}`}
            platforms={["web"]}
          />
        ))}
      </PyramidTierGroup>
    </div>
  );
}
