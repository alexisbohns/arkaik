import type { PreviewId, PreviewSource } from "@/components/landing/previews/ids";

export type PartId = "maps" | "truth" | "quality" | "agents" | "run";

export interface Part {
  id: PartId;
  title: string;
  intro: string;
}

/** A static card under a preview-less section (E1: the four run modes). */
export interface SectionCard {
  title: string;
  /** Mono kicker above the title, e.g. "LOCAL-FIRST". */
  kicker: string;
  body: string;
}

/** A call to action under a section; `primary` gets the filled button. */
export interface SectionLink {
  label: string;
  href: string;
  primary?: boolean;
  external?: boolean;
}

export interface Section {
  id: string;
  part: PartId;
  title: string;
  why: string;
  what: string;
  how: string;
  preview: PreviewId | "none";
  cards?: SectionCard[];
  links?: SectionLink[];
}

/** Page order of chapters. Reordering the page is reordering this array. */
export const PARTS: Part[] = [
  { id: "maps",  title: "Read your product",        intro: "One graph, four maps. A strategist zooms out, an operator zooms in, an agent queries. Same data." },
  { id: "truth", title: "Track truth, not fields",  intro: "Status is a history with a platform, not a dropdown. Every claim on the map can be checked." },
  { id: "quality", title: "Keep it honest", intro: "A map says what exists. Kritik says how good it is, surface by surface, and what to fix first." },
  { id: "agents", title: "Maintained by agents", intro: "Nobody maintains a map by hand for long. Arkaik is built to be read and written by the agents that already write the code." },
  { id: "run",   title: "Run it your way",        intro: "No account to start, no lock-in to stay. One bundle format under every way of running it." },
];

/** Page order within each chapter. */
export const SECTIONS: Section[] = [
  {
    id: "journey-map", part: "maps", title: "Journey map", preview: "journey-map",
    why: "Navigation is how people experience a product, so it is the first reading of the map.",
    what: "Flows are ordered playlists of views and sub-flows, with conditions and junctions. Drill from a top-level flow down to a screen.",
    how: "The compose edges are synthesized from the playlist, so a flow cannot lie about its own screens.",
  },
  {
    id: "system-map", part: "maps", title: "System map", preview: "system-map",
    why: "Every backend change starts with the same question: which screens render this, and what does this endpoint feed?",
    what: "Views, API endpoints and data models as tiers, with the cross-layer edges drawn between them.",
    how: "Scoped by a root anchor and laid out by species tier. A custom map is a saved JSON definition, not a feature.",
  },
  {
    id: "delivery-board", part: "maps", title: "Delivery board", preview: "delivery-board",
    why: "\"What is in flight on Android?\" has no answer in a task tracker, because tasks are not screens.",
    what: "A board of (node × platform) items grouped by status. A view live on iOS and in backlog on Android sits in both columns, by design.",
    how: "The rows are the same projection the MCP tool serves, so the board and the agent never disagree.",
  },
  {
    id: "overview-cards", part: "maps", title: "Overview", preview: "overview-cards",
    why: "A strategist wants one screen that says where the product stands.",
    what: "Per-platform delivery gauges, the release pulse, backlog, inventory, parity and quality grade.",
    how: "Every card is a pure projection over the snapshot and the journal. No card computes its own numbers.",
  },
  {
    id: "platform-statuses", part: "truth", title: "Platform statuses", preview: "platform-statuses",
    why: "One status per feature hides that Web shipped and iOS did not.",
    what: "Seven lifecycle statuses, stored per platform, plus a blocked-by flag that keeps the status and names the dependency.",
    how: "Acceptances carry the stored values; views and flows roll them up through one function shared by the app, the CLI and the MCP server.",
  },
  {
    id: "acceptance-matrix", part: "truth", title: "Acceptances and parity", preview: "acceptance-matrix",
    why: "\"Live\" is a claim. An acceptance is a testable promise.",
    what: "Given / When / Then per acceptance, linked to the views it proves, one status column per platform. Parity gaps in one click.",
    how: "Merged pull requests promote acceptances through the GitHub App, scoped per platform.",
  },
  {
    id: "value-pyramid", part: "truth", title: "Value pyramid", preview: "value-pyramid",
    why: "Features should answer \"what value does this create\", not only \"is it done\".",
    what: "Thirty value elements in four tiers, each with a delivery gauge and an acceptance count.",
    how: "Acceptances are tagged with values; the pyramid aggregates them and links back to the matrix.",
  },
  {
    id: "decision-chain", part: "truth", title: "Decisions", preview: "decision-chain",
    why: "A map without its reasons is archaeology.",
    what: "ADR-style decisions with their own status, and three edges: supersedes, generates an acceptance, impacts a node.",
    how: "Decision status maps onto lifecycle status at write time, and the validator flags any mismatch.",
  },
  {
    id: "journal-changelog", part: "truth", title: "Journal and changelog", preview: "journal-changelog",
    why: "\"What changed between versions\" needs history, and history must never bloat the snapshot.",
    what: "An append-only event log; node timelines, changelogs per release, release notes and the backlog are derived from it.",
    how: "The snapshot is authoritative for now, the journal for history, and the validator cross-checks them by value.",
  },
  {
    id: "quality-matrix", part: "quality", title: "Quality matrix", preview: "quality-matrix",
    why: "\"How good is each surface, and what do we fix first\" deserves one comparable answer, not a folder of audit PDFs.",
    what: "Criteria scored 0 to 4 per surface, weighted into domain scores and rolled up to a grade. An open critical finding caps the grade.",
    how: "Scores and findings are data files in the repo; severity, priority and grade are derived, never stored, so two readers cannot disagree.",
  },
  {
    id: "findings-board", part: "quality", title: "Findings and signals", preview: "findings-board",
    why: "An audit is a snapshot. Regressions happen between audits, when nobody is looking.",
    what: "Findings with a lifecycle: open, resolved, refuted, accepted risk. Signals that trip on regression. A board that opens on the open work.",
    how: "CI trips signals over HTTP; agents open and resolve findings through MCP tools. Both are journal events, so the board is never stale.",
  },
  {
    id: "agent-skill-diff", part: "agents", title: "The agent skill", preview: "agent-skill-diff",
    why: "Documentation rots because updating it is a second task. A map that lives in the repo can be patched in the same commit as the code.",
    what: "A Claude Code skill that knows the schema, patches the affected nodes surgically, and appends the matching journal event.",
    how: "npx arkaik init scaffolds it into any repo; the bundled validator is a hard gate, so a snapshot its journal contradicts never lands.",
  },
  {
    id: "mcp-server", part: "agents", title: "The MCP server", preview: "mcp-server",
    why: "An agent should not parse a 4,000-line JSON into its context to answer \"what is live on the web\".",
    what: "arkaik-mcp: read tools that are the pages' own projections, write tools gated by the validator, Kritik tools for findings and signals.",
    how: "One tool catalog over two stores, a repo bundle or the hosted API. Clients send operations, not graphs, and every write is a journal event.",
  },
  {
    id: "prompt-builder", part: "agents", title: "Start from a prompt", preview: "prompt-builder",
    why: "An empty map is the hardest one to start.",
    what: "A prompt builder that turns a pitch, an existing plan or a map you already have into a first bundle, for whichever model you use.",
    how: "The generated output goes through the same schema validation as everything else before it is imported, so a hallucinated field never lands.",
  },
  {
    id: "modes", part: "run", title: "Lokal, Publik, Synk, Inkognito", preview: "none",
    why: "A tool for your product's anatomy should not decide where that anatomy lives.",
    what: "Four ways to run Arkaik, from a browser tab with no account to your own infrastructure.",
    how: "The same bundle format under all of them: export from one, import into another. The schema and toolchain are MIT; the hosted services are open too.",
    cards: [
      { kicker: "LOKAL", title: "In your browser", body: "Local-first in IndexedDB. Works offline, needs no account, and exports the whole project as one JSON file." },
      { kicker: "PUBLIK", title: "Published snapshot", body: "A read-only copy at arkaik.app/p/{id} for anyone you send the link to. Strip what should stay private before it leaves." },
      { kicker: "SYNK", title: "Hosted with a free account", body: "Backups, hosted projects, the GitHub App and the MCP remote store, behind a GitHub sign-in." },
      { kicker: "INKOGNITO", title: "Self-hosted", body: "Run the services on your own Postgres and storage. Same code, your keys, nobody else's database." },
    ],
  },
  {
    id: "self-map", part: "run", title: "Arkaik maps itself", preview: "self-map-journey",
    why: "The strongest proof of a product graph is the tool's own.",
    what: "Every flow of Arkaik, live, as the built-in self-map project ships in the app. Pan around, then open it and drill in.",
    how: "The same seed file the app loads, maintained by the same skill, validated by the same gate, and published with every release.",
    links: [{ label: "Open the self-map", href: "/project/arkaik-self-map/maps/journey" }],
  },
  {
    id: "start", part: "run", title: "Start with your product", preview: "none",
    why: "Everything above was rendered from a JSON file. Yours can be one prompt or one command away.",
    what: "Create a project in the browser, generate a first map from a pitch, or run npx arkaik init in a repo and let the skill grow it.",
    how: "Free to start, open source to stay. The docs cover every path, and the self-map is the worked example.",
    links: [
      { label: "Start building", href: "/projects", primary: true },
      { label: "Generate a map", href: "/generate" },
      { label: "Read the docs", href: "/docs" },
      { label: "GitHub", href: "https://github.com/alexisbohns/arkaik", external: true },
    ],
  },
];

/** The frame caption naming a preview's seed. Copy, so it lives here, not in the catalogue. */
export const SOURCE_CAPTION: Record<PreviewSource, string> = {
  "self-map": "Rendered from Arkaik's own map, right now.",
  pebbles: "Rendered from the built-in Pebbles example, right now.",
  "pilot-audit": "Rendered from an illustrative Kritik audit of the Pebbles example, right now.",
};
