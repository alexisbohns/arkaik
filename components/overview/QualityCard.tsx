"use client";

import { GemIcon } from "lucide-react";
import { QualityGallery } from "@/components/quality/QualityGallery";
import { SurfaceScoreCard } from "@/components/quality/SurfaceScoreCard";
import type { SurfaceGauge } from "@/lib/utils/quality";
import { useOverviewLayoutContext } from "./OverviewLayoutContext";
import { OverviewSection } from "./OverviewSection";

interface QualityCardProps {
  /** One per audited surface (`buildSurfaceGauges`); empty when nothing is scored. */
  gauges: SurfaceGauge[];
  projectId: string;
}

/**
 * The audit's roll-up per surface: the matrix's own overall score, its grade,
 * and how much is still open there.
 *
 * **Absent when there is nothing audited**, on `ParityCard`'s precedent and for
 * its reason: a project with no Kritik section has not scored badly, it has not
 * scored at all, and a heading over "no audit yet" is a row of the dashboard
 * spent explaining its own absence — on every project that never adopts the
 * layer, that row would appear on every single visit. The empty check is the
 * gauges themselves rather than a `quality` flag, so an audit that exists but
 * has scored nothing is silent too, which is the same news.
 *
 * Not one number is computed here, and not one is *drawn* here either. The
 * gauges come from `buildSurfaceGauges`, and the item is the matrix's own
 * `SurfaceScoreCard` in the matrix's own `QualityGallery` — the same component
 * the Quality page's "Overall" row renders from the same gauges, so the two
 * surfaces cannot disagree about how the product is doing *or* about what a
 * surface's standing looks like.
 */
export function QualityCard({ gauges, projectId }: QualityCardProps) {
  const asRows = useOverviewLayoutContext() === "rows";

  if (gauges.length === 0) return null;

  // The findings these cards actually account for, not the section's total: a
  // finding filed on a surface the profile no longer declares has no gauge to
  // sit under, and counting it here would make the sum unexplainable from the
  // cards beneath it.
  const openFindings = gauges.reduce((total, gauge) => total + gauge.openFindings, 0);

  return (
    <OverviewSection
      title="Quality"
      icon={GemIcon}
      description="How the product scores against its audit pack, surface by surface."
      subtitle={`${openFindings} open finding${openFindings === 1 ? "" : "s"} across ${gauges.length} surface${gauges.length === 1 ? "" : "s"}`}
      href={`/project/${projectId}/quality/matrix`}
      linkLabel="Quality"
    >
      {/* The bleed is the shell's, not the gallery's: the card shell pads by 4
          and the cards should reach its edge, the row layout's content column
          has no padding to escape. */}
      <QualityGallery className={asRows ? undefined : "-mx-4 px-4"}>
        {gauges.map((gauge) => (
          <SurfaceScoreCard
            key={gauge.surface}
            title={gauge.title}
            score={gauge.score}
            grade={gauge.grade}
            meta={`${gauge.openFindings} open`}
            label={
              gauge.score === null
                ? `${gauge.title} — nothing scored`
                : `${gauge.title} — ${gauge.score} out of 100, grade ${gauge.grade} — ${gauge.openFindings} open findings`
            }
          />
        ))}
      </QualityGallery>
    </OverviewSection>
  );
}
