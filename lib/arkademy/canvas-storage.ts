import { emptyDraft, fitAnswer, fitName, nextAnswerId } from "./canvas";
import type { CanvasDraft, DraftAnswer } from "./canvas";
import { BMC_QUESTION_KEYS, MAX_ANSWERS_PER_QUESTION } from "./schema";
import type { BmcQuestionKey } from "./schema";

/**
 * Your own canvas in browser storage (spec § "Browser storage"): one draft per
 * browser under one key, in a versioned envelope `{ "v": 1, "draft": … }`.
 * Pure parse and serialise; lib/hooks/useCanvasDraft.ts is the only code that
 * touches localStorage.
 */

export const DRAFT_STORAGE_KEY = "arkaik:arkademy:bmc";
/** Where an unreadable stored value is copied before anything overwrites it. */
export const DRAFT_UNREADABLE_KEY = "arkaik:arkademy:bmc:unreadable";
/** The envelope version this build writes. */
export const DRAFT_FORMAT = 1;
/** `DRAFT_UPGRADES[n]` turns a version-n draft into a version-(n+1) one. Empty at version 1. */
export const DRAFT_UPGRADES: Readonly<Record<number, (old: unknown) => unknown>> = {};
/** The file an unreadable stored value downloads as. */
export const UNREADABLE_DRAFT_FILENAME = "business-model-canvas-unreadable.txt";

export type StoredDraftRead =
  | { status: "none" }
  | { status: "ok"; draft: CanvasDraft }
  | { status: "unreadable"; raw: string }
  /** Written by a newer build: shown as best this build can, never saved over. */
  | { status: "newer"; v: number; raw: string; draft: CanvasDraft };

const QUESTION_KEYS: ReadonlySet<string> = new Set(BMC_QUESTION_KEYS);
const ANSWER_ID = /^[A-Za-z0-9_-]{1,40}$/;
const ENTITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repairInspiration(value: unknown): DraftAnswer["inspiration"] | undefined {
  if (!isRecord(value)) return undefined;
  const { entity, documentVersion } = value;
  if (typeof entity !== "string" || entity.length > 64 || !ENTITY_ID.test(entity)) return undefined;
  if (typeof documentVersion !== "number" || !Number.isInteger(documentVersion) || documentVersion < 1) return undefined;
  return { entity, documentVersion };
}

/**
 * A stored draft made usable, or null when it has no usable shape (not an
 * object, or no `answers` array). Tolerant: answers with an unknown question
 * or a non-string or blank text are dropped, texts are cut to 140 characters,
 * a question keeps its first five answers, a missing or repeated id gets a new
 * one, `open` is deduplicated and loses the keys that have answers.
 */
export function repairDraft(value: unknown): CanvasDraft | null {
  if (!isRecord(value) || !Array.isArray(value.answers)) return null;
  const perQuestion = new Map<string, number>();
  const kept: DraftAnswer[] = [];
  const pendingIds: number[] = [];
  const usedIds = new Set<string>();
  for (const item of value.answers) {
    if (!isRecord(item)) continue;
    const { question, text, id } = item;
    if (typeof question !== "string" || !QUESTION_KEYS.has(question)) continue;
    if (typeof text !== "string") continue;
    const fitted = fitAnswer(text).trim();
    if (fitted === "") continue;
    const count = perQuestion.get(question) ?? 0;
    if (count >= MAX_ANSWERS_PER_QUESTION) continue;
    perQuestion.set(question, count + 1);
    const answer: DraftAnswer = { id: "", question: question as BmcQuestionKey, text: fitted };
    const inspiration = repairInspiration(item.inspiration);
    if (inspiration) answer.inspiration = inspiration;
    if (typeof id === "string" && ANSWER_ID.test(id) && !usedIds.has(id)) {
      answer.id = id;
      usedIds.add(id);
    } else {
      pendingIds.push(kept.length);
    }
    kept.push(answer);
  }
  for (const position of pendingIds) kept[position].id = nextAnswerId(kept);

  const answered = new Set(kept.map((answer) => answer.question));
  const openKeys = new Set(
    (Array.isArray(value.open) ? value.open : []).filter(
      (key): key is BmcQuestionKey => typeof key === "string" && QUESTION_KEYS.has(key) && !answered.has(key as BmcQuestionKey),
    ),
  );
  return {
    name: typeof value.name === "string" ? fitName(value.name) : "",
    answers: kept,
    open: BMC_QUESTION_KEYS.filter((key) => openKeys.has(key)),
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.length <= 40 ? value.updatedAt : "",
  };
}

/** What the stored value holds. `null` (nothing stored) and a blank string are `none`. */
export function readStoredDraft(raw: string | null): StoredDraftRead {
  if (raw === null || raw.trim() === "") return { status: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "unreadable", raw };
  }
  if (!isRecord(parsed)) return { status: "unreadable", raw };
  const v = parsed.v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return { status: "unreadable", raw };
  if (v > DRAFT_FORMAT) return { status: "newer", v, raw, draft: repairDraft(parsed.draft) ?? emptyDraft() };

  let draft: unknown = parsed.draft;
  for (let from = v; from < DRAFT_FORMAT; from++) {
    const upgrade = DRAFT_UPGRADES[from];
    if (!upgrade) return { status: "unreadable", raw };
    try {
      draft = upgrade(draft);
    } catch {
      return { status: "unreadable", raw };
    }
  }
  const repaired = repairDraft(draft);
  return repaired ? { status: "ok", draft: repaired } : { status: "unreadable", raw };
}

/** The stored value: the envelope, answers trimmed, blank ones left out. */
export function serializeDraft(draft: CanvasDraft): string {
  const answers = draft.answers
    .filter((answer) => answer.text.trim() !== "")
    .map((answer) => ({
      id: answer.id,
      question: answer.question,
      text: answer.text.trim(),
      ...(answer.inspiration ? { inspiration: answer.inspiration } : {}),
    }));
  return JSON.stringify({
    v: DRAFT_FORMAT,
    draft: { name: draft.name, answers, open: draft.open, updatedAt: draft.updatedAt },
  });
}
