import { deriveQualityMatrix, resolveKritikLibrary, type QualityMatrixCell } from "@arkaik/schema";
import { LevelMeter } from "@/components/quality/LevelMeter";
import { SurfaceScoreCard } from "@/components/quality/SurfaceScoreCard";
import type { PreviewProps } from "@/components/landing/previews/types";
import { buildCellCriteria, buildSurfaceGauges } from "@/lib/utils/quality";

/** The cell whose criteria are listed under the cards: the weakest web domain. */
const DETAIL_DOMAIN = "SEC";
const DETAIL_SURFACE = "web";

/**
 * One score card per surface, then the criteria behind one cell with the
 * level each was scored at. Every number comes from the schema's own
 * projections over `bundle.quality`; the cards are the app's, rendered inert
 * (no `onClick`). A server component: only rendered props cross to the client.
 */
export function QualityMatrixPreview({ bundle }: PreviewProps) {
  const section = bundle.quality;
  const library = resolveKritikLibrary(section);
  const matrix = deriveQualityMatrix({ quality: section }, library);
  const gauges = buildSurfaceGauges(matrix, section, library);
  const criteria = buildCellCriteria(section, library, DETAIL_DOMAIN, DETAIL_SURFACE);
  const domainName = library?.domains.find((d) => d.code === DETAIL_DOMAIN)?.name ?? DETAIL_DOMAIN;
  const surfaceTitle = gauges.find((g) => g.surface === DETAIL_SURFACE)?.title ?? DETAIL_SURFACE;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      <div className="flex flex-wrap gap-2">
        {gauges.map((gauge) => (
          <SurfaceScoreCard
            key={gauge.surface}
            title={gauge.title}
            score={gauge.score}
            grade={gauge.grade}
            findings={sumFindings(matrix.matrix, gauge.surface)}
            meta={`${gauge.openFindings} open`}
            label={`${gauge.title}: ${gauge.score === null ? "not scored" : `${gauge.score} (${gauge.grade})`}`}
          />
        ))}
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {domainName} · {surfaceTitle}
        </p>
        <ul className="divide-y">
          {criteria.map((row) => (
            <li key={row.criterionId} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="font-mono text-[11px] text-muted-foreground">{row.criterionId}</span>
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <LevelMeter level={row.level} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Open findings by severity across every domain of one surface, for the card's dots. */
function sumFindings(
  cells: Record<string, Record<string, QualityMatrixCell | null>>,
  surface: string,
): QualityMatrixCell["findings"] {
  const total = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of Object.values(cells)) {
    const cell = row[surface];
    if (!cell) continue;
    total.critical += cell.findings.critical;
    total.high += cell.findings.high;
    total.medium += cell.findings.medium;
    total.low += cell.findings.low;
  }
  return total;
}
