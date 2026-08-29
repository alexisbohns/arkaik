"use client";

import { useMemo } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelSection } from "@/components/panels/PanelSection";
import { SEVERITY_DOT } from "@/components/quality/quality-styles";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CROSS_SURFACE_ID,
  MATURITY_LEVELS,
  type KritikCriterion,
  type KritikLibrary,
  type MaturityLevel,
  type QualityAssessment,
  type QualitySection,
} from "@arkaik/schema";
import { filterFindings, EMPTY_QUALITY_FILTERS, type FindingRow } from "@/lib/utils/quality";

interface CriterionDetailPanelProps {
  criterionId: string;
  /** The surface the panel was opened on; narrows the assessment and findings. */
  surface?: string;
  library?: KritikLibrary;
  section?: QualitySection;
  /**
   * Every finding in the section, denormalized once by `ProjectPanels` — not
   * this criterion's, and not sorted. The panel narrows and orders them itself;
   * see the memo note in the component for why the building happens up there.
   */
  findings: FindingRow[];
  onOpenNode: (nodeId: string) => void;
}

function criterionOf(criterionId: string, library?: KritikLibrary): KritikCriterion | undefined {
  return library?.criteria?.find((candidate) => candidate?.id === criterionId);
}

/** The domain's display name, falling back to its code, then to nothing. */
function domainLabelOf(criterion: KritikCriterion | undefined, library?: KritikLibrary): string {
  const code = typeof criterion?.domain === "string" ? criterion.domain : "";
  if (code === "") return "";
  return library?.domains?.find((domain) => domain?.code === code)?.name ?? code;
}

/** A surface id as the profile titles it; the raw id when the profile has moved on. */
function surfaceTitleOf(surface: string | undefined, section?: QualitySection): string {
  if (!surface) return "";
  return section?.profile?.surfaces?.find((candidate) => candidate?.id === surface)?.title ?? surface;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** The anchors that exist, in level order. A pack may write some and skip others. */
function anchorRowsOf(criterion: KritikCriterion | undefined): { level: MaturityLevel; text: string }[] {
  const anchors = criterion?.level_anchors;
  if (!anchors) return [];

  const rows: { level: MaturityLevel; text: string }[] = [];
  for (const level of MATURITY_LEVELS) {
    // `noUncheckedIndexedAccess` is off, so this lookup types as `string` even
    // when the key is absent — the guard is what makes that type true.
    const text = anchors[`l${level}`];
    if (typeof text === "string" && text.trim() !== "") rows.push({ level, text });
  }
  return rows;
}

/** Strings from a pack field that may be absent, non-array, or padded with blanks. */
function textListOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

interface ReferenceRow {
  label: string;
  anchor: string;
  url: string;
}

/**
 * The criterion's external anchors, reduced to what a row needs.
 *
 * A reference with neither a title nor a url is dropped rather than rendered as
 * a blank line, which is the same rule the sections follow one level up: the
 * panel shows what exists, and nothing stands in for what does not.
 */
function referenceRowsOf(criterion: KritikCriterion | undefined): ReferenceRow[] {
  if (!Array.isArray(criterion?.references)) return [];

  return criterion.references
    .map((reference) => ({
      label: reference?.title ?? reference?.url ?? "",
      anchor: reference?.anchor ?? "",
      url: reference?.url ?? "",
    }))
    .filter((row) => row.label !== "");
}

/**
 * The surface this panel is narrowed to, or `undefined` for "every surface".
 *
 * An empty string collapses to `undefined` because the stack already treats the
 * two as one panel — `criterionPanelKey(id, "")` and `criterionPanelKey(id)`
 * are the same key. Left alone it would narrow every list below to a surface no
 * assessment names, and the panel would render as if the audit had skipped this
 * criterion, which is the one thing an empty `?csurface=` does not mean.
 */
function surfaceScope(surface?: string): string | undefined {
  return surface === "" ? undefined : surface;
}

/** Milliseconds behind an assessment's `ts`, or `NaN` when there is none to read. */
function timeOf(assessment: QualityAssessment): number {
  return typeof assessment.ts === "string" ? new Date(assessment.ts).getTime() : NaN;
}

/**
 * This criterion's assessments — latest per surface, narrowed to one surface
 * when the panel names one.
 *
 * Collapsed to one row per cell rather than listed as stored, because
 * `quality-duplicate-assessment` is a *warning*: a bundle carrying two scores
 * for one (criterion × surface) contradicts what the section says it is —
 * `QualitySection.assessments` is documented "latest per cell", and
 * `upsertAssessment` replaces in place so the sanctioned writer cannot produce
 * one — and yet it validates and arrives here. Three things below assume one
 * row per cell: the React key, the `Evidence` / `Evidence by surface` heading,
 * and `scoredLevel`, which marks an anchor only when there is exactly one level
 * to mark. Collapsing fixes all three at the source, and shows the reader the
 * score the section claims to hold; rendering both would make this panel the
 * one place in the codebase that treats a cell as having two answers.
 *
 * Latest by `ts`, the field that exists to say when. A tie, or a `ts` that does
 * not parse, keeps the later row: appending is how a second score gets in at
 * all, so the one written last is the one meant to win.
 */
function assessmentsOn(
  criterionId: string,
  surface?: string,
  section?: QualitySection,
): QualityAssessment[] {
  const scope = surfaceScope(surface);
  const latest = new Map<string, QualityAssessment>();

  for (const assessment of section?.assessments ?? []) {
    if (assessment?.criterion_id !== criterionId) continue;
    if (scope !== undefined && assessment.surface !== scope) continue;

    // `>` and not `>=`: every comparison against `NaN` is false, so an equal or
    // unreadable timestamp falls through to "the later row wins".
    const held = latest.get(assessment.surface);
    if (held !== undefined && timeOf(held) > timeOf(assessment)) continue;
    latest.set(assessment.surface, assessment);
  }

  return [...latest.values()];
}

/**
 * This criterion's findings among the section's, worst first.
 *
 * The rows arrive already denormalized — see the memo note in the component —
 * but the sort still comes from `filterFindings`, so this panel and the board
 * agree about which finding is worst. Both narrowings happen after that sort,
 * which a filter cannot disturb: the filter set has no criterion axis, because
 * the board never needs one, and no room for the cross-surface rule either.
 *
 * A scoped panel keeps `cross-surface` alongside its own surface's rows.
 * `CROSS_SURFACE_ID` is a findings-only lens — it holds no assessments and so
 * never becomes a matrix column, which makes this panel the only place a reader
 * meets one. Dropping it when the panel is scoped would hide exactly the defect
 * that belongs to no single surface, and so to nobody in particular.
 * `FindingRowItem` marks those rows so they cannot be read as the scoped
 * surface's own.
 *
 * At module scope, like `assessmentsOn` above: the panel is a pure read, so
 * everything it derives is a function of its props, and pulling those functions
 * out of the component leaves the component itself nothing but layout.
 */
function findingsOn(rows: FindingRow[], criterionId: string, surface?: string): FindingRow[] {
  const scope = surfaceScope(surface);

  return filterFindings(rows, EMPTY_QUALITY_FILTERS).filter(
    (row) =>
      row.criterionId === criterionId &&
      (scope === undefined || row.surface === scope || row.surface === CROSS_SURFACE_ID),
  );
}

/**
 * What identifies the panel in the stack's header — the domain, the criterion
 * id, its name, and the surface being read. The close button belongs to
 * `PanelStack`, which owns every panel's frame.
 */
export function CriterionDetailPanelHeader({
  criterionId,
  surface,
  library,
  section,
}: Omit<CriterionDetailPanelProps, "onOpenNode" | "findings">) {
  const criterion = criterionOf(criterionId, library);
  const domainLabel = domainLabelOf(criterion, library);
  const name = typeof criterion?.name === "string" ? criterion.name : "";
  const surfaceTitle = surfaceTitleOf(surface, section);

  return (
    <>
      {domainLabel !== "" && (
        <span className="inline-flex shrink-0 items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {domainLabel}
        </span>
      )}
      <EntityId id={criterionId} />
      {name !== "" && <span className="truncate text-sm font-medium">{name}</span>}
      {surfaceTitle !== "" && (
        <span className="shrink-0 text-xs text-muted-foreground">{surfaceTitle}</span>
      )}
    </>
  );
}

/**
 * One criterion, as the pack defines it and as this project scored it.
 *
 * Addressless in the stack — see the head of `lib/utils/project-panels.ts`. It
 * is also the one panel whose subject is not in the graph: a criterion is
 * library content, so everything above the evidence is identical in every
 * project pinning the same pack, and only the last two sections are this
 * project's.
 *
 * **Every section is conditional, and that is the feature.**
 * `resolveKritikLibrary` synthesizes a library when a bundle embeds no pack:
 * domain codes become names, every weight is 1, and there is no question, no
 * anchor, no reference and no checklist to show. That is a supported state, so
 * a panel with nothing to say about the criterion says *that* in one line —
 * five empty prose headings would read as a broken panel rather than as a
 * bundle travelling without its pack.
 */
export function CriterionDetailPanel({
  criterionId,
  surface,
  library,
  section,
  findings,
  onOpenNode,
}: CriterionDetailPanelProps) {
  const criterion = criterionOf(criterionId, library);
  const question = typeof criterion?.question === "string" ? criterion.question : "";
  const definition = typeof criterion?.definition === "string" ? criterion.definition : "";
  const remediation = typeof criterion?.remediation === "string" ? criterion.remediation : "";
  const anchors = anchorRowsOf(criterion);
  const checklist = textListOf(criterion?.checklist);
  const signals = textListOf(criterion?.signals);
  const references = referenceRowsOf(criterion);

  // The tell for a library `resolveKritikLibrary` invented: it can recover ids,
  // domains and weights from the assessments alone, but nothing it synthesizes
  // has prose. So the test is "no prose at all" rather than a flag — which
  // keeps it honest for the third case too, a real pack that simply does not
  // define this criterion — and it has to be all of them, because every prose
  // field on `KritikCriterion` is optional. A pack criterion written as a
  // definition and a checklist, with no question and no anchors, is a real one,
  // and a narrower test would print "this bundle does not carry the criteria
  // pack" directly above that criterion's own pack prose.
  const packEmbedded =
    question !== "" ||
    definition !== "" ||
    remediation !== "" ||
    anchors.length > 0 ||
    checklist.length > 0 ||
    signals.length > 0 ||
    references.length > 0;

  // Memoized by hand because nothing memoizes for us: this app does not run the
  // React Compiler — `next.config.ts` sets no `reactCompiler` and
  // `babel-plugin-react-compiler` is not installed — so the compiler reaches
  // the repo only as the lint rules in `eslint-plugin-react-hooks`, where
  // `preserve-manual-memoization` is an *error* and CI gates on lint.
  //
  // That rule is also why the rows arrive as a prop. One `useMemo` around the
  // whole derivation — building every row in the section, then narrowing — is a
  // memo the rule refuses; bisected, the same memo around `assessmentsOn` is
  // clean and adding the `findings` one is the error. Recomputing instead would
  // rebuild every row in the section on every render this panel's parent has,
  // so the section-wide half moved up to `ProjectPanels`, which derives it once
  // for the whole stack, and what is left here is a narrowing over a prop.
  const assessments = useMemo(
    () => assessmentsOn(criterionId, surface, section),
    [criterionId, surface, section],
  );
  const criterionFindings = useMemo(
    () => findingsOn(findings, criterionId, surface),
    [findings, criterionId, surface],
  );

  // Marked only when there is exactly one: opened without a surface, a criterion
  // carries one level per surface, and highlighting five anchors at once would
  // say nothing about any of them.
  const scoredLevel = assessments.length === 1 ? assessments[0].level : undefined;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-4 pb-6 pt-4">
      {!packEmbedded && (
        <p className="px-6 text-sm text-muted-foreground">
          This bundle does not carry the criteria pack, so what this criterion asks is not
          available here — only the score and findings recorded against it.
        </p>
      )}

      {question !== "" && (
        <p className="px-6 text-sm leading-relaxed text-foreground">{question}</p>
      )}

      {definition !== "" && (
        <PanelSection title="Definition">
          <p className="text-sm leading-relaxed text-muted-foreground">{definition}</p>
        </PanelSection>
      )}

      {anchors.length > 0 && (
        <PanelSection title="Maturity anchors">
          <ol className="flex flex-col gap-1">
            {anchors.map(({ level, text }) => {
              const scored = level === scoredLevel;
              return (
                <li
                  key={level}
                  aria-current={scored ? "true" : undefined}
                  className={cn(
                    "flex gap-2 rounded-md px-2 py-1.5 text-sm",
                    scored && "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 font-mono text-xs",
                      scored ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    L{level}
                  </span>
                  <span className="flex-1 leading-relaxed text-muted-foreground">{text}</span>
                  {scored && (
                    <Badge variant="secondary" className="shrink-0 self-start">
                      Scored
                    </Badge>
                  )}
                </li>
              );
            })}
          </ol>
        </PanelSection>
      )}

      {assessments.length > 0 && (
        <PanelSection title={assessments.length === 1 ? "Evidence" : "Evidence by surface"}>
          <div className="flex flex-col gap-2">
            {assessments.map((assessment) => (
              <div
                // Unique because `assessmentsOn` collapses the list to one row
                // per cell — the bundle itself only warns about a second.
                key={`${assessment.criterion_id}@${assessment.surface}`}
                className="flex flex-col gap-1.5 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Level {assessment.level}</span>
                  {/* The surface is repeated here even when the panel is scoped to
                      one, because this block is the thing a reader quotes. */}
                  <span>{surfaceTitleOf(assessment.surface, section)}</span>
                  {assessment.audit_id && <span>· {assessment.audit_id}</span>}
                  {assessment.ts && (
                    <time dateTime={assessment.ts}>· {formatDate(assessment.ts)}</time>
                  )}
                </div>
                {typeof assessment.evidence === "string" && assessment.evidence.trim() !== "" && (
                  <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
                    {assessment.evidence}
                  </p>
                )}
              </div>
            ))}
          </div>
        </PanelSection>
      )}

      {checklist.length > 0 && (
        <PanelSection title="Checklist">
          <ul className="flex list-disc flex-col gap-1.5 pl-4">
            {checklist.map((step, index) => (
              <li key={index} className="text-sm leading-relaxed text-muted-foreground">
                {step}
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {references.length > 0 && (
        <PanelSection title="References">
          <div className="flex flex-col gap-0.5">
            {references.map((reference, index) =>
              reference.url !== "" ? (
                <a
                  key={index}
                  href={reference.url}
                  target="_blank"
                  rel="nofollow noreferrer"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                >
                  <ExternalLinkIcon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate">{reference.label}</span>
                  {reference.anchor !== "" && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {reference.anchor}
                    </span>
                  )}
                </a>
              ) : (
                <span key={index} className="px-2 py-1.5 text-sm text-muted-foreground">
                  {reference.label}
                  {reference.anchor !== "" && ` — ${reference.anchor}`}
                </span>
              ),
            )}
          </div>
        </PanelSection>
      )}

      {signals.length > 0 && (
        <PanelSection title="Signals">
          <ul className="flex list-disc flex-col gap-1.5 pl-4">
            {signals.map((signal, index) => (
              <li key={index} className="text-sm leading-relaxed text-muted-foreground">
                {signal}
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {remediation !== "" && (
        <PanelSection title="Remediation">
          <p className="text-sm leading-relaxed text-muted-foreground">{remediation}</p>
        </PanelSection>
      )}

      {criterionFindings.length > 0 && (
        <PanelSection title="Findings">
          <div className="flex flex-col gap-2">
            {criterionFindings.map((finding) => (
              <FindingRowItem
                key={finding.id}
                row={finding}
                showSurface={surfaceScope(surface) === undefined}
                surfaceTitle={surfaceTitleOf(finding.surface, section)}
                onOpenNode={onOpenNode}
              />
            ))}
          </div>
        </PanelSection>
      )}
    </div>
  );
}

interface FindingRowItemProps {
  row: FindingRow;
  /**
   * The surface only earns a line when the panel is not already scoped to one.
   * A cross-surface row ignores this and carries its own marker either way.
   */
  showSurface: boolean;
  surfaceTitle: string;
  onOpenNode: (nodeId: string) => void;
}

/**
 * One finding, at reading depth rather than triage depth.
 *
 * The board is where a finding is worked; here it is context for the criterion,
 * so this row carries what identifies it and the way back into the graph, and
 * leaves the detail and the evidence to the board's card. Resolved and refuted
 * findings are listed too — what a criterion has already survived is part of
 * what it asks — with their status stated so nobody reads history as a to-do.
 */
function FindingRowItem({ row, showSurface, surfaceTitle, onOpenNode }: FindingRowItemProps) {
  // Marked beside the title rather than down in the meta line, which is where a
  // reader stops looking the moment the panel is scoped — down there the
  // surface is implied, and a contract finding is precisely the row that is not
  // the scoped surface's. It is also the row least likely to be picked up
  // anywhere else, since no matrix column carries it.
  const crossSurface = row.surface === CROSS_SURFACE_ID;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <span
          className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY_DOT[row.severity])}
          aria-hidden="true"
        />
        <span className="flex-1 text-sm leading-relaxed">{row.title}</span>
        {crossSurface && (
          <Badge variant="outline" className="shrink-0">
            Cross-surface
          </Badge>
        )}
        {!row.open && (
          <Badge variant="outline" className="shrink-0">
            {row.status}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-xs text-muted-foreground">
        <span>{row.severity}</span>
        <span>
          · {row.impact} × {row.likelihood} = {row.risk}
        </span>
        <span>· {row.priority}</span>
        <span>· cost {row.cost}</span>
        {showSurface && !crossSurface && surfaceTitle !== "" && <span>· {surfaceTitle}</span>}
        {row.issueUrl && (
          <a
            href={row.issueUrl}
            target="_blank"
            rel="nofollow noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Issue
          </a>
        )}
      </div>
      {row.nodeIds.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-4">
          {row.nodeIds.map((nodeId) => (
            <button
              key={nodeId}
              type="button"
              onClick={() => onOpenNode(nodeId)}
              className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {nodeId}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
