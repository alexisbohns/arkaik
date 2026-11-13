"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import {
  BookOpenIcon,
  ExternalLinkIcon,
  GaugeIcon,
  ListChecksIcon,
  RadarIcon,
  WrenchIcon,
} from "lucide-react";
import { MATURITY_LEVELS, type KritikLibrary, type QualitySection } from "@arkaik/schema";
import { PanelHeaderEntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelSection, PANEL_GUTTER, PANEL_GUTTER_BLEED } from "@/components/panels/PanelSection";
import { cn } from "@/lib/utils";
import { FindingsBoard } from "@/components/quality/FindingsBoard";
import { usePanelPreferences } from "@/lib/hooks/usePanelPreferences";
import {
  CitedText,
  ClampedText,
  FoldTile,
  levelTone,
  onTabKey,
  QualityHero,
} from "@/components/quality/QualityPanelParts";
import { QualityPanelShape } from "@/components/quality/QualityPanelShape";
import {
  buildCriterionModel,
  buildSurfaceTitles,
  type AssessmentModel,
  type CriterionModel,
  type FindingRow,
} from "@/lib/utils/quality";

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
 * What identifies the panel in the stack's header — the rubric seal, the
 * domain, the criterion id and the surface being read. The close button
 * belongs to `PanelStack`, which owns every panel's frame.
 *
 * A node panel's header is its species seal and its species word; a criterion
 * has no species, so it wears the rubric seal in a teal no species owns, and
 * its DOMAIN takes the species word's place — it is the one answer to "what
 * kind of criterion is this" the pack gives. `data-kp-hue` on the hook is what
 * tints the header segment (`app/m3/quality-panels.css`).
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
    // `display: contents`: a hook for the panel stylesheet, not a box — the
    // seal and the chips are items of `PanelStack`'s own header row.
    <div className="contents" data-quality-panel-header="criterion" data-kp-hue="rubric">
      <span className="kp-seal" aria-hidden="true">
        <QualityPanelShape shape="rubric" className="kp-seal-shape" />
        <GaugeIcon className="kp-seal-icon" />
      </span>
      {/* The domain truncates first (it is the longest and the least needed
          to tell two panels apart); the id never does. */}
      {domainLabel !== "" && (
        <span className="kp-head-kind" title={domainLabel}>
          {domainLabel}
        </span>
      )}
      <span className="kp-head-id">
        <PanelHeaderEntityId id={criterionId} />
      </span>
      {surfaceTitle !== "" && <span className="kp-head-chip">{surfaceTitle}</span>}
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
 * It reads the way a node panel reads: a seal, a hero that bleeds up under the
 * header, and ONE loud thing — the level this project was scored at, as a
 * track of L0–L4 the way a node's status is a lifecycle track. What the pack
 * says to do about it (remediation, checklist, signals, references) is
 * reference material, so it folds into one deck rather than four headings at
 * full volume.
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
  const surfaceTitles = useMemo(() => buildSurfaceTitles(section), [section]);
  // The panel look is a reader's preference (Settings → Display). Most of it
  // is CSS on `<html data-panel-look>`; the intro and the findings heading
  // differ in markup, so they read it here — the way `NodeDetailPanel` does.
  const calm = usePanelPreferences().look === "calm";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-6 py-5 lg:py-6" data-quality-panel="criterion">
      <CriterionIntro model={model} calm={calm} />
      <CriterionAnchors model={model} />
      <CriterionEvidence model={model} />
      <CriterionGuidance model={model} />
      <CriterionFindings model={model} calm={calm} surfaceTitles={surfaceTitles} onOpenFinding={onOpenFinding} />
    </div>
  );
}

/* ───────────────────────────── intro ───────────────────────────── */

/**
 * The honest gap: no pack in the bundle, said as an open slot in one line
 * rather than as five empty headings.
 */
function NoPack() {
  return (
    <p className="kp-gap">
      <span className="kp-gap-word">open:</span> this bundle does not carry the criteria pack, so what this
      criterion asks is not available here — only the score and findings recorded against it.
    </p>
  );
}

/**
 * The name, at headline scale, is the panel's title, in the body — where a
 * node panel puts its own — rather than a third chip in the header. It was in
 * the header once, because a criterion has no editable title block to sit in,
 * but that made this the one panel whose subject was named in the chrome and
 * not in the panel, and a long criterion name truncated against the close
 * button.
 *
 * The question sits under it as the description, in the same block — it is
 * the one sentence that says what the name means. The definition follows as
 * the panel's first section: it is the long answer to the same question, and
 * a hero holding a paragraph that size stops being a hero.
 *
 * Expressive puts the two on a hero that bleeds up under the header. Calm has
 * no hero: the same block on the panel itself, at the Calm node title's 19px
 * with the question muted — sized by the stylesheet through the
 * `data-criterion-*` hooks, so the block itself stays plain.
 */
function CriterionIntro({ model, calm }: { model: CriterionModel; calm: boolean }) {
  const definition = model.definition !== "" && (
    <PanelSection title="Definition">
      <p className="text-sm leading-relaxed" data-criterion-definition="">
        {model.definition}
      </p>
    </PanelSection>
  );
  if (calm)
    return (
      <>
        {(model.name !== "" || model.question !== "") && (
          <div className={cn(PANEL_GUTTER, "flex flex-col gap-1.5")} data-criterion-intro="">
            {model.name !== "" && (
              <p className="text-lg font-semibold text-foreground" data-criterion-name="">
                {model.name}
              </p>
            )}
            {model.question !== "" && (
              <p className="text-sm leading-relaxed text-foreground" data-criterion-question="">
                {model.question}
              </p>
            )}
          </div>
        )}
        {!model.packEmbedded && (
          <div className={PANEL_GUTTER}>
            <NoPack />
          </div>
        )}
        {definition}
      </>
    );
  return (
    <>
      <QualityHero panel="criterion" hue="rubric" shape="rubric">
        {model.name !== "" && <p className="kp-hero-title">{model.name}</p>}
        {model.question !== "" && <p className="kp-hero-desc">{model.question}</p>}
        {!model.packEmbedded && <NoPack />}
      </QualityHero>
      {definition}
    </>
  );
}

/* ───────────────────────────── anchors ───────────────────────────── */

function anchorOf(model: CriterionModel, level: number): string | undefined {
  return model.anchors.find((anchor) => anchor.level === level)?.text;
}

/** The surfaces scored at a level — only when several are in view and no one level is THE score. */
function surfacesAt(model: CriterionModel, level: number): AssessmentModel[] {
  return model.scoredLevel === undefined ? model.assessments.filter((assessment) => assessment.level === level) : [];
}

/** A step's accessible name: the visible "L2" says nothing about which one is scored, or where. */
function stepLabel(model: CriterionModel, level: number): string {
  const parts = [`Level ${level}`];
  if (level === model.scoredLevel) parts.push("scored");
  const here = surfacesAt(model, level);
  if (here.length > 0) parts.push(`scored on ${here.map((assessment) => assessment.surfaceTitle).join(", ")}`);
  if (anchorOf(model, level) === undefined) parts.push("no anchor written");
  return parts.join(", ");
}

/**
 * The maturity anchors, as one connected track of L0–L4.
 *
 * A strip rather than a list: five anchors are five paragraphs, and only one
 * of them is this cell's answer. The scored level opens by default so the
 * panel says where the project stands without the reader scrolling past the
 * four levels it does not stand at; the other four are one click away, which
 * is what reading an anchor against its neighbours actually needs. Falls back
 * to the lowest anchor written when there is no single score to open on — see
 * `defaultAnchorLevel`.
 *
 * Two marks that do not compete: the SCORED step grows and takes its level's
 * tone whether it is selected or not, and the selected one is the one lifted
 * out of the track. Reading L2 while the project sits at L4 is the whole
 * reason the track is clickable, so "where I am" and "where the project is"
 * have to be legible at the same time. Opened across surfaces, no step is the
 * score; each carries a pip per surface scored there instead.
 *
 * All five steps always draw, so the track keeps its shape; a level the pack
 * wrote no anchor for is a disabled step, named as such.
 */
function CriterionAnchors({ model }: { model: CriterionModel }) {
  const base = useId();
  const [shown, setShown] = useState(model.defaultAnchorLevel);
  if (model.anchors.length === 0) return null;
  return (
    <PanelSection title="Maturity anchors">
      <div role="tablist" aria-label="Maturity levels" className="kp-track">
        {MATURITY_LEVELS.map((level) => {
          const written = anchorOf(model, level) !== undefined;
          const scored = level === model.scoredLevel;
          const here = surfacesAt(model, level);
          const selected = level === shown;
          return (
            <button
              key={level}
              id={`${base}-t${level}`}
              type="button"
              role="tab"
              data-key={level}
              aria-selected={selected}
              aria-controls={`${base}-p`}
              aria-label={stepLabel(model, level)}
              tabIndex={selected ? 0 : -1}
              disabled={!written}
              data-kp-level={levelTone(level)}
              data-scored={scored ? "" : undefined}
              onClick={() => setShown(level)}
              onKeyDown={(event) => onTabKey(event, (key) => setShown(Number(key) as typeof level))}
            >
              <span className="kp-track-num">L{level}</span>
              {scored && <span className="kp-track-word">Scored</span>}
              {here.length > 0 && (
                <span className="kp-track-pips" aria-hidden="true">
                  {here.map((assessment) => (
                    <span key={assessment.key} title={assessment.surfaceTitle} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {shown !== undefined && (
        <div
          role="tabpanel"
          id={`${base}-p`}
          aria-labelledby={`${base}-t${shown}`}
          className="kp-anchor-card"
          data-kp-level={levelTone(shown)}
        >
          <p>{anchorOf(model, shown)}</p>
        </div>
      )}
    </PanelSection>
  );
}

/* ───────────────────────────── evidence ───────────────────────────── */

/**
 * The evidence, read as an argument rather than as code: the auditor's prose
 * at reading size in the body face, its `file:line` citations lit where they
 * fall, and attributed underneath — the level, the surface, the audit and the
 * date. It was a monospace block, which made a paragraph of reasoning look
 * like a log and the citations in it impossible to find.
 *
 * One quote per surface in view. The surface is repeated in the attribution
 * even when the panel is scoped to one, because this block is the thing a
 * reader quotes. Long evidence rests at seven lines under "Show the evidence".
 */
function CriterionEvidence({ model }: { model: CriterionModel }) {
  if (model.assessments.length === 0) return null;
  return (
    <PanelSection title={model.assessments.length === 1 ? "Evidence" : "Evidence by surface"}>
      <div className="kp-quotes">
        {model.assessments.map((assessment) => (
          // Unique because `buildCriterionModel` collapses the list to one row
          // per cell — the bundle itself only warns about a second.
          <figure key={assessment.key} className="kp-quote" data-kp-hue="rubric">
            {assessment.evidence !== "" ? (
              <ClampedText
                text={assessment.evidence}
                limit={520}
                lines={7}
                className="kp-quote-text"
                what="the evidence"
              >
                <CitedText text={assessment.evidence} />
              </ClampedText>
            ) : (
              <p className="kp-gap">
                <span className="kp-gap-word">open:</span> scored with no evidence written.
              </p>
            )}
            <figcaption className="kp-quote-by">
              <span className="kp-level-badge" data-kp-level={levelTone(assessment.level)}>
                <span className="sr-only">Level </span>L{assessment.level}
              </span>
              <span className="kp-ev-surface">{assessment.surfaceTitle}</span>
              <span className="kp-ev-meta">
                {assessment.auditId && <span>{assessment.auditId}</span>}
                {assessment.ts && <time dateTime={assessment.ts}>{formatDate(assessment.ts)}</time>}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </PanelSection>
  );
}

/* ───────────────────────────── guidance ───────────────────────────── */

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="kp-list">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function References({ references }: { references: CriterionModel["references"] }) {
  return (
    <ul className="kp-refs">
      {references.map((reference, index) => (
        <li key={index}>
          {reference.url !== "" ? (
            <a href={reference.url} target="_blank" rel="nofollow noreferrer" className="kp-ref">
              <ExternalLinkIcon className="kp-ref-icon" aria-hidden="true" />
              <span className="kp-ref-label">{reference.label}</span>
              {reference.anchor !== "" && <span className="kp-ref-anchor">{reference.anchor}</span>}
            </a>
          ) : (
            <span className="kp-ref">
              <span className="kp-ref-label">{reference.label}</span>
              {reference.anchor !== "" && <span className="kp-ref-anchor">{reference.anchor}</span>}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

interface GuidancePart {
  key: string;
  title: string;
  peek: string;
  icon: typeof WrenchIcon;
  body: ReactNode;
}

/**
 * What the pack says to do about it, in the order a reader reaches for it:
 * how to fix it, how to check, what to look for, where it comes from. Each
 * part only when the pack wrote it.
 */
function guidanceParts(model: CriterionModel): GuidancePart[] {
  const parts: GuidancePart[] = [];
  if (model.remediation !== "")
    parts.push({
      key: "fix",
      title: "Remediation",
      peek: "how to fix it",
      icon: WrenchIcon,
      body: <p className="kp-prose">{model.remediation}</p>,
    });
  if (model.checklist.length > 0)
    parts.push({
      key: "check",
      title: "Checklist",
      peek: count(model.checklist.length, "step", "steps"),
      icon: ListChecksIcon,
      body: <Bullets items={model.checklist} />,
    });
  if (model.signals.length > 0)
    parts.push({
      key: "signals",
      title: "Signals",
      peek: count(model.signals.length, "signal", "signals"),
      icon: RadarIcon,
      body: <Bullets items={model.signals} />,
    });
  if (model.references.length > 0)
    parts.push({
      key: "refs",
      title: "References",
      peek: count(model.references.length, "link", "links"),
      icon: BookOpenIcon,
      body: <References references={model.references} />,
    });
  return parts;
}

/**
 * The guidance as one connected deck. Four headings at full volume made the
 * reference material as loud as the score; folded, the first part opens and
 * the rest wait as one line each, with a count of what is inside.
 */
function CriterionGuidance({ model }: { model: CriterionModel }) {
  const parts = guidanceParts(model);
  if (parts.length === 0) return null;
  return (
    <div className={PANEL_GUTTER}>
      <ul className="kp-folds">
        {parts.map((part, index) => (
          <FoldTile
            key={part.key}
            title={part.title}
            peek={part.peek}
            icon={<part.icon className="size-4" />}
            defaultOpen={index === 0}
          >
            {part.body}
          </FoldTile>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── findings ───────────────────────────── */

const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

/**
 * The findings against this criterion: a tally of what is still open, by
 * priority, above the board.
 *
 * The board, not a list of its own. This panel had a second rendering of a
 * finding — a bordered row with a severity dot — and two renderings meant two
 * answers to "which of these is worst": the rail's marks say it at a glance,
 * and the dot did not say it at all. The Findings page and the cell panel
 * already share this component; a criterion is the third place a finding is
 * read and had no business being the one that looked different.
 *
 * `PANEL_GUTTER_BLEED` because `PanelSection` gutters its body and the board
 * carries its own `p-4`; without it the rail sits a gutter and a half in from
 * the prose above it.
 *
 * No `onOpenCriterion`: every row here answers to the criterion in this
 * panel's own header, so the chip would be a button that re-opens the panel it
 * is drawn in. `FindingCard` drops it with the handler.
 *
 * Calm drops the tally for a count in the heading — "Findings 3 · 1 open",
 * or just "3" when all of them are open — the Calm look's way of saying a
 * number: quietly, where the eye already is.
 */
function CriterionFindings({
  model,
  calm,
  surfaceTitles,
  onOpenFinding,
}: {
  model: CriterionModel;
  calm: boolean;
  surfaceTitles: ReadonlyMap<string, string>;
  onOpenFinding: (findingId: string) => void;
}) {
  if (model.findings.length === 0) return null;
  const open = model.findings.filter((finding) => finding.open);
  const decided = model.findings.length - open.length;
  const board = (
    <div className={PANEL_GUTTER_BLEED}>
      <FindingsBoard rows={model.findings} surfaceTitles={surfaceTitles} onOpenFinding={onOpenFinding} />
    </div>
  );
  if (calm)
    return (
      <section className={cn(PANEL_GUTTER, "kp-calm-section")}>
        <h3 className="kp-calm-h">
          <span>Findings</span>
          <span className="kp-calm-h-meta">
            {decided === 0 ? `${open.length}` : `${model.findings.length} · ${open.length} open`}
          </span>
        </h3>
        {board}
      </section>
    );
  return (
    <PanelSection title="Findings">
      <ul className="kp-tally" aria-label="Findings by priority">
        {PRIORITIES.map((priority) => {
          const n = open.filter((finding) => finding.priority === priority).length;
          if (n === 0) return null;
          return (
            <li key={priority} data-kp-hue={priority.toLowerCase()}>
              <span className="kp-tally-n">{n}</span>
              <span className="kp-tally-word">{priority} open</span>
            </li>
          );
        })}
        {open.length === 0 && (
          <li data-kp-hue="resolved">
            <span className="kp-tally-n">0</span>
            <span className="kp-tally-word">open</span>
          </li>
        )}
        {decided > 0 && (
          <li data-quiet="">
            <span className="kp-tally-n">{decided}</span>
            <span className="kp-tally-word">decided</span>
          </li>
        )}
      </ul>
      {board}
    </PanelSection>
  );
}
