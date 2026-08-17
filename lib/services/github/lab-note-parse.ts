// The Lab Note wire contract, arkaik side (slice 3) — a TS port of ariko's
// scripts/lab-note/lib.mjs extraction + validation. The behaviors here are
// the reference's: a level-2 heading starting with "## Lab Note" opens the
// section, the next level-2 heading (or EOF) closes it, the FIRST ```yaml
// fence inside wins, en.title/en.summary are required, fr/suggested are
// optional, unknown top-level keys are ignored. Pure: parsing only, no I/O.
//
// One deliberate deviation from lib.mjs: an empty `fr` is OMITTED rather
// than stored as `{}` — the note lands verbatim in journal events
// (deliverable.shipped.lab_note) and an empty mapping there is noise.
import { parse as parseYaml } from "yaml";

export interface LabNote {
  en: { title: string; summary: string };
  fr?: { title?: string; summary?: string };
  suggested?: { molecule?: string; atom?: string; type?: string; tags?: string[] };
}

export type LabNoteResult = { ok: true; note: LabNote } | { ok: false; error: string };

/**
 * The `## Lab Note` section's yaml fence content, or null when the body has
 * no such section or no fence (the no-note case — never an error).
 * Line-based, not fence-aware, exactly like the reference: a "## " line
 * inside the fence would close the section early.
 */
export function extractLabNoteYaml(prBody: string): string | null {
  if (typeof prBody !== "string" || prBody === "") return null;
  const lines = prBody.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Lab Note/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start + 1, end);
  const fenceStart = section.findIndex((l) => /^\s*```ya?ml\s*$/.test(l));
  if (fenceStart === -1) return null;
  const rest = section.slice(fenceStart + 1);
  const fenceLen = rest.findIndex((l) => /^\s*```\s*$/.test(l));
  if (fenceLen === -1) return null;
  return rest.slice(0, fenceLen).join("\n");
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Why a note usually fails to parse: a colon inside an unquoted title/summary
// ("Heads up: it moved"). YAML reads "key: value" there and gives up, and the
// parser's own wording points nowhere near the fix. Returns the offending
// key, or null — only ever used to ADD a hint, never to change the verdict.
function unquotedColonKey(yamlText: string): string | null {
  for (const line of String(yamlText).split(/\r?\n/)) {
    const m = /^\s*(title|summary)\s*:\s+(\S.*?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2];
    if (/^["']/.test(value) || /^[|>]/.test(value)) continue;
    if (/:(\s|$)/.test(value)) return m[1];
  }
  return null;
}

export function parseLabNote(yamlText: string): LabNoteResult {
  let doc: unknown;
  try {
    // The `yaml` package's default (core) schema keeps unquoted dates as
    // strings — the same reason the reference pins js-yaml's CORE_SCHEMA.
    doc = parseYaml(yamlText);
  } catch (err) {
    const key = unquotedColonKey(yamlText);
    const hint = key ? `the ${key} contains a colon, so it must be wrapped in "quotes" — ` : "";
    return { ok: false, error: `invalid YAML: ${hint}${err instanceof Error ? err.message : "unknown"}` };
  }
  if (!isMapping(doc)) return { ok: false, error: "lab note must be a YAML mapping" };
  const en = isMapping(doc.en) ? doc.en : {};
  if (!nonEmptyString(en.title)) return { ok: false, error: "en.title is required" };
  if (!nonEmptyString(en.summary)) return { ok: false, error: "en.summary is required" };
  const fr = isMapping(doc.fr) ? doc.fr : {};
  const note: LabNote = { en: { title: en.title.trim(), summary: en.summary.trim() } };
  const frOut = {
    ...(nonEmptyString(fr.title) ? { title: fr.title.trim() } : {}),
    ...(nonEmptyString(fr.summary) ? { summary: fr.summary.trim() } : {}),
  };
  if (Object.keys(frOut).length > 0) note.fr = frOut;
  if (isMapping(doc.suggested)) {
    const s = doc.suggested;
    const suggested = {
      ...(nonEmptyString(s.molecule) ? { molecule: s.molecule.trim() } : {}),
      ...(nonEmptyString(s.atom) ? { atom: s.atom.trim() } : {}),
      ...(nonEmptyString(s.type) ? { type: s.type.trim() } : {}),
      ...(Array.isArray(s.tags) && s.tags.length > 0 && s.tags.every((t) => nonEmptyString(t))
        ? { tags: (s.tags as string[]).map((t) => t.trim()) }
        : {}),
    };
    if (Object.keys(suggested).length > 0) note.suggested = suggested;
  }
  return { ok: true, note };
}
