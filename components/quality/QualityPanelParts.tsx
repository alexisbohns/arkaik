"use client";

/**
 * The pieces the criterion and finding panels share: the level a criterion
 * was scored at as a tone, lit citations, a clamp with a "Show all", a
 * disclosure tile, a roving tablist and the hero.
 *
 * Tones. A criterion is not a graph species and neither is a finding, so each
 * wears one of its own, set by `data-kp-hue` and turned into `--kp-tint` /
 * `--kp-tint-2` / `--kp-ink` by `app/m3/quality-panels.css` — the `--np-*`
 * trio `panels.css` gives a node:
 * - a criterion wears `rubric`, a teal no species owns — the colour of the
 *   standard, not of the project's score. Its scored LEVEL takes the level
 *   ramp (`data-kp-level="l0"…"l4"`), and only where the level is the subject.
 * - a finding wears `FindingModel.tone`: its priority while it is open, its
 *   decision once it is not, so a resolved P0 stops shouting.
 *
 * The Calm look's pieces (`kp-calm-*`) close the file: the Calm node panel's
 * idioms (`np-calm-*` in `panels.css`) — a clamp that rests at N lines with a
 * quiet "More", a quiet disclosure row, a label/value props grid, a chip.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { QualityPanelShape, type QualityPanelShapeName } from "@/components/quality/QualityPanelShape";

export type LevelTone = "l0" | "l1" | "l2" | "l3" | "l4";

/** A maturity level's tone on the level ramp, red at L0 to green at L4. */
export const levelTone = (level: number): LevelTone => `l${Math.max(0, Math.min(4, level))}` as LevelTone;

/* ───────────────────────── lit citations ───────────────────────── */

const EXTENSIONS =
  "tsx?|jsx?|mjs|cjs|sql|toml|mdx?|ya?ml|json|css|scss|swift|kts?|py|rb|go|rs|sh|html|gradle|plist|xml|lock|env";

/**
 * A `file:line` citation, or a bare `:line` continuing the last one. One
 * capturing group, so `split` alternates prose and citations.
 */
const CITATION = new RegExp(
  `((?:[\\w@~.-]+\\/)*[\\w@-][\\w@.-]*\\.(?:${EXTENSIONS})\\b(?::\\d+(?:[-–]\\d+)?)?|(?<=[\\s(,;/]):\\d+(?:[-–]\\d+)?)`,
  "g",
);

/**
 * Evidence with its `file:line` citations lit, the way the node panel lights
 * Gherkin's keywords. The text is unchanged — every character in order, still
 * selectable, still pastable into an editor — only the citations wear a tint.
 */
export function CitedText({ text }: { text: string }) {
  const parts = text.split(CITATION);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="kp-cite">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/* ───────────────────────── clamp ───────────────────────── */

/**
 * A long block rests at `lines` lines with a "Show all" under it.
 *
 * Decided by length, not by measuring: the server render and the first paint
 * agree, and no effect re-renders the panel to find out how tall a paragraph
 * came out. The cost is a block a little over `limit` characters that would
 * have fitted anyway getting a button it did not need, which is the cheaper
 * mistake of the two.
 */
export function ClampedText({
  text,
  limit,
  lines,
  className,
  children,
  what = "all",
}: {
  /** The text the length test reads. */
  text: string;
  /** Characters past which the block clamps. */
  limit: number;
  lines: number;
  className?: string;
  children: ReactNode;
  /** "Show {what}" — names the button for a screen reader as well as on screen. */
  what?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  return (
    <div className="kp-clamp-wrap">
      <div
        id={id}
        className={className}
        data-kp-clamped={long && !open ? "" : undefined}
        style={{ ["--kp-lines" as string]: lines }}
      >
        {children}
      </div>
      {long && (
        <button
          type="button"
          className="kp-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : `Show ${what}`}
          <ChevronDownIcon className="kp-more-chevron" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── disclosure tile ───────────────────────── */

/**
 * One tile of a connected deck that opens in place — the criterion's
 * guidance, the finding's detail. The heading wraps the button (the
 * disclosure pattern `PanelGroup` uses), so the panel's outline still lists
 * every tile, open or not. The `peek` stands in for the body while it is
 * shut: a count, the first words, the verdict.
 */
export function FoldTile({
  title,
  peek,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  peek?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className="kp-fold" data-open={open ? "" : undefined}>
      <h3 className="kp-fold-h">
        <button
          type="button"
          className="kp-fold-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          {icon && (
            <span className="kp-fold-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <span className="kp-fold-name">{title}</span>
          {peek !== undefined && !open && <span className="kp-fold-peek">{peek}</span>}
          <ChevronDownIcon className="kp-fold-chevron" aria-hidden="true" />
        </button>
      </h3>
      <div id={id} className="kp-fold-body" hidden={!open}>
        {children}
      </div>
    </li>
  );
}

/* ───────────────────────── roving tablist ───────────────────────── */

/**
 * Arrow keys, Home and End move between the enabled tabs of the tablist the
 * event came from, and choose — the radio-group behaviour `StatusTrack` has.
 * Each tab names its key in `data-key`.
 */
export function onTabKey(event: KeyboardEvent<HTMLButtonElement>, choose: (key: string) => void) {
  const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const list = event.currentTarget.closest('[role="tablist"]');
  if (!list) return;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
  const from = tabs.indexOf(event.currentTarget);
  let next: number | null = null;
  if (event.key in steps) next = (from + steps[event.key] + tabs.length) % tabs.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = tabs.length - 1;
  if (next === null || !tabs[next]) return;
  event.preventDefault();
  tabs[next].focus();
  const key = tabs[next].dataset.key;
  if (key !== undefined) choose(key);
}

/* ───────────────────────── hero ───────────────────────── */

/**
 * The panel's one hero: a tinted card that bleeds up under the header, so the
 * header and the title read as one shape — the node hero's idiom
 * (`[data-np-intro="bleed"]` in `panels.css`), in the panel's own tone and
 * with its own seal as the corner ornament.
 *
 * `data-kp-bleed` is the hook the stylesheet reads to give the body's top
 * padding up and to tint the header segment above it.
 */
export function QualityHero({
  panel,
  hue,
  shape,
  children,
}: {
  panel: "criterion" | "finding";
  hue: string;
  shape: QualityPanelShapeName;
  children: ReactNode;
}) {
  return (
    <div className="kp-hero" data-kp-bleed={panel} data-kp-hue={hue}>
      <QualityPanelShape shape={shape} className="kp-hero-shape" />
      <div className="kp-hero-text">{children}</div>
    </div>
  );
}

/* ───────────────────────── Calm ───────────────────────── */

/**
 * Rests at `lines` lines and offers "More" only when the text actually runs
 * longer — measured against the clamp, and re-measured on resize. The Calm
 * node description's clamp, generalised. Measured rather than decided by
 * length (`ClampedText`) because a Calm block is short and a "More" under
 * text that already fits reads as a bug in a look whose whole point is
 * quiet. Nothing inside it is focusable, so the clipped part never traps a
 * tab stop.
 */
export function MeasuredClamp({ lines, children, className }: { lines: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const id = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <>
      <div
        ref={ref}
        id={id}
        className={className ? `kp-calm-clamp ${className}` : "kp-calm-clamp"}
        style={{ ["--kp-calm-lines" as string]: lines }}
        data-clamped={expanded ? undefined : ""}
      >
        {children}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          className="kp-calm-text-button kp-calm-clamp-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </>
  );
}

/**
 * A folded row inside a section: the heading IS the disclosure (an `h4`,
 * one rung under the section's `h3`, whose content is the trigger — the
 * `PanelGroup` pattern), with a chevron that turns. Closed by default — what
 * it holds is read on demand.
 */
export function CalmFold({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Collapsible className="kp-calm-fold">
      <h4>
        <CollapsibleTrigger className="kp-calm-fold-bar">
          <ChevronRightIcon className="kp-calm-fold-chevron size-4" aria-hidden="true" />
          <span>{title}</span>
        </CollapsibleTrigger>
      </h4>
      <CollapsibleContent className="kp-calm-fold-body">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** The Calm props grid: a quiet label column, a value column. */
export function CalmProps({ children }: { children: ReactNode }) {
  return <dl className="kp-calm-props">{children}</dl>;
}

export function CalmProp({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="kp-calm-prop kp-calm-prop-top">
      <dt className="kp-calm-prop-label">{label}</dt>
      <dd className="kp-calm-prop-value">{children}</dd>
    </div>
  );
}

/** A static Calm chip — the node panel's status chip, read-only. `tone` tints it. */
export function CalmChip({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <span className="kp-calm-chip" data-tone={tone}>
      {children}
    </span>
  );
}
