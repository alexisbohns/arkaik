import type { PreviewId, PreviewSource } from "@/components/landing/previews/ids";

export type PartId = "maps" | "truth" | "quality" | "agents" | "run";

export interface Part {
  id: PartId;
  title: string;
  intro: string;
}

export interface Section {
  id: string;
  part: PartId;
  title: string;
  why: string;
  what: string;
  how: string;
  preview: PreviewId | "none";
}

/** Page order of chapters. Reordering the page is reordering this array. */
export const PARTS: Part[] = [
  { id: "maps",  title: "Read your product",        intro: "One graph, four maps. A strategist zooms out, an operator zooms in, an agent queries. Same data." },
  { id: "truth", title: "Track truth, not fields",  intro: "Status is a history with a platform, not a dropdown. Every claim on the map can be checked." },
  { id: "quality", title: "Keep it honest", intro: "A map says what exists. Kritik says how good it is, surface by surface, and what to fix first." },
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
];

/** The frame caption naming a preview's seed. Copy, so it lives here, not in the catalogue. */
export const SOURCE_CAPTION: Record<PreviewSource, string> = {
  "self-map": "Rendered from Arkaik's own map, right now.",
  pebbles: "Rendered from the built-in Pebbles example, right now.",
  "pilot-audit": "Rendered from an illustrative Kritik audit of the Pebbles example, right now.",
};
