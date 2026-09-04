#!/usr/bin/env node

// journal→pollen projection (lib/pollen/map.ts) — the arkaik adapter's core.
// Spec: ariko docs/superpowers/specs/2026-08-15-arkaik-adapter-design.md §3.
const { loadPollen } = require("./load-pollen");

const { contract, map } = loadPollen();
const { journalToPollen } = map;
const { validatePollen } = contract;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const CONFIG = { plant: "pbbls" };
const NODES = [{ id: "DEC-postgres-first", species: "decision", title: "PostgreSQL-first relational schema", status: "live" }];

// --- unmapped families are silently absent (not skipped-with-reason) ---
{
  const { pollen, skipped } = journalToPollen(
    [
      { id: "01A", ts: "2026-08-01T10:00:00Z", type: "node.created", node_id: "V-x", species: "view", title: "X" },
      { id: "01B", ts: "2026-08-01T10:01:00Z", type: "edge.added", edge_id: "e1", source_id: "a", target_id: "b", edge_type: "composes" },
      { id: "01C", ts: "2026-08-01T10:02:00Z", type: "idea.proposed", title: "an idea" },
    ],
    NODES, CONFIG,
  );
  check("graph noise unmapped", pollen.length === 0 && skipped.length === 0);
}

// --- deliverable.shipped → shipped ---
{
  const events = [
    { id: "01D", ts: "2026-08-02T10:00:00Z", type: "deliverable.shipped", deliverable_id: "pr-23",
      title: "Your path, laid out day by day", summary: "Grouped by day.", url: "https://github.com/x/pbbls/pull/23",
      node_ids: ["V-timeline"] },
  ];
  const { pollen } = journalToPollen(events, NODES, CONFIG);
  const p = pollen[0];
  check("shipped kind", p.kind === "shipped");
  check("shipped id", p.id === "arkaik:01D");
  check("shipped at = event ts", p.at === "2026-08-02T10:00:00Z");
  check("shipped source", p.source === "arkaik");
  check("shipped anchor", p.anchors.plant === "plant:pbbls");
  check("shipped title from event", p.title === "Your path, laid out day by day");
  check("shipped PR ref", p.refs.some((r) => r.label === "pull request" && r.url === "https://github.com/x/pbbls/pull/23"));
  check("shipped deliverable ref", p.refs.some((r) => r.label === "deliverable" && r.ref === "pr-23"));
  check("shipped payload", p.payload.summary === "Grouped by day." && p.payload.node_ids[0] === "V-timeline");
  const validated = validatePollen(p);
  check("shipped validates warning-free", validated.ok && validated.warnings.length === 0, validated.ok ? "" : validated.error);
}

// --- a deliverable's platform reaches the feed ---
//
// The federation renders these grains, and a shipped grain that says WHAT
// changed while staying silent about WHERE it landed is half a fact — the same
// half the changelog card was missing before the deliverable carried a
// platform at all. `release.tagged` already carries its own; this is the other
// event that has one.
{
  const events = [
    { id: "01D2", ts: "2026-08-24T10:00:00Z", type: "deliverable.shipped", deliverable_id: "pr-731",
      title: "One step at a time", summary: "Recording is a sequence now.",
      url: "https://github.com/x/pbbls/pull/731", node_ids: ["V-timeline"], platform: "android" },
  ];
  const p = journalToPollen(events, NODES, CONFIG).pollen[0];
  check("a shipped grain carries the deliverable's platform", p.payload.platform === "android", JSON.stringify(p.payload));
  const validated = validatePollen(p);
  check("…and still validates warning-free", validated.ok && validated.warnings.length === 0, validated.ok ? "" : validated.error);
}
{
  // Absent, never null: a deliverable with no single platform is unscoped, and
  // an explicit null in the payload is a different claim from saying nothing.
  const events = [
    { id: "01D3", ts: "2026-08-24T10:00:00Z", type: "deliverable.shipped", deliverable_id: "pr-757",
      title: "Two platforms at once", url: "https://github.com/x/pbbls/pull/757" },
  ];
  const p = journalToPollen(events, NODES, CONFIG).pollen[0];
  check("an unscoped deliverable carries no platform key at all", !("platform" in p.payload), JSON.stringify(p.payload));
}

// --- bilingual title from lab_note ---
{
  const events = [
    { id: "01E", ts: "2026-08-02T11:00:00Z", type: "deliverable.shipped", deliverable_id: "pr-24",
      title: "Fallback", summary: "en summary", url: "https://github.com/x/pbbls/pull/24",
      lab_note: { en: { title: "Benefit first", summary: "en summary" }, fr: { title: "Bénéfice d'abord", summary: "résumé fr" },
        suggested: { molecule: "pbbls", type: "feature" } } },
  ];
  const { pollen } = journalToPollen(events, NODES, CONFIG);
  const p = pollen[0];
  check("bilingual title", p.title.en === "Benefit first" && p.title.fr === "Bénéfice d'abord");
  check("suggested in payload", p.payload.suggested.molecule === "pbbls");
  check("fr summary in payload", p.payload.summary_fr === "résumé fr");
  check("bilingual validates", validatePollen(p).ok);
}

// --- lab_note without fr: plain string title from en ---
{
  const events = [
    { id: "01E2", ts: "2026-08-02T12:00:00Z", type: "deliverable.shipped", deliverable_id: "pr-26",
      title: "Fallback", url: "https://x/pull/26",
      lab_note: { en: { title: "English only", summary: "just en" } } },
  ];
  const { pollen } = journalToPollen(events, NODES, CONFIG);
  check("en-only note titles from en", pollen[0].title === "English only");
}

// --- re-append = corrects envelope ---
{
  const events = [
    { id: "01F", ts: "2026-08-03T10:00:00Z", type: "deliverable.shipped", deliverable_id: "pr-25", title: "First", url: "https://x/pull/25" },
    { id: "01G", ts: "2026-08-03T11:00:00Z", type: "deliverable.shipped", deliverable_id: "pr-25", title: "First, edited", url: "https://x/pull/25" },
  ];
  const { pollen } = journalToPollen(events, NODES, CONFIG);
  check("both occurrences emitted", pollen.length === 2);
  check("first has no corrects", !pollen[0].refs.some((r) => r.label === "corrects"));
  check("second corrects first", pollen[1].refs.some((r) => r.label === "corrects" && r.ref === "arkaik:01F"));
}

// --- release.tagged ---
{
  const events = [
    { id: "01H", ts: "2026-08-04T10:00:00Z", type: "release.tagged", version: "1.3.0", notes: "Big one.", platform: "web" },
    { id: "01I", ts: "2026-08-04T11:00:00Z", type: "release.tagged", version: "1.3.1" },
  ];
  const { pollen } = journalToPollen(events, NODES, CONFIG);
  const p = pollen[0];
  check("release kind", p.kind === "release.tagged");
  check("release title", p.title === "1.3.0 released (web)");
  check("release payload", p.payload.version === "1.3.0" && p.payload.notes === "Big one." && p.payload.platform === "web");
  check("unscoped release title", pollen[1].title === "1.3.1 released");
  check("release validates", validatePollen(p).ok);
}

// --- decision approved → decided; other transitions unmapped ---
{
  const events = [
    { id: "01J", ts: "2026-08-05T10:00:00Z", type: "decision.status_changed", node_id: "DEC-postgres-first", from: "proposed", to: "approved" },
    { id: "01K", ts: "2026-08-05T11:00:00Z", type: "decision.status_changed", node_id: "DEC-postgres-first", from: "approved", to: "enacted" },
    { id: "01L", ts: "2026-08-05T12:00:00Z", type: "decision.status_changed", node_id: "DEC-gone", from: "proposed", to: "approved" },
  ];
  const { pollen } = journalToPollen(events, NODES, CONFIG);
  check("only approved maps", pollen.length === 2);
  check("decided kind", pollen[0].kind === "decided");
  check("decided title from snapshot", pollen[0].title === "PostgreSQL-first relational schema");
  check("decided ref", pollen[0].refs.some((r) => r.label === "decision" && r.ref === "DEC-postgres-first"));
  check("deleted node falls back to id", pollen[1].title === "DEC-gone");
  check("decided validates", validatePollen(pollen[0]).ok);
}

// --- an inexpressible event is skipped with a reason, never thrown ---
{
  const events = [
    { id: "01M", ts: "not-a-timestamp", type: "release.tagged", version: "1.4.0" },
  ];
  const { pollen, skipped } = journalToPollen(events, NODES, CONFIG);
  check("invalid event skipped", pollen.length === 0 && skipped.length === 1 && skipped[0].id === "01M");
  check("skip carries the validator's reason", typeof skipped[0].reason === "string" && skipped[0].reason.length > 0);
}

process.exit(failures ? 1 : 0);
