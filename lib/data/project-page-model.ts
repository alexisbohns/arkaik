/**
 * The projects page as data — what its sections and cards render.
 *
 * The page's rules live HERE, once, so no component re-derives them:
 *  - section membership: `groupBySection` (seed → explore; hosted; backed up → synked; else lokal);
 *  - "Move to account": only a non-hosted, non-seed project, and only when there is an account to move to;
 *  - the sync control: only a browser-held, non-seed project (a hosted one has nothing to back up);
 *  - signed out, only Lokal exists — no Hosted or Synked section at all;
 *  - the totals count your own projects, never the public example.
 *
 * No runtime imports: the test loader transpiles this file alone.
 */
import type { ReactNode } from "react";
import type { CreateTarget } from "./create-target";
import type { ProjectSummary } from "./data-provider";
import type { ProjectAnatomy } from "./project-anatomy";
import type { GroupedProjects } from "./project-sections";

export type SectionKind = CreateTarget | "explore";

export interface CardModel {
  id: string;
  /** `/project/<id>` — the card IS this link. */
  href: string;
  title: string;
  description: string | null;
  section: SectionKind;
  /** The built-in public project (Explore). */
  isSeed: boolean;
  hosted: boolean;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
  /** What the graph is made of and how alive its journal is; null when the backend could not say. */
  anatomy: ProjectAnatomy | null;
  /** "Move to account" — null when it must not show. */
  move: null | { moving: boolean; onMove: () => void };
  /** The live ProjectSyncControl, to place as is. Null when the project has no sync. */
  syncNode: ReactNode;
}

export interface SectionModel {
  target: CreateTarget;
  /** "Hosted" | "Synked" | "Lokal". */
  title: string;
  /** What this kind of project IS. */
  blurb: string;
  items: CardModel[];
  /** Synked only: restoring from Synk is a way in. */
  canRestore: boolean;
}

export interface PageModel {
  signedIn: boolean;
  /** A create or import is in flight. */
  importing: boolean;
  /** Signed in: hosted, synked, lokal. Signed out: lokal only. */
  sections: SectionModel[];
  explore: CardModel[];
  /** Your own projects (no seed), newest `updatedAt` first. */
  recent: CardModel[];
  totals: { projects: number; nodes: number; edges: number };
  actions: {
    create: (target: CreateTarget) => void;
    import: (target: CreateTarget) => void;
    /** Opens the Synk restore dialog (signed in only). */
    restore: () => void;
    generateHref: (target: CreateTarget) => string;
  };
}

export const SECTION_COPY: Record<CreateTarget, { title: string; blurb: string }> = {
  hosted: {
    title: "Hosted",
    blurb: "Projects that live in your account, reachable from any device.",
  },
  synked: {
    title: "Synked",
    blurb: "Projects that stay on this device and keep a backup in Synk.",
  },
  lokal: {
    title: "Lokal",
    blurb: "Projects that live only in this browser. Nothing leaves the device.",
  },
};

export function buildCardModel(
  summary: ProjectSummary,
  section: SectionKind,
  opts: {
    /** True when the signed-in user has somewhere to move a local project to. */
    canHost: boolean;
    /** True while THIS project is being copied into the account. */
    moving: boolean;
    onMove: () => void;
    syncNode: ReactNode;
  },
): CardModel {
  const isSeed = Boolean(summary.seed);
  const browserHeld = !summary.hosted && !isSeed;
  return {
    id: summary.project.id,
    href: `/project/${summary.project.id}`,
    title: summary.project.title,
    description: summary.project.description || null,
    section,
    isSeed,
    hosted: summary.hosted,
    nodeCount: summary.nodeCount,
    edgeCount: summary.edgeCount,
    createdAt: summary.project.created_at,
    updatedAt: summary.project.updated_at,
    anatomy: summary.anatomy ?? null,
    move: browserHeld && opts.canHost ? { moving: opts.moving, onMove: opts.onMove } : null,
    syncNode: browserHeld ? opts.syncNode : null,
  };
}

export function buildPageModel(args: {
  signedIn: boolean;
  importing: boolean;
  grouped: GroupedProjects;
  card: (summary: ProjectSummary, section: SectionKind) => CardModel;
  actions: PageModel["actions"];
}): PageModel {
  const { grouped, card } = args;
  const targets: CreateTarget[] = args.signedIn ? ["hosted", "synked", "lokal"] : ["lokal"];
  const sections = targets.map<SectionModel>((target) => ({
    target,
    title: SECTION_COPY[target].title,
    blurb: SECTION_COPY[target].blurb,
    items: grouped[target].map((s) => card(s, target)),
    canRestore: target === "synked",
  }));
  const own = sections.flatMap((s) => s.items);
  return {
    signedIn: args.signedIn,
    importing: args.importing,
    sections,
    explore: grouped.explore.map((s) => card(s, "explore")),
    recent: [...own].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    totals: {
      projects: own.length,
      nodes: own.reduce((n, c) => n + c.nodeCount, 0),
      edges: own.reduce((n, c) => n + c.edgeCount, 0),
    },
    actions: args.actions,
  };
}
