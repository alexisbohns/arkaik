/**
 * The ⌘K palette's brain — the command catalogue plus the pure matching,
 * ranking and completion rules the overlay renders. No React, no icons, no
 * routing: `components/layout/CommandPalette.tsx` owns all of that, this file
 * owns "what can be reached, and which one does the user mean".
 *
 * Two behaviours the overlay leans on:
 * - **Rank**, so the first row is the one Enter should validate.
 * - **Complete**, so Tab can fill the input with the active row's own wording
 *   (its label, or the synonym the user is actually typing — "screens" → Views).
 *
 * One brain, several catalogues: `buildProjectCommands` covers a project's
 * sidebar, `buildDocsCommands` covers the documentation tree. Everything below
 * the catalogues is shared — a palette anywhere else only needs a builder.
 */

/** Icon slots the overlay maps to Lucide components — a closed union so a new
 * command cannot ship without a matching icon. */
export type CommandIconId =
  | "overview"
  | "all-maps"
  | "journey"
  | "system"
  | "custom-map"
  | "library"
  | "acceptances"
  | "views"
  | "flows"
  | "data-models"
  | "api-endpoints"
  | "pyramid"
  | "delivery"
  | "changelog"
  | "settings"
  | "docs"
  | "publish"
  | "theme"
  | "projects"
  | "tokens";

export type CommandGroupId = "pages" | "maps" | "library" | "project" | "actions";

/** Group order in the palette — mirrors the sidebar, so the two read the same.
 * A palette only ever renders the groups its own catalogue fills, so the docs
 * ("Pages") and the project ("Maps"…) groups can share one list. */
export const COMMAND_GROUPS = [
  { id: "pages", label: "Pages" },
  { id: "maps", label: "Maps" },
  { id: "library", label: "Library" },
  { id: "project", label: "Project" },
  { id: "actions", label: "Actions" },
] as const satisfies readonly { id: CommandGroupId; label: string }[];

/** Commands that do something in place instead of navigating. */
export type CommandActionId = "publish" | "toggle-theme";

export type CommandTarget =
  | { kind: "href"; href: string; external?: boolean }
  | { kind: "action"; action: CommandActionId };

export interface PaletteCommand {
  id: string;
  label: string;
  group: CommandGroupId;
  icon: CommandIconId;
  /** Synonyms people actually type. Matched at a lower weight than the label,
   * and usable as a completion source, so "screens" completes to "screens". */
  keywords: readonly string[];
  /** Secondary text on the row — where the command lands. */
  hint?: string;
  target: CommandTarget;
}

export interface CommandMatch {
  command: PaletteCommand;
  score: number;
  /** Indices into `command.label` to emphasise. Empty when the hit came from a
   * keyword, since there is nothing to underline in the label itself. */
  highlight: readonly number[];
  /** Full candidate string the query is a prefix of, or null when the query is
   * a looser (substring / subsequence) match with nothing to append. */
  completion: string | null;
}

interface CandidateScore {
  score: number;
  indices: number[];
}

// Score tiers. The gaps are wide enough that a weaker tier never overtakes a
// stronger one through the length bonus below.
const EXACT = 10_000;
const PREFIX = 8_000;
const WORD_PREFIX = 6_000;
const SUBSTRING = 4_000;
const SUBSEQUENCE = 2_000;
/** Keyword hits sit one tier below the same-shaped label hit. */
const KEYWORD_PENALTY = 1_000;

function wordStarts(text: string): number[] {
  const starts: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const isBoundary = index === 0 || !/[a-z0-9]/i.test(text[index - 1]);
    if (isBoundary && /[a-z0-9]/i.test(text[index])) {
      starts.push(index);
    }
  }
  return starts;
}

function range(start: number, length: number): number[] {
  return Array.from({ length }, (_, offset) => start + offset);
}

/** Subsequence match — every query character in order, gaps allowed. Prefers
 * the tightest run it can find by always taking the earliest next character. */
function subsequenceIndices(haystack: string, needle: string): number[] | null {
  const indices: number[] = [];
  let cursor = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return null;
    indices.push(found);
    cursor = found + 1;
  }
  return indices;
}

/** Score one candidate string against the query, strongest shape wins. */
function scoreCandidate(candidate: string, query: string): CandidateScore | null {
  const haystack = candidate.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return { score: EXACT, indices: [] };
  if (needle.length > haystack.length) return null;

  if (haystack === needle) {
    return { score: EXACT, indices: range(0, needle.length) };
  }

  if (haystack.startsWith(needle)) {
    // Shorter remainders win: "Views" beats "View transitions" on "view".
    return { score: PREFIX - (haystack.length - needle.length), indices: range(0, needle.length) };
  }

  for (const start of wordStarts(haystack)) {
    if (haystack.startsWith(needle, start)) {
      return { score: WORD_PREFIX - start, indices: range(start, needle.length) };
    }
  }

  const substringAt = haystack.indexOf(needle);
  if (substringAt !== -1) {
    return { score: SUBSTRING - substringAt, indices: range(substringAt, needle.length) };
  }

  const indices = subsequenceIndices(haystack, needle);
  if (indices) {
    // Tighter spans read as more intentional: "dm" over "Data Models" beats
    // the same two letters scattered across a long label.
    const span = indices[indices.length - 1] - indices[0];
    return { score: SUBSEQUENCE - span, indices };
  }

  return null;
}

/** The candidate the query is a live prefix of — what Tab should fill in. The
 * label is preferred, so typing "acc" completes to "Acceptances" rather than
 * to a synonym that happens to start the same way. */
function completionFor(command: PaletteCommand, query: string): string | null {
  if (!query) return null;
  const needle = query.toLowerCase();
  // The label is typed out in full: there is nothing left to help with, and
  // ghosting a synonym on top of a finished word only adds noise.
  if (command.label.toLowerCase() === needle) return null;
  const candidates = [command.label, ...command.keywords];
  for (const candidate of candidates) {
    if (candidate.length > query.length && candidate.toLowerCase().startsWith(needle)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Rank the catalogue against what has been typed. An empty query keeps every
 * command in declaration order, which is what the palette shows on open.
 */
export function rankCommands(
  commands: readonly PaletteCommand[],
  query: string,
): CommandMatch[] {
  const trimmed = query.trim();

  // Nothing typed: the catalogue as authored, so the palette opens on the same
  // reading order as the sidebar instead of an arbitrary tie-break.
  if (!trimmed) {
    return commands.map((command) => ({ command, score: 0, highlight: [], completion: null }));
  }

  const matches: (CommandMatch & { order: number })[] = [];
  commands.forEach((command, order) => {
    const labelScore = scoreCandidate(command.label, trimmed);
    let best: CandidateScore | null = labelScore;
    let highlight: number[] = labelScore ? labelScore.indices : [];

    for (const keyword of command.keywords) {
      const keywordScore = scoreCandidate(keyword, trimmed);
      if (!keywordScore) continue;
      const adjusted = keywordScore.score - KEYWORD_PENALTY;
      if (!best || adjusted > best.score) {
        best = { score: adjusted, indices: [] };
        highlight = [];
      }
    }

    if (!best) return;

    matches.push({
      command,
      score: best.score,
      highlight,
      completion: completionFor(command, trimmed),
      order,
    });
  });

  return matches
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.command.label.length !== right.command.label.length) {
        return left.command.label.length - right.command.label.length;
      }
      return left.order - right.order;
    })
    .map(({ command, score, highlight, completion }) => ({ command, score, highlight, completion }));
}

/** The ghost suffix drawn after the caret — the completion minus what is
 * already typed, so the two halves concatenate to the candidate exactly. */
export function completionSuffix(query: string, match: CommandMatch | undefined): string {
  if (!match?.completion) return "";
  // Ranking trims, the caret does not: with stray whitespace the two strings no
  // longer line up, and a ghost that does not continue the caret is worse than
  // no ghost at all.
  if (!match.completion.toLowerCase().startsWith(query.toLowerCase())) return "";
  return match.completion.slice(query.length);
}

/** Shared by every catalogue: the theme is an app-wide concern, and a palette
 * that could switch it in one place but not another would just read as a bug. */
const TOGGLE_THEME_COMMAND: PaletteCommand = {
  id: "toggle-theme",
  label: "Toggle theme",
  group: "actions",
  icon: "theme",
  keywords: ["dark mode", "light mode", "appearance"],
  hint: "Switch light and dark",
  target: { kind: "action", action: "toggle-theme" },
};

interface ProjectCommandInput {
  projectId: string;
  /** Custom maps from `project.metadata.maps`, same list the sidebar renders. */
  customMaps: readonly { id: string; title: string }[];
}

/**
 * Every destination the project sidebar exposes, flattened into one list. The
 * sidebar stays the visual navigation; this is the typed one — when a
 * destination is added there, it belongs here too (tests/app/command-palette
 * pins the pairing).
 */
export function buildProjectCommands({ projectId, customMaps }: ProjectCommandInput): PaletteCommand[] {
  const base = `/project/${projectId}`;

  const commands: PaletteCommand[] = [
    {
      id: "maps",
      label: "All maps",
      group: "maps",
      icon: "all-maps",
      keywords: ["maps", "map gallery", "views of the graph"],
      hint: "Every map of this project",
      target: { kind: "href", href: `${base}/maps` },
    },
    {
      id: "map-journey",
      label: "Journey",
      group: "maps",
      icon: "journey",
      keywords: ["journey map", "flows", "canvas", "graph", "user journey"],
      hint: "Flows and views, end to end",
      target: { kind: "href", href: `${base}/maps/journey` },
    },
    {
      id: "map-system",
      label: "System",
      group: "maps",
      icon: "system",
      keywords: ["system map", "architecture", "data models", "endpoints"],
      hint: "Data models and endpoints",
      target: { kind: "href", href: `${base}/maps/system` },
    },
    ...customMaps.map<PaletteCommand>((map) => ({
      id: `map-${map.id}`,
      label: map.title,
      group: "maps",
      icon: "custom-map",
      keywords: ["custom map", "saved map"],
      hint: "Custom map",
      target: { kind: "href", href: `${base}/maps/${encodeURIComponent(map.id)}` },
    })),
    {
      id: "library",
      label: "All nodes",
      group: "library",
      icon: "library",
      keywords: ["library", "browse", "nodes", "everything"],
      hint: "The whole library",
      target: { kind: "href", href: `${base}/library` },
    },
    {
      id: "acceptances",
      label: "Acceptances",
      group: "library",
      icon: "acceptances",
      keywords: ["criteria", "tests", "acceptance criteria", "checks"],
      hint: "Acceptance criteria",
      target: { kind: "href", href: `${base}/acceptances` },
    },
    {
      id: "library-view",
      label: "Views",
      group: "library",
      icon: "views",
      keywords: ["screens", "pages", "ui"],
      hint: "Library, filtered to views",
      target: { kind: "href", href: `${base}/library?species=view` },
    },
    {
      id: "library-flow",
      label: "Flows",
      group: "library",
      icon: "flows",
      keywords: ["journeys", "sequences", "playlists"],
      hint: "Library, filtered to flows",
      target: { kind: "href", href: `${base}/library?species=flow` },
    },
    {
      id: "library-data-model",
      label: "Data Models",
      group: "library",
      icon: "data-models",
      keywords: ["tables", "schema", "entities", "database"],
      hint: "Library, filtered to data models",
      target: { kind: "href", href: `${base}/library?species=data-model` },
    },
    {
      id: "library-api-endpoint",
      label: "API Endpoints",
      group: "library",
      icon: "api-endpoints",
      keywords: ["routes", "api", "backend", "requests"],
      hint: "Library, filtered to API endpoints",
      target: { kind: "href", href: `${base}/library?species=api-endpoint` },
    },
    {
      id: "overview",
      label: "Overview",
      group: "project",
      icon: "overview",
      keywords: ["dashboard", "home", "summary", "coverage"],
      hint: "Project dashboard",
      target: { kind: "href", href: `${base}/overview` },
    },
    {
      id: "pyramid",
      label: "Pyramid",
      group: "project",
      icon: "pyramid",
      keywords: ["value pyramid", "value", "levels"],
      hint: "Value pyramid",
      target: { kind: "href", href: `${base}/pyramid` },
    },
    {
      id: "delivery",
      label: "Delivery",
      group: "project",
      icon: "delivery",
      keywords: ["board", "kanban", "backlog", "statuses"],
      hint: "Delivery board",
      target: { kind: "href", href: `${base}/delivery` },
    },
    {
      id: "changelog",
      label: "Changelog",
      group: "project",
      icon: "changelog",
      keywords: ["releases", "history", "journal", "timeline"],
      hint: "Releases and history",
      target: { kind: "href", href: `${base}/changelog` },
    },
    {
      id: "settings",
      label: "Settings",
      group: "project",
      icon: "settings",
      keywords: ["preferences", "config", "project settings", "danger zone"],
      hint: "Project settings",
      target: { kind: "href", href: `${base}/settings` },
    },
    {
      id: "publish",
      label: "Publish",
      group: "actions",
      icon: "publish",
      keywords: ["publik", "share", "snapshot", "link"],
      hint: "Share a Publik snapshot",
      target: { kind: "action", action: "publish" },
    },
    TOGGLE_THEME_COMMAND,
    {
      id: "projects",
      label: "All projects",
      group: "actions",
      icon: "projects",
      keywords: ["switch project", "open project", "project list", "home"],
      hint: "Leave for the project list",
      target: { kind: "href", href: "/projects" },
    },
    {
      id: "tokens",
      label: "Agent tokens",
      group: "actions",
      icon: "tokens",
      keywords: ["api token", "cli", "mcp", "account"],
      hint: "Account settings",
      target: { kind: "href", href: "/settings/tokens" },
    },
    {
      id: "docs",
      label: "Documentation",
      group: "actions",
      icon: "docs",
      keywords: ["docs", "help", "guide", "manual"],
      hint: "Opens in a new tab",
      target: { kind: "href", href: "/docs", external: true },
    },
  ];

  return commands;
}

/** One page of the documentation, as the docs shell knows it. Plain data on
 * purpose: it crosses the server/client boundary as a prop. */
export interface DocsPage {
  /** Route of the page — unique, so it doubles as the command id. */
  href: string;
  label: string;
  /** Folder trail above the page ("Spec"), shown as the row's hint. */
  section?: string;
}

/**
 * What a page's own address offers a searcher for free. Titles and filenames
 * drift apart ("The five species" lives at `graph-model`), and people type
 * whichever one they remember — so the slug becomes a synonym, hyphens and all,
 * spelled both ways.
 */
function slugKeywords(href: string): string[] {
  const parts = href.replace(/^\/docs\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) return ["docs", "documentation", "home", "readme"];

  const keywords = new Set<string>([parts.join("/")]);
  for (const part of parts) {
    keywords.add(part);
    if (part.includes("-")) keywords.add(part.replace(/-/g, " "));
  }
  return [...keywords];
}

interface DocsCommandInput {
  /** Every navigable docs page, in the order the sidebar lists them. */
  pages: readonly DocsPage[];
}

/**
 * The documentation as one searchable list. Mirrors `DocsSidebar`: the same
 * pages, the same reading order, minus the folder rows — a folder is a heading,
 * not somewhere you can land.
 */
export function buildDocsCommands({ pages }: DocsCommandInput): PaletteCommand[] {
  return [
    ...pages.map<PaletteCommand>((page) => ({
      id: `doc:${page.href}`,
      label: page.label,
      group: "pages",
      icon: "docs",
      keywords: slugKeywords(page.href),
      hint: page.section,
      target: { kind: "href", href: page.href },
    })),
    {
      id: "back-to-app",
      label: "Back to the app",
      group: "actions",
      icon: "projects",
      keywords: ["arkaik", "projects", "leave the docs", "home"],
      hint: "Your projects",
      target: { kind: "href", href: "/projects" },
    },
    TOGGLE_THEME_COMMAND,
  ];
}
