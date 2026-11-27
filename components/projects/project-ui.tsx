"use client";

/**
 * The pieces the projects page draws with: a project's identity (shape and
 * monogram), its anatomy (species bar and chips, platforms, journal pulse),
 * the kind marks (Hosted / Synked / Lokal / Explore), and the ways in (the
 * create menu, the "New project" door).
 *
 * Every class starts with `pj-` and is styled in app/m3/projects.css, scoped
 * to the page's hooks. Both looks render these same pieces: Expressive is the
 * default skin, and `[data-pj-look="calm"]` quiets them (no kind colour, no
 * display face) — see the stylesheet.
 */
import { createContext, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import {
  AppleIcon,
  BotIcon,
  CloudCheckIcon,
  CloudIcon,
  CompassIcon,
  FileUpIcon,
  HardDriveIcon,
  HistoryIcon,
  MonitorIcon,
  PlusIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { dynaPuff } from "@/lib/font-display";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EXPRESSIVE_SHAPES, type ExpressiveShapeName } from "@/components/arkademy/ExpressiveShape";
import { SPECIES, type SpeciesId } from "@/lib/config/species";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import type { PlatformId } from "@/lib/config/platforms";
import type { CreateTarget } from "@/lib/data/create-target";
import type { ProjectAnatomy } from "@/lib/data/project-anatomy";
import type { CardModel, PageModel, SectionKind } from "@/lib/data/project-page-model";

/** The brand display face's variable (`--font-display`), carried by every root we draw. */
export const FONT = dynaPuff.variable;

/**
 * Which look a subtree renders. Both looks' structures render at once and the
 * stylesheet shows one per `data-panel-look` (set before first paint, so the
 * wrong one never flashes); a piece that differs by look inside a subtree
 * (Explore: invitation or strip) reads this.
 */
export const ProjectsLook = createContext<"expressive" | "calm">("expressive");

// ── identity ────────────────────────────────────────────────────────────────

const SHAPES: ExpressiveShapeName[] = ["cookie12", "flower", "clover4", "cookie9", "sunny"];

/** "Pebbles — example" and "Pebbles" are one family; "Arkaik (Self Map)" is "arkaik". */
function family(title: string): string {
  return title.split(/\s+[—–-]\s+|\s*\(/)[0].trim().toLowerCase();
}
function hash(s: string): number {
  let x = (2166136261 ^ 394) >>> 0;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619) >>> 0;
  }
  return x >>> 0;
}
/** A project's shape and monogram, from its title alone (only a rename changes them). */
export function identityOf(title: string): { shape: ExpressiveShapeName; monogram: string } {
  const h = hash(family(title) || "?");
  return {
    shape: SHAPES[(h >>> 8) % SHAPES.length],
    monogram: (title.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase(),
  };
}

/** One expressive shape, drawn as a filled SVG. */
export function Shape({ name, className, style }: { name: ExpressiveShapeName; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" className={className} style={style}>
      <path d={EXPRESSIVE_SHAPES[name]} fill="currentColor" />
    </svg>
  );
}

// ── kinds ───────────────────────────────────────────────────────────────────

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  shape: ExpressiveShapeName;
  /** The kind's hue; only Explore shows it (own kinds are neutral on this page). */
  hue: "neutral" | "plum";
  /** Where it lives, in a breath. */
  where: string;
  /** The two facts it adds up to — what the kind IS, said once. */
  facts: [string, string];
}
export const KINDS: Record<SectionKind, KindMeta> = {
  hosted: {
    label: "Hosted",
    icon: CloudIcon,
    shape: "flower",
    hue: "neutral",
    where: "In your account",
    facts: ["In your account", "Any device"],
  },
  synked: {
    label: "Synked",
    icon: CloudCheckIcon,
    shape: "clover4",
    hue: "neutral",
    where: "On this device, backed up",
    facts: ["On this device", "Backed up in Synk"],
  },
  lokal: {
    label: "Lokal",
    icon: HardDriveIcon,
    shape: "cookie12",
    hue: "neutral",
    where: "In this browser only",
    facts: ["This browser only", "Nothing leaves the device"],
  },
  explore: {
    label: "Explore",
    icon: CompassIcon,
    shape: "sunny",
    hue: "plum",
    where: "Public",
    facts: ["Public example", "Read it, nothing to create"],
  },
};

/** A kind's mark: its shape with its glyph (a plain rounded square under Calm). */
export function KindMark({ kind, size = "m" }: { kind: SectionKind; size?: "s" | "m" | "l" | "xl" }) {
  const k = KINDS[kind];
  const Icon = k.icon;
  return (
    <span className="pj-kindmark" data-size={size} data-pj-hue={k.hue} aria-hidden="true">
      <Shape name={k.shape} className="pj-kindmark-shape" />
      <Icon className="pj-kindmark-icon" />
    </span>
  );
}

// ── numbers & time ──────────────────────────────────────────────────────────

const NF = new Intl.NumberFormat("en-US");
export const fmt = (n: number) => NF.format(n);
export const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

const DAY = 86_400_000;
/** "today", "3 days ago", "2 months ago" — from an ISO stamp. */
export function ago(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = Math.floor((now - t) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 700) return `${Math.round(d / 30)} months ago`;
  return `${Math.round(d / 365)} years ago`;
}
/** The newest stamp we know of: the journal's last event, else the record's own. */
export function touchedAt(card: CardModel): string {
  const j = card.anatomy?.journal?.lastAt;
  return j && j > card.updatedAt ? j : card.updatedAt;
}

// ── anatomy ─────────────────────────────────────────────────────────────────

const SPECIES_ORDER: SpeciesId[] = ["flow", "view", "data-model", "api-endpoint", "acceptance", "decision", "stake", "option"];
const SPECIES_LABEL = Object.fromEntries(SPECIES.map((s) => [s.id, s.label])) as Record<SpeciesId, string>;
const speciesLabel = (id: SpeciesId) => SPECIES_LABEL[id];
const speciesCount = (m: { id: SpeciesId; n: number }) =>
  `${m.n} ${speciesLabel(m.id).toLowerCase()}${m.n === 1 ? "" : "s"}`;

function speciesMix(anatomy: ProjectAnatomy | null): { id: SpeciesId; n: number }[] {
  if (!anatomy) return [];
  return SPECIES_ORDER.map((id) => ({ id, n: anatomy.species[id] ?? 0 })).filter((x) => x.n > 0);
}

/** The species mix as one connected bar. A flat bar when there is nothing (or nothing known). */
export function SpeciesBar({ card }: { card: CardModel }) {
  const mix = speciesMix(card.anatomy);
  const label = mix.length ? `Species mix: ${mix.map(speciesCount).join(", ")}` : undefined;
  return (
    <div
      className="pj-speciesbar"
      data-state={mix.length ? "ready" : "none"}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {mix.length > 0 ? (
        mix.map((m) => (
          <span key={m.id} data-species={m.id} style={{ flexGrow: Math.max(m.n, card.nodeCount * 0.035) }} />
        ))
      ) : (
        <span data-species="none" style={{ flexGrow: 1 }} />
      )}
    </div>
  );
}

/** Species legend: icon + count chips, biggest first. */
export function SpeciesChips({ card, max = 5 }: { card: CardModel; max?: number }) {
  const mix = [...speciesMix(card.anatomy)].sort((a, b) => b.n - a.n).slice(0, max);
  return (
    <ul className="pj-speciesChips">
      {mix.map((m) => {
        const Icon = SPECIES_GRAPH_ICONS[m.id];
        return (
          <li key={m.id} data-species={m.id} title={speciesLabel(m.id)}>
            <Icon aria-hidden="true" />
            <span className="pj-num">{fmt(m.n)}</span>
            <span className="pj-sr">{speciesLabel(m.id)}</span>
          </li>
        );
      })}
    </ul>
  );
}

const PLATFORM_ICON: Record<PlatformId, LucideIcon> = { web: MonitorIcon, ios: AppleIcon, android: BotIcon };
const PLATFORM_NAME: Record<PlatformId, string> = { web: "Web", ios: "iOS", android: "Android" };
/** Platform chips for the platforms the project's nodes carry. Nothing when it has none. */
export function Platforms({ card }: { card: CardModel }) {
  const ids = (Object.keys(card.anatomy?.platforms ?? {}) as PlatformId[]).filter((p) => PLATFORM_ICON[p]);
  if (ids.length === 0) return null;
  return (
    <ul className="pj-platforms">
      {ids.map((p) => {
        const Icon = PLATFORM_ICON[p];
        return (
          <li key={p} title={PLATFORM_NAME[p]}>
            <Icon aria-hidden="true" />
            <span className="pj-sr">{PLATFORM_NAME[p]}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** "Touched 3 days ago". */
export function Touched({ card, prefix = "Touched" }: { card: CardModel; prefix?: string }) {
  const when = ago(touchedAt(card));
  return when ? <span className="pj-touched">{`${prefix} ${when}`}</span> : null;
}

/** The card's real link: the title, stretched over the whole card by CSS (`.pj-link::after`). */
export function CardLink({ card, children }: { card: CardModel; children?: ReactNode }) {
  return (
    <Link href={card.href} className="pj-link">
      {children ?? card.title}
    </Link>
  );
}

/** The sync control and "Move to account", above the link overlay. Nothing when neither exists. */
export function CardActions({ card }: { card: CardModel }) {
  if (!card.syncNode && !card.move) return null;
  return (
    <div className="pj-actions">
      {card.syncNode}
      {card.move ? (
        <Button size="sm" variant="outline" className="pj-move" disabled={card.move.moving} onClick={card.move.onMove}>
          {card.move.moving ? "Moving…" : "Move to account"}
        </Button>
      ) : null}
    </div>
  );
}

// ── ways in ─────────────────────────────────────────────────────────────────

const WAYS = {
  create: { icon: PlusIcon, title: "Create project", note: "Start from a blank map" },
  generate: { icon: SparklesIcon, title: "Generate with AI", note: "Have an AI draft a map to import" },
  import: { icon: FileUpIcon, title: "Import JSON", note: "Bring an Arkaik export" },
  restore: { icon: HistoryIcon, title: "Restore from Synk", note: "Pull back a project you backed up" },
} as const;

export interface WaysIn {
  onCreate: () => void;
  onImport: () => void;
  /** Synked only. */
  onRestore?: () => void;
  /** `/generate?target=…` — kept a real link. */
  generateHref: string;
}

/** The ways in, as rich menu rows (a title and a line). "Generate with AI" stays a real link. */
export function CreateItems({ ways }: { ways: WaysIn }) {
  const row = (w: keyof typeof WAYS) => {
    const { icon: Icon, title, note } = WAYS[w];
    return (
      <>
        <span className="pj-menu-glyph">
          <Icon aria-hidden="true" />
        </span>
        <span className="pj-menu-text">
          <span className="pj-menu-title">{title}</span>
          <span className="pj-menu-note">{note}</span>
        </span>
      </>
    );
  };
  return (
    <>
      <DropdownMenuItem className="pj-menu-item" onSelect={ways.onCreate}>
        {row("create")}
      </DropdownMenuItem>
      <DropdownMenuItem asChild className="pj-menu-item">
        <Link href={ways.generateHref}>{row("generate")}</Link>
      </DropdownMenuItem>
      <DropdownMenuItem className="pj-menu-item" onSelect={ways.onImport}>
        {row("import")}
      </DropdownMenuItem>
      {ways.onRestore ? (
        <DropdownMenuItem className="pj-menu-item" onSelect={ways.onRestore}>
          {row("restore")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/**
 * ONE door for every kind: "New project" opens three tiles — Hosted, Synked,
 * Lokal — each saying where it lives and carrying its own ways in. Signed in
 * only; signed out there is only Lokal and its own menu.
 */
export function Door({ page, label = "New project" }: { page: PageModel; label?: string }) {
  const [open, setOpen] = useState(false);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="pj-door" disabled={page.importing}>
          <PlusIcon aria-hidden="true" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="pj-doorpanel">
        <p className="pj-doorpanel-title">Where should it live?</p>
        <ul>
          {page.sections.map((s) => {
            const k = KINDS[s.target];
            return (
              <li key={s.target} data-pj-hue={k.hue}>
                <div className="pj-doortile-head">
                  <KindMark kind={s.target} size="s" />
                  <div>
                    <b>{k.label}</b>
                    <span>{k.where}</span>
                  </div>
                </div>
                <div className="pj-doortile-ways">
                  <button type="button" onClick={run(() => page.actions.create(s.target))} aria-label={`Create a ${k.label} project`}>
                    <PlusIcon aria-hidden="true" />
                    Create
                  </button>
                  <Link
                    href={page.actions.generateHref(s.target)}
                    onClick={() => setOpen(false)}
                    aria-label={`Generate a ${k.label} project with AI`}
                  >
                    <SparklesIcon aria-hidden="true" />
                    Generate
                  </Link>
                  <button type="button" onClick={run(() => page.actions.import(s.target))} aria-label={`Import JSON as a ${k.label} project`}>
                    <FileUpIcon aria-hidden="true" />
                    Import
                  </button>
                  {s.canRestore ? (
                    <button type="button" onClick={run(() => page.actions.restore())} aria-label="Restore from Synk">
                      <HistoryIcon aria-hidden="true" />
                      Restore
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export const TARGETS: CreateTarget[] = ["hosted", "synked", "lokal"];
