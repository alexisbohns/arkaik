"use client";

import { useMemo } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { PanelHeaderEntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelSection, PANEL_GUTTER, PANEL_GUTTER_BLEED } from "@/components/panels/PanelSection";
import { cn } from "@/lib/utils";
import { FindingsBoard } from "@/components/quality/FindingsBoard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KritikLibrary, QualitySection } from "@arkaik/schema";
import { buildCriterionModel, buildSurfaceTitles, type FindingRow } from "@/lib/utils/quality";

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
  onOpenFinding: (findingId: string) => void;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
}: Omit<CriterionDetailPanelProps, "onOpenFinding" | "findings">) {
  // No rows: the header reads the criterion's identity, never its findings.
  const { domainLabel, surfaceTitle } = buildCriterionModel(criterionId, surface, library, section, []);

  return (
    // `display: contents`: a hook for the panel stylesheet, not a box —
    // the header row stays `PanelStack`'s.
    <div className="contents" data-quality-panel-header="criterion">
      {/* Grouped so the two chips never separate when the header row runs out
          of room; the row itself is `PanelStack`'s. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {domainLabel !== "" && (
          <span className="inline-flex shrink-0 items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {domainLabel}
          </span>
        )}
        <PanelHeaderEntityId id={criterionId} />
      </div>
      {surfaceTitle !== "" && (
        <span className="shrink-0 text-xs text-muted-foreground">{surfaceTitle}</span>
      )}
    </div>
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
  onOpenFinding,
}: CriterionDetailPanelProps) {
  // Every rule — what the pack says, the latest assessment per surface, the
  // scored level, the anchor to open on, the findings in scope — is
  // `buildCriterionModel`'s (lib/utils/quality.ts), tested there.
  //
  // The rows arrive as a prop because building every row in the section is
  // the expensive half, and `ProjectPanels` derives it once for the whole
  // stack; what is left here is a narrowing over that prop.
  const model = useMemo(
    () => buildCriterionModel(criterionId, surface, library, section, findings),
    [criterionId, surface, library, section, findings],
  );
  const {
    name,
    question,
    definition,
    remediation,
    anchors,
    checklist,
    signals,
    references,
    packEmbedded,
    assessments,
    scoredLevel,
    defaultAnchorLevel,
    findings: criterionFindings,
  } = model;
  const surfaceTitles = useMemo(() => buildSurfaceTitles(section), [section]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-6 py-5 lg:py-6" data-quality-panel="criterion">
      {/* The name is the panel's title, in the body — where a node panel puts
          its own — rather than a third chip in the header. It was in the header
          because a criterion has no editable title block to sit in, but that
          made this the one panel whose subject was named in the chrome and not
          in the panel, and a long criterion name truncated against the close
          button. What is left up there is what identifies the panel in a trail:
          the domain, the id, the surface.

          The question sits under it as the description, in the same block and
          at the same spacing a node's description gets — it is the one sentence
          that says what the name means. */}
      {(name !== "" || question !== "") && (
        <div className={cn(PANEL_GUTTER, "flex flex-col gap-1.5")}>
          {name !== "" && <p className="text-lg font-semibold text-foreground">{name}</p>}
          {question !== "" && (
            <p className="text-sm leading-relaxed text-foreground">{question}</p>
          )}
        </div>
      )}

      {!packEmbedded && (
        <p className={cn(PANEL_GUTTER, "text-sm text-muted-foreground")}>
          This bundle does not carry the criteria pack, so what this criterion asks is not
          available here — only the score and findings recorded against it.
        </p>
      )}

      {definition !== "" && (
        <PanelSection title="Definition">
          <p className="text-sm leading-relaxed">{definition}</p>
        </PanelSection>
      )}

      {anchors.length > 0 && (
        <PanelSection title="Maturity anchors">
          {/* A strip rather than a list: five anchors are five paragraphs, and
              only one of them is this cell's answer. The scored level opens by
              default so the panel says where the project stands without the
              reader scrolling past the four levels it does not stand at; the
              other four are one click away, which is what reading an anchor
              against its neighbours actually needs. Falls back to the lowest
              anchor written when there is no single score to open on — see
              `scoredLevel`. */}
          <Tabs defaultValue={String(defaultAnchorLevel)}>
            <TabsList className="w-full">
              {anchors.map(({ level }) => {
                const scored = level === scoredLevel;
                return (
                  <TabsTrigger
                    key={level}
                    value={String(level)}
                    // Two marks that do not compete: the selected tab is the
                    // one raised out of the rail (border, weight, foreground
                    // text), and the scored one carries a dot it keeps whether
                    // it is selected or not. Reading L2 while the project sits
                    // at L4 is the whole reason the strip is clickable, so
                    // "where I am" and "where the project is" have to be
                    // legible at the same time.
                    className="font-mono data-[state=active]:border-border data-[state=active]:font-semibold data-[state=active]:text-foreground"
                  >
                    {scored && (
                      <span
                        className="size-1.5 rounded-full bg-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    L{level}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {anchors.map(({ level, text }) => (
              <TabsContent key={level} value={String(level)}>
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-sm leading-relaxed">{text}</p>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </PanelSection>
      )}

      {assessments.length > 0 && (
        <PanelSection title={assessments.length === 1 ? "Evidence" : "Evidence by surface"}>
          <div className="flex flex-col gap-2">
            {assessments.map((assessment) => (
              <div
                // Unique because `assessmentsOn` collapses the list to one row
                // per cell — the bundle itself only warns about a second.
                key={assessment.key}
                className="flex flex-col gap-1.5 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="font-medium text-foreground">Level {assessment.level}</span>
                  {/* The surface is repeated here even when the panel is scoped to
                      one, because this block is the thing a reader quotes. */}
                  <span>{assessment.surfaceTitle}</span>
                  {assessment.auditId && <span>· {assessment.auditId}</span>}
                  {assessment.ts && (
                    <time dateTime={assessment.ts}>· {formatDate(assessment.ts)}</time>
                  )}
                </div>
                {assessment.evidence !== "" && (
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
          <ul className="arkaik-bullets space-y-1.5 pl-4">
            {checklist.map((step, index) => (
              <li key={index} className="text-sm leading-relaxed">
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
          <ul className="arkaik-bullets space-y-1.5 pl-4">
            {signals.map((signal, index) => (
              <li key={index} className="text-sm leading-relaxed">
                {signal}
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {remediation !== "" && (
        <PanelSection title="Remediation">
          <p className="text-sm leading-relaxed">{remediation}</p>
        </PanelSection>
      )}

      {criterionFindings.length > 0 && (
        // The board, not a list of its own. This panel had a second rendering
        // of a finding — a bordered row with a severity dot — and two
        // renderings meant two answers to "which of these is worst": the rail's
        // marks say it at a glance, and the dot did not say it at all. The
        // Findings page and the cell panel already share this component; a
        // criterion is the third place a finding is read and had no business
        // being the one that looked different.
        //
        // `PANEL_GUTTER_BLEED` because `PanelSection` gutters its body and the
        // board carries its own `p-4`; without it the rail sits a gutter and a
        // half in from the prose above it.
        //
        // No `onOpenCriterion`: every row here answers to the criterion in this
        // panel's own header, so the chip would be a button that re-opens the
        // panel it is drawn in. `FindingCard` drops it with the handler.
        <PanelSection title="Findings">
          <div className={PANEL_GUTTER_BLEED}>
            <FindingsBoard
              rows={criterionFindings}
              surfaceTitles={surfaceTitles}
              onOpenFinding={onOpenFinding}
            />
          </div>
        </PanelSection>
      )}
    </div>
  );
}
