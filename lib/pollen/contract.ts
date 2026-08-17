// Vendored from ariko lib/pollen.ts — the reference validator for
// docs/POLLEN.md v1. Do not edit here; fix upstream in ariko and re-vendor.
// Conformance fixtures: tests/fixtures/pollen (from ariko data/pollen).
import type { Text } from "./support";
import { isObject, nonEmptyString, normalizeTextInput } from "./support";

// The pollen contract, v1 — normative document: docs/POLLEN.md.
// Pure guards, no DB, no network; the same result idiom as lib/inbox.ts
// plus a warnings channel (non-core kinds are recorded, never refused —
// umbrella §11, no silent loss).

export const POLLEN_VERSION = 1;

// v1 core vocabulary — exactly the umbrella's nine (slice-2 spec §4).
export const CORE_KINDS = [
  "shipped",
  "release.tagged",
  "published",
  "drafted",
  "decided",
  "milestone",
  "task.opened",
  "review.requested",
  "task.done",
] as const;

// Provisional until slice 7 — the Intent shape is normative, this list is not.
export const INTENT_KINDS = ["research", "draft"] as const;

export const KIND_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;
export const MAX_KIND_LENGTH = 64;
export const MAX_PAYLOAD_BYTES = 32 * 1024;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// Strict ISO 8601 with explicit timezone: seconds required, optional
// fraction, Z or ±hh:mm. `at` is when the event happened, source truth.
const AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface PollenAnchors {
  plant: string; // "plant:<slug>"
  pod?: string;  // "pod:<slug>"
  bean?: string; // "bean:<slug>"
}

export interface PollenRef {
  label: string;
  url?: string; // deep link
  ref?: string; // native id — at least one of url | ref
}

export interface Pollen {
  v: 1;
  id: string;
  at: string;
  source: string;
  kind: string;
  title: Text;
  anchors: PollenAnchors;
  refs?: PollenRef[];
  visibility?: "public" | "private";
  payload?: Record<string, unknown>;
}

export interface Intent {
  v: 1;
  id: string;
  at: string;
  target: string;
  kind: string;
  brief: Text;
  anchors?: PollenAnchors;
  refs?: PollenRef[];
}

export type PollenResult =
  | { ok: true; value: Pollen; warnings: string[] }
  | { ok: false; error: string };

export type IntentResult =
  | { ok: true; value: Intent; warnings: string[] }
  | { ok: false; error: string };

function checkV(v: unknown): string | null {
  if (v === POLLEN_VERSION) return null;
  if (typeof v === "number" && Number.isInteger(v) && v > POLLEN_VERSION) {
    return `v ${v} is newer than this validator (pollen v${POLLEN_VERSION})`;
  }
  return `v must be ${POLLEN_VERSION}`;
}

function checkAt(at: unknown): string | null {
  const err = "at must be a strict ISO 8601 timestamp with timezone";
  if (!nonEmptyString(at)) return err;
  const m = AT_PATTERN.exec(at);
  if (!m || Number.isNaN(Date.parse(at))) return err;
  // Date.parse rolls over out-of-range days/hours instead of failing;
  // round-trip the date part and bound the hour to reject Feb 30 & hour 24.
  const [year, month, day, hour] = [+m[1], +m[2], +m[3], +m[4]];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return err;
  if (hour > 23) return err;
  return null;
}

function checkKind(kind: unknown): string | null {
  if (!nonEmptyString(kind)) return "kind is required";
  if (kind.length > MAX_KIND_LENGTH || !KIND_PATTERN.test(kind)) {
    return "kind must be lowercase dotted words (max 64 chars)";
  }
  return null;
}

function anchorRef(
  v: unknown,
  tier: "plant" | "pod" | "bean",
): { error?: string; ref?: string } {
  if (v === undefined) {
    return tier === "plant" ? { error: "anchors.plant is required" } : {};
  }
  const prefix = `${tier}:`;
  if (
    typeof v !== "string" ||
    !v.startsWith(prefix) ||
    !SLUG_PATTERN.test(v.slice(prefix.length))
  ) {
    return { error: `anchors.${tier} must be a "${tier}:<slug>" ref` };
  }
  return { ref: v };
}

function checkAnchors(a: unknown): { error?: string; anchors?: PollenAnchors } {
  if (a === undefined) return { error: "anchors.plant is required" };
  if (!isObject(a)) return { error: "anchors must be an object" };
  const plant = anchorRef(a.plant, "plant");
  if (plant.error) return { error: plant.error };
  const pod = anchorRef(a.pod, "pod");
  if (pod.error) return { error: pod.error };
  const bean = anchorRef(a.bean, "bean");
  if (bean.error) return { error: bean.error };
  return {
    anchors: {
      plant: plant.ref as string,
      ...(pod.ref ? { pod: pod.ref } : {}),
      ...(bean.ref ? { bean: bean.ref } : {}),
    },
  };
}

function checkRefs(r: unknown): { error?: string; refs?: PollenRef[] } {
  if (r === undefined) return {};
  if (!Array.isArray(r)) return { error: "refs must be an array" };
  const refs: PollenRef[] = [];
  for (const entry of r) {
    if (!isObject(entry) || !nonEmptyString(entry.label)) {
      return { error: "each ref requires a label" };
    }
    if (entry.url !== undefined && !nonEmptyString(entry.url)) {
      return { error: "ref.url must be a non-empty string" };
    }
    if (entry.ref !== undefined && !nonEmptyString(entry.ref)) {
      return { error: "ref.ref must be a non-empty string" };
    }
    if (entry.url === undefined && entry.ref === undefined) {
      return { error: `ref "${entry.label}" requires url or ref` };
    }
    refs.push({
      label: entry.label,
      ...(nonEmptyString(entry.url) ? { url: entry.url } : {}),
      ...(nonEmptyString(entry.ref) ? { ref: entry.ref } : {}),
    });
  }
  return { refs };
}

function checkPayload(p: unknown): { error?: string; payload?: Record<string, unknown> } {
  if (p === undefined) return {};
  if (!isObject(p)) return { error: "payload must be an object" };
  let serialized: string;
  try {
    serialized = JSON.stringify(p);
  } catch {
    return { error: "payload must be JSON-serializable" };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    return { error: "payload exceeds 32 KiB serialized — put detail behind a ref" };
  }
  return { payload: p };
}

function kindWarnings(kind: string, core: readonly string[]): string[] {
  return core.includes(kind)
    ? []
    : [`kind "${kind}" is not in the v1 core vocabulary`];
}

// Pure guard for one envelope. Unknown top-level keys are ignored (forward
// compatibility); malformed envelopes are rejected, never silently dropped.
export function validatePollen(value: unknown): PollenResult {
  if (!isObject(value)) return { ok: false, error: "envelope must be a JSON object" };
  const vErr = checkV(value.v);
  if (vErr) return { ok: false, error: vErr };
  if (!nonEmptyString(value.id)) return { ok: false, error: "id is required" };
  const atErr = checkAt(value.at);
  if (atErr) return { ok: false, error: atErr };
  if (!nonEmptyString(value.source) || !SLUG_PATTERN.test(value.source)) {
    return { ok: false, error: "source must be a lowercase slug" };
  }
  const kindErr = checkKind(value.kind);
  if (kindErr) return { ok: false, error: kindErr };
  const kind = value.kind as string;
  const title = normalizeTextInput(value.title);
  if (title === null) return { ok: false, error: "title is required" };
  const anchors = checkAnchors(value.anchors);
  if (anchors.error) return { ok: false, error: anchors.error };
  const refs = checkRefs(value.refs);
  if (refs.error) return { ok: false, error: refs.error };
  if (
    value.visibility !== undefined &&
    value.visibility !== "public" &&
    value.visibility !== "private"
  ) {
    return { ok: false, error: 'visibility must be "public" or "private"' };
  }
  const payload = checkPayload(value.payload);
  if (payload.error) return { ok: false, error: payload.error };

  return {
    ok: true,
    value: {
      v: POLLEN_VERSION,
      id: value.id,
      at: value.at as string,
      source: value.source,
      kind,
      title,
      anchors: anchors.anchors as PollenAnchors,
      ...(refs.refs ? { refs: refs.refs } : {}),
      ...(value.visibility ? { visibility: value.visibility as "public" | "private" } : {}),
      ...(payload.payload ? { payload: payload.payload } : {}),
    },
    warnings: kindWarnings(kind, CORE_KINDS),
  };
}

// The reverse envelope (spec §5). Delivery is project-native and outside
// this contract; status returns through the target's ordinary report feed.
export function validateIntent(value: unknown): IntentResult {
  if (!isObject(value)) return { ok: false, error: "intent must be a JSON object" };
  const vErr = checkV(value.v);
  if (vErr) return { ok: false, error: vErr };
  if (!nonEmptyString(value.id)) return { ok: false, error: "id is required" };
  const atErr = checkAt(value.at);
  if (atErr) return { ok: false, error: atErr };
  if (!nonEmptyString(value.target) || !SLUG_PATTERN.test(value.target)) {
    return { ok: false, error: "target must be a lowercase slug" };
  }
  const kindErr = checkKind(value.kind);
  if (kindErr) return { ok: false, error: kindErr };
  const kind = value.kind as string;
  const brief = normalizeTextInput(value.brief);
  if (brief === null) return { ok: false, error: "brief is required" };
  let anchors: PollenAnchors | undefined;
  if (value.anchors !== undefined) {
    const checked = checkAnchors(value.anchors);
    if (checked.error) return { ok: false, error: checked.error };
    anchors = checked.anchors;
  }
  const refs = checkRefs(value.refs);
  if (refs.error) return { ok: false, error: refs.error };

  return {
    ok: true,
    value: {
      v: POLLEN_VERSION,
      id: value.id,
      at: value.at as string,
      target: value.target,
      kind,
      brief,
      ...(anchors ? { anchors } : {}),
      ...(refs.refs ? { refs: refs.refs } : {}),
    },
    warnings: kindWarnings(kind, INTENT_KINDS),
  };
}

export interface FeedLineResult {
  line: number; // 1-based, in the raw file
  result: PollenResult;
}

// Validate a committed feed file (pollen/feed.ndjson): one envelope per
// line, blank lines ignored. Pure — the CLI wraps this for exit codes.
export function validateFeed(ndjson: string): FeedLineResult[] {
  const out: FeedLineResult[] = [];
  const lines = ndjson.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      out.push({ line: i + 1, result: { ok: false, error: "invalid JSON" } });
      continue;
    }
    out.push({ line: i + 1, result: validatePollen(parsed) });
  }
  return out;
}
