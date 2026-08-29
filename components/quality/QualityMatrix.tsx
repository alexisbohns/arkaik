"use client";

import { useMemo } from "react";
import { XIcon } from "lucide-react";
import {
  gradeOf,
  type KritikLibrary,
  type MaturityLevel,
  type QualityGrade,
  type QualityMatrix as QualityMatrixData,
  type QualityMatrixCell,
  type QualitySection,
} from "@arkaik/schema";
import { buildCellCriteria, cellKey, parseCellKey, type CriterionRow } from "@/lib/utils/quality";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { GRADE_TINT, SEVERITY_DOT, SEVERITY_LABEL } from "@/components/quality/quality-styles";

interface QualityMatrixProps {
  matrix: QualityMatrixData;
  section?: QualitySection;
  library?: KritikLibrary;
  /**
   * `surface id -> title`, built once on the page. A prop rather than a
   * derivation of `section` here, so the column headers and the finding cards
   * below the table read one map — see `buildSurfaceTitles`.
   */
  surfaceTitles: ReadonlyMap<string, string>;
  /** The open cell as `cellKey` encodes it, or `null`. Owned by the URL. */
  activeCell: string | null;
  onSelectCell: (key: string | null) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/**
 * The severities a cell tallies. `QualityMatrixCell.findings` has no `info`
 * key — the pack's lowest bucket is a note, not a defect a cell should carry —
 * so this is read off the cell's own shape rather than off `FINDING_SEVERITIES`,
 * which would produce a fifth dot column that is always empty.
 */
const CELL_SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** At most this many dots per severity; the true count stays in the label. */
const MAX_DOTS = 4;

/** `domain code -> display name`, as the pack writes it. */
function domainNames(library?: KritikLibrary): Map<string, string> {
  const names = new Map<string, string>();
  for (const domain of library?.domains ?? []) {
    if (typeof domain?.code === "string") names.set(domain.code, domain.name ?? domain.code);
  }
  return names;
}

/**
 * The grade bands in force, read off `gradeOf` rather than off
 * `DEFAULT_GRADE_BANDS`.
 *
 * A pack may move a band through `scales.grades`, and a legend quoting the
 * defaults would then explain the matrix with numbers the matrix does not use.
 * Walking 0–100 through the very function the cells were graded by makes that
 * impossible: the legend is a readout of the scale in force, not a second copy
 * of it. A hundred and one calls, once per render of a table that already runs
 * fifty-five cells.
 */
function gradeBands(library?: KritikLibrary): { grade: QualityGrade; min: number }[] {
  const lowest = new Map<QualityGrade, number>();
  for (let score = 0; score <= 100; score++) {
    const grade = gradeOf(score, library);
    if (!lowest.has(grade)) lowest.set(grade, score);
  }
  return [...lowest.entries()].map(([grade, min]) => ({ grade, min })).sort((a, b) => b.min - a.min);
}

/**
 * What a cell says, spelled out for the button's accessible name and its
 * `title`. It is also where the dot cap is made harmless: the dots stop at
 * four, this does not, so a cell with nine open Criticals still reports nine to
 * anyone who hovers or listens.
 */
function cellLabel(domainName: string, surfaceTitle: string, cell: QualityMatrixCell): string {
  const findings = CELL_SEVERITIES.filter((severity) => cell.findings[severity] > 0)
    .map((severity) => `${cell.findings[severity]} ${SEVERITY_LABEL[severity].toLowerCase()}`)
    .join(", ");

  return [
    `${domainName} on ${surfaceTitle}`,
    `${cell.score} out of 100, grade ${cell.grade}${cell.capped ? ", capped by an open finding" : ""}`,
    `${cell.criteria} criteria scored`,
    findings === "" ? "no open findings" : `open findings: ${findings}`,
  ].join(" — ");
}

/** One dot per open finding, worst severity first, {@link MAX_DOTS} at most each. */
function FindingDots({ findings }: { findings: QualityMatrixCell["findings"] }) {
  const shown = CELL_SEVERITIES.flatMap((severity) =>
    Array.from({ length: Math.min(findings[severity], MAX_DOTS) }, (_, index) => ({
      key: `${severity}-${index}`,
      severity,
    })),
  );
  if (shown.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center justify-center gap-0.5" aria-hidden="true">
      {shown.map((dot) => (
        <span key={dot.key} className={cn("size-1.5 rounded-full", SEVERITY_DOT[dot.severity])} />
      ))}
    </span>
  );
}

/** A 0–4 maturity level as a four-segment meter beside its number. */
function LevelMeter({ level }: { level: MaturityLevel }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5" aria-label={`Level ${level} of 4`}>
      <span className="font-mono text-[10px] text-muted-foreground">L{level}</span>
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn("h-1.5 w-3 rounded-full", step <= level ? "bg-foreground/70" : "bg-muted")}
          />
        ))}
      </span>
    </span>
  );
}

interface CriteriaStripProps {
  domainName: string;
  surfaceTitle: string;
  surface: string;
  criteria: CriterionRow[];
  onClose: () => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/**
 * The criteria behind the open cell.
 *
 * Between the matrix and the board rather than inside a panel, because it is
 * the answer to the question clicking a cell asks — *why* is this a C — and
 * that answer is a list, not a document. The document is one row further in,
 * behind {@link CriteriaStripProps.onOpenCriterion}.
 */
function CriteriaStrip({
  domainName,
  surfaceTitle,
  surface,
  criteria,
  onClose,
  onOpenCriterion,
}: CriteriaStripProps) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h3 className="text-sm font-medium">
          {domainName} <span className="text-muted-foreground">×</span> {surfaceTitle}
        </h3>
        <span className="text-xs text-muted-foreground">
          {criteria.length} criteri{criteria.length === 1 ? "on" : "a"} scored
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the cell"
          className="ms-auto rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </header>

      {criteria.length === 0 ? (
        // Reachable only from a hand-typed `?cell=`, since a cell with no
        // assessments renders N/A and is not a button. Said in words anyway:
        // an empty strip with a heading reads as a strip that failed to load.
        <p className="px-3 py-2.5 text-sm text-muted-foreground">
          Nothing was scored in this cell.
        </p>
      ) : (
        <ul>
          {criteria.map((row) => (
            <li key={row.criterionId}>
              <button
                type="button"
                onClick={() => onOpenCriterion(row.criterionId, surface)}
                className="flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
              >
                <EntityId id={row.criterionId} />
                <LevelMeter level={row.level} />
                <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                {row.openFindings > 0 && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {row.openFindings} open
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The comparative matrix: domains down, surfaces across, one weighted maturity
 * score per cell with the grade it bands to and the open findings weighing on
 * it.
 *
 * Nothing here scores anything. `deriveQualityMatrix` produced every number,
 * `gradeOf` bands the roll-up row, and the caps were applied before this
 * component saw a cell — which is why a grade can read a letter worse than its
 * score, and why the legend has to say so.
 */
export function QualityMatrix({
  matrix,
  section,
  library,
  surfaceTitles,
  activeCell,
  onSelectCell,
  onOpenCriterion,
}: QualityMatrixProps) {
  const names = useMemo(() => domainNames(library), [library]);
  const bands = useMemo(() => gradeBands(library), [library]);
  const active = parseCellKey(activeCell);
  // Keyed on the encoded string, not on `active`: `parseCellKey` returns a
  // fresh object every render, so a memo depending on it would miss every
  // time. This is the one derivation here that walks the section's whole
  // assessment and finding lists — the pilot audit's are 338 and 246 — so the
  // miss is the difference worth spending a memo on.
  const cellCriteria = useMemo(() => {
    const cell = parseCellKey(activeCell);
    return cell ? buildCellCriteria(section, library, cell.domain, cell.surface) : [];
  }, [activeCell, section, library]);

  const titleOf = (surface: string) => surfaceTitles.get(surface) ?? surface;
  const nameOf = (domain: string) => names.get(domain) ?? domain;

  return (
    <div className="flex flex-col gap-3">
      {/*
        The table owns a horizontal scrollport of its own. Eleven domains by
        five surfaces overflows a narrow viewport — one squeezed by two open
        panels, above all — and the page must never scroll horizontally as a
        whole. `Table`'s container also pins `overflow-y-hidden`, which is what
        keeps a wheel over the table from dying against `overscroll-behavior:
        contain`; the comment in `components/ui/table.tsx` has that in full.
      */}
      <Table containerClassName="rounded-xl border bg-card">
        <TableHeader>
          {/* The rows are not clickable — the cells inside them are — so the
              row hover is dropped rather than left to light up a whole row on
              the way to one button. */}
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 bg-card">Domain</TableHead>
            {matrix.surfaces.map((surface) => (
              <TableHead key={surface} className="text-center">
                {titleOf(surface)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {matrix.domains.map((domain) => (
            <TableRow key={domain} className="hover:bg-transparent">
              <TableHead scope="row" className="sticky left-0 z-10 bg-card font-normal">
                <span className="flex flex-col">
                  <span className="text-sm">{nameOf(domain)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{domain}</span>
                </span>
              </TableHead>

              {matrix.surfaces.map((surface) => {
                const cell = matrix.matrix[domain]?.[surface] ?? null;
                const key = cellKey(domain, surface);
                const isActive = activeCell === key;

                return (
                  <TableCell key={surface} className="p-1">
                    {cell === null ? (
                      // Not a button and no hover: nothing was scored here, so
                      // there is nothing to open and no findings to narrow to.
                      <span className="flex h-16 w-24 items-center justify-center text-xs text-muted-foreground">
                        N/A
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectCell(isActive ? null : key)}
                        aria-pressed={isActive}
                        aria-label={cellLabel(nameOf(domain), titleOf(surface), cell)}
                        title={cellLabel(nameOf(domain), titleOf(surface), cell)}
                        className={cn(
                          "flex h-16 w-24 flex-col items-center justify-center gap-1 rounded-md px-1 transition-all",
                          GRADE_TINT[cell.grade],
                          "hover:ring-1 hover:ring-inset hover:ring-foreground/30",
                          isActive && "ring-2 ring-inset ring-foreground/70",
                        )}
                      >
                        <span className="text-lg font-semibold leading-none tabular-nums">{cell.score}</span>
                        <span className="text-[11px] font-medium leading-none">
                          {cell.grade}
                          {cell.capped && "*"}
                        </span>
                        <FindingDots findings={cell.findings} />
                      </button>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>

        {/*
          The surface roll-up, in a `tfoot` so it reads as a summary of the rows
          above rather than as a twelfth domain. It is banded straight off its
          score with no caps re-applied — `deriveQualityMatrix` deliberately
          declined to fold them in here, since a cap shapes the cell you act on
          and folding it into the roll-up too would punish one finding twice.
        */}
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            {/* Opaque `bg-muted`, not the row's own translucent `bg-muted/50`:
                cells scroll *under* a sticky column, and a half-transparent one
                would show them passing through. */}
            <TableHead scope="row" className="sticky left-0 z-10 bg-muted text-xs uppercase tracking-wide">
              Overall
            </TableHead>
            {matrix.surfaces.map((surface) => {
              const score = matrix.overall[surface] ?? null;
              return (
                <TableCell key={surface} className="p-1 text-center">
                  {score === null ? (
                    <span className="text-xs text-muted-foreground">N/A</span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex h-10 w-24 items-center justify-center gap-1.5 rounded-md",
                        GRADE_TINT[gradeOf(score, library)],
                      )}
                    >
                      <span className="text-base font-semibold tabular-nums">{score}</span>
                      <span className="text-[11px] font-medium">{gradeOf(score, library)}</span>
                    </span>
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        </TableFooter>
      </Table>

      {active && (
        <CriteriaStrip
          domainName={nameOf(active.domain)}
          surfaceTitle={titleOf(active.surface)}
          surface={active.surface}
          criteria={cellCriteria}
          onClose={() => onSelectCell(null)}
          onOpenCriterion={onOpenCriterion}
        />
      )}

      {/*
        The legend earns its place on one line: a grade a letter worse than its
        own number is unexplainable without it, and the dots are colour with no
        key anywhere else on the page.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex flex-wrap items-center gap-2">
          {bands.map((band, index) => (
            <span key={band.grade} className={cn("rounded px-1.5 py-0.5 font-medium", GRADE_TINT[band.grade])}>
              {band.grade} {band.min === 0 && index > 0 ? `below ${bands[index - 1].min}` : `${band.min}+`}
            </span>
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          {CELL_SEVERITIES.map((severity) => (
            <span key={severity} className="flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[severity])} aria-hidden="true" />
              {SEVERITY_LABEL[severity]}
            </span>
          ))}
          <span>· open findings, {MAX_DOTS} dots at most each</span>
        </span>
        <span>
          <span className="font-medium text-foreground">*</span> an open Critical or High finding capped
          this grade below the band its score earned
        </span>
      </div>
    </div>
  );
}
