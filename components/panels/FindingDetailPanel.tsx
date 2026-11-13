"use client";

import type { ReactNode } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ShieldIcon,
  SirenIcon,
  XIcon,
} from "lucide-react";
import type { KritikLibrary, QualitySection } from "@arkaik/schema";
import { PanelHeaderEntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelSection, PANEL_GUTTER } from "@/components/panels/PanelSection";
import { SpeciesShape } from "@/components/panels/species-shape";
import { CitedText, FoldTile, QualityHero } from "@/components/quality/QualityPanelParts";
import { QualityPanelShape } from "@/components/quality/QualityPanelShape";
import {
  COST_HINT,
  COST_TERM,
  FINDING_STATUS_LABEL,
  PRIORITY_GLOSS,
  PRIORITY_HINT,
  SEVERITY_HINT,
  SEVERITY_LABEL,
  VERDICT_LABEL,
} from "@/components/quality/quality-styles";
import { EmptyState } from "@/components/ui/empty-state";
import type { Node } from "@/lib/data/types";
import {
  buildFindingModel,
  buildSurfaceTitles,
  type FindingModel,
  type FindingRow,
} from "@/lib/utils/quality";
import { cn } from "@/lib/utils";

interface FindingDetailPanelProps {
  findingId: string;
  /**
   * Every finding in the section, denormalized once by `ProjectPanels`. The
   * panel picks its own out by id rather than being handed a row, so an audit
   * arriving under an open panel reaches it.
   */
  findings: FindingRow[];
  /** The audit profile, for naming the surface the way the matrix names it. */
  section?: QualitySection;
  /**
   * The criteria pack, for the criterion's name the pill carries. Optional the
   * way it is on the criterion and cell panels: a bundle can travel without
   * its pack, and then the pill shows what the projection already carries.
   * `FindingDetailPanelHeader` does not take it — nothing in the header comes
   * from the pack.
   */
  library?: KritikLibrary;
  /** The graph, so a linked node reads as a title rather than as an id. */
  nodesById: ReadonlyMap<string, Node>;
  onOpenNode: (nodeId: string) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/**
 * The seal's glyph: the siren while the finding is open, the decision once it
 * is not. Decorative — the decision is said in words in the body (the status
 * pill, the accepted-risk tile), never only here.
 */
function SealIcon({ model }: { model: FindingModel | null }) {
  if (model?.acceptedRisk) return <ShieldIcon className="kp-seal-icon" />;
  if (model?.row.status === "resolved") return <CheckIcon className="kp-seal-icon" />;
  if (model?.row.status === "refuted") return <XIcon className="kp-seal-icon" />;
  return <SirenIcon className="kp-seal-icon" />;
}

/**
 * What identifies the panel in the stack's header: the alert seal, what kind
 * of thing this is, which one it is, and the surface it was filed on. The
 * close button belongs to `PanelStack`, which owns every panel's frame.
 *
 * **A panel header in this app never carries a title.** A node's header is its
 * species seal and its id; a criterion's is its rubric seal, its domain and
 * its id. The title is body content — on a node it is an editable field down
 * there, which is exactly why it cannot also be the identity up here — and
 * the stack's own `h2` is `sr-only` for the same reason.
 *
 * Nor does it carry a status in words: no header in the stack does, and a
 * decision panel's header does not wear its `DecisionStatusBadge`. The seal
 * takes the finding's TONE instead (`FindingModel.tone`) — its priority's
 * while it is open, its decision's once it is not — which is colour and
 * shape, never the only place the fact is said.
 */
export function FindingDetailPanelHeader({
  findingId,
  findings,
  section,
}: Pick<FindingDetailPanelProps, "findingId" | "findings" | "section">) {
  const row = findings.find((candidate) => candidate.id === findingId);
  // No library: nothing in the header comes from the pack.
  const model = row ? buildFindingModel(row, { surfaceTitles: buildSurfaceTitles(section) }) : null;

  return (
    // `display: contents`: a hook for the panel stylesheet, not a box — the
    // seal and the chips are items of `PanelStack`'s own header row.
    <div className="contents" data-quality-panel-header="finding" data-kp-hue={model?.tone}>
      <span className="kp-seal" aria-hidden="true">
        <QualityPanelShape shape="alert" className="kp-seal-shape" />
        <SealIcon model={model} />
      </span>
      <span className="kp-head-kind">Finding</span>
      <span className="kp-head-id">
        <PanelHeaderEntityId id={findingId} />
      </span>
      {model && <span className="kp-head-chip">{model.surfaceTitle}</span>}
    </div>
  );
}

/**
 * One finding, in full.
 *
 * A finding is an entity, so it is read the way every other entity in this app
 * is read — in a panel. It used to be read by expanding a row in place, which
 * cost the board its scannability exactly when a reader needed it: detail,
 * evidence, a verification note, the linked nodes and two identifiers is
 * several screens, and the rows under it went off the bottom.
 *
 * It wears its priority: the alert seal, the hero and the one loud tile in the
 * Risk section all take the finding's tone while it is open, and its
 * decision's once it is not.
 *
 * Addressless in the stack — see the head of `lib/utils/project-panels.ts`. The
 * Findings page owns `?finding=`.
 *
 * Read-only, like the criterion and cell panels beside it. Resolving a finding
 * and accepting a risk are journal writes the CLI and the MCP server make
 * (`quality.finding.resolved`, `quality.finding.accepted`); this app has no
 * write path for either, and inventing one here would be inventing it in the
 * wrong place.
 *
 * Every section carrying prose somebody had to write is conditional on having
 * something to say, the rule `CriterionDetailPanel` states: a heading over
 * nothing reads as a panel that failed to load rather than as a finding nobody
 * wrote evidence for. Risk and Criterion are the two exceptions, because
 * neither can ever be empty — the projection derives all five scales for every
 * row, and every finding answers to a criterion on a surface.
 */
export function FindingDetailPanel({
  findingId,
  findings,
  section,
  library,
  nodesById,
  onOpenNode,
  onOpenCriterion,
}: FindingDetailPanelProps) {
  // The second linear scan of the same list this render — the header ran the
  // first. Deliberate, and the shape `CriterionDetailPanel` already uses:
  // `criterionOf` is an unmemoized `find` its header and its body each call
  // for themselves. A few hundred rows scanned twice is nothing next to a
  // context threaded through the stack to carry one row, and the panel takes
  // an id rather than a row for the reason `findings` documents above.
  const row = findings.find((candidate) => candidate.id === findingId);

  // Say so rather than rendering nothing: a blank body would read as a bug.
  //
  // Not where a stale `?finding=` link lands — the Findings page refuses to
  // open a panel for an id it cannot resolve, and drops the param instead.
  // What reaches here is a finding that goes missing *under* a panel already
  // open: a re-imported bundle that dropped it, or one opened above depth 0
  // from a node or criterion panel, where no address is watching. In both the
  // reader was just looking at it, so they are owed an account of where it
  // went.
  if (!row) {
    return (
      <div className={cn(PANEL_GUTTER, "min-h-0 flex-1 overflow-y-auto py-5 lg:py-6")} data-quality-panel="finding">
        <EmptyState
          message={
            <>
              This audit carries no finding with the id{" "}
              <span className="font-mono">{findingId}</span>. A later import may have dropped it,
              or the link may be out of date.
            </>
          }
        />
      </div>
    );
  }

  // Which status word shows, the accepted-risk note, the detail and the
  // verification that do not repeat it, the tone, the criterion's name: every
  // rule is `buildFindingModel`'s (lib/utils/quality.ts), tested there.
  const model = buildFindingModel(row, { surfaceTitles: buildSurfaceTitles(section), library });

  return (
    // No `opacity-70` on a decided finding, unlike the card: dimming says "this
    // row is history" to somebody scanning a board, and there is no board here
    // — the reader asked for this one record, and greying what they asked for
    // reads as broken rather than as filed away. The tone does that work: a
    // decided finding stops wearing its priority.
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4" data-quality-panel="finding">
      <FindingIntro model={model} />
      <FindingRisk model={model} />
      <FindingCriterion model={model} onOpenCriterion={onOpenCriterion} />
      <FindingDetail model={model} />
      <FindingNodes model={model} nodesById={nodesById} onOpenNode={onOpenNode} />
    </div>
  );
}

/* ───────────────────────────── intro ───────────────────────────── */

/**
 * An accepted risk is a decision, so it reads as one — a tile in the amber
 * its status owns, the shield on the rubric's badge shape, the words
 * "Accepted risk" and the rationale, first thing under the title. Somebody
 * already weighed this and said "not now", and burying that invites the next
 * reader to re-litigate it.
 *
 * It states the status whatever the note holds: `acceptedNote` is `""` when no
 * rationale was recorded, and that is said as a visible gap, never a reason
 * for the decision to vanish (the rule `AcceptedRiskCallout` keeps on the
 * card).
 */
function AcceptedDecision({ model }: { model: FindingModel }) {
  if (!model.acceptedRisk) return null;
  const note = model.acceptedNote?.trim() ?? "";
  return (
    <div className="kp-decision" data-kp-hue="accepted">
      <span className="kp-decision-mark" aria-hidden="true">
        <QualityPanelShape shape="rubric" className="kp-decision-shape" />
        <ShieldIcon className="kp-decision-icon" />
      </span>
      <div className="kp-decision-text">
        <p className="kp-decision-word">{FINDING_STATUS_LABEL["accepted-risk"]}</p>
        {note !== "" ? (
          <p className="kp-decision-note">{note}</p>
        ) : (
          <p className="kp-gap">
            <span className="kp-gap-word">open:</span> no rationale was recorded with this decision.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The title, at headline scale, on a card in the finding's tone that bleeds
 * up under the header — the node hero's shape.
 *
 * The status in a word under it, once the finding is decided: the only copy
 * of it a screen reader meets, now the rail's glyph is not in this panel.
 * `showStatus` leaves out an accepted risk, whose decision tile states it in
 * the treatment that says it is a decision; a pill up here would say it twice
 * and more quietly.
 */
function FindingIntro({ model }: { model: FindingModel }) {
  return (
    <div className="kp-intro">
      <QualityHero panel="finding" hue={model.tone} shape="alert">
        <p className="kp-hero-title" data-kp-size="finding">
          {model.row.title}
        </p>
        {model.showStatus && (
          <div className="kp-hero-chips">
            <span className="kp-status" data-kp-hue={model.tone}>
              {model.row.status === "resolved" ? <CheckIcon aria-hidden="true" /> : <XIcon aria-hidden="true" />}
              {FINDING_STATUS_LABEL[model.row.status]}
            </span>
          </div>
        )}
      </QualityHero>
      <AcceptedDecision model={model} />
    </div>
  );
}

/* ───────────────────────────── risk ───────────────────────────── */

const IMPACT = [1, 2, 3, 4, 5];
const LIKELIHOOD = [5, 4, 3, 2, 1];

/**
 * The bill, spelled out: where the finding sits on the 5 × 5 of impact and
 * likelihood, then what that bought — the severity, the priority, the cost.
 *
 * On the board these numbers are the card's `RiskBadge`, one figure whose
 * bill lives behind a hover — right for a row in a list of twenty, wrong
 * here: the reader asked for this one finding, and "why is this
 * a P1" should not require them to find a chip and keep a pointer on it. So
 * every gloss is printed under the grid, and nothing in this section needs a
 * hover.
 *
 * The priority is the one loud tile while the finding is open; once it is
 * decided the tile steps back (`data-kp-open` absent), because the priority is
 * history then. The grid is a picture of one sentence, so it is hidden from
 * the accessibility tree and the sentence is said instead.
 *
 * Unconditional, unlike every other section below: a row always has an
 * impact, a likelihood, a severity, a priority and a cost — the projection
 * derives all five — so there is no empty state to guard.
 */
function FindingRisk({ model }: { model: FindingModel }) {
  const { row } = model;
  return (
    <PanelSection title="Risk">
      <div className="kp-grid-wrap" data-kp-hue={model.tone} data-kp-open={row.open ? "" : undefined}>
        <div className="kp-grid-fig">
          <p className="sr-only">
            Impact {row.impact} × likelihood {row.likelihood} = risk {row.risk}.
          </p>
          <div className="kp-grid" aria-hidden="true">
            <span className="kp-grid-y">Likelihood</span>
            <div className="kp-grid-cells">
              {LIKELIHOOD.map((likelihood) =>
                IMPACT.map((impact) => {
                  const lit = impact === row.impact && likelihood === row.likelihood;
                  return (
                    <span
                      key={`${impact}-${likelihood}`}
                      data-lit={lit ? "" : undefined}
                      style={{ ["--kp-heat" as string]: (impact * likelihood) / 25 }}
                    >
                      {lit ? row.risk : ""}
                    </span>
                  );
                }),
              )}
            </div>
            <span className="kp-grid-x">Impact</span>
          </div>
        </div>
        <dl className="kp-grid-side">
          <div className="kp-side-tile" data-kp-hue={`sev-${row.severity}`} data-tinted="">
            <dt>Severity</dt>
            <dd>{SEVERITY_LABEL[row.severity]}</dd>
          </div>
          <div className="kp-side-tile" data-loud="">
            <dt>Priority</dt>
            <dd>
              {row.priority} <span className="kp-side-sub">{PRIORITY_HINT[row.priority]}</span>
            </dd>
          </div>
          <div className="kp-side-tile">
            <dt>Cost</dt>
            <dd>{COST_TERM[row.cost]}</dd>
          </div>
        </dl>
      </div>
      <dl className="kp-glosses">
        <div>
          <dt>{SEVERITY_LABEL[row.severity]}</dt>
          <dd>{SEVERITY_HINT[row.severity]}</dd>
        </div>
        <div>
          <dt>{row.priority}</dt>
          <dd>{PRIORITY_GLOSS[row.priority]}</dd>
        </div>
        <div>
          <dt>{row.cost}</dt>
          <dd>{COST_HINT[row.cost]}</dd>
        </div>
      </dl>
    </PanelSection>
  );
}

/* ───────────────────────────── criterion ───────────────────────────── */

/**
 * The criterion, as one connected pill — the rubric mark and the id, the
 * name, the way in. It is the thing a reader most often follows out of a
 * finding, and the pill wears the criterion panel's teal and seal so it
 * previews where it leads.
 *
 * The whole pill is the button, the way a `CriteriaList` row is: a target this
 * size with one destination should not make the reader aim at the id inside
 * it. The name is the pack's; when the projection fell back to the id for
 * want of a pack definition (`hasCriterionName`), the domain stands in, and
 * failing that the verb — the id is already in the pill, and printing it
 * twice would look like two facts.
 *
 * `cross-surface` is a findings-only lens no profile declares, so a finding
 * filed there says so under the pill: a reader scoped to one surface must not
 * mistake it for theirs.
 */
function FindingCriterion({
  model,
  onOpenCriterion,
}: {
  model: FindingModel;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}) {
  const { row } = model;
  return (
    <PanelSection title="Criterion">
      <button
        type="button"
        className="kp-fcpill"
        data-kp-hue="rubric"
        onClick={() => onOpenCriterion(row.criterionId, row.surface)}
      >
        <span className="kp-fcpill-id">
          <QualityPanelShape shape="rubric" className="kp-fcpill-mark" />
          {row.criterionId}
        </span>
        <span className="kp-fcpill-name">
          {model.hasCriterionName ? row.criterionName : row.domainName || "Open the criterion"}
        </span>
        <span className="kp-fcpill-go" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      </button>
      {model.crossSurface && <p className="kp-fc-note">Filed across surfaces, not against one.</p>}
    </PanelSection>
  );
}

/* ───────────────────────────── detail ───────────────────────────── */

const firstWords = (text: string, n = 64) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

interface DetailTile {
  key: string;
  title: string;
  peek: ReactNode;
  body: ReactNode;
}

/**
 * The prose somebody wrote — detail, evidence, verification — as one
 * connected deck: the first tile open, the rest a line each with a peek at
 * what is inside, so a long detail no longer pushes the linked nodes off the
 * first screen.
 *
 * The evidence keeps its preserved line breaks and lights its `file:line`
 * citations: a citation reflowed into prose is a citation nobody can paste
 * into an editor. The verification's verdict leads it, unless it only repeats
 * the status pill in the hero (`repeatsStatus`, a refuted finding's REFUTED).
 */
function FindingDetail({ model }: { model: FindingModel }) {
  const tiles: DetailTile[] = [];
  if (model.detail !== "")
    tiles.push({
      key: "detail",
      title: "Detail",
      peek: firstWords(model.detail),
      body: <p className="kp-prose">{model.detail}</p>,
    });
  if (model.evidence !== "")
    tiles.push({
      key: "evidence",
      title: "Evidence",
      peek: firstWords(model.evidence, 48),
      body: (
        <p className="kp-mono">
          <CitedText text={model.evidence} />
        </p>
      ),
    });
  const { verification } = model;
  if (verification) {
    const verdict = verification.repeatsStatus ? null : (
      <span className="kp-verdict">{VERDICT_LABEL[verification.verdict]}</span>
    );
    tiles.push({
      key: "verification",
      title: "Verification",
      peek: verdict ?? firstWords(verification.note, 48),
      body: (
        <div className="kp-verify">
          {verdict}
          <p className="kp-prose">
            <CitedText text={verification.note} />
          </p>
        </div>
      ),
    });
  }
  if (tiles.length === 0) return null;
  return (
    <div className={PANEL_GUTTER}>
      <ul className="kp-folds">
        {tiles.map((tile, index) => (
          <FoldTile key={tile.key} title={tile.title} peek={tile.peek} defaultOpen={index === 0}>
            {tile.body}
          </FoldTile>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── nodes ───────────────────────────── */

/** "#1042" over "owner/repo" from a GitHub issue URL; the host and path otherwise. */
function issueName(url: string): { main: string; sub: string } {
  try {
    const parsed = new URL(url);
    const github = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/);
    if (github) return { main: `#${github[3]}`, sub: `${github[1]}/${github[2]}` };
    return { main: parsed.hostname, sub: parsed.pathname };
  } catch {
    return { main: url, sub: "" };
  }
}

/**
 * The nodes the finding was filed against, each a relation tile in its
 * species' shape and tone — the node panel's relation tiles, so a node reads
 * the same here as everywhere it is linked from — then the issue it was filed
 * as.
 *
 * No id section down here. The header carries it, and clicking it copies —
 * which was the whole reason this panel once held one, since a `select-all`
 * span was the only pastable copy of the id the panel had.
 */
function FindingNodes({
  model,
  nodesById,
  onOpenNode,
}: {
  model: FindingModel;
  nodesById: ReadonlyMap<string, Node>;
  onOpenNode: (nodeId: string) => void;
}) {
  const { nodeIds, issueUrl } = model.row;
  const issue = issueUrl ? issueName(issueUrl) : null;
  return (
    <>
      {nodeIds.length > 0 && (
        <PanelSection title="In the graph">
          <ul className="kp-ntiles">
            {nodeIds.map((nodeId) => {
              const node = nodesById.get(nodeId);
              return (
                <li key={nodeId}>
                  {/* Still a button when the id resolves to nothing: a finding
                      filed against a node that has since been deleted is a
                      fact about the audit, and a silently dropped tile would
                      hide it. The tile says so in words; the panel it opens
                      says so too. */}
                  <button
                    type="button"
                    className="kp-ntile"
                    data-species={node?.species}
                    data-missing={node ? undefined : ""}
                    onClick={() => onOpenNode(nodeId)}
                  >
                    {node ? (
                      <SpeciesShape species={node.species} className="kp-ntile-mark" />
                    ) : (
                      <span className="kp-ntile-mark" data-empty="" aria-hidden="true" />
                    )}
                    <span className="kp-ntile-text">
                      <span className="kp-ntile-title">{node?.title ?? nodeId}</span>
                      <span className="kp-ntile-sub">{node ? nodeId : "not in this project's graph"}</span>
                    </span>
                    <ChevronRightIcon className="kp-ntile-go" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </PanelSection>
      )}
      {issueUrl && issue && (
        <PanelSection title="Issue">
          {/* Named by its number and repository rather than printed whole: a
              GitHub issue URL is long enough to be cut off mid-path, and the
              number is what a reader says out loud. The full URL is the
              link's title. */}
          <a href={issueUrl} target="_blank" rel="nofollow noreferrer" className="kp-issue" title={issueUrl}>
            <ExternalLinkIcon className="kp-issue-icon" aria-hidden="true" />
            <span className="kp-issue-main">{issue.main}</span>
            {issue.sub !== "" && <span className="kp-issue-sub">{issue.sub}</span>}
          </a>
        </PanelSection>
      )}
    </>
  );
}
