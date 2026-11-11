/**
 * The ⌘K palette's brain — the command catalogue plus the pure matching,
 * ranking and completion rules the overlay renders. No React, no icons, no
 * routing: `components/layout/CommandPalette.tsx` owns all of that, this file
 * owns "what can be reached, and which one does the user mean".
 *
 * Two behaviours the overlay leans on:
 * - **Rank**, so the first row is the one Enter should validate.
 * - **Complete**, so Tab can fill the input with the active row's own wording
 *   (its label, or the synonym the user is actually typing — "pages" → Views).
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
  | "screens"
  | "custom-map"
  | "library"
  | "acceptances"
  | "views"
  | "flows"
  | "data-models"
  | "api-endpoints"
  | "pyramid"
  | "delivery"
  | "design"
  | "changelog"
  | "quality"
  | "quality-findings"
  | "settings"
  | "docs"
  | "publish"
  | "theme"
  | "shortcuts"
  | "projects"
  | "tokens"
  | "create";

export type CommandGroupId = "create" | "pages" | "maps" | "flows" | "views" | "library" | "project" | "actions";

/** Group order in the palette — mirrors the sidebar, so the two read the same.
 * A palette only ever renders the groups its own catalogue fills, so the docs
 * ("Pages") and the project ("Maps"…) groups can share one list. */
export const COMMAND_GROUPS = [
  // The page's own create action, registered by `PageShell` — first, because
  // it is the one thing the palette offers that depends on where you are.
  { id: "create", label: "Create" },
  { id: "pages", label: "Pages" },
  { id: "maps", label: "Maps" },
  // Search-only rows (`buildNodeCommands`): one per flow and per view in scope.
  // They never show on an empty query, so these two headings only ever appear
  // once something is typed.
  { id: "flows", label: "Flows" },
  { id: "views", label: "Views" },
  { id: "library", label: "Library" },
  { id: "project", label: "Project" },
  { id: "actions", label: "Actions" },
] as const satisfies readonly { id: CommandGroupId; label: string }[];

/** Commands that do something in place instead of navigating. */
export type CommandActionId = "publish" | "toggle-theme" | "show-shortcuts";

export type CommandTarget =
  | { kind: "href"; href: string; external?: boolean }
  | { kind: "action"; action: CommandActionId }
  /** A page-registered command (`usePageAction`): the page runs it itself. */
  | { kind: "run"; run: () => void }
  /** A flow or view of the project (`buildNodeCommands`): the overlay hands the
   * id to its `onNode` prop, and the page on screen decides what "go to it"
   * means — fly to it, open its panel, or leave for the Library. */
  | { kind: "node"; nodeId: string };

export interface PaletteCommand {
  id: string;
  label: string;
  group: CommandGroupId;
  icon: CommandIconId;
  /** Synonyms people actually type. Matched at a lower weight than the label,
   * and usable as a completion source, so "page" completes to "pages". */
  keywords: readonly string[];
  /** Secondary text on the row — where the command lands. */
  hint?: string;
  target: CommandTarget;
  /** Offered only once something is typed: an empty query drops it, and a
   * typed one ranks it `NODE_PENALTY` below a page of the same shape. */
  searchOnly?: boolean;
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
/**
 * What a search-only row (a flow or a view) gives up against a page. Half a
 * keyword step: a page beats a node title of the same shape ("Settings" the
 * page, 10000, over a view titled "Settings", 9500), but a node's exact title
 * still beats a page's prefix (at most 8000) or a page's exact keyword (9000).
 * An exact node id, a keyword, lands at 8500.
 */
export const NODE_PENALTY = 500;
/** How many search-only rows one group shows (`limitSearchOnly`). */
export const SEARCH_ONLY_PER_GROUP = 6;

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

/**
 * The keywords a query is scored against. A node row's own keyword is its id
 * without the species prefix (`buildNodeCommands`): every view id starts `V-`
 * and every flow id `F-`, so the full id as a keyword would let a bare "v" or
 * "f" match every row. The full id joins only for a query with a hyphen in it
 * — someone typing or pasting an id — so `V-home` still finds its view.
 */
function keywordsFor(command: PaletteCommand, query: string): readonly string[] {
  if (command.target.kind !== "node" || !query.includes("-")) return command.keywords;
  return [...command.keywords, command.target.nodeId];
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
  const candidates = [command.label, ...keywordsFor(command, query)];
  for (const candidate of candidates) {
    if (candidate.length > query.length && candidate.toLowerCase().startsWith(needle)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Rank the catalogue against what has been typed. An empty query keeps every
 * command in declaration order, which is what the palette shows on open —
 * minus the search-only rows, so the idle palette never lists seventy nodes.
 */
export function rankCommands(
  commands: readonly PaletteCommand[],
  query: string,
): CommandMatch[] {
  const trimmed = query.trim();

  // Nothing typed: the catalogue as authored, so the palette opens on the same
  // reading order as the sidebar instead of an arbitrary tie-break.
  if (!trimmed) {
    return commands
      .filter((command) => !command.searchOnly)
      .map((command) => ({ command, score: 0, highlight: [], completion: null }));
  }

  const matches: (CommandMatch & { order: number })[] = [];
  commands.forEach((command, order) => {
    const labelScore = scoreCandidate(command.label, trimmed);
    let best: CandidateScore | null = labelScore;
    let highlight: number[] = labelScore ? labelScore.indices : [];

    for (const keyword of keywordsFor(command, trimmed)) {
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
      score: command.searchOnly ? best.score - NODE_PENALTY : best.score,
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

/**
 * At most `perGroup` search-only rows per group, in ranked order; every other
 * row is kept. Applied by the overlay after `rankCommands`: "pe" matches
 * dozens of views, and a list that long buries the pages under them.
 */
export function limitSearchOnly(
  matches: readonly CommandMatch[],
  perGroup: number = SEARCH_ONLY_PER_GROUP,
): CommandMatch[] {
  const kept = new Map<CommandGroupId, number>();
  return matches.filter((match) => {
    if (!match.command.searchOnly) return true;
    const count = kept.get(match.command.group) ?? 0;
    if (count >= perGroup) return false;
    kept.set(match.command.group, count + 1);
    return true;
  });
}

/**
 * What the overlay lists for a query: `rankCommands`, then `limitSearchOnly`.
 * In that order — the cap keeps each group's best rows, so it has to see the
 * ranking first. One function so the overlay and its test cannot disagree.
 */
export function paletteMatches(
  commands: readonly PaletteCommand[],
  query: string,
  perGroup: number = SEARCH_ONLY_PER_GROUP,
): CommandMatch[] {
  return limitSearchOnly(rankCommands(commands, query), perGroup);
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

/** Also shared: ⌘? works everywhere, so the palette offers it everywhere —
 * and a cheat sheet you can only reach by already knowing a chord is a joke. */
const SHOW_SHORTCUTS_COMMAND: PaletteCommand = {
  id: "show-shortcuts",
  label: "Keyboard shortcuts",
  group: "actions",
  icon: "shortcuts",
  keywords: ["kbd", "hotkeys", "keys", "cheat sheet", "help"],
  hint: "See every shortcut",
  target: { kind: "action", action: "show-shortcuts" },
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
    {
      id: "map-screens",
      label: "Screens",
      group: "maps",
      icon: "screens",
      keywords: ["screens map", "screenshots", "wall", "shots"],
      hint: "What is live, screen by screen",
      target: { kind: "href", href: `${base}/maps/screens` },
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
      id: "design",
      label: "Design",
      group: "project",
      icon: "design",
      keywords: ["backlog", "ideas", "commitments", "decisions", "funnel"],
      hint: "Backlog, commitments, decisions",
      target: { kind: "href", href: `${base}/design` },
    },
    {
      id: "changelog",
      label: "Changelog",
      group: "project",
      icon: "changelog",
      keywords: ["releases", "milestones", "shipped", "journal", "timeline"],
      hint: "Milestones and what shipped",
      target: { kind: "href", href: `${base}/changelog` },
    },
    {
      id: "quality",
      label: "Quality matrix",
      group: "project",
      icon: "quality",
      keywords: ["audit", "matrix", "kritik", "score", "grade", "domain", "surface"],
      hint: "Every domain, surface by surface",
      target: { kind: "href", href: `${base}/quality/matrix` },
    },
    {
      id: "quality-findings",
      label: "Findings",
      group: "project",
      icon: "quality-findings",
      keywords: ["audit", "findings", "kritik", "severity", "priority", "issues"],
      hint: "What the audit raised",
      target: { kind: "href", href: `${base}/quality/findings` },
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
    SHOW_SHORTCUTS_COMMAND,
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

/** The node shape `summarizePaletteNodes` reads — structural on purpose, so this
 * file keeps no imports (its test loader transpiles it alone). */
interface PaletteNodeInput {
  id: string;
  species: string;
  title: string;
  metadata?: { playlist?: { entries?: unknown } } | null;
}

interface PaletteNodeSummary {
  /** Snapshot order. `screenCount` = distinct views the flow lists. */
  flows: { id: string; title: string; screenCount: number }[];
  /** Snapshot order. `firstFlowTitle` = the first flow, in snapshot order, that lists the view. */
  views: { id: string; title: string; firstFlowTitle: string | null }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The view ids a playlist lists, in order, duplicates kept. Walks `view`
 * entries and the arms of `condition` and `junction`; a `flow` entry is a
 * sub-flow with its own row, so its views are never counted here (and a flow
 * that lists itself cannot loop). Anything malformed is skipped, not thrown:
 * the palette must open on a bundle the validator would warn about.
 */
function playlistViewIds(entries: unknown, out: string[] = []): string[] {
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry.type === "view" && typeof entry.view_id === "string") {
      out.push(entry.view_id);
    } else if (entry.type === "condition") {
      playlistViewIds(entry.if_true, out);
      playlistViewIds(entry.if_false, out);
    } else if (entry.type === "junction" && Array.isArray(entry.cases)) {
      for (const branch of entry.cases) {
        if (isRecord(branch)) playlistViewIds(branch.entries, out);
      }
    }
  }
  return out;
}

/** A row needs words: a blank title falls back to the id, which always exists. */
function rowTitle(node: PaletteNodeInput): string {
  return typeof node.title === "string" && node.title.trim() !== "" ? node.title : node.id;
}

/**
 * The flows and views of a snapshot, as the palette lists them. The caller
 * scopes `nodes` first: a view listed only by a flow outside the scope reads
 * "Not in a flow", as it does on the Screens map. Only views present in
 * `nodes` are counted, so a dangling or out-of-scope reference counts nothing.
 */
export function summarizePaletteNodes(nodes: readonly PaletteNodeInput[]): PaletteNodeSummary {
  const viewIds = new Set(nodes.filter((node) => node.species === "view").map((node) => node.id));
  const firstFlowTitle = new Map<string, string>();
  const flows: PaletteNodeSummary["flows"] = [];

  for (const node of nodes) {
    if (node.species !== "flow") continue;
    const title = rowTitle(node);
    const listed = new Set(playlistViewIds(node.metadata?.playlist?.entries).filter((id) => viewIds.has(id)));
    for (const viewId of listed) {
      if (!firstFlowTitle.has(viewId)) firstFlowTitle.set(viewId, title);
    }
    flows.push({ id: node.id, title, screenCount: listed.size });
  }

  const views = nodes
    .filter((node) => node.species === "view")
    .map((node) => ({ id: node.id, title: rowTitle(node), firstFlowTitle: firstFlowTitle.get(node.id) ?? null }));

  return { flows, views };
}

/** An id's own words: `V-home` → `home`. An id that is all prefix keeps itself. */
function idStem(id: string): string {
  return id.replace(/^[A-Za-z]+-/, "") || id;
}

/**
 * One search-only row per flow and per view. The id without its species
 * prefix is the keyword, so "home" finds `V-home` and a bare "v" matches
 * nothing by it; `rankCommands` reads the full id from the node target for a
 * query with a hyphen, so a pasted `V-home` still finds its view. The hint
 * says where the row sits — a flow's size, a view's first flow.
 */
export function buildNodeCommands(input: ReturnType<typeof summarizePaletteNodes>): PaletteCommand[] {
  return [
    ...input.flows.map<PaletteCommand>((flow) => ({
      id: `node:${flow.id}`,
      label: flow.title,
      group: "flows",
      icon: "flows",
      keywords: [idStem(flow.id)],
      hint: flow.screenCount === 1 ? "1 screen" : `${flow.screenCount} screens`,
      searchOnly: true,
      target: { kind: "node", nodeId: flow.id },
    })),
    ...input.views.map<PaletteCommand>((view) => ({
      id: `node:${view.id}`,
      label: view.title,
      group: "views",
      icon: "views",
      keywords: [idStem(view.id)],
      hint: view.firstFlowTitle ?? "Not in a flow",
      searchOnly: true,
      target: { kind: "node", nodeId: view.id },
    })),
  ];
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
    SHOW_SHORTCUTS_COMMAND,
  ];
}
