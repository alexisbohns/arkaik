#!/usr/bin/env node

/**
 * Direct unit tests for `packages/cli/src/lib/bootstrap/body-budget.ts` —
 * the PR-body truncation cap `bootstrap slice` applies (docs/superpowers/
 * plans/2026-08-04-bootstrap-method.md, Task 4).
 *
 * This file requires the `.ts` SOURCE directly (Node's native TypeScript
 * support strips the types at load time) rather than spawning the built CLI
 * binary — no `npm run build -w arkaik` needed first, and no corpus/plan/CLI
 * round trip to reach the function under test. That round trip is exactly
 * why two real defects in this module shipped with zero coverage: every
 * fixture available at the time put the Lab Note LAST in the body, so
 * nothing ever exercised trailing content after it, or a note bigger than
 * the whole cap. `body-budget.ts` has no imports of its own for this exact
 * reason — it can be loaded standalone, with nothing to resolve.
 */
const path = require("path");

const { boundBody, splitLabNoteSection, MAX_BODY_CHARS } = require(
  path.join(__dirname, "..", "..", "packages", "cli", "src", "lib", "bootstrap", "body-budget.ts"),
);

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

function labNoteBlock(title, summary) {
  return `## Lab Note\n\n\`\`\`yaml\nen:\n  title: "${title}"\n  summary: "${summary}"\n\`\`\`\n`;
}

// --- no-note: a plain oversized body with no Lab Note at all ---
{
  const prose = "This PR reworks a chunk of the onboarding flow. ".repeat(100); // > 4000 chars, no heading
  check("setup: no-note prose exceeds the cap", prose.length > MAX_BODY_CHARS, String(prose.length));
  const out = boundBody(prose);
  check("no-note: the body is actually shortened", out.length < prose.length, String(out.length));
  check("no-note: the kept prefix is the body's own head", out.startsWith(prose.slice(0, 100)), out.slice(0, 100));
  check("no-note: the truncation is marked with how much was cut", /truncated \d+ characters/.test(out), out.slice(-80));
  check("no-note: a body already at or under the cap is returned unchanged", boundBody("short") === "short", "");
}

// --- note-early: the Lab Note sits near the START, with a large trailing "after" ---
// This is the exact shape that used to make boundBody GROW the body (the
// coordinator's repro: 20076 -> 20088) — `after` used to be retained in
// full, unbounded.
{
  // The heading regex is anchored at line-start (`^` with the `m` flag), so
  // `before` MUST end with a newline for "## Lab Note" to actually be
  // recognized as a heading — omitting it silently sends boundBody down the
  // no-note fallback path instead (which happened to still pass some of
  // these checks by accident during this test's own first draft, since the
  // note sits near the front either way). The explicit splitLabNoteSection
  // check below guards against that trap for good.
  const before = "Quick summary up top.\n\n";
  const note = labNoteBlock("A small delight, shipped", "Something users will notice, explained simply.");
  const after = "\n## Testing\n\n" + "Manually verified in staging. ".repeat(700); // large trailing section
  const body = before + note + after;
  check("setup: note-early body exceeds the cap", body.length > MAX_BODY_CHARS, String(body.length));
  check("setup: note-early has real trailing content (the shape that used to grow)", after.length > MAX_BODY_CHARS, String(after.length));
  check("setup: note-early is actually recognized as having a Lab Note section", splitLabNoteSection(body) !== null, "");

  const out = boundBody(body);
  check("note-early: the body is actually SHORTER than the input, not grown or equal", out.length < body.length, `in=${body.length} out=${out.length}`);
  check("note-early: the Lab Note heading is present", out.includes("## Lab Note"), out);
  check(
    "note-early: the Lab Note's YAML content survives byte-for-byte",
    out.includes('title: "A small delight, shipped"') && out.includes('summary: "Something users will notice, explained simply."'),
    out,
  );
  check("note-early: the trailing content was actually truncated, not kept whole", !out.includes("Manually verified in staging. ".repeat(700)), "");
  check("note-early: truncation is marked with a count", /truncated \d+ characters/.test(out), out.slice(-120));
}

// --- note-only: the body IS the Lab Note, nothing before or after, and the note alone exceeds the cap ---
// Nothing surrounds the note, so there is nothing to trim — the hard floor
// must return the untouched original rather than a same-size "truncated"
// body (the coordinator's other repro: 20057 -> 20057 with no marker at all,
// silently doing nothing while still being called from a "truncation" path).
{
  const hugeSummary = "This shipped a big batch of changes across several surfaces. ".repeat(80);
  const note = labNoteBlock("Everything, all at once", hugeSummary);
  check("setup: note-only body (note alone) exceeds the cap", note.length > MAX_BODY_CHARS, String(note.length));
  check("setup: note-only is recognized as having a Lab Note section", splitLabNoteSection(note) !== null, "");

  const out = boundBody(note);
  check("note-only: with nothing to trim, the ORIGINAL body is returned untouched", out === note, `in=${note.length} out=${out.length}`);
  check("note-only: the hard floor never returns something >= the input length", out.length <= note.length, "");
}

// --- note-larger-than-budget: the note alone exceeds the cap, but real before/after content still gets trimmed around it ---
{
  const before = "Context and rationale. ".repeat(150) + "\n\n"; // real prose before, newline before the heading
  const hugeSummary = "This shipped a big batch of changes across several surfaces. ".repeat(80);
  const note = labNoteBlock("Everything, all at once", hugeSummary);
  const after = "\n## Follow-ups\n\n" + "Filed as separate tickets. ".repeat(150); // real content after
  const body = before + note + after;
  check("setup: note-larger-than-budget note alone exceeds the cap", note.length > MAX_BODY_CHARS, String(note.length));
  check("setup: note-larger-than-budget body exceeds the cap overall", body.length > MAX_BODY_CHARS, String(body.length));
  check("setup: note-larger-than-budget is recognized as having a Lab Note section", splitLabNoteSection(body) !== null, "");

  const out = boundBody(body);
  check(
    "note-larger-than-budget: still shrinks for real (before/after get trimmed even though the note alone is over cap)",
    out.length < body.length,
    `in=${body.length} out=${out.length}`,
  );
  check(
    "note-larger-than-budget: the Lab Note's YAML content survives fully intact",
    out.includes('title: "Everything, all at once"') && out.includes(hugeSummary.trim()),
    out.slice(0, 200) + " ... " + out.slice(-200),
  );
  check("note-larger-than-budget: the hard floor never returns something >= the input length", out.length <= body.length, "");
}

// --- splitLabNoteSection: the building block itself ---
{
  const body = "before text\n\n## Lab Note\n\nnote content\n\n## Next Heading\n\nafter text";
  const section = splitLabNoteSection(body);
  check("splitLabNoteSection: finds the heading", section !== null, "");
  check("splitLabNoteSection: before is everything up to the heading", section.before === "before text\n\n", JSON.stringify(section.before));
  check(
    "splitLabNoteSection: note runs from the heading up to (not including) the next H2",
    section.note === "## Lab Note\n\nnote content\n\n",
    JSON.stringify(section.note),
  );
  check("splitLabNoteSection: after is everything from the next heading onward", section.after === "## Next Heading\n\nafter text", JSON.stringify(section.after));
  check("splitLabNoteSection: returns null when there is no Lab Note heading", splitLabNoteSection("just some text") === null, "");
}

process.exit(failures === 0 ? 0 : 1);
